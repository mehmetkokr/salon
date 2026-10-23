import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadScripts } from './load.mjs';

const R = loadScripts('tavla_rules.js');
const W = 0;
const B = 1;

/** Boş tahta + verilen pullar: {hane: sayı} (+ beyaz, − siyah). */
function board(points, bar = [0, 0], off = [0, 0]) {
  const p = Array(26).fill(0);
  for (const [k, v] of Object.entries(points)) p[Number(k)] = v;
  return { points: p, bar, off };
}
const moves = (steps) => steps.map((m) => `${m.from}>${m.to}`).sort();

test('başlangıç dizilişi: 15er pul', () => {
  const b = R.initialBoard();
  const white = b.points.filter((x) => x > 0).reduce((a, x) => a + x, 0);
  const black = -b.points.filter((x) => x < 0).reduce((a, x) => a + x, 0);
  assert.equal(white, 15);
  assert.equal(black, 15);
  assert.equal(R.pipCount(b, W), 167);
  assert.equal(R.pipCount(b, B), 167);
});

test('kapalı haneye oynanmaz, tek pul kırılır', () => {
  const b = board({ 10: 1, 7: -2, 8: -1 });
  assert.deepEqual(moves(R.legalSteps(b, W, [3, 2], [3, 2])), ['10>8']);
  const after = R.applySingle(b, W, { from: 10, to: 8, die: 2 });
  assert.equal(after.bar[B], 1);
  assert.equal(after.points[8], 1);
});

test('kırık pul önce girer', () => {
  const b = board({ 24: -2, 13: 2 }, [1, 0]);
  // beyaz 6 atarsa 19'a, 1 atarsa 24'e (kapalı) girer
  const steps = R.legalSteps(b, W, [6, 1], [6, 1]);
  assert.ok(steps.every((m) => m.from === 'bar'));
  assert.deepEqual(moves(steps), ['bar>19']);
});

test('zarlar mümkün olduğunca çok kullanılmalı', () => {
  // Beyaz 5'ten 1 ile 4'e gidebilir ama sonra 6 oynanamaz; 6 ile önce oynamak iki zarı da kullandırır.
  const b = board({ 13: 1, 12: -2 });
  // 13>12 kapalı (1), 13>7 (6) sonra 7>6 (1): iki zar kullanılır
  const seqs = R.legalSequences(b, W, [6, 1]);
  assert.ok(seqs.every((s) => s.length === 2));
  assert.deepEqual(moves(R.legalSteps(b, W, [6, 1], [6, 1])), ['13>7']);
});

test('tek zar oynanabiliyorsa büyüğü zorunlu', () => {
  // Beyaz 12'den 6 ile 6'ya ya da 5 ile 7'ye gidebilir; ikinci zar (1'e) kapalı.
  const b = board({ 12: 1, 1: -2 });
  assert.deepEqual(moves(R.legalSteps(b, W, [6, 5], [6, 5])), ['12>6']);
});

test('çift gelirse dört hamle', () => {
  const b = R.initialBoard();
  const seqs = R.legalSequences(b, W, [3, 3]);
  assert.ok(seqs.length > 5);
  assert.ok(seqs.every((s) => s.length === 4));
});

test('toplama: hepsi evdeyken; büyük zarla en uzaktaki toplanır', () => {
  const b = board({ 5: 2, 3: 1 });
  const steps = R.legalSteps(b, W, [6, 5], [6, 5]);
  assert.deepEqual(steps.map((m) => `${m.from}>${m.to}:${m.die}`).sort(), ['5>off:5', '5>off:6']);
  const notHome = board({ 7: 1, 3: 1 });
  assert.ok(R.singleMoves(notHome, W, 3).every((m) => m.to !== 'off'), 'evde olmayan pul varken toplanmaz');
});

test('oyun sonu: mars 2 puan', () => {
  const b = board({}, [0, 0], [15, 0]);
  assert.deepEqual({ ...R.gameResult(b) }, { winner: 0, points: 2, mars: true });
  const b2 = board({ 20: -14 }, [0, 0], [15, 1]);
  assert.equal(R.gameResult(b2).points, 1);
});

test('adil zar: tohumdan tekrar üretilebilir ve dağılımı düzgün', () => {
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const seed = 'deneme-tohum';
  assert.deepEqual(R.diceFromSeed(sha, seed, 7), R.diceFromSeed(sha, seed, 7));
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (let n = 0; n < 6000; n++) for (const d of R.diceFromSeed(sha, seed, n)) counts[d]++;
  for (let d = 1; d <= 6; d++) assert.ok(Math.abs(counts[d] - 2000) < 200, `zar ${d}: ${counts[d]}`);
});

test('bot geçerli bir dizi seçer ve kırabildiğini kırar', () => {
  const b = board({ 13: 2, 10: -1, 1: -14 });
  const seq = R.botSequence(b, W, [3, 1]);
  assert.equal(seq.length, 2);
  let after = b;
  for (const m of seq) after = R.applySingle(after, W, m);
  assert.equal(after.bar[B], 1, 'açık pulu kırar');
});
