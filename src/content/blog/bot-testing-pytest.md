---
title: 'ボットのテストコードはどう書く?pytestとモックで検証する基本'
description: '自動売買ボットは本番で不具合が出ると損失に直結します。pytestとunittest.mockを使い、取引所APIをモック化しながらロジックを安全にテストする書き方の基本を解説します。'
pubDate: '2026-08-11'
heroImage: '../../assets/eyecatch/bot-testing-pytest.png'
---

自動売買ボットのコードを書いていて、「動くには動くけど、これで本番に出して大丈夫だろうか」と不安になったことはないでしょうか。ボットは一度動かし始めると人の目を離れて注文を出し続けるため、Webアプリ以上にテストの重要性が高いにもかかわらず、テストコードが後回しになりがちな分野でもあります。

本記事では、Pythonの標準的なテストフレームワーク`pytest`と、標準ライブラリの`unittest.mock`を使って、ボットのロジックを安全にテストする基本的な書き方を整理します。

## なぜボットにこそテストが必要なのか

ボットのバグは、Webアプリのバグと性質が異なります。画面がおかしいだけなら気づいて直せますが、ボットのバグは「気づかないまま資金を溶かし続ける」形で表面化することがあります。実際に、ロジックの見落としが原因で長期間ボットが意図せず動きを止めていた事例は[ボットが半年間、静かに眠っていた話](/blog/bot-dormant-bug-story/)でも紹介しています。

また、[ボット開発でよくある失敗10選](/blog/bot-common-mistakes/)でも触れているように、失敗の多くは戦略そのものではなく、注文計算やエラー処理といった地味な実装部分に潜んでいます。こうした部分こそ、テストで機械的に検証できる領域です。

テストを書く主な狙いは次の3つです。

- **ロジックのバグを本番前に発見する**(ポジションサイズの計算、損益計算など)
- **リファクタリング時の安全網にする**(挙動を変えずにコードを整理できたか確認できる)
- **取引所APIを呼ばずに繰り返し検証できる**(本物の注文を出さずに済む)

## テストしやすい構造にする: ロジックとAPI呼び出しを分離する

ボットのコードでありがちなのが、価格取得・売買判断・注文送信が1つの関数の中にベタ書きされているケースです。この形だとテストのたびに取引所へ実際にAPIを叩くことになり、現実的ではありません。

```python
# テストしにくい例: 判断とAPI呼び出しが混在
def check_and_trade(exchange, symbol):
    ticker = exchange.fetch_ticker(symbol)
    if ticker['last'] < ticker['average'] * 0.98:
        exchange.create_market_buy_order(symbol, 0.001)
```

これを、判断ロジックとAPI呼び出しに分離します。

```python
# テストしやすい例: 判断ロジックを純粋関数として切り出す
def should_buy(last_price, average_price, threshold=0.98):
    return last_price < average_price * threshold

def check_and_trade(exchange, symbol):
    ticker = exchange.fetch_ticker(symbol)
    if should_buy(ticker['last'], ticker['average']):
        exchange.create_market_buy_order(symbol, 0.001)
```

`should_buy`は数値を受け取って真偽値を返すだけの純粋関数なので、取引所を一切介さずにテストできます。`ccxt`の基本的な使い方は[ccxtとは?Pythonで仮想通貨ボットを自作する第一歩](/blog/ccxt-python-tutorial/)で解説しているので、まだ触れたことがない方はあわせて参考にしてください。

## pytestの基本的な書き方

`pytest`はインストール後、`test_`で始まる関数を自動的に見つけて実行してくれます。

```bash
pip install pytest
```

```python
# test_strategy.py
from strategy import should_buy

def test_should_buy_true_when_price_drops():
    assert should_buy(last_price=98, average_price=100) is True

def test_should_buy_false_when_price_is_normal():
    assert should_buy(last_price=100, average_price=100) is False

def test_should_buy_respects_custom_threshold():
    assert should_buy(last_price=95, average_price=100, threshold=0.9) is False
```

実行はシンプルです。

```bash
pytest test_strategy.py -v
```

`assert`文で期待する結果を書くだけなので、特別な構文を覚える必要はほとんどありません。「価格が下がったら買いと判定するか」「閾値を変えたら判定が変わるか」のように、条件を1つずつ独立したテスト関数に分けて書くのがコツです。

## unittest.mockで取引所APIを模擬する

純粋関数だけでなく、API呼び出しを含む関数もテストしたい場合があります。ここで使うのが標準ライブラリの`unittest.mock`です。実際の取引所に接続せず、「こう呼ばれたらこう返す」という模擬オブジェクト(モック)を用意してテストします。

```python
from unittest.mock import MagicMock
from bot import check_and_trade

def test_check_and_trade_calls_buy_order_when_price_drops():
    mock_exchange = MagicMock()
    mock_exchange.fetch_ticker.return_value = {'last': 98, 'average': 100}

    check_and_trade(mock_exchange, 'BTC/USDT')

    mock_exchange.create_market_buy_order.assert_called_once_with('BTC/USDT', 0.001)

def test_check_and_trade_does_not_buy_when_price_is_normal():
    mock_exchange = MagicMock()
    mock_exchange.fetch_ticker.return_value = {'last': 100, 'average': 100}

    check_and_trade(mock_exchange, 'BTC/USDT')

    mock_exchange.create_market_buy_order.assert_not_called()
```

