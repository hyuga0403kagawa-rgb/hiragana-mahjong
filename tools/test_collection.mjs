// ことば図鑑のテスト: node tools/test_collection.mjs
import {
  loadCollection, saveCollection, recordWords, collectionStats, groupByRow, rowOf, isFound, foundCount,
} from "../src/collection.js";
import { Dict } from "../src/engine.js";
import { WORDS2, WORDS3, WORDS4 } from "../src/data/words.js";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`FAIL - ${name}`); }
}

const dict = new Dict(WORDS2, WORDS3, WORDS4);
const store = new Map();
const fakeStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };

let col = loadCollection(fakeStorage);
ok(foundCount(col) === 0, "初期は0語");

// 記録
let r = recordWords(col, ["うみ", "さくら", "うみ"]);
ok(r.newWords.length === 2, "重複を除いて2語が新発見");
col = r.col;
ok(isFound(col, "うみ") && foundCount(col) === 2, "記録される");
r = recordWords(col, ["うみ"]);
ok(r.newWords.length === 0, "2回目は新発見にならない");

// 行分類
ok(rowOf("さくら") === "さ", "さくら→さ行");
ok(rowOf("がっこう") === "か", "濁音がは か行");
ok(rowOf("ぱんだ") === "は", "半濁音ぱは は行");
ok(rowOf("んー") === "わ", "んは わ行");

// 集計
const st = collectionStats(col, dict);
ok(st.total === WORDS2.length + WORDS3.length + WORDS4.length, `総語数が辞書と一致 (${st.total})`);
ok(st.byLen[2].total === WORDS2.length && st.byLen[3].total === WORDS3.length, "文字数別の総数");
ok(st.found === 2 && st.percent === 0, "発見2語・端数は切り捨て");

// 行グループ
const groups = groupByRow(col, dict, 3);
const sum = groups.reduce((s, g) => s + g.total, 0);
ok(sum === WORDS3.length, "行グループの合計が3文字語の総数と一致");
const sakuraGroup = groups.find(g => g.row === "さ");
ok(sakuraGroup && sakuraGroup.words.some(w => w.w === "さくら" && w.found), "発見済みフラグが立つ");
ok(groups.every(g => g.words.every((w, i, a) => i === 0 || a[i - 1].w.localeCompare(w.w, "ja") <= 0)), "各行はソート済み");

// 辞書の全語が必ずどこかの行に入る (「そ(の他)」に落ちていない)
const allGroups = [2, 3, 4].flatMap(len => groupByRow(col, dict, len));
ok(allGroups.every(g => g.row !== "そ"), "未分類の行が無い");

// 保存/復元
saveCollection(col, fakeStorage);
const loaded = loadCollection(fakeStorage);
ok(foundCount(loaded) === 2 && isFound(loaded, "さくら"), "保存と復元");

// 破損データからの回復
const badStore = { getItem: () => "{{{", setItem: () => {} };
ok(foundCount(loadCollection(badStore)) === 0, "壊れたデータでも初期化される");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
