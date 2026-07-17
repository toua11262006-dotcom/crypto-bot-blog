---
title: '機械学習で売買シグナルを作る|LightGBM入門【Pythonコード付き】'
description: 'BTC自動売買ボットに機械学習を組み込む入門解説。LightGBMで価格予測モデルを作る手順を、特徴量設計・ラベル付け・学習・予測までPythonコード付きで実運用者が紹介します。'
pubDate: '2026-07-09'
heroImage: '../../assets/eyecatch/lightgbm-signal-tutorial.png'
---

筆者のBTCボットは、売買判断にLightGBM(機械学習)を使っています。この記事では、「ルールベースの戦略から一歩進んで、機械学習でシグナルを作ってみたい」という方向けに、最初の一歩をコード付きで解説します。

※本記事はモデル構築の基本的な流れの紹介です。実運用に組み込む際は必ず[バックテストで検証](/blog/backtest-pitfalls/)し、手数料込みで有効性を確認してください。

## なぜLightGBMなのか

機械学習にはいろいろな手法がありますが、ボットの売買シグナルにはLightGBM(勾配ブースティング木)がよく使われます。

- **表形式データ(OHLCVやテクニカル指標)との相性が良い** — 画像や文章と違い、価格データのような数値テーブルはこの手の手法が強いです
- **学習が速い** — ディープラーニングに比べて、通常のPCでも数秒〜数十秒で学習が終わります
- **特徴量の重要度がわかる** — どの指標が予測に効いているかを確認できるので、改善の方向性が見えます

```bash
pip install lightgbm pandas numpy scikit-learn
```

## 全体の流れ

1. 価格データ(OHLCV)を取得する
2. **特徴量**(モデルへの入力)を作る
3. **ラベル**(正解データ)を作る
4. 学習用と検証用にデータを分ける
5. モデルを学習させる
6. 予測させて、確率をシグナルとして使う

## ステップ1: 特徴量を作る

生の価格をそのままモデルに入れても、あまり良い予測はできません。**価格の「特徴」を数値化**したものを入力にします。

```python
import pandas as pd
import numpy as np

def add_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # リターン系: 価格の変化率
    df['return_1'] = df['close'].pct_change(1)
    df['return_5'] = df['close'].pct_change(5)

    # 移動平均からの乖離
    df['sma_20'] = df['close'].rolling(20).mean()
    df['dist_sma20'] = (df['close'] - df['sma_20']) / df['sma_20']

    # ボラティリティ(ATRの簡易版)
    high_low = df['high'] - df['low']
    df['atr_pct'] = high_low.rolling(14).mean() / df['close']

    # RSI(買われすぎ・売られすぎの指標)
    delta = df['close'].diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = -delta.clip(upper=0).rolling(14).mean()
    df['rsi'] = 100 - (100 / (1 + gain / loss))

    return df.dropna()
```

ここで作った `return_1`、`dist_sma20`、`atr_pct`、`rsi` などが特徴量です。実際の運用では、これに出来高・上位足のトレンド方向・センチメント指標などを加えていきます。

## ステップ2: ラベルを作る(ここが一番重要)

機械学習で一番難しく、一番結果を左右するのが**ラベル設計**です。「何を予測させるか」を決める作業です。

シンプルな例として、「**N本先の価格が一定%以上上がっていたら1、それ以外は0**」というラベルを作ってみます。

```python
def add_label(df: pd.DataFrame, forward_bars: int = 8, threshold: float = 0.005) -> pd.DataFrame:
    df = df.copy()
    future_return = df['close'].shift(-forward_bars) / df['close'] - 1
    df['label'] = (future_return > threshold).astype(int)
    return df.dropna()
```

**ここで手を抜くと、どんなに特徴量を頑張っても予測精度は上がりません。** 筆者も、TP到達を先着判定にする、ラベル用の値幅を調整するなど、何度も設計をやり直しました。「未来を正しく言い当てられる、かつ意味のある問い」になっているかを常に疑ってください。

## ステップ3: 学習させる

```python
import lightgbm as lgb
from sklearn.model_selection import train_test_split

feature_cols = ['return_1', 'return_5', 'dist_sma20', 'atr_pct', 'rsi']
X = df[feature_cols]
y = df['label']

# 時系列データなので、ランダム分割ではなく時系列順に分割する
split = int(len(df) * 0.8)
X_train, X_valid = X[:split], X[split:]
y_train, y_valid = y[:split], y[split:]

model = lgb.LGBMClassifier(
    n_estimators=100,
    max_depth=4,
    num_leaves=15,
    min_child_samples=30,
    reg_lambda=1.0,
)
model.fit(X_train, y_train)

print('検証Acc:', model.score(X_valid, y_valid))
```

⚠️ **必ず時系列順に分割してください。** ランダムに分割すると、未来のデータで過去を予測する「ルックアヘッド」が混入し、検証精度が現実離れして高く出ます([バックテストの罠](/blog/backtest-pitfalls/)で解説した「未来のデータで最適化する」の一種です)。

## ステップ4: 予測をシグナルとして使う

```python
proba = model.predict_proba(X_valid)[:, 1]  # 上がる確率

# 確率が閾値を超えたらBUYシグナル
buy_signal = proba > 0.6
```

ここで注意したいのが、**確率の較正**です。LightGBMの生の `predict_proba` は「本当に60%当たる」ことを意味しない場合があります。`CalibratedClassifierCV` で較正すると、確率と実際の的中率のズレを補正できます。

```python
from sklearn.calibration import CalibratedClassifierCV

calibrated = CalibratedClassifierCV(model, method='isotonic', cv=3)
calibrated.fit(X_train, y_train)
```

## 実運用でハマりがちな3つの罠

### 1. 過学習(訓練データだけ異常に強い)

訓練Accが90%超えなのに検証Accが50%台なら、過学習しています。`max_depth` や `num_leaves` を小さくする、`reg_lambda`(正則化)を強めるなどで抑えます。

### 2. 特徴量重要度が偏りすぎている

特定の1〜2特徴量だけに予測が依存していると、その特徴量が効かなくなる相場で崩れます。`model.feature_importances_` で確認し、偏りすぎていないかチェックしましょう。

### 3. モデルの再学習を忘れる

相場の性質は時間とともに変わります(レジームが変わる)。一度学習して終わりではなく、**定期的にモデルを再学習する仕組み**を入れないと、徐々に精度が落ちていきます。

## まとめ

- LightGBMは価格データのような表形式データと相性が良く、学習も速い
- **ラベル設計が最重要**。特徴量よりここに時間をかける価値がある
- 時系列データは必ず時系列順に分割する。ランダム分割はルックアヘッドの温床
- 確率の較正・過学習対策・定期再学習を忘れずに

機械学習はあくまで「予測の道具」であり、それだけで儲かるわけではありません。[リスク管理](/blog/bot-risk-management/)や[バックテストでの検証](/blog/backtest-pitfalls/)とセットで初めて意味を持ちます。ボット全体の作り方は[Python×ccxt入門](/blog/ccxt-python-tutorial/)から、ぜひどうぞ。
