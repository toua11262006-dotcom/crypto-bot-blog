---
title: 'asyncioでボットを非同期化する?複数銘柄を同時監視する基本'
description: '複数銘柄を順番にAPI取得していると、銘柄数が増えるほどループが遅くなります。Pythonのasyncioとccxtの非同期対応を使って、複数銘柄を並行処理する設計の考え方をコード付きで解説します。'
pubDate: '2026-10-21'
heroImage: '../../assets/eyecatch/asyncio-multi-symbol-bot.png'
category: 'development'
---

自動売買ボットで監視銘柄を1つから複数に増やしたとき、「for文で銘柄を順番にループしているだけなのに、なぜか1周にかかる時間が目に見えて伸びた」と感じたことはないでしょうか。これは多くの場合、API呼び出しの「待ち時間」が銘柄数だけ積み重なっていることが原因です。この記事では、Pythonの`asyncio`を使って複数銘柄の処理を並行化する基本的な考え方を解説します。

## なぜ複数銘柄のループは遅くなるのか

一般的な同期処理のボットは、次のような流れで銘柄を順番に処理します。

```python
import ccxt

exchange = ccxt.mexc()
symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT']

for symbol in symbols:
    ticker = exchange.fetch_ticker(symbol)
    print(symbol, ticker['last'])
```

このコードの問題は、`fetch_ticker`を呼び出すたびに**取引所からの応答が返ってくるまでプログラム全体が止まっている**ことです。1回の呼び出しに200ミリ秒かかるなら、銘柄数が4つなら単純計算で800ミリ秒、20銘柄なら4秒かかります。計算処理自体は一瞬で終わるのに、待ち時間のほとんどは「ネットワークの往復を待っているだけ」の時間です。

[APIのレートリミット設計の記事](/blog/api-rate-limit-design/)でも触れていますが、取引所APIには呼び出し回数の上限があります。銘柄数が増えるほど、この「待ち時間の積み重ね」と「レートリミットとの兼ね合い」の両方を意識した設計が必要になってきます。

## 同期と非同期の違いを整理する

ここで言う「非同期処理」とは、ある銘柄のAPI応答を待っている間に、CPUを遊ばせず別の銘柄のリクエストを先に投げてしまう、という考え方です。イメージとしては次のようになります。

| 方式 | 動き方 | 4銘柄・1回200msの場合 |
| --- | --- | --- |
| 同期(順番に処理) | 1つ終わってから次を呼ぶ | 合計 約800ms |
| 非同期(並行処理) | 複数の待ち時間を重ね合わせる | 合計 約200〜300ms程度 |

非同期処理は「CPUの計算を速くする」仕組みではなく、「待ち時間を無駄にしない」仕組みです。API呼び出しのようにネットワーク待ちが支配的な処理と相性が良い一方、重い計算処理(機械学習の推論など)を速くする目的には向きません。[テクニカル指標の計算](/blog/python-technical-indicators/)のような純粋な計算処理は、非同期化してもあまり恩恵がない点は覚えておくとよいでしょう。

## ccxtの非同期対応(ccxt.async_support)を使う

ccxtには`asyncio`に対応した非同期版のモジュールが用意されています。使い方の基本は、通常の`ccxt`ではなく`ccxt.async_support`からインポートし、関数の前に`async`を、呼び出しの前に`await`を付ける形です。[ccxt入門の記事](/blog/ccxt-python-tutorial/)で解説した基本の呼び出し方と比べながら読むと分かりやすいと思います。

```python
import asyncio
import ccxt.async_support as ccxt

async def fetch_one(exchange, symbol):
    ticker = await exchange.fetch_ticker(symbol)
    return symbol, ticker['last']

async def main():
    exchange = ccxt.mexc()
    symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT']

    tasks = [fetch_one(exchange, s) for s in symbols]
    results = await asyncio.gather(*tasks)

    for symbol, price in results:
        print(symbol, price)

    await exchange.close()  # 非同期セッションは明示的にクローズする

asyncio.run(main())
```

ポイントは次の3つです。

