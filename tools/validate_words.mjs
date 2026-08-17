// src/data/words.js の検証: 文字種・長さ・牌枚数制約・重複・ソート順をチェック
import { WORDS2, WORDS3, WORDS4 } from '../src/data/words.js';

const SEION = new Set('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわん');
const RARE = new Set('がぎぐげございじずぜぞだぢづでどばびぶべぼぱぴぷぺぽゃゅょっー');

let errors = 0;
const fail = msg => { errors++; console.error('NG: ' + msg); };

for (const [name, arr, len] of [['WORDS2', WORDS2, 2], ['WORDS3', WORDS3, 3], ['WORDS4', WORDS4, 4]]) {
  const seen = new Set();
  for (const w of arr) {
    const chars = [...w];
    if (chars.length !== len) fail(`${name}: 「${w}」は${chars.length}文字(期待${len})`);
    const counts = {};
    for (const c of chars) {
      if (!SEION.has(c) && !RARE.has(c)) { fail(`${name}: 「${w}」に禁止文字「${c}」`); continue; }
      counts[c] = (counts[c] || 0) + 1;
      if (counts[c] > (SEION.has(c) ? 2 : 1)) fail(`${name}: 「${w}」で「${c}」が枚数超過`);
    }
    if (seen.has(w)) fail(`${name}: 「${w}」が重複`);
    seen.add(w);
  }
  for (let i = 1; i < arr.length; i++)
    if (arr[i - 1].localeCompare(arr[i], 'ja') > 0) fail(`${name}: ソート順違反「${arr[i - 1]}」>「${arr[i]}」`);
  console.log(`${name}: ${arr.length}語`);
}

if (errors) { console.error(`検証失敗: ${errors}件`); process.exit(1); }
console.log('検証OK: 全チェック通過');
