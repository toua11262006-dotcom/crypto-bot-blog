import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';

const require = createRequire('C:/Users/kamik/Desktop/crypto-bot-blog/package.json');
const sharp = require('sharp');

const OUT = 'C:/Users/kamik/Desktop/crypto-bot-blog/src/assets/eyecatch';
mkdirSync(OUT, { recursive: true });

const FONT = "'Yu Gothic UI','Yu Gothic','Meiryo',sans-serif";

// アイコン: 100x100 viewBox の stroke パス
const icons = {
	robot: (c) => `
		<rect x="20" y="32" width="60" height="44" rx="10" fill="none" stroke="${c}" stroke-width="6"/>
		<circle cx="38" cy="52" r="4.5" fill="${c}"/>
		<circle cx="62" cy="52" r="4.5" fill="${c}"/>
		<line x1="42" y1="65" x2="58" y2="65" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
		<line x1="50" y1="32" x2="50" y2="20" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
		<circle cx="50" cy="16" r="4" fill="${c}"/>`,
	server: (c) => `
		<rect x="24" y="24" width="52" height="21" rx="5" fill="none" stroke="${c}" stroke-width="6"/>
		<rect x="24" y="55" width="52" height="21" rx="5" fill="none" stroke="${c}" stroke-width="6"/>
		<circle cx="35" cy="34.5" r="3.5" fill="${c}"/>
		<circle cx="35" cy="65.5" r="3.5" fill="${c}"/>
		<line x1="55" y1="34.5" x2="68" y2="34.5" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
		<line x1="55" y1="65.5" x2="68" y2="65.5" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,
	bank: (c) => `
		<path d="M20 44 L50 24 L80 44" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
		<line x1="30" y1="52" x2="30" y2="70" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
		<line x1="50" y1="52" x2="50" y2="70" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
		<line x1="70" y1="52" x2="70" y2="70" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
		<line x1="22" y1="78" x2="78" y2="78" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`,
	zzz: (c) => `
		<text x="26" y="52" font-family="${FONT}" font-size="40" font-weight="bold" fill="${c}">Z</text>
		<text x="52" y="66" font-family="${FONT}" font-size="30" font-weight="bold" fill="${c}">z</text>
		<text x="70" y="78" font-family="${FONT}" font-size="22" font-weight="bold" fill="${c}">z</text>`,
	chart: (c) => `
		<polyline points="20,28 20,76 80,76" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
		<polyline points="28,64 42,48 54,56 74,32" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
		<circle cx="74" cy="32" r="4.5" fill="${c}"/>`,
	grid: (c) => {
		let s = '';
		for (const i of [0, 1, 2])
			for (const j of [0, 1, 2])
				s += `<rect x="${26 + i * 18}" y="${26 + j * 18}" width="13" height="13" rx="3" fill="none" stroke="${c}" stroke-width="5"/>`;
		return s;
	},
	bell: (c) => `
		<path d="M50 22 C39 22 33 32 33 46 L33 58 L26 66 L74 66 L67 58 L67 46 C67 32 61 22 50 22 Z" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>
		<path d="M43 72 a7 7 0 0 0 14 0" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`,
	lock: (c) => `
		<rect x="29" y="46" width="42" height="32" rx="7" fill="none" stroke="${c}" stroke-width="6"/>
		<path d="M37 46 v-9 a13 13 0 0 1 26 0 v9" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
		<circle cx="50" cy="61" r="4.5" fill="${c}"/>`,
	code: (c) => `
		<polyline points="36,36 24,50 36,64" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
		<polyline points="64,36 76,50 64,64" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
		<line x1="56" y1="30" x2="44" y2="70" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`,
	send: (c) => `
		<path d="M22 52 L80 24 L58 78 L45 58 Z" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>
		<line x1="45" y1="58" x2="80" y2="24" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,
	calc: (c) => `
		<rect x="30" y="18" width="40" height="64" rx="7" fill="none" stroke="${c}" stroke-width="6"/>
		<rect x="38" y="26" width="24" height="12" rx="2" fill="${c}"/>
		<circle cx="41" cy="52" r="3.5" fill="${c}"/>
		<circle cx="52" cy="52" r="3.5" fill="${c}"/>
		<circle cx="63" cy="52" r="3.5" fill="${c}"/>
		<circle cx="41" cy="64" r="3.5" fill="${c}"/>
		<circle cx="52" cy="64" r="3.5" fill="${c}"/>
		<circle cx="63" cy="64" r="3.5" fill="${c}"/>`,
	plug: (c) => `
		<circle cx="50" cy="54" r="20" fill="none" stroke="${c}" stroke-width="6"/>
		<line x1="42" y1="34" x2="42" y2="20" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
		<line x1="58" y1="34" x2="58" y2="20" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
		<line x1="50" y1="74" x2="50" y2="84" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`,
	coins: (c) => `
		<ellipse cx="50" cy="32" rx="22" ry="8" fill="none" stroke="${c}" stroke-width="5"/>
		<ellipse cx="50" cy="50" rx="22" ry="8" fill="none" stroke="${c}" stroke-width="5"/>
		<ellipse cx="50" cy="68" rx="22" ry="8" fill="none" stroke="${c}" stroke-width="5"/>
		<line x1="28" y1="32" x2="28" y2="68" stroke="${c}" stroke-width="5"/>
		<line x1="72" y1="32" x2="72" y2="68" stroke="${c}" stroke-width="5"/>`,
	shield: (c) => `
		<path d="M50 18 L78 28 V50 C78 66 66 78 50 84 C34 78 22 66 22 50 V28 Z" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>
		<polyline points="40,50 47,58 62,42" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
	target: (c) => `
		<circle cx="50" cy="50" r="28" fill="none" stroke="${c}" stroke-width="6"/>
		<circle cx="50" cy="50" r="16" fill="none" stroke="${c}" stroke-width="6"/>
		<circle cx="50" cy="50" r="4.5" fill="${c}"/>`,
	scale: (c) => `
		<line x1="50" y1="18" x2="50" y2="80" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
		<line x1="26" y1="30" x2="74" y2="30" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
		<line x1="36" y1="76" x2="64" y2="76" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
		<path d="M26 30 L16 52 a10 8 0 0 0 20 0 Z" fill="none" stroke="${c}" stroke-width="5" stroke-linejoin="round"/>
		<path d="M74 30 L64 52 a10 8 0 0 0 20 0 Z" fill="none" stroke="${c}" stroke-width="5" stroke-linejoin="round"/>`,
	brain: (c) => `
		<circle cx="30" cy="30" r="7" fill="none" stroke="${c}" stroke-width="5"/>
		<circle cx="30" cy="70" r="7" fill="none" stroke="${c}" stroke-width="5"/>
		<circle cx="70" cy="20" r="7" fill="none" stroke="${c}" stroke-width="5"/>
		<circle cx="70" cy="50" r="7" fill="none" stroke="${c}" stroke-width="5"/>
		<circle cx="70" cy="80" r="7" fill="none" stroke="${c}" stroke-width="5"/>
		<line x1="36" y1="30" x2="64" y2="20" stroke="${c}" stroke-width="4"/>
		<line x1="36" y1="30" x2="64" y2="50" stroke="${c}" stroke-width="4"/>
		<line x1="36" y1="70" x2="64" y2="50" stroke="${c}" stroke-width="4"/>
		<line x1="36" y1="70" x2="64" y2="80" stroke="${c}" stroke-width="4"/>`,
	bug: (c) => `
		<ellipse cx="50" cy="56" rx="17" ry="21" fill="none" stroke="${c}" stroke-width="6"/>
		<path d="M39 38 a11 11 0 0 1 22 0" fill="none" stroke="${c}" stroke-width="6"/>
		<line x1="33" y1="46" x2="20" y2="40" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
		<line x1="33" y1="58" x2="18" y2="58" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
		<line x1="33" y1="68" x2="20" y2="76" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
		<line x1="67" y1="46" x2="80" y2="40" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
		<line x1="67" y1="58" x2="82" y2="58" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
		<line x1="67" y1="68" x2="80" y2="76" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,
	book: (c) => `
		<path d="M50 28 C42 22 30 20 20 22 V72 C30 70 42 72 50 78 C58 72 70 70 80 72 V22 C70 20 58 22 50 28 Z" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>
		<line x1="50" y1="28" x2="50" y2="78" stroke="${c}" stroke-width="5"/>
		<line x1="28" y1="34" x2="42" y2="36" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
		<line x1="28" y1="44" x2="42" y2="46" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
		<line x1="58" y1="36" x2="72" y2="34" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
		<line x1="58" y1="46" x2="72" y2="44" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`,
	gauge: (c) => `
		<path d="M20 66 A30 30 0 0 1 80 66" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
		<line x1="50" y1="66" x2="66" y2="42" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
		<circle cx="50" cy="66" r="5" fill="${c}"/>
		<circle cx="20" cy="66" r="3.5" fill="${c}"/>
		<circle cx="80" cy="66" r="3.5" fill="${c}"/>`,
};

