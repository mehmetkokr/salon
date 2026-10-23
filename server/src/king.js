// King (genel kurallar). Dört kişi, 13'er kart, maç 20 oyun.
//
// Her oyunda sırası gelen oyuncu bir sözleşme seçer ve ilk eli açar:
//   el     → El almaz: alınan her el −50
//   kupa   → Kupa almaz: alınan her kupa −30
//   erkek  → Erkek almaz: alınan her papaz ve vale −60
//   kiz    → Kız almaz: alınan her kız −100
//   rifki  → Rıfkı: kupa papazını alan −320
//   soniki → Son iki: son iki elin her biri −180
//   koz    → Koz: seçen kozu belirler, alınan her el +50
// Her oyuncu en fazla 2 koz ve 3 ceza seçer; her ceza maçta en fazla 2 kez oynanır.
// (4 × 2 koz + 6 × 2 ceza = 20 oyun.)
//
// Oyun: renge uymak zorunlu. Kozda renk yoksa koz atmak zorunlu ve koz
// çıkmadan kozla el açılmaz. Kupa almaz ve rıfkıda kupa çıkmadan kupayla
// açılmaz; rıfkıda rengi olmayan, elinde kupa papazı varsa onu atmak zorunda.
// Bütün ceza kartları alınınca o oyun erken biter.

var KING_GAMES = 20;
var KING_CONTRACTS = ['el', 'kupa', 'erkek', 'kiz', 'rifki', 'soniki', 'koz'];
var KING_PENALTIES = ['el', 'kupa', 'erkek', 'kiz', 'rifki', 'soniki'];
var KING_LIMITS = { koz: 2, ceza: 3, perPenalty: 2 };
var KING_NAMES = {
  el: 'El almaz',
  kupa: 'Kupa almaz',
  erkek: 'Erkek almaz',
  kiz: 'Kız almaz',
  rifki: 'Rıfkı',
  soniki: 'Son iki',
  koz: 'Koz',
};
var RIFKI = 1 * 13 + (13 - 2); // kupa papazı

function kingNewMatch(state, rng) {
  state.scores = [0, 0, 0, 0];
  state.firstChooser = Math.floor(rng() * 4);
  state.kozUsed = [0, 0, 0, 0];
  state.cezaUsed = [0, 0, 0, 0];
  state.penaltyUsed = { el: 0, kupa: 0, erkek: 0, kiz: 0, rifki: 0, soniki: 0 };
  state.history = []; // [{chooser, contract, trump}]
}

function kingNewHand(state, rng) {
  var deck = shuffledCards(rng);
  var hands = [[], [], [], []];
  for (var i = 0; i < 52; i++) hands[i % 4].push(deck[i]);
  for (var h = 0; h < 4; h++) hands[h].sort(batakSortCards);
  state.hands = hands;
  state.chooser = (state.firstChooser + state.handNo - 1) % 4;
  state.contract = null;
  state.trump = -1;
  state.broken = false; // koz ya da kupa çıktı mı
  state.trick = [];
  state.lastTrick = null;
  state.tricks = [0, 0, 0, 0];
  state.taken = [[], [], [], []]; // alınan kartlar
  state.trickNo = 0;
  state.lastTwo = [0, 0, 0, 0];
  state.stage = 'choose';
  state.turn = state.chooser;
  state.turnSerial++;
}

/** Seçicinin seçebileceği sözleşmeler. */
function kingAllowed(state, seat) {
  var out = [];
  for (var i = 0; i < KING_CONTRACTS.length; i++) {
    var c = KING_CONTRACTS[i];
    if (c === 'koz') {
      if (state.kozUsed[seat] < KING_LIMITS.koz) out.push(c);
    } else if (state.cezaUsed[seat] < KING_LIMITS.ceza && state.penaltyUsed[c] < KING_LIMITS.perPenalty) {
      out.push(c);
    }
  }
  // Kalan haklar bitmediyse ama hiçbiri uymuyorsa (pratikte olmaz) hepsine izin ver.
  return out.length ? out : KING_CONTRACTS.slice();
}

