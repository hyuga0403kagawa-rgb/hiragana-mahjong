// ひらがな麻雀 UIコントローラ
// ローカル対戦(フリー/ランク戦)とオンライン対戦(ともだち)の両方を、
// 共通の「ビュー描画 + プロンプト」レイヤの上で動かす。
import {
  Game, Phase, Dict, RARE_TILES, counts, subsetDictByCount, kanOptions,
  checkArrangedWin, checkArrangedRon,
} from "./engine.js";
import { chooseDiscard, shouldPon, shouldKan } from "./ai.js";
import { WORDS2, WORDS3, WORDS4 } from "./data/words.js";
import { RANKS, RP_PER_RANK, RP_BY_PLACE, loadRank, saveRank, applyResult } from "./rank.js";
import { NetClient } from "./net.js";
import {
  TILE_THEMES, TABLE_THEMES, HINT_PACK, COIN_PACKS, AD_FREE_ITEM, AD_REWARD,
  SFX_PACKS as ECO_SFX, BGM_SETS as ECO_BGM,
  loadEconomy, saveEconomy, buyItem, buyCoinPack, buyAdFree, equipTile, equipTable,
  equipSfx, equipBgm, useHint, grantReward,
  adRewardsLeft, watchAdReward, shouldShowGameEndAd,
} from "./economy.js";
import {
  play as playSfx, isMuted, toggleMute,
  setSfxPack, setBgmSet, playBgm, currentBgm, auditionSfx, auditionBgm, unlockAudio,
} from "./sound.js";
import {
  NEW_WORD_COIN, loadCollection, saveCollection, recordWords, collectionStats, groupByRow,
} from "./collection.js";
import {
  ACHIEVEMENTS, loadAchievements, saveAchievements, applyRoundResult, countMeld,
  applyGameEnd, syncProgress, checkUnlocks, currentTitle,
} from "./achievements.js";
import { renderWinImage, shareImage } from "./share.js";
import { readStore, writeStore, storageIsPersistent } from "./storage.js";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const dict = new Dict(WORDS2, WORDS3, WORDS4);
const CPU_NAMES = ["あかり", "つばき", "げんた"];

let settings = { n: 4, rounds: 4, level: 0.55 };
let mode = "free";            // free | rank | friend
let game = null;              // ローカル対戦のエンジン
let net = null;               // オンライン時の NetClient
let currentView = null;       // 最後に描画したビュー
let selectedIdx = -1;         // 選択中の表示位置
let pendingResolve = null;    // 人間の操作待ち {resolve, allowDiscard, displayMap}
let rankState = loadRank();
let eco = loadEconomy();
let book = loadCollection();
let ach = loadAchievements();
let onlineAvailable = false;

window.__dbg = { dict, get game() { return game; }, get view() { return currentView; }, get eco() { return eco; } };

// ================= 経済 (テーマ適用・所持金表示) =================
function applyThemes() {
  document.body.dataset.tileTheme = eco.tileTheme;
  document.body.dataset.tableTheme = eco.tableTheme;
  setSfxPack(eco.sfxPack);
  setBgmSet(eco.bgmSet);
}
function updateEcoBadges() {
  $("title-coins").textContent = `🪙 ${eco.coins}`;
  $("hint-count").textContent = `×${eco.hints}`;
}
function setEco(next) {
  eco = next;
  saveEconomy(eco);
  applyThemes();
  updateEcoBadges();
}
applyThemes();
updateEcoBadges();

// ================= 広告 (デモ) =================
// 実広告ネットワークは未接続。架空広告を「広告(デモ)」と明示して表示する。
// 実物にする場合はこの showAdModal を広告SDK呼び出しに差し替える。
const DEMO_ADS = [
  { title: "たんぽぽ亭の おことばラーメン", body: "三文字で「うまい」。※架空のお店です" },
  { title: "ヒント券セール開催中!", body: "ことばに つまったら ショップへ" },
  { title: "ランク戦で S を目指そう!", body: "きょうの一局が あしたの昇格" },
  { title: "つばき先生の ことば教室", body: "「ー」は のばし棒。1枚しかないレア牌!" },
];

function showAdModal({ rewarded = false } = {}) {
  const seconds = rewarded ? 5 : 3;
  return new Promise((resolve) => {
    const ad = DEMO_ADS[Math.floor(Math.random() * DEMO_ADS.length)];
    const card = $("modal-card");
    card.innerHTML = `
      <div class="ad-label">広告 (デモ)</div>
      <div class="ad-box">
        <div class="ad-title">${ad.title}</div>
        <div class="ad-body">${ad.body}</div>
      </div>
      <div class="modal-sub" id="ad-count"></div>`;
    const btn = document.createElement("button");
    btn.className = "btn-primary";
    btn.disabled = true;
    card.appendChild(btn);
    $("modal").classList.remove("hidden");
    const label = rewarded ? `うけとる 🪙${AD_REWARD}` : "とじる";
    let left = seconds;
    let adTimer = null;
    const tick = () => {
      if (left > 0) {
        btn.textContent = `${label} (${left})`;
        $("ad-count").textContent = rewarded ? "視聴中…" : "";
        left--;
        adTimer = setTimeout(tick, 1000);
      } else {
        btn.disabled = false;
        btn.textContent = label;
        $("ad-count").textContent = "";
      }
    };
    tick();
    btn.onclick = () => {
      if (btn.disabled) return;
      clearTimeout(adTimer);
      $("modal").classList.add("hidden");
      resolve(true);
    };
  });
}

async function maybeShowGameEndAd() {
  const r = shouldShowGameEndAd(eco);
  setEco(r.eco);
  if (r.show) await showAdModal({ rewarded: false });
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
async function watchRewardedAd() {
  if (adRewardsLeft(eco, todayStr()) <= 0) return;
  await showAdModal({ rewarded: true });
  const r = watchAdReward(eco, todayStr());
  if (r.ok) { setEco(r.eco); playSfx("coin"); }
  updateAdButtons();
}
function updateAdButtons() {
  const left = adRewardsLeft(eco, todayStr());
  const b = $("btn-ad-reward");
  b.textContent = left > 0
    ? `📺 広告でコインGET 🪙${AD_REWARD} (きょうあと${left}回)`
    : "📺 広告でコインGET (きょうは上限)";
  b.disabled = left <= 0;
}
$("btn-ad-reward").onclick = watchRewardedAd;
updateAdButtons();

// ================= ルール説明 (豆知識・初回説明・局開始) =================
const RULE_TIPS = [
  "<b>あがりは自動では出ない!</b> 手牌を「2文字×1こ + 3文字×4こ」の<b>ことば順にならべる</b>と「ツモ!」が出る",
  "手番では山から1枚引いて、いらない牌を1枚捨てる。このくり返し。",
  "牌は<b>横にドラッグ</b>で並び替え。ことばの順にそろえるのが あがりへの道!",
  "<b>ロン</b>したいなら「あと1枚」の形に<b>ならべておく</b>こと。バラバラの手牌ではロンは出ない",
  "2文字のことばは<b>先頭でなくてもいい</b>。「さくら|うみ|みかん…」の順でもあがれる",
  "<b>ポン</b>: 誰かの捨て牌 + 自分の手牌2枚で3文字のことばが完成したら もらって確定できる!",
  "<b>カン</b>: 手牌だけで4文字のことばができたら さらして1枚補充。得点も+2点!",
  "濁点(が)・半濁点(ぱ)・小さい「ゃゅょっ」・のばし棒「ー」は<b>各1枚だけのレア牌</b>。あがりに使うと1枚+2点!",
  "得点 = あがり8点 + レア牌×2点 + カン×2点。ツモは全員で割りかん、ロンは捨てた人が全額はらう。",
  "「整列」はあいうえお順にもどすボタン。<b>あがる直前に押すと並びが崩れる</b>ので注意!",
  "<b>金わく+「ツモ」</b>マークが いま引いてきた牌。",
  "同じ清音の牌は2枚まで。「みみず」は作れるけど「みみみ」は作れない。",
  "「を」の牌は存在しない! 「ん」はあるので「みかん」はOK。",
  "カンした4文字のことばは、3文字のことば1つ分として数える。",
];
function randomTip() { return RULE_TIPS[Math.floor(Math.random() * RULE_TIPS.length)]; }
// 待機系画面の豆知識を5秒ごとに入れかえる
setInterval(() => {
  for (const id of ["rank-tip", "lobby-tip"]) {
    const el = $(id);
    if (el && !el.hidden && el.offsetParent !== null) el.innerHTML = randomTip();
  }
}, 5000);

// 局開始オーバーレイ (卓の中央に「N局目」+ ワンポイント)
let introRound = 0;
let introTimer = null;
function maybeRoundIntro(view) {
  if (view.round === introRound || view.over) return;
  introRound = view.round;
  const el = $("round-intro");
  el.querySelector(".ri-round").textContent = `${view.round}局目`;
  el.querySelector(".ri-tip").innerHTML = randomTip();
  el.classList.remove("hidden");
  clearTimeout(introTimer);
  introTimer = setTimeout(() => el.classList.add("hidden"), 2400);
}

// 初回起動だけの かんたん説明
const INTRO_KEY = "hiragana_mahjong_seen_intro";
async function maybeShowFirstIntro() {
  try { if (localStorage.getItem(INTRO_KEY)) return false; } catch { return false; }
  const tile = (ch) => `<span class="tile small${RARE_TILES.has(ch) ? " rare" : ""}">${ch}</span>`;
  const word = (label, w) =>
    `<span class="intro-word-row"><span class="intro-word-label">${label}</span>${[...w].map(tile).join("")}</span>`;
  const html = `
    <div class="modal-title">あそびかた</div>
    <div class="modal-sub">ひらがなの牌で ことばを つくろう!</div>
    <div style="font-size:0.85rem;text-align:left;line-height:1.8">
      <p><b>1.</b> 山から1枚引いて、いらない牌を1枚捨てる。</p>
      <p><b>2.</b> 牌をドラッグして「<b>2文字×1こ + 3文字×4こ</b>」の<b>ことば順にならべたら</b>…あがり!</p>
      <p><b>3.</b> ならべないと「ツモ!」は出ない。自分で見つけてならべよう!</p>
    </div>
    <div class="intro-words">
      ${word("2文字", "うみ")}
      ${word("3文字×4", "さくら")}
      ${word("", "みかん")}
      ${word("", "たいこ")}
      ${word("", "すいか")}
    </div>
    <div class="modal-sub">ポン・カン・ロンなどは「ルールを見る」でいつでも確認できます</div>`;
  await showModal(html, [{ label: "あそぶ!", value: true }]);
  try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* 保存不可でも進行 */ }
  return true;
}

