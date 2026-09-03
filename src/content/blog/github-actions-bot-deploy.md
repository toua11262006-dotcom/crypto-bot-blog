---
title: 'GitHub Actionsでボットを自動デプロイする方法とは?CI/CDの組み方'
description: 'コードをpushするたびにテストが走り、問題なければVPSへ反映される。そんなCI/CDをGitHub Actionsで組む方法と、取引ボットならではの注意点を一般的な設計指針として解説します。'
pubDate: '2026-09-03'
heroImage: '../../assets/eyecatch/github-actions-bot-deploy.png'
---

ボットのコードを直したあと、毎回VPSにSSHでログインして `git pull` し、コンテナを再ビルドして再起動する。この作業は、[pytestでテストの書き方](/blog/bot-testing-pytest/)を整えるほど頻繁に発生し、手作業が増えるほど「テストを飛ばして急いで反映する」といった事故の芽にもなります。GitHub Actionsを使えば、pushをきっかけにテストとデプロイを自動化できます。この記事では、自動売買ボットのCI/CDをどう設計するかを一般的な指針として整理します。

## CI/CDを分けて考える

CI/CDは「CI(継続的インテグレーション)」と「CD(継続的デリバリー/デプロイ)」に分けて考えると設計しやすくなります。

- **CI**: pushやプルリクエスト作成のたびに、自動でテスト・lintを実行する
- **CD**: テストが通ったコードを、自動(または承認を挟んで)VPSへ反映する

いきなり両方を自動化する必要はありません。まずはCIだけを導入し、慣れてからCDに進むのが無理のない順序です。

## CIワークフローを書く

`.github/workflows/ci.yml` に、push・プルリクエストのたびにテストを走らせる設定を書きます。

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt
      - run: pip install pytest
      - run: pytest
```

これだけで、コードを壊す変更をpushした瞬間に赤いバツ印で気づけるようになります。[ボットのテストの書き方](/blog/bot-testing-pytest/)で紹介したモックを使ったテストがあるほど、この仕組みの効果は大きくなります。

## デプロイをワークフロー化する

CIが安定したら、`main` ブランチへのマージをトリガーにVPSへデプロイするワークフローを追加します。ここでは[Docker化したボット](/blog/bot-docker-deploy/)を前提に、SSH経由で最新イメージを取得・再起動する例を示します。

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    needs: test
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/trading-bot
            git pull origin main
            docker compose build
            docker compose up -d
```

`secrets.VPS_HOST` などは、GitHubリポジトリの Settings → Secrets and variables → Actions から登録します。SSH秘密鍵をワークフローファイルに直接書くのは絶対にせず、必ずSecretsに保存してください。取引所APIキーの管理方法と同じ考え方で、[APIキーの安全管理](/blog/api-key-security/)で触れた「秘密情報はコードに書かない」原則がここでも当てはまります。

## 自動デプロイと「勝手に反映される怖さ」

CIとテストは自動化するほど恩恵が大きい一方、**取引ボットの自動デプロイには慎重さも必要**です。テストが通っていても、テストでは想定していなかった挙動が本番環境で起きる可能性は残ります。特にポジションを保有している状態でのデプロイは注意が必要です。

対策として有効なのが、上のワークフローにも書いた `environment: production` の指定です。GitHubの「Environments」機能でこの環境に保護ルール(Required reviewers)を設定しておくと、`main` へのマージ後、実際にデプロイが走る前に人間の承認を挟めます。完全自動化せず、**テストの自動化とデプロイの最終判断を分離する**という考え方です。

また、コンテナやプロセスの再起動そのものが二重発注のリスクを持ち込むことは変わりません。デプロイの仕組みを自動化しても、[再起動時の状態復元とID管理](/blog/bot-restart-state-recovery/)で解説した「取引所を真実の源として扱う」設計は引き続き必須です。デプロイを自動化したからといって、この設計を省略してよいわけではありません。

## ロールバックの経路も用意しておく

デプロイを自動化するなら、失敗したときに元に戻す経路もセットで用意しておくべきです。Dockerイメージにタグを付けて管理していれば、直前のタグを指定してデプロイし直すワークフローを別途用意しておくと、障害時に落ち着いて対応できます。

```yaml
      - run: docker compose pull && docker compose up -d
        env:
          IMAGE_TAG: ${{ inputs.rollback_tag }}
```

`workflow_dispatch` トリガーで手動実行できるようにしておけば、緊急時にGitHubの画面からロールバック用ワークフローをワンクリックで起動できます。デプロイ後は必ずログを確認し、正常に起動できているかをその場で判断できる体制にしておきましょう。ログに何を残すべきかは[ボットのログ設計](/blog/bot-log-design/)を参考にしてください。

## 通知と組み合わせる

デプロイの成功・失敗は、GitHub Actions上で確認するだけでなく、外部に通知しておくと見逃しを防げます。ワークフローの最後にWebhookでDiscordへ通知するステップを足すだけで実現できます。

```yaml
      - if: always()
        run: |
          curl -H "Content-Type: application/json" \
            -d "{\"content\": \"デプロイ結果: ${{ job.status }}\"}" \
            ${{ secrets.DISCORD_WEBHOOK_URL }}
```

通知の仕組み自体は[Discord通知ボットの作り方](/blog/discord-notification-bot/)で詳しく解説しているので、あわせて参考にしてください。デプロイ後にAPIの疎通が取れているかどうかは、[取引所障害時のフェイルセーフ設計](/blog/exchange-outage-failsafe/)で触れたヘルスチェックの考え方を流用すると、デプロイそのものの成否だけでなくボットが正常に稼働開始できたかまで確認できます。

## まとめ

- CI(テストの自動実行)とCD(デプロイの自動化)は分けて考え、まずCIから導入する
- SSH鍵やホスト情報はワークフローに書かず、GitHubのSecretsで管理する
- 取引ボットの自動デプロイは、GitHubの「Environments」で承認ステップを挟むなど、完全自動化と人の判断のバランスを取る
- デプロイを自動化しても、再起動時の状態復元やログ設計といった既存の設計原則は省略できない
- ロールバック用のワークフローと、デプロイ結果の通知をあわせて用意しておく

CI/CDは一度整えてしまえば、その後の開発速度と安全性の両方を底上げしてくれる投資です。まずはテストの自動実行から、無理のない範囲で導入してみてください。

<div class="affiliate-box">
<span class="label">PR</span>
<p>GitHub ActionsからSSHでデプロイする構成は、SSH接続や固定IPが扱いやすいVPSほど組みやすくなります。開発・検証環境としても手頃なVPSを探している方は、以下も参考にしてください。</p>
<p><a href="https://px.a8.net/svt/ejp?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" rel="nofollow">サービス開発やテスト環境に便利な【ConoHa】</a>
<img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" alt=""></p>
</div>