function kingChoose(state, seat, body) {
  if (state.stage !== 'choose') return 'Şu an seçim sırası değil';
  if (seat !== state.chooser) return 'Bu oyunu sırası gelen seçer';
  var c = String(body.contract || '');
  if (kingAllowed(state, seat).indexOf(c) < 0) return 'Bu sözleşme artık seçilemez';
  if (c === 'koz') {
    var t = parseInt(body.trump, 10);
    if (!(t >= 0 && t <= 3)) return 'Kozu seç';
    state.trump = t;
    var kz = state.kozUsed.slice();
    kz[seat]++;
    state.kozUsed = kz;
  } else {
    var cz = state.cezaUsed.slice();
    cz[seat]++;
    state.cezaUsed = cz;
    var pu = JSON.parse(JSON.stringify(state.penaltyUsed));
    pu[c]++;
    state.penaltyUsed = pu;
  }
  state.contract = c;
  state.history = state.history.concat([{ chooser: seat, contract: c, trump: state.trump }]);
  state.stage = 'play';
  state.turn = seat;
  state.turnSerial++;
  return null;
}

function kingLegal(state, seat) {
  if (state.stage !== 'play' || seat !== state.turn) return [];
  var hand = state.hands[seat];
  var c = state.contract;
  var blockSuit = c === 'koz' ? state.trump : c === 'kupa' || c === 'rifki' ? HEARTS : -1;
  if (!state.trick.length) {
    if (blockSuit >= 0 && !state.broken) {
      var other = hand.filter(function (x) {
        return cardSuit(x) !== blockSuit;
      });
      if (other.length) return other;
    }
    return hand.slice();
  }
  var led = cardSuit(state.trick[0].card);
  var follow = hand.filter(function (x) {
    return cardSuit(x) === led;
  });
  if (follow.length) return follow;
  if (c === 'koz') {
    var trumps = hand.filter(function (x) {
      return cardSuit(x) === state.trump;
    });
    if (trumps.length) return trumps;
  }
  if (c === 'rifki' && hand.indexOf(RIFKI) >= 0) return [RIFKI];
  return hand.slice();
}

/** Bu oyunda cezalı kart mı? */
function kingPenaltyCard(contract, card) {
  if (contract === 'kupa') return cardSuit(card) === HEARTS;
  if (contract === 'erkek') return cardRank(card) === 13 || cardRank(card) === 11;
  if (contract === 'kiz') return cardRank(card) === 12;
  if (contract === 'rifki') return card === RIFKI;
  return false;
}

var KING_PENALTY_TOTAL = { kupa: 13, erkek: 8, kiz: 4, rifki: 1 };

function kingPlay(state, seat, id) {
  if (state.stage !== 'play') return 'Şu an kart atma sırası değil';
  if (seat !== state.turn) return 'Sıra sende değil';
  if (state.hands[seat].indexOf(id) < 0) return 'Bu kart elinde yok';
  if (kingLegal(state, seat).indexOf(id) < 0) return kingWhyNot(state, seat, id);
  var hands = state.hands.slice();
  hands[seat] = withoutCard(hands[seat], id);
  state.hands = hands;
  var blockSuit = state.contract === 'koz' ? state.trump : state.contract === 'kupa' || state.contract === 'rifki' ? HEARTS : -1;
  if (blockSuit >= 0 && cardSuit(id) === blockSuit) state.broken = true;
  state.trick = state.trick.concat([{ seat: seat, card: id }]);
  if (state.trick.length < 4) {
    state.turn = (seat + 1) % 4;
    state.turnSerial++;
    return null;
  }
  var w = batakTrickWinner(state.trick, state.contract === 'koz' ? state.trump : -1);
  var tricks = state.tricks.slice();
  tricks[w.seat]++;
  state.tricks = tricks;
  var taken = state.taken.slice();
  taken[w.seat] = taken[w.seat].concat(state.trick.map(function (p) {
    return p.card;
  }));
  state.taken = taken;
  state.trickNo++;
  if (state.trickNo >= 12) {
    var lt = state.lastTwo.slice();
    lt[w.seat]++;
    state.lastTwo = lt;
  }
  state.lastTrick = { winner: w.seat, cards: state.trick };
  state.trick = [];
  if (!state.hands[0].length || kingAllPenaltiesTaken(state)) {
    kingEndHand(state);
    return null;
  }
  state.turn = w.seat;
  state.turnSerial++;
  return null;
}

