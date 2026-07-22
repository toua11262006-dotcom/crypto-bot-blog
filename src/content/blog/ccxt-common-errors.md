---
title: 'ccxtのよくあるエラーと対処法|実運用で踏んだ落とし穴まとめ'
description: 'ccxtで仮想通貨ボットを開発中に遭遇するエラー(認証エラー・レートリミット・残高不足・注文が見つからない等)の原因と対処法を、実運用者が実体験ベースで解説します。'
pubDate: '2026-07-12'
heroImage: '../../assets/eyecatch/ccxt-common-errors.png'
---

ccxtでボットを組んでいると、必ずエラーにぶつかります。しかも厄介なことに、**エラーメッセージが素直に原因を教えてくれないことが多い**のです。この記事では、筆者が実運用で実際に踏んだエラーと、その原因・対処法をまとめます。

ccxtの基本的な使い方は[Python+ccxt入門](/blog/ccxt-python-tutorial/)、メソッド一覧は[ccxt使い方まとめ](/blog/ccxt-cheatsheet/)をどうぞ。

## エラーの種類を知る

ccxtは例外クラスが階層化されているので、まずこれを押さえると対処が整理できます。

```python
import ccxt

# 大きく2系統
# ccxt.NetworkError  → 通信・一時的な問題。リトライで解決することが多い
#   ├ ccxt.RequestTimeout
#   ├ ccxt.DDoSProtection
#   └ ccxt.RateLimitExceeded
#
# ccxt.ExchangeError → 取引所側が明確に拒否。リトライしても無駄なことが多い
#   ├ ccxt.AuthenticationError
#   ├ ccxt.InsufficientFunds
#   ├ ccxt.InvalidOrder
#   └ ccxt.OrderNotFound
```

**原則: `NetworkError` はリトライしていい。`ExchangeError` は原因を直さないと何度やっても同じ。** この切り分けだけで無駄な再試行を減らせます。

## AuthenticationError — 認証に失敗する

```
ccxt.base.errors.AuthenticationError: mexc {"code":700002,"msg":"Signature for this request is not valid"}
```

### 原因と対処

1. **APIキー/シークレットの間違い** — コピペ時に空白や改行が混入していないか確認。`.env` から読むときは前後の空白を `.strip()` する
2. **IPアドレス制限に引っかかっている** — 取引所側でIPホワイトリストを設定している場合、VPSのIPが登録されているか確認。**自宅で開発 → VPSにデプロイしたら動かない**、はこれが原因の定番です
3. **APIキーの権限不足** — 取引権限をオンにしていないと、価格取得はできても発注で弾かれます
4. **サーバー時刻のズレ** — 署名にタイムスタンプを使うため、時刻が数秒ずれると認証に失敗します。VPSで `timedatectl` を確認し、NTPで同期しておきましょう

APIキーの安全な発行・管理は[こちらの記事](/blog/api-key-security/)で解説しています。

## RateLimitExceeded — 呼びすぎ

```
ccxt.base.errors.RateLimitExceeded: mexc {"code":510,"msg":"Request frequency too fast"}
```

短時間にAPIを叩きすぎると拒否されます。**グリッド戦略のように複数注文を一気に出すときに頻発**します。

### 対処

```python
exchange = ccxt.mexc({
    'apiKey': ...,
    'secret': ...,
    'enableRateLimit': True,  # まずこれを必ずON
})

# 連続発注時は明示的に間隔を空ける
import time
for price in grid_prices:
    place_order(price)
    time.sleep(0.4)  # 0.4〜0.5秒空けると安定する
```

さらに、拒否されたときのリトライも入れておくと堅牢になります。

```python
for attempt in range(3):
    try:
        order = exchange.create_limit_buy_order(symbol, amount, price)
        break
    except ccxt.RateLimitExceeded:
        time.sleep(1.0)
```

**実体験**: 一度に5件の注文をループで投げたら、後半が全部拒否されました。`sleep(0.4)` を入れるだけで解決したので、連続発注では最初から入れておくのが吉です。

## InsufficientFunds — 残高が足りない(はずがない)

```
ccxt.base.errors.InsufficientFunds: mexc {"code":2005,"msg":"Insufficient balance"}
```

残高は十分あるはずなのにこれが出たら、**認識できていないポジションか未約定注文が証拠金を拘束している**可能性が高いです。

### 対処: エラーを「状態の手がかり」として扱う

```python
try:
    order = exchange.create_limit_buy_order(symbol, amount, price)
except ccxt.InsufficientFunds:
    # 本当に残高不足か、拘束されているだけかを確認
    positions = exchange.fetch_positions([symbol])
    open_orders = exchange.fetch_open_orders(symbol)
    print('保有ポジション:', [(p['side'], p['contracts']) for p in positions])
    print('未約定注文:', len(open_orders))
```

**実体験**: 筆者はこのエラーで「ボットが認識していないポジションが存在する」ことに気づきました。エラーを握りつぶさず、**残高不足を見たらポジションを確認する**という処理を入れておくと、異常状態から自動復旧できるようになります。

## OrderNotFound / 注文が「消える」

```
ccxt.base.errors.OrderNotFound: order not found
```

これが一番厄介です。**さっき出したばかりの注文が、照会すると見つからない**ことがあります。

### 原因: 取引所内部の反映遅延(結果整合性)

取引所のAPIは、注文直後の短時間、`fetch_order` や `fetch_open_orders` に反映されていないことがあります。ここで「見つからない = 約定した」または「見つからない = 存在しない」と即断すると、事故になります。

