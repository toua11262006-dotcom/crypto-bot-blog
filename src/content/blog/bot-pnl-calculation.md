---
title: 'ボットの損益計算はどう実装する?平均取得単価と実現・含み損益の基本'
description: '自動売買ボットの損益はどう計算すればいいのでしょうか。平均取得単価の更新方法、実現損益と含み損益の違い、部分約定やドテンを含めた損益計算の実装の考え方を、一般的な設計指針として整理して解説します。'
pubDate: '2026-09-01'
heroImage: '../../assets/eyecatch/bot-pnl-calculation.png'
---

自動売買ボットを作っていると、「今いくら儲かっているのか」を表示したくなります。しかし、いざ実装しようとすると、部分約定・複数回のナンピン・ドテン(買いから売りへの反転)などが絡んで、意外と単純ではないことに気づきます。この記事では、損益計算を自作するときに押さえておきたい基本概念と実装の考え方を、一般的な設計指針として整理します。

## 「損益」には2種類ある

まず用語を整理します。ボットの損益は大きく2つに分かれます。

- **含み損益(未実現損益)**: まだ保有中のポジションについて、現在価格で評価した場合の損益。決済していないので、あくまで「今売ったら」の仮の数字
- **実現損益**: 実際に決済(反対売買)を行って確定した損益。一度確定すれば、その後の価格変動では変わらない

[成績指標の読み方の記事](/blog/trading-metrics-guide/)で扱ったプロフィットファクターや最大ドローダウンは、基本的に**実現損益の積み上げ**をもとに計算します。含み損益は評価額として画面に出す分にはよいですが、成績評価の母数に混ぜると「まだ確定していない利益」を実績として扱ってしまうことになるため、区別して管理する必要があります。

## 平均取得単価法でポジションを管理する

複数回に分けて買い増しした場合、「今のポジションはいくらで買ったことになっているか」を1つの数字で表す必要があります。ここで使われるのが**平均取得単価法**です。考え方はシンプルで、買い増しのたびに次の式で単価を更新します。

```
新しい平均取得単価 = (旧平均単価 × 旧数量 + 今回の約定価格 × 今回の数量) ÷ (旧数量 + 今回の数量)
```

Pythonで実装すると、ポジションの状態を持つクラスは次のような形になります。

```python
from dataclasses import dataclass

@dataclass
class Position:
    symbol: str
    side: str = 'flat'   # 'long' / 'short' / 'flat'
    amount: float = 0.0  # 保有数量(常に正の値で持つ)
    avg_price: float = 0.0
    realized_pnl: float = 0.0

def apply_fill(pos: Position, fill_side: str, fill_amount: float, fill_price: float) -> Position:
    """1回の約定をポジションに反映する"""
    if pos.side == 'flat':
        pos.side = fill_side
        pos.amount = fill_amount
        pos.avg_price = fill_price
        return pos

    if fill_side == pos.side:
        # 同じ方向への買い増し・売り増し → 平均取得単価を更新
        total_cost = pos.avg_price * pos.amount + fill_price * fill_amount
        pos.amount += fill_amount
        pos.avg_price = total_cost / pos.amount
        return pos

    # 逆方向の約定 → 決済(一部 or 全部)
    close_amount = min(fill_amount, pos.amount)
    pnl = (fill_price - pos.avg_price) * close_amount
    if pos.side == 'short':
        pnl = -pnl
    pos.realized_pnl += pnl
    pos.amount -= close_amount

    remainder = fill_amount - close_amount
    if pos.amount <= 1e-12:
        # ちょうど決済しきった、またはドテン
        pos.side = 'flat' if remainder <= 1e-12 else fill_side
        pos.amount = remainder
        pos.avg_price = fill_price if remainder > 0 else 0.0

    return pos
```

ポイントは、**買い増し(同方向)は平均単価の更新、逆方向の約定は決済**という2つの処理を明確に分けていることです。この分岐があいまいだと、ナンピンした直後に実現損益が誤って計上される、といったバグにつながります。

## ドテン(反転)を1回の約定として扱わない

