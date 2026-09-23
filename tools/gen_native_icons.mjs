// Android/iOSのアプリアイコン・スプラッシュ画面を生成し、既定の場所に上書きする。
// node tools/gen_native_icons.mjs
// 事前に `npx cap add android` / `npx cap add ios` でネイティブプロジェクトが
// 生成済みであること (Capacitorのデフォルトファイルを上書きする)。
import { writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { drawIcon, drawSplash, encodePNG } from "./icon_lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const androidRes = join(root, "android/app/src/main/res");
const iosAssets = join(root, "ios/App/App/Assets.xcassets");

function write(path, buf) {
  writeFileSync(path, buf);
  console.log(`wrote: ${path.replace(root + "\\", "").replace(root + "/", "")}`);
}
function skipIfMissing(dir) {
  if (!existsSync(dir)) { console.log(`skip (not found): ${dir}`); return true; }
  return false;
}

// ================= Android =================
if (!skipIfMissing(androidRes)) {
  // legacy launcher icon (48/72/96/144/192)。丸アイコンも同じ絵を流用 (OS側でマスクされる)
  const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(LEGACY)) {
    const png = encodePNG(drawIcon(size, { scale: 0.86 }), size);
    write(join(androidRes, `mipmap-${density}/ic_launcher.png`), png);
    write(join(androidRes, `mipmap-${density}/ic_launcher_round.png`), png);
  }

  // adaptive icon foreground (108/162/216/324/432、透過背景・安全域は内側66%相当)
  const ADAPTIVE = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
  for (const [density, size] of Object.entries(ADAPTIVE)) {
    const png = encodePNG(drawIcon(size, { scale: 0.5, transparentBg: true }), size);
    write(join(androidRes, `mipmap-${density}/ic_launcher_foreground.png`), png);
  }

  // adaptive iconの背景色 (単色。values/ic_launcher_background.xml が参照する)
  const bgXml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#101B2C</color>\n</resources>\n`;
  writeFileSync(join(androidRes, "values/ic_launcher_background.xml"), bgXml, "utf8");
  console.log("wrote: android/.../values/ic_launcher_background.xml (#101B2C)");

  // スプラッシュ (portrait: 幅x高さ、landscape: 高さx幅)
  const PORT = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
  for (const [density, [w, h]] of Object.entries(PORT)) {
    write(join(androidRes, `drawable-port-${density}/splash.png`), encodePNG(drawSplash(w, h), w, h));
  }
  const LAND = { mdpi: [480, 320], hdpi: [800, 480], xhdpi: [1280, 720], xxhdpi: [1600, 960], xxxhdpi: [1920, 1280] };
  for (const [density, [w, h]] of Object.entries(LAND)) {
    write(join(androidRes, `drawable-land-${density}/splash.png`), encodePNG(drawSplash(w, h), w, h));
  }
  // drawable/splash.png (密度なしのフォールバック、既定は横長480x320)
  write(join(androidRes, "drawable/splash.png"), encodePNG(drawSplash(480, 320), 480, 320));

  // Play Console のストア掲載アイコン (アプリには同梱されない、出品時に手動アップロード)
  write(join(root, "android/play-store-icon-512.png"), encodePNG(drawIcon(512, { scale: 0.86 }), 512));
}

// ================= iOS =================
if (!skipIfMissing(iosAssets)) {
  // Xcode 14+ は単一の1024x1024アイコンでよい (Contents.jsonが既にこの1枚だけを参照)
  const appIcon1024 = encodePNG(drawIcon(1024, { scale: 0.86 }), 1024);
  write(join(iosAssets, "AppIcon.appiconset/AppIcon-512@2x.png"), appIcon1024);

  // スプラッシュ: Capacitorの既定Contents.jsonが3ファイルとも同じ2732x2732を指す
  const splash = encodePNG(drawSplash(2732, 2732), 2732, 2732);
  for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
    write(join(iosAssets, `Splash.imageset/${name}`), splash);
  }
}

console.log("\n完了。`npx cap sync` で android/ios プロジェクトへ反映されます。");
