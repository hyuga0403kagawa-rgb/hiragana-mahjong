// JMdict (EDRDG) から「かなで書ける常用語」を抽出して wordlist_jmdict.txt を作る
//   node tools/import_jmdict.mjs <JMdict_e.gz のパス>
// 出典: JMdict (https://www.edrdg.org/jmdict/j_jmdict.html)
//   このデータは EDRDG のライセンス (CC BY-SA 4.0 相当) に基づき使用。
// 抽出条件:
//   - エントリに優先度マーカー (ichi1/2, news1/2, spec1/2, gai1/2) が付いている = 常用語
//   - 読みが2〜4かな文字で、牌の制約 (使用可能文字・枚数) を満たす
//   - カタカナ読み (外来語) はひらがなに変換して採用 (「ー」も牌にある)
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) { console.error("usage: node tools/import_jmdict.mjs <JMdict_e.gz>"); process.exit(1); }

const xml = gunzipSync(readFileSync(src)).toString("utf8");
console.log(`XML ${(xml.length / 1024 / 1024).toFixed(1)} MB`);

const SEION = new Set("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわん");
const RARE = new Set("がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽゃゅょっー");
function playable(word) {
  const chars = [...word];
  if (chars.length < 2 || chars.length > 4) return false;
  const counts = {};
  for (const c of chars) {
    if (!SEION.has(c) && !RARE.has(c)) return false;
    counts[c] = (counts[c] || 0) + 1;
    if (counts[c] > (SEION.has(c) ? 2 : 1)) return false;
  }
  return true;
}
// カタカナ→ひらがな (ヴ等の変換不能文字はそのまま残し playable() ではじく)
function kataToHira(s) {
  return [...s].map(c => {
    const code = c.codePointAt(0);
    return (code >= 0x30A1 && code <= 0x30F6) ? String.fromCodePoint(code - 0x60) : c;
  }).join("");
}

const PRI = /<re_pri>(?:ichi[12]|news[12]|spec[12]|gai[12])<\/re_pri>/;
const picked = new Set();
let entries = 0, prioritized = 0;

// <entry>単位で走査 (10万エントリ規模なので正規表現の逐次実行で十分速い)
const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
let m;
while ((m = entryRe.exec(xml)) !== null) {
  entries++;
  const body = m[1];
  if (!PRI.test(body)) continue;
  prioritized++;
  // 読みごとに優先度を見る (優先マーカーの付いた読みだけを使う)
  const rRe = /<r_ele>([\s\S]*?)<\/r_ele>/g;
  let r;
  while ((r = rRe.exec(body)) !== null) {
    if (!PRI.test(r[1])) continue;
    const reb = /<reb>([^<]+)<\/reb>/.exec(r[1]);
    if (!reb) continue;
    const word = kataToHira(reb[1]);
    if (playable(word)) picked.add(word);
  }
}

const sorted = [...picked].sort((a, b) => a.localeCompare(b, "ja"));
const byLen = { 2: 0, 3: 0, 4: 0 };
for (const w of sorted) byLen[[...w].length]++;

const header = [
  "# JMdict (EDRDG) 由来の常用語リスト。tools/import_jmdict.mjs が生成。",
  "# 抽出条件: 優先度マーカー付き読み / 2〜4かな / 牌の文字・枚数制約を満たす",
  "# ライセンス: この語彙リストは EDRDG の JMdict を元にしている (CC BY-SA)。",
].join("\n");
writeFileSync(join(TOOLS, "wordlist_jmdict.txt"), header + "\n" + sorted.join("\n") + "\n");
console.log(`全${entries}エントリ中、常用${prioritized}件 → 採用${sorted.length}語 (2字${byLen[2]} / 3字${byLen[3]} / 4字${byLen[4]})`);
