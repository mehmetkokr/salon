// 101 okey kuralları. Saf fonksiyonlar; okey_rules.js'teki taş yardımcılarını
// (tileOf, isJoker, valueOf, shuffledDeck, okeyFromIndicator) kullanır.
//
// Genel kurallar (bu uygulamadaki hâliyle):
//   • Başlayan 22, diğerleri 21 taş alır.
//   • El açmak için en az 101 puanlık per (seri ya da grup) ya da en az 5 çift.
//     Seri: aynı renk, ardışık en az 3 taş (101'de 13'ten sonra 1 gelmez).
//     Grup: aynı sayı, farklı renk 3 ya da 4 taş. Okey eksik taşın yerine geçer.
//   • Elini açan masadaki perlere taş işleyebilir.
//   • El sonu cezası: biten −101; açamayan 202; açan, elinde kalan taşların
//     toplamı (elde kalan okey 101). Çift açanın cezası ikiye katlanır.
//     Okeyle ya da elden (aynı turda açıp) bitilirse herkesin cezası katlanır.

var OPEN_MIN_101 = 101;
var OPEN_PAIRS_101 = 5;
var JOKER_PENALTY_101 = 101;
var NOT_OPENED_101 = 202;
var FINISH_BONUS_101 = -101;

/** Dağıtım: göstergeyi çeker, başlayana 22, diğerlerine 21 taş verir. */
function deal101(rng, startSeat) {
  var deck = shuffledDeck(rng);
  var indicatorIndex = 0;
  while (deck[indicatorIndex] >= 104) indicatorIndex++;
  var indicator = deck.splice(indicatorIndex, 1)[0];
  var hands = [[], [], [], []];
  for (var s = 0; s < 4; s++) {
    var count = s === startSeat ? 22 : 21;
    for (var i = 0; i < count; i++) hands[s].push(deck.pop());
  }
  return { hands: hands, stock: deck, indicator: indicator, okey: okeyFromIndicator(indicator) };
}

/**
 * Per çözümler. Dönüş:
 *   {kind:'run', color, from, to, value, ids}  ya da
 *   {kind:'set', number, colors, value, ids}   ya da  null (geçersiz)
 * Okeyler en yüksek puanı verecek yere konur.
 */
function analyzeMeld(ids, okey) {
  if (!ids || ids.length < 3) return null;
  var jokers = 0;
  var real = [];
  for (var i = 0; i < ids.length; i++) {
    if (isJoker(ids[i], okey)) jokers++;
    else real.push(valueOf(ids[i], okey));
  }
  if (!real.length) return null;
  var run = analyzeRun(real, jokers, ids);
  var set = analyzeSet(real, jokers, ids);
  if (run && set) return run.value >= set.value ? run : set;
  return run || set;
}

function analyzeRun(real, jokers, ids) {
  var color = real[0].c;
  var nums = [];
  for (var i = 0; i < real.length; i++) {
    if (real[i].c !== color) return null;
    nums.push(real[i].n);
  }
  nums.sort(function (a, b) {
    return a - b;
  });
  for (var k = 1; k < nums.length; k++) if (nums[k] === nums[k - 1]) return null;
  var from = nums[0];
  var to = nums[nums.length - 1];
  var spare = jokers - (to - from + 1 - nums.length);
  if (spare < 0) return null;
  // Artan okeyleri önce yukarı (daha çok puan), yer kalmazsa aşağı uzat.
  while (spare > 0 && to < 13) {
    to++;
    spare--;
  }
  while (spare > 0 && from > 1) {
    from--;
    spare--;
  }
  if (spare > 0) return null;
  if (to - from + 1 < 3) return null;
  var value = 0;
  for (var n = from; n <= to; n++) value += n;
  return { kind: 'run', color: color, from: from, to: to, value: value, ids: ids.slice() };
}

function analyzeSet(real, jokers, ids) {
  var number = real[0].n;
  var colors = [];
  for (var i = 0; i < real.length; i++) {
    if (real[i].n !== number) return null;
    if (colors.indexOf(real[i].c) >= 0) return null;
    colors.push(real[i].c);
  }
  var size = real.length + jokers;
  if (size < 3 || size > 4) return null;
  return { kind: 'set', number: number, colors: colors, size: size, value: number * size, ids: ids.slice() };
}

/** İki taş çift mi? (aynı renk ve sayı; okey her taşın eşi olur) */
function isPair(a, b, okey) {
  if (isJoker(a, okey) || isJoker(b, okey)) return true;
  var va = valueOf(a, okey);
  var vb = valueOf(b, okey);
  return va.c === vb.c && va.n === vb.n;
}

