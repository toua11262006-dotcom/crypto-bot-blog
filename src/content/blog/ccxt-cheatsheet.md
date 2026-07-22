---
title: 'ccxtの使い方まとめ|主要メソッド早見表【Python仮想通貨ボット開発】'
description: 'Pythonの仮想通貨取引所ライブラリccxtの主要メソッドを実例コード付きで一覧化。価格取得・ローソク足・残高・注文・キャンセル・ポジション照会・エラー処理まで、実運用ボット開発者の早見表です。'
pubDate: '2026-07-11'
heroImage: '../../assets/eyecatch/ccxt-cheatsheet.png'
---

自作ボットの開発中、「ccxtでアレどう書くんだっけ?」と調べ直すことが何度もあります。この記事は、実運用ボットをccxtで組んでいる筆者が「これだけ覚えれば大体作れる」という**主要メソッドの早見表**としてまとめたものです。

ccxt自体が初めての方は、先に[Python+ccxt入門](/blog/ccxt-python-tutorial/)を読むのがおすすめです。

## 準備: 取引所インスタンスの作り方

```python
import ccxt

# 公開データだけならキー不要
exchange = ccxt.mexc()

# 取引するならAPIキーを渡す(キーは環境変数から読む)
import os
exchange = ccxt.mexc({
    'apiKey': os.getenv('API_KEY'),
    'secret': os.getenv('API_SECRET'),
    'enableRateLimit': True,  # レートリミット自動調整。基本ONにする
})

# 先物(無期限スワップ)を使う場合はデフォルト市場を指定
exchange.options['defaultType'] = 'swap'
```

`enableRateLimit: True` は必ず付けましょう。API呼び出しの間隔をccxtが自動調整してくれるので、呼びすぎによる一時BANをほぼ防げます。

## 相場データの取得(APIキー不要)

### 現在価格: fetch_ticker

```python
ticker = exchange.fetch_ticker('BTC/USDT')
print(ticker['last'])   # 最終約定価格
print(ticker['bid'])    # 買い気配
print(ticker['ask'])    # 売り気配
```

### ローソク足: fetch_ohlcv

```python
# 15分足を200本
ohlcv = exchange.fetch_ohlcv('BTC/USDT', timeframe='15m', limit=200)
# 各要素: [タイムスタンプms, 始値, 高値, 安値, 終値, 出来高]

# 欠損なく継続取得したいときは since を指定する
last_ts = ohlcv[-1][0]
newer = exchange.fetch_ohlcv('BTC/USDT', '15m', since=last_ts + 1)
```

**実運用の教訓**: 「最新の2本だけ取る」ような設計だと、処理が遅れたときにローソク足が永久に欠損します。`since` を指定して「前回の続きから全部取る」形にしておくと、遅延があっても自動で穴埋めされます。

### 板情報: fetch_order_book

```python
book = exchange.fetch_order_book('BTC/USDT', limit=10)
best_bid = book['bids'][0][0]  # 最良買い気配
best_ask = book['asks'][0][0]  # 最良売り気配
```

## 口座情報(APIキー必要)

### 残高: fetch_balance

```python
balance = exchange.fetch_balance()
print(balance['USDT']['free'])   # 使える残高
print(balance['USDT']['used'])   # 注文・ポジションで拘束中
print(balance['USDT']['total'])  # 合計
```

**注意**: 先物口座では `free` はポジション証拠金や未約定注文の分だけ小さく出ます。「残高が減った!」と慌てる前に `used` を確認してください。

### ポジション: fetch_positions(先物)

```python
positions = exchange.fetch_positions(['BTC/USDT:USDT'])
for p in positions:
    print(p['side'], p['contracts'], p['entryPrice'], p['unrealizedPnl'])
```

## 注文まわり

### 発注: create_order 系

```python
# 指値買い
order = exchange.create_limit_buy_order('BTC/USDT', amount=0.0001, price=100000)

# 指値売り
order = exchange.create_limit_sell_order('BTC/USDT', amount=0.0001, price=120000)

# 成行買い
order = exchange.create_market_buy_order('BTC/USDT', amount=0.0001)

order_id = order['id']  # 後で照会・キャンセルに使う
```

