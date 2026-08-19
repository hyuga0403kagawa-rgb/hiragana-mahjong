// エンジン単体テスト: node tools/test_engine.mjs
import {
  buildTileSet, Dict, findWin, findWaits, ponOptions, kanOptions,
  scoreWin, Game, Phase, counts, checkArrangedWin, checkArrangedRon, bestSegmentation,
} from "../src/engine.js";
import { chooseDiscard, evaluateHand, shouldPon } from "../src/ai.js";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`FAIL - ${name}`); }
}

// ---- 牌セット ----
const tiles = buildTileSet();
ok(tiles.length === 120, "牌は120枚");
const c = counts(tiles);
ok(c.get("あ") === 2 && c.get("ん") === 2, "清音は各2枚");
ok(c.get("が") === 1 && c.get("ぱ") === 1 && c.get("っ") === 1 && c.get("ー") === 1, "レア牌は各1枚");
ok(!c.has("を"), "「を」は無い");

// ---- テスト用ミニ辞書 ----
const dict = new Dict(
  ["うみ", "あき", "かに", "はな"],
  ["さくら", "みかん", "たいこ", "すいか", "きって", "らいおん".slice(0, 3) /*らいお は語でないので除外用*/, "ばなな", "つくえ"].filter(w => w.length === 3),
  ["らーめん", "しゃしん", "ひまわり"],
);

// ---- 上がり判定 ----
// 2文字: うみ / 3文字: さくら みかん たいこ すいか
const winHand = [..."うみさくらみかんたいこすいか"];
ok(winHand.length === 14, "テスト手牌は14枚");
const d1 = findWin(winHand, 4, dict);
ok(!!d1, "14枚が 2+3x4 に分解できる");
ok(d1 && d1.two === "うみ" && d1.threes.length === 4, "分解結果の形が正しい");

const noWin = [..."うみさくらみかんたいこすいあ"]; // すいか→すいあ で崩す
ok(findWin(noWin, 4, dict) === null, "崩れた手牌は上がれない");

// 鳴きあり: 3文字語2つ分は鳴き済み → 手牌8枚 (2 + 3x2)
const winHand2 = [..."うみさくらみかん"];
ok(!!findWin(winHand2, 2, dict), "鳴き2つの場合は8枚で上がり");

// 同語2回使用 (みかん×2): み2 か2 ん2 は牌数的に可能
const dup = findWin([..."うみみかんみかんさくらたいこ"], 4, dict);
ok(!!dup, "同じ語を2回使う上がりも可");

// ---- 並べてあがる方式 ----
// 正しい並び: うみ|さくら|みかん|たいこ|すいか
ok(!!checkArrangedWin([..."うみさくらみかんたいこすいか"], 4, dict), "正しい並びは成立");
// 2文字語が末尾でも成立
ok(!!checkArrangedWin([..."さくらみかんたいこすいかうみ"], 4, dict), "2文字語が末尾でも成立");
// 2文字語が中間でも成立
ok(!!checkArrangedWin([..."さくらみかんうみたいこすいか"], 4, dict), "2文字語が中間でも成立");
// 同じ14枚でも並びが崩れていたら不成立 (これが新ルールの核心)
ok(checkArrangedWin([..."みうさくらみかんたいこすいか"], 4, dict) === null, "同じ牌でも並びが崩れると不成立");
ok(checkArrangedWin([..."うみさくらみかんたいこすかい"], 4, dict) === null, "語内の順序が違っても不成立");
// findWinなら通る手 (自動検出との差)
ok(!!findWin([..."みうさくらみかんたいこすいか"], 4, dict), "参考: 探索なら同じ牌で成立する");
// 鳴きあり (need3=2, 8枚)
ok(!!checkArrangedWin([..."うみさくらみかん"], 2, dict), "鳴き2つでは8枚の並びで成立");
ok(checkArrangedWin([..."うみさくらみかんた"], 2, dict) === null, "枚数が合わないと不成立");
// 分解結果が並びと一致する
const ad = checkArrangedWin([..."さくらうみみかんたいこすいか"], 4, dict);
ok(ad && ad.two === "うみ" && ad.threes[0] === "さくら", "分解結果が並び通り");

// ロン: 「すいか」の「か」待ちに並べておく
const ronArr = [..."うみさくらみかんたいこすい"];
ok(!!checkArrangedRon(ronArr, "か", 4, dict), "差し込みロン成立 (末尾)");
const ronArr2 = [..."うみさくらみかんたいこすい"];
ok(checkArrangedRon(ronArr2, "ぬ", 4, dict) === null, "無関係な牌ではロンできない");
// 崩れた並びではテンパイでもロン不可
ok(checkArrangedRon([..."みうさくらみかんたいこすい"], "か", 4, dict) === null, "並べていないとロンできない");
// 語の中間への差し込み (すか に い を差し込む)
ok(!!checkArrangedRon([..."うみさくらみかんたいこすか"], "い", 4, dict), "語の中間への差し込みも成立");

