import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './table_harness.mjs';

const tt = (c, n, copy = 0) => c * 26 + copy * 13 + (n - 1);

/** 101 masasını kurar, sırayı insana verir ve elini verilen taşlarla değiştirir. */
function setup101(hand) {
  const t = setup({ params: { bet: '500', mode: '101' } });
  t.join('u1');
  t.advance(8000);
  t.loop();
  const s = t.state;
  s.okey = { c: 2, n: 5 }; // sarı 5
  s.turn = 0;
  s.stage = 'discard';
  s.seats[0].hand = hand;
  for (let i = 1; i < 4; i++) s.seats[i].hand = s.seats[i].hand.filter((id) => !hand.includes(id));
  return t;
}

const OPEN_HAND = [
  tt(3, 13), tt(1, 13), tt(0, 13), // 39
  tt(0, 10), tt(0, 11), tt(0, 12), // 33
  tt(1, 9), tt(1, 10), tt(1, 11), // 30
  tt(3, 1), tt(3, 2), tt(2, 9),
];
const OPEN_GROUPS = [OPEN_HAND.slice(0, 3), OPEN_HAND.slice(3, 6), OPEN_HAND.slice(6, 9)];
const lastNotice = (t) => t.sent.filter((m) => m.op === 9).pop()?.data.msg;

test('101: 22/21 dağıtım, 35 sn süre', () => {
  const t = setup({ params: { bet: '500', mode: '101' } });
  t.join('u1');
  t.advance(8000);
  t.loop();
  assert.deepEqual(t.state.seats.map((s) => s.hand.length).sort(), [21, 21, 21, 22]);
  assert.equal(t.state.stock.length, 20);
  assert.equal(t.lastStateFor('u1').turnMs, 35000);
});

test('101: 101 altı açılamaz, üstü açılır, açınca taş işlenir', () => {
  const t = setup101(OPEN_HAND);
  t.loop([{ from: 'u1', op: 7, body: { groups: [OPEN_GROUPS[2]] } }]);
  assert.match(lastNotice(t), /toplamı 30/);
  assert.equal(t.state.seats[0].opened, false);

  t.loop([{ from: 'u1', op: 7, body: { groups: OPEN_GROUPS } }]);
  assert.equal(t.state.seats[0].opened, true);
  assert.equal(t.state.melds.length, 3);
  assert.deepEqual([...t.state.seats[0].hand].sort(), [tt(3, 1), tt(3, 2), tt(2, 9)].sort());
  const view = t.lastStateFor('u1');
  assert.equal(view.o101.melds.length, 3);
  assert.equal(view.o101.opened[0], 1);

  t.state.seats[0].hand = t.state.seats[0].hand.concat([tt(2, 13)]);
  t.loop([{ from: 'u1', op: 8, body: { id: tt(2, 13), meld: 0 } }]);
  assert.equal(t.state.melds[0].size, 4);
});

test('101: işlenebilir taşı atmak 101 ceza', () => {
  const t = setup101(OPEN_HAND);
  t.loop([{ from: 'u1', op: 7, body: { groups: OPEN_GROUPS } }]);
  t.state.seats[0].hand = t.state.seats[0].hand.concat([tt(0, 9)]); // kırmızı 10-11-12'ye işlenir
  t.loop([{ from: 'u1', op: 3, body: { id: tt(0, 9) } }]);
  assert.equal(t.state.seats[0].extra, 101);
  assert.ok(t.sent.some((m) => m.op === 9 && /işlenebilir taş attı/.test(m.data.msg)));
});

test('101: okey yalnızca son taş olarak atılır', () => {
  const t = setup101([tt(2, 5), tt(0, 1), tt(1, 3)]);
  t.loop([{ from: 'u1', op: 3, body: { id: tt(2, 5) } }]);
  assert.equal(lastNotice(t), 'Okey yalnızca son taş olarak atılır');
});

test('101: son taşı atan eli bitirir, cezalar yazılır', () => {
  const t = setup101(OPEN_HAND.slice(0, 10));
  t.loop([{ from: 'u1', op: 7, body: { groups: OPEN_GROUPS } }]);
  t.loop([{ from: 'u1', op: 3, body: { id: tt(3, 1) } }]);
  const r = t.state.result;
  assert.equal(r.reason, 'win');
  assert.equal(r.winner, 0);
  assert.equal(r.elden, true, 'aynı turda açıp bitti');
  assert.equal(r.penalties[0], -202, 'elden bitiş katlanır');
  assert.ok(r.penalties.slice(1).every((p) => p >= 404 || p % 2 === 0));
  assert.equal(r.gameOver, false, '5 elin ilki');
});

test('101: bir oyun 5 el sürer, en düşük toplam potu alır', () => {
  const t = setup({ params: { bet: '500', mode: '101' } });
  t.join('u1');
  t.advance(8000);
  t.loop();
  let guard = 0;
  let opens = 0;
  let counted = 0;
  while (!(t.state.phase === 'finished' && t.state.gameOver) && guard++ < 20000) {
    if (t.state.phase === 'finished') {
      if (counted !== t.state.handNo) {
        counted = t.state.handNo;
        opens += t.state.seats.filter((s) => s.opened).length;
      }
      t.advance(7000);
      t.loop();
      continue;
    }
    t.advance(36000);
    t.loop();
  }
  assert.ok(t.state.gameOver, 'oyun bitmeli');
  assert.equal(t.state.handNo, 5);
  const best = Math.min(...t.state.totals);
  assert.deepEqual(t.state.result.gameWinners, [0, 1, 2, 3].filter((i) => t.state.totals[i] === best));
  const total = t.ledger.filter((l) => l.userId === 'u1').reduce((a, l) => a + l.amount, 0);
  assert.equal(total, t.state.result.payouts[0]);
  assert.ok(opens > 0, 'botlar el açabilmeli');
  console.log(`101: 5 elde ${opens} açış, toplamlar ${t.state.totals.join(', ')}`);
});
