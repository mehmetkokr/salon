// Batak (genel kurallar). Dört kişi, 13'er kart, saat yönünde oynanır.
//
// Türler:
//   koz      → Batak (koz maça): koz her zaman maça; herkes kaç el alacağını
//              söyler (söz). Tutturan aldığı el kadar puan alır, tutturamayan
//              sözü kadar kaybeder.
//   ihaleli  → Tekli ihaleli: ihale en az 5. İhaleyi alan kozu seçer ve ilk eli
//              açar. Yaparsa aldığı el kadar, yapamazsa ihale kadar eksi.
//              Diğerleri aldığı el kadar puan alır. Herkes pas derse yeniden dağıtılır.
//   esli     → Eşli ihaleli: 0-2 ve 1-3 takım; ihale en az 7; takımın elleri sayılır.
//
// Oyun kuralları: renge uymak zorunlu, mümkünse yükseltmek zorunlu. Renk yoksa koz
// atmak zorunlu, kozlanmış ele mümkünse daha büyük koz. Koz oyunda çıkmadan kozla
// el açılmaz (elde yalnız koz kalmadıysa). Eli en büyük koz, koz yoksa açılan
// rengin en büyüğü alır; eli alan yeni eli açar. Oyun 5 el sürer.

var BATAK_HANDS = 5;
var BATAK_MIN_BID = { ihaleli: 5, esli: 7 };

function batakNewMatch(state, rng) {
  state.scores = [0, 0, 0, 0];
  state.dealer = Math.floor(rng() * 4);
}

function batakNewHand(state, rng) {
  state.dealer = (state.dealer + 1) % 4;
  var deck = shuffledCards(rng);
  var hands = [[], [], [], []];
  for (var i = 0; i < 52; i++) hands[i % 4].push(deck[i]);
  for (var h = 0; h < 4; h++) hands[h].sort(batakSortCards);
  state.hands = hands;
  state.bids = [null, null, null, null]; // sayı ya da 'pas'
  state.highBid = 0;
  state.declarer = -1;
  state.trump = state.mode === 'koz' ? SPADES : -1;
  state.trumpBroken = false;
  state.trick = []; // [{seat, card}]
  state.lastTrick = null;
  state.tricks = [0, 0, 0, 0];
  state.leader = -1;
  state.stage = 'bid';
  state.turn = (state.dealer + 1) % 4;
  state.turnSerial++;
}

function batakSortCards(a, b) {
  return cardSuit(a) !== cardSuit(b) ? cardSuit(a) - cardSuit(b) : cardRank(b) - cardRank(a);
}

function batakTeams(state) {
  return state.mode === 'esli';
}

// ---------------------------------------------------------------- Söz / ihale

function batakBid(state, seat, body) {
  if (state.stage !== 'bid') return 'Şu an söz/ihale sırası değil';
  if (seat !== state.turn) return 'Sıra sende değil';
  if (state.mode === 'koz') {
    var n = parseInt(body.bid, 10);
    if (!(n >= 1 && n <= 13)) return 'Söz 1 ile 13 arasında olmalı';
    var bids = state.bids.slice();
    bids[seat] = n;
    state.bids = bids;
    var next = (seat + 1) % 4;
    if (next === (state.dealer + 1) % 4) {
      // Herkes söyledi: dağıtanın yanındaki açar.
      state.stage = 'play';
      state.leader = next;
      state.turn = next;
    } else {
      state.turn = next;
    }
    state.turnSerial++;
    return null;
  }
  // İhaleli / eşli
  var min = BATAK_MIN_BID[state.mode];
  var list = state.bids.slice();
  if (body.pass) {
    list[seat] = 'pas';
  } else {
    var b = parseInt(body.bid, 10);
    var floor = Math.max(min, state.highBid + 1);
    if (!(b >= floor && b <= 13)) return 'İhale en az ' + floor + ' olmalı';
    list[seat] = b;
    state.highBid = b;
    state.declarer = seat;
  }
  state.bids = list;
  var active = [];
  for (var i = 0; i < 4; i++) if (list[i] !== 'pas') active.push(i);
  if (active.length === 0) {
    // Herkes pas: yeniden dağıt (aynı dağıtan).
    state.redeal = true;
    return null;
  }
  if (active.length === 1 && state.declarer === active[0]) {
    state.stage = 'trump';
    state.turn = state.declarer;
    state.turnSerial++;
    return null;
  }
  // Sıradaki pas dememiş oyuncu
  var nextSeat = seat;
  for (var k = 0; k < 4; k++) {
    nextSeat = (nextSeat + 1) % 4;
    if (list[nextSeat] !== 'pas') break;
  }
  state.turn = nextSeat;
  state.turnSerial++;
  return null;
}

