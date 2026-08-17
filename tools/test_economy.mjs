// 経済システムのテスト: node tools/test_economy.mjs
import {
  TILE_THEMES, HINT_PACK, COIN_PACKS, AD_FREE_ITEM, AD_REWARD, AD_REWARD_DAILY_LIMIT,
  SFX_PACKS, BGM_SETS,
  loadEconomy, saveEconomy, buyItem, buyCoinPack, buyAdFree, equipTile, useHint, grantReward,
  equipSfx, equipBgm,
  adRewardsLeft, watchAdReward, shouldShowGameEndAd,
} from "../src/economy.js";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`FAIL - ${name}`); }
}

const store = new Map();
const fakeStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };

let eco = loadEconomy(fakeStorage);
ok(eco.coins === 150 && eco.hints === 2, "初期は150コイン+ヒント2枚");
ok(eco.tileTheme === "ivory" && eco.ownedTiles.includes("ivory"), "初期テーマは象牙");

// テーマ購入
const sakura = TILE_THEMES.find(t => t.id === "sakura");
let r = buyItem(eco, sakura);
ok(!r.ok && r.reason.includes("足りません"), "150コインでは300の桜貝を買えない");
eco = buyCoinPack(eco, COIN_PACKS[0]).eco;
ok(eco.coins === 650, "コインパックで+500");
r = buyItem(eco, sakura);
ok(r.ok && r.eco.coins === 350 && r.eco.ownedTiles.includes("sakura"), "購入で減額+所持");
eco = r.eco;
r = buyItem(eco, sakura);
ok(!r.ok && r.reason.includes("購入済"), "二重購入は不可");

// 装備
eco = equipTile(eco, "sakura");
ok(eco.tileTheme === "sakura", "購入済みテーマを装備できる");
const before = eco.tileTheme;
eco = equipTile(eco, "hisui");
ok(eco.tileTheme === before, "未購入テーマは装備できない");

// ヒント
r = buyItem(eco, HINT_PACK);
ok(r.ok && r.eco.hints === 7, "ヒント券×5購入で7枚");
eco = r.eco;
r = useHint(eco);
ok(r.ok && r.eco.hints === 6, "使用で1枚減る");
eco = r.eco;
let e0 = { ...eco, hints: 0 };
ok(useHint(e0).ok === false, "0枚では使えない");

// 報酬
r = grantReward(eco, 0);
ok(r.reward === 40, "1位は+40");
ok(grantReward(eco, 3).reward === 5, "4位は+5");
eco = r.eco;

// 効果音パック・BGMセット
ok(loadEconomy({ getItem: () => null, setItem: () => {} }).sfxPack === "tsuchi", "初期の効果音はつち");
ok(loadEconomy({ getItem: () => null, setItem: () => {} }).bgmSet === "yoru", "初期のBGMは夜の卓");
eco = { ...eco, coins: 1000 };
const marimo = SFX_PACKS.find(p => p.id === "marimo");
r = buyItem(eco, marimo);
ok(r.ok && r.eco.ownedSfx.includes("marimo") && r.eco.coins === 600, "効果音パック購入で減額+所持");
eco = equipSfx(r.eco, "marimo");
ok(eco.sfxPack === "marimo", "購入した効果音パックを装備できる");
ok(equipSfx(eco, "denshi").sfxPack === "marimo", "未購入の効果音パックは装備できない");
ok(buyItem(eco, marimo).ok === false, "効果音パックの二重購入不可");
const matsuri = BGM_SETS.find(p => p.id === "matsuri");
r = buyItem(eco, matsuri);
ok(r.ok && r.eco.ownedBgm.includes("matsuri") && r.eco.coins === 100, "BGMセット購入で減額+所持");
eco = equipBgm(r.eco, "matsuri");
ok(eco.bgmSet === "matsuri", "購入したBGMセットを装備できる");
ok(equipBgm(eco, "yuki").bgmSet === "matsuri", "未購入のBGMセットは装備できない");
// 旧データ (音のフィールドなし) を読み込んでもデフォルトが補完される
const oldData = JSON.stringify({ coins: 50, hints: 1, ownedTiles: ["ivory"], ownedTables: ["ai"], tileTheme: "ivory", tableTheme: "ai" });
const migrated = loadEconomy({ getItem: () => oldData, setItem: () => {} });
ok(migrated.sfxPack === "tsuchi" && migrated.ownedBgm.includes("yoru"), "既存セーブに音フィールドが補完される");

// 広告
const today = "2026-08-14";
ok(adRewardsLeft(eco, today) === AD_REWARD_DAILY_LIMIT, "初日は満回数");
let coinsBefore = eco.coins;
r = watchAdReward(eco, today);
ok(r.ok && r.eco.coins === coinsBefore + AD_REWARD && r.eco.adCount === 1, "視聴で+30と回数記録");
eco = r.eco;
for (let i = 1; i < AD_REWARD_DAILY_LIMIT; i++) eco = watchAdReward(eco, today).eco;
ok(adRewardsLeft(eco, today) === 0, "上限で0回");
ok(watchAdReward(eco, today).ok === false, "上限超えは不可");
ok(adRewardsLeft(eco, "2026-08-15") === AD_REWARD_DAILY_LIMIT, "翌日はリセット");

// 対局後広告: 2試合に1回
let s1 = shouldShowGameEndAd(eco);
ok(s1.show === false && s1.eco.gamesSinceAd === 1, "1試合目は出ない");
let s2 = shouldShowGameEndAd(s1.eco);
ok(s2.show === true && s2.eco.gamesSinceAd === 0, "2試合目で表示");
// 広告なしは課金(デモ)専用: コイン購入経路では買えない
ok(buyItem({ ...eco, coins: 99999 }, AD_FREE_ITEM).ok === false, "広告なしはコインでは買えない");
const coinsKeep = eco.coins;
r = buyAdFree(eco);
ok(r.ok && r.eco.adFree === true && r.eco.coins === coinsKeep, "課金(デモ)で広告なし、コインは減らない");
eco = r.eco;
ok(shouldShowGameEndAd(eco).show === false, "広告なし購入後は対局後広告も出ない");
ok(buyAdFree(eco).ok === false, "広告なしの二重購入不可");

// 保存/復元
saveEconomy(eco, fakeStorage);
const loaded = loadEconomy(fakeStorage);
ok(loaded.coins === eco.coins && loaded.tileTheme === "sakura" && loaded.hints === 6, "保存と復元");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
