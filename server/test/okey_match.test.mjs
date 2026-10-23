import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './table_harness.mjs';

test('masa 8 sn sonra botlarla dolar, bahis alınır, 15/14 taş dağıtılır', () => {
  const t = setup();
  assert.equal(t.attempt('u1').accept, true);
  t.join('u1');
  t.loop();
  assert.equal(t.state.phase, 'waiting');
  t.advance(8000);
  t.loop();
  assert.equal(t.state.phase, 'playing');
  assert.equal(t.wallets.u1, 9500);
  assert.equal(t.state.pot, 500);
  const view = t.lastStateFor('u1');
  assert.equal(view.seats.filter((s) => s.bot).length, 3);
  const counts = view.seats.map((s) => s.count).sort();
  assert.deepEqual(counts, [14, 14, 14, 15]);
  assert.equal(view.stockCount, 48);
  assert.ok(view.hand.length === 14 || view.hand.length === 15);
  // Başkalarının eli gönderilmez
  assert.equal(JSON.stringify(view).includes('"hand":[{'), view.hand.length > 0);
});

test('çipi yetmeyen oyuncu masaya giremez', () => {
  const t = setup({ chips: 100 });
  assert.equal(t.attempt('u1').accept, false);
});

test('sırası olmayan oyuncunun hamlesi reddedilir', () => {
  const t = setup();
  t.join('u1', 'u2');
  t.advance(8000);
  t.loop();
  const s = t.state;
  const notTurn = s.seats.findIndex((x, i) => !x.bot && i !== s.turn);
  if (notTurn < 0) return; // iki insanın sırası olamaz; nadir durum yok
  const who = s.seats[notTurn].userId;
  t.loop([{ from: who, op: 2, body: { from: 'stock' } }]);
  const notice = t.sent.filter((m) => m.op === 9 && m.to.includes(who)).pop();
  assert.equal(notice.data.msg, 'Sıra sende değil');
});

test('bitmeyen eli bitirmeye çalışmak reddedilir', () => {
  const t = setup();
  t.join('u1');
  t.advance(8000);
  t.loop();
  // Sırayı insana getir
  let guard = 0;
  while (t.state.turn !== 0 || t.state.stage !== 'discard') {
    if (t.state.turn === 0 && t.state.stage === 'draw') {
      t.loop([{ from: 'u1', op: 2, body: { from: 'stock' } }]);
      continue;
    }
    t.advance(2000);
    t.loop();
    if (++guard > 200 || t.state.phase !== 'playing') return;
  }
  const hand = t.state.seats[0].hand;
  const id = hand.find((x) => !t.M.winningKind(hand.filter((y) => y !== x), t.state.okey));
  t.loop([{ from: 'u1', op: 4, body: { id } }]);
  assert.equal(t.state.phase, 'playing');
  assert.match(t.sent.filter((m) => m.op === 9).pop().data.msg, /bitmiyor/);
});

test('oyun sonuna kadar oynanır; çipler tutarlı, XP yazılır, masa kapanır', () => {
  for (let round = 0; round < 15; round++) {
    const t = setup();
    t.join('u1');
    t.advance(8000);
    t.loop();
    let steps = 0;
    while (t.state.phase === 'playing' && steps++ < 2000) {
      t.advance(21000); // insan da süre aşımıyla otomatik oynar
      t.loop();
    }
    assert.equal(t.state.phase, 'finished', 'oyun bitmeli');
    const r = t.state.result;
    const total = t.ledger.filter((l) => l.userId === 'u1').reduce((a, l) => a + l.amount, 0);
    assert.equal(total, r.payouts[0]);
    if (r.reason === 'draw') assert.equal(t.wallets.u1, 10000);
    if (r.reason === 'win') {
      assert.ok(t.M.winningKind(r.hand, t.state.okey));
      assert.equal(t.wallets.u1, r.winner === 0 ? 10000 : 9500);
    }
    const prog = t.storage['u1progress'];
    assert.ok(prog.xp >= 20);
    assert.equal(prog.played, 1, 'oynanan oyun karneye yazılır');
    assert.equal(prog.won || 0, r.reason === 'win' && r.winner === 0 ? 1 : 0);
    t.advance(12000);
    assert.equal(t.loop(), null, 'sonuçtan sonra masa kapanır');
  }
});

