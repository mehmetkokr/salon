// Pişti (genel kurallar, iki kişilik).
//
// • Her oyuncuya 4 kart, yere 4 kart (3'ü kapalı, sonuncusu açık). Eller
//   bitince desteden yine 4'er kart dağıtılır.
// • Atılan kart yerdeki üst kartla aynı sayıdaysa ya da vale ise yer alınır.
// • Yerde tek kart varken aynı sayıyla alınırsa pişti (10 puan); tek vale
//   valeyle alınırsa vale piştisi (20 puan).
// • El sonunda yerde kalanlar son alan oyuncuya gider.
// • Puanlar: çok kart 3, her as 1, her vale 1, sinek ikilisi 2, karo onlusu 3,
//   pişti 10, vale piştisi 20. Oyun 101 puana; 101'i geçen en yüksek kazanır.

var PISTI_TARGET = 101;

function pistiNewMatch(state, rng) {
  state.scores = [0, 0];
  state.dealer = Math.floor(rng() * 2);
}

function pistiNewHand(state, rng) {
  var deck = shuffledCards(rng);
  state.dealer = 1 - state.dealer;
  state.pile = deck.slice(0, 4); // ilk 3 kapalı
  state.hiddenBase = 3; // yerin dibindeki kapalı kart sayısı (alınana kadar)
  state.deck = deck.slice(4);
  state.hands = [[], []];
  state.captured = [[], []];
  state.pistis = [[], []]; // her pişti: 10 ya da 20
  state.lastTaker = -1;
  state.lastPlay = null;
  pistiDeal(state);
  state.turn = 1 - state.dealer; // dağıtanın karşısı başlar
  state.turnSerial++;
}

function pistiDeal(state) {
  var hands = [state.hands[0].slice(), state.hands[1].slice()];
  for (var r = 0; r < 4; r++) {
    for (var p = 0; p < 2; p++) {
      if (!state.deck.length) break;
      hands[p].push(state.deck[state.deck.length - 1]);
      state.deck = state.deck.slice(0, -1);
    }
  }
  state.hands = hands;
}

/** Kart atar. Hata metni ya da null. */
function pistiPlay(state, seat, id) {
  if (seat !== state.turn) return 'Sıra sende değil';
  var hand = state.hands[seat];
  if (hand.indexOf(id) < 0) return 'Bu kart elinde yok';
  var hands = state.hands.slice();
  hands[seat] = withoutCard(hand, id);
  state.hands = hands;
  var pile = state.pile;
  var top = pile.length ? pile[pile.length - 1] : null;
  var take = top !== null && (cardRank(id) === cardRank(top) || cardRank(id) === JACK);
  var pisti = 0;
  if (take && pile.length === 1 && cardRank(id) === cardRank(top)) pisti = cardRank(id) === JACK ? 20 : 10;
  state.lastPlay = { seat: seat, card: id, took: take ? 1 : 0, pisti: pisti };
  if (take) {
    var captured = state.captured.slice();
    captured[seat] = captured[seat].concat(pile, [id]);
    state.captured = captured;
    state.pile = [];
    state.hiddenBase = 0;
    state.lastTaker = seat;
    if (pisti) {
      var pistis = state.pistis.slice();
      pistis[seat] = pistis[seat].concat([pisti]);
      state.pistis = pistis;
    }
  } else {
    state.pile = pile.concat([id]);
  }
  // Eller bittiyse dağıt; deste de bittiyse el sonu.
  if (!state.hands[0].length && !state.hands[1].length) {
    if (state.deck.length) {
      pistiDeal(state);
    } else {
      pistiEndHand(state);
      return null;
    }
  }
  state.turn = 1 - seat;
  state.turnSerial++;
  return null;
}

/** El puanları: [{cards, aces, jacks, two, ten, pistis, most, total}, …] */
function pistiScore(captured, pistis) {
  var out = [];
  for (var p = 0; p < 2; p++) {
    var aces = 0;
    var jacks = 0;
    var two = 0;
    var ten = 0;
    for (var i = 0; i < captured[p].length; i++) {
      var c = captured[p][i];
      if (cardRank(c) === ACE) aces++;
      if (cardRank(c) === JACK) jacks++;
      if (c === cardId(CLUBS, 2)) two = 2;
      if (c === cardId(DIAMONDS, 10)) ten = 3;
    }
    var pp = 0;
    for (var k = 0; k < pistis[p].length; k++) pp += pistis[p][k];
    out.push({ cards: captured[p].length, aces: aces, jacks: jacks, two: two, ten: ten, pistis: pp, most: 0, total: 0 });
  }
  if (out[0].cards > out[1].cards) out[0].most = 3;
  else if (out[1].cards > out[0].cards) out[1].most = 3;
  for (var q = 0; q < 2; q++) {
    var o = out[q];
    o.total = o.aces + o.jacks + o.two + o.ten + o.pistis + o.most;
  }
  return out;
}

