// ひらがな麻雀 オンライン対戦サーバ: node tools/gameserver.mjs [port]
// 静的配信 + /ws でルーム対戦 (サーバ権威: ルール判定はすべてサーバ側)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Game, Phase, Dict, subsetDictByCount, checkArrangedWin, checkArrangedRon } from "../src/engine.js";
import { chooseDiscard, shouldPon, shouldKan } from "../src/ai.js";
import { WORDS2, WORDS3, WORDS4 } from "../src/data/words.js";
import { RANKS, CPU_WORDS_BY_RANK } from "../src/rank.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// ポートは コマンドライン引数 > 環境変数PORT > 既定8737 の順で決まる。
// ホスティング(Render等)は PORT を渡してくるので `npm start` のまま動く。
const port = +(process.argv[2] || process.env.PORT || 8737);
const dict = new Dict(WORDS2, WORDS3, WORDS4);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

const httpServer = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/api/online") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ online: true }));
      return;
    }
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});

// ================= ルーム管理 =================
const rooms = new Map(); // code -> room
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CPU_POOL = ["あかり", "つばき", "げんた", "こまち"];
const CPU_ICONS = { "あかり": "🌸", "つばき": "🍵", "げんた": "🐻", "こまち": "🎐" };
// プレイヤーが選べるアイコン (クライアントと同じ一覧)。不正値は先頭に落とす。
const PLAYER_ICONS = ["🐱", "🐼", "🦊", "🐸", "🀄", "🌙"];
function cleanIcon(raw) {
  return PLAYER_ICONS.includes(raw) ? raw : PLAYER_ICONS[0];
}
const TURN_TIMEOUT = 60_000;
const CLAIM_TIMEOUT = 20_000;
// 切断してから席を確保しておく時間。スマホはアプリ切り替えで簡単に切れるので長めに取る。
const RECONNECT_WINDOW = 180_000;

function newCode() {
  for (let tries = 0; tries < 100; tries++) {
    let c = "";
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function makeRoom() {
  const code = newCode();
  if (!code) return null;
  const room = {
    code, seats: [], state: "lobby", game: null,
    seq: 0, aborted: false,
  };
  rooms.set(code, room);
  return room;
}

function sendTo(seat, obj) {
  if (seat.ws && seat.ws.readyState === 1) {
    try { seat.ws.send(JSON.stringify(obj)); } catch { /* 切断直後 */ }
  }
}
function broadcast(room, obj) {
  for (const s of room.seats) sendTo(s, obj);
}
function hostIdx(room) {
  return room.seats.findIndex(s => !s.isCpu);
}
function broadcastLobby(room) {
  room.seats.forEach((s, i) => {
    sendTo(s, {
      t: "lobby", code: room.code,
      players: room.seats.map(x => ({ name: x.name, icon: x.icon, isCpu: x.isCpu })),
      hostIdx: hostIdx(room), youIdx: i,
    });
  });
}
function cleanName(raw) {
  const s = String(raw ?? "").replace(/[\r\n\t]/g, "").trim().slice(0, 8);
  return s || "ななし";
}
// 再接続用のトークン。ブラウザが自分で生成した文字列で、席の持ち主を照合するだけに使う。
function cleanToken(raw) {
  const s = String(raw ?? "").trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}
// トークンから「再接続を待っている席」を探す
function findResumable(token) {
  if (!token) return null;
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.state !== "playing" || room.aborted) continue;
    const idx = room.seats.findIndex(s =>
      !s.isCpu && !s.connected && s.token === token &&
      s.disconnectedAt && now - s.disconnectedAt < RECONNECT_WINDOW);
    if (idx >= 0) return { room, seat: room.seats[idx], idx };
  }
  return null;
}

