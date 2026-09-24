// ストア掲載用スクリーンショット(宣伝画像)を生成: node tools/gen_store_screenshots.mjs
// 1) ゲームサーバー(npm start, 既定 http://localhost:8737)上の実際のゲームを、ストア版と同じ条件
//    (Capacitorのネイティブ判定を模擬=デモ広告・デモ課金なし) でスマホ画面サイズにして撮影する。
// 2) 撮影した画面をスマホの枠に入れ、上にキャッチコピーを載せた 1080x1920 の画像に仕上げる。
// 出力: brand/store-screenshots/01〜04.png (Google Play用。9:16)
// 画面の中身はすべて実際のゲームを操作した結果 (作り物のUIは使わない = 打ち出しと実装を一致させる)。
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
import { C, bgRect, renderPng } from "./icon_lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "brand/store-screenshots");
const rawDir = join(outDir, "raw");
mkdirSync(rawDir, { recursive: true });
const BASE = process.env.GAME_URL || "http://localhost:8737/";

// スマホの画面 (CSS px) と倍率。撮影結果は 1170x2532
const VW = 390, VH = 844, DPR = 3;

// ---------------- 撮影 ----------------
// 手牌の位置 (撮影画像のピクセル座標)。仕上げで手牌を拡大して重ねるのに使う
const crops = {};
async function capture() {
const b = await launch();
const { send, evaluate, sleep } = b;
await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: DPR, mobile: true });
// 背景タブ扱いだとタイマーが間引かれて演出が残るため、フォーカスがある状態として扱わせる
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Page.bringToFront");
// ストア版の条件 + 初回説明を出さない + 表示名を固定
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
  try {
    localStorage.setItem("hiragana_mahjong_seen_intro", "1");
    localStorage.setItem("hiragana_mahjong_played", "1");
    localStorage.setItem("hiragana_mahjong_muted", "1");
    localStorage.setItem("hiragana_mahjong_name", "あなた");
  } catch {}
