// 効果音 (WebAudioで合成、外部アセット不要)
// AudioContextはブラウザの自動再生制限のため最初のユーザー操作で生成する。
import { readStore, writeStore } from "./storage.js";

const MUTE_KEY = "hiragana_mahjong_muted";

let ctx = null;
let muted = readStore(MUTE_KEY) === "1";

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  writeStore(MUTE_KEY, muted ? "1" : "0");
  return muted;
}

// 単音: freq(Hz), dur(秒), type, vol
function tone(freq, dur, { type = "sine", vol = 0.15, when = 0, slideTo = null } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// 牌のカチッという音 (短いノイズ)
function clack(vol = 0.2, when = 0) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + when;
  const len = Math.floor(c.sampleRate * 0.03);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2400;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t0);
}

const SFX = {
  tap: () => tone(880, 0.05, { vol: 0.06 }),
  discard: () => clack(0.25),
  draw: () => tone(520, 0.04, { vol: 0.05 }),
  claim: () => { tone(392, 0.12, { type: "square", vol: 0.08 }); tone(587, 0.16, { type: "square", vol: 0.08, when: 0.09 }); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { vol: 0.1, when: i * 0.09 })); },
  lose: () => { tone(330, 0.3, { vol: 0.08 }); tone(262, 0.4, { vol: 0.08, when: 0.15 }); },
  coin: () => { tone(1319, 0.1, { vol: 0.09 }); tone(1760, 0.18, { vol: 0.09, when: 0.07 }); },
};

export function play(name) {
  if (muted) return;
  try { SFX[name]?.(); } catch { /* 音は失敗しても進行に影響させない */ }
}
