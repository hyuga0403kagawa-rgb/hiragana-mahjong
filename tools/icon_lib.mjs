// アイコン・ロゴ・スプラッシュ描画の共有ライブラリ (PWA・Android・iOS・ストア掲載で共通利用)。
// 絵はSVGで組み立て、Microsoft Edge(またはChrome)のヘッドレスモードでPNGに書き出す。
// 文字には Noto Serif JP (SIL Open Font License。商用・画像への埋め込み可) を使う。
// デザインはゲームの世界観(藍の卓・象牙の牌・朱のアクセント・金の縁)を踏襲:
//   アイコン = 「ひ」の牌1枚 (2026-09-24 社長が4案からB案を選択) / ロゴ = 「ひらがな」の牌4枚 + 「麻雀」の文字
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

// ---- 色 (css/style.css の --ai-deep / --ai / --zouge / --kin / --shu と揃える) ----
export const C = {
  aiDeep: "#0d1726",
  ai: "#1d3150",
  bg: "#132139",          // Android adaptive icon の背景色 (グラデーションの中間色)
  zougeTop: "#fdf8ea",
  zougeBot: "#e8dcc0",
  kin: "#c9a24b",
  shu: "#c93a32",
  shuDeep: "#9e2a24",
  sumi: "#26221c",
};

const FONT_FILE = "C:/Windows/Fonts/NotoSerifJP-VF.ttf";
const FONT = "HMSerif";

// ---------------- パーツ ----------------

// 牌1枚 (中心(cx,cy)、幅w、回転deg度)。象牙の面 + 朱の背(厚み) + 金の細い縁 + 墨の文字。
export function tile(ch, cx, cy, w, deg, { id }) {
  const h = w * 1.3, r = w * 0.14, depth = w * 0.075;
  const x = -w / 2, y = -h / 2;
  return `
  <g transform="translate(${cx} ${cy}) rotate(${deg})" filter="url(#shadow-${id})">
    <rect x="${x}" y="${y + depth}" width="${w}" height="${h}" rx="${r}" fill="url(#back-${id})"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#face-${id})"
          stroke="${C.kin}" stroke-opacity="0.55" stroke-width="${w * 0.012}"/>
    <text x="0" y="${h * 0.03}" font-family="${FONT}" font-weight="900" font-size="${w * 0.72}"
          fill="${C.sumi}" text-anchor="middle" dominant-baseline="central">${ch}</text>
  </g>`;
}

// 牌で使うグラデーションと影の定義。unit は影の大きさの基準 (牌の幅)。
export function tileDefs(id, unit) {
  return `
    <linearGradient id="face-${id}" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${C.zougeTop}"/><stop offset="1" stop-color="${C.zougeBot}"/>
    </linearGradient>
    <linearGradient id="back-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.shu}"/><stop offset="1" stop-color="${C.shuDeep}"/>
    </linearGradient>
    <filter id="shadow-${id}" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="${unit * 0.05}" stdDeviation="${unit * 0.06}" flood-color="#000" flood-opacity="0.45"/>
    </filter>`;
}

// アイコンの主役: 「ひ」の牌1枚。小さく表示されても一目で読めることを優先した。
// 1024四方の座標系で描き、scaleで縮める。
const MARK_TILE_W = 600;
function markGroup(scale, id) {
  return `
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
    ${tile("ひ", 512, 492, MARK_TILE_W, 0, { id })}
  </g>`;
}

export function bgRect(w, h) {
  return `
    <defs><radialGradient id="bg" cx="0.5" cy="0.42" r="0.75">
      <stop offset="0" stop-color="${C.ai}"/><stop offset="1" stop-color="${C.aiDeep}"/>
    </radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#bg)"/>`;
}

// ---------------- 完成品のSVG ----------------