- 「約定した」と誤判定 → 存在しないポジションを前提に動く(幽霊ポジション)
- 「存在しない」と誤判定 → 実在する注文を放置(孤立ポジション)

### 対処: 複数の情報源で突き合わせる

```python
def check_order_filled(exchange, order_id, symbol):
    # 1. まずリトライ (一時的な遅延なら解決する)
    for attempt in range(3):
        try:
            return exchange.fetch_order(order_id, symbol)
        except ccxt.OrderNotFound:
            time.sleep(1.0)
        except ccxt.NetworkError:
            time.sleep(1.0)

    # 2. それでもダメなら「実際のポジション」を正とする
    positions = exchange.fetch_positions([symbol])
    has_position = any(p['contracts'] for p in positions)
    if has_position:
        return {'status': 'closed'}  # 約定していたとみなす
    return None  # 判断保留。次のループで再確認する
```

**鉄則: 注文照会が曖昧なときは、ポジション照会(実際の建玉)を正とする。** 注文一覧は遅延しますが、ポジションは実態そのものだからです。この設計にしてから、幽霊ポジション事故がなくなりました。

## 注文IDの型で一致しない

地味ですが実際にハマった罠です。`create_order` の戻り値の `id` が、取引所によっては単純な文字列ではなく**辞書型やその文字列表現**になっていることがあります。

```python
order = exchange.create_limit_buy_order(symbol, amount, price)
print(type(order['id']), order['id'])
# 期待: <class 'str'> '123456789'
# 実際: dict や "{'orderId': '123456789', 'ts': '...'}" のことも
```

これを保存しておいて、後で `fetch_open_orders` が返す純粋な文字列IDと比較すると、**永久に一致しません**。結果、「注文が消えた」と誤検知し続けるループに陥ります。

### 対処: IDを必ず正規化してから保存・比較する

```python
import re

def normalize_order_id(raw) -> str:
    if isinstance(raw, dict):
        return str(raw.get('orderId') or raw.get('id'))
    s = str(raw)
    m = re.search(r"'orderId':\s*'([^']+)'", s)  # 文字列化されたdict対策
    return m.group(1) if m else s

order_id = normalize_order_id(order['id'])
```

IDを扱う箇所は必ずこの関数を通す、と決めておくと安全です。

## 一時的な取引所エラー(code:600 等)

```
ccxt.base.errors.ExchangeError: mexc {"code":600,"msg":"request failed"}
```

意味の曖昧な汎用エラーが、`fetch_order` / `cancel_order` / `fetch_open_orders` で間欠的に返ることがあります。取引所側の一時的な不安定さが原因で、**同じリクエストを少し後に投げると成功する**ことがほとんどです。

### 対処: 書き込み系は「冪等性」を意識する

特に危険なのが `cancel_order` です。キャンセルが実際には成功しているのにエラーが返ると、「失敗した」と判断して再発注 → **二重発注**という最悪の事故が起きます。

```python
def safe_cancel(exchange, order_id, symbol) -> bool:
    for attempt in range(3):
        try:
            exchange.cancel_order(order_id, symbol)
            return True
        except ccxt.OrderNotFound:
            return True  # 既にキャンセル/約定済み = 目的は達成
        except ccxt.ExchangeError:
            time.sleep(0.5)

    # 最終確認: 本当に残っているか調べる
    open_orders = exchange.fetch_open_orders(symbol)
    still_open = any(normalize_order_id(o['id']) == order_id for o in open_orders)
    return not still_open
```

**キャンセルできたか確信が持てないときは、再発注しない**のが安全です。取引機会を1回逃すより、二重発注のほうがずっと痛い損失になります。

## エラー対処チェックリスト

| エラー | まず疑うこと |
| --- | --- |
| AuthenticationError | IP制限・キーの空白混入・権限・サーバー時刻 |
| RateLimitExceeded | `enableRateLimit` 設定・連続発注の間隔 |
| InsufficientFunds | 認識外のポジション/未約定注文による証拠金拘束 |
| OrderNotFound | 反映遅延。ポジション照会と突き合わせる |
| InvalidOrder | 数量・価格の単位、最小注文量(`load_markets()`で確認) |
| 汎用ExchangeError | 一時的不調。リトライ+冪等性の確保 |

## まとめ

- `NetworkError` はリトライ可、`ExchangeError` は原因を直す — この切り分けが基本
- **エラーは「失敗の通知」ではなく「状態の手がかり」**。特に残高不足は隠れたポジションのサイン
- 注文照会が曖昧なときは、ポジション照会を正とする
- キャンセルの成否が不明なときは再発注しない(二重発注が最悪の事故)

ボット開発の時間の大半は、こうしたエラー処理に費やされます。逆に言えば、ここを丁寧に作れるかどうかが、動き続けるボットとすぐ壊れるボットの分かれ目です。実際に運用が止まっていた失敗談は[こちらの記事](/blog/bot-dormant-bug-story/)に書きました。

<div class="affiliate-box">
<span class="label">PR</span>
<p>筆者がccxtでボットを運用している取引所は <strong>MEXC</strong> です。この記事のエラー例もMEXCでの実体験がベースになっています。<a href="/blog/mexc-api-bot-guide/">MEXCでのAPI取引の始め方</a>もどうぞ。</p>
<p><a href="https://promote.mexc.com/r/ZREtHSpY5h" target="_blank" rel="nofollow sponsored">MEXCの口座を無料で開設する(紹介リンク)</a></p>
</div>
