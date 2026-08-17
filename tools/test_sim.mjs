// CPU同士の全自動対局シミュレーション: node tools/test_sim.mjs [games]
// UIと同じ進行ロジックを headless で回し、例外・無限ループ・不変条件違反を検出する。
import { Game, Phase, Dict, subsetDict, mulberry32 } from "../src/engine.js";
import { chooseDiscard, shouldPon, shouldKan } from "../src/ai.js";

const CPU_VOCAB = process.argv[3] ? +process.argv[3] : 1.0; // CPUの語彙率 (難易度)

let dict;
try {
  const w = await import("../src/data/words.js");
  dict = new Dict(w.WORDS2, w.WORDS3, w.WORDS4);
  console.log(`実辞書を使用: 2文字${w.WORDS2.length} / 3文字${w.WORDS3.length} / 4文字${w.WORDS4.length}`);
} catch {
  dict = new Dict(
    ["うみ", "あき", "かに", "はな", "やま", "そら", "つき", "ほし", "いぬ", "ねこ", "くま", "とり"],
    ["さくら", "みかん", "たいこ", "すいか", "きって", "ばなな", "つくえ", "めがね", "たまご", "こたつ", "ひかり", "まくら", "さかな", "かもめ", "わたし", "ことば", "むかし", "ゆめじ".slice(0, 3)],
    ["らーめん", "しゃしん", "ひまわり", "たんぽぽ".replace("ぽぽ", "ぽけ"), "てがみや".slice(0, 4)],
  );
  console.log("ミニ辞書を使用 (words.js 未生成)");
}

const N_GAMES = +(process.argv[2] || 50);
let wins = 0, draws = 0, rons = 0, tsumos = 0, pons = 0, kans = 0;
let errors = 0;
let wallLeftSum = 0, wallLeftN = 0;

function checkInvariants(g) {
  // 牌の総数保存: 山 + 全手牌 + 全河 + 全鳴き = 120
  let total = g.wall.length;
  for (let p = 0; p < g.n; p++) {
    total += g.hands[p].length + g.discards[p].length;
    for (const m of g.melds[p]) total += m.word.length;
  }
  // ポンの1枚は河から取っているので word.length ぶんが正しい
  if (total !== 120) throw new Error(`牌総数が${total} (120のはず)`);
}

for (let n = 0; n < N_GAMES; n++) {
  const vocabRng = mulberry32(5000 + n);
  const players = [0, 1, 2, 3].map(i => ({
    name: `CPU${i}`, isHuman: false,
    dict: CPU_VOCAB < 1 ? subsetDict(dict, CPU_VOCAB, vocabRng) : undefined,
  }));
  const g = new Game({ players, dict, rounds: 2, seed: 1000 + n });
  try {
    while (true) {
      g.startRound();
      let steps = 0;
      roundLoop:
      while (true) {
        if (++steps > 2000) throw new Error("無限ループ検出");
        if (g.phase === Phase.ROUND_END || g.phase === Phase.GAME_END) break;
        if (g.phase === Phase.DRAW) {
          if (g.drawTile() === null) break;
        }
        // DISCARDフェーズ
        const p = g.turn;
        let inner = 0;
        while (true) {
          if (++inner > 10) throw new Error("手番内ループ");
          if (g.hands[p].length === g.fullHandSize(p) && g.canTsumo(p)) {
            g.winByTsumo(p); tsumos++; wins++;
            break roundLoop;
          }
          const kansAvail = g.wall.length > 0 ? g.canKan(p) : [];
          if (kansAvail.length > 0 && shouldKan(g.wall.length)) {
            if (g.declareKan(p, kansAvail[0]) === null) break roundLoop;
            kans++;
            continue;
          }
          g.discard(chooseDiscard(g.hands[p], g.need3(p), g.dictFor(p)));
          break;
        }
        if (g.roundResult) break;
        checkInvariants(g);
        // 鳴き解決
        const { tile, from } = g.lastDiscard;
        const order = [];
        for (let k = 1; k < g.n; k++) order.push((from + k) % g.n);
        let claimed = false;
        for (const q of order) {
          if (g.canRon(q, tile)) { g.winByRon(q); rons++; wins++; claimed = true; break; }
        }
        if (claimed) break;
        for (const q of order) {
          const words = g.canPon(q, tile);
          const w = words.find(w => shouldPon(g.hands[q], g.need3(q), w, tile, g.dictFor(q)));
          if (w) { g.claimPon(q, w); pons++; claimed = true; break; }
        }
        if (!claimed) g.passClaims();
        checkInvariants(g);
      }
      if (g.roundResult?.type === "draw") draws++;
      else { wallLeftSum += g.wall.length; wallLeftN++; }
      if (g.phase === Phase.GAME_END) break;
    }
    const sum = g.players.reduce((s, p) => s + p.score, 0);
    if (sum !== 0) throw new Error(`得点合計が${sum} (0のはず)`);
  } catch (e) {
    errors++;
    console.error(`game ${n}: ${e.message}`);
  }
}

console.log(`\n${N_GAMES}試合(各2局) 完了: 和了${wins} (ツモ${tsumos}/ロン${rons}) 流局${draws} ポン${pons} カン${kans} エラー${errors}`);
if (wallLeftN) console.log(`和了時の平均残り山: ${(wallLeftSum / wallLeftN).toFixed(1)}枚 / 68枚`);
process.exit(errors ? 1 : 0);
