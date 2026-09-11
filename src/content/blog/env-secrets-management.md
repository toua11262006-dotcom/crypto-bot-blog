---
title: '秘密情報の管理はどうする?.env・gitignore・環境変数の基本'
description: 'APIキーやシークレットキーをコードに直接書いてGitHubに公開してしまう事故は珍しくありません。.envファイルとpython-dotenv、.gitignoreの設定、環境ごとの管理方法の違いを一般的な指針として整理します。'
pubDate: '2026-09-11'
heroImage: '../../assets/eyecatch/env-secrets-management.png'
---

自動売買ボットのコードをGitHubで管理していると、「APIキーをどこに書けばいいのか」「.gitignoreに何を入れればいいのか」と迷う場面があります。[APIキー自体の安全な発行・権限設定](/blog/api-key-security/)についてはすでに別記事で触れましたが、今回はそのキーを**コード・リポジトリ側でどう扱うか**という、もう一段手前の基本を整理します。

## なぜ秘密情報の管理が重要なのか

APIキーやシークレットキー、Discord Webhook URLなどをソースコードに直接書き込んでしまうと、次のようなリスクが生まれます。

- GitHubにpushした瞬間、Publicリポジトリなら誰でも閲覧可能になる
- Privateリポジトリでも、後で公開設定に切り替えたり、フォークされたりすると露出する
- コミット履歴に残っていると、該当行を削除しても**履歴を遡れば見える**ままになる

自動売買ボットの場合、漏洩したAPIキーがそのまま資産に直結する取引権限を持っていることもあるため、扱いはより慎重であるべきです。もっとも、出金権限をオフにする・IPアドレス制限をかけるといった取引所側の設定も重要な防御線になります。この点は[APIキーの安全管理](/blog/api-key-security/)で詳しく解説しています。

## .envファイルで環境変数を管理する

もっとも基本的な方法は、秘密情報をコードから分離し、`.env` という専用ファイルにまとめて置くことです。Pythonでは `python-dotenv` パッケージを使うと簡単に読み込めます。

```bash
pip install python-dotenv
```

`.env` ファイル(リポジトリには含めない):

```
EXCHANGE_API_KEY=xxxxxxxxxxxxxxxx
EXCHANGE_API_SECRET=yyyyyyyyyyyyyyyy
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/zzzz
```

Python側の読み込みコード:

```python
import os
from dotenv import load_dotenv

load_dotenv()  # カレントディレクトリの .env を読み込む

api_key = os.environ["EXCHANGE_API_KEY"]
api_secret = os.environ["EXCHANGE_API_SECRET"]
```

`os.environ[...]` のように角括弧でアクセスすると、キーが未設定のときに `KeyError` で即座に落ちてくれるため、「キーが空文字のまま取引所に接続してしまう」といった事故を防ぎやすくなります。`os.environ.get(...)` を使う場合は、値が `None` のときにどう振る舞うかを明示的に書いておくと安全です。

## .gitignoreで.envをコミット対象から外す

`.env` ファイル自体を作っても、`.gitignore` に登録し忘れるとそのままコミットされてしまいます。リポジトリのルートに置く `.gitignore` には最低限、次のような行が必要です。

```
.env
.env.*
!.env.example
*.pem
*.key
credentials.json
```

ポイントは `.env.example` のような**値を空にしたサンプルファイル**は残しておくことです。これがあると、他の環境(あるいは将来の自分)がボットをセットアップするときに、どの環境変数が必要かひと目でわかります。

```
# .env.example
EXCHANGE_API_KEY=
EXCHANGE_API_SECRET=
DISCORD_WEBHOOK_URL=
```

なお、`.gitignore` に追加するのは**これからコミットするファイルを対象外にする**設定であり、すでにコミット済みのファイルには効きません。既存のリポジトリに秘密情報入りのファイルが残っていないか、一度 `git log --all --full-history -- .env` のようなコマンドで確認しておくと安心です。

## 誤ってコミットしてしまったときの対処

`.env` を誤ってコミット・pushしてしまった場合、やるべきことは次の2つです。優先度が高いのは1です。

1. **該当するAPIキー・シークレットを取引所側で即座に無効化し、新しいキーを再発行する**
2. リポジトリの履歴から該当ファイルを取り除く(`git filter-repo` や BFG Repo-Cleaner などのツールを使う)

見落としがちなのは、2だけ行って満足してしまうケースです。Public リポジトリの場合、pushした時点で既に外部のクローラーやミラーサービスに取得されている可能性があります。履歴を消しても「一度でも露出したキーはもう安全ではない」という前提で、**必ずキーそのものを再発行**してください。GitHubにはシークレットらしき文字列を検知して警告する機能もありますが、それに気づく前に自分で気づけるようにしておくのが理想です。

## 実行環境ごとの秘密情報管理の違い

`.env` はローカル開発では便利ですが、本番運用ではもう少し環境に応じた管理が必要になります。

| 実行環境 | 一般的な管理方法 |
|---|---|
| ローカル開発 | `.env` + python-dotenv |
| VPS(systemd常駐) | systemdのUnitファイル内 `Environment=`、またはEnvironmentFile指定 |
| Docker | `docker run --env-file`、`docker-compose.yml` の `environment` / `env_file` |
| GitHub Actions(CI/CD) | リポジトリの Secrets 機能に登録し、ワークフロー内で `${{ secrets.XXX }}` として参照 |

いずれの環境でも共通する考え方は、「秘密情報はコードとは別の場所に置き、コードはそれを**参照するだけ**にする」という点です。VPSでの24時間稼働や[Docker化](/blog/bot-docker-deploy/)、[GitHub Actionsでの自動デプロイ](/blog/github-actions-bot-deploy/)を進めていく際も、この原則さえ守っておけば、環境が変わっても秘密情報の受け渡し方法だけを差し替えれば済みます。

VPS上で複数のボットやサービスを動かす場合、環境変数の管理が煩雑になりがちです。安価に検証環境を分けられるVPSを使って、本番用と検証用でキーを完全に分離しておくのも一つの手です。

<div class="affiliate-box">
<span class="label">PR</span>
<p>検証用の環境を本番とは別に用意しておくと、秘密情報の混在事故を防ぎやすくなります。ConoHa VPSは時間課金にも対応しており、テスト環境を手軽に分けて用意できます。</p>
<p><a href="https://px.a8.net/svt/ejp?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" rel="nofollow">サービス開発やテスト環境に便利な【ConoHa】</a>
<img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" alt=""></p>
</div>

## まとめ

- 秘密情報をコードに直接書かず、`.env` などコード外のファイルに分離する
- `.gitignore` に `.env` を登録し、`.env.example` でサンプルを共有する
- `.gitignore` はこれからのコミットにしか効かないため、既存の履歴も確認する
- 誤ってコミット・pushしてしまったら、履歴の削除より先に**キーの再発行**を優先する
- ローカル・VPS・Docker・CI/CDそれぞれで管理方法は異なるが、「コードとは別の場所に置き参照するだけにする」という原則は共通

秘密情報の管理は一度仕組みを作ってしまえば、あとは運用に乗せるだけです。ボットを長く安全に動かし続けるための土台として、早い段階で整えておくことをおすすめします。
