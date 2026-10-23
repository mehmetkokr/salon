import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setup } from './table_harness.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

function startQuick() {
  const t = setup({ game: 'tavla', params: { bet: '500' } });
  t.join('u1');
  t.advance(8000);
  t.loop();
  return t;
}

/** Sırayı insana getirir (botlar oynar). */
function untilMyTurn(t) {
  let guard = 0;
  while (!(t.state.phase === 'playing' && t.state.turn === 0) && guard++ < 50) {
    t.advance(2000);
    t.loop();
  }
}

test('tavla: 8 sn sonra bot oturur, bahis alınır, açılış zarı büyük olanı başlatır', () => {
  const t = startQuick();
  const s = t.state;
  assert.equal(s.phase, 'playing');
  assert.equal(t.wallets.u1, 9500);
  assert.equal(s.seats[1].bot, true);
  assert.notEqual(s.openingDice[0], s.openingDice[1]);
  assert.equal(s.turn, s.openingDice[0] > s.openingDice[1] ? 0 : 1);
  assert.equal(s.commitment, sha(s.seed), 'özet tohumdan');
  const view = t.lastStateFor('u1');
  assert.equal(view.board.points.length, 26);
  assert.equal(view.commitment, s.commitment);
  assert.equal(JSON.stringify(view).includes(s.seed), false, 'tohum oyun sürerken gizli');
});

test('tavla: zar at, geçerli hamleleri gör, oyna, geri al', () => {
  const t = startQuick();
  untilMyTurn(t);
  assert.equal(t.state.stage, 'roll');
  t.loop([{ from: 'u1', op: 3, body: { from: 24, to: 20 } }]);
  assert.equal(t.sent.filter((m) => m.op === 9).pop().data.msg, 'Önce zar at');
  t.loop([{ from: 'u1', op: 2 }]);
  assert.equal(t.state.stage, 'move');
  const view = t.lastStateFor('u1');
  assert.ok(view.legal.length > 0);
  const before = JSON.stringify(t.state.board);
  const step = view.legal[0];
  t.loop([{ from: 'u1', op: 3, body: { from: step.from, to: step.to } }]);
  if (t.state.turn === 0 && t.state.stage === 'move') {
    assert.equal(t.lastStateFor('u1').canUndo, 1);
    t.loop([{ from: 'u1', op: 4 }]);
    assert.equal(JSON.stringify(t.state.board), before, 'geri alınınca tur başına döner');
  }
  t.loop([{ from: 'u1', op: 3, body: { from: 1, to: 30 } }]);
  assert.ok(t.sent.some((m) => m.op === 9 && /olmaz|Sıra/.test(m.data.msg)));
});

test('tavla: maç 5 puana oynanır, kazanan potu alır, tohum açıklanır ve zarları doğrular', () => {
  const t = startQuick();
  let guard = 0;
  let games = 0;
  while (!(t.state.phase === 'finished' && t.state.gameOver) && guard++ < 20000) {
    if (t.state.phase === 'finished') {
      games++;
      t.advance(6000);
      t.loop();
      continue;
    }
    t.advance(31000); // insan da süre aşımıyla otomatik oynar
    t.loop();
  }
  assert.ok(t.state.gameOver, 'maç bitmeli');
  assert.ok(Math.max(...t.state.score) >= 5);
  const r = t.state.result;
  assert.equal(r.seed, t.state.seed, 'maç sonunda tohum açıklanır');
  assert.equal(sha(r.seed), t.state.commitment, 'özet eşleşir');
  const total = t.ledger.filter((l) => l.userId === 'u1').reduce((a, l) => a + l.amount, 0);
  assert.equal(total, r.payouts[0]);
  assert.ok(games >= 2);
});

test('tavla özel oda: kodsuz girilmez, sahibi başlatır', () => {
  const t = setup({ game: 'tavla', params: { bet: '500', private: '1', name: 'Akşam', code: 'TAVLA2', pin: '', host: 'u1' } });
  t.join('u1');
  t.advance(20000);
  t.loop();
  assert.equal(t.state.phase, 'waiting');
  assert.equal(t.attempt('u2').accept, false);
  assert.equal(t.signal({ type: 'allow', userId: 'u2' }), 'ok');
  t.join('u2');
  t.loop([{ from: 'u2', op: 5 }]);
  assert.equal(t.state.phase, 'waiting');
  t.loop([{ from: 'u1', op: 5 }]);
  assert.equal(t.state.phase, 'playing');
  assert.equal(t.state.pot, 1000);
});
