---
title: '自動売買ボットをDocker化する方法とは?VPS運用を安定させる基本ガイド'
description: 'ボットをDockerでコンテナ化すると、環境構築のやり直しやVPS移行が驚くほど楽になります。Dockerfileとdocker-composeの書き方、秘密情報の扱い、systemdとの使い分けを一般的な指針として解説します。'
pubDate: '2026-08-29'
heroImage: '../../assets/eyecatch/bot-docker-deploy.png'
---

VPSにPythonを直接インストールしてボットを動かしていると、「ライブラリのバージョンが合わず動かなくなった」「サーバーを立て直したら環境構築からやり直し」といった問題に直面しがちです。Dockerでボットをコンテナ化しておくと、こうした環境依存のトラブルをかなり減らせます。この記事では、自動売買ボットをDocker化する基本の考え方と手順を整理します。

## なぜボットをDocker化するのか

VPSに直接Pythonをインストールする方法でも動きますが、コンテナ化には次のようなメリットがあります。

- **環境の再現性**: 「自分のPCでは動くのにVPSでは動かない」を防げる。依存関係はイメージの中に閉じ込められる
- **サーバー移行がしやすい**: VPSを乗り換えるときも、Dockerさえ入っていればイメージを持っていくだけで済む
- **依存関係の分離**: 複数のボットを同じVPSで動かしても、ライブラリのバージョン衝突が起きない
- **ロールバックしやすい**: イメージにタグをつけておけば、不具合が出たときに前のバージョンへすぐ戻せる

VPSの選び方自体については[こちらの記事](/blog/vps-bot-24h/)で解説しているので、まだVPSを用意していない場合は参考にしてください。

## Dockerfileを書く

まずはボットの実行環境を定義するDockerfileを用意します。

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "live_bot.py"]
```

ポイントは、`requirements.txt` だけを先にコピーして `pip install` してから、残りのコードをコピーする点です。こうしておくと、コードだけを変更した再ビルド時に依存関係のインストールがキャッシュされ、ビルドが速くなります。

## docker-composeで動かす

単体の `docker run` コマンドを毎回打つのは大変なので、`docker-compose.yml` にまとめておきます。

```yaml
services:
  trading-bot:
    build: .
    container_name: trading-bot
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./logs:/app/logs
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '3'
```

- `restart: unless-stopped` … コンテナが落ちても自動で再起動する(手動で止めた場合は再起動しない)
- `volumes` … ログをコンテナの外(ホスト側)に保存し、コンテナを作り直してもログが消えないようにする
- `logging` … ログファイルが無限に肥大化しないよう上限を設定する

起動は次の1コマンドです。

```bash
docker compose up -d
```

## 秘密情報の扱い方

APIキーなどの秘密情報は、**絶対にDockerfileやイメージの中に直接書き込まないこと**が重要です。イメージに焼き込むと、イメージを共有・アップロードした瞬間に流出します。

```bash
# .env (Gitにはコミットしない。.gitignoreに登録する)
EXCHANGE_API_KEY=xxxxxxxx
EXCHANGE_API_SECRET=xxxxxxxx
```

上記の `docker-compose.yml` のように `env_file` で `.env` を読み込ませれば、コンテナの中では通常の環境変数としてボットのコードから参照できます。APIキー自体の権限設定(出金権限をOFFにする、IP制限をかけるなど)については[APIキーの安全管理](/blog/api-key-security/)で詳しく解説しているので、あわせて確認しておきましょう。

## systemdとの違い・使い分け

VPSでボットを常駐させる方法として、[systemdでサービス化する方法](/blog/vps-bot-24h/)もよく使われます。どちらを選ぶべきかは目的次第です。

| 観点 | systemd | Docker |
| --- | --- | --- |
| 導入の手軽さ | シンプル(設定ファイル1つ) | Dockerのインストールが前提 |
| 環境の再現性 | VPSのOS環境に依存する | イメージ内で完結する |
| 複数ボットの同居 | ライブラリ衝突に注意が必要 | コンテナごとに分離される |
| サーバー移行 | 環境構築をやり直す必要がある | イメージを移すだけで済むことが多い |

1台のVPSで1つのボットをシンプルに動かすだけならsystemdでも十分です。複数のボットや複数戦略を同じVPS上で管理したい場合や、頻繁に環境を作り直す予定がある場合はDockerのメリットが大きくなります。

## 再起動ポリシーで気をつけたいこと

`restart: unless-stopped` は便利ですが、注文処理の途中でコンテナが落ちて再起動すると、**ボットが「未完了だった注文」を把握できずに二重発注してしまう**リスクがあります。これはDocker特有の問題ではなく、systemdの自動再起動でも同じことが起きます。

再起動後に取引所側の状態を正として注文履歴を復元する設計については、[ボットの状態復元とID管理](/blog/bot-restart-state-recovery/)で詳しく解説しています。コンテナ化する場合でも、この設計自体は変わらず必要になる点に注意してください。また、取引所側の障害でAPIが応答しないまま再起動を繰り返すケースへの対策は[障害時のフェイルセーフ設計](/blog/exchange-outage-failsafe/)も参考にしてください。

## ログとヘルスチェック

コンテナのログは `docker compose logs -f trading-bot` で確認できますが、コンテナを削除すると標準出力のログは失われます。前述の `volumes` 設定でログファイル自体をアプリ側からホストに書き出しておくと、障害調査のときに困りません。ログに何を残すべきかは[ボットのログ設計](/blog/bot-log-design/)にまとめているので、Docker化する前に一度見直しておくとよいでしょう。

また、`docker ps` でコンテナが再起動を繰り返していないか(`Restarting` の表示になっていないか)を定期的に確認する運用も忘れずに。再起動ループに気づけないと、実質的にボットが止まっているのに気づかない事態になりかねません。

## 更新・デプロイの流れ

コードを修正したときの一般的な更新手順は次のとおりです。

```bash
git pull                      # 最新コードを取得
docker compose build          # イメージを再ビルド
docker compose up -d          # コンテナを入れ替えて再起動
```

イメージにタグ(バージョン番号)をつけて管理しておくと、新しいバージョンで問題が起きたときに前のタグへ戻すロールバックがすぐにできます。

<div class="affiliate-box">
<span class="label">PR</span>
<p>DockerでボットをVPS運用する場合も、土台となるVPS選びは重要です。ConoHa VPSはUbuntu環境が申し込み当日から使え、Dockerのインストールもすぐに行えます。</p>
<p><a href="https://px.a8.net/svt/ejp?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" rel="nofollow">サービス開発やテスト環境に便利な【ConoHa】</a>
<img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" alt=""></p>
</div>

## まとめ

- Dockerでボットをコンテナ化すると、環境の再現性が上がりVPS移行やロールバックが楽になる
- `requirements.txt` を先にコピーしてキャッシュを効かせるDockerfileの書き方が基本
- `docker-compose.yml` では `restart: unless-stopped`・`env_file`・ログの上限設定を組み合わせる
- 秘密情報はイメージに焼き込まず、`.env` を `.gitignore` に登録して読み込ませる
- 再起動時の二重発注対策や障害時のフェイルセーフは、Docker化してもボット側の設計として別途必要
- シンプルな単一ボット運用ならsystemdでも十分。複数ボットの同居や頻繁な環境構築が必要ならDockerが有利

Dockerで環境を整えたら、次はボット本体のテストや監視体制も見直しておきましょう。[pytestによるテストの書き方](/blog/bot-testing-pytest/)や[毎日の監視ルーティン](/blog/bot-daily-monitoring-routine/)もあわせて参考にしてください。
