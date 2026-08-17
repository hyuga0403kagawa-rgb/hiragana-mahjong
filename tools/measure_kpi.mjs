// ゲームバランスKPIの測定: node tools/measure_kpi.mjs [試行回数]
// SPEC.md のKPI (配牌テンパイ率 / 平均和了巡目 / 難易度別トップ率) を実測する。
// 辞書の採否はこの数値を根拠に決める。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Game, Phase, Dict, subsetDict, mulberry32, buildTileSet, shuffle, findWaits,
} from "../src/engine.js";
import { chooseDiscard, shouldPon, shouldKan } from "../src/ai.js";
import { WORDS2, WORDS3, WORDS4 } from "../src/data/words.js";

const TOOLS = dirname(fileURLToPath(import.meta.url));
const N = +(process.argv[2] || 300);

const SEION = new Set("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわん");
const RARE = new Set("がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽゃゅょっー");
function playable(word) {
  const seen = {};
  for (const c of [...word]) {
    if (!SEION.has(c) && !RARE.has(c)) return false;
    seen[c] = (seen[c] || 0) + 1;
    if (seen[c] > (SEION.has(c) ? 2 : 1)) return false;
  }
  return true;
}
// 補充バッチも含めた「全辞書」を組み立てる (比較用)
function loadFullDict() {
  const buckets = { 2: new Set(), 3: new Set(), 4: new Set() };
  for (const f of readdirSync(TOOLS).filter(f => /^wordlist.*\.txt$/.test(f))) {
    for (const line of readFileSync(join(TOOLS, f), "utf8").split(/\r?\n/)) {
      const w = line.trim();
      if (!w || !playable(w)) continue;
      const len = [...w].length;
      if (buckets[len]) buckets[len].add(w);
    }
  }
  return new Dict(buckets[2], buckets[3], buckets[4]);
}

const coreDict = new Dict(WORDS2, WORDS3, WORDS4);
const fullDict = loadFullDict();

// ---- 1. 配牌テンパイ率 (13枚があと1枚で上がれる割合) ----
function dealTenpaiRate(dict, trials, seed = 1) {
  const rng = mulberry32(seed);
  let tenpai = 0;
  for (let i = 0; i < trials; i++) {
    const hand = shuffle(buildTileSet(), rng).slice(0, 13);
    if (findWaits(hand, 4, dict).length > 0) tenpai++;
  }
  return tenpai / trials;
}

// ---- 2. 1局を最後まで進めて和了巡目を返す ----
// 巡目 = 自分の手番が回ってきた回数 (山から引いた総回数 / 人数)
function playRound(g, dicts) {
  let draws = 0;
  let steps = 0;
  while (steps++ < 3000) {
    if (g.phase === Phase.ROUND_END || g.phase === Phase.GAME_END) break;
    if (g.phase === Phase.DRAW) {
      if (g.drawTile() === null) return { type: "draw", turns: draws / g.n };
      draws++;
    }
    const p = g.turn;
    let inner = 0;
    while (inner++ < 10) {
      if (g.hands[p].length === g.fullHandSize(p) && g.canTsumo(p)) {
        g.winByTsumo(p);
        return { type: "tsumo", winner: p, turns: draws / g.n };
      }
      const kans = g.wall.length > 0 ? g.canKan(p) : [];
      if (kans.length > 0 && shouldKan(g.wall.length)) {
        if (g.declareKan(p, kans[0]) === null) return { type: "draw", turns: draws / g.n };
        continue;
      }
      g.discard(chooseDiscard(g.hands[p], g.need3(p), dicts[p]));
      break;
    }
    if (g.roundResult) break;
    const { tile, from } = g.lastDiscard;
    const order = [];
    for (let k = 1; k < g.n; k++) order.push((from + k) % g.n);
    let claimed = false;
    for (const q of order) {
      if (g.canRon(q, tile)) { g.winByRon(q); return { type: "ron", winner: q, turns: draws / g.n }; }
    }
    for (const q of order) {
      const words = g.canPon(q, tile);
      const w = words.find(w => shouldPon(g.hands[q], g.need3(q), w, tile, dicts[q]));
      if (w) { g.claimPon(q, w); claimed = true; break; }
    }
    if (!claimed) g.passClaims();
  }
  return { type: g.roundResult?.type || "draw", turns: draws / g.n };
}

