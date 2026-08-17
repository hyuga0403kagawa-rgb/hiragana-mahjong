// 実績・称号: 対局中の出来事を記録し、条件を満たしたら解除する
// 判定はすべて純関数。UIはこのモジュールの結果を表示するだけ。
import { safeStorage } from "./storage.js";

const KEY = "hiragana_mahjong_achievements_v1";

// stats: プレイヤーの通算記録
const DEFAULT_STATS = {
  games: 0,          // 対局数
  wins: 0,           // あがり回数
  tsumo: 0,          // ツモあがり
  ron: 0,            // ロンあがり
  tops: 0,           // 1位回数
  pons: 0,           // ポン回数
  kans: 0,           // カン回数
  bestScore: 0,      // 最高得点のあがり
  maxRare: 0,        // 1回のあがりで使ったレア牌の最大数
  kanWin: 0,         // カンを含むあがり
  words: 0,          // 図鑑の収集語数 (外から同期)
  rank: "G",         // 到達ランク (外から同期)
  streak: 0,         // 連続あがり
  maxStreak: 0,
};

// 称号 = 実績。cond(stats) が true になったら解除。
export const ACHIEVEMENTS = [
  { id: "first_win", icon: "🌱", name: "はじめの一歩", desc: "はじめてあがる", coin: 20, cond: s => s.wins >= 1 },
  { id: "win10", icon: "🌸", name: "ことば咲かせ", desc: "10回あがる", coin: 40, cond: s => s.wins >= 10 },
  { id: "win50", icon: "🏆", name: "ことばの達人", desc: "50回あがる", coin: 120, cond: s => s.wins >= 50 },
  { id: "tsumo_first", icon: "🎴", name: "自力であがる", desc: "ツモであがる", coin: 20, cond: s => s.tsumo >= 1 },
  { id: "ron_first", icon: "⚡", name: "見のがさない", desc: "ロンであがる", coin: 20, cond: s => s.ron >= 1 },
  { id: "pon10", icon: "🤝", name: "もらい上手", desc: "ポンを10回する", coin: 30, cond: s => s.pons >= 10 },
  { id: "kan_first", icon: "🔠", name: "四文字のちから", desc: "はじめてカンする", coin: 25, cond: s => s.kans >= 1 },
  { id: "kan_win", icon: "💥", name: "カンして あがる", desc: "カンを含む手であがる", coin: 40, cond: s => s.kanWin >= 1 },
  { id: "rare3", icon: "💎", name: "レア牌コレクター", desc: "レア牌3枚以上であがる", coin: 40, cond: s => s.maxRare >= 3 },
  { id: "rare5", icon: "👑", name: "宝石ばこ", desc: "レア牌5枚以上であがる", coin: 100, cond: s => s.maxRare >= 5 },
  { id: "score20", icon: "🔥", name: "大物あがり", desc: "1回のあがりで20点以上", coin: 60, cond: s => s.bestScore >= 20 },
  { id: "top_first", icon: "🥇", name: "はじめての1位", desc: "対局で1位になる", coin: 30, cond: s => s.tops >= 1 },
  { id: "top10", icon: "🌟", name: "常勝", desc: "10回1位になる", coin: 100, cond: s => s.tops >= 10 },
  { id: "streak3", icon: "🎯", name: "波に乗る", desc: "3局連続であがる", coin: 60, cond: s => s.maxStreak >= 3 },
  { id: "words50", icon: "📖", name: "ことば集め", desc: "図鑑に50ことば集める", coin: 40, cond: s => s.words >= 50 },
  { id: "words200", icon: "📚", name: "ことばの図書館", desc: "図鑑に200ことば集める", coin: 120, cond: s => s.words >= 200 },
  { id: "rank_d", icon: "🎖️", name: "Dランク到達", desc: "ランク戦でDランクになる", coin: 80, cond: s => rankIdx(s.rank) >= rankIdx("D") },
  { id: "rank_a", icon: "🏅", name: "Aランク到達", desc: "ランク戦でAランクになる", coin: 200, cond: s => rankIdx(s.rank) >= rankIdx("A") },
  { id: "rank_s", icon: "💫", name: "Sランク到達", desc: "ランク戦でSランクになる", coin: 500, cond: s => rankIdx(s.rank) >= rankIdx("S") },
  { id: "games30", icon: "⏳", name: "やりこみ", desc: "30回対局する", coin: 60, cond: s => s.games >= 30 },
];
const RANK_ORDER = ["G", "F", "E", "D", "C", "B", "A", "S"];
function rankIdx(r) { return RANK_ORDER.indexOf(r); }

export function loadAchievements(storage = safeStorage) {
  try {
    const d = JSON.parse(storage.getItem(KEY));
    if (d && d.stats && Array.isArray(d.unlocked)) {
      return { stats: { ...DEFAULT_STATS, ...d.stats }, unlocked: d.unlocked };
    }
  } catch { /* 破損時は初期化 */ }
  return { stats: { ...DEFAULT_STATS }, unlocked: [] };
}
export function saveAchievements(ach, storage = safeStorage) {
  try { storage.setItem(KEY, JSON.stringify(ach)); } catch { /* 保存不可環境 */ }
}

// 局の結果を反映する。ev = {won, type:"tsumo"|"ron", score, rare, kans}
export function applyRoundResult(ach, ev) {
  const s = { ...ach.stats };
  if (ev.won) {
    s.wins++;
    if (ev.type === "tsumo") s.tsumo++; else s.ron++;
    s.bestScore = Math.max(s.bestScore, ev.score || 0);
    s.maxRare = Math.max(s.maxRare, ev.rare || 0);
    if (ev.kans > 0) s.kanWin++;
    s.streak++;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
  } else {
    s.streak = 0;
  }
  return { ...ach, stats: s };
}
// 鳴きのカウント
export function countMeld(ach, type) {
  const s = { ...ach.stats };
  if (type === "kan") s.kans++; else s.pons++;
  return { ...ach, stats: s };
}
// 対局(半荘)の終了。place: 0=1位
export function applyGameEnd(ach, place) {
  const s = { ...ach.stats };
  s.games++;
  if (place === 0) s.tops++;
  return { ...ach, stats: s };
}
// 図鑑・ランクの同期
export function syncProgress(ach, { words, rank }) {
  const s = { ...ach.stats };
  if (typeof words === "number") s.words = words;
  if (rank) s.rank = rankIdx(rank) > rankIdx(s.rank) ? rank : s.rank;
  return { ...ach, stats: s };
}

// 未解除の条件を判定する。戻り値: {ach, unlocked:[実績], coins}
export function checkUnlocks(ach) {
  const newly = ACHIEVEMENTS.filter(a => !ach.unlocked.includes(a.id) && a.cond(ach.stats));
  if (newly.length === 0) return { ach, unlocked: [], coins: 0 };
  return {
    ach: { ...ach, unlocked: [...ach.unlocked, ...newly.map(a => a.id)] },
    unlocked: newly,
    coins: newly.reduce((sum, a) => sum + a.coin, 0),
  };
}

// いま名乗れる称号 (最後に解除したもの)
export function currentTitle(ach) {
  for (let i = ACHIEVEMENTS.length - 1; i >= 0; i--) {
    if (ach.unlocked.includes(ACHIEVEMENTS[i].id)) return ACHIEVEMENTS[i];
  }
  return null;
}
