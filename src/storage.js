// 安全なローカル保存
// 埋め込みiframe(サンドボックス)やプライベートブラウズでは localStorage への
// **プロパティアクセス自体が例外を投げる**。そこで一度だけ安全に検出し、
// 使えない環境ではメモリ上の代替に切り替える。以後どこからも例外は飛ばない。

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    __memory: true,
  };
}

function detect() {
  try {
    const s = globalThis.localStorage;   // ここが投げることがある
    const probe = "__hiragana_mahjong_probe__";
    s.setItem(probe, "1");               // Safariのプライベートモードはここで投げる
    s.removeItem(probe);
    return s;
  } catch {
    return makeMemoryStorage();
  }
}

export const safeStorage = detect();
// 保存が永続しない環境か (UIで案内を出すのに使う)
export const storageIsPersistent = !safeStorage.__memory;

export function readStore(key, fallback = null) {
  try { const v = safeStorage.getItem(key); return v == null ? fallback : v; }
  catch { return fallback; }
}
export function writeStore(key, value) {
  try { safeStorage.setItem(key, value); return true; } catch { return false; }
}
export function removeStore(key) {
  try { safeStorage.removeItem(key); } catch { /* 失敗しても進行を止めない */ }
}