// ---- 3. 局を回して和了巡目と流局率を測る ----
function roundStats(dict, vocab, rounds, seedBase) {
  let turnsSum = 0, wins = 0, draws = 0;
  for (let i = 0; i < rounds; i++) {
    const rng = mulberry32(seedBase + i);
    const players = [0, 1, 2, 3].map(() => ({
      name: "cpu", isHuman: false,
      dict: vocab < 1 ? subsetDict(dict, vocab, rng) : undefined,
    }));
    const g = new Game({ players, dict, rounds: 1, seed: seedBase + i });
    g.startRound();
    const dicts = [0, 1, 2, 3].map(p => g.dictFor(p));
    const r = playRound(g, dicts);
    if (r.type === "draw") draws++;
    else { wins++; turnsSum += r.turns; }
  }
  return { avgTurns: wins ? turnsSum / wins : null, drawRate: draws / rounds };
}

// ---- 4. 難易度差: 1人だけ語彙を変えたときのトップ率 ----
function topRate(dict, myVocab, cpuVocab, games, seedBase) {
  let tops = 0;
  for (let i = 0; i < games; i++) {
    const rng = mulberry32(seedBase + i);
    const players = [0, 1, 2, 3].map(idx => ({
      name: `p${idx}`, isHuman: false,
      dict: subsetDict(dict, idx === 0 ? myVocab : cpuVocab, rng),
    }));
    const g = new Game({ players, dict, rounds: 2, seed: seedBase + i });
    for (let r = 0; r < 2; r++) {
      g.startRound();
      const dicts = [0, 1, 2, 3].map(p => g.dictFor(p));
      playRound(g, dicts);
    }
    const best = Math.max(...g.players.map(p => p.score));
    if (g.players[0].score === best) tops++;
  }
  return tops / games;
}

const pct = (x) => x == null ? "-" : `${(x * 100).toFixed(1)}%`;

console.log(`辞書サイズ: コア ${coreDict.w2.size}/${coreDict.w3.size}/${coreDict.w4.size} (計${coreDict.w2.size + coreDict.w3.size + coreDict.w4.size})`);
console.log(`            全部 ${fullDict.w2.size}/${fullDict.w3.size}/${fullDict.w4.size} (計${fullDict.w2.size + fullDict.w3.size + fullDict.w4.size})`);
console.log("");
console.log(`■ 配牌テンパイ率 (${N}回)`);
console.log(`  コア辞書: ${pct(dealTenpaiRate(coreDict, N))}`);
console.log(`  全辞書  : ${pct(dealTenpaiRate(fullDict, N))}`);
console.log("");

const rounds = Math.max(40, Math.floor(N / 4));
console.log(`■ 和了巡目・流局率 (${rounds}局、語彙100%)`);
for (const [label, d] of [["コア辞書", coreDict], ["全辞書", fullDict]]) {
  const s = roundStats(d, 1.0, rounds, 7000);
  console.log(`  ${label}: 平均和了巡目 ${s.avgTurns ? s.avgTurns.toFixed(1) : "-"}巡 / 流局率 ${pct(s.drawRate)}`);
}
console.log("");

const games = Math.max(30, Math.floor(N / 6));
const total = coreDict.w2.size + coreDict.w3.size + coreDict.w4.size;
console.log(`■ 難易度別トップ率 (${games}試合・4人なので基準25%・CPUは語彙数指定)`);
for (const [label, words] of [["やさしい", 700], ["ふつう", 1300], ["むずかしい", 2400]]) {
  const r = topRate(coreDict, 1.0, words / total, games, 9000);
  console.log(`  自分=全辞書 vs CPU${words}語 (${label}): トップ率 ${pct(r)}`);
}
