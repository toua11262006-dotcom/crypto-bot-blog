---
title: 'テクニカル指標をPythonで計算する方法|移動平均・RSI・ATR・ボリンジャーバンド'
description: '移動平均・RSI・ATR・ボリンジャーバンドなど、自作ボットでよく使うテクニカル指標をPythonのpandasだけで計算する方法をコード付きで解説します。仕組みの理解にも役立ちます。'
pubDate: '2026-07-29'
heroImage: '../../assets/eyecatch/python-technical-indicators.png'
---

自作ボットでエントリー条件を作るとき、TradingViewの指標をそのまま使いたくても、Pythonのコードに落とし込む必要があります。ライブラリに頼ると「結局中で何を計算しているのか分からない」まま使うことになりがちです。この記事では、代表的なテクニカル指標を**pandasだけ**で計算する方法を、仕組みの説明とあわせて紹介します。

## 準備: OHLCVデータをDataFrameにする

計算の元になるのはローソク足データです。ccxtで取得し、pandasのDataFrameに変換します。ccxtの基本的な使い方は[Python+ccxt入門](/blog/ccxt-python-tutorial/)、メソッドの早見表は[ccxtの使い方まとめ](/blog/ccxt-cheatsheet/)を参照してください。

```python
import ccxt
import pandas as pd

exchange = ccxt.mexc()
ohlcv = exchange.fetch_ohlcv('BTC/USDT', timeframe='1h', limit=300)

df = pd.DataFrame(ohlcv, columns=['ts', 'open', 'high', 'low', 'close', 'volume'])
df['ts'] = pd.to_datetime(df['ts'], unit='ms')
df = df.set_index('ts')
```

以降の指標は、この `df` の `close`(終値)・`high`(高値)・`low`(安値)列を使って計算していきます。

## 移動平均(SMA・EMA)

もっとも基本的な指標です。単純移動平均(SMA)は指定期間の終値の平均、指数移動平均(EMA)は直近の値により大きな重みを置いた平均です。

```python
# SMA: 単純移動平均
df['sma_20'] = df['close'].rolling(window=20).mean()

# EMA: 指数移動平均(直近の値ほど重視する)
df['ema_20'] = df['close'].ewm(span=20, adjust=False).mean()
```

`rolling` は「直近N本の窓」を作ってから統計量を計算する仕組みで、SMA以外に標準偏差や最大値・最小値を出すときにも使えます。後述のボリンジャーバンドやATRでも登場します。

## RSI(相対力指数)

一定期間の値上がり幅と値下がり幅の比率から、買われすぎ・売られすぎを判断する指標です。一般に70以上で買われすぎ、30以下で売られすぎとされますが、これはあくまで目安であり、トレンドが強い相場では機能しにくいことに注意してください。

```python
def calc_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

df['rsi_14'] = calc_rsi(df['close'], 14)
```

RSIの計算方法には複数の流儀があり、平均の取り方(単純移動平均を使うか、指数移動平均を使うか)によって値がわずかに変わります。TradingViewなど他ツールの数値と厳密に一致しないことがあっても、計算式の違いによるもので、どちらかが間違っているわけではありません。

## ATR(平均真の値幅)

値動きの大きさ(ボラティリティ)を測る指標です。損切り幅やポジションサイズを、値幅に応じて動的に決めたいときによく使われます。資金管理全般については[ボットの資金管理術](/blog/bot-risk-management/)で詳しく解説しています。

```python
def calc_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high_low = df['high'] - df['low']
    high_close = (df['high'] - df['close'].shift()).abs()
    low_close = (df['low'] - df['close'].shift()).abs()

    true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    return true_range.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

df['atr_14'] = calc_atr(df, 14)
```

「真の値幅(True Range)」は単純な高値-安値ではなく、前の足からのギャップも考慮する点がポイントです。窓を開けて急騰・急落した場合にも、その分の値幅がきちんと反映されます。

