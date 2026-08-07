---
title: 'pandasでOHLCVデータを扱う基本|リサンプリング・欠損値処理まとめ'
description: 'ccxtで取得したOHLCVデータをpandasのDataFrameとして正しく扱う方法を解説。タイムスタンプの変換、時間足のリサンプリング、欠損足の穴埋め、複数シンボルの管理まで、コード付きでまとめました。'
pubDate: '2026-08-07'
heroImage: '../../assets/eyecatch/pandas-ohlcv-basics.png'
---

自動売買ボットを作っていると、ローソク足(OHLCV)データをpandasのDataFrameに変換してから指標計算やバックテストに使う場面が何度も出てきます。ところが「タイムスタンプの単位を間違えて時刻がズレる」「時間足を変換したら値がおかしい」「欠損した足のせいで指標計算が崩れる」といった、地味だけど気づきにくいトラブルにハマりがちです。この記事では、OHLCVデータをpandasで扱うときの基本パターンを整理します。

## OHLCVデータをDataFrameに変換する

まずはccxtで取得した生データをDataFrameにする基本形です。ccxtの使い方自体は[Python+ccxt入門](/blog/ccxt-python-tutorial/)や[ccxtの使い方まとめ](/blog/ccxt-cheatsheet/)を参照してください。

```python
import ccxt
import pandas as pd

exchange = ccxt.mexc()
raw = exchange.fetch_ohlcv('BTC/USDT', timeframe='1h', limit=300)
# raw の各要素: [タイムスタンプms, 始値, 高値, 安値, 終値, 出来高]

df = pd.DataFrame(raw, columns=['ts', 'open', 'high', 'low', 'close', 'volume'])
df['ts'] = pd.to_datetime(df['ts'], unit='ms', utc=True)
df = df.set_index('ts').sort_index()
```

ポイントは2つあります。1つは `unit='ms'` です。ccxtが返すタイムスタンプはミリ秒単位ですが、取引所やAPIによっては秒単位のこともあるため、変換結果の日時が明らかにおかしいときはまず単位を疑ってください。もう1つは `utc=True` です。タイムゾーンを指定せずに扱うと、複数のデータソースを突き合わせたときに時刻がずれる原因になります。表示だけ日本時間にしたい場合は `df.index.tz_convert('Asia/Tokyo')` で変換します。

`sort_index()` も忘れず付けておくと安全です。`since` を使って複数回に分けて取得したデータを結合する際、順序が崩れていたり重複行が混ざっていたりすることがあるためです。重複除去は `df = df[~df.index.duplicated(keep='last')]` で行えます。

## 時間足を変換する(リサンプリング)

1分足のデータから15分足や1時間足を作りたいとき、取引所に毎回リクエストし直さなくても `resample` で変換できます。

```python
ohlc_dict = {
    'open': 'first',
    'high': 'max',
    'low': 'min',
    'close': 'last',
    'volume': 'sum',
}

df_15m = df.resample('15min').agg(ohlc_dict).dropna()
```

始値はその期間で最初の値、高値・安値は最大・最小、終値は最後の値、出来高は合計、という対応関係になっています。ここを `mean()` などで済ませてしまうと、OHLCVとして意味を持たない値になってしまうので注意してください。

`resample` は元データの粒度より**細かい**足を作ることはできません。1時間足のデータから15分足を復元することはできないため、必要になりそうな最小の時間足で最初から取得しておくのが安全です。

## 欠損している足を見つける・埋める

取引所側の障害やAPIの取得漏れで、本来あるはずの足が歯抜けになることがあります。指標計算やバックテストの前に、欠損の有無を確認する習慣をつけておくと安心です。

```python
# 本来あるべき等間隔のインデックスを作る
full_index = pd.date_range(df.index[0], df.index[-1], freq='1h')

missing = full_index.difference(df.index)
print(f'欠損している足: {len(missing)}本')

# 欠損分を NaN で補ってから前方埋めする(出来高は0埋めが妥当)
df_filled = df.reindex(full_index)
df_filled[['open', 'high', 'low', 'close']] = df_filled[['open', 'high', 'low', 'close']].ffill()
df_filled['volume'] = df_filled['volume'].fillna(0)
```

