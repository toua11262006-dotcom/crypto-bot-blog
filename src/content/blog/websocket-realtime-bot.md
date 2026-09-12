---
title: 'WebSocket APIとは?ボットをリアルタイム化する仕組みと実装のポイント'
description: '価格取得のポーリングに限界を感じたら検討したいWebSocket API。RESTとの違い、向いている用途、再接続・再同期を考慮したPython実装例まで、設計の考え方を整理します。'
pubDate: '2026-08-31'
heroImage: '../../assets/eyecatch/websocket-realtime-bot.png'
---

「価格の反映が遅れて指値のタイミングを逃した」「取得間隔を短くしたらレートリミットに引っかかった」。REST APIを一定間隔で叩く「ポーリング」でボットを作っていると、こうした壁に当たることがあります。

この壁を解決する手段としてよく挙がるのがWebSocket APIです。本記事では、RESTとWebSocketの違いから、ボットでWebSocketが向いている場面、そして再接続を考慮した実装の考え方までを整理します。レートリミットとの関係については [APIのレートリミットを設計に織り込む方法](/blog/api-rate-limit-design/) でも触れているので、あわせて参考にしてください。

## RESTとWebSocketの違い

| 項目 | REST API(ポーリング) | WebSocket API |
| --- | --- | --- |
| 通信の向き | クライアントから毎回リクエスト | サーバーから変化があった分だけプッシュ配信 |
| 更新の反映 | 呼び出し間隔に依存(遅延あり) | ほぼリアルタイム |
| リクエスト消費 | 頻度を上げるほど線形に増える | 接続を維持するだけで消費はほぼ一定 |
| 実装の複雑さ | シンプル(呼んで受け取るだけ) | 接続維持・再接続・差分管理が必要 |

RESTは「欲しいときに聞きに行く」方式、WebSocketは「変化があったら知らせてもらう」方式だとイメージすると分かりやすいでしょう。更新が速い分、WebSocket側は実装の考慮点も増えます。

## ボットでWebSocketが向いている用途・向いていない用途

すべてをWebSocketに置き換える必要はありません。用途によって向き不向きがあります。

**向いている用途**
- ティッカー(現在値)や約定履歴のリアルタイム監視
- 板情報(オーダーブック)の差分更新の受信
- 自分の注文の約定通知(取引所が対応している場合)

**RESTのままでよい用途**
- 発注・キャンセルそのもの(取引所によってはWebSocket経由の発注に対応していない、または挙動が異なることがある)
- 残高確認など、頻度が低くタイミングの厳密さを求められない処理

板情報の見方そのものについては [板情報(オーダーブック)とは?ボットで見るべき数値と使い方](/blog/orderbook-basics/) で解説しています。WebSocketで受け取る板情報の差分更新を正しく解釈するには、まずREST経由で取得できる板情報の構造を理解しておくと理解が早くなります。

## 実装の基本形

WebSocket接続は、張りっぱなしにできれば良いわけではなく「切れることを前提に」設計する必要があります。Pythonの`websockets`ライブラリを使った、再接続と指数バックオフを組み込んだ骨格は次のようになります。

```python
import asyncio
import json
import random
import websockets

WS_URL = "wss://example.com/ws"  # 実際のURLは各取引所のドキュメントを確認

async def subscribe_ticker(symbol: str):
    backoff = 1
    while True:
        try:
            async with websockets.connect(WS_URL, ping_interval=20, ping_timeout=10) as ws:
                await ws.send(json.dumps({"method": "subscribe", "params": [f"ticker.{symbol}"]}))
                backoff = 1  # 接続できたらバックオフをリセット
                async for message in ws:
                    data = json.loads(message)
                    handle_ticker(data)
        except (websockets.ConnectionClosed, OSError) as e:
            wait = min(backoff, 30) + random.uniform(0, 1)
            print(f"WebSocket切断、{wait:.1f}秒後に再接続: {e}")
            await asyncio.sleep(wait)
            backoff *= 2

def handle_ticker(data: dict):
    # 受信データの処理(価格更新・シグナル判定など)
    pass

asyncio.run(subscribe_ticker("BTC_USDT"))
```