- `asyncio.gather()`で複数の非同期タスクをまとめて実行し、すべての完了を待つ
- 非同期の取引所インスタンスは使い終わったら`close()`でセッションを閉じる(閉じ忘れると警告が出たり、コネクションが残り続けたりします)
- 1つの銘柄でエラーが起きても他の銘柄の処理が止まらないよう、`fetch_one`内で例外処理を入れておくと安全です(ccxtの具体的なエラー種別は[ccxtのエラー対処法の記事](/blog/ccxt-common-errors/)を参照してください)

## 並行数を無制限にしないための制御

銘柄数が多くなると、「全銘柄を一度に`gather`する」だけではレートリミットに引っかかりやすくなります。そこで`asyncio.Semaphore`を使い、同時に実行するリクエスト数の上限を設ける方法が一般的です。

```python
async def fetch_with_limit(exchange, symbol, semaphore):
    async with semaphore:
        ticker = await exchange.fetch_ticker(symbol)
        return symbol, ticker['last']

async def main():
    exchange = ccxt.mexc()
    symbols = [...]  # 多数の銘柄
    semaphore = asyncio.Semaphore(5)  # 同時に実行するのは最大5件まで

    tasks = [fetch_with_limit(exchange, s, semaphore) for s in symbols]
    results = await asyncio.gather(*tasks)
    await exchange.close()
```

この`Semaphore`の値(いくつまで並行実行を許すか)は、取引所のレートリミット仕様に合わせて調整する必要があります。値を大きくしすぎると、かえってレートリミットエラーが頻発し、結果的にリトライ処理のオーバーヘッドで遅くなることもあります。

## WebSocketという選択肢との使い分け

「複数銘柄をリアルタイムに監視したい」という目的であれば、そもそもREST APIをポーリングするのではなく、[WebSocket APIの記事](/blog/websocket-realtime-bot/)で解説したプッシュ型の購読方式のほうが適している場合もあります。大まかな使い分けの目安は次の通りです。

- **数秒〜数十秒おきの定期チェックで十分な処理**(残高確認、注文状況の確認など) → asyncioでの並行ポーリングが扱いやすい
- **価格変動にミリ秒〜秒単位で反応したい処理** → WebSocketでの購読のほうが遅延が少なく、API呼び出し回数も抑えられる

銘柄数が少ないうちは同期処理のままでも問題になりにくく、監視銘柄が増えてきたタイミングで非同期化を検討する、という順番で十分です。最初から複雑な非同期設計にする必要はありません。

## 非同期化で注意したい落とし穴

- **デバッグが難しくなる**: 処理の順序が実行のたびに前後するため、同期処理のときと同じ感覚でログを追うと混乱しやすくなります。[ログ設計の記事](/blog/bot-log-design/)で触れている「どの処理がどの銘柄のものか識別できるログ」が非同期化後はより重要になります
- **状態の共有に注意する**: 複数のタスクが同じ変数(保有ポジション情報など)を同時に読み書きすると、意図しない上書きが起きることがあります。銘柄ごとに状態を分離して持つ設計が基本です
- **例外の握りつぶしに気づきにくい**: `asyncio.gather()`はデフォルトで1つのタスクが例外を出すと他のタスクの結果も分かりにくくなります。`return_exceptions=True`を使うか、タスクごとに例外処理を入れることをおすすめします

非同期処理は便利な一方、同期処理に比べてコードの見通しが悪くなりやすい側面もあります。[よくある失敗10選の記事](/blog/bot-common-mistakes/)でも触れているとおり、必要性が明確になってから段階的に導入するのが無難です。

## まとめ

- 複数銘柄の処理が遅い主な原因は、API応答を待つ間プログラム全体が止まる「同期処理」の積み重ねであることが多い
- `asyncio`と`ccxt.async_support`を使うと、待ち時間を重ね合わせて複数銘柄を並行処理できる
- `asyncio.gather()`で複数タスクをまとめ、`Semaphore`で同時実行数を制限するのが基本パターン
- リアルタイム性が求められる場合はポーリングではなくWebSocketの購読方式も検討する
- 非同期化はデバッグや状態管理が複雑になりやすいため、必要になってから段階的に導入するのが安全

銘柄数が少ないうちに無理に非同期化する必要はありませんが、仕組みを知っておけば「監視銘柄を増やしたらループが遅くなった」という場面で選べる手段が増えます。まずは小さな規模で`asyncio.gather()`を試し、挙動に慣れてから本番のボットに組み込んでいくとよいでしょう。
