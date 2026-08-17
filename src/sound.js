// 音まわり (効果音 + BGM)。すべてWebAudioで合成し、音声ファイルは使わない。
// - 効果音は「パック」で差し替え可能 (課金要素)
// - BGMは「セット」で差し替え可能 (課金要素)。各セットに lobby / battle の2曲
// AudioContextはブラウザの自動再生制限のため、最初のユーザー操作後にしか鳴らない。
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

// ブラウザの自動再生制限の解除用: ユーザー操作の中で一度呼ぶ
export function unlockAudio() { ac(); }

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  writeStore(MUTE_KEY, muted ? "1" : "0");
  if (muted) stopBgm(); else restartBgm();
  return muted;
}

// ================= 音の部品 =================
function tone(freq, dur, { type = "sine", vol = 0.15, when = 0, slideTo = null } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + when;
  playToneAt(c, t0, freq, dur, type, vol, slideTo);
}
function playToneAt(c, t0, freq, dur, type, vol, slideTo = null) {
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
// 琴・三味線風の爪弾き (2オシレータの軽いデチューン)
function pluckAt(c, t0, freq, vol = 0.09, dur = 0.5) {
  playToneAt(c, t0, freq, dur, "triangle", vol);
  playToneAt(c, t0, freq * 1.005, dur * 0.8, "sine", vol * 0.5);
}
// 鈴・ベル (倍音つきの長い減衰)
function bellAt(c, t0, freq, vol = 0.07) {
  playToneAt(c, t0, freq, 1.4, "sine", vol);
  playToneAt(c, t0, freq * 2.76, 0.9, "sine", vol * 0.35);
}
function noiseAt(c, t0, { dur = 0.03, vol = 0.2, freq = 2400, type = "bandpass" } = {}) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t0);
}
// 太鼓 (低い胴鳴り + 皮のアタック)
function taikoAt(c, t0, vol = 0.14) {
  playToneAt(c, t0, 82, 0.28, "sine", vol, 55);
  noiseAt(c, t0, { dur: 0.02, vol: vol * 0.7, freq: 900, type: "lowpass" });
}
function clack(vol = 0.2) {
  const c = ac();
  if (!c) return;
  noiseAt(c, c.currentTime, { dur: 0.03, vol, freq: 2400 });
}

// ================= 効果音パック (課金で切り替え) =================
const SFX_PACKS = {
  // 基本: 牌と木の音 (従来のもの)
  tsuchi: {
    tap: () => tone(880, 0.05, { vol: 0.06 }),
    discard: () => clack(0.25),
    draw: () => tone(520, 0.04, { vol: 0.05 }),
    claim: () => { tone(392, 0.12, { type: "square", vol: 0.08 }); tone(587, 0.16, { type: "square", vol: 0.08, when: 0.09 }); },
    win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { vol: 0.1, when: i * 0.09 })); },
    lose: () => { tone(330, 0.3, { vol: 0.08 }); tone(262, 0.4, { vol: 0.08, when: 0.15 }); },
    coin: () => { tone(1319, 0.1, { vol: 0.09 }); tone(1760, 0.18, { vol: 0.09, when: 0.07 }); },
  },
  // まりも: まるくてやわらかい水音系
  marimo: {
    tap: () => tone(520, 0.09, { vol: 0.07, slideTo: 660 }),
    discard: () => tone(300, 0.14, { vol: 0.1, slideTo: 180 }),
    draw: () => tone(440, 0.08, { vol: 0.05, slideTo: 520 }),
    claim: () => { tone(392, 0.16, { vol: 0.09, slideTo: 490 }); tone(523, 0.2, { vol: 0.09, when: 0.1, slideTo: 660 }); },
    win: () => { [392, 494, 587, 784].forEach((f, i) => tone(f, 0.3, { vol: 0.09, when: i * 0.11, slideTo: f * 1.12 })); },
    lose: () => { tone(300, 0.4, { vol: 0.08, slideTo: 180 }); },
    coin: () => { tone(988, 0.14, { vol: 0.08, slideTo: 1319 }); },
  },
  // でんし: レトロゲーム風の矩形波
  denshi: {
    tap: () => tone(1047, 0.04, { type: "square", vol: 0.045 }),
    discard: () => { tone(220, 0.05, { type: "square", vol: 0.07 }); tone(110, 0.06, { type: "square", vol: 0.06, when: 0.04 }); },
    draw: () => tone(659, 0.03, { type: "square", vol: 0.04 }),
    claim: () => { [523, 659, 880].forEach((f, i) => tone(f, 0.06, { type: "square", vol: 0.07, when: i * 0.05 })); },
    win: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.09, { type: "square", vol: 0.08, when: i * 0.07 })); },
    lose: () => { [392, 330, 262].forEach((f, i) => tone(f, 0.12, { type: "square", vol: 0.07, when: i * 0.1 })); },
    coin: () => { tone(1319, 0.05, { type: "square", vol: 0.08 }); tone(1760, 0.12, { type: "square", vol: 0.08, when: 0.05 }); },
  },
};