## ボリンジャーバンド

移動平均を中心に、価格のばらつき(標準偏差)から上下のバンドを引く指標です。バンドの内外どちらに価格があるかより、**バンドの幅自体がボラティリティの目安になる**という使い方もよくされます。

```python
window = 20
n_std = 2

df['bb_mid'] = df['close'].rolling(window).mean()
std = df['close'].rolling(window).std()

df['bb_upper'] = df['bb_mid'] + n_std * std
df['bb_lower'] = df['bb_mid'] - n_std * std
```

バンド幅が急に縮む「スクイーズ」の後は、その後の値動きが大きくなりやすいと一般に言われています。ただし、これも経験則であり、必ずそうなるという保証はありません。

## 指標を使う上で注意したいこと

### 1. 未来のデータを混ぜない(ルックアヘッドバイアス)

`rolling` や `ewm` はその時点までのデータしか使わないため基本的に安全ですが、自分で特徴量を作り込むときに「その足の高値・安値を含めた指標」をエントリー判定に使ってしまうと、実運用では手に入らない情報を使ったことになります。バックテストでは好成績でも実運用で再現しない典型パターンなので、[バックテストで学んだ3つの罠](/blog/backtest-pitfalls/)もあわせて確認しておくと安心です。

### 2. パラメータの最適化をしすぎない

期間を14にするか21にするか、といった調整で過去データへの当てはまりが良くなっても、それが未来の相場でも機能するとは限りません。特定の期間だけ都合よく成績が良いパラメータは、たまたま過去に合っただけの可能性を疑いましょう。

### 3. 指標は「答え」ではなく「材料」

RSIが30を切ったから即買い、のような単一指標だけの判断はダマシに遭いやすいです。複数の指標を組み合わせたり、値動きそのものと照らし合わせたりして使うのが一般的です。指標を機械学習の特徴量として使う方法は[LightGBM入門](/blog/lightgbm-signal-tutorial/)で紹介しています。

## ライブラリを使う選択肢

毎回自分で実装する必要はなく、`pandas-ta` や `ta` といったライブラリを使えば同じ指標を数行で計算できます。ただし中身の計算式を知らずに使うと、値が想定と違ったときに原因を切り分けられません。まずは自分で実装して仕組みを理解し、実運用ではライブラリに切り替える、という進め方をおすすめします。

```python
# pandas-ta を使う例(pip install pandas-ta)
import pandas_ta as ta

df['rsi_14_lib'] = ta.rsi(df['close'], length=14)
df['atr_14_lib'] = ta.atr(df['high'], df['low'], df['close'], length=14)
```

## まとめ

- 移動平均(SMA/EMA)は `rolling` / `ewm` で数行で計算できる
- RSIは値上がり幅・値下がり幅の比率、ATRはギャップも含めた値幅、ボリンジャーバンドは標準偏差から算出する
- ライブラリごとに計算式の細部が違うため、数値のズレは異常ではない
- ルックアヘッドバイアスとパラメータの過剰最適化には注意する
- 指標は単体で判断材料にするより、複数組み合わせたり値動きと照らし合わせて使うのが一般的

計算した指標を使ってエントリーロジックを組んだら、必ずバックテストの落とし穴([バックテストで学んだ3つの罠](/blog/backtest-pitfalls/))を踏まえた上で検証し、成績の見方は[ボットの成績指標の読み方](/blog/trading-metrics-guide/)を参考にしてください。

<div class="affiliate-box">
<span class="label">PR</span>
<p>本記事のサンプルコードは、筆者が実際にボットで使っている取引所 <strong>MEXC</strong> のAPIで取得したデータを想定しています。ccxt対応で公開データの取得だけならAPIキーも不要です。</p>
<p><a href="https://promote.mexc.com/r/ZREtHSpY5h" target="_blank" rel="nofollow sponsored">MEXCの口座を無料で開設する(紹介リンク)</a></p>
</div>