前方埋め(`ffill`)は「その間、価格が動かなかった」とみなす近似です。指標計算上は都合が良い一方、実際の値動きを表しているわけではないため、欠損が多い区間をそのままバックテストに使うと結果の信頼性が下がります。欠損率が高いデータは、期間を区切って除外することも検討してください。バックテスト全般の注意点は[バックテストで学んだ3つの罠](/blog/backtest-pitfalls/)にまとめています。

## 複数シンボルのデータをまとめて扱う

複数の通貨ペアを同時に監視するボットでは、シンボルごとのDataFrameを辞書で管理するとシンプルです。

```python
symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']
data = {}

for symbol in symbols:
    raw = exchange.fetch_ohlcv(symbol, timeframe='1h', limit=300)
    d = pd.DataFrame(raw, columns=['ts', 'open', 'high', 'low', 'close', 'volume'])
    d['ts'] = pd.to_datetime(d['ts'], unit='ms', utc=True)
    data[symbol] = d.set_index('ts').sort_index()

# 例: 各シンボルの終値だけを1つの表にまとめる
closes = pd.DataFrame({s: d['close'] for s, d in data.items()})
```

`closes` のようにシンボルを列、時刻を行にした表にしておくと、通貨ペア間の相関を見たり、複数銘柄を横断した特徴量を作ったりする際に扱いやすくなります。テクニカル指標を列として追加していく方法は[テクニカル指標をPythonで計算する方法](/blog/python-technical-indicators/)で解説しています。

## CSVへの保存と読み込み

取得のたびにAPIを叩くのは非効率なので、一度取得したデータはCSVやparquetに保存しておくと、バックテストの試行錯誤が速くなります。

```python
df.to_csv('btc_1h.csv')

# 読み込み時は index_col と parse_dates を忘れずに
df = pd.read_csv('btc_1h.csv', index_col='ts', parse_dates=['ts'])
```

`read_csv` はデフォルトでは日時をただの文字列として読み込みます。`parse_dates` を指定し忘れると、`resample` や日時での絞り込みが動かずにハマるので注意してください。大量データを繰り返し読み書きする場合は、CSVよりも高速で型情報も保持される `to_parquet` / `read_parquet`(`pyarrow` が必要)がおすすめです。

## よくあるハマりどころ

| 症状 | 原因 |
| --- | --- |
| 日時が1970年代になる | タイムスタンプの単位(ms/s)を取り違えている |
| resample後の値がおかしい | `agg` の対応(open=first, high=max...)を使わず mean() 等で済ませている |
| 指標がところどころ NaN になる | 欠損足があり `rolling` の窓に十分なデータが入っていない |
| CSV読み込み後にresampleできない | `parse_dates` を指定せず日時が文字列のまま |
| 複数回取得したデータがおかしい | ソートや重複除去をせず結合している |

## まとめ

- タイムスタンプは単位(ms/s)とタイムゾーンを明示して変換する
- 時間足の変換は `resample().agg()` を使い、OHLCVそれぞれに正しい集約方法を対応させる
- 欠損足は `reindex` で検出し、埋めるか除外するかを判断する
- 複数シンボルは辞書やシンボルを列にしたDataFrameで管理すると扱いやすい
- 保存・読み込みでは `parse_dates` や型情報の保持を忘れない

ここで整理した前処理は、指標計算([テクニカル指標をPythonで計算する方法](/blog/python-technical-indicators/))やウォークフォワード検証([ウォークフォワード検証とは?](/blog/walkforward-backtest/))の土台になります。データの取得方法自体でつまずいている場合は[ccxtの使い方まとめ](/blog/ccxt-cheatsheet/)もあわせてご覧ください。

<div class="affiliate-box">
<span class="label">PR</span>
<p>本記事のサンプルコードは <strong>MEXC</strong> のAPIから取得したOHLCVデータを想定しています。ccxt対応で、公開データの取得だけならAPIキーは不要です。</p>
<p><a href="https://promote.mexc.com/r/ZREtHSpY5h" target="_blank" rel="nofollow sponsored">MEXCの口座を無料で開設する(紹介リンク)</a></p>
</div>
