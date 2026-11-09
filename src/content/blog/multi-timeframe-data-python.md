---
title: '複数時間足(MTF)をPythonで扱う|1本のボットで時間軸を組み合わせる基本'
description: '自動売買ボットで複数の時間足を同時に扱うと、取得・整合・判断のタイミングで落とし穴にはまりがちです。マルチタイムフレーム(MTF)のデータ構造と、確定足だけを使う考え方をコード付きで整理します。'
pubDate: '2026-11-09'
heroImage: '../../assets/eyecatch/multi-timeframe-data-python.png'
category: 'development'
---

「1時間足で大きな流れを見て、5分足でエントリーのタイミングを取る」というように、複数の時間足を組み合わせたいと考えるのは自然な発想です。ところが実装してみると、時間足ごとにデータの更新タイミングが違うため「今見ている5分足は確定しているのに、1時間足はまだ確定していない」といったズレに気づきにくい形でハマることがあります。この記事では、複数時間足(マルチタイムフレーム、MTF)のデータをPythonで扱う際の基本的な考え方を整理します。

## なぜ複数時間足を組み合わせたくなるのか

単一の時間足だけでロジックを組むと、次のようなジレンマが起きやすくなります。

- 短い時間足だけで判断すると、大きな下落トレンドの中で何度も逆張りシグナルが出てしまう
- 長い時間足だけで判断すると、エントリーのタイミングが粗く、不利な価格で約定しやすい

そこで「上位足でトレンドの方向を絞り込み、下位足でタイミングを取る」という発想が出てきます。これはテクニカル分析の世界で古くから言われる考え方で、特定の戦略に限った話ではありません。移動平均クロスやRSIなど、[テクニカル指標をPythonで計算する方法](/blog/python-technical-indicators/)で扱った指標も、どの時間足で計算するかによって意味合いが変わってきます。

## 複数時間足データの取得と整合

複数の時間足を扱う最初のハードルは、データの取得と時刻の整合です。ccxtの基本的な使い方は[Python+ccxt入門](/blog/ccxt-python-tutorial/)を参照してください。

```python
import ccxt
import pandas as pd

exchange = ccxt.mexc()

def fetch_df(symbol, timeframe, limit=300):
    raw = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    df = pd.DataFrame(raw, columns=['ts', 'open', 'high', 'low', 'close', 'volume'])
    df['ts'] = pd.to_datetime(df['ts'], unit='ms', utc=True)
    return df.set_index('ts').sort_index()

df_1h = fetch_df('BTC/USDT', '1h')
df_5m = fetch_df('BTC/USDT', '5m')
```

ここまでは単一時間足の取得と同じですが、MTFでは「1時間足の1本と、5分足の12本がどう対応しているか」を意識する必要があります。取得・前処理の基本(タイムスタンプの単位・欠損の扱いなど)は[pandasでOHLCVデータを扱う基本](/blog/pandas-ohlcv-basics/)にまとめているので、まず単一時間足の扱いに慣れていない場合はそちらを先に確認しておくとつまずきにくくなります。

上位足を自分で用意する代わりに、下位足から`resample`で生成する方法もあります。

```python
df_1h_from_5m = (
    df_5m.resample('1h')
    .agg({'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'})
    .dropna()
)
```

取引所から直接取得した1時間足と、5分足から合成した1時間足は、取引所側の集計タイミングのずれによって完全には一致しないことがあります。どちらを「正」とするかはロジックの中で統一しておくべきポイントです。

## 最大の落とし穴: 未確定足を見てしまう

MTFで最も実害が大きいのが、**まだ終わっていない時間足(未確定足)の値を判断に使ってしまう**ことです。

例えば1時間足の途中(45分経過時点)で`fetch_ohlcv`を呼ぶと、最新の1本は「その時点までの途中経過」を表す値が返ってきます。これを「1時間足が確定した」として扱うと、本来確定後に出るはずのシグナルが早いタイミングで(しかも不正確な値で)発生してしまいます。

対策として、**最後の1本を評価対象から外す**、または**時間足の境界を過ぎたことを確認してから評価する**、という考え方が基本になります。