const posts = [
	{ slug: 'crypto-bot-basics', bg: '#04342C', mid: '#5DCAA5', light: '#E1F5EE', chipB: '#0F6E56', chipT: '#9FE1CB', cat: '入門', icon: 'robot', title: '自動売買ボットとは?' },
	{ slug: 'vps-bot-24h', bg: '#042C53', mid: '#85B7EB', light: '#E6F1FB', chipB: '#185FA5', chipT: '#B5D4F4', cat: '環境構築', icon: 'server', title: 'VPSで24時間運用' },
	{ slug: 'how-to-choose-exchange', bg: '#26215C', mid: '#AFA9EC', light: '#EEEDFE', chipB: '#534AB7', chipT: '#CECBF6', cat: '取引所', icon: 'bank', title: '取引所の選び方' },
	{ slug: 'bot-dormant-bug-story', bg: '#4A1B0C', mid: '#F0997B', light: '#FAECE7', chipB: '#993C1D', chipT: '#F5C4B3', cat: '失敗談', icon: 'zzz', title: 'ボット休眠バグ事件' },
	{ slug: 'backtest-pitfalls', bg: '#412402', mid: '#EF9F27', light: '#FAEEDA', chipB: '#854F0B', chipT: '#FAC775', cat: '検証', icon: 'chart', title: 'バックテストの罠' },
	{ slug: 'grid-bot-real-experience', bg: '#173404', mid: '#97C459', light: '#EAF3DE', chipB: '#3B6D11', chipT: '#C0DD97', cat: '戦略', icon: 'grid', title: 'グリッドトレードの現実' },
	{ slug: 'discord-notification-bot', bg: '#26215C', mid: '#AFA9EC', light: '#EEEDFE', chipB: '#534AB7', chipT: '#CECBF6', cat: '監視', icon: 'bell', title: 'Discord通知の作り方' },
	{ slug: 'api-key-security', bg: '#501313', mid: '#F09595', light: '#FCEBEB', chipB: '#A32D2D', chipT: '#F7C1C1', cat: 'セキュリティ', icon: 'lock', title: 'APIキーの安全管理' },
	{ slug: 'ccxt-python-tutorial', bg: '#042C53', mid: '#85B7EB', light: '#E6F1FB', chipB: '#185FA5', chipT: '#B5D4F4', cat: '開発', icon: 'code', title: 'Python×ccxt入門' },
	{ slug: 'mexc-api-bot-guide', bg: '#04342C', mid: '#5DCAA5', light: '#E1F5EE', chipB: '#0F6E56', chipT: '#9FE1CB', cat: '取引所', icon: 'plug', title: 'MEXCでAPI自動売買' },
	{ slug: 'crypto-bot-tax-guide', bg: '#4B1528', mid: '#ED93B1', light: '#FBEAF0', chipB: '#993556', chipT: '#F4C0D1', cat: '税金', icon: 'calc', title: 'ボット運用者の確定申告' },
	{ slug: 'domestic-to-mexc-transfer', bg: '#4A1B0C', mid: '#F0997B', light: '#FAECE7', chipB: '#993C1D', chipT: '#F5C4B3', cat: '送金', icon: 'send', title: '国内取引所→MEXC送金' },
	{ slug: 'btc-dca-bot', bg: '#033B47', mid: '#5CC6D6', light: '#E0F4F7', chipB: '#0F6979', chipT: '#A7E2EC', cat: '積立', icon: 'coins', title: 'DCA積立ボットの作り方' },
	{ slug: 'bot-risk-management', bg: '#2C2C2A', mid: '#B4B2A9', light: '#F1EFE8', chipB: '#5F5E5A', chipT: '#D3D1C7', cat: 'リスク管理', icon: 'shield', title: '資金管理・リスク管理' },
	{ slug: 'is-bot-profitable', bg: '#3D2B08', mid: '#EF9F27', light: '#FAEEDA', chipB: '#854F0B', chipT: '#FAC775', cat: '期待値', icon: 'target', title: 'ボットは儲かるのか?' },
	{ slug: 'vps-comparison', bg: '#042C53', mid: '#85B7EB', light: '#E6F1FB', chipB: '#185FA5', chipT: '#B5D4F4', cat: '比較', icon: 'scale', title: 'VPS徹底比較' },
	{ slug: 'lightgbm-signal-tutorial', bg: '#26215C', mid: '#AFA9EC', light: '#EEEDFE', chipB: '#534AB7', chipT: '#CECBF6', cat: '機械学習', icon: 'brain', title: 'LightGBM入門' },
	{ slug: 'trading-metrics-guide', bg: '#173404', mid: '#97C459', light: '#EAF3DE', chipB: '#3B6D11', chipT: '#C0DD97', cat: '成績指標', icon: 'gauge', title: '成績指標の読み方' },
	{ slug: 'ccxt-cheatsheet', bg: '#042C53', mid: '#85B7EB', light: '#E6F1FB', chipB: '#185FA5', chipT: '#B5D4F4', cat: '早見表', icon: 'book', title: 'ccxtの使い方まとめ' },
	{ slug: 'ccxt-common-errors', bg: '#5E1A1A', mid: '#F09595', light: '#FCEBEB', chipB: '#A32D2D', chipT: '#F7C1C1', cat: 'エラー対処', icon: 'bug', title: 'ccxtのエラーと対処法' },
];

