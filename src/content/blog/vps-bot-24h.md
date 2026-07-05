---
title: '自動売買ボットをVPSで24時間動かす方法【実運用中の構成を公開】'
description: '自動売買ボットの24時間稼働にはVPSが必須。実際にVPS上でBTCボットを運用している筆者が、VPSの選び方から初期設定、ボットの常時稼働のさせ方まで解説します。'
pubDate: '2026-07-04'
heroImage: '../../assets/eyecatch/vps-bot-24h.png'
---

自動売買ボットは24時間動かしてこそ真価を発揮します。自宅PCの点けっぱなしでは、停電・再起動・回線切断のたびにボットが止まってしまいます。この記事では、実際にVPSでBTCボットを運用している筆者の構成を紹介します。

## なぜVPSが必要なのか

- **安定稼働**: データセンターで運用されるため、停電や回線切断の心配がほぼない
- **電気代より安い**: 自宅PCを24時間点けっぱなしにする電気代より、月数百円〜千円台のVPSのほうが安いことが多い
- **どこからでも管理できる**: 外出先からスマホでログを確認したり、ボットを再起動したりできる

## VPSの選び方

ボット運用に必要なスペックは意外と低く、**メモリ1GB・CPU1コア**程度のプランで十分です。選ぶポイントは次の3つです。

1. **月額料金**: 最安プランで月500〜700円程度が目安
2. **国内リージョン**: 取引所サーバーとの通信の安定性を考えると、まずは国内で問題ありません
3. **Linuxが使えること**: Ubuntu等を選べるVPSにしましょう(Windowsプランは割高です)

<div class="affiliate-box">
<span class="label">PR</span>
<p>筆者のボットも国内VPSの <strong>ConoHa VPS</strong> 上で24時間稼働しています。最安プランは月数百円から、申し込んだその日にUbuntuサーバーが立ち上がるので、ボット運用の環境としては定番です。</p>
<p><a href="https://px.a8.net/svt/ejp?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" rel="nofollow">サービス開発やテスト環境に便利な【ConoHa】</a>
<img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4B7U0Y+3C9KZ6+50+4YX6PU" alt=""></p>
</div>

## 初期設定の流れ

### 1. サーバーの基本設定

```bash
# パッケージを最新化
sudo apt update && sudo apt upgrade -y

# Pythonと必要ツールをインストール
sudo apt install -y python3 python3-pip git
```

セキュリティのため、SSHは公開鍵認証にして、パスワードログインは無効化しておくのがおすすめです。

### 2. ボットを常駐させる

ボットを「ログアウトしても動き続ける」状態にするには、systemdでサービス化するのが確実です。

```ini
# /etc/systemd/system/trading-bot.service
[Unit]
Description=Trading Bot
After=network-online.target

[Service]
WorkingDirectory=/home/ubuntu/bot
ExecStart=/usr/bin/python3 live_bot.py
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

`Restart=always` を付けておけば、ボットが異常終了しても自動で再起動してくれます。

```bash
sudo systemctl enable --now trading-bot
```

### 3. 監視の仕組みを作る

24時間運用で一番怖いのは「止まっていることに気づかない」ことです。筆者は次の2段構えにしています。

- **systemdの自動再起動**: プロセスが落ちたら即復帰
- **定期ヘルスチェック**: ログの更新が止まっていないか、残高が異常に減っていないかを定期的に確認し、異常があれば通知する

## 補足: FX(MT4/EA)の自動売買ならFX特化VPSという選択肢も

この記事で紹介したのはLinux VPS(Pythonの自作ボット向け)ですが、**MT4/MT5のEAでFXの自動売買**をしたい場合は事情が変わります。MT4はWindowsアプリなので、Windows Serverが最初から入っているFX特化型のVPSを選んだほうがセットアップが圧倒的に楽です。

<div class="affiliate-box">
<span class="label">PR</span>
<p>FX自動売買(MT4/EA)向けにチューニングされたWindows VPS。MT4を動かす前提なら、汎用VPSにWindowsを載せるよりこちらのほうが手間もコストも抑えられます。</p>
<p><a href="https://px.a8.net/svt/ejp?a8mat=4B7U10+4Q9ZSI+CO4+44UKYA" rel="nofollow">XServer VPS for FX プレミアム</a>
<img border="0" width="1" height="1" src="https://www11.a8.net/0.gif?a8mat=4B7U10+4Q9ZSI+CO4+44UKYA" alt=""></p>
</div>

## まとめ

- ボットの24時間運用にはVPSがほぼ必須
- 自作ボット(Python)ならLinux VPS。スペックは最安プランで十分、月500円台から始められる
- MT4/EAでFXをやるならWindows入りのFX特化VPSが楽
- systemdでサービス化+自動再起動の設定までやって初めて「放置できる」状態になる

VPSが用意できたら、次は載せるボットです。[ccxtでのボット開発入門](/blog/ccxt-python-tutorial/)で作り方を、[Discord通知](/blog/discord-notification-bot/)で放置運用に必須の監視体制を解説しています。実際にVPS上で動かしているボットの成績は[グリッドボットの実運用記録](/blog/grid-bot-real-experience/)で公開中です。