let sfxPack = "tsuchi";
export function setSfxPack(id) { if (SFX_PACKS[id]) sfxPack = id; }
export function play(name) {
  if (muted) return;
  try { SFX_PACKS[sfxPack][name]?.(); } catch { /* 音は失敗しても進行に影響させない */ }
}
// 試聴 (ミュート中でも鳴らす: 買い物の判断用)
export function auditionSfx(id) {
  if (!SFX_PACKS[id]) return;
  try {
    SFX_PACKS[id].claim();
    setTimeout(() => { try { SFX_PACKS[id].coin(); } catch { /* noop */ } }, 450);
  } catch { /* noop */ }
}

// ================= BGM (セットごとに lobby / battle) =================
// 音名→周波数 (A4=440)
const N = (n) => 440 * Math.pow(2, (n - 69) / 12);
// 平調子っぽい音階 (D を基準): D4=62, Eb=63, G=67, A=69, Bb=70, D5=74 ...
const BGM_SETS = {
  // 夜の卓: 静かな琴の爪弾き (基本・無料)
  yoru: {
    lobby: {
      bpm: 66, steps: 16, loopBeats: 8,
      events: {
        0: [["pluck", N(62), 0.08]], 3: [["pluck", N(67), 0.06]],
        6: [["pluck", N(69), 0.07]], 10: [["pluck", N(74), 0.05]],
        12: [["pluck", N(70), 0.05]], 14: [["bass", N(38), 0.06]],
      },
    },
    battle: {
      bpm: 96, steps: 16, loopBeats: 8,
      events: {
        0: [["bass", N(50), 0.08], ["pluck", N(62), 0.07]],
        2: [["tick"]], 4: [["pluck", N(65), 0.06]], 6: [["tick"]],
        7: [["pluck", N(67), 0.07]], 8: [["bass", N(50), 0.07], ["taiko"]],
        10: [["pluck", N(69), 0.07]], 12: [["pluck", N(67), 0.05]], 14: [["tick"], ["pluck", N(62), 0.05]],
      },
    },
  },
  // 祭: にぎやかな祭ばやし風 (課金)
  matsuri: {
    lobby: {
      bpm: 108, steps: 16, loopBeats: 8,
      events: {
        0: [["pluck", N(69), 0.08], ["tick"]], 2: [["pluck", N(74), 0.06]],
        4: [["pluck", N(76), 0.07], ["tick"]], 6: [["pluck", N(74), 0.05]],
        8: [["pluck", N(69), 0.07], ["tick"]], 10: [["pluck", N(64), 0.06]],
        12: [["pluck", N(67), 0.07], ["tick"]], 14: [["pluck", N(69), 0.05]],
      },
    },
    battle: {
      bpm: 132, steps: 16, loopBeats: 8,
      events: {
        0: [["taiko"], ["pluck", N(69), 0.08]], 2: [["tick"]], 3: [["tick"]],
        4: [["taiko"], ["pluck", N(74), 0.07]], 6: [["tick"]],
        8: [["taiko"], ["pluck", N(76), 0.08]], 10: [["tick"]], 11: [["pluck", N(74), 0.05]],
        12: [["taiko"], ["pluck", N(69), 0.07]], 14: [["tick"], ["pluck", N(67), 0.05]],
      },
    },
  },
  // 雪: 鈴の音のアンビエント (課金)
  yuki: {
    lobby: {
      bpm: 54, steps: 16, loopBeats: 8,
      events: {
        0: [["bell", N(74), 0.05]], 5: [["bell", N(81), 0.04]],
        9: [["bell", N(79), 0.045]], 13: [["bell", N(86), 0.03]],
      },
    },
    battle: {
      bpm: 72, steps: 16, loopBeats: 8,
      events: {
        0: [["bell", N(74), 0.05], ["bass", N(38), 0.05]],
        4: [["bell", N(79), 0.045]], 7: [["bell", N(81), 0.04]],
        8: [["bass", N(45), 0.05]], 11: [["bell", N(86), 0.035]], 14: [["bell", N(79), 0.03]],
      },
    },
  },
};