数量の単位は取引所と市場(現物/先物)で違います。先物は「枚(コントラクト)」単位のことが多いので、`exchange.load_markets()` で `contractSize` を必ず確認してください。

### 注文の照会・キャンセル

```python
# 未約定注文の一覧
open_orders = exchange.fetch_open_orders('BTC/USDT')

# 特定の注文の状態
order = exchange.fetch_order(order_id, 'BTC/USDT')
print(order['status'])  # open / closed / canceled

# キャンセル
exchange.cancel_order(order_id, 'BTC/USDT')
```

### 約定履歴: fetch_my_trades

```python
trades = exchange.fetch_my_trades('BTC/USDT', limit=20)
for t in trades:
    print(t['datetime'], t['side'], t['price'], t['amount'], t['fee'])
```

確定申告用の記録としても重要です([損益計算の記事](/blog/crypto-bot-tax-guide/)参照)。定期的に取得して保存しておきましょう。

## エラー処理の基本形

ccxtは例外クラスが整理されているので、種類ごとに対処を分けられます。

```python
import time

try:
    order = exchange.create_limit_buy_order('BTC/USDT', 0.0001, 100000)
except ccxt.InsufficientFunds:
    print('残高不足。ポジションや未約定注文で証拠金が拘束されていないか確認')
except ccxt.RateLimitExceeded:
    time.sleep(1.0)  # 少し待ってリトライ
except ccxt.NetworkError as e:
    print(f'通信エラー(タイムアウト等)。リトライ推奨: {e}')
except ccxt.ExchangeError as e:
    print(f'取引所側のエラー。内容を確認: {e}')
```

**実運用の教訓を2つ:**

- **「残高不足」エラーは手がかり**です。身に覚えがないのに出たら、認識できていないポジションや注文が証拠金を拘束しているサイン。`fetch_positions` で実態を確認しましょう
- **注文直後の照会は信じすぎない**こと。出したばかりの注文が `fetch_open_orders` に見えないことがあります(取引所内部の反映遅延)。「見えない=存在しない」と即断せず、時間を置いた再照会やポジション照会と突き合わせるのが安全です

## よく使うメソッド一覧表

| やりたいこと | メソッド | キー |
| --- | --- | --- |
| 現在価格 | `fetch_ticker(symbol)` | 不要 |
| ローソク足 | `fetch_ohlcv(symbol, timeframe, since, limit)` | 不要 |
| 板情報 | `fetch_order_book(symbol)` | 不要 |
| 残高 | `fetch_balance()` | 必要 |
| ポジション | `fetch_positions([symbol])` | 必要 |
| 指値注文 | `create_limit_buy_order / create_limit_sell_order` | 必要 |
| 成行注文 | `create_market_buy_order / create_market_sell_order` | 必要 |
| 未約定一覧 | `fetch_open_orders(symbol)` | 必要 |
| 注文照会 | `fetch_order(id, symbol)` | 必要 |
| キャンセル | `cancel_order(id, symbol)` | 必要 |
| 約定履歴 | `fetch_my_trades(symbol)` | 必要 |
| 市場仕様 | `load_markets()` | 不要 |

## まとめ

- インスタンス作成時は `enableRateLimit: True` を必ず付ける
- ローソク足の継続取得は `since` 指定で欠損を防ぐ
- 数量単位は `load_markets()` で確認してから発注する
- エラーは種類ごとに対処。特に「残高不足」と「注文が見えない」は状態確認のサイン

実際に遭遇するエラーの原因と対処は[ccxtのよくあるエラーと対処法](/blog/ccxt-common-errors/)にまとめました。APIキーの発行と安全管理は[こちらの記事](/blog/api-key-security/)、ボット全体の組み方は[Python+ccxt入門](/blog/ccxt-python-tutorial/)でどうぞ。

<div class="affiliate-box">
<span class="label">PR</span>
<p>筆者がccxtで実際にボットを動かしている取引所は <strong>MEXC</strong> です(ccxt対応・低手数料・小ロット対応)。<a href="/blog/mexc-api-bot-guide/">MEXCでのAPI取引の始め方</a>も記事にしています。</p>
<p><a href="https://promote.mexc.com/r/ZREtHSpY5h" target="_blank" rel="nofollow sponsored">MEXCの口座を無料で開設する(紹介リンク)</a></p>
</div>