// ================= 対局進行 =================
function viewFor(room, i) {
  const g = room.game;
  return {
    myIndex: i,
    round: g.round, totalRounds: g.totalRounds,
    wallCount: g.wall.length, turn: g.turn, phase: g.phase,
    over: !!g.roundResult,
    players: g.players.map((p, k) => ({
      name: p.name, icon: room.seats[k].icon, score: p.score, isCpu: room.seats[k].isCpu,
      connected: room.seats[k].isCpu ? true : room.seats[k].connected,
      melds: g.melds[k], discards: g.discards[k],
    })),
    myHand: g.hands[i],
    drawnTile: g.turn === i ? g.drawnTile : null,
    lastDiscard: g.lastDiscard,
  };
}
function broadcastState(room) {
  room.seats.forEach((s, i) => {
    if (!s.isCpu) sendTo(s, { t: "state", view: viewFor(room, i) });
  });
}

// seatに1つ質問して答え(または期限切れでnull)を待つ
function askSeat(room, seatIdx, prompt, timeoutMs) {
  const seat = room.seats[seatIdx];
  const seq = ++room.seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (seat.pending && seat.pending.seq === seq) { seat.pending = null; resolve(null); }
    }, timeoutMs);
    seat.pending = {
      seq,
      resolve: (action) => { clearTimeout(timer); seat.pending = null; resolve(action); },
    };
    dlog(`prompt seat=${seatIdx} seq=${seq} kind=${prompt.kind}`);
    // timeoutMs: クライアントが残り秒数を表示するために送る
    sendTo(seat, { t: "prompt", seq, timeoutMs, ...prompt });
  });
}

function humanAlive(room) {
  return room.seats.some(s => !s.isCpu && s.connected);
}
// 再接続を待つ価値がある席が残っているか (切断直後の人間席)
function reconnectPending(room) {
  const now = Date.now();
  return room.seats.some(s => !s.isCpu && !s.connected && s.disconnectedAt && now - s.disconnectedAt < RECONNECT_WINDOW);
}
// 誰も戻ってこないまま時間が過ぎたら部屋を片付ける
function scheduleAbandonCheck(room) {
  clearTimeout(room.abandonTimer);
  room.abandonTimer = setTimeout(() => {
    if (room.state === "done") return;
    if (humanAlive(room) || reconnectPending(room)) { scheduleAbandonCheck(room); return; }
    dlog(`room ${room.code}: 誰も戻らないため解散`);
    room.aborted = true;
    rooms.delete(room.code);
  }, RECONNECT_WINDOW + 5_000);
}

// ---- 並べてあがる方式 (人間のみ) ----
function sameMultiset(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  const m = new Map();
  for (const c of a) m.set(c, (m.get(c) || 0) + 1);
  for (const c of b) {
    const v = (m.get(c) || 0) - 1;
    if (v < 0) return false;
    if (v === 0) m.delete(c); else m.set(c, v);
  }
  return m.size === 0;
}
// クライアントが送ってきた並びが現在の手牌と一致すればそれを、
// 一致しなければ手牌そのままの順を使う (古い並びで誤判定しないため)
function seatArrangement(g, room, p) {
  const arr = room.seats[p].arrangement;
  return (arr && sameMultiset(arr, g.hands[p])) ? arr : g.hands[p];
}
// act に添えられた並びを検証して採用する
function actArrangement(g, p, action) {
  const arr = action?.arrangement;
  if (Array.isArray(arr) && arr.every(x => typeof x === "string" && x.length === 1) && sameMultiset(arr, g.hands[p])) {
    return arr;
  }
  return null;
}

function resultPayload(room) {
  const g = room.game;
  const r = g.roundResult;
  if (r.type === "draw") return { type: "draw" };
  return {
    type: r.type,
    winner: r.winner,
    winnerName: g.players[r.winner].name,
    loserName: r.type === "ron" ? g.players[r.loser].name : null,
    decomp: r.decomp, melds: g.melds[r.winner], score: r.score,
  };
}

const DEBUG = process.env.HJ_DEBUG !== "0"; // 既定でON (抑止は HJ_DEBUG=0)
const dlog = (...a) => { if (DEBUG) console.log(new Date().toISOString().slice(11, 23), ...a); };

