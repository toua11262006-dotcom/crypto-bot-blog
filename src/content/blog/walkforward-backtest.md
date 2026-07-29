---
title: 'ウォークフォワード検証とは?ccxtのOHLCVで実装する基本の書き方'
description: 'バックテストで良い成績が出ても本番で崩れることがあります。ccxtで取得したOHLCVデータを使い、ルックアヘッドを避けるウォークフォワード検証をPythonで実装する考え方とコード例を解説します。'
pubDate: '2026-07-29'
heroImage: '../../assets/eyecatch/walkforward-backtest.png'
---

「バックテストでは勝てたのに、本番では全然だめだった」という話はよく聞きます。原因の多くは、検証方法そのものに問題があるケースです。[バックテストの罠についての記事](/blog/backtest-pitfalls/)でも触れましたが、今回はその対策の中心となる**ウォークフォワード検証**を、ccxtで取得したOHLCVデータを使って実際にコードで実装する手順を解説します。

## ウォークフォワード検証とは何か

ウォークフォワード検証は、時系列データを「学習期間(train)」と「検証期間(test)」に分割し、それを時間の経過に沿ってスライドさせながら繰り返す検証方法です。

イメージとしては次のような流れになります。

1. 最初の500本のデータでパラメータやモデルを決める
2. その直後の100本で成績を評価する
3. 学習・検証の窓を100本分スライドさせて、また同じことを繰り返す
4. データの終わりまでこれを続け、各foldの結果をまとめて見る

ポイントは、**常に「学習に使っていない未来のデータ」で評価する**ことです。これにより、たまたま特定の期間にフィットしただけの戦略を見抜きやすくなります。

## なぜ単純なtrain/test分割では不十分なのか

データ全体を1回だけ「前半で学習・後半で評価」と分割する方法もありますが、これには弱点があります。

- 評価が1回きりなので、たまたま相性の良い相場期間に当たっただけかもしれない
- 相場のレジーム(トレンド相場・レンジ相場など)が変わったときの頑健性が分からない
- 分割位置を変えると結論が変わることがある(これは実際に[+7.72%が-2.65%に崩壊した実体験](/blog/backtest-pitfalls/)でも起きたことです)

ウォークフォワードで複数foldの結果を積み上げることで、「たまたま良かっただけ」なのか「ある程度どの期間でも機能する」のかを判断しやすくなります。

## Step 1: ccxtでOHLCVデータを取得する

まずはccxtで検証用のOHLCV(ローソク足)データを取得します。ccxtの基本的な使い方は[ccxt入門の記事](/blog/ccxt-python-tutorial/)、メソッドの早見表は[ccxt使い方まとめ](/blog/ccxt-cheatsheet/)を参照してください。

```python
import ccxt
import pandas as pd

exchange = ccxt.mexc({'options': {'defaultType': 'swap'}})
symbol = 'BTC/USDT:USDT'
timeframe = '1h'

ohlcv = exchange.fetch_ohlcv(symbol, timeframe, limit=1000)
df = pd.DataFrame(
    ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume']
)
df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
df = df.set_index('timestamp')
```

`fetch_ohlcv`の`limit`は取引所ごとに上限があるため、より長期間のデータが必要な場合は`since`パラメータを使ってループ取得する必要があります。この点はレートリミットとも関わるので注意してください。

## Step 2: ウォークフォワードの分割を実装する

次に、DataFrameを「学習窓」と「検証窓」に分割していく関数を作ります。

```python
def walk_forward_splits(df, train_size, test_size, step=None):
    """dfを (train, test) のタプルのリストに分割する"""
    step = step or test_size
    splits = []
    start = 0
    while start + train_size + test_size <= len(df):
        train = df.iloc[start:start + train_size]
        test = df.iloc[start + train_size:start + train_size + test_size]
        splits.append((train, test))
        start += step
    return splits

splits = walk_forward_splits(df, train_size=500, test_size=100)
print(f'{len(splits)}個のfoldを作成しました')
```

`train_size`と`test_size`の比率に決まった正解はありませんが、一般的には検証期間が短すぎるとサンプル数が少なく判断がぶれやすくなります。ある程度の取引回数が確保できる長さを選ぶのが基本です。

## Step 3: 各foldで戦略を評価する

