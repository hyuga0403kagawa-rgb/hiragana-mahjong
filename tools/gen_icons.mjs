// PWAアイコン生成: node tools/gen_icons.mjs
// 描画本体は tools/icon_lib.mjs を共有 (Android/iOSアイコンとデザインを揃えるため)。
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { drawIcon, encodePNG } from "./icon_lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "icons");
mkdirSync(outDir, { recursive: true });

const TARGETS = [
  { name: "icon-192.png", size: 192, scale: 0.86 },
  { name: "icon-512.png", size: 512, scale: 0.86 },
  { name: "icon-maskable-192.png", size: 192, scale: 0.62 },
  { name: "icon-maskable-512.png", size: 512, scale: 0.62 },
  { name: "apple-touch-icon.png", size: 180, scale: 0.86 },
  { name: "favicon-32.png", size: 32, scale: 0.86 },
];

for (const t of TARGETS) {
  const buf = drawIcon(t.size, { scale: t.scale });
  writeFileSync(join(outDir, t.name), encodePNG(buf, t.size));
  console.log(`generated: icons/${t.name} (${t.size}x${t.size})`);
}