```python
def latest_closed_bar(df, timeframe_minutes):
    now = pd.Timestamp.utcnow()
    # 現在の時間足の開始時刻より前のものだけを「確定済み」とみなす
    boundary = now.floor(f'{timeframe_minutes}min')
    closed = df[df.index < boundary]
    return closed.iloc[-1] if len(closed) else None

last_1h = latest_closed_bar(df_1h, 60)
```

この判定は取引所のメンテナンスやAPIの遅延によっても影響を受けます。シンプルに「末尾の1本を常に除外する」という保守的な実装のほうが、現在時刻とのズレに依存しないため事故が少なくなる場合もあります。どちらを選ぶかは、ロジックがどれだけ最新の値を必要とするかで判断してください。

## 上位足と下位足を組み合わせたシグナルの例

考え方を示すための一般的な実装例です。1時間足のトレンド方向に沿った場合のみ、5分足のタイミングシグナルを有効にする、という単純なフィルターです。

```python
def higher_tf_trend(df_1h, period=50):
    sma = df_1h['close'].rolling(period).mean()
    return 'up' if df_1h['close'].iloc[-1] > sma.iloc[-1] else 'down'

def lower_tf_signal(df_5m, fast=10, slow=30):
    fast_ma = df_5m['close'].rolling(fast).mean()
    slow_ma = df_5m['close'].rolling(slow).mean()
    if fast_ma.iloc[-1] > slow_ma.iloc[-1] and fast_ma.iloc[-2] <= slow_ma.iloc[-2]:
        return 'buy'
    return None

trend = higher_tf_trend(df_1h)
signal = lower_tf_signal(df_5m)

if trend == 'up' and signal == 'buy':
    print('上位足が上昇方向で、下位足にゴールデンクロスが発生')
```

このようなフィルターがバックテスト上の成績を実際に改善するかどうかは、対象の通貨ペアや期間によって結果が変わります。「複数時間足にすれば精度が上がる」と決まっているわけではなく、検証して初めて分かる話です。バックテストの進め方や注意点は[バックテストで学んだ3つの罠](/blog/backtest-pitfalls/)や[ウォークフォワード検証とは?](/blog/walkforward-backtest/)で詳しく扱っています。

## 実装上の注意点まとめ

| 注意点 | 内容 |
| --- | --- |
| 未確定足 | 時間足が終わるまでの途中経過の値を確定値として使わない |
| 取得タイミングのズレ | 上位足と下位足を別々に取得すると、更新時刻が微妙にズレる |
| resample vs 直接取得 | 下位足から合成した上位足と、取引所から直接取得した上位足は一致しない場合がある |
| バックテストと本番の差 | バックテストでは全データが揃っているため未確定足の問題に気づきにくい。本番運用で初めて発覚することが多い |

特に最後の点は見落としがちです。過去データを使ったバックテストでは「今何時何分か」という概念がないため、未確定足の扱いを誤っていても結果に表れないことがあります。複数時間足のロジックを検証する際は、本番と同じ条件(現在時刻を基準にした確定足の判定)でバックテストを組むことを意識してください。

<div class="affiliate-box">
<span class="label">PR</span>
<p>複数時間足のデータ取得・検証を行う開発環境として、ConoHa VPSのようなサーバーでバックテスト用のスクリプトを動かしておくと、ローカルPCを閉じても処理が継続します。</p>
<p><a href="https://px.a8.net/svt/ejp?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" rel="nofollow">サービス開発やテスト環境に便利な【ConoHa】</a>
<img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" alt=""></p>
</div>

## まとめ

- 複数時間足(MTF)は「上位足でトレンドを絞り、下位足でタイミングを取る」という発想から生まれる
- 上位足と下位足を別々に取得すると、更新タイミングのズレや値の不一致が起きうる
- 最大の落とし穴は、まだ確定していない時間足の値を判断に使ってしまうこと
- 確定済みの足だけを評価対象にするロジックを明示的に組み込む
- バックテストでは未確定足の問題が表面化しにくいため、本番同様の条件で検証することが重要

複数時間足を扱うロジックは便利ですが、取得・整合・確定判定という実装上の手間が単一時間足より確実に増えます。まずは単一時間足のロジックを安定させた上で、必要性を感じたタイミングで段階的に導入するのが無難です。
