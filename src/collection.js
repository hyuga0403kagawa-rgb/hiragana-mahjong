// ことば図鑑: 対局で実際に作ったことばを集めて記録する
// 記録対象は「自分が作ったことば」のみ (あがりの分解語 + 自分がポン/カンで晒した語)。
import { safeStorage } from "./storage.js";

const KEY = "hiragana_mahjong_collection_v1";

export const NEW_WORD_COIN = 3; // 新しいことば1つにつきもらえるコイン

// かな行の定義 (濁点・半濁点は清音の行に含める)
export const KANA_ROWS = [
  { row: "あ", chars: "あいうえお" },
  { row: "か", chars: "かきくけこがぎぐげご" },
  { row: "さ", chars: "さしすせそざじずぜぞ" },
  { row: "た", chars: "たちつてとだぢづでど" },
  { row: "な", chars: "なにぬねの" },
  { row: "は", chars: "はひふへほばびぶべぼぱぴぷぺぽ" },
  { row: "ま", chars: "まみむめも" },
  { row: "や", chars: "やゆよ" },
  { row: "ら", chars: "らりるれろ" },
  { row: "わ", chars: "わん" },
];
const CHAR_TO_ROW = new Map();
for (const g of KANA_ROWS) for (const c of g.chars) CHAR_TO_ROW.set(c, g.row);
export function rowOf(word) { return CHAR_TO_ROW.get(word[0]) || "そ"; }

export function loadCollection(storage = safeStorage) {
  try {
    const d = JSON.parse(storage.getItem(KEY));
    if (d && d.w && typeof d.w === "object") return { w: d.w };
  } catch { /* 破損時は初期化 */ }
  return { w: {} };
}
export function saveCollection(col, storage = safeStorage) {
  try { storage.setItem(KEY, JSON.stringify(col)); } catch { /* 保存不可環境 */ }
}

export function isFound(col, word) { return !!col.w[word]; }
export function foundCount(col) { return Object.keys(col.w).length; }

// ことばを記録する。戻り値の newWords が「はじめて作ったことば」。
export function recordWords(col, words) {
  const newWords = [];
  const w = { ...col.w };
  for (const word of words) {
    if (!word || w[word]) continue;
    w[word] = 1;
    newWords.push(word);
  }
  return { col: { w }, newWords };
}

// 図鑑の集計。dict は Dict インスタンス。
export function collectionStats(col, dict) {
  const byLen = {};
  for (const [len, set] of [[2, dict.w2], [3, dict.w3], [4, dict.w4]]) {
    let found = 0;
    for (const word of set) if (col.w[word]) found++;
    byLen[len] = { found, total: set.size };
  }
  const found = byLen[2].found + byLen[3].found + byLen[4].found;
  const total = byLen[2].total + byLen[3].total + byLen[4].total;
  return { byLen, found, total, percent: total ? Math.floor(found / total * 100) : 0 };
}

// 指定文字数のことばを行ごとにまとめる。戻り値: [{row, words:[{w, found}], found, total}]
export function groupByRow(col, dict, len) {
  const set = len === 2 ? dict.w2 : len === 3 ? dict.w3 : dict.w4;
  const groups = new Map();
  for (const g of KANA_ROWS) groups.set(g.row, []);
  for (const word of set) {
    const r = rowOf(word);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(word);
  }
  const out = [];
  for (const [row, words] of groups) {
    if (words.length === 0) continue;
    words.sort((a, b) => a.localeCompare(b, "ja"));
    const list = words.map(w => ({ w, found: !!col.w[w] }));
    out.push({ row, words: list, found: list.filter(x => x.found).length, total: list.length });
  }
  return out;
}
