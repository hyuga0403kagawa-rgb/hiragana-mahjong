// ゲーム内経済 (コイン・ショップ・テーマ・ヒント券)
// 方針: ランク戦・オンラインの公平性を壊さない「見た目」と「カジュアル便利機能」のみを販売する。
// 実決済は未接続 (デモ購入)。本物にする場合は buyCoinPack() を決済プロバイダ(Stripe等)の
// チェックアウト完了コールバックから呼ぶ形に差し替える。

export const TILE_THEMES = [
  { id: "ivory", name: "象牙", desc: "きほんの牌", price: 0 },
  { id: "sakura", name: "桜貝", desc: "ほんのり桜色の牌", price: 300 },
  { id: "shikkoku", name: "漆黒", desc: "黒塗りに金文字の高級牌", price: 300 },
  { id: "hisui", name: "翡翠", desc: "ひんやり翡翠の牌", price: 300 },
];
export const TABLE_THEMES = [
  { id: "ai", name: "藍の夜", desc: "きほんの卓", price: 0 },
  { id: "midori", name: "雀卓みどり", desc: "定番のラシャ張り", price: 300 },
  { id: "akane", name: "茜空", desc: "夕暮れ色の卓", price: 300 },
];
export const HINT_PACK = { id: "hint5", name: "ヒント券 ×5", desc: "フリー対戦で完成していることばを表示 (ランク戦・ともだち対戦では使えません)", price: 100, amount: 5 };
export const SFX_PACKS = [
  { id: "tsuchi", name: "つちの音", desc: "きほんの牌と木の音", price: 0 },
  { id: "marimo", name: "まりもの音", desc: "まるくてやわらかい水の音", price: 400 },
  { id: "denshi", name: "でんしの音", desc: "レトロゲーム風のピコピコ音", price: 400 },
];
export const BGM_SETS = [
  { id: "yoru", name: "夜の卓", desc: "しずかな琴のしらべ (ロビー/対局)", price: 0 },
  { id: "matsuri", name: "祭ばやし", desc: "太鼓と笛のにぎやかな調子", price: 500 },
  { id: "yuki", name: "雪あかり", desc: "鈴の音がひびく静寂", price: 500 },
];
// 広告なしはコインでは買えない課金(実決済)専用アイテム。現状はデモ決済。
export const AD_FREE_ITEM = { id: "adfree", name: "広告なし", desc: "起動時・対局後の広告を出さない (「広告でコインGET」は残ります)", demoPrice: "¥480" };
export const AD_REWARD = 30;              // 広告視聴1回の報酬
export const AD_REWARD_DAILY_LIMIT = 5;   // 1日の視聴回数上限
export const AD_EVERY_N_GAMES = 2;        // 対局後広告は2試合に1回まで
export const COIN_PACKS = [
  { id: "c500", coins: 500, label: "コイン 500", demoPrice: "¥160" },
  { id: "c1200", coins: 1200, label: "コイン 1200 (+20%おトク)", demoPrice: "¥320" },
];
// 対局報酬 (順位順)。課金しなくても遊べば貯まる。
export const REWARD_BY_PLACE = [40, 25, 10, 5];

import { safeStorage } from "./storage.js";

const KEY = "hiragana_mahjong_economy_v1";
const DEFAULTS = {
  coins: 150,                      // 初回ボーナス
  hints: 2,                        // お試しヒント
  ownedTiles: ["ivory"],
  ownedTables: ["ai"],
  tileTheme: "ivory",
  tableTheme: "ai",
  adFree: false,
  adDay: "",                       // 報酬広告のカウント日 (YYYY-MM-DD)
  adCount: 0,                      // その日の視聴回数
  gamesSinceAd: 0,                 // 対局後広告の間隔管理
  ownedSfx: ["tsuchi"],
  ownedBgm: ["yoru"],
  sfxPack: "tsuchi",
  bgmSet: "yoru",
};

export function loadEconomy(storage = safeStorage) {
  try {
    const d = JSON.parse(storage.getItem(KEY));
    if (d && typeof d.coins === "number") {
      return { ...DEFAULTS, ...d };
    }
  } catch { /* 破損時は初期化 */ }
  return { ...DEFAULTS };
}
export function saveEconomy(eco, storage = safeStorage) {
  try { storage.setItem(KEY, JSON.stringify(eco)); } catch { /* プライベートモード等 */ }
}

