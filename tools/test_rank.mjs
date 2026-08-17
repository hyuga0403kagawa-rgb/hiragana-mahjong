// ランクシステムのテスト: node tools/test_rank.mjs
import { RANKS, applyResult, loadRank, saveRank } from "../src/rank.js";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`FAIL - ${name}`); }
}

// 初期状態
const store = new Map();
const fakeStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
let s = loadRank(fakeStorage);
ok(s.rank === "G" && s.rp === 0, "初期はG 0RP");

// 1位で+30
let r = applyResult(s, 0);
ok(r.delta === 30 && r.state.rp === 30, "1位で+30RP");
// 4連続1位で昇格 (30*4=120 → F 20RP)
s = { rank: "G", rp: 90, games: 0, tops: 0 };
r = applyResult(s, 0);
ok(r.promoted && r.state.rank === "F" && r.state.rp === 20, "100RP到達で昇格・端数持ち越し");
// 4位で-25、0未満で降格
s = { rank: "F", rp: 10, games: 0, tops: 0 };
r = applyResult(s, 3);
ok(r.demoted && r.state.rank === "G" && r.state.rp === 70, "0未満でG降格→70RP");
// Gからは落ちない
s = { rank: "G", rp: 5, games: 0, tops: 0 };
r = applyResult(s, 3);
ok(!r.demoted && r.state.rank === "G" && r.state.rp === 0, "Gの下限は0");
// SはRP蓄積
s = { rank: "S", rp: 95, games: 0, tops: 0 };
r = applyResult(s, 0);
ok(!r.promoted && r.state.rank === "S" && r.state.rp === 125, "Sは昇格せず蓄積");
// 保存/復元
saveRank(r.state, fakeStorage);
const loaded = loadRank(fakeStorage);
ok(loaded.rank === "S" && loaded.rp === 125, "保存と復元");
// 全ランク昇格経路
s = { rank: "G", rp: 0, games: 0, tops: 0 };
let hops = 0;
while (s.rank !== "S" && hops < 100) { s = applyResult(s, 0).state; hops++; }
ok(s.rank === "S", `Gから1位連打でSに到達 (${hops}戦)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
