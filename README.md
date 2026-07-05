# ボット運用ラボ(アフィリエイトブログ)

BTC自動売買・仮想通貨特化のアフィリエイトブログ。Astro製の静的サイト。

## 日常の使い方

| やること | 方法 |
| --- | --- |
| 記事を書く | `src/content/blog/` に `.md` ファイルを追加 |
| プレビュー | `npm run dev` → http://localhost:4321 |
| 本番ビルド | `npm run build`(`dist/` に出力) |
| サイト名変更 | `src/consts.ts` を編集 |

### 記事のテンプレート

```markdown
---
title: '記事タイトル(32文字前後、検索キーワードを含める)'
description: '記事の説明(SEOのmeta descriptionになる。100文字前後)'
pubDate: '2026-07-05'
heroImage: '../../assets/blog-placeholder-1.jpg'
---

本文をMarkdownで書く。
```

- 広告表記(※本記事にはアフィリエイト広告~)は全記事に自動で入る(`src/layouts/BlogPost.astro`)
- アイキャッチ画像は `src/assets/` に置いて frontmatter から参照

## 公開までのチェックリスト

1. **GitHubにpush** — このフォルダで `git init` → GitHubにリポジトリ作成 → push
2. **Cloudflare Pagesにデプロイ(無料)**
   - https://dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git
   - ビルドコマンド: `npm run build` / 出力ディレクトリ: `dist`(Astroプリセットで自動設定される)
   - `*.pages.dev` のURLで即公開される
3. **`astro.config.mjs` の `site` を実際のURLに変更**(sitemap・OGP用)
4. **独自ドメイン(任意、年1,500円程度)** — Cloudflare Registrarが原価で安い。ASP審査には独自ドメインが有利
5. **ASP(アフィリエイト)登録** — 記事10本前後・プライバシーポリシー設置後に申請すると通りやすい
   - [A8.net](https://www.a8.net/) — 最大手。国内取引所・VPS案件あり。審査ゆるめ
   - [アクセストレード](https://www.accesstrade.ne.jp/) — 金融・仮想通貨案件が強い
   - [もしもアフィリエイト](https://af.moshimo.com/) — Amazon・楽天をまとめて扱える
   - 海外取引所(MEXC/Bitget/Bybit等)— 各取引所公式のリファラルプログラムから直接
6. **Google Search Console 登録** — サイトマップ(`/sitemap-index.xml`)を送信
7. **X(Twitter)アカウント連携** — `src/pages/about.astro` のTODOを自分のアカウントに差し替え

## 収益化の目安

- 最初の3ヶ月は検索流入がほぼゼロでも正常(SEOは時間がかかる)
- まず20〜30記事を目標に。1記事=1検索キーワードを意識する
- 強い一次情報(実運用の成績・バックテスト結果・失敗談)が最大の差別化要素