// winByTsumo に検証済み分解を渡せる
{
  const g0 = new Game({ players: [{name:"a",isHuman:true},{name:"b"},{name:"c"},{name:"d"}], dict, rounds: 1, seed: 3 });
  g0.startRound();
  g0.hands[0] = [..."うみさくらみかんたいこすいか"];
  const d0 = checkArrangedWin(g0.hands[0], 4, dict);
  g0.winByTsumo(0, d0);
  ok(g0.roundResult.decomp === d0, "winByTsumoが渡した分解を使う");
}

// ---- ブロック可視化 ----
{
  // 完全に並んだ14枚 → 5ブロックすべて成立
  const seg = bestSegmentation([..."うみさくらみかんたいこすいか"], 4, dict);
  ok(seg && seg.blocks.length === 5 && seg.validCount === 5, "完成形は5ブロックすべて成立");
  ok(seg.blocks[0].word === "うみ" && seg.blocks[0].len === 2, "先頭が2文字ブロック");
  ok(seg.blocks[1].word === "さくら" && seg.blocks[1].start === 2, "位置情報が正しい");
  // 2文字語が中間でも最良の区切りを見つける
  const seg2 = bestSegmentation([..."さくらうみみかんたいこすいか"], 4, dict);
  ok(seg2 && seg2.validCount === 5, "2文字語が中間でも5ブロック成立と判定");
  // 部分的に並んでいる: さくら だけ成立
  const seg3 = bestSegmentation([..."さくらぬぬぬぬぬぬぬぬぬぬぬ"], 4, dict);
  ok(seg3 && seg3.validCount === 1 && seg3.blocks[0].word === "さくら", "部分的な完成も検出");
  // ブロックの合計が必ず手牌長と一致
  ok(seg3.blocks.reduce((s, b) => s + b.len, 0) === 14, "ブロック長の合計が手牌長と一致");
  // 13枚 (1枚不足) でも区切れる
  const seg4 = bestSegmentation([..."うみさくらみかんたいこすい"], 4, dict);
  ok(seg4 && seg4.blocks.length === 5, "13枚でも5ブロックに区切る");
  ok(seg4.blocks.some(b => b.short) && seg4.blocks.reduce((s, b) => s + b.len, 0) === 13, "1ブロックだけ不足扱い");
  ok(seg4.validCount === 4, "13枚では完成4ブロックを検出");
  // 対象外の枚数
  ok(bestSegmentation([..."うみ"], 4, dict) === null, "枚数が合わないとnull");
  // 鳴きあり (need3=2 → 8枚)
  const seg5 = bestSegmentation([..."うみさくらみかん"], 2, dict);
  ok(seg5 && seg5.blocks.length === 3 && seg5.validCount === 3, "鳴き2つでは3ブロック");
}

// ---- 待ち ----
const tenpai = [..."うみさくらみかんたいこすい"]; // 「か」待ち
const waits = findWaits(tenpai, 4, dict);
ok(waits.includes("か"), "待ち牌に「か」が含まれる");

// ---- ポン ----
const ponRes = ponOptions([..."さく"], "ら", dict);
ok(ponRes.includes("さくら"), "捨て「ら」+手牌さ,くでポン(さくら)");
const ponRes2 = ponOptions([..."ばな"], "な", dict);
ok(ponRes2.includes("ばなな"), "ばなな: 捨て「な」+手牌ば,なでポン");
ok(ponOptions([..."さん"], "ら", dict).length === 0, "揃わない場合はポン不可");

// ---- カン ----
ok(kanOptions([..."らーめんあい"], dict).includes("らーめん"), "手牌にらーめん4枚でカン可");
ok(kanOptions([..."らめんあい"], dict).length === 0, "牌不足でカン不可");

// ---- 得点 ----
const sc1 = scoreWin({ two: "うみ", threes: ["さくら", "みかん", "たいこ", "すいか"] }, []);
ok(sc1.total === 8, "レア牌なし=基本8点");
const sc2 = scoreWin({ two: "うみ", threes: ["ばなな", "みかん", "たいこ"] }, [{ type: "kan", word: "らーめん" }]);
// ば+2, ー+2, カン+2 → 8+6=14
ok(sc2.total === 14, `レア2+カン1で14点 (実際:${sc2.total})`);

