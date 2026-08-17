// あがり結果のシェア画像づくり (Canvasで描画 → PNG)
// 外部ライブラリ・画像アセットは使わず、すべてその場で描く。
const W = 800, H = 800;
const RARE = new Set([..."がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽゃゅょっー"]);

// item = {w: "さくら", kind: "two"|"three"|"kan"}
function drawTanzaku(ctx, item, x, y, w, h) {
  // 短冊の紙
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  if (item.kind === "two") { grad.addColorStop(0, "#f3e6e4"); grad.addColorStop(1, "#ecd8d4"); }
  else if (item.kind === "kan") { grad.addColorStop(0, "#f5ecd4"); grad.addColorStop(1, "#ead9ac"); }
  else { grad.addColorStop(0, "#fdf8ea"); grad.addColorStop(1, "#f2ebda"); }
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.restore();

  // 上部の朱点
  ctx.fillStyle = "#c93a32";
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 16, 5, 0, Math.PI * 2);
  ctx.fill();

  // 縦書きの文字
  const chars = [...item.w];
  const fontSize = Math.min(40, (h - 50) / chars.length);
  ctx.font = `600 ${fontSize}px "Hiragino Mincho ProN", "Yu Mincho", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const startY = y + 40 + fontSize / 2;
  chars.forEach((c, i) => {
    ctx.fillStyle = RARE.has(c) ? "#a3302a" : "#26221c";
    ctx.fillText(c, x + w / 2, startY + i * (fontSize + 6));
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// data = {decomp:{two, threes}, melds:[{word,type}], score:{total,rare,kans}, type, playerName}
export function renderWinImage(data) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // 背景 (夜の卓)
  const bg = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, W * 0.78);
  bg.addColorStop(0, "#1d2f49");
  bg.addColorStop(1, "#0d1626");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 金の枠
  ctx.strokeStyle = "rgba(201,162,75,0.55)";
  ctx.lineWidth = 3;
  roundRect(ctx, 22, 22, W - 44, H - 44, 18);
  ctx.stroke();

  // 見出し
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#f6efdf";
  ctx.font = `600 46px "Hiragino Mincho ProN", "Yu Mincho", serif`;
  ctx.fillText(data.type === "tsumo" ? "ツモ!" : "ロン!", W / 2, 108);
  ctx.fillStyle = "#93a0b4";
  ctx.font = `24px "Hiragino Kaku Gothic ProN", sans-serif`;
  ctx.fillText(`${data.playerName || "あなた"} の あがり`, W / 2, 148);

  // 短冊 (鳴き → 3文字 → 2文字 の順)
  const items = [];
  for (const m of data.melds || []) items.push({ w: m.word, kind: m.type === "kan" ? "kan" : "three" });
  for (const w of data.decomp.threes) items.push({ w, kind: "three" });
  if (data.decomp.two) items.push({ w: data.decomp.two, kind: "two" });

  const maxLen = Math.max(...items.map(i => [...i.w].length), 3);
  const cardW = 92, gap = 16;
  const cardH = 70 + maxLen * 44;
  const totalW = items.length * cardW + (items.length - 1) * gap;
  const startX = (W - totalW) / 2;
  const topY = 200;
  items.forEach((item, i) => drawTanzaku(ctx, item, startX + i * (cardW + gap), topY, cardW, cardH));

  // 得点
  const scoreY = topY + cardH + 82;
  ctx.fillStyle = "#c9a24b";
  ctx.font = `700 60px "Hiragino Mincho ProN", "Yu Mincho", serif`;
  ctx.fillText(`${data.score.total}点`, W / 2, scoreY);
  ctx.fillStyle = "#93a0b4";
  ctx.font = `22px "Hiragino Kaku Gothic ProN", sans-serif`;
  const parts = ["基本 8点"];
  if (data.score.rare) parts.push(`レア牌 ${data.score.rare}×2点`);
  if (data.score.kans) parts.push(`カン ${data.score.kans}×2点`);
  ctx.fillText(parts.join("  +  "), W / 2, scoreY + 38);

  // フッター
  ctx.fillStyle = "rgba(246,239,223,0.75)";
  ctx.font = `600 26px "Hiragino Mincho ProN", "Yu Mincho", serif`;
  ctx.fillText("ひらがな麻雀", W / 2, H - 54);
  ctx.fillStyle = "#5a6880";
  ctx.font = `18px "Hiragino Kaku Gothic ProN", sans-serif`;
  ctx.fillText("ことばを そろえて あがろう", W / 2, H - 28);

  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

// 端末の共有機能が使えるなら使う。使えなければ false を返す (呼び出し側で画像を表示)。
export async function shareImage(canvas, text) {
  try {
    const blob = await canvasToBlob(canvas);
    if (!blob) return false;
    const file = new File([blob], "hiragana-mahjong.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return true;
    }
  } catch { /* キャンセルや非対応はフォールバックへ */ }
  return false;
}