// ---- 効果音 ----
function refreshMuteBtn() {
  $("btn-mute").textContent = isMuted() ? "🔇" : "🔊";
  $("btn-mute").classList.toggle("muted", isMuted());
}
$("btn-mute").onclick = () => { toggleMute(); refreshMuteBtn(); playSfx("tap"); };
refreshMuteBtn();
// BGM開始 (音が実際に出るのは最初のタップ以降 = ブラウザの自動再生制限)
playBgm("lobby");
document.addEventListener("pointerdown", () => unlockAudio(), { once: true });
// 起動時: 初回だけ「あそびかた」を表示。それ以外は起動広告 (「広告なし」購入済みなら出ない)
setTimeout(async () => {
  const introShown = await maybeShowFirstIntro();
  if (!introShown && !eco.adFree) showAdModal({ rewarded: false });
}, 600);

// ================= 画面遷移 =================
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
  // BGM: 対局中は battle、それ以外 (タイトル・ロビー・ショップ等) は lobby
  playBgm(id === "screen-game" ? "battle" : "lobby");
}
let rulesReturn = "screen-title";

// ================= タイトル/設定画面 =================
function segInit(segId, key, attr) {
  for (const btn of $(segId).querySelectorAll("button")) {
    btn.onclick = () => {
      $(segId).querySelectorAll("button").forEach(b => b.classList.remove("on"));
      btn.classList.add("on");
      settings[key] = +btn.dataset[attr];
    };
  }
}
segInit("seg-players", "n", "n");
segInit("seg-level", "level", "l");
segInit("seg-rounds", "rounds", "r");

// ---- タイトル: 初回は簡素、2回目以降はフルメニュー ----
// 「最初の1局までの距離」を短くするため、初回は「はじめる」を主CTAにする。
const PLAYED_KEY = "hiragana_mahjong_played";
function hasPlayed() {
  try { return localStorage.getItem(PLAYED_KEY) === "1"; } catch { return false; }
}
function markPlayed() {
  try { localStorage.setItem(PLAYED_KEY, "1"); } catch { /* 保存不可環境 */ }
}
function applyTitleMenu(forceFull = false) {
  const full = forceFull || hasPlayed();
  $("menu-first").hidden = full;
  $("menu-full").hidden = !full;
}
applyTitleMenu();
$("btn-first-play").onclick = () => showScreen("screen-free");
$("btn-first-rules").onclick = () => { rulesReturn = "screen-title"; showScreen("screen-rules"); };
$("btn-first-more").onclick = () => applyTitleMenu(true);

$("btn-mode-free").onclick = () => showScreen("screen-free");
$("btn-free-back").onclick = () => showScreen("screen-title");
$("btn-start-free").onclick = () => { mode = "free"; startLocalGame(settings.n, settings.level, settings.rounds); };

$("btn-mode-rank").onclick = () => {
  renderRankPanel();
  resetRankSearchUI();
  $("rank-tip").hidden = false;
  $("rank-tip").innerHTML = randomTip();
  showScreen("screen-rank");
};
$("btn-rank-back").onclick = () => { cancelRankSearch(); showScreen("screen-title"); };

// ランク戦はオンライン対戦 (サーバのマッチングキューに入る)
function resetRankSearchUI() {
  $("rank-status").textContent = "";
  $("btn-start-rank").hidden = false;
  $("btn-rank-cancel").hidden = true;
}
function cancelRankSearch() {
  if (net) { net.send({ t: "rankCancel" }); net.close(); net = null; }
  resetRankSearchUI();
}
function rankPlayerName() {
  return readStore(NAME_KEY, "").trim() || `プレイヤー${Math.floor(Math.random() * 90 + 10)}`;
}
$("btn-start-rank").onclick = async () => {
  if (!onlineAvailable) {
    await showModal(
      `<div class="modal-title">ランク戦</div>
       <div class="modal-sub">ランク戦はオンライン対戦です。<br>この公開ページ版はサーバに接続できないため遊べません。<br>ゲームサーバ版 (npm start) で遊べます。<br>CPU練習は「フリー対戦」をどうぞ。</div>`,
      [{ label: "とじる", value: true }]);
    return;
  }
  mode = "rank";
  $("rank-status").textContent = "接続中…";
  $("btn-start-rank").hidden = true;
  $("btn-rank-cancel").hidden = false;
  try {
    net?.close();
    net = new NetClient();
    bindNetHandlers(net);
    await net.connect();
    net.send({ t: "rankJoin", name: rankPlayerName(), icon: myIcon(), rank: rankState.rank });
    $("rank-status").textContent = "対戦相手をさがしています…";
  } catch {
    $("rank-status").textContent = "サーバにつながりません";
    $("btn-start-rank").hidden = false;
    $("btn-rank-cancel").hidden = true;
    net = null;
  }
};
$("btn-rank-cancel").onclick = () => cancelRankSearch();

$("btn-sort").onclick = () => {
  handDisplay.chars = sortedChars(handDisplay.chars);
  handDisplay.drawnMark = -1;
  selectedIdx = -1;
  if (currentView) renderHand(currentView);
  notifyRearranged();
};

// ---- ヒント券 (フリー対戦限定) ----
let hintTimer = null;
$("btn-hint").onclick = async () => {
  if (mode !== "free" || !game) return;
  if (eco.hints <= 0) {
    const v = await showModal(
      `<div class="modal-title">ヒント券がない</div><div class="modal-sub">ショップで買えます (対局後のコインでもOK)</div>`,
      [{ label: "とじる", value: false }]);
    void v;
    return;
  }
  const r = useHint(eco);
  setEco(r.eco);
  showHintChips();
};
function computeFoundWords() {
  const hand = [...game.hands[HUMAN]];
  const need3 = game.need3(HUMAN);
  let cnt = counts(hand);
  const has = (need) => { for (const [c, n] of need) if ((cnt.get(c) || 0) < n) return false; return true; };
  const take = (need) => { for (const [c, n] of need) { const left = cnt.get(c) - n; if (left === 0) cnt.delete(c); else cnt.set(c, left); } };
  const words = [];
  let found3 = 0, progressed = true;
  while (found3 < need3 && progressed) {
    progressed = false;
    for (const e of dict._w3arr) {
      if (has(e.cnt)) { take(e.cnt); words.push(e.w); found3++; progressed = true; break; }
    }
  }
  for (const e of dict._w2arr) {
    if (has(e.cnt)) { words.push(e.w); break; }
  }
  return words;
}
function showHintChips() {
  const row = $("hint-row");
  const words = computeFoundWords();
  // カンできる4文字語もヒントの対象 (カンボタン自体は語を教えないため)
  const kans = kanOptions(game.hands[HUMAN], dict).slice(0, 2);
  row.innerHTML = "";
  if (words.length === 0 && kans.length === 0) {
    row.innerHTML = `<span class="hint-chip none">まだ ことばは できていない</span>`;
  } else {
    for (const w of words) {
      const c = document.createElement("span");
      c.className = "hint-chip";
      c.textContent = w;
      row.appendChild(c);
    }
    for (const w of kans) {
      const c = document.createElement("span");
      c.className = "hint-chip";
      c.textContent = `カン: ${w}`;
      row.appendChild(c);
    }
  }
  row.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { row.hidden = true; }, 8000);
}

// ---- ショップ ----
$("btn-mode-shop").onclick = () => { renderShop(); showScreen("screen-shop"); };
$("btn-shop-back").onclick = () => { updateEcoBadges(); showScreen("screen-title"); };

