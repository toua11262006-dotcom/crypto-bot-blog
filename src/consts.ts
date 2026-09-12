// サイト全体の設定。サイト名を変えたいときはここを編集するだけでOK。

export const SITE_TITLE = 'ボット運用ラボ';
export const SITE_DESCRIPTION =
	'BTC自動売買ボットの開発・運用記録と、仮想通貨取引所の活用情報を発信する特化ブログ。バックテストや実運用に基づく一次情報をお届けします。';
export const AUTHOR_NAME = 'kamik';

// 記事カテゴリ。frontmatter の category には下記のキー(英数字)を書く。
// 新しいカテゴリを足したいときはここに追加する。
export const CATEGORIES = {
	basics: {
		label: '入門',
		description:
			'自動売買のしくみ、用語、取引所の機能など、これから始める人が最初に読むべき記事をまとめています。',
	},
	development: {
		label: '開発',
		description:
			'Python・ccxtでのボット開発、データ処理、機械学習、テストなど、実装まわりの解説記事です。',
	},
	strategy: {
		label: '戦略・検証',
		description:
			'グリッドや積立などの戦略と、バックテスト・ペーパートレードによる検証方法をまとめています。',
	},
	operations: {
		label: '運用・監視',
		description:
			'VPSでの24時間稼働、デプロイ、通知・監視、障害対応など、ボットを動かし続けるための記事です。',
	},
	exchanges: {
		label: '取引所',
		description: '取引所の選び方、API連携、送金手順など、取引所まわりの実務記事をまとめています。',
	},
	risk: {
		label: 'リスク・税金',
		description:
			'資金管理、APIキーの安全対策、確定申告や損益計算など、資産を守るための記事です。',
	},
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];