`});

async function shot(name, { cropHand = false } = {}) {
  await sleep(700);
  if (cropHand) {
    // 牌そのものの範囲 (全牌の外接矩形)。上は「ツモ」表示、下はことばブロックの下線まで含める
    const r = await evaluate(`(() => {
      const rs = [...document.getElementById("my-hand").children].map(e => e.getBoundingClientRect());
      const x0 = Math.min(...rs.map(r => r.left)), x1 = Math.max(...rs.map(r => r.right));
      const y0 = Math.min(...rs.map(r => r.top)), y1 = Math.max(...rs.map(r => r.bottom));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    })()`);
    const padX = 8, padTop = 16, padBottom = 8;
    crops[name] = { x: (r.x - padX) * DPR, y: (r.y - padTop) * DPR, w: (r.w + padX * 2) * DPR, h: (r.h + padTop + padBottom) * DPR };
  }
  const r = await send("Page.captureScreenshot", { format: "png" });
  const p = join(rawDir, name);
  writeFileSync(p, Buffer.from(r.data, "base64"));
  console.log(`captured: ${name}`);
  return p;
}
async function go() {
  await send("Page.navigate", { url: BASE });
  await sleep(2500);
}

// ページ内ヘルパー: 練習問題を解く (手牌をコア語彙で分解) / 牌をドラッグで並べ替える
const HELPERS = `
window.__hm = {
  hand() { return [...document.getElementById("my-hand").children].map(e => e.textContent.trim()); },
  async solve() {
    const { CORE2, CORE3 } = await import("/src/data/words.js");
    const need = new Map();
    for (const c of this.hand()) need.set(c, (need.get(c) || 0) + 1);
    const take = (w) => { for (const c of w) need.set(c, need.get(c) - 1); };
    const give = (w) => { for (const c of w) need.set(c, need.get(c) + 1); };
    const fits = (w) => { const m = new Map(); for (const c of w) { m.set(c, (m.get(c) || 0) + 1); if (m.get(c) > (need.get(c) || 0)) return false; } return true; };
    const threes = CORE3.filter(w => w.length === 3);
    for (const two of CORE2) {
      if (two.length !== 2 || !fits(two)) continue;
      take(two);
      const res = [];
      const dfs = (start) => {
        if (res.length === 4) return true;
        for (let i = start; i < threes.length; i++) {
          if (!fits(threes[i])) continue;
          take(threes[i]); res.push(threes[i]);
          if (dfs(i)) return true;
          res.pop(); give(threes[i]);
        }
        return false;
      };
      if (dfs(0)) return [two, ...res];
      give(two);
    }
    return null;
  },
  // 表示位置 from の牌を 位置 to の前へドラッグ (実際の pointer イベントを発生させる)
  drag(from, to) {
    const tiles = [...document.getElementById("my-hand").children];
    const el = tiles[from], r = el.getBoundingClientRect();
    const t = tiles[to].getBoundingClientRect();
    const y = r.top + r.height / 2, x0 = r.left + r.width / 2, x1 = t.left + 2;
    const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, pointerType: "touch" }));
    ev("pointerdown", x0); ev("pointermove", x0 - 30); ev("pointermove", x1); ev("pointerup", x1);
  },
  // 目標の並び (文字列) の先頭 n 文字ぶんを、左から順に並べる
  arrange(target, n) {
    for (let k = 0; k < n; k++) {
      const h = this.hand();
      if (h[k] === target[k]) continue;
      const j = h.findIndex((c, i) => i > k && c === target[k]);
      if (j < 0) return "missing " + target[k];
      this.drag(j, k);
    }
    return this.hand().join("");
  },
  click(id) { document.getElementById(id).click(); },
  guide() { return document.getElementById("guide-text").textContent; },
  clickAction(label) { const b = [...document.querySelectorAll("#action-bar button")].find(x => x.textContent.includes(label)); if (b) b.click(); return !!b; },
  // 手番なら右端の牌(ツモ牌)を2回タップで捨てる
  discardLast() { const t = [...document.getElementById("my-hand").children]; const el = t[t.length - 1]; el.click(); el.click(); },
  bannerGone() { return document.getElementById("banner").classList.contains("hidden"); },
  modalOpen() { return !document.getElementById("modal").classList.contains("hidden"); },
  clickModal(label) { const b = [...document.querySelectorAll("#modal button")].find(x => x.textContent.includes(label)); if (b) b.click(); return !!b; },
};`;

await go();
await evaluate(HELPERS);

// --- 図鑑を少し埋めるため、練習問題を実際に何問か解く (解いた語が図鑑に記録される) ---
await evaluate(`__hm.click("btn-mode-practice")`);
await sleep(800);
for (let i = 0; i < 5; i++) {
  const words = await evaluate(`__hm.solve()`);
  if (!words) throw new Error("練習問題を解けなかった");
  await evaluate(`__hm.arrange(${JSON.stringify(words.join(""))}, 14)`);
  await sleep(1800);
  await evaluate(`__hm.clickModal("つぎの問題")`);
  await sleep(900);
}

async function waitBanner() {
  for (let i = 0; i < 50 && !(await evaluate(`__hm.bannerGone()`)); i++) await sleep(100);
}

// --- 01: 並べている途中 (5つのうち3つが完成して金色) ---
{
  await waitBanner();
  const words = await evaluate(`__hm.solve()`);
  const target = words.join("");
  await evaluate(`__hm.arrange(${JSON.stringify(target)}, 8)`);
  await shot("01-arrange.png", { cropHand: true });
  // --- 02: 全部そろって「できた!」 ---
  await evaluate(`__hm.arrange(${JSON.stringify(target)}, 14)`);
  await sleep(1800);
  await shot("02-complete.png");
}

// --- 03: CPUとのフリー対戦 (自分が数回捨てて、卓に捨て牌が並んだところ) ---
await go();
await evaluate(HELPERS);
await evaluate(`__hm.click("btn-mode-free")`);
await sleep(800);
await evaluate(`__hm.click("btn-start-free")`);
await sleep(2500);
let discards = 0;
for (let i = 0; i < 400 && discards < 5; i++) {
  if (await evaluate(`__hm.modalOpen()`)) break;          // 誰かがあがった等
  const g = await evaluate(`__hm.guide()`);
  if (g.includes("パス")) await evaluate(`__hm.clickAction("パス")`);
  else if (g.includes("いらない牌")) {
    await evaluate(`__hm.discardLast()`);
    discards++;
    await sleep(400);
  }
  await sleep(250);
}
// 次の自分の手番 (「あなたの番!」の案内) まで待って撮る。途中のポン確認はパスする
for (let i = 0; i < 200; i++) {
  const g = await evaluate(`__hm.guide()`);
  if (g.startsWith("あなたの番")) break;
  if (g.includes("パス")) await evaluate(`__hm.clickAction("パス")`);
  await sleep(250);
}
await shot("03-vs-cpu.png", { cropHand: true });

// --- 04: ランク戦 (オンライン対戦の入口) ---
await go();
await evaluate(HELPERS);
await evaluate(`__hm.click("btn-mode-rank")`);
await shot("04-rank.png");

await b.close();
writeFileSync(join(rawDir, "crops.json"), JSON.stringify(crops, null, 2));
console.log("撮影完了");
}

// ---------------- 仕上げ (1080x1920) ----------------
// コピーは実装と一致させる (段階数・ランク数は index.html / src/rank.js で確認済み)
const SLIDES = [
  { raw: "01-arrange.png", title: "ひらがなの牌を ならべる", sub: "2文字×1 + 3文字×4 の ことばを そろえる麻雀", zoom: true },
  { raw: "02-complete.png", title: "5つ そろえば あがり!", sub: "ひとり練習で ならべ方を じっくり覚えられる" },
  { raw: "03-vs-cpu.png", title: "CPUと 気軽に対戦", sub: "つよさは3段階。ポン・カンで ことばを作る", zoom: true },
  { raw: "04-rank.png", title: "オンラインで ランク戦", sub: "G から S まで 8つのランクを 目指そう" },
];
const W = 1080, H = 1920;
const SHOT_W = 1170, SHOT_H = 2532;

function slideSvg(sl, dataUri, crop) {
  const pw = 640, ph = Math.round(pw * SHOT_H / SHOT_W), px = (W - pw) / 2, py = 455, pr = 56, bezel = 14;
  let zoom = "";
  if (sl.zoom && crop) {
    const zw = 1000, zh = Math.round(zw * crop.h / crop.w), zx = (W - zw) / 2, zy = Math.round(py + ph * 0.5 - zh / 2);
    zoom = `
      <g filter="url(#sh)">
        <rect x="${zx - 10}" y="${zy - 10}" width="${zw + 20}" height="${zh + 20}" rx="22" fill="${C.aiDeep}" stroke="${C.kin}" stroke-width="3"/>
        <svg x="${zx}" y="${zy}" width="${zw}" height="${zh}" viewBox="${crop.x} ${crop.y} ${crop.w} ${crop.h}" preserveAspectRatio="xMidYMid slice">
          <image href="${dataUri}" width="${SHOT_W}" height="${SHOT_H}"/>
        </svg>
      </g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%">
    <defs>
      <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="22" flood-color="#000" flood-opacity="0.55"/></filter>
      <clipPath id="screen"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${pr - bezel}"/></clipPath>
    </defs>
    ${bgRect(W, H)}
    <text x="${W / 2}" y="190" font-family="HMSerif" font-weight="900" font-size="84" letter-spacing="4"
          fill="${C.zougeTop}" text-anchor="middle" dominant-baseline="central">${sl.title}</text>
    <rect x="${W / 2 - 60}" y="262" width="120" height="8" rx="4" fill="${C.shu}"/>
    <text x="${W / 2}" y="340" font-family="HMSerif" font-weight="600" font-size="40" letter-spacing="2"
          fill="${C.kin}" text-anchor="middle" dominant-baseline="central">${sl.sub}</text>
    <g filter="url(#sh)">
      <rect x="${px - bezel}" y="${py - bezel}" width="${pw + bezel * 2}" height="${ph + bezel * 2}" rx="${pr}" fill="#05080e" stroke="${C.kin}" stroke-opacity="0.5" stroke-width="2"/>
    </g>
    <g clip-path="url(#screen)"><image href="${dataUri}" x="${px}" y="${py}" width="${pw}" height="${ph}"/></g>
    ${zoom}
  </svg>`;
}

function compose() {
  const c = existsSync(join(rawDir, "crops.json")) ? JSON.parse(readFileSync(join(rawDir, "crops.json"), "utf8")) : {};
  SLIDES.forEach((sl, i) => {
    const uri = "data:image/png;base64," + readFileSync(join(rawDir, sl.raw)).toString("base64");
    const out = join(outDir, `0${i + 1}.png`);
    renderPng(slideSvg(sl, uri, c[sl.raw]), W, H, out);
    console.log(`generated: brand/store-screenshots/0${i + 1}.png`);
  });
}

if (!process.argv.includes("--compose-only")) await capture();
compose();