const TILE_PREVIEW_STYLE = {
  ivory: "background:linear-gradient(160deg,#fdf8ea,#ece1c8);color:#26221c;",
  sakura: "background:linear-gradient(160deg,#ffeef2,#f3c6d3);color:#7c2740;",
  shikkoku: "background:linear-gradient(160deg,#3a3532,#1a1713);color:#e8c87a;",
  hisui: "background:linear-gradient(160deg,#d9f2e4,#93cdb0);color:#1d4a35;",
};
const TABLE_PREVIEW_STYLE = {
  ai: "background:radial-gradient(circle,#17263b,#101b2c);",
  midori: "background:radial-gradient(circle,#1d5c3a,#0d2e1c);",
  akane: "background:radial-gradient(circle,#5c2431,#260d13);",
};

function shopRow(previewHtml, name, desc, btnLabel, btnCls, onClick, disabled = false) {
  const d = document.createElement("div");
  d.className = "shop-item";
  d.innerHTML = `<span class="si-preview">${previewHtml}</span>
    <span class="si-body"><div class="si-name">${name}</div><div class="si-desc">${desc}</div></span>`;
  const b = document.createElement("button");
  b.textContent = btnLabel;
  if (btnCls) b.className = btnCls;
  b.disabled = disabled;
  b.onclick = onClick;
  d.appendChild(b);
  return d;
}

function renderShop() {
  $("shop-coins").textContent = eco.coins;
  $("shop-hints").textContent = eco.hints;

  const tiles = $("shop-tiles");
  tiles.innerHTML = "";
  for (const t of TILE_THEMES) {
    const preview = `<span class="tile small" style="${TILE_PREVIEW_STYLE[t.id]}">あ</span>`;
    const owned = eco.ownedTiles.includes(t.id);
    const equipped = eco.tileTheme === t.id;
    tiles.appendChild(shopRow(
      preview, t.name, t.desc,
      equipped ? "装備中" : owned ? "装備する" : `🪙${t.price}`,
      equipped ? "equipped" : owned ? "equip" : "",
      () => {
        if (equipped) return;
        if (owned) { setEco(equipTile(eco, t.id)); renderShop(); return; }
        const r = buyItem(eco, t);
        if (!r.ok) { shopToast(r.reason); return; }
        setEco(equipTile(r.eco, t.id));
        renderShop();
      },
      equipped,
    ));
  }

  const tables = $("shop-tables");
  tables.innerHTML = "";
  for (const t of TABLE_THEMES) {
    const preview = `<span style="display:inline-block;width:22px;height:22px;border-radius:6px;${TABLE_PREVIEW_STYLE[t.id]}"></span>`;
    const owned = eco.ownedTables.includes(t.id);
    const equipped = eco.tableTheme === t.id;
    tables.appendChild(shopRow(
      preview, t.name, t.desc,
      equipped ? "装備中" : owned ? "装備する" : `🪙${t.price}`,
      equipped ? "equipped" : owned ? "equip" : "",
      () => {
        if (equipped) return;
        if (owned) { setEco(equipTable(eco, t.id)); renderShop(); return; }
        const r = buyItem(eco, t);
        if (!r.ok) { shopToast(r.reason); return; }
        setEco(equipTable(r.eco, t.id));
        renderShop();
      },
      equipped,
    ));
  }

  const items = $("shop-items");
  items.innerHTML = "";
  items.appendChild(shopRow(
    "💡", HINT_PACK.name, HINT_PACK.desc, `🪙${HINT_PACK.price}`, "",
    () => {
      const r = buyItem(eco, HINT_PACK);
      if (!r.ok) { shopToast(r.reason); return; }
      setEco(r.eco);
      renderShop();
    },
  ));

  items.appendChild(shopRow(
    "📺", `広告を見る (🪙${AD_REWARD})`, `きょうあと${adRewardsLeft(eco, todayStr())}回`,
    "視聴", "",
    async () => { await watchRewardedAd(); renderShop(); },
    adRewardsLeft(eco, todayStr()) <= 0,
  ));

  // おと: 効果音パックとBGMセット (試聴つき)
  const audioRow = (box, item, icon, owned, equipped, onAudition, onMain) => {
    const d = document.createElement("div");
    d.className = "shop-item";
    d.innerHTML = `<span class="si-preview">${icon}</span>
      <span class="si-body"><div class="si-name">${esc(item.name)}</div><div class="si-desc">${esc(item.desc)}</div></span>`;
    const listen = document.createElement("button");
    listen.textContent = "♪試聴";
    listen.onclick = onAudition;
    d.appendChild(listen);
    const b = document.createElement("button");
    b.textContent = equipped ? "装備中" : owned ? "装備する" : `🪙${item.price}`;
    b.className = equipped ? "equipped" : owned ? "equip" : "";
    b.disabled = equipped;
    b.onclick = onMain;
    d.appendChild(b);
    box.appendChild(d);
  };
  const sfxBox = $("shop-sfx");
  sfxBox.innerHTML = "";
  for (const p of ECO_SFX) {
    const owned = eco.ownedSfx.includes(p.id);
    const equipped = eco.sfxPack === p.id;
    audioRow(sfxBox, p, "🔔", owned, equipped, () => auditionSfx(p.id), () => {
      if (equipped) return;
      if (owned) { setEco(equipSfx(eco, p.id)); playSfx("tap"); renderShop(); return; }
      const r = buyItem(eco, p);
      if (!r.ok) { shopToast(r.reason); return; }
      setEco(equipSfx(r.eco, p.id));
      playSfx("coin");
      renderShop();
    });
  }
  const bgmBox = $("shop-bgm");
  bgmBox.innerHTML = "";
  for (const p of ECO_BGM) {
    const owned = eco.ownedBgm.includes(p.id);
    const equipped = eco.bgmSet === p.id;
    audioRow(bgmBox, p, "🎵", owned, equipped, () => auditionBgm(p.id), () => {
      if (equipped) return;
      if (owned) { setEco(equipBgm(eco, p.id)); renderShop(); return; }
      const r = buyItem(eco, p);
      if (!r.ok) { shopToast(r.reason); return; }
      setEco(equipBgm(r.eco, p.id));
      playSfx("coin");
      renderShop();
    });
  }

  const packs = $("shop-coins-packs");
  packs.innerHTML = "";
  // 広告なしはコインでは買えない課金専用 (現状デモ決済)
  packs.appendChild(shopRow(
    "🚫", AD_FREE_ITEM.name, AD_FREE_ITEM.desc,
    eco.adFree ? "購入済み" : AD_FREE_ITEM.demoPrice,
    eco.adFree ? "equipped" : "",
    async () => {
      if (eco.adFree) return;
      const ok = await showModal(
        `<div class="modal-title">デモ購入</div>
         <div class="modal-sub">「${AD_FREE_ITEM.name}」を ${AD_FREE_ITEM.demoPrice} で購入した「つもり」になります。<br>実際の決済は行われません。</div>`,
        [{ label: "購入する(デモ)", value: true }, { label: "やめる", value: false, ghost: true }]);
      if (!ok) return;
      const r = buyAdFree(eco);
      if (!r.ok) { shopToast(r.reason); return; }
      setEco(r.eco);
      playSfx("coin");
      renderShop();
    },
    eco.adFree,
  ));
  for (const p of COIN_PACKS) {
    packs.appendChild(shopRow(
      "🪙", p.label, "デモ購入 (実際のお金はかかりません)", p.demoPrice, "",
      async () => {
        const ok = await showModal(
          `<div class="modal-title">デモ購入</div>
           <div class="modal-sub">${p.label} を ${p.demoPrice} で購入した「つもり」になります。<br>実際の決済は行われません。</div>`,
          [{ label: "購入する(デモ)", value: true }, { label: "やめる", value: false, ghost: true }]);
        if (!ok) return;
        setEco(buyCoinPack(eco, p).eco);
        playSfx("coin");
        renderShop();
      },
    ));
  }
}
let shopToastTimer = null;
function shopToast(msg) {
  const el = $("shop-coins");
  const orig = eco.coins;
  el.textContent = `${orig} (${msg})`;
  clearTimeout(shopToastTimer);
  shopToastTimer = setTimeout(() => { el.textContent = eco.coins; }, 1500);
}

// ---- ことば図鑑 ----
let bookLen = 2;
let bookOpen = new Set(); // 展開中の行

function updateBookBadge() {
  const st = collectionStats(book, dict);
  $("title-book").textContent = `${st.found} / ${st.total}`;
}
updateBookBadge();

$("btn-mode-book").onclick = () => { renderBook(); showScreen("screen-book"); };
$("btn-book-back").onclick = () => showScreen("screen-title");
for (const btn of $("seg-book-len").querySelectorAll("button")) {
  btn.onclick = () => {
    $("seg-book-len").querySelectorAll("button").forEach(b => b.classList.remove("on"));
    btn.classList.add("on");
    bookLen = +btn.dataset.l;
    bookOpen = new Set();
    renderBook();
  };
}

