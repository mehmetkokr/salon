// Okey kuralları (düz okey, genel kurallar). Saf fonksiyonlar: Nakama'ya
// bağımlı değil, Node testleriyle doğrulanır.
//
// Taşlar 0..105 kimlikleriyle tutulur:
//   0..103  → 4 renk × 1..13 × 2 kopya   (renk = id / 26, sayı = id % 13 + 1)
//   104,105 → sahte okey
// Renk sırası istemcideki TileColor ile aynıdır: 0 kırmızı, 1 mavi, 2 sarı, 3 siyah.

var OKEY_TILE_COUNT = 106;
var FAKE_JOKER_IDS = [104, 105];

function tileOf(id) {
  if (id >= 104) return { id: id, c: -1, n: 0, f: 1 };
  return { id: id, c: Math.floor(id / 26), n: (id % 13) + 1 };
}

/** Fisher-Yates karıştırma. `rng` 0..1 arası sayı döner (testte tohumlu). */
function shuffledDeck(rng) {
  var deck = [];
  for (var i = 0; i < OKEY_TILE_COUNT; i++) deck.push(i);
  for (var j = deck.length - 1; j > 0; j--) {
    var k = Math.floor(rng() * (j + 1));
    var t = deck[j];
    deck[j] = deck[k];
    deck[k] = t;
  }
  return deck;
}

/** Göstergenin bir fazlası okeydir; 13'ün okeyi 1'dir. */
function okeyFromIndicator(indicatorId) {
  var t = tileOf(indicatorId);
  return { c: t.c, n: (t.n % 13) + 1 };
}

/**
 * Dağıtım: göstergeyi (sahte okey olamaz) çeker, başlayan oyuncuya 15,
 * diğerlerine 14 taş verir. Kalan 48 taş ortadaki destedir.
 */
function dealOkey(rng, startSeat) {
  var deck = shuffledDeck(rng);
  var indicatorIndex = 0;
  while (deck[indicatorIndex] >= 104) indicatorIndex++;
  var indicator = deck.splice(indicatorIndex, 1)[0];
  var hands = [[], [], [], []];
  for (var s = 0; s < 4; s++) {
    var count = s === startSeat ? 15 : 14;
    for (var i = 0; i < count; i++) hands[s].push(deck.pop());
  }
  return { hands: hands, stock: deck, indicator: indicator, okey: okeyFromIndicator(indicator) };
}

/** Gerçek okey taşı (joker) mu? Sahte okey joker değildir, okeyin yerine geçer. */
function isJoker(id, okey) {
  if (id >= 104) return false;
  var t = tileOf(id);
  return t.c === okey.c && t.n === okey.n;
}

/** Taşın elde sayıldığı değer: sahte okey, okeyin rengini ve sayısını alır. */
function valueOf(id, okey) {
  if (id >= 104) return { c: okey.c, n: okey.n };
  var t = tileOf(id);
  return { c: t.c, n: t.n };
}

