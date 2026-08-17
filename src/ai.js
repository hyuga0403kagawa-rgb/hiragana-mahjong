// ひらがな麻雀 CPU思考ルーチン
// 方針: 手牌を「完成語 + あと1枚で完成する語」で貪欲評価し、寄与の低い牌を捨てる。
import { counts, RARE_TILES } from "./engine.js";

function containsCounts(hand, need) {
  for (const [c, n] of need) if ((hand.get(c) || 0) < n) return false;
  return true;
}
function subtractCounts(hand, need) {
  const m = new Map(hand);
  for (const [c, n] of need) {
    const left = m.get(c) - n;
    if (left === 0) m.delete(c); else m.set(c, left);
  }
  return m;
}
// need のうち hand に足りない枚数
function missingCount(hand, need) {
  let miss = 0;
  for (const [c, n] of need) {
    const have = hand.get(c) || 0;
    if (have < n) miss += n - have;
  }
  return miss;
}

// 手牌(カウント)の評価値: 完成語を貪欲に確定し、残りで「あと1枚」語を数える
// need3: まだ必要な3文字語数
export function evaluateHand(handCnt, need3, dict) {
  let score = 0;
  let hand = handCnt;
  let three = 0, two = false;

  // 3文字完成語を貪欲確定 (レア牌を多く含む語を優先=得点も上がる)
  let guard = 0;
  while (three < need3 && guard++ < 6) {
    const cands = dict._w3arr.filter(e => containsCounts(hand, e.cnt));
    if (cands.length === 0) break;
    let best = cands[0], bestRare = -1;
    for (const e of cands) {
      let r = 0; for (const ch of e.w) if (RARE_TILES.has(ch)) r++;
      if (r > bestRare) { bestRare = r; best = e; }
    }
    hand = subtractCounts(hand, best.cnt);
    three++;
    score += 100;
  }
  // 2文字完成語
  for (const e of dict._w2arr) {
    if (containsCounts(hand, e.cnt)) { hand = subtractCounts(hand, e.cnt); two = true; score += 90; break; }
  }
  // 部分語: あと1枚で完成する語 (重複消費を避けるため上限つき貪欲)
  let partials = 0;
  const maxPartial3 = need3 - three;
  if (maxPartial3 > 0) {
    for (const e of dict._w3arr) {
      if (partials >= maxPartial3) break;
      if (missingCount(hand, e.cnt) === 1) {
        // その語のうち手牌にある分を消費
        const useable = new Map();
        for (const [c, n] of e.cnt) {
          const have = hand.get(c) || 0;
          if (have > 0) useable.set(c, Math.min(have, n));
        }
        hand = subtractCounts(hand, useable);
        partials++;
        score += 45;
      }
    }
  }
  // さらに遠い芽: あと2枚で完成する3文字語 (残り枠がある場合のみ)
  let seeds = 0;
  const maxSeed3 = need3 - three - partials;
  if (maxSeed3 > 0) {
    for (const e of dict._w3arr) {
      if (seeds >= maxSeed3) break;
      if (missingCount(hand, e.cnt) === 2) {
        const useable = new Map();
        for (const [ch, n] of e.cnt) {
          const have = hand.get(ch) || 0;
          if (have > 0) useable.set(ch, Math.min(have, n));
        }
        hand = subtractCounts(hand, useable);
        seeds++;
        score += 15;
      }
    }
  }
  if (!two) {
    for (const e of dict._w2arr) {
      if (missingCount(hand, e.cnt) === 1) { score += 35; break; }
    }
  }
  return score;
}

// 捨て牌選択: 各候補を捨てた後の評価が最大になる牌を捨てる
export function chooseDiscard(handTiles, need3, dict, rng = Math.random) {
  const uniq = [...new Set(handTiles)];
  let bestTile = uniq[0], bestVal = -Infinity;
  for (const t of uniq) {
    const rest = handTiles.slice();
    rest.splice(rest.indexOf(t), 1);
    let val = evaluateHand(counts(rest), need3, dict);
    // 同点なら: レア牌は他家に取られにくく自分も使いにくいので僅かに手放しやすく…はせず保持寄り
    if (RARE_TILES.has(t)) val += 2; // レア牌を捨てる選択肢を少しだけ優遇(使い道が無いことが多い)
    val += rng() * 1e-6;
    if (val > bestVal) { bestVal = val; bestTile = t; }
  }
  return handTiles.indexOf(bestTile);
}

// ポンするか: ポン後の手(手牌2枚消費+確定100点分)が明確に良くなる場合のみ鳴く
export function shouldPon(handTiles, need3, word, tile, dict) {
  const base = evaluateHand(counts(handTiles), need3, dict);
  const need = counts([...word]);
  const n = need.get(tile);
  if (n === 1) need.delete(tile); else need.set(tile, n - 1);
  const after = subtractCounts(counts(handTiles), need);
  const afterVal = 100 + evaluateHand(after, need3 - 1, dict);
  return afterVal >= base + 25;
}

// カンするか: 基本する(補充が引けて得点+2)。終盤の山切れ間際は控える。
export function shouldKan(wallCount) {
  return wallCount > 2;
}