function svgFor(p) {
	const chipW = 64 + p.cat.length * 42;
	return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
	<rect width="1200" height="630" fill="${p.bg}"/>
	<circle cx="1120" cy="560" r="260" fill="none" stroke="${p.mid}" stroke-width="2" opacity="0.25"/>
	<circle cx="1160" cy="600" r="380" fill="none" stroke="${p.mid}" stroke-width="2" opacity="0.15"/>
	<rect x="80" y="72" width="${chipW}" height="66" rx="33" fill="none" stroke="${p.chipB}" stroke-width="3"/>
	<text x="${80 + chipW / 2}" y="116" text-anchor="middle" font-family="${FONT}" font-size="34" fill="${p.chipT}">${p.cat}</text>
	<g transform="translate(920,60) scale(2.2)">${icons[p.icon](p.mid)}</g>
	<text x="80" y="472" font-family="${FONT}" font-size="76" font-weight="bold" fill="${p.light}">${p.title}</text>
	<line x1="84" y1="512" x2="244" y2="512" stroke="${p.mid}" stroke-width="6" stroke-linecap="round"/>
	<text x="80" y="566" font-family="${FONT}" font-size="32" fill="${p.mid}">ボット運用ラボ</text>
</svg>`;
}

for (const p of posts) {
	const svg = svgFor(p);
	await sharp(Buffer.from(svg), { density: 96 }).png().toFile(`${OUT}/${p.slug}.png`);
	console.log('generated:', p.slug);
}
console.log('done');