test('hızlı oyun bakiyeye uygun bahsi seçer', () => {
  const t = setup();
  assert.equal(t.M.betForChips(10000), 500);
  assert.equal(t.M.betForChips(150), 100);
  assert.equal(t.M.betForChips(50), 0);
  assert.equal(t.M.betForChips(1_000_000), 10000);
});

// ---------------------------------------------------------------- Özel oda

const ROOM = { bet: '500', private: '1', name: 'Cuma akşamı', code: 'K7P2QX', pin: '4821', host: 'u1' };

test('özel oda: kendiliğinden başlamaz, kodsuz girilmez, şifre kontrol edilir', () => {
  const t = setup({ params: ROOM });
  assert.equal(t.attempt('u1').accept, true); // oda sahibi
  t.join('u1');
  t.advance(20000);
  t.loop();
  assert.equal(t.state.phase, 'waiting');
  const view = t.lastStateFor('u1');
  assert.deepEqual(view.room, { name: 'Cuma akşamı', code: 'K7P2QX', locked: 1, host: 0 });

  assert.equal(t.attempt('u2').accept, false);
  assert.equal(t.signal({ type: 'allow', userId: 'u2', pin: '0000' }), 'pin');
  assert.equal(t.signal({ type: 'allow', userId: 'u2' }), 'pin');
  assert.equal(t.signal({ type: 'allow', userId: 'u2', pin: '4821' }), 'ok');
  assert.equal(t.attempt('u2').accept, true);
  t.join('u2');
  assert.equal(t.lastStateFor('u2').seats.filter(Boolean).length, 2);
});

test('özel oda: eli yalnızca oda sahibi başlatır, el bitince oda açık kalır', () => {
  const t = setup({ params: ROOM });
  t.join('u1');
  t.signal({ type: 'allow', userId: 'u2', pin: '4821' });
  t.join('u2');
  t.loop([{ from: 'u2', op: 5 }]);
  assert.equal(t.state.phase, 'waiting');
  assert.equal(t.sent.filter((m) => m.op === 9).pop().data.msg, 'Eli oda sahibi başlatır');

  t.loop([{ from: 'u1', op: 5 }]);
  assert.equal(t.state.phase, 'playing');
  assert.equal(t.state.pot, 1000);
  assert.equal(t.signal({ type: 'allow', userId: 'u3', pin: '4821' }), 'started');

  let steps = 0;
  while (t.state.phase === 'playing' && steps++ < 2000) {
    t.advance(21000);
    t.loop();
  }
  assert.equal(t.state.phase, 'finished');
  t.advance(60000);
  assert.notEqual(t.loop(), null, 'özel oda sonuçtan sonra kapanmaz');

  // El arasında yeni gelen botun yerine oturabilir
  assert.equal(t.signal({ type: 'allow', userId: 'u3', pin: '4821' }), 'ok');

  // Yeni el
  t.loop([{ from: 'u1', op: 5 }]);
  assert.equal(t.state.phase, 'playing');
  assert.equal(t.state.result, null);
  const counts = t.state.seats.map((s) => s.hand.length).sort();
  assert.deepEqual(counts, [14, 14, 14, 15]);
});

test('özel oda: sahibi ayrılınca oturan oyuncu sahip olur', () => {
  const t = setup({ params: ROOM });
  t.join('u1');
  t.signal({ type: 'allow', userId: 'u2', pin: '4821' });
  t.join('u2');
  t.leave('u1');
  assert.equal(t.state.hostUserId, 'u2');
  assert.equal(t.lastStateFor('u2').room.host, 1);
});

test('hızlı masa özel odaları listelemez', () => {
  const t = setup({ params: ROOM });
  t.join('u1');
  const label = JSON.parse(t.M.okeyLabel(t.state));
  assert.equal(label.open, 0);
  assert.equal(label.private, 1);
});

// ---------------------------------------------------------------- Katlamalı

test('katlamalı: bitiş türüne göre puan cezası', () => {
  const t = setup();
  assert.equal(t.M.handPenalty({ kind: 'seri', okeyFinish: false }), 2);
  assert.equal(t.M.handPenalty({ kind: 'seri', okeyFinish: true }), 4);
  assert.equal(t.M.handPenalty({ kind: 'cift', okeyFinish: false }), 4);
  assert.equal(t.M.handPenalty({ kind: 'cift', okeyFinish: true }), 8);
});

