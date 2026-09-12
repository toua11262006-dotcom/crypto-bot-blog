---
title: 'ボットが再起動したら二重発注?状態復元とID管理で防ぐ設計の作り方'
description: '取引ボットがsystemdなどで自動再起動すると、注文処理の途中で落ちて二重発注が起きることがあります。取引所を「真実の源」として扱う状態復元の考え方と、IDによる冪等性の作り方を一般的な設計指針として解説します。'
pubDate: '2026-08-21'
heroImage: '../../assets/eyecatch/bot-restart-state-recovery.png'
---

[VPSで24時間運用する記事](/blog/vps-bot-24h/)では、`systemd` の `Restart=always` を使ってボットが落ちても自動で再起動する構成を紹介しました。この仕組みは可用性を高める一方で、**「注文を送った直後にプロセスが落ちて、再起動後にもう一度同じ注文を送ってしまう」**という新しいリスクを持ち込みます。この記事では、再起動をまたいでも二重発注が起きない状態管理の考え方を、一般的な設計指針として整理します。

## なぜ再起動が二重発注を引き起こすのか

ボットの多くは、注文状況をプログラムのメモリ上の変数(ローカルの状態)で管理しています。典型的な処理の流れは次のようになります。

1. エントリー条件が成立したと判断する
2. 取引所に発注リクエストを送る
3. 発注が成功したことをメモリ上の変数に記録する
4. 以後、その変数を見て「もう発注済みだ」と判断する

問題は、**手順2と3の間でプロセスが強制終了した場合**です。取引所側では注文が正常に受理されているにもかかわらず、メモリ上の状態は更新されないままプロセスが消えます。`systemd` がボットを再起動すると、メモリはまっさらな状態から始まるため、ボットは「まだ発注していない」と誤認し、同じ条件でもう一度発注してしまいます。

これはネットワーク起因のタイムアウトでも同様に起こります。[ccxtのエラー対処法の記事](/blog/ccxt-common-errors/)で触れたとおり、`cancel_order` や `create_order` がタイムアウトエラーを返しても、取引所側では処理が成功している場合があります。プロセスが生きている限りはリトライ処理でカバーできますが、**プロセスごと再起動した場合はメモリの記録自体が失われる**ため、より根が深い問題になります。

## 原則: 取引所を「真実の源」にする

この問題への一番の対策は、**「今どういう状態か」の判断基準をローカルの変数ではなく、取引所そのものに置く**という設計原則です。

- ❌ 起動時にメモリを空の状態で初期化し、そのままロジックを再開する
- ✅ 起動時に取引所へ問い合わせて、実際の建玉・未約定注文を取得してからロジックを再開する

具体的には、ボットの起動処理の先頭に「状態復元(リコンサイル)」のステップを必ず挟みます。

```python
def reconcile_state(exchange, symbol):
    """起動時に取引所の実際の状態からローカル状態を組み立て直す"""
    open_orders = exchange.fetch_open_orders(symbol)
    positions = exchange.fetch_positions([symbol])

    position = next((p for p in positions if float(p.get('contracts') or 0) != 0), None)

    state = {
        'open_order_ids': {o['id'] for o in open_orders},
        'has_position': position is not None,
        'position_side': position['side'] if position else None,
    }
    return state
```

この関数を起動直後に必ず呼び、その戻り値をもとにその後のロジックを組み立てます。「メモリに記録がないから未発注」ではなく、「取引所に問い合わせた結果、未発注」と判断する形に変えるだけで、再起動をまたいだ二重発注の多くは防げます。

## クライアントオーダーIDによる冪等性

リコンサイルだけでは防ぎきれないケースもあります。たとえば「発注リクエストは送信済みだが、レスポンスが返ってくる前にプロセスが落ちた」場合、取引所側で受理されたかどうか自体が起動直後には分からないことがあります。

ここで役立つのが、注文作成時に自分で指定できる**クライアントオーダーID**です。多くの取引所APIは、注文発注時に任意の文字列IDを付与でき、`fetch_open_orders` などで後から同じIDを使って検索できます。

```python
import hashlib

def make_client_order_id(strategy: str, symbol: str, signal_bar_time: int) -> str:
    """同じシグナルからは常に同じIDを生成する(ランダム値を使わない)"""
    raw = f'{strategy}:{symbol}:{signal_bar_time}'
    return hashlib.sha256(raw.encode()).hexdigest()[:24]

client_id = make_client_order_id('grid_v1', 'BTC/USDT', bar_time)

order = exchange.create_order(
    'BTC/USDT', 'limit', 'buy', amount, price,
    params={'clientOrderId': client_id},
)
```

ポイントは、IDを**ランダムに生成するのではなく、シグナルの内容(戦略名・銘柄・対象の時刻など)から決定的に生成する**ことです。こうしておけば、再起動後に同じシグナルに対してもう一度発注しようとしても、生成されるIDは前回とまったく同じになります。取引所側が同一クライアントオーダーIDの重複を検知・拒否する仕様であれば、二重発注はAPIのレベルで防げます。