let bgmSet = "yoru";
let bgmTrack = null;      // "lobby" | "battle" | null
let bgmTimer = null;
let bgmStep = 0;
let bgmNextTime = 0;

function playVoice(c, t0, ev) {
  const [kind, freq, vol] = ev;
  if (kind === "pluck") pluckAt(c, t0, freq, vol);
  else if (kind === "bell") bellAt(c, t0, freq, vol);
  else if (kind === "bass") playToneAt(c, t0, freq, 0.6, "sine", vol);
  else if (kind === "taiko") taikoAt(c, t0, 0.12);
  else if (kind === "tick") noiseAt(c, t0, { dur: 0.015, vol: 0.05, freq: 5200 });
}

function bgmPattern() { return BGM_SETS[bgmSet]?.[bgmTrack]; }

function scheduleBgm() {
  const c = ac();
  const pat = bgmPattern();
  if (!c || !pat || muted) return;
  const stepDur = (60 / pat.bpm) * (pat.loopBeats / pat.steps) * 2;
  if (bgmNextTime < c.currentTime) bgmNextTime = c.currentTime + 0.05;
  while (bgmNextTime < c.currentTime + 0.35) {
    const evs = pat.events[bgmStep];
    if (evs) for (const ev of evs) { try { playVoice(c, bgmNextTime, ev); } catch { /* noop */ } }
    bgmNextTime += stepDur;
    bgmStep = (bgmStep + 1) % pat.steps;
  }
}

export function setBgmSet(id) {
  if (!BGM_SETS[id] || id === bgmSet) return;
  bgmSet = id;
  if (bgmTrack) { const t = bgmTrack; stopBgm(); playBgm(t); }
}
export function playBgm(track) {
  if (!BGM_SETS[bgmSet][track]) return;
  if (bgmTrack === track && bgmTimer) return;
  stopBgm();
  bgmTrack = track;
  if (muted) return; // ミュート解除時に restartBgm で再開する
  bgmStep = 0;
  bgmNextTime = 0;
  scheduleBgm();
  bgmTimer = setInterval(scheduleBgm, 120);
}
export function stopBgm() {
  clearInterval(bgmTimer);
  bgmTimer = null;
  bgmStep = 0;
  bgmNextTime = 0;
}
function restartBgm() {
  const t = bgmTrack;
  if (t) { bgmTrack = null; playBgm(t); }
}
export function currentBgm() { return { set: bgmSet, track: bgmTrack, playing: !!bgmTimer }; }

// 試聴: 指定セットのbattleを約2.6秒だけ鳴らす (装備は変えない)
export function auditionBgm(id) {
  const pat = BGM_SETS[id]?.battle;
  const c = ac();
  if (!pat || !c) return;
  const stepDur = (60 / pat.bpm) * (pat.loopBeats / pat.steps) * 2;
  let t = c.currentTime + 0.05;
  const totalSteps = Math.min(pat.steps * 2, Math.ceil(2.6 / stepDur));
  for (let s = 0; s < totalSteps; s++) {
    const evs = pat.events[s % pat.steps];
    if (evs) for (const ev of evs) { try { playVoice(c, t, ev); } catch { /* noop */ } }
    t += stepDur;
  }
}