/**
 * Açma isteğini değerlendirir. `groups`: ıstakadaki taş grupları.
 * Dönüş: {ok:true, melds:[...], kind:'per'|'cift', value} ya da {ok:false, error}.
 */
function evaluateOpening(groups, hand, okey) {
  if (!groups || !groups.length) return { ok: false, error: 'Açmak için taşlarını gruplara ayır' };
  var used = {};
  for (var g = 0; g < groups.length; g++) {
    for (var t = 0; t < groups[g].length; t++) {
      var id = groups[g][t];
      if (hand.indexOf(id) < 0) return { ok: false, error: 'Bu taş elinde yok' };
      if (used[id]) return { ok: false, error: 'Aynı taş iki grupta' };
      used[id] = true;
    }
  }
  // Istakadaki geçersiz gruplar (henüz dizilmemiş taşlar) atlanır; yalnızca
  // geçerli perler ya da çiftler sayılır.
  var melds = [];
  var total = 0;
  var pairs = [];
  for (var m = 0; m < groups.length; m++) {
    var grp = groups[m];
    if (grp.length === 2 && isPair(grp[0], grp[1], okey)) {
      pairs.push({ kind: 'pair', ids: grp.slice(), value: 0 });
      continue;
    }
    var meld = analyzeMeld(grp, okey);
    if (meld) {
      melds.push(meld);
      total += meld.value;
    }
  }
  if (total >= OPEN_MIN_101) return { ok: true, melds: melds, kind: 'per', value: total };
  if (pairs.length >= OPEN_PAIRS_101) return { ok: true, melds: pairs, kind: 'cift', value: 0 };
  if (total > 0) return { ok: false, error: 'Perlerin toplamı ' + total + '; açmak için en az ' + OPEN_MIN_101 + ' gerekli' };
  if (pairs.length) return { ok: false, error: pairs.length + ' çift var; çift açmak için en az ' + OPEN_PAIRS_101 + ' gerekli' };
  return { ok: false, error: 'Istakada geçerli per yok. Perlerin arasında boşluk bırakarak diz.' };
}

var COLOR_NAMES_101 = ['kırmızı', 'mavi', 'sarı', 'siyah'];

function describeGroup(ids, okey) {
  var parts = [];
  for (var i = 0; i < ids.length; i++) {
    if (isJoker(ids[i], okey)) parts.push('okey');
    else {
      var v = valueOf(ids[i], okey);
      parts.push(COLOR_NAMES_101[v.c] + ' ' + v.n);
    }
  }
  return parts.join(', ');
}

/**
 * Taşı masadaki pere işler. Başarılıysa yeni peri döner, değilse null.
 * Okey bir serinin ucuna (yukarı, olmazsa aşağı) ya da eksik renkli gruba eklenir.
 * Çift perlerine taş işlenmez.
 */
function addToMeld(meld, id, okey) {
  if (meld.kind === 'pair') return null;
  var joker = isJoker(id, okey);
  var v = joker ? null : valueOf(id, okey);
  var next = JSON.parse(JSON.stringify(meld));
  next.ids = meld.ids.concat([id]);
  if (meld.kind === 'run') {
    if (joker) {
      if (meld.to < 13) next.to = meld.to + 1;
      else if (meld.from > 1) next.from = meld.from - 1;
      else return null;
      return next;
    }
    if (v.c !== meld.color) return null;
    if (v.n === meld.to + 1 && v.n <= 13) next.to = v.n;
    else if (v.n === meld.from - 1 && v.n >= 1) next.from = v.n;
    else return null;
    return next;
  }
  if (meld.size >= 4) return null;
  if (!joker) {
    if (v.n !== meld.number || meld.colors.indexOf(v.c) >= 0) return null;
    next.colors = meld.colors.concat([v.c]);
  }
  next.size = meld.size + 1;
  return next;
}

/** Bu taş masadaki herhangi bir pere işlenebilir mi? (işlek taş) */
function canAddAnywhere(melds, id, okey) {
  for (var i = 0; i < melds.length; i++) if (addToMeld(melds[i], id, okey)) return true;
  return false;
}

/** Elde kalan taşların ceza puanı (okey 101). */
function handPoints101(hand, okey) {
  var sum = 0;
  for (var i = 0; i < hand.length; i++) {
    sum += isJoker(hand[i], okey) ? JOKER_PENALTY_101 : valueOf(hand[i], okey).n;
  }
  return sum;
}