function pistiEndHand(state) {
  // Yerde kalanlar son alana
  if (state.pile.length && state.lastTaker >= 0) {
    var captured = state.captured.slice();
    captured[state.lastTaker] = captured[state.lastTaker].concat(state.pile);
    state.captured = captured;
    state.pile = [];
  }
  var breakdown = pistiScore(state.captured, state.pistis);
  var scores = [state.scores[0] + breakdown[0].total, state.scores[1] + breakdown[1].total];
  state.scores = scores;
  var over = (scores[0] >= PISTI_TARGET || scores[1] >= PISTI_TARGET) && scores[0] !== scores[1];
  state.handResult = {
    breakdown: breakdown,
    scores: scores,
    gameOver: over,
    winners: over ? [scores[0] > scores[1] ? 0 : 1] : [],
  };
}

/** Bot: yeri alabiliyorsa alır (pişti öncelikli), valeyi değerli yere saklar. */
function pistiBotCard(state, seat) {
  var hand = state.hands[seat];
  var pile = state.pile;
  var top = pile.length ? pile[pile.length - 1] : null;
  var value = function (cards) {
    var v = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (cardRank(c) === ACE || cardRank(c) === JACK) v += 1;
      if (c === cardId(CLUBS, 2)) v += 2;
      if (c === cardId(DIAMONDS, 10)) v += 3;
    }
    return v + cards.length * 0.15;
  };
  if (top !== null) {
    for (var i = 0; i < hand.length; i++) if (cardRank(hand[i]) === cardRank(top) && cardRank(hand[i]) !== JACK) return hand[i];
    for (var j = 0; j < hand.length; j++) {
      if (cardRank(hand[j]) === JACK && (value(pile) >= 2 || pile.length >= 4 || cardRank(top) === JACK)) return hand[j];
    }
  }
  // Alamıyorsa: vale olmayan, en az değerli kart; yer boşsa rakibin pişti yapma ihtimali düşük olanı
  var seen = {};
  var all = state.captured[0].concat(state.captured[1], pile);
  for (var s = 0; s < all.length; s++) seen[cardRank(all[s])] = (seen[cardRank(all[s])] || 0) + 1;
  var best = null;
  var bestScore = Infinity;
  for (var k = 0; k < hand.length; k++) {
    var c = hand[k];
    if (cardRank(c) === JACK && hand.length > 1) continue;
    var risk = value([c]) * 3 - (seen[cardRank(c)] || 0);
    if (risk < bestScore) {
      bestScore = risk;
      best = c;
    }
  }
  return best === null ? hand[0] : best;
}

var PISTI = {
  id: 'pisti',
  seats: 2,
  modes: ['tekli'],
  turnMs: 15000,
  newMatch: pistiNewMatch,
  newHand: pistiNewHand,
  move: function (state, seat, body, ctx) {
    return pistiPlay(state, seat, body.card);
  },
  auto: function (state, seat, ctx) {
    pistiPlay(state, seat, pistiBotCard(state, seat));
  },
  view: function (state, seat) {
    var pile = state.pile || [];
    var hidden = Math.min(state.hiddenBase || 0, pile.length);
    return {
      hand: (state.hands[seat] || []).map(cardView),
      oppCount: (state.hands[1 - seat] || []).length,
      // Yerdeki açık kartlar (kapalı dipteki 3 kart gizli)
      pile: pile.slice(hidden).map(cardView),
      pileHidden: hidden,
      deck: (state.deck || []).length,
      captured: [state.captured[0].length, state.captured[1].length],
      pistis: state.pistis,
      scores: state.scores,
      target: PISTI_TARGET,
      lastPlay: state.lastPlay ? { seat: state.lastPlay.seat, card: cardView(state.lastPlay.card), took: state.lastPlay.took, pisti: state.lastPlay.pisti } : null,
    };
  },
};

registerCardGame(PISTI);

// Nakama işleyicileri üst düzey fonksiyon olmalı.
function pistiMatchInit(ctx, logger, nk, params) {
  return kInit('pisti', ctx, logger, nk, params);
}