function batakChooseTrump(state, seat, body) {
  if (state.stage !== 'trump') return 'Şu an koz seçimi değil';
  if (seat !== state.declarer) return 'Kozu ihaleyi alan seçer';
  var suit = parseInt(body.trump, 10);
  if (!(suit >= 0 && suit <= 3)) return 'Geçersiz koz';
  state.trump = suit;
  state.stage = 'play';
  state.leader = seat;
  state.turn = seat;
  state.turnSerial++;
  return null;
}

// ---------------------------------------------------------------- Oyun

/** Bu oyuncunun şu an atabileceği kartlar. */
function batakLegal(state, seat) {
  var hand = state.hands[seat];
  if (state.stage !== 'play' || seat !== state.turn) return [];
  var trump = state.trump;
  if (!state.trick.length) {
    // El açma: koz çıkmadıysa kozla açılmaz (elde yalnız koz yoksa)
    if (!state.trumpBroken) {
      var nonTrump = hand.filter(function (c) {
        return cardSuit(c) !== trump;
      });
      if (nonTrump.length) return nonTrump;
    }
    return hand.slice();
  }
  var led = cardSuit(state.trick[0].card);
  var best = batakTrickWinner(state.trick, trump);
  var bestCard = best.card;
  var follow = hand.filter(function (c) {
    return cardSuit(c) === led;
  });
  if (follow.length) {
    // Kozlanmamışsa rengin en büyüğünü geçmek zorunlu (mümkünse)
    if (cardSuit(bestCard) === led) {
      var higher = follow.filter(function (c) {
        return cardRank(c) > cardRank(bestCard);
      });
      if (higher.length) return higher;
    }
    return follow;
  }
  var trumps = hand.filter(function (c) {
    return cardSuit(c) === trump;
  });
  if (trumps.length) {
    if (cardSuit(bestCard) === trump) {
      var over = trumps.filter(function (c) {
        return cardRank(c) > cardRank(bestCard);
      });
      if (over.length) return over;
    }
    return trumps;
  }
  return hand.slice();
}

/** Eldeki en güçlü kart: {seat, card}. */
function batakTrickWinner(trick, trump) {
  var led = cardSuit(trick[0].card);
  var best = trick[0];
  for (var i = 1; i < trick.length; i++) {
    var p = trick[i];
    var ps = cardSuit(p.card);
    var bs = cardSuit(best.card);
    if (ps === trump && bs !== trump) best = p;
    else if (ps === bs && cardRank(p.card) > cardRank(best.card)) best = p;
    else if (ps === led && bs !== trump && bs !== led) best = p;
  }
  return best;
}

function batakPlay(state, seat, id) {
  if (state.stage !== 'play') return 'Şu an kart atma sırası değil';
  if (seat !== state.turn) return 'Sıra sende değil';
  if (state.hands[seat].indexOf(id) < 0) return 'Bu kart elinde yok';
  if (batakLegal(state, seat).indexOf(id) < 0) return batakWhyNot(state, seat, id);
  var hands = state.hands.slice();
  hands[seat] = withoutCard(hands[seat], id);
  state.hands = hands;
  if (cardSuit(id) === state.trump) state.trumpBroken = true;
  state.trick = state.trick.concat([{ seat: seat, card: id }]);
  if (state.trick.length < 4) {
    state.turn = (seat + 1) % 4;
    state.turnSerial++;
    return null;
  }
  var w = batakTrickWinner(state.trick, state.trump);
  var tricks = state.tricks.slice();
  tricks[w.seat]++;
  state.tricks = tricks;
  state.lastTrick = { winner: w.seat, cards: state.trick };
  state.trick = [];
  if (!state.hands[0].length) {
    batakEndHand(state);
    return null;
  }
  state.turn = w.seat;
  state.turnSerial++;
  return null;
}

