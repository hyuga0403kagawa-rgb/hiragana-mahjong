// Android/iOSのアプリアイコン・スプラッシュ画面を生成し、既定の場所に上書きする。
// node tools/gen_native_icons.mjs
// 事前に `npx cap add android` / `npx cap add ios` でネイティブプロジェクトが
// 生成済みであること (Capacitorのデフォルトファイルを上書きする)。
// 書き出しにEdge(またはChrome)とNoto Serif JPフォントを使う (詳細は icon_lib.mjs)。
import { writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { C, iconSvg, splashSvg, renderPng } from "./icon_lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const androidRes = join(root, "android/app/src/main/res");
const iosAssets = join(root, "ios/App/App/Assets.xcassets");

const log = (p) => console.log(`wrote: ${relative(root, p).replace(/\\/g, "/")}`);
function render(svg, w, h, path, opts) { renderPng(svg, w, h, path, opts); log(path); }
function skipIfMissing(dir) {
  if (!existsSync(dir)) { console.log(`skip (not found): ${dir}`); return true; }
  return false;
}

// ================= Android =================
if (!skipIfMissing(androidRes)) {
  // legacy launcher icon (48/72/96/144/192)。丸アイコンも同じ絵を流用 (OS側でマスクされる)
  const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(LEGACY)) {
    const p = join(androidRes, `mipmap-${density}/ic_launcher.png`);
    render(iconSvg(), size, size, p);
    copyFileSync(p, join(androidRes, `mipmap-${density}/ic_launcher_round.png`));
  }

  // adaptive icon foreground (108/162/216/324/432、透過背景。見える範囲は中央の約66%なので牌を小さめに置く)
  const ADAPTIVE = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
  for (const [density, size] of Object.entries(ADAPTIVE)) {
    render(iconSvg({ scale: 0.66, transparentBg: true }), size, size,
      join(androidRes, `mipmap-${density}/ic_launcher_foreground.png`), { transparent: true });
  }

  // adaptive iconの背景色 (単色。values/ic_launcher_background.xml が参照する)
  const bgXml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${C.bg.toUpperCase()}</color>\n</resources>\n`;
  writeFileSync(join(androidRes, "values/ic_launcher_background.xml"), bgXml, "utf8");
  console.log(`wrote: android/.../values/ic_launcher_background.xml (${C.bg})`);

  // スプラッシュ (portrait: 幅x高さ、landscape: 高さx幅)
  const PORT = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
  for (const [density, [w, h]] of Object.entries(PORT)) {
    render(splashSvg(w, h), w, h, join(androidRes, `drawable-port-${density}/splash.png`));
  }
  const LAND = { mdpi: [480, 320], hdpi: [800, 480], xhdpi: [1280, 720], xxhdpi: [1600, 960], xxxhdpi: [1920, 1280] };
  for (const [density, [w, h]] of Object.entries(LAND)) {
    render(splashSvg(w, h), w, h, join(androidRes, `drawable-land-${density}/splash.png`));
  }
  // drawable/splash.png (密度なしのフォールバック、既定は横長480x320)
  render(splashSvg(480, 320), 480, 320, join(androidRes, "drawable/splash.png"));

  // Play Console のストア掲載アイコン (アプリには同梱されない、出品時に手動アップロード)
  render(iconSvg(), 512, 512, join(root, "android/play-store-icon-512.png"));
}

// ================= iOS =================
if (!skipIfMissing(iosAssets)) {
  // Xcode 14+ は単一の1024x1024アイコンでよい (Contents.jsonが既にこの1枚だけを参照)。
  // Appleは透過・角丸を認めないので、背景つき・四角のまま書き出す (角丸はOSが付ける)
  render(iconSvg(), 1024, 1024, join(iosAssets, "AppIcon.appiconset/AppIcon-512@2x.png"));

  // スプラッシュ: Capacitorの既定Contents.jsonが3ファイルとも同じ2732x2732を指す
  const first = join(iosAssets, "Splash.imageset/splash-2732x2732.png");
  render(splashSvg(2732, 2732), 2732, 2732, first);
  for (const name of ["splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
    const p = join(iosAssets, `Splash.imageset/${name}`);
    copyFileSync(first, p);
    log(p);
  }
}

console.log("\n完了。`npx cap sync` で android/ios プロジェクトへ反映されます。");
