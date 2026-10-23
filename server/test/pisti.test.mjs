import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './load.mjs';
import { setup } from './table_harness.mjs';

const R = loadScripts('cards.js', 'table_kit.js', 'pisti.js');
const c = (suit, rank) => suit * 13 + (rank - 2); // 0 maça, 1 kupa, 2 karo, 3 sinek

/** Elle kurulmuş bir el: yer, eller, deste. */
function hand({ pile, hands, deck = [] }) {
  return {
    turn: 0,
    turnSerial: 0,
    scores: [0, 0],
    dealer: 1,
    pile,
    hiddenBase: 0,
    deck,
    hands,
    captured: [[], []],
    pistis: [[], []],
    lastTaker: -1,
    lastPlay: null,
    handResult: null,
  };
}

test('aynı sayı yeri alır, vale her zaman alır', () => {
  const s = hand({ pile: [c(0, 3), c(1, 9)], hands: [[c(2, 9), c(0, 5)], [c(1, 2)]] });
  assert.equal(R.pistiPlay(s, 0, c(2, 9)), null);
  assert.equal(s.pile.length, 0);
  assert.equal(s.captured[0].length, 3);
  assert.equal(s.lastPlay.pisti, 0, 'iki kartlı yerde pişti olmaz');

  const v = hand({ pile: [c(0, 3), c(1, 9)], hands: [[c(3, 11), c(0, 5)], [c(1, 2)]] });
  R.pistiPlay(v, 0, c(3, 11));
  assert.equal(v.captured[0].length, 3);
});

test('tek kartlı yerde aynı sayı pişti (10), vale valeye 20', () => {
  const s = hand({ pile: [c(1, 7)], hands: [[c(3, 7), c(0, 5)], [c(1, 2)]] });
  R.pistiPlay(s, 0, c(3, 7));
  assert.deepEqual([...s.pistis[0]], [10]);
  const j = hand({ pile: [c(1, 11)], hands: [[c(0, 11), c(0, 5)], [c(1, 2)]] });
  R.pistiPlay(j, 0, c(0, 11));
  assert.deepEqual([...j.pistis[0]], [20]);
  const n = hand({ pile: [c(1, 7)], hands: [[c(0, 11), c(0, 5)], [c(1, 2)]] });
  R.pistiPlay(n, 0, c(0, 11));
  assert.deepEqual([...n.pistis[0]], [], 'tek karta vale atmak pişti değil');
});

test('puanlama: çok kart 3, as/vale 1, sinek ikilisi 2, karo onlusu 3, piştiler', () => {
  const captured = [
    [c(0, 14), c(1, 11), c(3, 2), c(2, 10), c(0, 4), c(0, 5)],
    [c(1, 14), c(2, 3)],
  ];
  const [a, b] = R.pistiScore(captured, [[10], [20]]);
  assert.equal(a.total, 1 + 1 + 2 + 3 + 10 + 3);
  assert.equal(b.total, 1 + 20);
});

test('el sonunda yerde kalanlar son alana gider', () => {
  const s = hand({ pile: [c(1, 7)], hands: [[c(3, 7)], [c(2, 4)]] });
  R.pistiPlay(s, 0, c(3, 7)); // 0 alır
  R.pistiPlay(s, 1, c(2, 4)); // yere kalır, eller ve deste bitti
  assert.ok(s.handResult);
  assert.equal(s.captured[0].length, 3);
});

test('pişti masası: 2 kişi, 4er kart, 3 kapalı + 1 açık; maç 101 puana oynanır', () => {
  const t = setup({ game: 'pisti', params: { bet: '500' } });
  t.join('u1');
  t.advance(8000);
  t.loop();
  assert.equal(t.state.phase, 'playing');
  const v = t.lastStateFor('u1');
  assert.equal(v.g.hand.length, 4);
  assert.equal(v.g.pile.length, 1, 'yerde yalnızca üst kart açık');
  assert.equal(v.g.pileHidden, 3);
  assert.equal(v.g.deck, 40);
  assert.equal(v.g.oppCount, 4);

  let guard = 0;
  let hands = 0;
  while (!(t.state.phase === 'finished' && t.state.gameOver) && guard++ < 20000) {
    if (t.state.phase === 'finished') {
      hands++;
      const r = t.state.handResult;
      const cardTotal = r.breakdown[0].cards + r.breakdown[1].cards;
      assert.equal(cardTotal, 52, 'bütün kartlar dağıtılır ve toplanır');
      t.advance(6000);
      t.loop();
      continue;
    }
    t.advance(16000);
    t.loop();
  }
  assert.ok(t.state.gameOver);
  assert.ok(Math.max(...t.state.scores) >= 101);
  assert.ok(hands >= 2);
  const total = t.ledger.filter((l) => l.userId === 'u1').reduce((a, l) => a + l.amount, 0);
  assert.equal(total, t.state.handResult.payouts[0]);
});

test('sırası olmayan oyuncu kart atamaz', () => {
  const t = setup({ game: 'pisti', params: { bet: '500' } });
  t.join('u1');
  t.advance(8000);
  t.loop();
  if (t.state.turn === 0) {
    t.advance(16000);
    t.loop(); // sıra bota geçsin
  }
  if (t.state.turn === 1) {
    t.loop([{ from: 'u1', op: 2, body: { card: t.state.hands[0][0] } }]);
    assert.equal(t.sent.filter((m) => m.op === 9).pop().data.msg, 'Sıra sende değil');
  }
});