/**
 * El sonu cezaları. seats: [{opened, openedKind:'per'|'cift', hand, extra}],
 * winner: koltuk (-1: deste bitti), doubled: okeyle ya da elden bitiş.
 * `extra`: el içinde yazılan cezalar (işlek taş, yandan alıp açamama).
 */
function handPenalties101(seats, winner, doubled, okey) {
  var out = [];
  for (var i = 0; i < seats.length; i++) {
    var s = seats[i];
    var p;
    if (i === winner) {
      p = FINISH_BONUS_101 * (doubled ? 2 : 1);
    } else {
      p = s.opened ? handPoints101(s.hand, okey) : NOT_OPENED_101;
      if (s.openedKind === 'cift') p *= 2;
      if (doubled) p *= 2;
    }
    out.push(p + (s.extra || 0));
  }
  return out;
}

// ---------------------------------------------------------------- Bot (101)

/** Elden çıkarılabilecek bütün geçerli perler (okeylerle birlikte). */
function candidateMelds(hand, okey) {
  var jokers = [];
  var byValue = {};
  for (var i = 0; i < hand.length; i++) {
    var id = hand[i];
    if (isJoker(id, okey)) {
      jokers.push(id);
      continue;
    }
    var v = valueOf(id, okey);
    var key = v.c + ':' + v.n;
    if (!byValue[key]) byValue[key] = [];
    byValue[key].push(id);
  }
  var pick = function (c, n) {
    var list = byValue[c + ':' + n];
    return list && list.length ? list[0] : null;
  };
  var out = [];
  // Seriler: her renk, her başlangıç; boşluklar eldeki okeylerle doldurulur
  for (var c = 0; c < 4; c++) {
    for (var from = 1; from <= 11; from++) {
      var ids = [];
      var usedJ = 0;
      for (var n = from; n <= 13; n++) {
        var t = pick(c, n);
        if (t === null) {
          if (usedJ < jokers.length) {
            ids.push(jokers[usedJ]);
            usedJ++;
          } else break;
        } else ids.push(t);
        if (ids.length >= 3) {
          var m = analyzeMeld(ids.slice(), okey);
          if (m) out.push(m);
        }
      }
    }
  }
  // Gruplar
  for (var num = 1; num <= 13; num++) {
    var g = [];
    for (var cc = 0; cc < 4; cc++) {
      var tt = pick(cc, num);
      if (tt !== null) g.push(tt);
    }
    if (g.length >= 3) out.push(analyzeMeld(g, okey));
    if (g.length === 4) {
      for (var drop = 0; drop < 4; drop++) {
        out.push(analyzeMeld(g.filter(function (_, k) { return k !== drop; }), okey));
      }
    }
    if (g.length === 2 && jokers.length) out.push(analyzeMeld(g.concat([jokers[0]]), okey));
  }
  return out.filter(function (m) {
    return m;
  });
}

/** Birbiriyle çakışmayan perlerden en yüksek toplamı arar (botun açışı). */
function bestOpening(hand, okey) {
  var cands = candidateMelds(hand, okey).sort(function (a, b) {
    return b.value - a.value;
  });
  var best = { value: 0, melds: [] };
  var budget = 4000; // arama sınırı: sunucuyu yormasın
  function search(start, used, chosen, value) {
    if (--budget < 0) return;
    if (value > best.value) best = { value: value, melds: chosen.slice() };
    for (var i = start; i < cands.length; i++) {
      var m = cands[i];
      var clash = false;
      for (var k = 0; k < m.ids.length; k++) if (used[m.ids[k]]) clash = true;
      if (clash) continue;
      for (var a = 0; a < m.ids.length; a++) used[m.ids[a]] = true;
      chosen.push(m);
      search(i + 1, used, chosen, value + m.value);
      chosen.pop();
      for (var b = 0; b < m.ids.length; b++) delete used[m.ids[b]];
    }
  }
  search(0, {}, [], 0);
  return best;
}

/** Botun atacağı taş: işlek olmayan, en az işe yarayan, okey olmayan. */
function botDiscard101(hand, tableMelds, okey) {
  var sorted = hand.slice().sort(function (a, b) {
    return usefulness(a, hand, okey) - usefulness(b, hand, okey);
  });
  for (var i = 0; i < sorted.length; i++) {
    if (!isJoker(sorted[i], okey) && !canAddAnywhere(tableMelds, sorted[i], okey)) return sorted[i];
  }
  for (var j = 0; j < sorted.length; j++) if (!isJoker(sorted[j], okey)) return sorted[j];
  return sorted[0];
}
