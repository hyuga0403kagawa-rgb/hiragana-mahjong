// オンライン対戦クライアント: サーバーの /ws へ接続してJSONメッセージを送受信する
//
// Web版・PWA版はゲームサーバーが配信するページなので「同一オリジン」で繋がる。
// ネイティブアプリ(Capacitor)はローカルにバンドルした資産から起動するため
// location.host が本番サーバーと一致しない。その場合は固定の本番オリジンを使う。
const PROD_HOST = "hiragana-mahjong.onrender.com";
function isNativeApp() {
  return !!(typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.());
}
// 同一オリジン判定に使うAPIオリジン (ui.jsのオンライン確認フェッチにも使う)
export function serverOrigin() {
  return isNativeApp() ? `https://${PROD_HOST}` : location.origin;
}
function wsOrigin() {
  if (isNativeApp()) return `wss://${PROD_HOST}`;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

export class NetClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map(); // t -> fn(msg)
    this.closedByMe = false;
  }
  on(t, fn) { this.handlers.set(t, fn); }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsOrigin()}/ws`);
      this.ws = ws;
      const timer = setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 5000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error("connect failed")); };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const fn = this.handlers.get(msg.t);
        if (fn) fn(msg);
      };
      ws.onclose = () => {
        if (!this.closedByMe) this.handlers.get("closed")?.({ t: "closed" });
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    this.closedByMe = true;
    try { this.ws?.close(); } catch { /* already closed */ }
  }
}
