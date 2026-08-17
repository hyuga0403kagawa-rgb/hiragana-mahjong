// オンライン対戦クライアント: 同一オリジンの /ws へ接続してJSONメッセージを送受信する
export class NetClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map(); // t -> fn(msg)
    this.closedByMe = false;
  }
  on(t, fn) { this.handlers.set(t, fn); }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
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
