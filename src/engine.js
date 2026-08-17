// ひらがな麻雀 ゲームエンジン (DOM非依存の純ロジック)
// ルール: 手牌13 + ツモ/ロン牌1 = 14牌を「2文字語×1 + 3文字語×4」に分解できたら上がり。
// ポン(捨て牌+手牌2で3文字語)、カン(手牌のみで4文字語→嶺上補充)、ロンあり。

export const SEION = [..."あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわん"];
export const DAKUON = [..."がぎぐげござじずぜぞだぢづでどばびぶべぼ"];
export const HANDAKUON = [..."ぱぴぷぺぽ"];
export const KOMOJI = [..."ゃゅょっ"];
export const CHOON = ["ー"];
// レア牌 = 各1枚しかない牌
export const RARE_TILES = new Set([...DAKUON, ...HANDAKUON, ...KOMOJI, ...CHOON]);

export function buildTileSet() {
  const tiles = [];
  for (const c of SEION) { tiles.push(c, c); }
  for (const c of [...DAKUON, ...HANDAKUON, ...KOMOJI, ...CHOON]) tiles.push(c);
  return tiles; // 120枚
}

// ---- ユーティリティ ----
export function counts(arr) {
  const m = new Map();
  for (const c of arr) m.set(c, (m.get(c) || 0) + 1);
  return m;
}
function containsCounts(hand, need) {
  for (const [c, n] of need) if ((hand.get(c) || 0) < n) return false;
  return true;
}
function subtractCounts(hand, need) {
  const m = new Map(hand);
  for (const [c, n] of need) {
    const left = m.get(c) - n;
    if (left === 0) m.delete(c); else m.set(c, left);
  }
  return m;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- 辞書 ----
// dict = { w2:Set, w3:Set, w4:Set } (ひらがな文字列)
export class Dict {
  constructor(w2, w3, w4) {
    this.w2 = w2 instanceof Set ? w2 : new Set(w2);
    this.w3 = w3 instanceof Set ? w3 : new Set(w3);
    this.w4 = w4 instanceof Set ? w4 : new Set(w4);
    this._w2arr = [...this.w2].map(w => ({ w, cnt: counts([...w]) }));
    this._w3arr = [...this.w3].map(w => ({ w, cnt: counts([...w]) }));
    this._w4arr = [...this.w4].map(w => ({ w, cnt: counts([...w]) }));
    // 文字→その文字を含む3文字語 (ポン判定用)
    this._w3byChar = new Map();
    for (const e of this._w3arr) {
      for (const c of new Set([...e.w])) {
        if (!this._w3byChar.has(c)) this._w3byChar.set(c, []);
        this._w3byChar.get(c).push(e);
      }
    }
  }
  formable2(hand) { return this._w2arr.filter(e => containsCounts(hand, e.cnt)); }
  formable3(hand) { return this._w3arr.filter(e => containsCounts(hand, e.cnt)); }
  formable4(hand) { return this._w4arr.filter(e => containsCounts(hand, e.cnt)); }
}

// 語彙の部分集合辞書 (CPUの語彙力=難易度用)。fraction: 各語を残す確率。
export function subsetDict(dict, fraction, rng = Math.random) {
  const pick = (set) => [...set].filter(() => rng() < fraction);
  return new Dict(pick(dict.w2), pick(dict.w3), pick(dict.w4));
}

export function dictSize(dict) {
  return dict.w2.size + dict.w3.size + dict.w4.size;
}
// 「語彙数」指定でCPU用の辞書を作る (全体辞書が大きくなっても強さを一定に保つ)
export function subsetDictByCount(dict, wordCount, rng = Math.random) {
  const fraction = Math.min(1, wordCount / Math.max(1, dictSize(dict)));
  return subsetDict(dict, fraction, rng);
}

// ---- 上がり判定 ----
// tiles: 牌配列。need3: 必要な3文字語の数 (4 - 完成済み鳴き数)。
// 分解できれば { two: "xx", threes: ["xxx", ...] } を返す。不可なら null。
export function findWin(tiles, need3, dict) {
  const total = 2 + need3 * 3;
  if (tiles.length !== total) return null;
  const hand = counts(tiles);
  const cand3 = dict._w3arr.filter(e => containsCounts(hand, e.cnt));
  const cand2 = dict._w2arr.filter(e => containsCounts(hand, e.cnt));
  if (cand2.length === 0 && need3 * 3 !== tiles.length) return null;

  // 2文字語を先に固定し、残りを3文字語で被覆する
  for (const e2 of cand2) {
    const rest = subtractCounts(hand, e2.cnt);
    const threes = cover3(rest, need3, cand3, 0);
    if (threes) return { two: e2.w, threes };
  }
  if (need3 * 3 === tiles.length) {
    const threes = cover3(hand, need3, cand3, 0);
    if (threes) return { two: null, threes };
  }
  return null;
}
function cover3(hand, need, cand, startIdx) {
  if (need === 0) {
    let size = 0; for (const n of hand.values()) size += n;
    return size === 0 ? [] : null;
  }
  for (let i = startIdx; i < cand.length; i++) {
    const e = cand[i];
    if (!containsCounts(hand, e.cnt)) continue;
    const rest = subtractCounts(hand, e.cnt);
    // 同じ語を2回使う場合があるので startIdx は i のまま
    const sub = cover3(rest, need - 1, cand, i);
    if (sub) return [e.w, ...sub];
  }
  return null;
}

// ---- 並べてあがる方式の判定 ----
// プレイヤーは手牌を「ことばの順」に並べたときだけあがれる (2026-08-16 ルール変更)。
// tilesInOrder: 表示順の牌。左から順に語のブロックに区切れたら成立。
// 2文字語のブロックは先頭でなくてもよい (need3+1 通りの位置を試す)。
export function checkArrangedWin(tilesInOrder, need3, dict) {
  if (tilesInOrder.length !== 2 + need3 * 3) return null;
  for (let twoPos = 0; twoPos <= need3; twoPos++) {
    let idx = 0;
    let two = null;
    const threes = [];
    let ok = true;
    for (let block = 0; block <= need3; block++) {
      if (block === twoPos) {
        two = tilesInOrder.slice(idx, idx + 2).join("");
        if (!dict.w2.has(two)) { ok = false; break; }
        idx += 2;
      } else {
        const w = tilesInOrder.slice(idx, idx + 3).join("");
        if (!dict.w3.has(w)) { ok = false; break; }
        threes.push(w);
        idx += 3;
      }
    }
    if (ok) return { two, threes };
  }
  return null;
}

// ロン: 13枚の並びのどこか1箇所に捨て牌を差し込んで完成するか。
// 「テンパイの形に並べてある」ことが実質の条件になる。
export function checkArrangedRon(tilesInOrder, tile, need3, dict) {
  for (let i = 0; i <= tilesInOrder.length; i++) {
    const t = [...tilesInOrder.slice(0, i), tile, ...tilesInOrder.slice(i)];
    const r = checkArrangedWin(t, need3, dict);
    if (r) return r;
  }
  return null;
}

// ---- テンパイ/待ち牌 ----
export function findWaits(tiles13, need3, dict) {
  const kinds = [...SEION, ...DAKUON, ...HANDAKUON, ...KOMOJI, ...CHOON];
  const waits = [];
  for (const t of kinds) {
    if (findWin([...tiles13, t], need3, dict)) waits.push(t);
  }
  return waits;
}

// ---- ポン候補: 捨て牌tile + 手牌2枚で3文字語 ----
export function ponOptions(handTiles, tile, dict) {
  const hand = counts(handTiles);
  const res = [];
  for (const e of dict._w3byChar.get(tile) || []) {
    const need = new Map(e.cnt);
    const n = need.get(tile);
    if (n === 1) need.delete(tile); else need.set(tile, n - 1);
    if (containsCounts(hand, need)) res.push(e.w);
  }
  return res;
}

// ---- カン候補: 手牌のみで4文字語 ----
export function kanOptions(handTiles, dict) {
  const hand = counts(handTiles);
  return dict._w4arr.filter(e => containsCounts(hand, e.cnt)).map(e => e.w);
}

// ---- 得点 ----
// 上がり形(手牌分解 + 鳴き)から得点を計算
export function scoreWin(decomp, melds) {
  let pts = 8;
  const words = [];
  if (decomp.two) words.push(decomp.two);
  words.push(...decomp.threes);
  for (const m of melds) words.push(m.word);
  let rare = 0;
  for (const w of words) for (const c of w) if (RARE_TILES.has(c)) rare++;
  pts += rare * 2;
  pts += melds.filter(m => m.type === "kan").length * 2;
  return { total: pts, rare, kans: melds.filter(m => m.type === "kan").length, words };
}

// ---- ゲーム本体 ----
export const Phase = {
  DEAL: "deal",          // 配牌直後
  DRAW: "draw",          // 手番プレイヤーがツモる前
  DISCARD: "discard",    // ツモ後、捨て牌待ち (ツモ上がり/カン可)
  CLAIM: "claim",        // 捨て牌に対するロン/ポン受付
  ROUND_END: "round_end",
  GAME_END: "game_end",
};

export class Game {
  // players: [{name, isHuman}], dict: Dict, rounds: 局数
  // players[i].dict があればそのプレイヤー専用の語彙として使う (CPUの語彙制限=難易度)
  constructor({ players, dict, rounds = 4, seed = null }) {
    this.players = players.map((p, i) => ({ ...p, id: i, score: 0 }));
    this.n = players.length;
    this.dict = dict;
    this.totalRounds = rounds;
    this.round = 0;
    this.dealer = 0;
    this.rng = seed == null ? Math.random : mulberry32(seed);
    this.phase = Phase.DEAL;
    this.log = [];
  }

  startRound() {
    this.round++;
    this.wall = shuffle(buildTileSet(), this.rng);
    this.hands = []; this.discards = []; this.melds = [];
    for (let i = 0; i < this.n; i++) {
      this.hands.push(this.wall.splice(0, 13));
      this.discards.push([]);
      this.melds.push([]);
    }
    this.turn = this.dealer;
    this.phase = Phase.DRAW;
    this.lastDiscard = null;   // {tile, from}
    this.drawnTile = null;
    this.roundResult = null;
  }

  need3(p) { return 4 - this.melds[p].length; }
  // 手牌+1枚(=上がり判定対象)に必要な枚数
  fullHandSize(p) { return 2 + this.need3(p) * 3; }

  // 手番プレイヤーがツモる。山が空なら流局。
  drawTile() {
    if (this.wall.length === 0) { this.endRoundDraw(); return null; }
    const t = this.wall.shift();
    this.hands[this.turn].push(t);
    this.drawnTile = t;
    this.phase = Phase.DISCARD;
    return t;
  }

  dictFor(p) { return this.players[p].dict || this.dict; }

  canTsumo(p) {
    return findWin(this.hands[p], this.need3(p), this.dictFor(p));
  }
  canKan(p) {
    if (this.melds[p].length >= 3) return []; // 鳴きすぎ防止(最低2文字+3文字1組は手牌に残す)
    return kanOptions(this.hands[p], this.dictFor(p));
  }
  canPon(p, tile) {
    if (p === this.lastDiscard?.from) return [];
    if (this.melds[p].length >= 3) return [];
    return ponOptions(this.hands[p], tile, this.dictFor(p));
  }
  canRon(p, tile) {
    return findWin([...this.hands[p], tile], this.need3(p), this.dictFor(p));
  }

  discard(tileIdx) {
    const p = this.turn;
    const [t] = this.hands[p].splice(tileIdx, 1);
    this.discards[p].push(t);
    this.lastDiscard = { tile: t, from: p };
    this.drawnTile = null;
    this.phase = Phase.CLAIM;
    return t;
  }

  // 捨て牌へのロン/ポンを解決した後に呼ぶ。誰も鳴かなければ次の手番へ。
  passClaims() {
    this.turn = (this.turn + 1) % this.n;
    this.phase = Phase.DRAW;
  }

  declareKan(p, word) {
    const need = counts([...word]);
    this._removeTiles(p, need);
    this.melds[p].push({ type: "kan", word, from: p });
    // 嶺上牌: 山の末尾から補充
    if (this.wall.length === 0) { this.endRoundDraw(); return null; }
    const t = this.wall.pop();
    this.hands[p].push(t);
    this.drawnTile = t;
    this.phase = Phase.DISCARD;
    return t;
  }

  claimPon(p, word) {
    const { tile, from } = this.lastDiscard;
    const need = counts([...word]);
    const n = need.get(tile);
    if (n === 1) need.delete(tile); else need.set(tile, n - 1);
    this._removeTiles(p, need);
    this.discards[from].pop(); // 捨て牌から取る
    this.melds[p].push({ type: "pon", word, from, claimed: tile });
    this.lastDiscard = null;
    this.turn = p;
    this.drawnTile = null;
    this.phase = Phase.DISCARD; // ポン後は捨てるだけ(ツモなし)
  }

  _removeTiles(p, needMap) {
    const hand = this.hands[p];
    for (const [c, n] of needMap) {
      for (let k = 0; k < n; k++) {
        const idx = hand.indexOf(c);
        if (idx === -1) throw new Error(`tile not in hand: ${c}`);
        hand.splice(idx, 1);
      }
    }
  }

  // decompOverride: 「並べてあがる」方式で検証済みの分解を渡す (人間用)。
  // 省略時は辞書探索で判定する (CPU用)。
  winByTsumo(p, decompOverride = null) {
    const decomp = decompOverride || this.canTsumo(p);
    if (!decomp) throw new Error("not a winning hand");
    const sc = scoreWin(decomp, this.melds[p]);
    const per = Math.ceil(sc.total / (this.n - 1));
    for (let i = 0; i < this.n; i++) {
      if (i === p) this.players[i].score += per * (this.n - 1);
      else this.players[i].score -= per;
    }
    this.roundResult = { type: "tsumo", winner: p, decomp, score: sc, payments: { per } };
    this._finishRound();
  }

  winByRon(p, decompOverride = null) {
    const { tile, from } = this.lastDiscard;
    const decomp = decompOverride || this.canRon(p, tile);
    if (!decomp) throw new Error("not a winning hand");
    this.hands[p].push(tile);
    this.discards[from].pop();
    const sc = scoreWin(decomp, this.melds[p]);
    this.players[p].score += sc.total;
    this.players[from].score -= sc.total;
    this.roundResult = { type: "ron", winner: p, loser: from, tile, decomp, score: sc };
    this._finishRound();
  }

  endRoundDraw() {
    this.roundResult = { type: "draw" };
    this._finishRound();
  }

  _finishRound() {
    this.phase = this.round >= this.totalRounds ? Phase.GAME_END : Phase.ROUND_END;
    if (this.phase === Phase.GAME_END) return;
    this.dealer = (this.dealer + 1) % this.n;
  }
}
