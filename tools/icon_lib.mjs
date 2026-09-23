// アイコン/スプラッシュ描画の共有ライブラリ。外部の画像ライブラリを使わず、
// Node標準のzlibだけでPNGを直接エンコードする(PWA・Android・iOSで共通利用)。
// デザインはゲームの世界観(藍の卓・象牙の牌・朱のアクセント・金の縁)を踏襲した「牌」のモチーフ。
import { deflateSync } from "node:zlib";

// ---- 色 (css/style.css の --ai-deep / --ai / --zouge / --kin / --shu と揃える) ----
export const AI_DEEP = [16, 27, 44];
export const AI = [23, 38, 59];
export const ZOUGE_TOP = [253, 248, 234];
export const ZOUGE_BOT = [236, 225, 200];
export const KIN = [201, 162, 75];
export const SHU = [201, 58, 50];
export const SUMI = [38, 34, 28];

export function lerp(a, b, t) { return a + (b - a) * t; }
export function mixColor(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

// 太さwの線分 (x0,y0)-(x1,y1) を塗る (端点は丸める)
export function drawStroke(set, x0, y0, x1, y1, w, color) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(len * 1.5);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = lerp(x0, x1, t), cy = lerp(y0, y1, t);
    for (let dy = -w / 2; dy <= w / 2; dy++) {
      for (let dx = -w / 2; dx <= w / 2; dx++) {
        if (dx * dx + dy * dy <= (w / 2) * (w / 2)) set(Math.round(cx + dx), Math.round(cy + dy), color);
      }
    }
  }
}

export function roundRectMask(x, y, w, h, r) {
  // 角丸矩形の内外判定: 内側に縮めた矩形へクランプした点との距離で四隅の円弧を判定する。
  const x0 = x, y0 = y, x1 = x + w, y1 = y + h;
  return (px, py) => {
    if (px < x0 || px > x1 || py < y0 || py > y1) return false;
    const cx = Math.min(Math.max(px, x0 + r), x1 - r);
    const cy = Math.min(Math.max(py, y0 + r), y1 - r);
    return Math.hypot(px - cx, py - cy) <= r;
  };
}

// size: 出力ピクセル数(正方形)。
// scale: 牌の大きさ (0〜1、キャンバス幅に対する割合)。Android adaptive iconは安全域が狭いので小さくする。
// transparentBg: trueなら背景を透過にする (Android adaptive iconのforeground層用)。影も描かない。
export function drawIcon(size, { scale = 0.86, transparentBg = false } = {}) {
  const buf = new Uint8ClampedArray(size * size * 4);
  const set = (x, y, rgb, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = a;
  };

  if (!transparentBg) {
    // 背景: 中心やや上に藍のグラデーション (タイトル画面の雰囲気)
    const cx = size / 2, cy = size * 0.42;
    const maxDist = size * 0.75;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - cx, y - cy) / maxDist;
        set(x, y, mixColor(AI, AI_DEEP, Math.min(1, d)));
      }
    }
  }

  const tw = size * scale;
  const th = tw * 1.32; // 牌の縦横比 (だいたい 34x48 相当)
  const tx = (size - tw) / 2;
  const ty = (size - th) / 2 + size * 0.02;
  const r = tw * 0.14;
  const inTile = roundRectMask(tx, ty, tw, th, r);

  if (!transparentBg) {
    // 牌のドロップシャドウ (下に少しオフセット、背景に対する簡易乗算)
    const shadowOff = size * 0.012;
    const inShadow = roundRectMask(tx, ty + shadowOff * 2.2, tw, th, r);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (inShadow(x, y) && !inTile(x, y)) {
          const i = (y * size + x) * 4;
          buf[i] *= 0.7; buf[i + 1] *= 0.7; buf[i + 2] *= 0.7;
        }
      }
    }
  }

  // 牌本体 (象牙のグラデーション、左上が明るく右下が暗い)
  for (let y = ty; y < ty + th; y++) {
    for (let x = tx; x < tx + tw; x++) {
      if (!inTile(x, y)) continue;
      const t = ((x - tx) / tw + (y - ty) / th) / 2;
      set(Math.round(x), Math.round(y), mixColor(ZOUGE_TOP, ZOUGE_BOT, t));
    }
  }

  // 金の縁 (牌の外枠に細いライン)
  const borderW = Math.max(1, size * 0.006);
  const inTileInner = roundRectMask(tx + borderW, ty + borderW, tw - borderW * 2, th - borderW * 2, Math.max(0, r - borderW));
  for (let y = ty; y < ty + th; y++) {
    for (let x = tx; x < tx + tw; x++) {
      if (inTile(x, y) && !inTileInner(x, y)) set(Math.round(x), Math.round(y), KIN);
    }
  }

  // 朱の点 (タイトルロゴ・レア牌と同じモチーフ) を牌の上部中央に配置
  const dotR = tw * 0.1;
  const dotCx = tx + tw / 2, dotCy = ty + th * 0.26;
  for (let y = dotCy - dotR; y <= dotCy + dotR; y++) {
    for (let x = dotCx - dotR; x <= dotCx + dotR; x++) {
      if (Math.hypot(x - dotCx, y - dotCy) <= dotR) set(Math.round(x), Math.round(y), SHU);
    }
  }

  // 「人」を思わせる二画の筆致 (墨色、牌の下半分) — 特定の字ではなく抽象的な文字らしさを持たせる
  const strokeW = tw * 0.1;
  const midX = tx + tw / 2, topY = ty + th * 0.52, botY = ty + th * 0.82;
  drawStroke(set, midX, topY, tx + tw * 0.28, botY, strokeW, SUMI);
  drawStroke(set, midX, topY, tx + tw * 0.72, botY, strokeW, SUMI);

  return buf;
}

// スプラッシュ画面: 藍の背景の中央に牌のアイコンを浮かべる。w×h任意サイズ対応。
export function drawSplash(w, h) {
  const buf = new Uint8ClampedArray(w * h * 4);
  const set = (x, y, rgb, a = 255) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = a;
  };
  const cx = w / 2, cy = h * 0.42;
  const maxDist = Math.max(w, h) * 0.75;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxDist;
      set(x, y, mixColor(AI, AI_DEEP, Math.min(1, d)));
    }
  }
  // 中央に小さめの牌アイコンを合成 (画面の短辺の32%程度)
  const iconSize = Math.round(Math.min(w, h) * 0.34);
  const icon = drawIcon(iconSize, { scale: 0.86 });
  const ox = Math.round((w - iconSize) / 2), oy = Math.round((h - iconSize) / 2);
  for (let y = 0; y < iconSize; y++) {
    for (let x = 0; x < iconSize; x++) {
      const i = (y * iconSize + x) * 4;
      const a = icon[i + 3] / 255;
      if (a <= 0) continue;
      const dx = ox + x, dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
      const di = (dy * w + dx) * 4;
      buf[di] = lerp(buf[di], icon[i], a);
      buf[di + 1] = lerp(buf[di + 1], icon[i + 1], a);
      buf[di + 2] = lerp(buf[di + 2], icon[i + 2], a);
    }
  }
  return buf;
}

// ---- PNGエンコード (zlibのみ、外部依存なし) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
export function encodePNG(rgba, w, h = w) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // フィルタなし
    for (let x = 0; x < w * 4; x++) {
      raw[y * (1 + w * 4) + 1 + x] = rgba[y * w * 4 + x];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