test('katlamalı: el biter, puan düşer, sonraki el bahis almadan açılır, biri 0 olunca pot dağıtılır', () => {
  for (let round = 0; round < 3; round++) {
    const t = setup({ params: { bet: '500', mode: 'katlamali' } });
    t.join('u1');
    t.advance(8000);
    t.loop();
    assert.equal(t.state.phase, 'playing');
    assert.equal(t.wallets.u1, 9500);
    let hands = 0;
    let guard = 0;
    while (!(t.state.phase === 'finished' && t.state.gameOver) && guard++ < 50000) {
      if (t.state.phase === 'finished') {
        hands++;
        const r = t.state.result;
        assert.equal(r.gameOver, false);
        const sum = r.scoreDeltas.reduce((a, b) => a + b, 0);
        if (r.reason === 'win') assert.ok([-6, -12, -24].includes(sum), 'üç oyuncu 2/4/8 kaybeder');
        if (r.reason === 'draw') assert.equal(sum, 0);
        assert.equal(t.wallets.u1, 9500, 'ara ellerde çip değişmez');
        t.advance(7000);
        t.loop();
        assert.equal(t.state.phase, 'playing', 'sonraki el kendiliğinden açılır');
        continue;
      }
      t.advance(21000);
      t.loop();
    }
    assert.ok(t.state.gameOver, 'oyun bitmeli');
    assert.ok(hands >= 2, 'katlamalı birden fazla el sürer');
    const r = t.state.result;
    assert.ok(t.state.scores.some((s) => s <= 0));
    const best = Math.max(...t.state.scores);
    assert.deepEqual(r.gameWinners, [0, 1, 2, 3].filter((i) => t.state.scores[i] === best));
    const total = t.ledger.filter((l) => l.userId === 'u1').reduce((a, l) => a + l.amount, 0);
    assert.equal(total, r.payouts[0]);
    t.advance(12000);
    assert.equal(t.loop(), null, 'hızlı masa oyun sonunda kapanır');
  }
});

test('katlamalı: gösterge yalnızca ilk turda, eşi eldeyse gösterilir', () => {
  const t = setup({ params: { bet: '500', mode: 'katlamali' } });
  t.join('u1');
  t.advance(8000);
  t.loop();
  // İnsanın sırasını ve elini ayarla: göstergenin eşini eline koy
  const s = t.state;
  const twin = t.M.indicatorTwin(s.indicator);
  const holder = s.seats.findIndex((x) => x.hand.includes(twin));
  // Eşi kimdeyse onunla insanın elindeki ilk taşı değiştir (destedeyse desteden al)
  const mine = s.seats[0].hand;
  if (holder !== 0) {
    if (holder >= 0) s.seats[holder].hand[s.seats[holder].hand.indexOf(twin)] = mine[0];
    else s.stock[s.stock.indexOf(twin)] = mine[0];
    mine[0] = twin;
  }
  s.turn = 0;
  s.stage = mine.length === 15 ? 'discard' : 'draw';
  s.seats[0].moved = false;
  s.seats[0].shown = false;
  const before = s.scores.slice();
  t.loop([{ from: 'u1', op: 6 }]);
  assert.deepEqual(t.state.scores, [before[0], before[1] - 1, before[2] - 1, before[3] - 1]);
  assert.match(t.sent.filter((m) => m.op === 9).pop().data.msg, /göstergeyi gösterdi/);
  t.loop([{ from: 'u1', op: 6 }]);
  assert.equal(t.sent.filter((m) => m.op === 9).pop().data.msg, 'Göstergeyi zaten gösterdin');
});

test('düz masada gösterge gösterilemez ve hızlı oyun türü etikete yazılır', () => {
  const t = setup();
  t.join('u1');
  t.advance(8000);
  t.loop();
  assert.equal(t.M.showIndicatorError(t.state, t.state.turn), 'Gösterge yalnızca katlamalıda gösterilir');
  assert.equal(JSON.parse(t.M.okeyLabel(t.state)).mode, 'duz');
});

// ---------------------------------------------------------------- 101

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

