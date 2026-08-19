// 候補リスト(tools/wordlist*.txt)を読み、牌制約でフィルタして src/data/words.js を生成する
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TOOLS, '..');

const SEION = new Set('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわん');
const RARE = new Set('がぎぐげございじずぜぞだぢづでどばびぶべぼぱぴぷぺぽゃゅょっー');

function check(word) {
  const chars = [...word];
  // 小文字・長音で始まる語は接尾語 (って/っぽい等) なので単語として扱わない
  if ("ゃゅょっー".includes(chars[0])) return "先頭が小文字/長音";
  const counts = {};
  for (const c of chars) {
    if (!SEION.has(c) && !RARE.has(c)) return `禁止文字「${c}」`;
    counts[c] = (counts[c] || 0) + 1;
    const max = SEION.has(c) ? 2 : 1;
    if (counts[c] > max) return `枚数超過「${c}」x${counts[c]}`;
  }
  return null;
}

// 方針変更 (2026-08-15 ユーザー指示): 辞書は「全網羅」する。
// wordlist*.txt すべて + JMdict由来の常用語 (wordlist_jmdict.txt) を採用。
// テンポはCPUの語彙率 (難易度) 側で制御する。実測KPIは SPEC.md を参照。
const FILES = readdirSync(TOOLS).filter(f => /^wordlist.*\.txt$/.test(f));
console.log(`入力: ${FILES.join(", ")}`);

// 手作業で選んだ語彙 (JMdict由来を除く) = 「誰でも知っていることば」。
// ひとり練習の出題に使うので、辞書本体とは別に出力する。
const CURATED_FILES = FILES.filter(f => f !== "wordlist_jmdict.txt");
const curated = { 2: new Set(), 3: new Set() };

const buckets = { 2: new Set(), 3: new Set(), 4: new Set() };
const rejected = [];
const dupes = [];
for (const f of FILES) {
  for (const line of readFileSync(join(TOOLS, f), 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    for (const w of line.trim().split(/\s+/)) {
    if (!w) continue;
    const len = [...w].length;
    if (!buckets[len]) { rejected.push(`${w} (長さ${len})`); continue; }
    const err = check(w);
    if (err) { rejected.push(`${w} (${err})`); continue; }
    if (curated[len] && CURATED_FILES.includes(f)) curated[len].add(w);
    if (buckets[len].has(w)) { dupes.push(w); continue; }
    buckets[len].add(w);
    }
  }
}

const sorted = {};
for (const k of [2, 3, 4]) sorted[k] = [...buckets[k]].sort((a, b) => a.localeCompare(b, 'ja'));

const fmt = arr => {
  const lines = [];
  for (let i = 0; i < arr.length; i += 10)
    lines.push('  ' + arr.slice(i, i + 10).map(w => `"${w}"`).join(', ') + ',');
  return lines.join('\n');
};

const out = `// ひらがな麻雀 単語辞書(自動生成: tools/build_words.mjs)
// 牌制約: 清音は同一文字2回まで、濁音・半濁音・小文字・長音は1回まで
export const WORDS2 = [
${fmt(sorted[2])}
];

export const WORDS3 = [
${fmt(sorted[3])}
];

export const WORDS4 = [
${fmt(sorted[4])}
];

// 手作業で選んだ「誰でも知っていることば」。ひとり練習の出題に使う。
export const CORE2 = [
${fmt([...curated[2]].sort((a, b) => a.localeCompare(b, "ja")))}
];

export const CORE3 = [
${fmt([...curated[3]].sort((a, b) => a.localeCompare(b, "ja")))}
];
`;

mkdirSync(join(ROOT, 'src', 'data'), { recursive: true });
writeFileSync(join(ROOT, 'src', 'data', 'words.js'), out, 'utf8');

console.log(`WORDS2: ${sorted[2].length}語 / WORDS3: ${sorted[3].length}語 / WORDS4: ${sorted[4].length}語`);
console.log(`練習用コア語彙: CORE2 ${curated[2].size}語 / CORE3 ${curated[3].size}語`);
console.log(`重複除去: ${dupes.length}件`);
console.log(`除外: ${rejected.length}件`);
for (const r of rejected) console.log('  REJECT ' + r);
