// Edge(またはChrome)をヘッドレス起動し、Chrome DevTools Protocol で操作する最小ヘルパー。
// ストア用スクリーンショットの撮影 (tools/gen_store_screenshots.mjs) で使う。
// 外部ライブラリなし (Node 22+ の組み込み WebSocket / fetch を使用)。
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "hm-cdp-"));
  const proc = spawn(findBrowser(), [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore", detached: false });

  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch { /* まだ起動中 */ }
  }
  if (!wsUrl) throw new Error("ブラウザのデバッグポートに接続できない");

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

  // ページ内で式を評価して値を返す (Promiseはawaitする)
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("ページ内エラー: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  const close = async () => {
    try { await send("Browser.close"); } catch { /* 終了済み */ }
    try { ws.close(); } catch { /* 終了済み */ }
    await sleep(500);
    try { proc.kill(); } catch { /* 終了済み */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ロック中なら残す */ }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  return { send, evaluate, close, sleep };
}