売買アルゴリズムによっては、「ロングを閉じて同時にショートを建てる」ドテン注文を1回のAPIコールで送ることがあります。実装上ハマりやすいのはここで、約定数量が保有数量を上回った場合、**決済分と新規建玉分を分けて計算しないと平均取得単価が壊れます**。上のコードでは `close_amount` と `remainder` に分割することでこれに対応しています。取引所によっては約定情報が「決済」「新規」で別々のフィルとして返ってくることもあるため、[ccxtのエラー対処法の記事](/blog/ccxt-common-errors/)で触れたような、取引所ごとのレスポンス差異にも注意が必要です。

## 含み損益の計算

保有中ポジションの含み損益は、平均取得単価と現在価格の差から計算します。

```python
def unrealized_pnl(pos: Position, mark_price: float) -> float:
    if pos.side == 'flat':
        return 0.0
    diff = mark_price - pos.avg_price
    if pos.side == 'short':
        diff = -diff
    return diff * pos.amount
```

無期限先物を扱う場合は、値動き以外にファンディング料の授受も損益に影響します。ファンディングの仕組み自体は[無期限先物の基礎知識の記事](/blog/perpetual-futures-basics/)で解説していますが、実装上は「値動きによる損益」と「ファンディングの授受」を別の項目として記録しておくと、あとで**どちらが成績に効いているか**を切り分けやすくなります。

## 手数料を必ず組み込む

損益計算でありがちな抜け漏れが、**手数料の反映漏れ**です。約定のたびに発生するメイカー/テイカー手数料を差し引かないと、実際より良い成績に見えてしまいます。

```python
def apply_fill_with_fee(pos: Position, fill_side: str, fill_amount: float, fill_price: float, fee: float) -> Position:
    pos = apply_fill(pos, fill_side, fill_amount, fill_price)
    pos.realized_pnl -= fee
    return pos
```

取引回数が多い戦略ほど手数料の累積が効いてきます。[成績指標の記事](/blog/trading-metrics-guide/)でも触れたとおり、手数料を含めない損益は実態より良く見えるだけなので、集計の一番早い段階で差し引いておくのが安全です。

## 状態はどこに置くか

ここまでのロジックはあくまで「約定情報から損益を計算する」部分です。この状態(`Position` オブジェクト)自体をどこに永続化するかは、[再起動と状態復元の記事](/blog/bot-restart-state-recovery/)で扱った考え方がそのまま当てはまります。ボットのメモリだけに持たせると、再起動のたびに損益の積み上げがリセットされてしまうため、SQLiteなどの永続化ストレージに逐次書き込み、起動時に取引所の約定履歴と突き合わせて復元できるようにしておくと安心です。

## テストで検証する

損益計算はロジックが複雑になりやすく、かつ間違いに気づきにくい(表示された数字が「それらしく」見えてしまう)箇所でもあります。[pytestでのテストの書き方の記事](/blog/bot-testing-pytest/)で紹介した手法を使い、次のようなケースを最低限カバーしておくと安心です。

| テストケース | 確認すること |
| --- | --- |
| 新規建玉 → 一部決済 | 実現損益と残数量が正しいか |
| 買い増し2回 → 平均単価 | 加重平均が正しく計算されているか |
| ドテン(決済数量 > 保有数量) | 決済分と新規建玉分が正しく分離されるか |
| 手数料込みの決済 | 手数料が実現損益から差し引かれているか |

## まとめ

- 損益は「含み損益(未実現)」と「実現損益」を区別して管理する
- ポジションの平均取得単価は、買い増しのたびに加重平均で更新する
- 逆方向の約定は決済処理として扱い、平均取得単価とは別ロジックで計算する
- ドテンは「決済分」と「新規建玉分」に分割してから計算する
- 手数料(と無期限先物ならファンディング)は必ず損益に反映する
- 損益の状態は永続化し、取引所の約定履歴と突き合わせて復元できるようにする

損益計算は地味な実装ですが、[成績指標](/blog/trading-metrics-guide/)や[資金管理](/blog/bot-risk-management/)の土台になる部分です。表示が「それっぽく」動いているように見えても、境界条件(ドテン・部分約定・手数料)を丁寧にテストしておくことをおすすめします。