async function runGame(room, rounds) {
  dlog(`runGame start room=${room.code} rounds=${rounds} seats=${room.seats.map(s => s.name).join(",")}`);
  room.state = "playing";
  const players = room.seats.map(s => ({
    name: s.name, isHuman: !s.isCpu,
    dict: s.isCpu ? s.cpuDict : undefined,
  }));
  const g = new Game({ players, dict, rounds });
  room.game = g;

  while (!room.aborted) {
    g.startRound();
    dlog(`startRound round=${g.round}/${g.totalRounds} wall=${g.wall.length}`);
    broadcastState(room);
    await playRound(room);
    if (room.aborted) break;
    const isLast = g.phase === Phase.GAME_END;
    const result = resultPayload(room);
    broadcast(room, { t: "roundEnd", result, isLast });
    await waitReady(room, 12_000);
    if (isLast) break;
  }
  if (room.aborted) return;

  // 最終結果
  const g2 = room.game;
  const order = g2.players.map((p, idx) => ({ name: p.name, score: p.score, idx }))
    .sort((a, b) => b.score - a.score);
  room.seats.forEach((s, i) => {
    if (!s.isCpu) sendTo(s, { t: "gameEnd", standings: order, lastResult: resultPayload(room), youIdx: i, rank: !!room.isRank });
  });
  if (room.isRank) {
    // ランク戦ルームは使い捨て
    room.state = "done";
    room.game = null;
    rooms.delete(room.code);
    return;
  }
  // ロビーへ戻す (切断者のCPU化座席は残す)
  room.state = "lobby";
  room.game = null;
  await sleep(300);
  broadcastLobby(room);
}

// ================= ランク戦マッチング =================
const rankQueue = []; // {ws, st, name, rank, timer}
const RANK_WAIT_MS = 10_000;
const RANK_ROUNDS = 2;

function queueBroadcast() {
  for (const q of rankQueue) {
    if (q.ws.readyState === 1) q.ws.send(JSON.stringify({ t: "rankSearching", queued: rankQueue.length }));
  }
}
function removeFromRankQueue(ws) {
  const i = rankQueue.findIndex(q => q.ws === ws);
  if (i >= 0) {
    clearTimeout(rankQueue[i].timer);
    rankQueue.splice(i, 1);
    queueBroadcast();
  }
}
function startRankMatch() {
  const entries = rankQueue.splice(0, 4);
  if (entries.length === 0) return;
  for (const q of entries) clearTimeout(q.timer);
  const room = makeRoom();
  if (!room) {
    for (const q of entries) { if (q.ws.readyState === 1) q.ws.send(JSON.stringify({ t: "error", msg: "マッチングに失敗しました" })); }
    return;
  }
  room.isRank = true;
  for (const q of entries) {
    const seat = { name: q.name, icon: q.icon, token: q.token, ws: q.ws, isCpu: false, connected: true, pending: null, onReady: null };
    room.seats.push(seat);
    q.st.room = room;
    q.st.seat = seat;
  }
  // CPU補充: 参加者の平均ランクに合わせた語彙力
  const avgIdx = Math.round(
    entries.reduce((s, q) => s + Math.max(0, RANKS.indexOf(q.rank)), 0) / entries.length
  );
  const cpuWords = CPU_WORDS_BY_RANK[RANKS[avgIdx]] ?? 1300;
  const used = new Set(room.seats.map(s => s.name));
  while (room.seats.length < 4) {
    const name = CPU_POOL.find(n => !used.has(n)) || `CPU${room.seats.length}`;
    used.add(name);
    room.seats.push({ name, icon: CPU_ICONS[name] || "🤖", ws: null, isCpu: true, connected: true, cpuDict: subsetDictByCount(dict, cpuWords), pending: null, onReady: null });
  }
  dlog(`rank match: ${room.seats.map(s => s.name).join(",")} cpuWords=${cpuWords}`);
  for (const s of room.seats) {
    if (!s.isCpu) sendTo(s, { t: "rankMatched", players: room.seats.map(x => x.name) });
  }
  runGame(room, RANK_ROUNDS).catch(err => {
    console.error("rank game error:", err);
    broadcast(room, { t: "error", msg: "サーバエラーで対局を中断しました" });
    rooms.delete(room.code);
  });
}

