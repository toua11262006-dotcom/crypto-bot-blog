---
title: 'Python+ccxtで仮想通貨ボットを自作する第一歩【コード付き入門】'
description: '仮想通貨の自動売買ボット自作に必須のライブラリccxtの入門解説。価格取得から残高確認、注文までの実際のPythonコードを、ボット実運用者が紹介します。'
pubDate: '2026-07-05'
heroImage: '../../assets/eyecatch/ccxt-python-tutorial.png'
---

「自動売買ボットを自作してみたい」と思ったとき、最初に覚えるべきライブラリが **ccxt** です。私のボットもccxtの上に組んでいます。この記事では、価格取得から注文までの最初の一歩をコード付きで解説します。

## ccxtとは

ccxtは、世界中の100以上の仮想通貨取引所のAPIを**同じ書き方で**呼べるPythonライブラリです(JavaScript/PHP版もあります)。

取引所ごとにバラバラなAPI仕様を吸収してくれるので、「取引所を乗り換えたらコードを全部書き直し」という事態を避けられます。ボット向きの取引所はほぼ対応しています。

```bash
pip install ccxt
```

## ステップ1: 価格を取得する(APIキー不要)

まずは公開データの取得から。これはAPIキーなしで動きます。

```python
import ccxt

exchange = ccxt.mexc()  # 取引所名を変えれば他の取引所でも同じ

# 現在価格
ticker = exchange.fetch_ticker('BTC/USDT')
print(f"BTC価格: {ticker['last']} USDT")

# ローソク足 (15分足を100本)
ohlcv = exchange.fetch_ohlcv('BTC/USDT', timeframe='15m', limit=100)
for ts, o, h, l, c, v in ohlcv[-3:]:
    print(f"open={o} high={h} low={l} close={c}")
```

`fetch_ohlcv` で取れるローソク足データが、戦略開発とバックテストの材料になります。

## ステップ2: 残高を確認する(APIキー必要)

ここからはAPIキーが必要です。キーの安全な扱いは[APIキー管理の記事](/blog/api-key-security/)を必ず読んでください。

```python
import os
import ccxt
from dotenv import load_dotenv

load_dotenv()

exchange = ccxt.mexc({
    'apiKey': os.getenv('API_KEY'),
    'secret': os.getenv('API_SECRET'),
})

balance = exchange.fetch_balance()
print(f"USDT残高: {balance['USDT']['free']}")
```

## ステップ3: 注文を出す

```python
# 指値買い注文の例 (数量・価格は取引所の最小単位に注意)
order = exchange.create_limit_buy_order(
    symbol='BTC/USDT',
    amount=0.0001,      # BTC数量
    price=100000,       # 指値価格
)
print(order['id'])
```

**最初は必ず、失っても痛くない最小サイズで試してください。**多くの初心者事故は「数量の単位を勘違いして桁違いの注文を出す」パターンです。取引所ごとに最小注文量や数量の単位(先物なら1枚(コントラクト)あたりのBTC量など)が違うので、`exchange.load_markets()` で仕様を確認する癖をつけましょう。

## 実運用者からの3つの注意

### 1. APIのレスポンスを信じすぎない

実運用で学んだ最重要ポイントです。取引所のAPIは、注文直後の照会で「注文が存在しない」と返してくることがあります(内部反映の遅延)。**「見えない=存在しない」ではありません**。注文状態の判定は、時間を置いたリトライや、ポジション照会など複数の情報源との突き合わせで行う必要があります。

### 2. レートリミットに注意

短時間にAPIを呼びすぎると一時的に拒否されます。連続で注文を出すときは0.5秒程度の間隔を空ける、`enableRateLimit` オプションを使うなどの対策をしましょう。

### 3. エラー処理がボットの品質を決める

ハッピーパス(うまくいく流れ)だけなら誰でも書けます。実際のボット運用は、通信エラー・約定遅延・API不整合との戦いです。私のボットのコードも、体感では**半分以上がエラー処理と状態復旧のコード**です。

## 次のステップ

1. ccxtでデータ取得 → まずはここから
2. 戦略を書いてバックテスト → [バックテストの罠](/blog/backtest-pitfalls/)を必ず読む
3. 最小サイズで実運用 → [VPSで24時間稼働](/blog/vps-bot-24h/)
4. 監視を整える → [Discord通知の作り方](/blog/discord-notification-bot/)

<!-- ここに取引所のアフィリエイトリンクを設置可 -->
