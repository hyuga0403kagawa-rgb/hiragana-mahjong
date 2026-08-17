// 単一HTMLビルド: node tools/build_single.mjs
// ES Modules を IIFE に変換して index.html に埋め込み、dist/hiragana-mahjong.html を出力する。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const MODULES = [
  { id: "storage", path: "src/storage.js" },
  { id: "engine", path: "src/engine.js" },
  { id: "ai", path: "src/ai.js" },
  { id: "words", path: "src/data/words.js" },
  { id: "rank", path: "src/rank.js" },
  { id: "economy", path: "src/economy.js" },
  { id: "sound", path: "src/sound.js" },
  { id: "collection", path: "src/collection.js" },
  { id: "achievements", path: "src/achievements.js" },
  { id: "share", path: "src/share.js" },
  { id: "net", path: "src/net.js" },
  { id: "ui", path: "src/ui.js" },
];
const PATH_TO_ID = {
  "./storage.js": "storage",
  "./engine.js": "engine",
  "../engine.js": "engine",
  "./ai.js": "ai",
  "./data/words.js": "words",
  "./rank.js": "rank",
  "./economy.js": "economy",
  "./sound.js": "sound",
  "./collection.js": "collection",
  "./achievements.js": "achievements",
  "./share.js": "share",
  "./net.js": "net",
};

function transform(code, id) {
  const exports = [];
  // import文 → 依存モジュールからの分割代入
  // `import { a as b }` は分割代入では `{ a: b }` になる。この変換を忘れると
  // 生成物が構文エラーになり、アプリ全体が起動しなくなる。
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?/g, (m, names, path) => {
    const dep = PATH_TO_ID[path];
    if (!dep) throw new Error(`unknown import path: ${path}`);
    const bindings = names.split(",").map(part => {
      const t = part.trim();
      if (!t) return null;
      const rename = t.match(/^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/);
      return rename ? `${rename[1]}: ${rename[2]}` : t;
    }).filter(Boolean);
    return `const {${bindings.join(", ")}} = __mod_${dep};`;
  });
  // export宣言 → 通常宣言 (名前を記録)。async function にも対応。
  code = code.replace(/export\s+(async\s+)?(const|let|function|class)\s+([A-Za-z0-9_$]+)/g, (m, asyncKw, kind, name) => {
    exports.push(name);
    return `${asyncKw || ""}${kind} ${name}`;
  });
  if (/(^|\n)export[\s{]/.test(code)) throw new Error(`unsupported export form in ${id}`);
  return `const __mod_${id} = (() => {\n${code}\nreturn { ${exports.join(", ")} };\n})();`;
}

const bundled = MODULES.map(m => transform(readFileSync(join(root, m.path), "utf8"), m.id)).join("\n\n");

// 生成したコードが構文として正しいか必ず検査する。
// (開発サーバはESモジュールをそのまま読むため、バンドル固有の壊れ方は
//  ブラウザ検証では見つからない。ここで止めるのが唯一の砦)
try {
  new Function(bundled);
} catch (e) {
  console.error("バンドル結果が構文エラーです:", e.message);
  const m = /position (\d+)/.exec(e.message);
  if (m) console.error("周辺:", bundled.slice(Math.max(0, +m[1] - 120), +m[1] + 120));
  process.exit(1);
}

let html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "css/style.css"), "utf8");
html = html.replace(/<link rel="stylesheet"[^>]*>/, `<style>\n${css}\n</style>`);
html = html.replace(
  /<script type="module" src="src\/ui\.js"><\/script>/,
  `<script>\n"use strict";\n${bundled}\n</script>`
);

mkdirSync(join(root, "dist"), { recursive: true });
const out = join(root, "dist", "hiragana-mahjong.html");
writeFileSync(out, html);
console.log(`built: ${out} (${(html.length / 1024).toFixed(0)} KB)`);

// Artifact用: claude.ai側がhtml/head/bodyスケルトンを付与するため、中身だけを出力
const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
const artifact = `<title>ひらがな麻雀</title>\n<style>\n${css}\n</style>\n${bodyMatch[1]}`;
const outA = join(root, "dist", "hiragana-mahjong-artifact.html");
writeFileSync(outA, artifact);
console.log(`built: ${outA} (${(artifact.length / 1024).toFixed(0)} KB)`);