function kingAllPenaltiesTaken(state) {
  var need = KING_PENALTY_TOTAL[state.contract];
  if (!need) return false;
  var n = 0;
  for (var s = 0; s < 4; s++) {
    for (var i = 0; i < state.taken[s].length; i++) if (kingPenaltyCard(state.contract, state.taken[s][i])) n++;
  }
  return n >= need;
}

function kingWhyNot(state, seat, id) {
  if (!state.trick.length) return state.contract === 'koz' ? 'Koz çıkmadan kozla el açılmaz' : 'Kupa çıkmadan kupayla el açılmaz';
  var led = cardSuit(state.trick[0].card);
  var hand = state.hands[seat];
  if (hand.some(function (x) { return cardSuit(x) === led; })) return 'Açılan renge uymalısın';
  if (state.contract === 'koz') return 'Renk yoksa koz atmalısın';
  return 'Rıfkıda rengin yoksa kupa papazını atmalısın';
}

/** Oyun puanları (koltuk sırasıyla). */
function kingHandPoints(state) {
  var pts = [0, 0, 0, 0];
  var c = state.contract;
  for (var s = 0; s < 4; s++) {
    var taken = state.taken[s];
    var count = function (pred) {
      var n = 0;
      for (var i = 0; i < taken.length; i++) if (pred(taken[i])) n++;
      return n;
    };
    if (c === 'el') pts[s] = -50 * state.tricks[s];
    else if (c === 'kupa') pts[s] = -30 * count(function (x) { return cardSuit(x) === HEARTS; });
    else if (c === 'erkek') pts[s] = -60 * count(function (x) { return cardRank(x) === 13 || cardRank(x) === 11; });
    else if (c === 'kiz') pts[s] = -100 * count(function (x) { return cardRank(x) === 12; });
    else if (c === 'rifki') pts[s] = taken.indexOf(RIFKI) >= 0 ? -320 : 0;
    else if (c === 'soniki') pts[s] = -180 * state.lastTwo[s];
    else if (c === 'koz') pts[s] = 50 * state.tricks[s];
  }
  return pts;
}

function kingEndHand(state) {
  var pts = kingHandPoints(state);
  var scores = state.scores.slice();
  for (var i = 0; i < 4; i++) scores[i] += pts[i];
  state.scores = scores;
  var over = state.handNo >= KING_GAMES;
  var winners = [];
  if (over) {
    var best = Math.max(scores[0], scores[1], scores[2], scores[3]);
    for (var w = 0; w < 4; w++) if (scores[w] === best) winners.push(w);
  }
  state.stage = 'done';
  state.handResult = {
    contract: state.contract,
    contractName: KING_NAMES[state.contract],
    trump: state.trump,
    chooser: state.chooser,
    tricks: state.tricks,
    points: pts,
    scores: scores,
    gameOver: over,
    winners: winners,
  };
}

// ---------------------------------------------------------------- Bot

/** Bu el o cezada kabaca ne kadar risk taşır (yüksek kötü). */
function kingRisk(hand, contract) {
  var risk = 0;
  var bySuit = [0, 0, 0, 0];
  for (var i = 0; i < hand.length; i++) bySuit[cardSuit(hand[i])]++;
  for (var j = 0; j < hand.length; j++) {
    var c = hand[j];
    var r = cardRank(c);
    var high = r >= 11 ? (r - 10) * 0.6 : 0;
    var short = bySuit[cardSuit(c)] <= 2 ? 1.4 : 1; // kısa renkte yüksek kart tehlikeli
    if (contract === 'el' || contract === 'soniki') risk += high * short;
    else if (contract === 'kupa' && cardSuit(c) === HEARTS) risk += 0.5 + high;
    else if (contract === 'erkek' && (r === 13 || r === 11)) risk += 1.6 * short;
    else if (contract === 'kiz' && r === 12) risk += 2.5 * short;
    else if (contract === 'rifki' && c === RIFKI) risk += bySuit[HEARTS] <= 3 ? 8 : 3;
  }
  return risk;
}

