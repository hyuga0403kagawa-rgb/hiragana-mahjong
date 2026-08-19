// 「並べてあがる」方式の手ざわりを測る: node tools/measure_arrange.mjs [試行回数]
// 知りたいこと:
//   1. 配牌13枚から「あと1枚であがれる形」に並べ替えられる割合 (= ロンの下地の作りやすさ)
//   2. その形にしたとき、待ち牌は何種類あるか (= ロンの現実的な当たりやすさ)
//   3. 14枚であがれる手のとき、ブロックの並べ替えでどれだけ手間がかかるか
import {
  Dict, buildTileSet, shuffle, mulberry32, findWin, bestSegmentation,
  SEION, DAKUON, HANDAKUON, KOMOJI, CHOON,
} from "../src/engine.js";
import { WORDS2, WORDS3, WORDS4 } from "../src/data/words.js";

const dict = new Dict(WORDS2, WORDS3, WORDS4);
const N = +(process.argv[2] || 200);
const ALL_TILES = [...SEION, ...DAKUON, ...HANDAKUON, ...KOMOJI, ...CHOON];

// 13枚のうち12枚を「2+3+3+... の完成ブロック」で埋められるか探す。
// 埋められれば、残り1枚+ツモ牌で最後のブロックが完成しうる = テンパイの下地。
// need3=4 の場合: 4ブロック完成 + 2枚 (1ブロックが1枚不足) の形を探す。
function canFormWaitingShape(tiles, need3) {
  // findWin で「1枚足せばあがれる」牌が存在するかを調べる (待ち牌の種類も返す)
  const waits = [];
  for (const t of ALL_TILES) {
    if (findWin([...tiles, t], need3, dict)) waits.push(t);
  }
  return waits;
}

let tenpaiCount = 0;
let waitsSum = 0;
const waitsDist = [];
const rng = mulberry32(20260820);

console.log(`辞書: ${dict.w2.size + dict.w3.size + dict.w4.size}語`);
console.log(`配牌13枚を${N}回ためす...`);
for (let i = 0; i < N; i++) {
  const hand = shuffle(buildTileSet(), rng).slice(0, 13);
  const waits = canFormWaitingShape(hand, 4);
  if (waits.length > 0) {
    tenpaiCount++;
    waitsSum += waits.length;
    waitsDist.push(waits.length);
  }
}
waitsDist.sort((a, b) => a - b);
const median = waitsDist.length ? waitsDist[Math.floor(waitsDist.length / 2)] : 0;

console.log("");
console.log("■ ロンの下地 (配牌13枚の時点)");
console.log(`  「あと1枚であがれる」形が作れる配牌: ${(tenpaiCount / N * 100).toFixed(1)}%`);
console.log(`  そのときの待ち牌の種類: 平均 ${tenpaiCount ? (waitsSum / tenpaiCount).toFixed(1) : 0}種 / 中央値 ${median}種 (全51種中)`);

// 待ち牌の種類が多いほど、他家の捨て牌に当たりやすい = ロンしやすい
const p = tenpaiCount ? (waitsSum / tenpaiCount) / 51 : 0;
console.log(`  → 他家の捨て牌1枚がロンになる確率のめやす: ${(p * 100).toFixed(1)}%`);

// ---- 14枚であがれる手の「並べ替えやすさ」 ----
// あがれる手を作り、あいうえお順から目標の並びまで何手かかるかを数える
function movesToArrange(from, to) {
  const cur = [...from];
  let moves = 0;
  for (let i = 0; i < to.length; i++) {
    if (cur[i] === to[i]) continue;
    const j = cur.indexOf(to[i], i);
    if (j < 0) return -1;
    cur.splice(j, 1);
    cur.splice(i, 0, to[i]);
    moves++;
  }
  return moves;
}
let winnable = 0, movesSum = 0, blocksAtStart = 0;
for (let i = 0; i < N; i++) {
  const hand = shuffle(buildTileSet(), rng).slice(0, 14);
  const win = findWin(hand, 4, dict);
  if (!win) continue;
  winnable++;
  const target = [...(win.two || ""), ...win.threes.join("")];
  const sorted = [...hand].sort((a, b) => a.localeCompare(b, "ja"));
  const mv = movesToArrange(sorted, target);
  if (mv >= 0) movesSum += mv;
  const seg = bestSegmentation(sorted, 4, dict);
  if (seg) blocksAtStart += seg.validCount;
}
console.log("");
console.log(`■ 並べ替えの手間 (あがれる14枚・${winnable}件)`);
console.log(`  あいうえお順 → あがりの並び に必要なドラッグ: 平均 ${winnable ? (movesSum / winnable).toFixed(1) : 0}回`);
console.log(`  あいうえお順の時点で偶然そろっているブロック数: 平均 ${winnable ? (blocksAtStart / winnable).toFixed(2) : 0} / 5`);