`MagicMock()`はどんなメソッド呼び出しにも応答してくれる万能の模擬オブジェクトです。`return_value`で戻り値を固定し、`assert_called_once_with`で「意図した引数で1回だけ呼ばれたか」を検証できます。これにより、APIキーもネットワーク接続も使わずに「価格が下がったら買い注文を出す」という挙動を確認できます。

APIのエラー応答を模したテストも書けます。

```python
import ccxt
import pytest

def test_fetch_with_retry_raises_after_max_attempts():
    mock_exchange = MagicMock()
    mock_exchange.fetch_ticker.side_effect = ccxt.RateLimitExceeded('rate limited')

    with pytest.raises(RuntimeError):
        fetch_with_retry(mock_exchange, 'BTC/USDT', max_retries=3)
```

`side_effect`に例外を渡すと、呼び出すたびにその例外が発生する状態を再現できます。レートリミットやネットワークエラーへの対処は書いたつもりでも実際に発生させて確認するのは難しいものですが、モックなら意図的に発生させて挙動を検証できます。エラー対処そのものについては[ccxtのエラーが解決しない?実運用で踏んだ落とし穴と対処法まとめ](/blog/ccxt-common-errors/)も参考にしてください。

## フィクスチャで共通の準備を使い回す

複数のテストで同じモックの準備を繰り返す場合、`pytest`の`fixture`を使うと重複を減らせます。

```python
import pytest
from unittest.mock import MagicMock

@pytest.fixture
def mock_exchange():
    exchange = MagicMock()
    exchange.fetch_ticker.return_value = {'last': 100, 'average': 100}
    return exchange

def test_normal_price_does_not_trigger_buy(mock_exchange):
    check_and_trade(mock_exchange, 'BTC/USDT')
    mock_exchange.create_market_buy_order.assert_not_called()
```

引数名を`mock_exchange`にするだけで、`pytest`が同名のフィクスチャ関数を見つけて自動的に注入してくれます。テストが増えてくるほど、準備部分の重複を減らせる効果は大きくなります。

## パラメトライズでエッジケースをまとめて確認する

境界値付近の挙動は特にバグが出やすい部分です。`@pytest.mark.parametrize`を使うと、複数のパターンを1つのテスト関数でまとめて検証できます。

```python
import pytest

@pytest.mark.parametrize("last_price,average_price,expected", [
    (98, 100, True),    # 2%下落 → 買い
    (99, 100, False),   # 1%下落 → 閾値未満なので買わない
    (100, 100, False),  # 変化なし
    (0, 100, True),     # 極端な下落
])
def test_should_buy_boundary_cases(last_price, average_price, expected):
    assert should_buy(last_price, average_price) is expected
```

特に閾値ちょうどの値や、ゼロ・マイナスといった極端な値は手動でテストするのを忘れがちです。パラメトライズで一覧化しておくと、後から見直したときにも「どのケースを想定しているか」が一目で分かります。

## バックテストとの違いを理解しておく

「テストを書いたから、これはバックテストの代わりになるのか」と思うかもしれませんが、両者は目的が異なります。

| | 単体テスト(pytest) | バックテスト |
| --- | --- | --- |
| 目的 | コードが意図通りに動くか(バグの有無) | 戦略が過去データ上で機能するか(収益性) |
| 対象 | 個々の関数・条件分岐 | 戦略全体・期間を通した挙動 |
| 頻度 | コード変更のたびに高速に実行 | パラメータ変更時などにまとめて実行 |

単体テストは「計算式が正しいか」を保証するものであり、「その戦略が儲かるか」までは保証しません。戦略の妥当性検証については[バックテスト+7.72%が-2.65%に崩壊した話](/blog/backtest-pitfalls/)や[ウォークフォワード検証の実装方法](/blog/walkforward-backtest/)で扱っている観点が必要になります。両者は競合するものではなく、「単体テストでコードの正しさを担保し、バックテストで戦略の妥当性を検証する」という役割分担で考えるとよいでしょう。

## テストを継続的に実行する仕組みも検討する

テストを書いても、実行し忘れては意味がありません。GitHubなどでコードを管理している場合、pushやプルリクエスト作成時に自動でテストを走らせる仕組み(CI)を組み込んでおくと、変更のたびに手動で`pytest`を叩く手間がなくなります。GitHub Actionsであれば、`pytest`を実行するだけのシンプルなワークフローファイル1つで導入できます。ここではテストの書き方に絞って解説しましたが、CIの構築は既存のコードベースにテストがある程度揃ってから着手するのがスムーズです。

テストで検出した異常やエラーは、実行結果をログに残しておくとあとから振り返りやすくなります。ログの残し方については[ボットのログ設計|障害調査で困らないログの残し方](/blog/bot-log-design/)にまとめています。

## まとめ

- ボットのバグは気づかないまま資金に影響し続けることがあり、単体テストによる検証の価値が高い
- 判断ロジックとAPI呼び出しを分離すると、純粋関数の部分は取引所を介さずにテストできる
- `unittest.mock`の`MagicMock`を使えば、取引所APIをモック化して発注ロジックやエラー処理をテストできる
- `pytest.fixture`で共通の準備を使い回し、`@pytest.mark.parametrize`で境界値・エッジケースをまとめて検証する
- 単体テストは「コードの正しさ」、バックテストは「戦略の妥当性」を確認するものであり、役割が異なる

テストコードは書いた瞬間に利益を生むものではないため、後回しにされがちです。しかし、ボットは無人で動き続けるからこそ、変更のたびに壊れていないかを機械的に確認できる仕組みの価値が大きくなります。まずは判断ロジックの純粋関数化から、小さく始めてみてください。
