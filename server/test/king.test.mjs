import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './load.mjs';
import { setup } from './table_harness.mjs';

const R = loadScripts('cards.js', 'table_kit.js', 'batak.js', 'king.js');
const c = (suit, rank) => suit * 13 + (rank - 2); // 0 maça, 1 kupa, 2 karo, 3 sinek

function play(contract, { hands, trick = [], trump = -1, broken = false, turn = 0 }) {
  return { stage: 'play', contract, hands, trick, trump, broken, turn, turnSerial: 0, taken: [[], [], [], []], tricks: [0, 0, 0, 0] };
}
const legal = (s) => [...R.kingLegal(s, s.turn)].sort((a, b) => a - b);

test('renge uymak zorunlu; cezada renk yoksa serbest', () => {
  const s = play('kiz', { turn: 1, hands: [[], [c(1, 5), c(1, 12), c(2, 3)], [], []], trick: [{ seat: 0, card: c(1, 9) }] });
  assert.deepEqual(legal(s), [c(1, 5), c(1, 12)]);
  const v = play('kiz', { turn: 1, hands: [[], [c(0, 12), c(2, 3)], [], []], trick: [{ seat: 0, card: c(1, 9) }] });
  assert.equal(legal(v).length, 2);
});

test('kupa almaz ve rıfkıda kupa çıkmadan kupayla açılmaz; rıfkıda papaz zorunlu', () => {
  const s = play('kupa', { hands: [[c(1, 2), c(0, 3)], [], [], []] });
  assert.deepEqual(legal(s), [c(0, 3)]);
  const r = play('rifki', { turn: 1, hands: [[], [c(1, 13), c(2, 3)], [], []], trick: [{ seat: 0, card: c(0, 9) }] });
  assert.deepEqual(legal(r), [c(1, 13)]);
});

test('kozda renk yoksa koz zorunlu', () => {
  const s = play('koz', { trump: 3, turn: 1, hands: [[], [c(3, 2), c(2, 3)], [], []], trick: [{ seat: 0, card: c(0, 9) }] });
  assert.deepEqual(legal(s), [c(3, 2)]);
});

test('puanlar', () => {
  const base = { tricks: [3, 4, 3, 3], lastTwo: [1, 1, 0, 0], taken: [[c(1, 2), c(1, 13), c(0, 12)], [c(3, 11)], [], []] };
  assert.deepEqual([...R.kingHandPoints({ ...base, contract: 'el' })], [-150, -200, -150, -150]);
  assert.deepEqual([...R.kingHandPoints({ ...base, contract: 'kupa' })], [-60, 0, 0, 0]);
  assert.deepEqual([...R.kingHandPoints({ ...base, contract: 'erkek' })], [-60, -60, 0, 0]);
  assert.deepEqual([...R.kingHandPoints({ ...base, contract: 'kiz' })], [-100, 0, 0, 0]);
  assert.deepEqual([...R.kingHandPoints({ ...base, contract: 'rifki' })], [-320, 0, 0, 0]);
  assert.deepEqual([...R.kingHandPoints({ ...base, contract: 'soniki' })], [-180, -180, 0, 0]);
  assert.deepEqual([...R.kingHandPoints({ ...base, contract: 'koz' })], [150, 200, 150, 150]);
});

test('seçim hakları: 2 koz, 3 ceza, her ceza en fazla 2 kez', () => {
  const s = { kozUsed: [2, 0, 0, 0], cezaUsed: [1, 3, 0, 0], penaltyUsed: { el: 2, kupa: 0, erkek: 0, kiz: 1, rifki: 0, soniki: 0 } };
  assert.deepEqual([...R.kingAllowed(s, 0)], ['kupa', 'erkek', 'kiz', 'rifki', 'soniki']);
  assert.deepEqual([...R.kingAllowed(s, 1)], ['koz']);
});

test('king maçı: 20 oyun, her oyuncu 2 koz 3 ceza seçer, her ceza 2 kez', () => {
  const t = setup({ game: 'king', params: { bet: '500' } });
  t.join('u1');
  t.advance(8000);
  t.loop();
  assert.equal(t.state.phase, 'playing');
  assert.equal(t.lastStateFor('u1').g.hand.length, 13);
  let guard = 0;
  while (!(t.state.phase === 'finished' && t.state.gameOver) && guard++ < 100000) {
    if (t.state.phase === 'finished') {
      t.advance(6000);
      t.loop();
      continue;
    }
    t.advance(21000);
    t.loop();
  }
  assert.ok(t.state.gameOver, 'maç bitmeli');
  assert.equal(t.state.handNo, 20);
  assert.deepEqual([...t.state.kozUsed], [2, 2, 2, 2]);
  assert.deepEqual([...t.state.cezaUsed], [3, 3, 3, 3]);
  for (const k of ['el', 'kupa', 'erkek', 'kiz', 'rifki', 'soniki']) assert.equal(t.state.penaltyUsed[k], 2, k);
  const best = Math.max(...t.state.scores);
  assert.deepEqual(t.state.handResult.winners, [0, 1, 2, 3].filter((i) => t.state.scores[i] === best));
  const total = t.ledger.filter((l) => l.userId === 'u1').reduce((a, l) => a + l.amount, 0);
  assert.equal(total, t.state.handResult.payouts[0]);
});
