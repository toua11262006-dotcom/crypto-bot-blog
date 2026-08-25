---
title: '取引所がダウンした時、ボットはどう動くべき?障害時のフェイルセーフ設計'
description: 'API接続が切れた瞬間、ボットは無限リトライで新規注文を出し続けていませんか。取引所の障害・メンテナンス時に安全側へ倒すための状態設計と、復旧時の再開手順をPythonの実装例つきで解説します。'
pubDate: '2026-08-25'
heroImage: '../../assets/eyecatch/exchange-outage-failsafe.png'
---

自動売買ボットの多くは「取引所のAPIは基本的に応答する」という前提で作られています。しかし実際には、メンテナンス・DDoS対策の一時遮断・取引所側の障害など、APIが一定時間まったく応答しなくなる場面が定期的に発生します。この記事では、個別のAPIエラーへの対処ではなく、**「取引所そのものが一時的に使えなくなったとき、ボット全体としてどう振る舞うべきか」**という一段上の設計を整理します。

## 個別エラー対処と何が違うのか

[ccxtのエラーが解決しない?実運用で踏んだ落とし穴と対処法まとめ](/blog/ccxt-common-errors/)では、`AuthenticationError` や `OrderNotFound` のような個別の例外への対処法を紹介しました。あれらは基本的に「1回のAPI呼び出しが失敗したときにどうリカバリーするか」という話です。

一方で本記事のテーマは、**1回の呼び出しではなく、数分〜数時間にわたってAPIそのものが応答しなくなる**ケースです。この間、ボットは新規のシグナル判断も、既存ポジションの確認も、注文のキャンセルもできません。個別のtry-exceptを積み重ねるだけでは対応しきれない、ボット全体のモード管理の話になります。

## なぜ「ひたすらリトライ」が危険なのか

APIが応答しないとき、最もありがちな実装は「例外が出たらsleepしてリトライ」をループさせることです。一見安全そうに見えますが、次のような問題があります。

- **リトライ自体が新たな負荷になる**: 取引所側が過負荷やDDoS対策で一時遮断している最中に、大量のリトライリクエストを送り続けると、復旧をさらに遅らせる要因になりかねません
- **「エントリーロジックは動いているのに発注だけ失敗し続ける」状態に気づきにくい**: ログにエラーが流れ続けるだけで、誰も異常に気づかないまま時間が過ぎることがあります
- **復旧した瞬間に、古い判断根拠のまま一斉に注文を出してしまう**: 数十分前の価格やシグナルをもとに溜め込んだ注文要求が、復旧直後にまとめて実行される事故につながります

ひたすらリトライするロジックは「動き続けている」ように見えて、実際には**何が起きているか誰も把握できない状態**を作り出しやすいという点が問題です。

## 設計の軸: ボットに明示的な「状態」を持たせる

対策の基本方針は、ボットの内部状態を暗黙のうちに「動いている/例外で止まっている」の二値にせず、**明示的な状態機械(ステートマシン)として持たせる**ことです。目安として、次の3状態に分けて考えると整理しやすくなります。

| 状態 | 意味 | 新規エントリー | 既存ポジションの扱い |
| --- | --- | --- | --- |
| NORMAL | API応答が正常 | 通常どおり実行 | 通常どおり監視 |
| DEGRADED | 直近で失敗が増えているが復旧の見込みあり | 停止(様子見) | 監視は継続を試みる |
| HALTED | 一定時間・一定回数以上、応答が得られない | 完全停止 | ログ記録のみ。人間に通知して判断を仰ぐ |

ポイントは、DEGRADEDとHALTEDの間に**明確な閾値**を置くことです。「失敗したらとりあえずログに出して次のループへ」ではなく、「直近N回中M回以上失敗したらDEGRADEDに遷移する」「DEGRADEDがT秒続いたらHALTEDに遷移する」というように、時間と回数の両方で機械的に判定します。

## 実装例: シンプルなヘルス管理クラス

考え方をコードに落とすと、次のような形になります。ネットワークエラーの記録と状態遷移だけを担当する、単純なクラスです。

```python
import time
from collections import deque
from enum import Enum


class BotHealth(Enum):
    NORMAL = 'normal'
    DEGRADED = 'degraded'
    HALTED = 'halted'


class ExchangeHealthMonitor:
    """直近の成功/失敗を記録し、状態を判定する"""

    def __init__(self, window_size=20, degraded_ratio=0.4, halted_seconds=300):
        self.results = deque(maxlen=window_size)
        self.degraded_ratio = degraded_ratio
        self.halted_seconds = halted_seconds
        self.degraded_since = None

    def record(self, success: bool):
        self.results.append(success)
        if not success and self.degraded_since is None:
            pass  # 状態判定は current_state() 側でまとめて行う

    def current_state(self) -> BotHealth:
        if not self.results:
            return BotHealth.NORMAL

        fail_ratio = self.results.count(False) / len(self.results)

        if fail_ratio < self.degraded_ratio:
            self.degraded_since = None
            return BotHealth.NORMAL

        if self.degraded_since is None:
            self.degraded_since = time.time()

        elapsed = time.time() - self.degraded_since
        if elapsed >= self.halted_seconds:
            return BotHealth.HALTED
        return BotHealth.DEGRADED
```

メインループ側では、この状態に応じて処理の分岐を明示的に書きます。