function batakWhyNot(state, seat, id) {
  if (!state.trick.length) return 'Koz çıkmadan kozla el açılmaz';
  var led = cardSuit(state.trick[0].card);
  var hand = state.hands[seat];
  var hasLed = hand.some(function (c) {
    return cardSuit(c) === led;
  });
  if (hasLed && cardSuit(id) !== led) return 'Açılan renge uymalısın';
  if (hasLed) return 'Elindeki daha büyük kartla yükseltmelisin';
  var hasTrump = hand.some(function (c) {
    return cardSuit(c) === state.trump;
  });
  if (hasTrump && cardSuit(id) !== state.trump) return 'Renk yoksa koz atmalısın';
  return 'Daha büyük kozla yükseltmelisin';
}

/** El puanları. Eşlide takım elleri sayılır (0-2, 1-3). */
function batakHandPoints(state) {
  var pts = [0, 0, 0, 0];
  var t = state.tricks;
  if (state.mode === 'koz') {
    for (var i = 0; i < 4; i++) pts[i] = t[i] >= state.bids[i] ? t[i] : -state.bids[i];
    return pts;
  }
  if (state.mode === 'ihaleli') {
    for (var j = 0; j < 4; j++) {
      if (j === state.declarer) pts[j] = t[j] >= state.highBid ? t[j] : -state.highBid;
      else pts[j] = t[j];
    }
    return pts;
  }
  // eşli
  var team = [t[0] + t[2], t[1] + t[3]];
  var dTeam = state.declarer % 2;
  var teamPts = [0, 0];
  teamPts[dTeam] = team[dTeam] >= state.highBid ? team[dTeam] : -state.highBid;
  teamPts[1 - dTeam] = team[1 - dTeam];
  for (var k = 0; k < 4; k++) pts[k] = teamPts[k % 2];
  return pts;
}

function batakEndHand(state) {
  var pts = batakHandPoints(state);
  var scores = state.scores.slice();
  for (var i = 0; i < 4; i++) scores[i] += pts[i];
  state.scores = scores;
  var over = state.handNo >= BATAK_HANDS;
  var winners = [];
  if (over) {
    var best = Math.max(scores[0], scores[1], scores[2], scores[3]);
    for (var w = 0; w < 4; w++) if (scores[w] === best) winners.push(w);
  }
  state.stage = 'done';
  state.handResult = {
    points: pts,
    tricks: state.tricks,
    bids: state.bids,
    declarer: state.declarer,
    highBid: state.highBid,
    trump: state.trump,
    scores: scores,
    gameOver: over,
    winners: winners,
  };
}

// ---------------------------------------------------------------- Bot

/** Elin kaç el alacağını kabaca tahmin eder (verilen kozla). */
function batakEstimate(hand, trump) {
  var est = 0;
  var bySuit = [[], [], [], []];
  for (var i = 0; i < hand.length; i++) bySuit[cardSuit(hand[i])].push(cardRank(hand[i]));
  for (var s = 0; s < 4; s++) {
    var r = bySuit[s].sort(function (a, b) {
      return b - a;
    });
    var len = r.length;
    if (r.indexOf(14) >= 0) est += 1;
    if (r.indexOf(13) >= 0 && len >= 2) est += 0.8;
    if (r.indexOf(12) >= 0 && len >= 3) est += 0.4;
    if (s === trump) {
      est += Math.max(0, len - 3) * 0.9;
      if (r.indexOf(11) >= 0 && len >= 4) est += 0.3;
    } else if (len <= 1 && bySuit[trump] && bySuit[trump].length >= 3) {
      est += 0.5; // kısa renk: kozla kesme şansı
    }
  }
  return est;
}

function batakBestTrump(hand) {
  var best = 0;
  var bestEst = -1;
  for (var s = 0; s < 4; s++) {
    var e = batakEstimate(hand, s);
    if (e > bestEst) {
      bestEst = e;
      best = s;
    }
  }
  return { suit: best, estimate: bestEst };
}