分割ができたら、各foldのtestデータに対して戦略を評価します。ここでは例として、単純な移動平均クロス戦略を使います。テクニカル指標の計算方法は[テクニカル指標をPythonで計算する記事](/blog/python-technical-indicators/)で詳しく解説しています。

```python
def sma_crossover_signal(close, fast=10, slow=30):
    fast_ma = close.rolling(fast).mean()
    slow_ma = close.rolling(slow).mean()
    signal = (fast_ma > slow_ma).astype(int)
    # 確定した終値を見てから翌足で判断するため1本ずらす(ルックアヘッド回避)
    return signal.shift(1)

def backtest_fold(test_df, fast=10, slow=30, fee=0.001):
    signal = sma_crossover_signal(test_df['close'], fast, slow)
    returns = test_df['close'].pct_change()
    strategy_returns = signal * returns
    trades = signal.diff().abs().fillna(0)
    strategy_returns = strategy_returns - trades * fee  # 往復手数料を控除
    return strategy_returns.sum()

fold_results = [backtest_fold(test) for _, test in splits]
result_series = pd.Series(fold_results, name='fold_pnl')
print(result_series.describe())
```

ここで重要なコードが2箇所あります。

- **`.shift(1)`**: シグナルを1本分ずらすことで、「まだ確定していない足の情報を使って判断する」というルックアヘッド(未来参照)のミスを防いでいます
- **`trades * fee`**: 手数料を必ず差し引いています。手数料を含めない検証は現実の成績と乖離しやすい、という点は[バックテストの罠](/blog/backtest-pitfalls/)でも触れた通りです

## 実装時に気をつけたいポイント

### foldごとの結果はバラつくのが前提

全fold中の一部で成績が悪くても、それ自体は異常ではありません。相場の状況は常に変わるため、全fold一貫してプラスになる戦略はむしろ稀です。重要なのは、平均や中央値、そして「どのくらいの割合のfoldでプラスになったか」といった分布で判断することです。この結果指標の読み方については[成績指標の読み方の記事](/blog/trading-metrics-guide/)も参考にしてください。

### パラメータ最適化をするなら学習窓だけで

`fast`や`slow`のようなパラメータをfoldごとに最適化したい場合は、**必ずtrain部分のデータだけを使って**最適なパラメータを探し、testデータには一切手を加えないようにします。testデータを見てからパラメータを選ぶと、それは事実上のルックアヘッドになってしまいます。

### 機械学習モデルを使う場合も考え方は同じ

LightGBMのような機械学習モデルでシグナルを作る場合も、ウォークフォワードの考え方はそのまま使えます。「trainで学習 → 直後のtestで予測・評価」を繰り返す点は同じです。実装の詳細は[LightGBM入門の記事](/blog/lightgbm-signal-tutorial/)を参照してください。

### 計算リソースが必要になることも

fold数を増やしたり、パラメータの組み合わせを何通りも試したりすると、検証には相応の計算時間がかかります。ローカルPCで回しきれない規模になってきたら、常時起動できるサーバー上で検証を回す選択肢もあります。VPSの選び方は[VPS徹底比較の記事](/blog/vps-comparison/)にまとめています。

<div class="affiliate-box">
<span class="label">PR</span>
<p>バックテストのような計算量の多い検証を長時間回したいときは、常時稼働できるサーバー環境があると便利です。開発・検証用途で気軽に使えるVPSとして、ConoHa VPSのような選択肢があります。</p>
<p><a href="https://px.a8.net/svt/ejp?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" rel="nofollow">サービス開発やテスト環境に便利な【ConoHa】</a>
<img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" alt=""></p>
</div>

## まとめ

- ウォークフォワード検証は、学習期間と検証期間の窓を時系列にスライドさせながら繰り返す検証方法
- 単純な1回きりのtrain/test分割よりも、戦略の頑健性を判断しやすい
- `.shift(1)`などでルックアヘッドを避け、手数料も必ず差し引いて計算する
- パラメータ最適化はtrainデータだけで行い、testデータには手を加えない
- 各foldの結果はバラつくのが前提で、平均や分布で判断する
- 機械学習モデルを使う場合も基本的な考え方は同じ

ウォークフォワード検証はそれ単体で「儲かる戦略」を保証してくれるものではありませんが、「本番で機能しない戦略を事前にふるい落とす」ための重要な道具です。これから検証の仕組みを整えたい方は、あわせて[バックテストの罠の記事](/blog/backtest-pitfalls/)もご覧ください。
