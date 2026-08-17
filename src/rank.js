// ランク戦のランクシステム (G→F→E→D→C→B→A→S)
// 各ランク100RPで昇格。0未満で降格(降格後は70RPから)。Sは上限なしで蓄積。
export const RANKS = ["G", "F", "E", "D", "C", "B", "A", "S"];
export const RP_PER_RANK = 100;
// 順位ごとのRP増減 (4人戦)
export const RP_BY_PLACE = [30, 10, -10, -25];
// ランクごとのCPU語彙数 (難易度)。
// 辞書を全網羅 (1.6万語超) にしたため、割合でなく「知っている語の数」で強さを固定する。
// 値は旧コア辞書時代の体感 (G=約480語 〜 S=約2400語) を引き継いでいる。
export const CPU_WORDS_BY_RANK = {
  G: 500, F: 700, E: 900, D: 1100, C: 1400, B: 1700, A: 2000, S: 2400,
};

import { safeStorage } from "./storage.js";

const KEY = "hiragana_mahjong_rank_v1";

export function loadRank(storage = safeStorage) {
  try {
    const d = JSON.parse(storage.getItem(KEY));
    if (d && RANKS.includes(d.rank) && typeof d.rp === "number") {
      return { rank: d.rank, rp: d.rp, games: d.games || 0, tops: d.tops || 0 };
    }
  } catch { /* 破損時は初期化 */ }
  return { rank: "G", rp: 0, games: 0, tops: 0 };
}

export function saveRank(state, storage = safeStorage) {
  try { storage.setItem(KEY, JSON.stringify(state)); } catch { /* プライベートモード等 */ }
}

// place: 0=1位。戻り値: {state, delta, promoted, demoted}
export function applyResult(state, place) {
  const delta = RP_BY_PLACE[place] ?? 0;
  let { rank, rp, games, tops } = state;
  games++;
  if (place === 0) tops++;
  rp += delta;
  let promoted = false, demoted = false;
  const idx = RANKS.indexOf(rank);
  if (rank !== "S" && rp >= RP_PER_RANK) {
    rank = RANKS[idx + 1];
    rp = rp - RP_PER_RANK;
    promoted = true;
  } else if (rp < 0) {
    if (idx > 0) {
      rank = RANKS[idx - 1];
      rp = 70; // 降格後は少し余裕を持たせる
      demoted = true;
    } else {
      rp = 0; // Gからは落ちない
    }
  }
  const next = { rank, rp, games, tops };
  return { state: next, delta, promoted, demoted };
}
