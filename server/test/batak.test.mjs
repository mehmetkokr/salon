import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './load.mjs';
import { setup } from './table_harness.mjs';

const R = loadScripts('cards.js', 'table_kit.js', 'batak.js');
const c = (suit, rank) => suit * 13 + (rank - 2); // 0 maça, 1 kupa, 2 karo, 3 sinek

function play({ hands, trick = [], trump = 0, broken = false, turn = 0 }) {
  return {
    mode: 'ihaleli', stage: 'play', hands, trick, trump, trumpBroken: broken, turn, turnSerial: 0,
    tricks: [0, 0, 0, 0], scores: [0, 0, 0, 0], bids: [5, 'pas', 'pas', 'pas'], highBid: 5, declarer: 0, handNo: 1,
  };
}
const legal = (s, seat = s.turn) => [...R.batakLegal(s, seat)].sort((a, b) => a - b);

test('renge uymak ve yükseltmek zorunlu', () => {
  const s = play({ turn: 1, hands: [[], [c(1, 5), c(1, 12), c(2, 3)], [], []], trick: [{ seat: 0, card: c(1, 9) }] });
  assert.deepEqual(legal(s), [c(1, 12)], 'kupa 9 açıldı: kız ile yükseltmek zorunlu');
  const low = play({ turn: 1, hands: [[], [c(1, 5), c(2, 3)], [], []], trick: [{ seat: 0, card: c(1, 9) }] });
  assert.deepEqual(legal(low), [c(1, 5)], 'yükseltemiyorsa renge uyar');
});

test('renk yoksa koz zorunlu, kozlanmış ele daha büyük koz', () => {
  const s = play({ turn: 2, trump: 0, hands: [[], [], [c(0, 4), c(0, 12), c(2, 3)], []],
    trick: [{ seat: 0, card: c(1, 9) }, { seat: 1, card: c(0, 10) }] });
  assert.deepEqual(legal(s), [c(0, 12)]);
  const none = play({ turn: 2, trump: 0, hands: [[], [], [c(2, 3), c(3, 5)], []], trick: [{ seat: 0, card: c(1, 9) }] });
  assert.deepEqual(legal(none), [c(2, 3), c(3, 5)].sort((a, b) => a - b), 'koz da yoksa serbest');
});

test('koz çıkmadan kozla el açılmaz', () => {
  const s = play({ trump: 0, hands: [[c(0, 14), c(1, 3)], [], [], []] });
  assert.deepEqual(legal(s), [c(1, 3)]);
  const onlyTrump = play({ trump: 0, hands: [[c(0, 14), c(0, 3)], [], [], []] });
  assert.equal(legal(onlyTrump).length, 2);
});

test('eli koz ya da açılan rengin büyüğü alır', () => {
  const trick = [{ seat: 0, card: c(1, 9) }, { seat: 1, card: c(1, 14) }, { seat: 2, card: c(0, 2) }, { seat: 3, card: c(2, 14) }];
  assert.equal(R.batakTrickWinner(trick, 0).seat, 2);
  assert.equal(R.batakTrickWinner(trick, 3).seat, 1);
});

test('puanlama: ihale yapılırsa el kadar, yapılmazsa ihale kadar eksi; eşlide takım', () => {
  const s = { mode: 'ihaleli', tricks: [6, 3, 2, 2], declarer: 0, highBid: 7, bids: [] };
  assert.deepEqual([...R.batakHandPoints(s)], [-7, 3, 2, 2]);
  s.highBid = 5;
  assert.deepEqual([...R.batakHandPoints(s)], [6, 3, 2, 2]);
  const e = { mode: 'esli', tricks: [4, 3, 4, 2], declarer: 2, highBid: 8, bids: [] };
  assert.deepEqual([...R.batakHandPoints(e)], [8, 5, 8, 5]);
  const k = { mode: 'koz', tricks: [4, 3, 4, 2], bids: [3, 4, 4, 1] };
  assert.deepEqual([...R.batakHandPoints(k)], [4, -4, 4, 2]);
});

for (const mode of ['koz', 'ihaleli', 'esli']) {
  test(`batak masası (${mode}): 13'er kart, 5 el oynanır, en yüksek puan potu alır`, () => {
    const t = setup({ game: 'batak', params: { bet: '500', mode } });
    t.join('u1');
    t.advance(8000);
    t.loop();
    assert.equal(t.state.phase, 'playing');
    const v = t.lastStateFor('u1');
    assert.equal(v.g.hand.length, 13);
    assert.equal(v.mode, mode);
    let guard = 0;
    let hands = 0;
    while (!(t.state.phase === 'finished' && t.state.gameOver) && guard++ < 50000) {
      if (t.state.phase === 'finished') {
        hands++;
        const r = t.state.handResult;
        assert.equal(r.tricks.reduce((a, b) => a + b, 0), 13, 'her elde 13 el');
        t.advance(6000);
        t.loop();
        continue;
      }
      t.advance(21000);
      t.loop();
    }
    assert.ok(t.state.gameOver, 'oyun bitmeli');
    assert.equal(t.state.handNo, 5);
    const best = Math.max(...t.state.scores);
    assert.deepEqual(t.state.handResult.winners, [0, 1, 2, 3].filter((i) => t.state.scores[i] === best));
    if (mode === 'esli') assert.equal(t.state.scores[0], t.state.scores[2], 'takım puanı ortak');
    const total = t.ledger.filter((l) => l.userId === 'u1').reduce((a, l) => a + l.amount, 0);
    assert.equal(total, t.state.handResult.payouts[0]);
  });
}