function renderBook() {
  const st = collectionStats(book, dict);
  $("book-found").textContent = st.byLen[bookLen].found;
  $("book-total").textContent = st.byLen[bookLen].total;
  $("book-bar").style.width = (st.byLen[bookLen].total ? st.byLen[bookLen].found / st.byLen[bookLen].total * 100 : 0) + "%";
  $("book-percent").textContent = `ぜんぶで ${st.found} / ${st.total} (${st.percent}%)`;

  const list = $("book-list");
  list.innerHTML = "";
  for (const g of groupByRow(book, dict, bookLen)) {
    const box = document.createElement("div");
    box.className = "book-group";
    const head = document.createElement("button");
    head.className = "book-group-head";
    const open = bookOpen.has(g.row);
    head.innerHTML = `<span class="bg-row">${g.row}行</span>
      <span class="bg-count">${g.found} / ${g.total}</span>
      <span class="bg-arrow">${open ? "▲" : "▼"}</span>`;
    head.onclick = () => {
      if (bookOpen.has(g.row)) bookOpen.delete(g.row); else bookOpen.add(g.row);
      playSfx("tap");
      renderBook();
    };
    box.appendChild(head);
    if (open) {
      const words = document.createElement("div");
      words.className = "book-words";
      for (const item of g.words) {
        const chip = document.createElement("span");
        chip.className = "book-word" + (item.found ? "" : " unfound");
        chip.textContent = item.found ? item.w : "？".repeat(bookLen);
        words.appendChild(chip);
      }
      box.appendChild(words);
    }
    list.appendChild(box);
  }
}

// 局の終わり: 自分が作ったことばを図鑑に記録し、実績の記録も進める
// 戻り値: 新しく見つけたことば
function recordMyWords(result) {
  const view = currentView;
  const words = [];
  const myMelds = view ? (view.players[view.myIndex]?.melds || []) : [];
  for (const m of myMelds) words.push(m.word);
  const iWon = result && result.type !== "draw" && view && result.winner === view.myIndex;

  // 実績の記録 (鳴き回数とあがり)
  for (const m of myMelds) ach = countMeld(ach, m.type);
  ach = applyRoundResult(ach, iWon
    ? { won: true, type: result.type, score: result.score.total, rare: result.score.rare, kans: result.score.kans }
    : { won: false });

  if (iWon) {
    if (result.decomp.two) words.push(result.decomp.two);
    words.push(...result.decomp.threes);
    for (const m of result.melds || []) words.push(m.word);
  }
  if (words.length === 0) { saveAch(); return []; }
  const r = recordWords(book, words);
  if (r.newWords.length > 0) {
    book = r.col;
    saveCollection(book);
    setEco({ ...eco, coins: eco.coins + r.newWords.length * NEW_WORD_COIN });
    updateBookBadge();
  }
  return r.newWords;
}

// ---- 実績・称号 ----
function saveAch() { saveAchievements(ach); updateAchBadge(); }
function updateAchBadge() {
  $("title-ach").textContent = `${ach.unlocked.length} / ${ACHIEVEMENTS.length}`;
  const t = currentTitle(ach);
  $("title-ach-desc").textContent = t ? `称号: ${t.icon} ${t.name}` : "称号を集めよう";
}
updateAchBadge();

$("btn-mode-ach").onclick = () => { renderAch(); showScreen("screen-ach"); };
$("btn-ach-back").onclick = () => showScreen("screen-title");

function renderAch() {
  ach = syncProgress(ach, { words: collectionStats(book, dict).found, rank: rankState.rank });
  saveAch();
  $("ach-found").textContent = ach.unlocked.length;
  $("ach-total").textContent = ACHIEVEMENTS.length;
  $("ach-bar").style.width = (ach.unlocked.length / ACHIEVEMENTS.length * 100) + "%";
  const t = currentTitle(ach);
  $("ach-title-now").textContent = t ? `いまの称号: ${t.icon} ${t.name}` : "まだ称号がありません";

  const list = $("ach-list");
  list.innerHTML = "";
  for (const a of ACHIEVEMENTS) {
    const done = ach.unlocked.includes(a.id);
    const d = document.createElement("div");
    d.className = `ach-item ${done ? "done" : "locked"}`;
    d.innerHTML = `<span class="ach-icon">${done ? a.icon : "🔒"}</span>
      <span class="ach-body"><div class="ach-name">${esc(a.name)}</div><div class="ach-desc">${esc(a.desc)}</div></span>
      <span class="ach-coin">${done ? "達成!" : `🪙${a.coin}`}</span>`;
    list.appendChild(d);
  }
  const s = ach.stats;
  $("ach-stats").innerHTML = [
    ["対局", s.games], ["あがり", s.wins], ["1位", s.tops],
    ["ポン", s.pons], ["カン", s.kans], ["最高得点", s.bestScore], ["連続あがり", s.maxStreak],
  ].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join("");
}

function showAchToast(list) {
  const box = $("ach-toast");
  for (const a of list) {
    const el = document.createElement("div");
    el.className = "ach-toast-item";
    el.innerHTML = `<span class="ach-icon">${a.icon}</span>
      <span class="ach-body"><div class="at-label">称号かくとく</div><div class="at-name">${esc(a.name)}</div></span>
      <span class="ach-coin">🪙+${a.coin}</span>`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
}

// 進捗を同期して未解除の実績を判定・付与する
function refreshUnlocks() {
  ach = syncProgress(ach, { words: collectionStats(book, dict).found, rank: rankState.rank });
  const r = checkUnlocks(ach);
  ach = r.ach;
  if (r.unlocked.length > 0) {
    setEco({ ...eco, coins: eco.coins + r.coins });
    showAchToast(r.unlocked);
    playSfx("coin");
  }
  saveAch();
  return r.unlocked;
}

// ---- シェア画像 ----
function showShareModal(data) {
  return new Promise(resolve => {
    const card = $("share-card");
    card.innerHTML = `<div class="modal-title">シェア</div>`;
    let canvas;
    try {
      canvas = renderWinImage(data);
    } catch {
      card.innerHTML += `<div class="modal-sub">画像を作れませんでした</div>`;
    }
    if (canvas) {
      const img = document.createElement("img");
      img.className = "share-preview";
      img.alt = "あがりの結果";
      img.src = canvas.toDataURL("image/png");
      card.appendChild(img);
      const hint = document.createElement("p");
      hint.className = "share-hint";
      hint.textContent = "画像を長おしすると保存できます";
      card.appendChild(hint);
    }
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:center;flex-wrap:wrap";
    if (canvas && navigator.canShare) {
      const shareBtn = document.createElement("button");
      shareBtn.className = "btn-secondary";
      shareBtn.textContent = "共有する";
      shareBtn.onclick = async () => {
        const ok = await shareImage(canvas, "ひらがな麻雀であがった!");
        if (!ok) shareBtn.textContent = "長おしで保存してね";
      };
      row.appendChild(shareBtn);
    }
    const close = document.createElement("button");
    close.className = "btn-primary";
    close.textContent = "とじる";
    close.onclick = () => { $("share-modal").classList.add("hidden"); resolve(true); };
    row.appendChild(close);
    card.appendChild(row);
    $("share-modal").classList.remove("hidden");
  });
}

function newWordsHtml(newWords) {
  if (newWords.length === 0) return "";
  return `<div class="modal-sub" style="margin-top:0.7rem">はじめて作ったことば! 🪙+${newWords.length * NEW_WORD_COIN}</div>
    <div class="newword-row">${newWords.slice(0, 5).map(w => `<span class="newword">${esc(w)}</span>`).join("")}</div>`;
}

// ---- プロフィール (なまえ + アイコン) ----
const NAME_KEY = "hiragana_mahjong_name";
const ICON_KEY = "hiragana_mahjong_icon";
const PLAYER_ICONS = ["🐱", "🐼", "🦊", "🐸", "🀄", "🌙"]; // サーバの PLAYER_ICONS と同じ並び
const CPU_ICON_MAP = { "あかり": "🌸", "つばき": "🍵", "げんた": "🐻", "こまち": "🎐" };
function myIcon() {
  const i = readStore(ICON_KEY, "");
  return PLAYER_ICONS.includes(i) ? i : PLAYER_ICONS[0];
}
function myName() {
  return readStore(NAME_KEY, "").trim() || "ななし";
}
let profileReturn = "screen-title";
let profileDraftIcon = null;

function updateProfileBadges() {
  $("title-profile-icon").textContent = myIcon();
  const name = readStore(NAME_KEY, "").trim();
  $("title-profile-desc").textContent = name ? `${name} として対局中` : "なまえとアイコン";
  $("btn-friend-profile").textContent = `${myIcon()} ${name || "ななし"} — なまえを変える`;
}
function openProfile(returnTo) {
  profileReturn = returnTo;
  profileDraftIcon = myIcon();
  $("inp-profile-name").value = readStore(NAME_KEY, "");
  renderIconGrid();
  showScreen("screen-profile");
}
function renderIconGrid() {
  const g = $("icon-grid");
  g.innerHTML = "";
  for (const ic of PLAYER_ICONS) {
    const b = document.createElement("button");
    b.className = "icon-choice" + (ic === profileDraftIcon ? " on" : "");
    b.textContent = ic;
    b.setAttribute("aria-label", `アイコン ${ic} をえらぶ`);
    b.onclick = () => { profileDraftIcon = ic; playSfx("tap"); renderIconGrid(); };
    g.appendChild(b);
  }
}
$("btn-mode-profile").onclick = () => openProfile("screen-title");
$("btn-friend-profile").onclick = () => openProfile("screen-friend");
$("btn-profile-save").onclick = () => {
  const name = $("inp-profile-name").value.trim().slice(0, 8);
  writeStore(NAME_KEY, name);
  writeStore(ICON_KEY, profileDraftIcon || PLAYER_ICONS[0]);
  updateProfileBadges();
  playSfx("coin");
  showScreen(profileReturn);
};
$("btn-profile-back").onclick = () => showScreen(profileReturn);
updateProfileBadges();

$("btn-rules").onclick = () => { rulesReturn = "screen-title"; showScreen("screen-rules"); };
$("btn-rules-back").onclick = () => showScreen(rulesReturn);
$("btn-help").onclick = () => { rulesReturn = "screen-game"; showScreen("screen-rules"); };

function renderRankPanel() {
  $("rank-big").textContent = rankState.rank;
  $("title-rank-badge").textContent = rankState.rank;
  const pct = rankState.rank === "S"
    ? 100
    : Math.max(0, Math.min(100, rankState.rp / RP_PER_RANK * 100));
  $("rank-bar-fill").style.width = pct + "%";
  $("rank-rp").textContent = rankState.rank === "S" ? `${rankState.rp} RP` : `${rankState.rp} / ${RP_PER_RANK} RP`;
  $("rank-record").textContent = rankState.games > 0
    ? `通算 ${rankState.games}戦 / 1位 ${rankState.tops}回`
    : "はじめてのランク戦!";
}
renderRankPanel();

// ================= ガイドバー =================
function setGuide(text, tone = "") {
  const bar = $("guide-bar");
  bar.className = tone; // "", "my-turn", "alert"
  $("guide-text").textContent = text;
}

// 残り時間表示 (オンラインの手番60秒/鳴き20秒)。ローカル対戦は時間無制限なので出ない。
let promptTimerInterval = null;
function startPromptTimer(ms) {
  stopPromptTimer();
  if (!ms) return;
  const deadline = Date.now() + ms;
  const el = $("guide-timer");
  const tick = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    el.textContent = `⏱ ${left}`;
    el.classList.toggle("urgent", left <= 10);
    if (left <= 0) stopPromptTimer();
  };
  tick();
  promptTimerInterval = setInterval(tick, 500);
}
function stopPromptTimer() {
  clearInterval(promptTimerInterval);
  promptTimerInterval = null;
  $("guide-timer").textContent = "";
  $("guide-timer").classList.remove("urgent");
}

