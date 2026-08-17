// 実績・称号のテスト: node tools/test_achievements.mjs
import {
  ACHIEVEMENTS, loadAchievements, saveAchievements, applyRoundResult, countMeld,
  applyGameEnd, syncProgress, checkUnlocks, currentTitle,
} from "../src/achievements.js";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`FAIL - ${name}`); }
}

const store = new Map();
const fakeStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };

// ID重複がないこと
ok(new Set(ACHIEVEMENTS.map(a => a.id)).size === ACHIEVEMENTS.length, `実績IDが一意 (${ACHIEVEMENTS.length}件)`);
ok(ACHIEVEMENTS.every(a => a.icon && a.name && a.desc && a.coin > 0 && typeof a.cond === "function"), "全実績に必要な項目がそろう");

let ach = loadAchievements(fakeStorage);
ok(ach.unlocked.length === 0 && ach.stats.wins === 0, "初期は未解除");
ok(checkUnlocks(ach).unlocked.length === 0, "何もしていなければ解除なし");

// あがりで first_win + tsumo_first
ach = applyRoundResult(ach, { won: true, type: "tsumo", score: 10, rare: 1, kans: 0 });
let r = checkUnlocks(ach);
ach = r.ach;
const ids = r.unlocked.map(a => a.id);
ok(ids.includes("first_win") && ids.includes("tsumo_first"), "初あがりとツモ実績が同時解除");
ok(r.coins === r.unlocked.reduce((s, a) => s + a.coin, 0), "報酬コインの合計が正しい");
ok(checkUnlocks(ach).unlocked.length === 0, "同じ実績は二重解除しない");

// レア牌の最大値は更新される
ach = applyRoundResult(ach, { won: true, type: "ron", score: 22, rare: 5, kans: 1 });
ok(ach.stats.maxRare === 5 && ach.stats.bestScore === 22 && ach.stats.kanWin === 1, "最高記録が更新される");
r = checkUnlocks(ach); ach = r.ach;
const ids2 = r.unlocked.map(a => a.id);
ok(ids2.includes("rare3") && ids2.includes("rare5") && ids2.includes("score20") && ids2.includes("kan_win") && ids2.includes("ron_first"),
  "レア牌・大物・カンあがり・ロンが解除");
ach = applyRoundResult(ach, { won: true, type: "tsumo", score: 8, rare: 0, kans: 0 });
ok(ach.stats.maxRare === 5 && ach.stats.bestScore === 22, "低いスコアでは最高記録が下がらない");

// 連続あがり
ok(ach.stats.streak === 3 && ach.stats.maxStreak === 3, "3連続あがり");
r = checkUnlocks(ach); ach = r.ach;
ok(r.unlocked.some(a => a.id === "streak3"), "連続あがり実績");
ach = applyRoundResult(ach, { won: false });
ok(ach.stats.streak === 0 && ach.stats.maxStreak === 3, "あがれないと連続は途切れるが最高記録は残る");

// 鳴きカウント
const before = ach.stats.pons;
ach = countMeld(ach, "pon");
ach = countMeld(ach, "kan");
ok(ach.stats.pons === before + 1 && ach.stats.kans === 1, "ポン・カンが別々に数えられる");
r = checkUnlocks(ach); ach = r.ach;
ok(r.unlocked.some(a => a.id === "kan_first"), "初カン実績");

// 対局終了
ach = applyGameEnd(ach, 0);
ok(ach.stats.games === 1 && ach.stats.tops === 1, "1位で対局数と1位数が増える");
ach = applyGameEnd(ach, 2);
ok(ach.stats.games === 2 && ach.stats.tops === 1, "3位では1位数は増えない");

// ランク・図鑑の同期
ach = syncProgress(ach, { words: 60, rank: "D" });
ok(ach.stats.words === 60 && ach.stats.rank === "D", "進捗が同期される");
ach = syncProgress(ach, { rank: "G" });
ok(ach.stats.rank === "D", "ランクは下がらない(到達ランクを保持)");
r = checkUnlocks(ach); ach = r.ach;
ok(r.unlocked.some(a => a.id === "words50") && r.unlocked.some(a => a.id === "rank_d"), "図鑑50語とDランク実績");
ok(!ach.unlocked.includes("rank_s"), "Sランク実績はまだ未解除");

// 称号
const t = currentTitle(ach);
ok(t && ach.unlocked.includes(t.id), "いまの称号は解除済みのもの");

// 保存/復元
saveAchievements(ach, fakeStorage);
const loaded = loadAchievements(fakeStorage);
ok(loaded.unlocked.length === ach.unlocked.length && loaded.stats.wins === ach.stats.wins, "保存と復元");
ok(loadAchievements({ getItem: () => "@@@", setItem: () => {} }).unlocked.length === 0, "壊れたデータでも初期化される");

// 全実績が到達可能か (十分な記録を与えれば全部解除できる)
let full = loadAchievements({ getItem: () => null, setItem: () => {} });
full = { ...full, stats: { ...full.stats, games: 99, wins: 99, tsumo: 9, ron: 9, tops: 99, pons: 99, kans: 99, bestScore: 99, maxRare: 9, kanWin: 9, words: 999, rank: "S", maxStreak: 9 } };
ok(checkUnlocks(full).unlocked.length === ACHIEVEMENTS.length, "十分な記録で全実績が解除できる");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