function waitReady(room, timeoutMs) {
  const humans = room.seats.filter(s => !s.isCpu && s.connected);
  if (humans.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const readySet = new Set();
    const timer = setTimeout(finish, timeoutMs);
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const h of humans) h.onReady = null;
      resolve();
    }
    for (const h of humans) {
      h.onReady = () => {
        readySet.add(h);
        if (readySet.size >= room.seats.filter(s => !s.isCpu && s.connected).length) finish();
      };
    }
  });
}

async function playRound(room) {
  const g = room.game;
  while (!room.aborted) {
    if (g.phase === Phase.ROUND_END || g.phase === Phase.GAME_END) return;
    if (g.phase === Phase.DRAW) {
      const t = g.drawTile();
      if (t === null) { broadcast(room, { t: "banner", text: "流局" }); return; }
      dlog(`draw p=${g.turn} wall=${g.wall.length}`);
      broadcastState(room);
    }
    await discardPhase(room);
    if (g.roundResult || room.aborted) return;
    await claimsPhase(room);
    if (g.roundResult || room.aborted) return;
  }
}

async function discardPhase(room) {
  const g = room.game;
  const p = g.turn;
  const seat = room.seats[p];
  while (!room.aborted) {
    const isCpuTurn = seat.isCpu || !seat.connected;
    const fullSize = g.hands[p].length === g.fullHandSize(p);
    // CPUは辞書探索、人間は「並べてあがる」方式 (送られた並びで判定)
    const canT = fullSize && (isCpuTurn
      ? g.canTsumo(p)
      : checkArrangedWin(seatArrangement(g, room, p), g.need3(p), dict));
    const kans = g.wall.length > 0 ? g.canKan(p) : [];

    let action;
    if (isCpuTurn) {
      await sleep(700);
      if (canT) action = { type: "tsumo" };
      else if (kans.length > 0 && shouldKan(g.wall.length)) action = { type: "kan", word: kans[0] };
      else action = { type: "discard", idx: chooseDiscard(g.hands[p], g.need3(p), g.dictFor(p)) };
    } else {
      action = await askSeat(room, p, { kind: "turn", canTsumo: !!canT, kanWords: kans }, TURN_TIMEOUT);
      if (!action) { // 時間切れ → 自動で捨てる
        action = { type: "discard", idx: chooseDiscard(g.hands[p], g.need3(p), dict) };
        sendTo(seat, { t: "banner", text: "時間切れ", who: null });
      }
    }

    if (action.type === "tsumo" && fullSize) {
      // 人間: actに添えられた並びを最優先で再検証 (サーバ権威)
      const decomp = isCpuTurn
        ? (canT || null)
        : checkArrangedWin(actArrangement(g, p, action) || seatArrangement(g, room, p), g.need3(p), dict);
      if (decomp) {
        broadcast(room, { t: "banner", text: "ツモ!", who: g.players[p].name });
        await sleep(900);
        g.winByTsumo(p, decomp);
        broadcastState(room);
        return;
      }
      continue; // 並びが成立していない → 捨て直しを要求
    }
    if (action.type === "kan" && kans.includes(action.word)) {
      broadcast(room, { t: "banner", text: "カン!", who: g.players[p].name });
      await sleep(900);
      const rep = g.declareKan(p, action.word);
      broadcastState(room);
      if (rep === null) { broadcast(room, { t: "banner", text: "流局" }); return; }
      continue;
    }
    if (action.type === "discard") {
      const idx = Math.floor(action.idx);
      if (idx >= 0 && idx < g.hands[p].length) {
        g.discard(idx);
        broadcastState(room);
        return;
      }
    }
    // 不正な操作は捨て直しを要求 (ループ継続)
  }
}