function countsOf(ids, okey) {
  var counts = [];
  for (var c = 0; c < 4; c++) {
    counts.push([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }
  var jokers = 0;
  for (var i = 0; i < ids.length; i++) {
    if (isJoker(ids[i], okey)) {
      jokers++;
    } else {
      var v = valueOf(ids[i], okey);
      counts[v.c][v.n]++;
    }
  }
  return { counts: counts, jokers: jokers };
}

/** Yedi çift: aynı renk ve sayıdan ikişer taş. Okey her taşın eşi olabilir. */
function isSevenPairs(ids, okey) {
  if (ids.length !== 14) return false;
  var cj = countsOf(ids, okey);
  var singles = 0;
  for (var c = 0; c < 4; c++) {
    for (var n = 1; n <= 13; n++) {
      if (cj.counts[c][n] > 2) return false; // üçüncü kopya çift olamaz
      singles += cj.counts[c][n] % 2;
    }
  }
  return singles <= cj.jokers;
}

/**
 * Taşlar tamamen perlere ayrılabiliyor mu?
 *   Seri: aynı renk, ardışık en az 3 taş (12-13-1 geçerli, 13-1-2 değil).
 *   Grup: aynı sayı, farklı renk 3 veya 4 taş.
 * Okeyler istenen taşın yerine geçer.
 */
function canMeld(ids, okey) {
  var cj = countsOf(ids, okey);
  var memo = {};
  return meldRest(cj.counts, cj.jokers, memo);
}

function meldKey(counts, jokers) {
  var parts = [jokers];
  for (var c = 0; c < 4; c++) parts.push(counts[c].join(''));
  return parts.join('|');
}

function meldRest(counts, jokers, memo) {
  // Önce kalan ilk taşı bul (renk, sonra sayı sırasıyla).
  var fc = -1;
  var fn = -1;
  for (var c = 0; c < 4 && fc < 0; c++) {
    for (var n = 1; n <= 13; n++) {
      if (counts[c][n] > 0) {
        fc = c;
        fn = n;
        break;
      }
    }
  }
  // Artan okey kalmamalı; seriler ve gruplar okeyleri uzunluk/boyut olarak zaten dener.
  if (fc < 0) return jokers === 0;
  var key = meldKey(counts, jokers);
  if (memo[key] !== undefined) return memo[key];
  var ok = tryGroups(counts, jokers, fc, fn, memo) || tryRuns(counts, jokers, fc, fn, memo);
  memo[key] = ok;
  return ok;
}

/** İlk taş bir grubun parçası: diğer renkler bu taştan sonra gelir. */
function tryGroups(counts, jokers, fc, fn, memo) {
  var others = [];
  for (var c = fc + 1; c < 4; c++) if (counts[c][fn] > 0) others.push(c);
  // Diğer renklerin her alt kümesi
  for (var mask = 0; mask < 1 << others.length; mask++) {
    var picked = [];
    for (var b = 0; b < others.length; b++) if (mask & (1 << b)) picked.push(others[b]);
    for (var size = 3; size <= 4; size++) {
      var need = size - 1 - picked.length;
      if (need < 0 || need > jokers) continue;
      counts[fc][fn]--;
      for (var i = 0; i < picked.length; i++) counts[picked[i]][fn]--;
      var ok = meldRest(counts, jokers - need, memo);
      counts[fc][fn]++;
      for (var k = 0; k < picked.length; k++) counts[picked[k]][fn]++;
      if (ok) return true;
    }
  }
  return false;
}

/**
 * İlk taş bir serinin parçası. Bu renkte ondan küçük taş kalmadığı için
 * serideki daha küçük konumlar okeyle doldurulur. Konum 14, 13'ten sonra
 * gelen 1 demektir.
 */
function tryRuns(counts, jokers, fc, fn, memo) {
  var positions = fn === 1 ? [1, 14] : [fn];
  for (var p = 0; p < positions.length; p++) {
    var at = positions[p];
    // 13'ten sonraki 1 (konum 14) için 12, 13 gibi gerçek taşlar da önce gelebilir.
    var lowest = at === 14 ? 2 : Math.max(1, at - jokers);
    for (var start = lowest; start <= at; start++) {
      for (var end = Math.max(at, start + 2); end <= 14; end++) {
        if (start === 1 && end === 14) continue; // 1 iki kez kullanılamaz
        if (end - start + 1 - 1 > countAvailable(counts, fc, start, end, at) + jokers) continue;
        counts[fc][fn]--;
        var ok = fillRun(counts, jokers, fc, start, end, at, start, memo);
        counts[fc][fn]++;
        if (ok) return true;
      }
    }
  }
  return false;
}

function numberAt(pos) {
  return pos === 14 ? 1 : pos;
}

function countAvailable(counts, c, start, end, skip) {
  var n = 0;
  for (var pos = start; pos <= end; pos++) if (pos !== skip && counts[c][numberAt(pos)] > 0) n++;
  return n;
}

/** Serinin her konumunu gerçek taşla ya da okeyle doldurmayı dener. */
function fillRun(counts, jokers, c, start, end, skip, pos, memo) {
  if (pos > end) return meldRest(counts, jokers, memo);
  if (pos === skip) return fillRun(counts, jokers, c, start, end, skip, pos + 1, memo);
  var num = numberAt(pos);
  if (counts[c][num] > 0) {
    counts[c][num]--;
    var ok = fillRun(counts, jokers, c, start, end, skip, pos + 1, memo);
    counts[c][num]++;
    if (ok) return true;
  }
  if (jokers > 0) return fillRun(counts, jokers - 1, c, start, end, skip, pos + 1, memo);
  return false;
}

/**
 * 14 taşlık el bitiyor mu? Bitiyorsa türünü döner: 'seri' veya 'cift',
 * bitmiyorsa null.
 */
function winningKind(ids, okey) {
  if (ids.length !== 14) return null;
  if (canMeld(ids, okey)) return 'seri';
  if (isSevenPairs(ids, okey)) return 'cift';
  return null;
}

// ---------------------------------------------------------------- Bot

/** Taşın eldeki diğer taşlarla ne kadar işe yaradığı (bot ve süre aşımı için). */
function usefulness(id, others, okey) {
  if (isJoker(id, okey)) return 100;
  var v = valueOf(id, okey);
  var score = 0;
  for (var i = 0; i < others.length; i++) {
    if (others[i] === id || isJoker(others[i], okey)) continue;
    var o = valueOf(others[i], okey);
    if (o.c === v.c) {
      var d = Math.abs(o.n - v.n);
      if (d === 0) score += 1;
      else if (d === 1 || d === 12) score += 3;
      else if (d === 2 || d === 11) score += 1;
    } else if (o.n === v.n) {
      score += 3;
    }
  }
  return score;
}

/** Bot yerden (önceki oyuncunun attığı) taşı almalı mı? */
function botTakesDiscard(hand, discardId, okey) {
  if (discardId === null || discardId === undefined) return false;
  if (isJoker(discardId, okey)) return true;
  return usefulness(discardId, hand, okey) >= 6;
}

/**
 * 15 taşlık elde ne yapılacağı: bitirebiliyorsa {finish: id}, yoksa
 * {discard: id} (en işe yaramaz, okey olmayan taş).
 */
function botDecide(hand, okey) {
  var candidates = hand.slice().sort(function (a, b) {
    return usefulness(a, hand, okey) - usefulness(b, hand, okey);
  });
  for (var i = 0; i < candidates.length; i++) {
    var rest = without(hand, candidates[i]);
    if (winningKind(rest, okey)) return { finish: candidates[i] };
  }
  for (var j = 0; j < candidates.length; j++) {
    if (!isJoker(candidates[j], okey)) return { discard: candidates[j] };
  }
  return { discard: candidates[0] };
}

function without(list, id) {
  var copy = list.slice();
  var at = copy.indexOf(id);
  if (at >= 0) copy.splice(at, 1);
  return copy;
}
