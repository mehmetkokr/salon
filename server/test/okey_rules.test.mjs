// Çalıştırma: node --test server/test
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './load.mjs';

const R = loadScripts('okey_rules.js');

// Renk: 0 kırmızı, 1 mavi, 2 sarı, 3 siyah
const t = (c, n, copy = 0) => c * 26 + copy * 13 + (n - 1);
const FAKE = 104;
// Gösterge sarı 4 → okey sarı 5
const okey = { c: 2, n: 5 };
const JOKER = t(2, 5);

test('taş kimlikleri renk ve sayıya doğru çözülür', () => {
  assert.deepEqual(R.tileOf(t(3, 13, 1)), { id: t(3, 13, 1), c: 3, n: 13 });
  assert.equal(R.tileOf(FAKE).f, 1);
});

test('okey göstergenin bir fazlası, 13 ise 1', () => {
  assert.deepEqual(R.okeyFromIndicator(t(2, 4)), { c: 2, n: 5 });
  assert.deepEqual(R.okeyFromIndicator(t(1, 13)), { c: 1, n: 1 });
});

test('dağıtım: 15 + 14 + 14 + 14, gösterge ve 48 taşlık deste', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const d = R.dealOkey(rng, 2);
  assert.deepEqual(d.hands.map((h) => h.length), [14, 14, 15, 14]);
  assert.equal(d.stock.length, 48);
  assert.ok(d.indicator < 104);
  const all = [...d.hands.flat(), ...d.stock, d.indicator].sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 106 }, (_, i) => i));
});

test('seri ve gruplarla biten el', () => {
  const hand = [
    t(0, 1), t(0, 2), t(0, 3), t(0, 4), // kırmızı 1-4
    t(1, 7), t(2, 7), t(3, 7), // 7 grubu
    t(3, 9), t(3, 10), t(3, 11), t(3, 12), // siyah 9-12
    t(1, 11), t(1, 12), t(1, 13), // mavi 11-13
  ];
  assert.equal(R.winningKind(hand, okey), 'seri');
});

test('12-13-1 geçerli, 13-1-2 geçersiz', () => {
  const base = [t(1, 7), t(2, 7), t(3, 7), t(0, 2), t(0, 3), t(0, 4), t(3, 9), t(3, 10), t(3, 11), t(3, 12), t(3, 13)];
  assert.equal(R.winningKind([...base, t(1, 12), t(1, 13), t(1, 1)], okey), 'seri');
  const bad = [t(1, 7), t(2, 7), t(3, 7), t(0, 5), t(0, 6), t(0, 4), t(3, 9), t(3, 10), t(3, 11), t(3, 12), t(3, 13), t(1, 13), t(1, 1), t(1, 2)];
  assert.equal(R.winningKind(bad, okey), null);
});

test('okey eksik taşın yerine geçer, sahte okey okeyin değerini alır', () => {
  const hand = [
    t(0, 1), JOKER, t(0, 3), // okey kırmızı 2 yerine
    t(1, 7), t(2, 7), t(3, 7, 1), t(0, 7), // dört renk 7
    t(3, 9), t(3, 10), t(3, 11), // siyah 9-11
    t(2, 3), t(2, 4), FAKE, t(2, 6), // sarı 3-4-(sahte = sarı 5)-6
  ];
  assert.equal(R.winningKind(hand, okey), 'seri');
});

test('bir taş eksikse bitmez', () => {
  const hand = [
    t(0, 1), t(0, 2), t(0, 3), t(0, 4),
    t(1, 7), t(2, 7), t(3, 7),
    t(3, 9), t(3, 10), t(3, 11), t(3, 12),
    t(1, 11), t(1, 12), t(0, 9),
  ];
  assert.equal(R.winningKind(hand, okey), null);
});

test('aynı renkten iki taş grup olamaz', () => {
  const hand = [
    t(0, 1), t(0, 2), t(0, 3), t(0, 4),
    t(1, 7), t(1, 7, 1), t(3, 7), // iki mavi 7 → geçersiz grup
    t(3, 9), t(3, 10), t(3, 11), t(3, 12),
    t(1, 11), t(1, 12), t(1, 13),
  ];
  assert.equal(R.winningKind(hand, okey), null);
});

test('yedi çift, okey eş olabilir', () => {
  const pairs = [t(0, 1), t(0, 1, 1), t(1, 4), t(1, 4, 1), t(3, 9), t(3, 9, 1), t(2, 2), t(2, 2, 1), t(0, 13), t(0, 13, 1), t(1, 8), t(1, 8, 1), t(3, 3), JOKER];
  assert.equal(R.winningKind(pairs, okey), 'cift');
});

test('iki okeyle uzun seri ve grup', () => {
  const hand = [
    t(0, 5), JOKER, t(0, 7), t(0, 8), t(0, 9), t(0, 10), // kırmızı 5-10 (6 okey)
    t(1, 3), t(3, 3), t(2, 5, 1), // 3 grubu (ikinci okey eksik rengin yerine)
    t(3, 11), t(3, 12), t(3, 13), t(1, 1), t(1, 2),
  ];
  // mavi 1,2 tek başına per değil → bitmemeli
  assert.equal(R.winningKind(hand, okey), null);
  hand[13] = t(3, 1);
  hand[12] = t(3, 10);
  // siyah 10-11-12-13-1 seri
  assert.equal(R.winningKind(hand, okey), 'seri');
});

test('bot bitirebiliyorsa bitirir, bitiremiyorsa okeyi atmaz', () => {
  const win = [
    t(0, 1), t(0, 2), t(0, 3), t(0, 4),
    t(1, 7), t(2, 7), t(3, 7),
    t(3, 9), t(3, 10), t(3, 11), t(3, 12),
    t(1, 11), t(1, 12), t(1, 13),
    t(2, 9), // fazladan taş
  ];
  assert.deepEqual(R.botDecide(win, okey), { finish: t(2, 9) });
  const scattered = [JOKER, t(0, 1), t(1, 3), t(2, 9), t(3, 12), t(0, 6), t(1, 10), t(2, 1), t(3, 4), t(0, 11), t(1, 6), t(2, 13), t(3, 8), t(0, 9), t(1, 1)];
  const d = R.botDecide(scattered, okey);
  assert.ok(d.discard !== undefined && d.discard !== JOKER);
});