async function claimsPhase(room) {
  const g = room.game;
  const { tile, from } = g.lastDiscard;
  const order = [];
  for (let k = 1; k < g.n; k++) order.push((from + k) % g.n);

  // ロン (優先)
  for (const p of order) {
    if (room.aborted) return;
    const seat = room.seats[p];
    const isCpuSeat = seat.isCpu || !seat.connected;
    // CPUは辞書探索、人間は「あと1枚の形に並べてある」ときだけ
    let decomp = isCpuSeat
      ? g.canRon(p, tile)
      : checkArrangedRon(seatArrangement(g, room, p), tile, g.need3(p), dict);
    if (!decomp) continue;
    let take = true;
    if (!isCpuSeat) {
      const act = await askSeat(room, p, { kind: "claim", ron: true, ponWords: [] }, CLAIM_TIMEOUT);
      take = act?.type === "ron";
      if (take) {
        // actの並びで再検証 (捨て牌を含まない13枚の並びが期待値)
        const actArr = actArrangement(g, p, act);
        decomp = checkArrangedRon(actArr || seatArrangement(g, room, p), tile, g.need3(p), dict);
        if (!decomp) take = false;
      }
    }
    if (take) {
      broadcast(room, { t: "banner", text: "ロン!", who: g.players[p].name });
      await sleep(900);
      g.winByRon(p, isCpuSeat ? null : decomp);
      broadcastState(room);
      return;
    }
  }
  // ポン
  for (const p of order) {
    if (room.aborted) return;
    const words = g.canPon(p, tile);
    if (words.length === 0) continue;
    const seat = room.seats[p];
    let word = null;
    if (seat.isCpu || !seat.connected) {
      word = words.find(w => shouldPon(g.hands[p], g.need3(p), w, tile, g.dictFor(p))) || null;
    } else {
      const act = await askSeat(room, p, { kind: "claim", ron: false, ponWords: words }, CLAIM_TIMEOUT);
      if (act?.type === "pon" && words.includes(act.word)) word = act.word;
    }
    if (word) {
      dlog(`pon p=${p} word=${word}`);
      broadcast(room, { t: "banner", text: "ポン!", who: g.players[p].name });
      await sleep(900);
      g.claimPon(p, word);
      broadcastState(room);
      return;
    }
  }
  g.passClaims();
}

