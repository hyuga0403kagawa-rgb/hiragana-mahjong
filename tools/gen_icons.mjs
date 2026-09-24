// PWAアイコンとロゴ(ブランド素材)を生成: node tools/gen_icons.mjs
// 描画本体は tools/icon_lib.mjs を共有 (Android/iOSアイコンとデザインを揃えるため)。
// 書き出しにEdge(またはChrome)とNoto Serif JPフォントを使う (詳細は icon_lib.mjs)。
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { C, LOGO_W, LOGO_H, iconSvg, logoSvg, featureGraphicSvg, renderPng } from "./icon_lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = (p) => { console.log(`generated: ${p}`); return join(root, p); };

// ---- PWA (index.html / manifest.webmanifest が参照) ----
const PWA = [
  { name: "icon-192.png", size: 192, scale: 0.86 },
  { name: "icon-512.png", size: 512, scale: 0.86 },
  { name: "icon-maskable-192.png", size: 192, scale: 0.66 },
  { name: "icon-maskable-512.png", size: 512, scale: 0.66 },
  { name: "apple-touch-icon.png", size: 180, scale: 0.86 },
  { name: "favicon-32.png", size: 32, scale: 0.96 },
];
for (const t of PWA) renderPng(iconSvg({ scale: t.scale }), t.size, t.size, out(`icons/${t.name}`));

// ---- ブランド素材 (アプリには同梱しない。ストア掲載・SNS・資料用) ----
const lw = 1760, lh = Math.round(lw * LOGO_H / LOGO_W);
renderPng(iconSvg(), 1024, 1024, out("brand/icon-1024.png"));
renderPng(logoSvg({ withBg: true }), lw, lh, out("brand/logo.png"));
renderPng(logoSvg(), lw, lh, out("brand/logo-transparent-for-dark.png"), { transparent: true });
renderPng(logoSvg({ textColor: C.sumi }), lw, lh, out("brand/logo-transparent-for-light.png"), { transparent: true });
renderPng(featureGraphicSvg(), 1024, 500, out("brand/play-feature-graphic-1024x500.png"));