// ================= ビュー描画 =================
// view = { myIndex, round, totalRounds, wallCount, turn, phase,
//          players:[{name,score,melds,discards,isCpu,connected}],
//          myHand:[...], drawnTile, lastDiscard:{tile,from}|null }
function tileEl(ch, sizeCls) {
  const el = document.createElement("span");
  el.className = `tile ${sizeCls}`;
  el.textContent = ch;
  if (RARE_TILES.has(ch)) el.classList.add("rare");
  return el;
}

const MODE_LABEL = { free: "フリー", rank: "ランク戦", friend: "ともだち" };

function renderView(view) {
  currentView = view;
  $("round-label").textContent = `${view.round}局目 / 全${view.totalRounds}局`;
  $("mode-label").textContent = MODE_LABEL[mode] || "";
  $("wall-count").textContent = `山 ${view.wallCount}`;
  renderOpponents(view);
  renderRivers(view);
  renderMyMelds(view);
  renderHand(view);
  maybeRoundIntro(view);
  const me = view.players[view.myIndex];
  $("my-name").textContent = `${me.icon || ""} ${me.name}`.trim();
  $("my-score").textContent = `${me.score}点`;
}

function seatOrder(view) {
  // 自分から時計回り: [me, me+1, ...]
  const order = [];
  for (let k = 0; k < view.players.length; k++) order.push((view.myIndex + k) % view.players.length);
  return order;
}

function renderOpponents(view) {
  const box = $("opponents");
  box.innerHTML = "";
  for (const p of seatOrder(view).slice(1)) {
    const pl = view.players[p];
    const d = document.createElement("div");
    d.className = "opp" + (view.turn === p && !view.over ? " active" : "");
    const head = document.createElement("div");
    head.className = "opp-head";
    const conn = pl.connected === false ? " (切断)" : "";
    head.innerHTML = `<span class="opp-name">${pl.icon ? `<span class="player-icon">${esc(pl.icon)}</span>` : ""}${esc(pl.name)}${conn}</span><span class="opp-score">${pl.score}点</span>`;
    d.appendChild(head);
    const melds = document.createElement("div");
    melds.className = "opp-melds";
    for (const m of pl.melds) for (const ch of m.word) melds.appendChild(tileEl(ch, "mini"));
    d.appendChild(melds);
    box.appendChild(d);
  }
}

function renderRivers(view) {
  const box = $("rivers");
  box.innerHTML = "";
  for (const p of seatOrder(view)) {
    const pl = view.players[p];
    const row = document.createElement("div");
    row.className = "river";
    const label = document.createElement("span");
    label.className = "river-label";
    label.textContent = p === view.myIndex ? "あなた" : pl.name;
    row.appendChild(label);
    const tiles = document.createElement("div");
    tiles.className = "river-tiles";
    // 河が伸びたら牌を小さくして、卓をスクロールさせずに一目で見渡せるようにする
    const size = pl.discards.length > 12 ? "mini" : "small";
    pl.discards.forEach((ch, i) => {
      const el = tileEl(ch, size);
      if (view.lastDiscard && view.lastDiscard.from === p && i === pl.discards.length - 1) {
        el.classList.add("recent");
      }
      tiles.appendChild(el);
    });
    row.appendChild(tiles);
    box.appendChild(row);
  }
}

function renderMyMelds(view) {
  const box = $("my-melds");
  box.innerHTML = "";
  for (const m of view.players[view.myIndex].melds) {
    const d = document.createElement("div");
    d.className = "meld";
    const t = document.createElement("span");
    t.className = "meld-type";
    t.textContent = m.type === "kan" ? "カン" : "ポン";
    d.appendChild(t);
    for (const ch of m.word) {
      const el = tileEl(ch, "small");
      // ポンでもらった牌を強調 (同じ文字が2枚ある語では先頭の1枚だけ)
      if (m.type === "pon" && m.claimed === ch && !d.querySelector(".got")) el.classList.add("got");
      d.appendChild(el);
    }
    box.appendChild(d);
  }
}

// ================= 手牌表示 (自由な並び替え対応) =================
// 表示順は「文字の並び」として自分で管理する。同じ文字の牌は互換なので
// 表示位置→手牌indexの対応は文字マッチで再構築できる。
let handDisplay = { chars: [], drawnMark: -1 };
const kanaKey = (c) => c === "ー" ? "んん" : c;

function sortedChars(hand) {
  return [...hand].sort((a, b) => kanaKey(a).localeCompare(kanaKey(b), "ja"));
}

function reconcileHand(hand, drawnTile) {
  const cur = handDisplay.chars;
  const handCnt = counts(hand);
  const curCnt = counts(cur);
  const removed = [], added = [];
  for (const [c, n] of curCnt) { const d = n - (handCnt.get(c) || 0); for (let i = 0; i < d; i++) removed.push(c); }
  for (const [c, n] of handCnt) { const d = n - (curCnt.get(c) || 0); for (let i = 0; i < d; i++) added.push(c); }

  if (cur.length === 0 || removed.length + added.length > 6) {
    // 新しい局など: 整列して作り直し (ツモ牌は右端へ)
    let chars = sortedChars(hand);
    if (drawnTile != null) {
      const i = chars.lastIndexOf(drawnTile);
      if (i >= 0) { chars.splice(i, 1); chars.push(drawnTile); }
    }
    handDisplay = { chars, drawnMark: drawnTile != null ? chars.length - 1 : -1 };
    return;
  }
  for (const c of removed) {
    const i = cur.indexOf(c);
    if (i >= 0) {
      cur.splice(i, 1);
      if (i < handDisplay.drawnMark) handDisplay.drawnMark--;
      else if (i === handDisplay.drawnMark) handDisplay.drawnMark = -1;
    }
  }
  for (const c of added) cur.push(c);
  if (drawnTile == null) handDisplay.drawnMark = -1;
  else if (added.length > 0) handDisplay.drawnMark = cur.length - 1;
}

function renderHand(view) {
  const box = $("my-hand");
  box.innerHTML = "";
  const hand = view.myHand;
  reconcileHand(hand, view.turn === view.myIndex ? view.drawnTile : null);
  const used = new Array(hand.length).fill(false);
  handDisplay.chars.forEach((ch, di) => {
    let hi = -1;
    for (let i = 0; i < hand.length; i++) {
      if (!used[i] && hand[i] === ch) { hi = i; used[i] = true; break; }
    }
    const el = tileEl(ch, "hand");
    if (di === handDisplay.drawnMark) el.classList.add("drawn");
    if (di === selectedIdx) el.classList.add("selected");
    attachTileHandlers(el, di, hi);
    box.appendChild(el);
  });
  $("btn-hint").hidden = !(mode === "free" && game);
}

