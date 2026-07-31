---
title: 'PythonでDiscordに通知を送る方法|Webhookでボットの稼働を監視する'
description: 'Discord WebhookをPythonから叩いて通知を送る方法を、コピペで動くコード付きで解説。シンプルなテキスト通知から見やすいEmbed形式、403エラーの対処法、通知が届かないときのチェックリストまでまとめました。'
pubDate: '2026-07-05'
heroImage: '../../assets/eyecatch/discord-notification-bot.png'
---

自動売買ボットを24時間運用するうえで、実は売買ロジックと同じくらい重要なのが**通知の仕組み**です。私のボットはDiscordに通知を送る設計にしており、スマホひとつで稼働状況を把握できます。

## なぜDiscordなのか

- **無料**でWebhook(通知の受け口)が使える
- スマホアプリのプッシュ通知がそのまま使える
- チャンネルを分ければ「取引通知」「日次レポート」「警告」を整理できる
- メールと違って埋もれない

LINEやTelegramでも同様のことはできますが、Webhookの手軽さでDiscordが頭ひとつ抜けています。

## Webhookの作り方(3分)

1. Discordでサーバーを作る(自分専用でOK)
2. 通知用チャンネルの「編集」→「連携サービス」→「ウェブフック」→「新しいウェブフック」
3. 「ウェブフックURLをコピー」を押す

これだけで、そのURLにPOSTするだけでメッセージが届くようになります。

## Pythonでの実装例

```python
import requests

WEBHOOK_URL = 'https://discord.com/api/webhooks/xxxx/yyyy'

def notify(message: str):
    try:
        requests.post(
            WEBHOOK_URL,
            json={'content': message},
            timeout=10,
        )
    except Exception as e:
        # 通知失敗でボット本体を止めないこと
        print(f'Discord通知失敗: {e}')

notify('✅ エントリー: BUY BTC/USDT @ 108,500')
```

ポイントは**通知の失敗でボット本体を落とさない**こと。通知はあくまで補助機能なので、例外はログに残して握りつぶします。

### Webhook URLは秘密情報として扱う

Webhook URLを知っている人は誰でもそのチャンネルに投稿できます。**コードに直接書かず、環境変数から読む**のが基本です。

```python
import os
from dotenv import load_dotenv

load_dotenv()
WEBHOOK_URL = os.getenv('DISCORD_WEBHOOK_URL')
```

`.env` は必ず `.gitignore` に入れてください。うっかりGitHubに公開すると、第三者に通知チャンネルを荒らされます。同じ考え方は[APIキーの管理](/blog/api-key-security/)でも解説しています。

## Embed形式で見やすく通知する

テキストだけでも動きますが、**Embed**(埋め込み)を使うと色分けされた見やすい通知になります。損益がプラスなら緑、マイナスなら赤、といった出し分けができるので、スマホの通知一覧でも一目で状況がつかめます。

```python
import requests

def notify_trade(side: str, symbol: str, price: float, pnl: float | None = None):
    color = 0x2ECC71 if (pnl or 0) >= 0 else 0xE74C3C  # 緑 / 赤

    fields = [
        {'name': '銘柄', 'value': symbol, 'inline': True},
        {'name': '方向', 'value': side, 'inline': True},
        {'name': '価格', 'value': f'{price:,.1f}', 'inline': True},
    ]
    if pnl is not None:
        fields.append({'name': '損益', 'value': f'{pnl:+.2f} USDT', 'inline': True})

    payload = {
        'embeds': [{
            'title': '約定通知',
            'color': color,
            'fields': fields,
        }]
    }
    requests.post(WEBHOOK_URL, json=payload, timeout=10)
```

`username` や `avatar_url` をpayloadに足せば、送信者名やアイコンも変えられます。複数のボットを運用している場合、ボットごとに名前を変えておくと区別しやすくなります。

## レートリミットに注意

Discord Webhookには送信頻度の上限があります。ループの中で1件ずつ通知を送るような実装だと、上限に達して429エラーが返り、通知が欠落します。

対策はシンプルで、**まとめて送る**ことです。

```python
# ❌ 悪い例: 1件ずつ送る
for trade in trades:
    notify(f'{trade.symbol} {trade.side}')

# ✅ 良い例: 1メッセージにまとめる
lines = [f'{t.symbol} {t.side} @ {t.price}' for t in trades]
notify('\n'.join(lines))
```

429が返ったときは、レスポンスの `retry_after` で指定された秒数だけ待ってからリトライします。この考え方は取引所APIのレート制限対策と同じで、[ccxtのエラー対処](/blog/ccxt-common-errors/)でも触れています。