// ================= WebSocket =================
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (ws) => {
  const st = { room: null, seat: null };

  const leave = () => {
    removeFromRankQueue(ws);
    const { room, seat } = st;
    st.room = null; st.seat = null;
    if (!room || !seat) return;
    if (room.state === "done") return; // ランク戦終了後の切断は何もしない
    seat.connected = false;
    seat.ws = null;
    if (room.state === "lobby") {
      room.seats = room.seats.filter(s => s !== seat);
      // CPUだけが残ったら解散
      if (!room.seats.some(s => !s.isCpu)) { rooms.delete(room.code); }
      else broadcastLobby(room);
    } else {
      // 対局中: 席は残したままCPUが代打ちし、しばらく再接続を待つ
      // (isCpu は false のまま。discardPhase等は !seat.connected でCPU扱いする)
      seat.disconnectedAt = Date.now();
      seat.cpuDict = seat.cpuDict || subsetDictByCount(dict, 1300);
      seat.pending?.resolve(null);
      dlog(`room ${room.code}: ${seat.name} 切断 → CPU代打ち (再接続待ち)`);
      scheduleAbandonCheck(room);
      broadcastState(room);
    }
  };

  ws.on("close", leave);
  ws.on("error", () => { /* closeが続く */ });

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString().slice(0, 4096)); } catch { return; }

    if (msg.t === "create" && !st.room) {
      const r = makeRoom();
      if (!r) { ws.send(JSON.stringify({ t: "error", msg: "ルームを作れませんでした" })); return; }
      st.room = r;
      st.seat = { name: cleanName(msg.name), icon: cleanIcon(msg.icon), token: cleanToken(msg.token), ws, isCpu: false, connected: true, pending: null, onReady: null };
      r.seats.push(st.seat);
      broadcastLobby(r);
      return;
    }
    if (msg.t === "join" && !st.room) {
      const r = rooms.get(String(msg.code || "").toUpperCase());
      if (!r) { ws.send(JSON.stringify({ t: "error", msg: "そのコードのルームがありません" })); return; }
      if (r.state !== "lobby") { ws.send(JSON.stringify({ t: "error", msg: "対局中のルームです" })); return; }
      if (r.seats.length >= 4) { ws.send(JSON.stringify({ t: "error", msg: "ルームが満員です(4人まで)" })); return; }
      st.room = r;
      st.seat = { name: cleanName(msg.name), icon: cleanIcon(msg.icon), token: cleanToken(msg.token), ws, isCpu: false, connected: true, pending: null, onReady: null };
      r.seats.push(st.seat);
      broadcastLobby(r);
      return;
    }
    // 再接続: 切断中の自分の席に戻る
    if (msg.t === "resume" && !st.room) {
      const found = findResumable(cleanToken(msg.token));
      if (!found) { ws.send(JSON.stringify({ t: "resumeFailed" })); return; }
      found.seat.ws = ws;
      found.seat.connected = true;
      found.seat.disconnectedAt = null;
      st.room = found.room;
      st.seat = found.seat;
      dlog(`room ${found.room.code}: ${found.seat.name} 再接続`);
      sendTo(found.seat, { t: "resumed", view: viewFor(found.room, found.idx) });
      broadcastState(found.room);
      return;
    }
    // ランク戦マッチング
    if (msg.t === "rankJoin" && !st.room && !rankQueue.some(q => q.ws === ws)) {
      const entry = {
        ws, st,
        name: cleanName(msg.name),
        icon: cleanIcon(msg.icon),
        token: cleanToken(msg.token),
        rank: RANKS.includes(msg.rank) ? msg.rank : "G",
      };
      entry.timer = setTimeout(() => {
        if (rankQueue.includes(entry)) startRankMatch();
      }, RANK_WAIT_MS);
      rankQueue.push(entry);
      if (rankQueue.length >= 4) startRankMatch();
      else queueBroadcast();
      return;
    }
    if (msg.t === "rankCancel") {
      removeFromRankQueue(ws);
      return;
    }

    const { room, seat } = st;
    if (!room || !seat) return;

    const isHost = room.seats.indexOf(seat) === hostIdx(room);
    if (msg.t === "addCpu" && isHost && room.state === "lobby") {
      if (room.seats.length >= 4) return;
      const used = new Set(room.seats.map(s => s.name));
      const name = CPU_POOL.find(n => !used.has(n)) || "CPU";
      room.seats.push({ name, icon: CPU_ICONS[name] || "🤖", ws: null, isCpu: true, connected: true, cpuDict: subsetDictByCount(dict, 1300), pending: null, onReady: null });
      broadcastLobby(room);
      return;
    }
    if (msg.t === "start" && isHost && room.state === "lobby") {
      if (room.seats.length < 2) { sendTo(seat, { t: "error", msg: "2人以上で開始できます" }); return; }
      const rounds = [1, 2, 4].includes(msg.rounds) ? msg.rounds : 2;
      runGame(room, rounds).catch(err => {
        console.error("game error:", err);
        broadcast(room, { t: "error", msg: "サーバエラーで対局を中断しました" });
        room.state = "lobby"; room.game = null;
        broadcastLobby(room);
      });
      return;
    }
    // 手牌の並び (並べてあがる方式の判定材料)。マルチセット検証は使用時に行う。
    if (msg.t === "arrange" && room.state === "playing") {
      const tiles = msg.tiles;
      if (Array.isArray(tiles) && tiles.length <= 20 && tiles.every(x => typeof x === "string" && x.length === 1)) {
        seat.arrangement = tiles;
      }
      return;
    }
    if (msg.t === "act" && seat.pending && msg.seq === seat.pending.seq) {
      seat.pending.resolve(msg.action && typeof msg.action === "object" ? msg.action : null);
      return;
    }
    if (msg.t === "ready") {
      seat.onReady?.();
      return;
    }
  });
});

httpServer.listen(port, () => console.log(`hiragana-mahjong server on http://localhost:${port}`));
