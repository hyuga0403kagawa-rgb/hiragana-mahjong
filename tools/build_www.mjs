// ネイティブアプリ(Capacitor)にバンドルする静的資産を www/ に集める。
// node tools/build_www.mjs
//
// Web版はゲームサーバーがファイルをそのまま配信するのでビルド不要だが、
// ネイティブ版はアプリ内にファイルを同梱する必要があるため、この一式だけをコピーする。
// (tools/・node_modules/・native-tools/ 等の開発専用ファイルは含めない)
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const www = join(root, "www");

if (existsSync(www)) rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

const ITEMS = ["index.html", "manifest.webmanifest", "css", "src", "icons"];
for (const item of ITEMS) {
  const src = join(root, item);
  if (!existsSync(src)) { console.log(`skip (not found): ${item}`); continue; }
  cpSync(src, join(www, item), { recursive: true });
  console.log(`copied: ${item}`);
}

console.log(`\nwww/ 生成完了: ${www}`);
