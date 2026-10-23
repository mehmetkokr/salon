import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './load.mjs';

const R = loadScripts('okey_rules.js', 'okey101_rules.js');

const t = (c, n, copy = 0) => c * 26 + copy * 13 + (n - 1);
const okey = { c: 2, n: 5 }; // sarı 5
const JOKER = t(2, 5);
const FAKE = 104; // sahte okey = sarı 5

test('101 dağıtımı: 22 + 21 + 21 + 21, deste 20', () => {
  let seed = 3;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const d = R.deal101(rng, 1);
  assert.deepEqual(d.hands.map((h) => h.length), [21, 22, 21, 21]);
  assert.equal(d.stock.length, 20);
});

test('seri ve grup değerleri, okey en yüksek yere konur', () => {
  assert.equal(R.analyzeMeld([t(0, 9), t(0, 10), t(0, 11)], okey).value, 30);
  const withJoker = R.analyzeMeld([t(0, 11), JOKER, t(0, 12)], okey); // 11-12-13
  assert.equal(withJoker.kind, 'run');
  assert.equal(withJoker.value, 36);
  const gap = R.analyzeMeld([t(1, 3), JOKER, t(1, 5)], okey); // 3-4-5
  assert.equal(gap.value, 12);
  const set = R.analyzeMeld([t(0, 13), t(1, 13), t(3, 13), JOKER], okey);
  assert.equal(set.kind, 'set');
  assert.equal(set.value, 52);
  // sahte okey sarı 5 sayılır
  assert.equal(R.analyzeMeld([t(2, 3), t(2, 4), FAKE], okey).value, 12);
});

test('101de 13-1 geçmez, aynı renk grup olmaz', () => {
  assert.equal(R.analyzeMeld([t(0, 12), t(0, 13), t(0, 1)], okey), null);
  assert.equal(R.analyzeMeld([t(0, 7), t(0, 7, 1), t(1, 7)], okey), null);
  assert.equal(R.analyzeMeld([t(0, 7), t(1, 8)], okey), null);
});

test('açış: 101 altı reddedilir, üstü kabul; 5 çift açar', () => {
  const low = [[t(0, 1), t(0, 2), t(0, 3)], [t(1, 9), t(1, 10), t(1, 11)]];
  const hand = low.flat().concat([t(3, 13), t(1, 13), t(0, 13), t(0, 10), t(0, 11), t(0, 12)]);
  const r1 = R.evaluateOpening(low, hand, okey);
  assert.equal(r1.ok, false);
  assert.match(r1.error, /toplamı 36/);
  const enough = [[t(3, 13), t(1, 13), t(0, 13)], [t(0, 10), t(0, 11), t(0, 12)], [t(1, 9), t(1, 10), t(1, 11)]];
  const r2 = R.evaluateOpening(enough, hand, okey);
  assert.equal(r2.ok, true);
  assert.equal(r2.value, 39 + 33 + 30);
  const pairs = [
    [t(0, 1), t(0, 1, 1)], [t(1, 4), t(1, 4, 1)], [t(3, 9), t(3, 9, 1)], [t(2, 2), t(2, 2, 1)], [t(0, 8), JOKER],
  ];
  const r3 = R.evaluateOpening(pairs, pairs.flat(), okey);
  assert.equal(r3.ok, true);
  assert.equal(r3.kind, 'cift');
  assert.equal(R.evaluateOpening(pairs.slice(0, 4), pairs.flat(), okey).ok, false);
  assert.equal(R.evaluateOpening([[t(0, 1), t(0, 2), t(0, 9)]], hand, okey).ok, false);
});

test('işleme: seri uçlarına, gruba eksik renk; çifte işlenmez', () => {
  const run = R.analyzeMeld([t(0, 4), t(0, 5), t(0, 6)], okey);
  assert.equal(R.addToMeld(run, t(0, 7), okey).to, 7);
  assert.equal(R.addToMeld(run, t(0, 3), okey).from, 3);
  assert.equal(R.addToMeld(run, t(1, 7), okey), null);
  assert.equal(R.addToMeld(run, JOKER, okey).to, 7);
  const set = R.analyzeMeld([t(0, 9), t(1, 9), t(3, 9)], okey);
  assert.equal(R.addToMeld(set, t(2, 9), okey).size, 4);
  assert.equal(R.addToMeld(set, t(0, 9, 1), okey), null);
  assert.ok(R.canAddAnywhere([run, set], t(0, 7), okey));
  assert.ok(!R.canAddAnywhere([run, set], t(3, 1), okey));
  assert.equal(R.addToMeld({ kind: 'pair', ids: [1, 1] }, t(0, 2), okey), null);
});

test('el sonu cezaları', () => {
  const seats = [
    { opened: true, openedKind: 'per', hand: [] },
    { opened: true, openedKind: 'per', hand: [t(0, 3), t(1, 10), JOKER] }, // 3 + 10 + 101
    { opened: false, hand: [t(0, 1)] },
    { opened: true, openedKind: 'cift', hand: [t(0, 5)], extra: 101 }, // 5×2 + 101
  ];
  assert.deepEqual(R.handPenalties101(seats, 0, false, okey), [-101, 114, 202, 111]);
  assert.deepEqual(R.handPenalties101(seats, 0, true, okey), [-202, 228, 404, 121]);
});

test('bot en yüksek açışı bulur', () => {
  const hand = [
    t(3, 13), t(1, 13), t(0, 13), // 39
    t(0, 10), t(0, 11), t(0, 12), // 33
    t(1, 9), t(1, 10), t(1, 11), // 30
    t(2, 1), t(3, 4), JOKER,
  ];
  const best = R.bestOpening(hand, okey);
  assert.ok(best.value >= 101, `toplam ${best.value}`);
  const ids = best.melds.flatMap((m) => m.ids);
  assert.equal(new Set(ids).size, ids.length, 'taşlar çakışmaz');
});