test('101: 101 altı açılamaz, üstü açılır, açınca taş işlenir', () => {
  const t = setup101(OPEN_HAND);
  t.loop([{ from: 'u1', op: 7, body: { groups: [[tt(1, 9), tt(1, 10), tt(1, 11)]] } }]);
  assert.match(t.sent.filter((m) => m.op === 9).pop().data.msg, /toplamı 30/);
  assert.equal(t.state.seats[0].opened, false);

  t.loop([{ from: 'u1', op: 7, body: { groups: [OPEN_HAND.slice(0, 3), OPEN_HAND.slice(3, 6), OPEN_HAND.slice(6, 9)] } }]);
  assert.equal(t.state.seats[0].opened, true);
  assert.equal(t.state.melds.length, 3);
  assert.deepEqual(t.state.seats[0].hand.sort(), [tt(3, 1), tt(3, 2), tt(2, 9)].sort());

  // Görünümde masa perleri ve açılma bilgisi
  const view = t.lastStateFor('u1');
  assert.equal(view.o101.melds.length, 3);
  assert.equal(view.o101.opened[0], 1);

  // sarı 13'ü 13 grubuna işle (dördüncü renk)
  t.state.seats[0].hand = t.state.seats[0].hand.concat([tt(2, 13)]);
  t.loop([{ from: 'u1', op: 8, body: { id: tt(2, 13), meld: 0 } }]);
  assert.equal(t.state.melds[0].size, 4);
});

test('101: işlenebilir taşı atmak ve yandan alıp kullanmamak 101 ceza', () => {
  const t = setup101(OPEN_HAND);
  t.loop([{ from: 'u1', op: 7, body: { groups: [OPEN_HAND.slice(0, 3), OPEN_HAND.slice(3, 6), OPEN_HAND.slice(6, 9)] } }]);
  // kırmızı 9, kırmızı 10-11-12 serisine işlenebilir: atmak ceza
  t.state.seats[0].hand = t.state.seats[0].hand.concat([tt(0, 9)]);
  t.loop([{ from: 'u1', op: 3, body: { id: tt(0, 9) } }]);
  assert.equal(t.state.seats[0].extra, 101);
  assert.ok(t.sent.some((m) => m.op === 9 && /işlenebilir taş attı/.test(m.data.msg)));
});

test('101: okey ancak son taş olarak atılır, açmadan bitirilmez', () => {
  const t = setup101([tt(2, 5), tt(0, 1), tt(1, 3)]);
  t.loop([{ from: 'u1', op: 3, body: { id: tt(2, 5) } }]);
  assert.equal(t.sent.filter((m) => m.op === 9).pop().data.msg, 'Okey yalnızca son taş olarak atılır');
});

test('101: 5 el oynanır, cezalar toplanır, en düşük toplam potu alır', () => {
  let opens = 0;
  let wins = 0;
  for (let round = 0; round < 3; round++) {
    const t = setup({ params: { bet: '500', mode: '101' } });
    t.join('u1');
    t.advance(8000);
    t.loop();
    let guard = 0;
    let lastHand = 0;
    while (!(t.state.phase === 'finished' && t.state.gameOver) && guard++ < 50000) {
      if (t.state.phase === 'finished') {
        const r = t.state.result;
        if (t.state.handNo !== lastHand) {
          lastHand = t.state.handNo;
          if (r.reason === 'win') wins++;
          opens += t.state.seats.filter((s) => s.opened).length;
          assert.equal(r.penalties.length, 4);
        }
        t.advance(7000);
        t.loop();
        continue;
      }
      t.advance(36000);
      t.loop();
    }
    assert.ok(t.state.gameOver);
    assert.equal(t.state.handNo, 5);
    const best = Math.min(...t.state.totals);
    assert.deepEqual(t.state.result.gameWinners, [0, 1, 2, 3].filter((i) => t.state.totals[i] === best));
    const total = t.ledger.filter((l) => l.userId === 'u1').reduce((a, l) => a + l.amount, 0);
    assert.equal(total, t.state.result.payouts[0]);
  }
  assert.ok(opens > 0, 'botlar el açabilmeli');
  console.log(`101 simülasyonu: 15 elde ${opens} açış, ${wins} bitiş`);
});