function batakBotAct(state, seat) {
  var hand = state.hands[seat];
  if (state.stage === 'bid') {
    if (state.mode === 'koz') {
      var est = Math.max(1, Math.min(13, Math.round(batakEstimate(hand, SPADES))));
      return batakBid(state, seat, { bid: est });
    }
    var bt = batakBestTrump(hand);
    var estimate = Math.floor(bt.estimate + (state.mode === 'esli' ? 2.5 : 0)); // eşte ortağın payı
    var floor = Math.max(BATAK_MIN_BID[state.mode], state.highBid + 1);
    if (estimate >= floor) return batakBid(state, seat, { bid: floor });
    return batakBid(state, seat, { pass: true });
  }
  if (state.stage === 'trump') return batakChooseTrump(state, seat, { trump: batakBestTrump(hand).suit });
  if (state.stage === 'play') return batakPlay(state, seat, batakBotCard(state, seat));
  return null;
}

function batakBotCard(state, seat) {
  var legal = batakLegal(state, seat);
  var trump = state.trump;
  var lowest = function (cards) {
    return cards.slice().sort(function (a, b) {
      var ta = cardSuit(a) === trump ? 1 : 0;
      var tb = cardSuit(b) === trump ? 1 : 0;
      return ta !== tb ? ta - tb : cardRank(a) - cardRank(b);
    })[0];
  };
  if (!state.trick.length) {
    // As varsa onu aç, yoksa en küçük kart
    var aces = legal.filter(function (c) {
      return cardRank(c) === ACE && cardSuit(c) !== trump;
    });
    return aces.length ? aces[0] : lowest(legal);
  }
  var best = batakTrickWinner(state.trick, trump);
  var partnerWinning = batakTeams(state) && best.seat % 2 === seat % 2;
  if (partnerWinning) return lowest(legal);
  var winners = legal.filter(function (c) {
    return batakTrickWinner(state.trick.concat([{ seat: seat, card: c }]), trump).seat === seat;
  });
  if (winners.length) {
    winners.sort(function (a, b) {
      return cardRank(a) - cardRank(b);
    });
    return winners[0]; // kazandıran en küçük kart
  }
  return lowest(legal);
}

var BATAK = {
  id: 'batak',
  seats: 4,
  modes: ['koz', 'ihaleli', 'esli'],
  turnMs: 20000,
  newMatch: batakNewMatch,
  newHand: batakNewHand,
  move: function (state, seat, body, ctx) {
    var error;
    if (body.card !== undefined) error = batakPlay(state, seat, body.card);
    else if (body.trump !== undefined) error = batakChooseTrump(state, seat, body);
    else if (body.bid !== undefined || body.pass) error = batakBid(state, seat, body);
    else error = 'Bilinmeyen hamle';
    batakAfter(state, ctx);
    return error;
  },
  auto: function (state, seat, ctx) {
    batakBotAct(state, seat);
    batakAfter(state, ctx);
  },
  view: function (state, seat) {
    return {
      stage: state.stage,
      hand: (state.hands[seat] || []).map(cardView),
      legal: batakLegal(state, seat),
      counts: [state.hands[0].length, state.hands[1].length, state.hands[2].length, state.hands[3].length],
      bids: state.bids,
      highBid: state.highBid,
      minBid: BATAK_MIN_BID[state.mode] || 1,
      declarer: state.declarer,
      trump: state.trump,
      trick: state.trick.map(function (p) {
        return { seat: p.seat, card: cardView(p.card) };
      }),
      lastTrick: state.lastTrick
        ? { winner: state.lastTrick.winner, cards: state.lastTrick.cards.map(function (p) { return { seat: p.seat, card: cardView(p.card) }; }) }
        : null,
      tricks: state.tricks,
      scores: state.scores,
      hands: BATAK_HANDS,
      dealer: state.dealer,
    };
  },
};

/** Herkes pas dediyse aynı masada yeniden dağıtılır (el sayılmaz). */
function batakAfter(state, ctx) {
  if (!state.redeal) return;
  state.redeal = false;
  state.dealer = (state.dealer + 3) % 4; // newHand yine aynı dağıtanı seçsin
  batakNewHand(state, ctx.rng);
  ctx.note('Herkes pas dedi, kartlar yeniden dağıtıldı');
}

registerCardGame(BATAK);

function batakMatchInit(ctx, logger, nk, params) {
  return kInit('batak', ctx, logger, nk, params);
}