// アプリアイコン。scale=牌の大きさ (0.86=通常、0.68=マスク用の安全域内)。transparentBg=背景なし。
export function iconSvg({ scale = 0.86, transparentBg = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">
    <defs>${tileDefs("i", MARK_TILE_W * scale)}</defs>
    ${transparentBg ? "" : bgRect(1024, 1024)}
    ${markGroup(scale, "i")}
  </svg>`;
}

// 横長ロゴ: 「ひ」「ら」「が」「な」の牌4枚 + 「麻雀」。
// textColor: 「麻雀」の色 (暗い背景なら象牙、明るい背景なら墨)。withBg: 藍の背景つき。
export const LOGO_W = 1760, LOGO_H = 520;
export function logoSvg({ textColor = C.zougeTop, withBg = false } = {}) {
  const W = LOGO_W, H = LOGO_H, tw = 230;
  const tiles = ["ひ", "ら", "が", "な"].map((ch, i) =>
    tile(ch, 170 + i * 255, 250 + (i % 2 ? 14 : -14), tw, i % 2 ? 4 : -4, { id: "l" })).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%">
    <defs>${tileDefs("l", tw)}</defs>
    ${withBg ? bgRect(W, H) : ""}
    ${tiles}
    <text x="1420" y="255" font-family="${FONT}" font-weight="900" font-size="240" letter-spacing="12"
          fill="${textColor}" text-anchor="middle" dominant-baseline="central">麻雀</text>
    <rect x="1200" y="412" width="440" height="12" rx="6" fill="${C.shu}"/>
  </svg>`;
}

// スプラッシュ: 藍の背景の中央に横長ロゴ。どの縦横比で切り抜かれても収まるよう短辺基準の大きさにする。
// 背景は単色 (グラデーションだとPNGが1枚80万バイト近くになり、アプリが倍の大きさになるため)。
export function splashSvg(w, h) {
  const logoW = Math.min(w * 0.78, h * 0.9), logoH = logoW * LOGO_H / LOGO_W;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%">
    <rect width="${w}" height="${h}" fill="${C.bg}"/>
    <svg x="${w / 2 - logoW / 2}" y="${h / 2 - logoH / 2}" width="${logoW}" height="${logoH}" viewBox="0 0 ${LOGO_W} ${LOGO_H}">
      ${logoSvg().replace(/^<svg[^>]*>|<\/svg>\s*$/g, "")}
    </svg>
  </svg>`;
}

// Google Play のフィーチャーグラフィック (1024x500、ストア掲載ページ上部の横長画像)
export function featureGraphicSvg() {
  const W = 1024, H = 500;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%">
    ${bgRect(W, H)}
    <svg x="92" y="110" width="840" height="${840 * LOGO_H / LOGO_W}" viewBox="0 0 ${LOGO_W} ${LOGO_H}">
      ${logoSvg().replace(/^<svg[^>]*>|<\/svg>\s*$/g, "")}
    </svg>
    <text x="512" y="405" font-family="${FONT}" font-weight="600" font-size="34" letter-spacing="6"
          fill="${C.kin}" text-anchor="middle" dominant-baseline="central">ひらがなの牌で ことばを そろえて あがろう</text>
  </svg>`;
}

// ---------------- 書き出し ----------------

function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Edge/Chromeが見つからない。環境変数 BROWSER_PATH にパスを指定してください");
  return found;
}

let work = null;
function workDir() {
  if (!work) {
    if (!existsSync(FONT_FILE)) throw new Error(`フォントが見つからない: ${FONT_FILE} (Noto Serif JP をインストールしてください)`);
    work = mkdtempSync(join(tmpdir(), "hm-icons-"));
    process.on("exit", () => { try { rmSync(work, { recursive: true, force: true }); } catch {} });
  }
  return work;
}

// SVG文字列を w x h のPNGとして outPath に書き出す。transparent=true なら背景透過。
let seq = 0;
export function renderPng(svg, w, h, outPath, { transparent = false } = {}) {
  const dir = workDir();
  const html = join(dir, "page.html");
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: ${FONT}; src: url("file:///${FONT_FILE}"); font-weight: 200 900; }
    html, body { margin: 0; padding: 0; overflow: hidden; background: transparent; }
    body > svg { display: block; width: ${w}px; height: ${h}px; }
  </style></head><body>${svg}</body></html>`, "utf8");
  for (let attempt = 0; attempt < 2; attempt++) {
    // 書き出しごとに別の設定フォルダを使う (前回のEdgeが残っていると、同じフォルダだと処理がそちらへ回されて何も出ないため)
    const n = seq++;
    const shot = join(dir, `shot-${n}.png`);
    execFileSync(findBrowser(), [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
      `--user-data-dir=${join(dir, `profile-${n}`)}`,
      `--default-background-color=${transparent ? "00000000" : "ffffffff"}`,
      `--window-size=${w},${h}`, "--virtual-time-budget=3000",
      `--screenshot=${shot}`, `file:///${html.replace(/\\/g, "/")}`,
    ], { stdio: "ignore" });
    // Windowsの msedge.exe は起動役のプロセスがすぐ戻り、描画は子プロセスで続くことがあるため、
    // 画像ファイルができてサイズが落ち着くまで待つ (最大30秒)
    const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    let last = -1;
    for (let i = 0; i < 300; i++) {
      const size = existsSync(shot) ? statSync(shot).size : -1;
      if (size > 0 && size === last) break;
      last = size;
      sleep(100);
    }
    if (existsSync(shot)) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, readFileSync(shot));
      return;
    }
  }
  throw new Error(`書き出し失敗: ${outPath}`);
}