// 汎用の購入処理。戻り値: {ok, eco, reason?}
export function buyItem(eco, item) {
  if (eco.coins < item.price) return { ok: false, eco, reason: "コインが足りません" };
  const next = { ...eco, coins: eco.coins - item.price };
  if (TILE_THEMES.some(t => t.id === item.id)) {
    if (eco.ownedTiles.includes(item.id)) return { ok: false, eco, reason: "購入済みです" };
    next.ownedTiles = [...eco.ownedTiles, item.id];
  } else if (TABLE_THEMES.some(t => t.id === item.id)) {
    if (eco.ownedTables.includes(item.id)) return { ok: false, eco, reason: "購入済みです" };
    next.ownedTables = [...eco.ownedTables, item.id];
  } else if (item.id === HINT_PACK.id) {
    next.hints = eco.hints + HINT_PACK.amount;
  } else if (SFX_PACKS.some(t => t.id === item.id)) {
    if (eco.ownedSfx.includes(item.id)) return { ok: false, eco, reason: "購入済みです" };
    next.ownedSfx = [...eco.ownedSfx, item.id];
  } else if (BGM_SETS.some(t => t.id === item.id)) {
    if (eco.ownedBgm.includes(item.id)) return { ok: false, eco, reason: "購入済みです" };
    next.ownedBgm = [...eco.ownedBgm, item.id];
  } else {
    return { ok: false, eco, reason: "不明な商品です" };
  }
  return { ok: true, eco: next };
}

// コインパック購入 (デモ)。実決済導入時はここを決済完了後に呼ぶ。
export function buyCoinPack(eco, pack) {
  return { ok: true, eco: { ...eco, coins: eco.coins + pack.coins } };
}

// 広告なし購入 (課金専用・現状デモ)。実決済導入時は決済完了後に呼ぶ。
export function buyAdFree(eco) {
  if (eco.adFree) return { ok: false, eco, reason: "購入済みです" };
  return { ok: true, eco: { ...eco, adFree: true } };
}

export function equipTile(eco, id) {
  if (!eco.ownedTiles.includes(id)) return eco;
  return { ...eco, tileTheme: id };
}
export function equipTable(eco, id) {
  if (!eco.ownedTables.includes(id)) return eco;
  return { ...eco, tableTheme: id };
}
export function equipSfx(eco, id) {
  if (!eco.ownedSfx.includes(id)) return eco;
  return { ...eco, sfxPack: id };
}
export function equipBgm(eco, id) {
  if (!eco.ownedBgm.includes(id)) return eco;
  return { ...eco, bgmSet: id };
}
export function useHint(eco) {
  if (eco.hints <= 0) return { ok: false, eco };
  return { ok: true, eco: { ...eco, hints: eco.hints - 1 } };
}
export function grantReward(eco, place) {
  const r = REWARD_BY_PLACE[place] ?? 0;
  return { reward: r, eco: { ...eco, coins: eco.coins + r } };
}

// ---- 広告 ----
export function adRewardsLeft(eco, today) {
  return eco.adDay === today ? Math.max(0, AD_REWARD_DAILY_LIMIT - eco.adCount) : AD_REWARD_DAILY_LIMIT;
}
// 報酬広告視聴完了。today: "YYYY-MM-DD"
export function watchAdReward(eco, today) {
  if (adRewardsLeft(eco, today) <= 0) return { ok: false, eco, reason: "きょうの上限に達しました" };
  const count = eco.adDay === today ? eco.adCount + 1 : 1;
  return { ok: true, eco: { ...eco, coins: eco.coins + AD_REWARD, adDay: today, adCount: count } };
}
// 対局後にインタースティシャル広告を出すべきか (呼んだ後 state を保存すること)
export function shouldShowGameEndAd(eco) {
  if (eco.adFree) return { show: false, eco };
  const n = eco.gamesSinceAd + 1;
  if (n >= AD_EVERY_N_GAMES) return { show: true, eco: { ...eco, gamesSinceAd: 0 } };
  return { show: false, eco: { ...eco, gamesSinceAd: n } };
}