// ---- ドラッグ並び替え + タップ選択 ----
// 指はまっすぐ止まらないので、しきい値は指のブレ(約10px)より大きく取る。
const DRAG_THRESHOLD = 16;
let drag = null; // {x, fromDi, active}
function attachTileHandlers(el, di, hi) {
  el.onpointerdown = (e) => {
    drag = { x: e.clientX, fromDi: di, active: false };
    try { el.setPointerCapture(e.pointerId); } catch { /* 古いブラウザ */ }
  };
  el.onpointermove = (e) => {
    if (!drag || drag.fromDi !== di) return;
    if (!drag.active && Math.abs(e.clientX - drag.x) > DRAG_THRESHOLD) {
      drag.active = true;
      el.classList.add("dragging");
    }
    if (drag.active) markDropTarget(dropIndexAt(e.clientX));
  };
  el.onpointerup = (e) => {
    const d = drag;
    drag = null;
    if (d && d.active) {
      const to = dropIndexAt(e.clientX);
      // 元の位置に戻っただけなら「動かすつもりはなかった」= タップ扱いにする
      if (to === d.fromDi || to === d.fromDi + 1) {
        if (currentView) renderHand(currentView);
        onTileTap(di, hi);
      } else {
        moveTile(d.fromDi, to);
      }
      return;
    }
    onTileTap(di, hi);
  };
  el.onpointercancel = () => {
    drag = null;
    if (currentView) renderHand(currentView);
  };
  // ポインタイベントが使えない古い端末向けの保険 (二重発火はpointerupで抑止済み)
  el.onclick = (e) => { if (e.detail === 0) onTileTap(di, hi); };
}

function dropIndexAt(clientX) {
  const tiles = [...$("my-hand").children];
  for (let i = 0; i < tiles.length; i++) {
    const r = tiles[i].getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return i;
  }
  return tiles.length;
}
function markDropTarget(ti) {
  [...$("my-hand").children].forEach((el, i) => el.classList.toggle("drop-target", i === ti));
}
function moveTile(fromDi, toIdx) {
  const chars = handDisplay.chars;
  const [ch] = chars.splice(fromDi, 1);
  let to = toIdx;
  if (to > fromDi) to--;
  chars.splice(to, 0, ch);
  // ツモ印の位置を追従
  let m = handDisplay.drawnMark;
  if (m === fromDi) m = to;
  else {
    if (m > fromDi) m--;
    if (m >= to) m++;
  }
  handDisplay.drawnMark = m;
  selectedIdx = -1;
  if (currentView) renderHand(currentView);
  notifyRearranged();
}

// ================= 並べてあがる方式 =================
// あがりは自動検出しない。手牌の「表示順」がことばに区切れているときだけ成立する。
function myNeed3() {
  const v = currentView;
  if (!v) return 4;
  return 4 - (v.players[v.myIndex].melds?.length || 0);
}
// いまの並びであがれるなら分解を返す
function arrangedWinNow() {
  const v = currentView;
  if (!v) return null;
  if (handDisplay.chars.length !== 2 + myNeed3() * 3) return null;
  return checkArrangedWin(handDisplay.chars, myNeed3(), dict);
}
// 捨て牌tileを差し込んでロンできるか
function arrangedRonNow(tile) {
  const v = currentView;
  if (!v) return null;
  if (handDisplay.chars.length !== v.myHand.length) return null;
  return checkArrangedRon(handDisplay.chars, tile, myNeed3(), dict);
}