function kingBotChoice(state, seat) {
  var allowed = kingAllowed(state, seat);
  var hand = state.hands[seat];
  if (allowed.indexOf('koz') >= 0) {
    var bt = batakBestTrump(hand);
    // Koz hakkı biterse (son seçimlerde) zorunlu olarak kullanılır.
    var left = 5 - state.history.filter(function (h) { return h.chooser === seat; }).length;
    var kozLeft = KING_LIMITS.koz - state.kozUsed[seat];
    if (bt.estimate >= 5 || kozLeft >= left) return { contract: 'koz', trump: bt.suit };
  }
  var best = null;
  var bestRisk = Infinity;
  for (var i = 0; i < allowed.length; i++) {
    if (allowed[i] === 'koz') continue;
    var r = kingRisk(hand, allowed[i]) * (allowed[i] === 'rifki' ? 1.2 : 1);
    if (r < bestRisk) {
      bestRisk = r;
      best = allowed[i];
    }
  }
  if (best === null) return { contract: 'koz', trump: batakBestTrump(hand).suit };
  return { contract: best };
}

function kingBotCard(state, seat) {
  var legal = kingLegal(state, seat);
  if (state.contract === 'koz') {
    // Koz: batak botu gibi kazanmaya oyna (King kuralına uymuyorsa ilk geçerli kart).
    state.trumpBroken = state.broken;
    var pick = batakBotCard(state, seat);
    return legal.indexOf(pick) >= 0 ? pick : legal[0];
  }
  var c = state.contract;
  var rankDesc = function (a, b) {
    return cardRank(b) - cardRank(a);
  };
  var rankAsc = function (a, b) {
    return cardRank(a) - cardRank(b);
  };
  if (!state.trick.length) {
    // En küçük cezasız kartla aç
    var safe = legal.filter(function (x) {
      return !kingPenaltyCard(c, x);
    });
    return (safe.length ? safe : legal).slice().sort(rankAsc)[0];
  }
  var led = cardSuit(state.trick[0].card);
  var following = cardSuit(legal[0]) === led;
  if (following) {
    // Eli almayacak en büyük kartı at; hepsi alıyorsa en küçüğü.
    var best = batakTrickWinner(state.trick, -1);
    var under = legal.filter(function (x) {
      return cardRank(x) < cardRank(best.card);
    }).sort(rankDesc);
    if (under.length) return under[0];
    // Son oyuncuysa ve el zaten alınacaksa cezasız en büyüğü at
    return legal.slice().sort(state.trick.length === 3 ? rankDesc : rankAsc)[0];
  }
  // Renk yok: önce ceza kartını, sonra en büyük kartı kaçır
  var pen = legal.filter(function (x) {
    return kingPenaltyCard(c, x);
  }).sort(rankDesc);
  if (pen.length) return pen[0];
  return legal.slice().sort(rankDesc)[0];
}

var KING = {
  id: 'king',
  seats: 4,
  modes: ['tekli'],
  turnMs: 20000,
  newMatch: kingNewMatch,
  newHand: kingNewHand,
  move: function (state, seat, body, ctx) {
    if (body.card !== undefined) return kingPlay(state, seat, body.card);
    if (body.contract !== undefined) return kingChoose(state, seat, body);
    return 'Bilinmeyen hamle';
  },
  auto: function (state, seat, ctx) {
    if (state.stage === 'choose') kingChoose(state, seat, kingBotChoice(state, seat));
    else if (state.stage === 'play') kingPlay(state, seat, kingBotCard(state, seat));
  },
  view: function (state, seat) {
    return {
      stage: state.stage,
      hand: (state.hands[seat] || []).map(cardView),
      legal: kingLegal(state, seat),
      allowed: state.stage === 'choose' && seat === state.chooser ? kingAllowed(state, seat) : [],
      chooser: state.chooser,
      contract: state.contract,
      trump: state.trump,
      trick: state.trick.map(function (p) {
        return { seat: p.seat, card: cardView(p.card) };
      }),
      lastTrick: state.lastTrick
        ? { winner: state.lastTrick.winner, cards: state.lastTrick.cards.map(function (p) { return { seat: p.seat, card: cardView(p.card) }; }) }
        : null,
      tricks: state.tricks,
      scores: state.scores,
      games: KING_GAMES,
      kozUsed: state.kozUsed,
      cezaUsed: state.cezaUsed,
      penaltyUsed: state.penaltyUsed,
    };
  },
};

registerCardGame(KING);

function kingMatchInit(ctx, logger, nk, params) {
  return kInit('king', ctx, logger, nk, params);
}