ポイントは次の3つです。

1. **`ping_interval`で生死監視をする**: 一部の取引所はサーバー側からのping/pongに一定時間応答がないと接続を切断します。ライブラリ側の自動ping機能を使うか、取引所仕様に沿った独自のping送信を実装します。
2. **指数バックオフ+ジッターで再接続する**: 切断直後に一斉再接続すると再び弾かれることがあるため、待機時間を徐々に伸ばし、ランダムなゆらぎ(ジッター)を加えます。考え方はREST APIの429エラー対策と同じです。
3. **再接続後は状態を再同期する**: WebSocketは「差分」を配信する方式が多く、切断中に届かなかった差分はそのままでは復元できません。再接続時にREST APIで最新の板情報やポジションを取得し直し、そこからWebSocketの差分を積み上げる、という組み合わせが基本になります。

再接続時の状態復元という考え方は、プロセス自体の再起動時にも共通します。詳しくは [ボットが再起動したら二重発注?状態復元とID管理で防ぐ設計の作り方](/blog/bot-restart-state-recovery/) で扱っているので、あわせて確認してください。

## 板情報の差分更新で気をつけたいこと

板情報をWebSocketで購読する場合、多くの取引所は「初回にスナップショットを送り、以降は差分(追加・変更・削除)だけを送る」方式を採用しています。この方式では次のような不整合に注意が必要です。

- スナップショット取得と差分購読開始のタイミングがずれると、板の状態が食い違う
- シーケンス番号(更新ID)が提供されている場合、番号が飛んでいないかをチェックし、飛んでいたら再購読する
- 一定時間ごとに整合性チェック(REST APIでの板情報と突き合わせる)を入れる

※ 差分配信の仕様(スナップショットの取り方、シーケンス番号の有無など)は取引所ごとに異なり、仕様変更が入ることもあります。実装前に必ず公式ドキュメントの最新情報を確認してください。

## 接続断・取引所障害への備え

WebSocket接続が切れている間、ボットは「見えていない」状態になります。この間に無理にポジションを取ろうとせず、安全側に倒す設計が重要です。取引所側の障害・メンテナンス時の考え方は [取引所がダウンした時、ボットはどう動くべき?障害時のフェイルセーフ設計](/blog/exchange-outage-failsafe/) で詳しく解説しています。WebSocketの切断も広い意味では同じ「情報が届かなくなる障害」として扱い、一定時間データが更新されなければ新規注文を止める、といったガードを入れておくと安心です。

<div class="affiliate-box">
<span class="label">PR</span>
<p>WebSocketでの価格・板情報の購読は、公開チャンネルであればAPIキーなしで試せる取引所が多く、実装の練習に向いています。<strong>MEXC</strong>はccxt対応取引所の一つで、REST APIのドキュメントを参考にしながら仕様を確認する入り口としても使えます。</p>
<p><a href="https://promote.mexc.com/r/ZREtHSpY5h" target="_blank" rel="nofollow sponsored">MEXCの口座を無料で開設する(紹介リンク)</a></p>
</div>

## まとめ

- RESTは「聞きに行く」、WebSocketは「知らせてもらう」方式。更新頻度が高い監視系はWebSocketに向いている
- 発注・キャンセルなど重要な操作は、対応状況が取引所ごとに異なるためRESTを基本にする設計が安全
- WebSocketは「切れること」を前提に、ping監視・指数バックオフでの再接続を組み込む
- 再接続後はREST APIで状態を再同期し、差分配信の欠落を補う
- 板情報の差分更新はシーケンス番号などで整合性を確認し、ずれたら再購読する
- 接続断中は「情報が見えていない」状態として扱い、新規注文を止めるなど安全側の設計にする

WebSocketはRESTに比べて実装の考慮点が増えますが、まずは監視系(価格・板情報)だけをWebSocketに置き換え、発注系はRESTのまま残す、という段階的な移行から始めると無理がありません。基本のAPI呼び出し方をまだ押さえていない場合は、先に [ccxtとは?Pythonで仮想通貨ボットを自作する第一歩](/blog/ccxt-python-tutorial/) から読んでみてください。