// 並び替えが起きたとき: オンラインへ同期し、手番中なら選択肢を出し直す
let arrangeSyncTimer = null;
let lastArrangeSent = "";
function scheduleArrangeSync() {
  if (!net) return;
  clearTimeout(arrangeSyncTimer);
  arrangeSyncTimer = setTimeout(() => {
    const key = handDisplay.chars.join("");
    if (key === lastArrangeSent) return;
    lastArrangeSent = key;
    net?.send({ t: "arrange", tiles: [...handDisplay.chars] });
  }, 200);
}
function notifyRearranged() {
  scheduleArrangeSync();
  if (pendingResolve && pendingResolve.allowDiscard) {
    resolveHuman({ type: "rearranged" });
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ================= 操作プロンプト =================
function onTileTap(displayIdx, handIdx) {
  if (!pendingResolve || !pendingResolve.allowDiscard) return;
  if (selectedIdx === displayIdx) {
    // 表示上もその位置の牌を除去 (次のreconcileと整合)
    handDisplay.chars.splice(displayIdx, 1);
    if (displayIdx < handDisplay.drawnMark) handDisplay.drawnMark--;
    else if (displayIdx === handDisplay.drawnMark) handDisplay.drawnMark = -1;
    playSfx("discard");
    resolveHuman({ type: "discard", idx: handIdx });
  } else {
    selectedIdx = displayIdx;
    playSfx("tap");
    renderHand(currentView);
  }
}

function waitHumanAction(actions, allowDiscard) {
  return new Promise(resolve => {
    pendingResolve = { resolve, allowDiscard };
    renderActionBar(actions);
  });
}
function resolveHuman(value) {
  if (!pendingResolve) return;
  const r = pendingResolve.resolve;
  pendingResolve = null;
  selectedIdx = -1;
  renderActionBar([]);
  r(value);
}
function cancelPending() {
  pendingResolve = null;
  selectedIdx = -1;
  stopPromptTimer();
  renderActionBar([]);
}

function renderActionBar(actions) {
  const bar = $("action-bar");
  bar.innerHTML = "";
  if (!actions || actions.length === 0) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  for (const a of actions) {
    const b = document.createElement("button");
    b.className = `act-btn ${a.cls || ""}`;
    b.textContent = a.label;
    b.onclick = () => resolveHuman(a.value);
    bar.appendChild(b);
  }
}

// 手番プロンプト (ローカル/オンライン共通)
// opts = {canTsumo:bool, kanWords:[]}
async function promptTurn(opts) {
  const kanWords = opts.kanWords || [];
  while (true) {
    const acts = [];
    if (opts.canTsumo) acts.push({ label: "ツモ!", cls: "main", value: { type: "tsumo" } });
    // カンできる語は見せない (語を知るのはサポートアイテム=ヒント券の役目)
    if (kanWords.length > 0) acts.push({ label: "カン", cls: "word", value: { type: "kan-menu" } });
    if (opts.canTsumo) {
      setGuide("ならびが そろった! 「ツモ!」であがろう", "alert");
    } else if (kanWords.length > 0) {
      setGuide("カンするか、ことば順にならべて いらない牌を捨てよう", "my-turn");
    } else {
      setGuide("あなたの番! ことば順にならべて、いらない牌を2回タップで捨てよう", "my-turn");
    }
    const a = await waitHumanAction(acts, true);
    if (a.type !== "kan-menu") return a;
    // カンを宣言してから、さらす語を選ぶ (どのみち公開される情報なのでここでは見せる)
    if (kanWords.length === 1) return { type: "kan", word: kanWords[0] };
    setGuide("どのことばで カンする?", "my-turn");
    const choice = await waitHumanAction([
      ...kanWords.slice(0, 3).map(w => ({ label: w, cls: "word", value: { type: "kan", word: w } })),
      { label: "やめる", cls: "", value: { type: "back" } },
    ], false);
    if (choice.type === "kan") return choice;
    // やめる → 手番の選択に戻る
  }
}

// 鳴きプロンプト。opts = {ron:bool, ponWords:[]}
async function promptClaim(opts) {
  const acts = [];
  if (opts.ron) acts.push({ label: "ロン!", cls: "main", value: { type: "ron" } });
  for (const w of (opts.ponWords || []).slice(0, 3)) {
    acts.push({ label: `ポン ${w}`, cls: "word", value: { type: "pon", word: w } });
  }
  acts.push({ label: "パス", cls: "", value: { type: "pass" } });
  if (opts.ron) setGuide("その捨て牌であがれます! 「ロン!」", "alert");
  else setGuide("ポンできます。ことばを選ぶか「パス」", "my-turn");
  return waitHumanAction(acts, false);
}

// ================= 演出 =================
async function showBanner(text, strong, who = null) {
  if (strong) playSfx("claim");
  const b = $("banner");
  b.classList.remove("hidden");
  b.innerHTML = `<span class="banner-text ${strong ? "shu" : ""}">${who ? `<small style="font-size:0.45em;display:block;letter-spacing:0.1em">${esc(who)}</small>` : ""}${esc(text)}</span>`;
  await sleep(900);
  b.classList.add("hidden");
}

function showModal(html, buttons, afterRender = null) {
  return new Promise(resolve => {
    const card = $("modal-card");
    card.innerHTML = html;
    if (afterRender) afterRender(card);
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;justify-content:center;margin-top:0.6rem;flex-wrap:wrap";
    for (const b of buttons) {
      const el = document.createElement("button");
      el.className = b.ghost ? "btn-ghost" : "btn-primary";
      el.style.marginTop = "0.4rem";
      el.textContent = b.label;
      el.onclick = () => { $("modal").classList.add("hidden"); resolve(b.value); };
      btnRow.appendChild(el);
    }
    card.appendChild(btnRow);
    $("modal").classList.remove("hidden");
  });
}

function tanzakuHtml(decomp, melds) {
  const items = [];
  for (const m of melds) items.push({ w: m.word, cls: m.type === "kan" ? "kan-word" : "" });
  for (const w of decomp.threes) items.push({ w, cls: "" });
  if (decomp.two) items.push({ w: decomp.two, cls: "two" });
  return `<div class="tanzaku-row">${items.map(i => `<span class="tanzaku ${i.cls}">${i.w}</span>`).join("")}</div>`;
}

// result = {type, winnerName, loserName, decomp, melds, score}
async function showRoundEndModal(result, isLast) {
  const newWords = recordMyWords(result);
  const iWon = result.type !== "draw" && currentView && result.winner === currentView.myIndex;
  let html = "";
  if (result.type === "draw") {
    html = `<div class="modal-title">流局</div><div class="modal-sub">山が なくなりました</div>`;
  } else {
    playSfx(iWon ? "win" : "lose");
    const verb = result.type === "tsumo" ? "ツモ" : `ロン (${esc(result.loserName)}から)`;
    html = `<div class="modal-title">${esc(result.winnerName)} あがり!</div>
      <div class="modal-sub">${verb}</div>
      ${tanzakuHtml(result.decomp, result.melds)}
      <div class="score-line">基本 8点${result.score.rare ? ` + レア牌 ${result.score.rare}×2点` : ""}${result.score.kans ? ` + カン ${result.score.kans}×2点` : ""}</div>
      <div class="score-line">合計 <b>${result.score.total}点</b></div>`;
  }
  if (newWords.length > 0) playSfx("coin");
  html += newWordsHtml(newWords);
  if (iWon) html += `<div style="margin-top:0.6rem"><button id="btn-share-win" class="btn-secondary">画像でシェア</button></div>`;

  const attachShare = (card) => {
    const btn = card.querySelector("#btn-share-win");
    if (!btn) return;
    btn.onclick = () => showShareModal({
      decomp: result.decomp, melds: result.melds, score: result.score,
      type: result.type, playerName: result.winnerName,
    });
  };
  await showModal(html, [{ label: isLast ? "結果を見る" : "つぎの局へ", value: true }], attachShare);
  refreshUnlocks();
}

// standings = [{name, score, isMe}] (降順)
async function showFinalModal(lastResult, standings, extraHtml, buttons) {
  let head = "";
  if (lastResult && lastResult.type !== "draw") {
    head = `<div class="modal-sub">${esc(lastResult.winnerName)}が あがって終了</div>`;
  } else if (lastResult) {
    head = `<div class="modal-sub">最終局は 流局</div>`;
  }
  const kanji = ["一", "二", "三", "四"];
  const rows = standings.map((p, i) =>
    `<tr class="${p.isMe ? "me" : ""}"><td class="rank">${kanji[i]}位</td><td>${esc(p.name)}</td><td class="pts">${p.score}点</td></tr>`
  ).join("");
  const html = `<div class="modal-title">結果発表</div>${head}<table class="rank-table">${rows}</table>${extraHtml || ""}`;
  return showModal(html, buttons);
}

// ================= ローカル対戦 =================
const HUMAN = 0;

// cpuWords: CPUの語彙数 (辞書全体の大きさに関係なく強さを固定する)
function startLocalGame(n, cpuWords, rounds) {
  const players = [{ name: myName(), isHuman: true }];
  for (let i = 0; i < n - 1; i++) {
    players.push({ name: CPU_NAMES[i], isHuman: false, dict: subsetDictByCount(dict, cpuWords) });
  }
  markPlayed();
  applyTitleMenu();
  game = new Game({ players, dict, rounds });
  handDisplay = { chars: [], drawnMark: -1 };
  selectedIdx = -1;
  $("hint-row").hidden = true;
  showScreen("screen-game");
  runLocalGame();
}

function localView() {
  return {
    myIndex: HUMAN,
    round: game.round, totalRounds: game.totalRounds,
    wallCount: game.wall.length, turn: game.turn, phase: game.phase,
    over: !!game.roundResult,
    players: game.players.map((p, i) => ({
      name: p.name, icon: p.isHuman ? myIcon() : (CPU_ICON_MAP[p.name] || "🤖"),
      score: p.score, isCpu: !p.isHuman,
      melds: game.melds[i], discards: game.discards[i],
    })),
    myHand: game.hands[HUMAN],
    drawnTile: game.turn === HUMAN ? game.drawnTile : null,
    lastDiscard: game.lastDiscard,
  };
}
const rerender = () => renderView(localView());

function localResultPayload() {
  const r = game.roundResult;
  if (r.type === "draw") return { type: "draw" };
  return {
    type: r.type,
    winner: r.winner,
    winnerName: game.players[r.winner].name,
    loserName: r.type === "ron" ? game.players[r.loser].name : null,
    decomp: r.decomp, melds: game.melds[r.winner], score: r.score,
  };
}

async function runLocalGame() {
  while (true) {
    game.startRound();
    rerender();
    await playLocalRound();
    const isLast = game.phase === Phase.GAME_END;
    await showRoundEndModal(localResultPayload(), isLast);
    if (isLast) { await showLocalFinal(); return; }
  }
}

async function playLocalRound() {
  while (true) {
    if (game.phase === Phase.ROUND_END || game.phase === Phase.GAME_END) return;
    if (game.phase === Phase.DRAW) {
      const p = game.turn;
      if (p !== HUMAN) setGuide(`${game.players[p].name}の番です…`);
      const t = game.drawTile();
      if (t === null) { await showBanner("流局", false); return; }
      rerender();
    }
    if (game.turn === HUMAN) {
      await humanDiscardPhase();
    } else {
      await cpuDiscardPhase();
    }
    if (game.roundResult) return;
    await resolveLocalClaims();
    if (game.roundResult) return;
  }
}

async function humanDiscardPhase() {
  while (true) {
    rerender();
    const p = HUMAN;
    // あがりは並べたときだけ (自動探索はしない)
    const arranged = game.hands[p].length === game.fullHandSize(p) ? arrangedWinNow() : null;
    const kans = game.wall.length > 0 ? game.canKan(p) : [];
    const action = await promptTurn({ canTsumo: !!arranged, kanWords: kans });
    if (action.type === "rearranged") continue; // 並びが変わった → 選択肢を出し直す
    if (action.type === "tsumo") {
      const decomp = arrangedWinNow();
      if (!decomp) continue; // 押した直後に並びが崩れた等
      await showBanner("ツモ!", true);
      game.winByTsumo(p, decomp);
      rerender();
      return;
    }
    if (action.type === "kan") {
      await showBanner("カン!", true);
      const rep = game.declareKan(p, action.word);
      if (rep === null) { await showBanner("流局", false); return; }
      continue;
    }
    if (action.type === "discard") {
      game.discard(action.idx);
      rerender();
      return;
    }
  }
}

async function cpuDiscardPhase() {
  const p = game.turn;
  setGuide(`${game.players[p].name}の番です…`);
  rerender();
  await sleep(650);
  while (true) {
    if (game.hands[p].length === game.fullHandSize(p) && game.canTsumo(p)) {
      await showBanner("ツモ!", true, game.players[p].name);
      game.winByTsumo(p);
      rerender();
      return;
    }
    const kans = game.wall.length > 0 ? game.canKan(p) : [];
    if (kans.length > 0 && shouldKan(game.wall.length)) {
      await showBanner("カン!", true, game.players[p].name);
      const rep = game.declareKan(p, kans[0]);
      rerender();
      if (rep === null) { await showBanner("流局", false); return; }
      await sleep(450);
      continue;
    }
    game.discard(chooseDiscard(game.hands[p], game.need3(p), game.dictFor(p)));
    rerender();
    return;
  }
}

async function resolveLocalClaims() {
  const { tile, from } = game.lastDiscard;
  const order = [];
  for (let k = 1; k < game.n; k++) order.push((from + k) % game.n);

  for (const p of order) {
    if (p === HUMAN) {
      // 人間のロンは「並べてある」ときだけ成立する
      const decomp = arrangedRonNow(tile);
      if (!decomp) continue;
      const act = await promptClaim({ ron: true, ponWords: [] });
      if (act.type !== "ron") continue;
      await showBanner("ロン!", true, game.players[p].name);
      game.winByRon(p, decomp);
      rerender();
      return;
    }
    if (game.canRon(p, tile)) {
      await showBanner("ロン!", true, game.players[p].name);
      game.winByRon(p);
      rerender();
      return;
    }
  }
  for (const p of order) {
    const words = game.canPon(p, tile);
    if (words.length === 0) continue;
    if (p === HUMAN) {
      const act = await promptClaim({ ron: false, ponWords: words });
      if (act.type !== "pon") continue;
      await showBanner("ポン!", true);
      game.claimPon(p, act.word);
      rerender();
      return;
    } else {
      const w = words.find(w => shouldPon(game.hands[p], game.need3(p), w, tile, game.dictFor(p)));
      if (w) {
        await showBanner("ポン!", true, game.players[p].name);
        game.claimPon(p, w);
        rerender();
        await sleep(300);
        return;
      }
    }
  }
  game.passClaims();
}

async function showLocalFinal() {
  const ranked = [...game.players].sort((a, b) => b.score - a.score);
  const standings = ranked.map(p => ({ name: p.name, score: p.score, isMe: p.isHuman }));
  const myPlace = ranked.findIndex(p => p.isHuman);
  const rw = grantReward(eco, myPlace);
  setEco(rw.eco);
  ach = applyGameEnd(ach, myPlace);
  refreshUnlocks();
  const extra = `<div class="modal-sub">対局ボーナス 🪙+${rw.reward} (所持 ${eco.coins})</div>`;
  const v = await showFinalModal(localResultPayload(), standings, extra, [
    { label: "もういちど", value: "again" },
    { label: "タイトルへ", value: "title", ghost: true },
  ]);
  await maybeShowGameEndAd();
  if (v === "again") {
    startLocalGame(settings.n, settings.level, settings.rounds);
  } else {
    showScreen("screen-title");
  }
}

// ================= オンライン対戦 (ともだち) =================
// なまえ・アイコンはプロフィール画面 (NAME_KEY / ICON_KEY) で管理する

// サーバがいるときだけ「ともだち対戦」を出す (ランク戦のオンライン可否も同じ判定)
(async () => {
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 2500);
    const r = await fetch("api/online", { signal: ctl.signal });
    if ((await r.json()).online) {
      onlineAvailable = true;
      $("btn-mode-friend").hidden = false;
    }
  } catch { /* サーバなし(Artifact等) → 非表示のまま */ }
})();