※ クライアントオーダーIDの重複チェックの有無・仕様は取引所ごとに異なり、対応状況も変更されることがあるため、実装前に必ず利用している取引所の公式ドキュメントで最新の挙動を確認してください。

## ローカルにも「発注前」の記録を残す

取引所側の重複チェックに完全に頼るのはリスクがあります。そこで、**発注リクエストを送る前に、まずローカルの永続化ストレージに「これから送る」という記録を書き込む**、いわゆるWrite-Ahead方式を組み合わせます。

```python
import sqlite3

conn = sqlite3.connect('bot_state.db')
conn.execute('''
    CREATE TABLE IF NOT EXISTS order_intents (
        client_order_id TEXT PRIMARY KEY,
        symbol TEXT,
        status TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
''')

def place_order_safely(exchange, symbol, side, amount, price, client_id):
    cur = conn.execute(
        'SELECT status FROM order_intents WHERE client_order_id = ?', (client_id,)
    )
    row = cur.fetchone()
    if row is not None:
        # すでに発注意図が記録済み → 再送せず、状態確認だけ行う
        return exchange.fetch_order(client_id, symbol)

    conn.execute(
        'INSERT INTO order_intents (client_order_id, symbol, status) VALUES (?, ?, ?)',
        (client_id, symbol, 'pending'),
    )
    conn.commit()

    order = exchange.create_order(
        symbol, 'limit', side, amount, price,
        params={'clientOrderId': client_id},
    )
    conn.execute(
        'UPDATE order_intents SET status = ? WHERE client_order_id = ?',
        ('sent', client_id),
    )
    conn.commit()
    return order
```

このテーブルがあれば、再起動後に「発注しようとした記録はあるが、結果が確定していない」ものを起動時のリコンサイル処理で洗い出し、取引所に実際の状態を問い合わせて確定させる、という流れが作れます。SQLiteのようなファイルベースのDBであれば、追加のミドルウェアなしに手軽に導入できます。

## 「発注していない」ことの証明は難しい

設計上、意識しておきたいのは、**「発注した」ことより「発注していない」ことを確認するほうが難しい**という非対称性です。注文IDが返ってくれば発注成功は確認できますが、タイムアウトが返った場合、それが「本当に失敗した」のか「成功したがレスポンスが届かなかった」のかはAPIの応答だけでは区別できません。

このため、判断に迷うケースでは「発注していない」と決めつけて再送するのではなく、`fetch_open_orders` や `fetch_positions` で実際の状態を取得し、**それでも判断できない場合は自動再送せず、人間に通知して確認を仰ぐ**という設計にしておくと安全です。[Discord通知ボットの作り方](/blog/discord-notification-bot/)を使えば、こうした「判断保留」の状態をすぐに知らせる仕組みを組み込めます。

## テストで再起動シナリオを再現する

この手のバグはタイミング依存で本番でしか再現しないことが多く、事前に検出するにはテストで意図的にシナリオを再現するのが有効です。[pytestでのボットのテストの書き方](/blog/bot-testing-pytest/)で紹介したモックの手法を使い、「発注APIを呼んだ直後に例外を発生させる」テストケースを用意すると、リコンサイル処理が正しく機能するかを継続的に確認できます。

```python
def test_reconcile_prevents_duplicate_after_crash(mock_exchange):
    # 取引所側にはすでに注文が存在する状態を再現
    mock_exchange.fetch_open_orders.return_value = [
        {'id': 'abc123', 'clientOrderId': 'expected-id', 'status': 'open'}
    ]
    state = reconcile_state(mock_exchange, 'BTC/USDT')
    assert 'abc123' in state['open_order_ids']
```

## まとめ

- `systemd` などによる自動再起動は可用性を上げる一方、注文処理の途中断による二重発注リスクを持ち込む
- 判断基準をローカルのメモリではなく**取引所そのもの**に置き、起動時に必ず状態を復元(リコンサイル)する
- クライアントオーダーIDは**シグナルの内容から決定的に生成**し、ランダム値にしない
- 発注前にローカルへ「発注意図」を書き込むWrite-Ahead方式を組み合わせると、途中断からの復旧がしやすくなる
- 「発注していない」ことの確認は難しいため、判断に迷うケースは自動再送せず人間に通知する
- タイミング依存のバグはテストで意図的に再現し、継続的に検証する

再起動時の状態復元は地味な設計ですが、[ボット開発でよくある失敗トップ10](/blog/bot-common-mistakes/)にもつながる典型的な落とし穴です。ログ設計と合わせて、「落ちても壊れない」仕組みを最初から組み込んでおくことをおすすめします。

<div class="affiliate-box">
<span class="label">PR</span>
<p>ボットを24時間動かす環境そのものが安定していることも、状態復元の前提になります。開発・検証環境として手頃な価格帯のVPSを探している方は、以下も参考にしてください。</p>
<p><a href="https://px.a8.net/svt/ejp?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" rel="nofollow">サービス開発やテスト環境に便利な【ConoHa】</a>
<img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" alt=""></p>
</div>