## 実運用で踏んだ落とし穴

### 突然403エラーで通知が届かなくなった

ある日突然、Webhookが403(拒否)を返すようになりました。原因は2つありました。

1. **古いドメイン `discordapp.com` を使っていた** — Discordは旧ドメインを段階的に廃止しており、Webhook URLは `discord.com` に書き換える必要があります(IDとトークン部分はそのまま使えます)
2. **urllib のデフォルトUser-Agentが拒否される** — Pythonの `urllib` で送ると `Python-urllib/x.x` というUser-Agentが付き、これをDiscordが拒否することがあります。`User-Agent` ヘッダーを独自の文字列に変えるか、requestsライブラリを使えば回避できます

どちらも「昨日まで動いていたのに」というパターンなので、通知が止まったらまずここを疑ってください。

## 通知が届かないときのチェックリスト

| 症状 | 疑うポイント |
| --- | --- |
| 401 / 403 が返る | URLのドメインが `discord.com` か / User-Agentが拒否されていないか |
| 404 が返る | Webhookが削除されている、URLのコピーミス |
| 429 が返る | 送信頻度が上限超過。まとめ送信+`retry_after` で待機 |
| エラーは出ないが届かない | 送信先チャンネルの取り違え、ミュート設定 |
| ローカルでは届くがサーバーでは届かない | サーバー側の外向き通信がブロックされていないか |
| 文字が化ける | payloadをJSONで送っているか(`json=` を使う) |

まず `curl` で単体テストすると、コードの問題か環境の問題かを切り分けられます。

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"content":"テスト通知"}' \
  "$DISCORD_WEBHOOK_URL"
```

## LINE・Telegramとの比較

| | Discord | LINE | Telegram |
| --- | --- | --- | --- |
| 導入の手軽さ | ◎ URLを取るだけ | △ 事前設定が必要 | ○ Bot作成が必要 |
| 費用 | 無料 | 無料枠に制限あり | 無料 |
| 通知の整理 | ◎ チャンネル分割 | △ | ○ |
| リッチな表示 | ◎ Embed | ○ | ○ |

※各サービスの仕様・無料枠は変更されることがあるため、最新情報は公式でご確認ください。

普段からLINEを使っている人にはLINEも選択肢ですが、**用途別にチャンネルを分けられる**点でDiscordが運用しやすいです。「取引通知」「エラー」「日次レポート」を別チャンネルにすると、緊急度の高いものが埋もれません。

## 通知設計のコツ: 送りすぎない

最初は何でも通知したくなりますが、多すぎると重要な通知が埋もれます。私の構成は:

- **即時通知**: エントリー/決済、エラー、市場状態の変化(レンジ→強トレンド等)
- **毎時**: 1行サマリー(残高・ポジション・直近成績)
- **日次**: 詳細レポート(決済理由の内訳つき: 利確/損切り/トレーリング等)
- **週次**: 7日間の総括

そしてもうひとつ重要なのが、[休眠バグの記事](/blog/bot-dormant-bug-story/)でも書いた「**何も起きないことの通知**」です。取引が長期間ゼロのときに知らせる仕組みがあると、静かな故障に気づけます。

## まとめ

- Discord WebhookはURLを取得してPOSTするだけ。**3分で導入できる**
- 通知の失敗でボット本体を止めない(例外は握りつぶす)
- Webhook URLは秘密情報。環境変数から読み、`.gitignore` に入れる
- Embedを使うと損益の色分けなど見やすい通知になる
- 送りすぎない設計(即時/毎時/日次/週次の使い分け)が実用的
- **「何も起きていないこと」を通知する**仕組みが、静かな故障を防ぐ

通知はボットの「健康診断」です。Webhook自体は3分で作れるので、ボット開発の最初期に入れておくことを強くおすすめします。ボットの24時間運用環境については[VPS運用の記事](/blog/vps-bot-24h/)、ボット全体の作り方は[Python+ccxt入門](/blog/ccxt-python-tutorial/)をどうぞ。

<div class="affiliate-box">
<span class="label">PR</span>
<p>筆者のボット+通知システムは <strong>ConoHa VPS</strong> 上で24時間動いています。セットアップ手順は<a href="/blog/vps-bot-24h/">VPS運用の記事</a>で解説しています。</p>
<p><a href="https://px.a8.net/svt/ejp?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" rel="nofollow">サービス開発やテスト環境に便利な【ConoHa】</a>
<img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" alt=""></p>
</div>