// ---- ゲーム進行 ----
const players = [
  { name: "あなた", isHuman: true },
  { name: "CPU1", isHuman: false },
  { name: "CPU2", isHuman: false },
  { name: "CPU3", isHuman: false },
];
const g = new Game({ players, dict, rounds: 4, seed: 42 });
g.startRound();
ok(g.hands.every(h => h.length === 13), "全員13枚配牌");
ok(g.wall.length === 120 - 52, "山は68枚");
ok(g.phase === Phase.DRAW, "開始フェーズはDRAW");
const t = g.drawTile();
ok(g.hands[0].length === 14 && t != null, "ツモで14枚");
ok(g.phase === Phase.DISCARD, "ツモ後はDISCARD");
g.discard(0);
ok(g.hands[0].length === 13 && g.discards[0].length === 1, "捨てて13枚");
ok(g.phase === Phase.CLAIM, "捨て後はCLAIM");
g.passClaims();
ok(g.turn === 1 && g.phase === Phase.DRAW, "次の手番へ");

// 流局→次局
g.wall = [];
g.turn = 1;
const drawn = g.drawTile();
ok(drawn === null && g.phase === Phase.ROUND_END, "山切れで流局");
g.startRound();
ok(g.round === 2 && g.dealer === 1, "2局目・親が移動");

// ロンのシミュレーション: プレイヤー1がテンパイ形、プレイヤー0が当たり牌を捨てる
g.hands[0] = [..."かあいうえおかきくけこさしす"];
g.hands[1] = [..."うみさくらみかんたいこすい"];
g.melds[1] = [];
g.turn = 0; g.phase = Phase.DISCARD;
g.hands[0].push("ん"); // 14枚に
const discardIdx = g.hands[0].indexOf("か");
g.discard(discardIdx);
const ron = g.canRon(1, g.lastDiscard.tile);
ok(!!ron, "捨てた「か」でロン判定が立つ");
const beforeScore = g.players[1].score;
g.winByRon(1);
ok(g.players[1].score > beforeScore, "ロンで加点");
ok(g.players[0].score < 0, "放銃者は減点");
ok(g.roundResult.type === "ron", "局結果がron");

// ---- ポンのゲーム内動作 ----
const g2 = new Game({ players, dict, rounds: 4, seed: 7 });
g2.startRound();
g2.hands[1] = [..."さくあいうえおかきくけこさ"];
g2.hands[0][13] = undefined; // not used
g2.turn = 0; g2.phase = Phase.DISCARD;
g2.hands[0] = [..."らあいうえおかきくけこさしすせ"];
g2.discard(0); // 「ら」を捨てる
const ponWords = g2.canPon(1, "ら");
ok(ponWords.includes("さくら"), "ゲーム内ポン判定");
g2.claimPon(1, "さくら");
ok(g2.melds[1].length === 1 && g2.melds[1][0].word === "さくら", "ポンで晒し");
ok(g2.hands[1].length === 11, "ポン後の手牌は11枚(13-2)");
ok(g2.turn === 1 && g2.phase === Phase.DISCARD, "ポン後は自分の捨て番");
ok(g2.discards[0].length === 0, "捨て牌が河から取られた");
ok(g2.need3(1) === 3, "必要3文字語が1減る");

// ---- カンのゲーム内動作 ----
const g3 = new Game({ players, dict, rounds: 4, seed: 9 });
g3.startRound();
g3.turn = 2; g3.phase = Phase.DISCARD;
g3.hands[2] = [..."らーめんあいうえおかきくけこ"];
const wallBefore = g3.wall.length;
const rep = g3.declareKan(2, "らーめん");
ok(rep != null, "カンで嶺上牌を補充");
ok(g3.hands[2].length === 11, "カン後の手牌は11枚(14-4+1)");
ok(g3.wall.length === wallBefore - 1, "山が1枚減る(末尾から)");
ok(g3.melds[2][0].type === "kan", "カンが晒される");

// ---- AI ----
const aiHand = [..."うみさくらみかんたいこすぬへ"];
ok(aiHand.length === 14, "AIテスト手牌14枚");
const idx = chooseDiscard(aiHand, 4, dict);
const discardedTile = aiHand[idx];
ok(["ぬ", "へ"].includes(discardedTile), `AIは不要牌を捨てる (実際:${discardedTile})`);
ok(evaluateHand(counts([..."うみさくらみかんたいこすいか"]), 4, dict) > evaluateHand(counts([..."ぬへちりぬるをわかよたれそつね".replace("を", "ん")]), 4, dict), "良形の評価が高い");
ok(shouldPon([..."さくうみみかんたいこすいかあ"], 4, "さくら", "ら", dict) === true, "有効なポンは鳴く");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