```python
monitor = ExchangeHealthMonitor()

while True:
    try:
        ticker = exchange.fetch_ticker(symbol)
        monitor.record(True)
    except (ccxt.NetworkError, ccxt.ExchangeNotAvailable):
        monitor.record(False)
        ticker = None

    state = monitor.current_state()

    if state == BotHealth.NORMAL:
        run_normal_logic(exchange, ticker)
    elif state == BotHealth.DEGRADED:
        # 新規エントリーは見送るが、監視自体は継続する
        log.warning('degraded state: skipping new entries')
    else:  # HALTED
        log.error('exchange unreachable for extended period, halting bot')
        notify_human('取引所への接続が長時間失敗しています。手動確認をお願いします。')
        break  # ループを抜けて完全停止

    time.sleep(5)
```

しきい値(`window_size` や `halted_seconds`)は取引所の特性や戦略の許容度によって調整が必要です。数分のメンテナンス告知があるような取引所を使う場合は、告知情報と合わせて閾値を検討するとよいでしょう。

## 既存ポジションはどう扱うか

新規エントリーを止めるのは簡単ですが、悩ましいのは**すでに保有しているポジションの扱い**です。API経由でボットが手を出せない間、ポジションはノーガードになります。ここで有効なのが、注文自体を取引所側に「予約」しておく方法です。

- 損切り・利確の注文を、逆指値(ストップ)注文として**あらかじめ取引所に送っておく**
- こうしておけば、ボットのプロセスやAPI接続が止まっていても、取引所のサーバー側で条件判定・約定処理が行われる

逆指値注文の種類や使い分けは[注文の種類まとめ](/blog/order-types-guide/)で解説しています。「ボットが生きている間だけリスク管理する」のではなく、「取引所側にリスク管理の一部を委譲しておく」ことが、障害時の被害を限定する重要な保険になります。

## 人間への通知を早めに行う

HALTED状態に入った時点で、可能な限り早く人間に通知することも欠かせません。特に注意したいのは、**通知手段そのものが同じ取引所のAPIに依存していないか**という点です。取引所のAPIが落ちているときに、通知処理も同じAPI経由でしか送れない設計になっていると、肝心なときに沈黙してしまいます。

[Discord通知ボットの作り方](/blog/discord-notification-bot/)で紹介しているような、取引所とは別系統の通知チャネルを用意しておけば、この問題は避けられます。通知内容には、単に「エラーが発生しました」ではなく、**いつから・何回失敗しているか・最後に確認できたポジション状況**まで含めておくと、確認作業がスムーズになります。

## 復旧時にいきなり再開しない

API応答が戻ってきたことを検知しても、すぐにNORMAL状態へ復帰して通常ロジックを再開するのは危険です。障害中に取引所側で意図しない約定(前述の逆指値注文など)が発生している可能性があるためです。

復旧を検知したら、まず[再起動と状態復元の記事](/blog/bot-restart-state-recovery/)で紹介したリコンサイル処理と同じ考え方で、**取引所に問い合わせて実際のポジション・未約定注文を取得し直してから**通常ロジックに戻すようにします。

```python
def resume_from_halted(exchange, symbol):
    state = reconcile_state(exchange, symbol)  # 状態復元の記事で紹介した関数
    log.info(f'resumed with actual state: {state}')
    return state
```

「応答が戻った=ただちに全部再開」ではなく、「応答が戻った=まず現状確認、それから再開」という順序を徹底することが、障害からの復旧時に事故を起こさないための鍵になります。

## この仕組みをテストで確認する

障害対応のロジックは、本番の障害が起きたときにしか動かないコードでもあります。だからこそ、事前にテストで意図的に再現しておくことが重要です。[pytestでのボットのテストの書き方](/blog/bot-testing-pytest/)で紹介したモックの手法を使えば、「APIが連続して失敗し続けたらHALTEDに遷移するか」「復旧後にリコンサイル処理が呼ばれるか」といった振る舞いを、実際の障害を待たずに検証できます。

```python
def test_monitor_transitions_to_halted(monkeypatch):
    monitor = ExchangeHealthMonitor(window_size=5, degraded_ratio=0.4, halted_seconds=0)
    for _ in range(5):
        monitor.record(False)
    assert monitor.current_state() == BotHealth.HALTED
```

## まとめ

- 個別のAPI例外対応と、取引所全体が長時間応答しない障害への対応は、分けて設計する必要がある
- ひたすらリトライを続けるだけの実装は、負荷を悪化させたり、復旧直後の一斉発注事故につながったりする
- ボットの内部状態をNORMAL/DEGRADED/HALTEDのように明示化し、時間と失敗回数の両方でしきい値を決めて機械的に遷移させる
- 既存ポジションのリスク管理は、可能な範囲で逆指値注文などにより取引所側へあらかじめ委譲しておく
- 通知は取引所APIに依存しない別系統の手段を用意し、早めに人間へエスカレーションする
- 復旧時は「即再開」ではなく、必ず状態のリコンサイルを経てから通常ロジックに戻す
- このロジック自体もテストで再現・検証しておく

障害対応の設計は、平常時には何のメリットも実感できない地味な作業です。しかし、実際に取引所側で障害が起きたときにボットがどう振る舞うかは、[ボットを止めるべきタイミング](/blog/bot-stop-criteria/)の判断以上に、資金を守れるかどうかを直接左右します。今動いているボットに障害時の明示的な状態管理が入っていない場合は、まず自分のボットが「応答なし」にどう反応するかを確認してみることをおすすめします。