$("btn-mode-friend").onclick = () => { $("net-status").textContent = ""; updateProfileBadges(); showScreen("screen-friend"); };
$("btn-friend-back").onclick = () => { net?.close(); net = null; showScreen("screen-title"); };

$("btn-room-create").onclick = () => enterRoom({ t: "create", name: myName(), icon: myIcon() });
$("btn-room-join").onclick = () => {
  const code = $("inp-code").value.trim().toUpperCase();
  if (code.length !== 4) { $("net-status").textContent = "4文字のコードを入れてください"; return; }
  enterRoom({ t: "join", code, name: myName(), icon: myIcon() });
};

async function enterRoom(firstMsg) {
  $("net-status").textContent = "接続中…";
  try {
    net?.close();
    net = new NetClient();
    bindNetHandlers(net);
    await net.connect();
    net.send(firstMsg);
  } catch {
    $("net-status").textContent = "サーバにつながりません";
    net = null;
  }
}

let lobbyRounds = 2;
for (const btn of $("seg-lobby-rounds").querySelectorAll("button")) {
  btn.onclick = () => {
    $("seg-lobby-rounds").querySelectorAll("button").forEach(b => b.classList.remove("on"));
    btn.classList.add("on");
    lobbyRounds = +btn.dataset.r;
  };
}
$("btn-add-cpu").onclick = () => net?.send({ t: "addCpu" });
$("btn-lobby-start").onclick = () => net?.send({ t: "start", rounds: lobbyRounds });
$("btn-lobby-leave").onclick = () => { net?.close(); net = null; showScreen("screen-friend"); };

function bindNetHandlers(nc) {
  nc.on("error", (m) => { $("net-status").textContent = m.msg; });
  nc.on("lobby", (m) => {
    mode = "friend";
    renderLobby(m);
    showScreen("screen-lobby");
  });
  nc.on("state", (m) => {
    if (!$("screen-game").classList.contains("active")) {
      markPlayed();
      applyTitleMenu();
      showScreen("screen-game");
    }
    cancelPending();
    renderView(m.view);
    if (m.view.turn !== m.view.myIndex || m.view.phase !== "discard") {
      const turnName = m.view.players[m.view.turn]?.name;
      if (turnName && !m.view.over) setGuide(`${turnName}の番です…`);
    }
  });
  nc.on("prompt", async (m) => {
    // テスト用自動応答 (バックグラウンドタブはタイマーが抑制されるため同期で返す)
    if (window.__autoAnswer) {
      nc.send({ t: "act", action: autoAction(m), seq: m.seq });
      return;
    }
    startPromptTimer(m.timeoutMs);
    let act;
    if (m.kind === "turn") {
      // ツモ可否はサーバのフラグでなく「いまの並び」で決める (並び替えのたびに再評価)
      while (true) {
        act = await promptTurn({ canTsumo: !!arrangedWinNow(), kanWords: m.kanWords });
        if (act.type === "rearranged") continue;
        if (act.type === "tsumo") act = { type: "tsumo", arrangement: [...handDisplay.chars] };
        break;
      }
    } else {
      act = await promptClaim(m);
      if (act.type === "ron") act = { type: "ron", arrangement: [...handDisplay.chars] };
    }
    stopPromptTimer();
    nc.send({ t: "act", action: act, seq: m.seq });
    if (m.kind === "turn" && act.type === "discard") setGuide("");
  });
  nc.on("banner", (m) => { showBanner(m.text, true, m.who); });
  nc.on("rankSearching", (m) => {
    $("rank-status").textContent = `対戦相手をさがしています… (${m.queued}人)`;
  });
  nc.on("rankMatched", (m) => {
    $("rank-status").textContent = `マッチしました! ${m.players.join(" / ")}`;
  });
  nc.on("roundEnd", async (m) => {
    cancelPending();
    if (window.__autoAnswer) { window.__lastRoundEnd = m; nc.send({ t: "ready" }); return; }
    if (m.result.type === "draw") await showBanner("流局", false);
    await showRoundEndModal(m.result, m.isLast);
    nc.send({ t: "ready" });
    if (!m.isLast) setGuide("つぎの局を待っています…");
  });
  nc.on("gameEnd", async (m) => {
    cancelPending();
    if (window.__autoAnswer) { window.__lastGameEnd = m; return; }
    const standings = m.standings.map(s => ({ ...s, isMe: s.idx === m.youIdx }));
    const myPlace = standings.findIndex(s => s.isMe);
    const rw = grantReward(eco, myPlace);
    setEco(rw.eco);
    ach = applyGameEnd(ach, myPlace);
    let extra = `<div class="modal-sub">対局ボーナス 🪙+${rw.reward} (所持 ${eco.coins})</div>`;

    if (m.rank || mode === "rank") {
      // ランク戦: RPを増減して使い捨てルームを閉じる
      const res = applyResult(rankState, myPlace);
      rankState = res.state;
      saveRank(rankState);
      refreshUnlocks();
      const sign = res.delta >= 0 ? "+" : "";
      extra += `<div class="rank-delta ${res.delta >= 0 ? "up" : "down"}">${sign}${res.delta} RP</div>`;
      if (res.promoted) extra += `<div class="rank-delta up">ランクアップ! → ${rankState.rank}</div>`;
      if (res.demoted) extra += `<div class="rank-delta down">ランクダウン… → ${rankState.rank}</div>`;
      extra += `<div class="modal-sub">現在: ${rankState.rank}ランク ${rankState.rp}RP</div>`;
      renderRankPanel();
      const v = await showFinalModal(m.lastResult, standings, extra, [
        { label: "もういちど", value: "again" },
        { label: "タイトルへ", value: "title", ghost: true },
      ]);
      await maybeShowGameEndAd();
      net?.close();
      net = null;
      resetRankSearchUI();
      if (v === "again") {
        showScreen("screen-rank");
        $("btn-start-rank").click();
      } else {
        showScreen("screen-title");
      }
      return;
    }

    refreshUnlocks();
    await showFinalModal(m.lastResult, standings, extra, [{ label: "ロビーへ", value: true }]);
    await maybeShowGameEndAd();
    // サーバがロビー状態に戻す → lobbyメッセージで画面遷移
  });
  nc.on("closed", () => {
    cancelPending();
    resetRankSearchUI();
    if ($("screen-game").classList.contains("active") || $("screen-lobby").classList.contains("active")) {
      showModal(`<div class="modal-title">切断</div><div class="modal-sub">サーバとの接続が切れました</div>`,
        [{ label: "タイトルへ", value: true }]).then(() => showScreen("screen-title"));
    }
    net = null;
  });
}

// テスト用: プロンプトに対する適当な合法手
// (並べてあがる方式のため、テストでは ツモ/ロン はせず捨てとポンだけ行う)
function autoAction(m) {
  if (m.kind === "turn") {
    const len = currentView ? currentView.myHand.length : 14;
    return { type: "discard", idx: Math.floor(Math.random() * len) };
  }
  if (m.ponWords?.length && Math.random() < 0.5) return { type: "pon", word: m.ponWords[0] };
  return { type: "pass" };
}

// 初期化がここまで届いたことを保険スクリプトに伝える
window.__uiReady = true;
// 保存できない環境 (埋め込み表示・プライベートモード) は正直に伝える
if (!storageIsPersistent) {
  const p = document.createElement("p");
  p.className = "storage-warn";
  p.textContent = "この画面では記録が保存できません(ランク・図鑑は今回かぎり)";
  $("menu-full").appendChild(p);
}

function renderLobby(m) {
  $("lobby-code").textContent = m.code;
  if (!$("lobby-tip").innerHTML) $("lobby-tip").innerHTML = randomTip();
  const box = $("lobby-players");
  box.innerHTML = "";
  m.players.forEach((p, i) => {
    const d = document.createElement("div");
    d.className = "lobby-player";
    const tags = [];
    if (i === m.hostIdx) tags.push(`<span class="tag">ホスト</span>`);
    if (p.isCpu) tags.push(`<span class="tag cpu">CPU</span>`);
    if (i === m.youIdx) tags.push(`<span class="tag">あなた</span>`);
    d.innerHTML = `<span>${p.icon ? `<span class="player-icon">${esc(p.icon)}</span>` : ""}${esc(p.name)}</span>${tags.join("")}`;
    box.appendChild(d);
  });
  const isHost = m.youIdx === m.hostIdx;
  $("lobby-host-controls").hidden = !isHost;
  $("lobby-wait").hidden = isHost;
}
