// Okey masası: sunucunun yönettiği (authoritative) Nakama maçı.
//
// Bütün kararlar burada verilir: taş dağıtımı, sıra, süre, bitiş kontrolü,
// çip ödemesi. İstemci yalnızca kendi elini ve masanın açık bilgilerini
// görür; hamle isteği gönderir, sunucu kurala uyuyorsa uygular.
//
// Mesaj kodları (opCode):
//   1 → durum (sunucu → oyuncu, her oyuncuya kendi eliyle)
//   2 → taş çek   {from: 'stock' | 'discard'}
//   3 → taş at    {id}
//   4 → bitir     {id}   (bu taşı ortaya atıp eli açar)
//   5 → başlat    {}     (özel odada yalnızca oda sahibi; yeni el de böyle açılır)
//   6 → göstergeyi göster {} (katlamalı: ilk turda göstergenin eşini elinde tutan)
//   9 → uyarı     {msg} (sunucu → oyuncu)
//
// Özel oda: adı, 6 haneli kodu ve isteğe bağlı 4 haneli şifresi vardır. Kodla
// katılmak isteyen oyuncu önce okey_private_join RPC'sinden geçer; sunucu
// şifreyi kontrol edip oyuncuyu odanın izin listesine ekler. Oda sahibi
// "Başlat" deyince boş koltuklara bot oturur ve el başlar. El bitince oda
// kapanmaz; sahibi yeni eli başlatabilir.
//
// Katlamalı okey: herkes 20 puanla başlar. El bitince diğerleri normal
// bitişte 2, okey atarak ya da çift ile bitişte 4, ikisi birden olursa 8 puan
// kaybeder. Göstergenin eşini ilk turunda gösteren diğerlerine 1 puan
// kaybettirir. Biri 0'a düşünce oyun biter, en yüksek puan potu alır
// (eşitlikte pot paylaşılır). Bahis oyunun başında bir kez alınır.
//
// İstemciye gösterilecek hata metinleri "SALON:" önekiyle atılır.

var OP_STATE = 1;
var OP_DRAW = 2;
var OP_DISCARD = 3;
var OP_FINISH = 4;
var OP_START = 5;
var OP_SHOW = 6;
var OP_NOTICE = 9;

var TURN_MS = 20000; // insan oyuncunun hamle süresi
var AUTO_TURN_MS = 2500; // üst üste süre aşımı / bağlantısı kopmuş oyuncu
var BOT_MIN_MS = 900;
var BOT_MAX_MS = 1900;
var FILL_MS = 8000; // bu süre içinde masa dolmazsa boş koltuklara bot oturur
var RESULT_MS = 12000; // sonuç ekranından sonra masa kapanır
var EMPTY_MS = 30000; // hiç bağlı insan kalmazsa masa kapanır
var AUTO_AFTER_TIMEOUTS = 2;
var NEXT_HAND_MS = 7000; // katlamalıda hızlı masada sonraki el bu kadar sonra açılır
var KAT_START = 20;
var MODES = ['duz', 'katlamali', '101'];
var TURN_MS_101 = 35000; // 101'de el açmak zaman alır

var BOT_NAMES = ['Kahveci Rıza', 'Hacer Abla', 'Tavlacı Nuri', 'Sinan Usta', 'Melek Hanım', 'Ziya Bey', 'Leyla', 'Cemil Dayı'];

// Not: Nakama, maç durumunu her çağrı arasında Go tarafına aktarır. Durumdaki
// dizileri yerinde büyütmek (push/pop) kalıcı olmayabilir; bu yüzden diziler
// her değişiklikte yeniden atanır (concat/slice).

// ---------------------------------------------------------------- Yardımcılar

function okeyLabel(state) {
  return JSON.stringify({
    game: 'okey',
    mode: state.mode,
    bet: 'b' + state.bet,
    open: !state.private && state.phase === 'waiting' && seatedCount(state) < 4 ? 1 : 0,
    private: state.private ? 1 : 0,
    code: state.code || '',
  });
}

function seatedCount(state) {
  var n = 0;
  for (var i = 0; i < 4; i++) if (state.seats[i]) n++;
  return n;
}

function seatOfUser(state, userId) {
  for (var i = 0; i < 4; i++) if (state.seats[i] && state.seats[i].userId === userId) return i;
  return -1;
}

function humansConnected(state) {
  var n = 0;
  for (var i = 0; i < 4; i++) {
    var s = state.seats[i];
    if (s && !s.bot && s.connected) n++;
  }
  return n;
}

function prevSeat(seat) {
  return (seat + 3) % 4;
}

function topDiscard(seat) {
  return seat.discards.length ? seat.discards[seat.discards.length - 1] : null;
}

function botDelay(rng) {
  return BOT_MIN_MS + Math.floor(rng() * (BOT_MAX_MS - BOT_MIN_MS));
}

/** Sıra bu oyuncuya geçince ne zamana kadar oynaması gerektiği. */
function turnMs(state) {
  return state.mode === '101' ? TURN_MS_101 : TURN_MS;
}

function turnDeadline(state, seatIndex, now, rng) {
  var s = state.seats[seatIndex];
  if (s.bot) return now + botDelay(rng);
  if (s.auto || !s.connected) return now + AUTO_TURN_MS;
  return now + turnMs(state);
}

// ---------------------------------------------------------------- Görünüm

/** Oyuncuya gönderilen durum. Başkalarının eli ve deste gizlidir. */
function viewFor(state, seatIndex, now) {
  var seats = [];
  for (var i = 0; i < 4; i++) {
    var s = state.seats[i];
    if (!s) {
      seats.push(null);
      continue;
    }
    var top = topDiscard(s);
    seats.push({
      name: s.name,
      level: s.level,
      bot: s.bot ? 1 : 0,
      connected: s.connected ? 1 : 0,
      auto: s.auto ? 1 : 0,
      count: s.hand ? s.hand.length : 0,
      discardTop: top === null ? null : tileOf(top),
      discardCount: s.discards.length,
    });
  }
  var me = seatIndex >= 0 ? state.seats[seatIndex] : null;
  var result = null;
  if (state.result) {
    result = {
      reason: state.result.reason,
      winner: state.result.winner,
      kind: state.result.kind,
      okeyFinish: state.result.okeyFinish ? 1 : 0,
      finishTile: state.result.finishTile === null ? null : tileOf(state.result.finishTile),
      hand: state.result.hand.map(tileOf),
      payouts: state.result.payouts,
      scoreDeltas: state.result.scoreDeltas || null,
      gameOver: state.mode !== 'katlamali' || state.result.gameOver ? 1 : 0,
      gameWinners: state.result.gameWinners || null,
      penalties: state.result.penalties || null,
      elden: state.result.elden ? 1 : 0,
    };
  }
  return {
    phase: state.phase,
    bet: state.bet,
    pot: state.pot,
    you: seatIndex,
    seats: seats,
    turn: state.turn,
    stage: state.stage,
    turnEndsAt: state.turnEndsAt,
    fillAt: state.fillAt,
    serverNow: now,
    stockCount: state.stock.length,
    indicator: state.indicator === null ? null : tileOf(state.indicator),
    okey: state.okey,
    hand: me && me.hand ? me.hand.map(tileOf) : [],
    lastDrawn: me ? me.lastDrawn : null,
    result: result,
    room: state.private
      ? { name: state.name, code: state.code, locked: state.pin ? 1 : 0, host: seatOfUser(state, state.hostUserId) }
      : null,
    mode: state.mode,
    scores: state.mode === 'katlamali' ? state.scores : null,
    handNo: state.handNo,
    nextHandAt: state.nextHandAt,
    canShow: seatIndex >= 0 && showIndicatorError(state, seatIndex) === null ? 1 : 0,
    turnMs: turnMs(state),
    o101: state.mode === '101' && state.phase !== 'waiting' ? view101(state, seatIndex) : null,
  };
}

function broadcastState(state, dispatcher, now) {
  for (var i = 0; i < 4; i++) {
    var s = state.seats[i];
    if (s && !s.bot && s.connected && s.presence) {
      dispatcher.broadcastMessage(OP_STATE, JSON.stringify(viewFor(state, i, now)), [s.presence], null, true);
    }
  }
}

function noticeAll(state, dispatcher, msg) {
  for (var i = 0; i < 4; i++) {
    var s = state.seats[i];
    if (s && !s.bot && s.connected && s.presence) notice(dispatcher, s.presence, msg);
  }
}

function notice(dispatcher, presence, msg) {
  dispatcher.broadcastMessage(OP_NOTICE, JSON.stringify({ msg: msg }), [presence], null, true);
}

// ---------------------------------------------------------------- Oyun akışı

function fillWithBots(state, rng) {
  var used = {};
  for (var i = 0; i < 4; i++) if (state.seats[i]) used[state.seats[i].name] = true;
  for (var j = 0; j < 4; j++) {
    if (state.seats[j]) continue;
    var name;
    do {
      name = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)];
    } while (used[name]);
    used[name] = true;
    state.seats[j] = newSeat('bot:' + j, name, 1 + Math.floor(rng() * 30), true, null);
  }
}

function newSeat(userId, name, level, bot, presence) {
  return {
    userId: userId,
    name: name,
    level: level,
    bot: bot,
    presence: presence,
    connected: !bot,
    auto: false,
    timeouts: 0,
    hand: [],
    discards: [],
    lastDrawn: null,
    paid: false,
  };
}

/** Bahisleri alır, taşları dağıtır. Çipi yetmeyen oyuncunun yerine bot geçer. */
function startGame(state, nk, logger, rng, now) {
  // Yeni el: önceki elden kalan bağlantısı kopmuş oyuncuların yerine bot geçer.
  for (var r = 0; r < 4; r++) {
    var old = state.seats[r];
    if (old && !old.bot && !old.connected) state.seats[r] = null;
  }
  fillWithBots(state, rng);
  var payers = 0;
  for (var i = 0; i < 4; i++) {
    var s = state.seats[i];
    s.hand = [];
    s.discards = [];
    s.lastDrawn = null;
    s.paid = false;
    s.auto = false;
    s.timeouts = 0;
    if (s.bot) continue;
    try {
      nk.walletUpdate(s.userId, { chips: -state.bet }, { reason: 'okey_bahis', match: state.matchId }, true);
      s.paid = true;
      payers++;
    } catch (e) {
      logger.warn('Bahis alınamadı (%s): %s', s.userId, e);
      s.bot = true;
      s.connected = false;
      s.name = s.name + ' (bot)';
    }
  }
  state.pot = state.bet * payers;
  state.scores = [KAT_START, KAT_START, KAT_START, KAT_START];
  state.totals = [0, 0, 0, 0];
  state.handNo = 0;
  state.gameOver = false;
  startHand(state, rng, now);
}

/** Yeni el dağıtır. Katlamalıda oyun sürerken bahis ve puanlar değişmez. */
function startHand(state, rng, now) {
  for (var i = 0; i < 4; i++) {
    var s = state.seats[i];
    s.hand = [];
    s.discards = [];
    s.lastDrawn = null;
    s.moved = false;
    s.shown = false;
    s.auto = s.auto && !s.connected;
    s.timeouts = 0;
  }
  state.handNo = (state.handNo || 0) + 1;
  state.nextHandAt = 0;
  var start = Math.floor(rng() * 4);
  var deal = state.mode === '101' ? deal101(rng, start) : dealOkey(rng, start);
  state.notes = [];
  if (state.mode === '101') reset101Hand(state);
  for (var k = 0; k < 4; k++) state.seats[k].hand = deal.hands[k];
  state.stock = deal.stock;
  state.indicator = deal.indicator;
  state.okey = deal.okey;
  state.result = null;
  state.closeAt = 0;
  state.turn = start;
  state.stage = 'discard'; // başlayan oyuncunun bir fazla taşı var, önce atar
  state.phase = 'playing';
  state.turnEndsAt = turnDeadline(state, start, now, rng);
}

function nextTurn(state, now, rng) {
  state.turn = (state.turn + 1) % 4;
  state.stage = 'draw';
  state.turnEndsAt = turnDeadline(state, state.turn, now, rng);
}

/** Hamle uygular. Geçersizse hata metni döner, geçerliyse null. */
function applyMove(state, seatIndex, move, nk, logger, now, rng) {
  if (state.mode === '101') return applyMove101(state, seatIndex, move, nk, logger, now, rng);
  if (state.phase !== 'playing') return 'Oyun başlamadı';
  if (seatIndex !== state.turn) return 'Sıra sende değil';
  var seat = state.seats[seatIndex];

  if (move.type === 'draw') {
    if (state.stage !== 'draw') return 'Önce bir taş atmalısın';
    var id;
    if (move.from === 'discard') {
      var prev = state.seats[prevSeat(seatIndex)];
      if (!prev.discards.length) return 'Yerde alınacak taş yok';
      id = prev.discards[prev.discards.length - 1];
      prev.discards = prev.discards.slice(0, -1);
    } else {
      if (!state.stock.length) return 'Deste bitti';
      id = state.stock[state.stock.length - 1];
      state.stock = state.stock.slice(0, -1);
    }
    seat.hand = seat.hand.concat([id]);
    seat.lastDrawn = id;
    state.stage = 'discard';
    return null;
  }

  if (move.type === 'discard' || move.type === 'finish') {
    if (state.stage !== 'discard') return 'Önce taş çekmelisin';
    var at = seat.hand.indexOf(move.id);
    if (at < 0) return 'Bu taş elinde yok';
    var rest = seat.hand.slice();
    rest.splice(at, 1);
    if (move.type === 'finish') {
      var kind = winningKind(rest, state.okey);
      if (!kind) return 'Bu el bitmiyor. Taşlarını kontrol et.';
      seat.hand = rest;
      finishGame(state, nk, logger, now, {
        reason: 'win',
        winner: seatIndex,
        kind: kind,
        okeyFinish: isJoker(move.id, state.okey),
        finishTile: move.id,
        hand: rest,
      });
      return null;
    }
    seat.hand = rest;
    seat.discards = seat.discards.concat([move.id]);
    seat.lastDrawn = null;
    seat.moved = true;
    if (!state.stock.length) {
      // Deste bitti, kimse bitiremedi: el berabere. Düzde bahisler iade edilir,
      // katlamalıda puanlar değişmez ve oyun sürer.
      finishGame(state, nk, logger, now, { reason: 'draw', winner: -1, kind: null, okeyFinish: false, finishTile: null, hand: [] });
      return null;
    }
    nextTurn(state, now, rng);
    return null;
  }
  return 'Bilinmeyen hamle';
}

/** El biter. Düz okeyde oyun da biter; katlamalıda puanlar işlenir. */
function finishGame(state, nk, logger, now, result) {
  if (state.mode === 'katlamali') {
    finishKatlamaliHand(state, nk, logger, now, result);
    return;
  }
  settleDuz(state, nk, logger, now, result);
}

/** Bitişin diğer oyunculara kaybettirdiği puan. */
function handPenalty(result) {
  if (result.kind === 'cift' && result.okeyFinish) return 8;
  if (result.kind === 'cift' || result.okeyFinish) return 4;
  return 2;
}

function finishKatlamaliHand(state, nk, logger, now, result) {
  var deltas = [0, 0, 0, 0];
  if (result.reason === 'win') {
    var pen = handPenalty(result);
    for (var i = 0; i < 4; i++) if (i !== result.winner) deltas[i] = -pen;
  }
  var scores = state.scores.slice();
  for (var j = 0; j < 4; j++) scores[j] += deltas[j];
  state.scores = scores;
  result.scoreDeltas = deltas;
  result.payouts = [0, 0, 0, 0];
  var over = false;
  for (var k = 0; k < 4; k++) if (scores[k] <= 0) over = true;
  state.result = result;
  state.phase = 'finished';
  state.turnEndsAt = 0;
  if (!over) {
    result.gameOver = false;
    state.nextHandAt = state.private ? 0 : now + NEXT_HAND_MS;
    state.closeAt = 0;
    return;
  }
  // Oyun bitti: en yüksek puan(lar) potu paylaşır.
  var best = Math.max(scores[0], scores[1], scores[2], scores[3]);
  var winners = [];
  for (var w = 0; w < 4; w++) if (scores[w] === best) winners.push(w);
  result.gameOver = true;
  result.gameWinners = winners;
  state.gameOver = true;
  payGame(state, nk, logger, winners, result);
  state.nextHandAt = 0;
  state.closeAt = state.private ? 0 : now + RESULT_MS;
}

/** Potu kazananlara böler (bota düşen pay dağıtılmaz), XP yazar. */
function payGame(state, nk, logger, winners, result) {
  var payouts = [0, 0, 0, 0];
  for (var i = 0; i < 4; i++) if (state.seats[i].paid) payouts[i] = -state.bet;
  var share = winners.length ? Math.floor(state.pot / winners.length) : 0;
  for (var j = 0; j < winners.length; j++) {
    var seat = state.seats[winners[j]];
    if (!seat.bot && share > 0) {
      safeWallet(nk, logger, seat.userId, share, { reason: 'okey_kazanc', match: state.matchId });
      payouts[winners[j]] += share;
    }
  }
  for (var k = 0; k < 4; k++) {
    var h = state.seats[k];
    if (h.bot) continue;
    try {
      recordGame(nk, h.userId, winners.indexOf(k) >= 0);
    } catch (e) {
      logger.warn('XP yazılamadı: %s', e);
    }
  }
  result.payouts = payouts;
}

/** Göstergenin eşi elde mi ve gösterilebilir mi? Gösterilemiyorsa nedeni. */
function showIndicatorError(state, seatIndex) {
  if (state.mode !== 'katlamali' || state.phase !== 'playing') return 'Gösterge yalnızca katlamalıda gösterilir';
  if (seatIndex !== state.turn) return 'Sıra sende değil';
  var seat = state.seats[seatIndex];
  if (!seat || seat.moved) return 'Gösterge yalnızca ilk turda gösterilir';
  if (seat.shown) return 'Göstergeyi zaten gösterdin';
  if (seat.hand.indexOf(indicatorTwin(state.indicator)) < 0) return 'Elinde göstergenin eşi yok';
  return null;
}

/** Göstergeyle aynı renk ve sayıdaki diğer taş. */
function indicatorTwin(indicatorId) {
  var t = tileOf(indicatorId);
  var base = t.c * 26 + (t.n - 1);
  return indicatorId === base ? base + 13 : base;
}

function showIndicator(state, seatIndex) {
  var error = showIndicatorError(state, seatIndex);
  if (error) return error;
  state.seats[seatIndex].shown = true;
  var scores = state.scores.slice();
  for (var i = 0; i < 4; i++) if (i !== seatIndex) scores[i] -= 1;
  state.scores = scores;
  return null;
}

/** Düz okey: kazanan potu alır; deste biterse bahisler iade edilir. */
function settleDuz(state, nk, logger, now, result) {
  var payouts = [0, 0, 0, 0];
  for (var i = 0; i < 4; i++) {
    var s = state.seats[i];
    if (s.paid) payouts[i] = -state.bet;
  }
  if (result.reason === 'win') {
    var w = state.seats[result.winner];
    if (!w.bot && state.pot > 0) {
      safeWallet(nk, logger, w.userId, state.pot, { reason: 'okey_kazanc', match: state.matchId });
      payouts[result.winner] += state.pot;
    }
  } else {
    for (var j = 0; j < 4; j++) {
      var p = state.seats[j];
      if (p.paid) {
        safeWallet(nk, logger, p.userId, state.bet, { reason: 'okey_iade', match: state.matchId });
        payouts[j] = 0;
      }
    }
  }
  for (var k = 0; k < 4; k++) {
    var h = state.seats[k];
    if (h.bot) continue;
    try {
      recordGame(nk, h.userId, result.winner === k);
    } catch (e) {
      logger.warn('XP yazılamadı: %s', e);
    }
  }
  result.payouts = payouts;
  state.result = result;
  state.phase = 'finished';
  state.turnEndsAt = 0;
  // Hızlı oyun masası sonuçtan sonra kapanır; özel oda yeni el için açık kalır.
  state.closeAt = state.private ? 0 : now + RESULT_MS;
}

function safeWallet(nk, logger, userId, amount, meta) {
  try {
    nk.walletUpdate(userId, { chips: amount }, meta, true);
  } catch (e) {
    logger.error('Çip ödenemedi (%s, %s): %s', userId, amount, e);
  }
}

/** Botun ya da süresi dolan oyuncunun hamlesini sunucu yapar. */
function autoPlay(state, nk, logger, now, rng) {
  if (state.mode === '101') return autoPlay101(state, nk, logger, now, rng);
  var seatIndex = state.turn;
  var seat = state.seats[seatIndex];
  if (seat.bot) showIndicator(state, seatIndex);
  if (state.stage === 'draw') {
    var prev = state.seats[prevSeat(seatIndex)];
    var fromDiscard = seat.bot && botTakesDiscard(seat.hand, topDiscard(prev), state.okey);
    applyMove(state, seatIndex, { type: 'draw', from: fromDiscard ? 'discard' : 'stock' }, nk, logger, now, rng);
  }
  if (state.phase !== 'playing') return;
  var decision = botDecide(seat.hand, state.okey);
  if (decision.finish !== undefined && seat.bot) {
    applyMove(state, seatIndex, { type: 'finish', id: decision.finish }, nk, logger, now, rng);
  } else {
    // Süresi dolan oyuncunun eli onun yerine açılmaz. Bitirecek taş varsa o
    // atılır; elde kalan 14 taş bittiği için oyuncu sonraki turda bitirebilir.
    var id = decision.finish !== undefined ? decision.finish : decision.discard;
    applyMove(state, seatIndex, { type: 'discard', id: id }, nk, logger, now, rng);
  }
}

// ---------------------------------------------------------------- Nakama maç işleyicisi

function okeyMatchInit(ctx, logger, nk, params) {
  params = params || {};
  var bet = parseInt(params.bet, 10) || 100;
  var isPrivate = String(params.private) === '1';
  var mode = MODES.indexOf(String(params.mode)) >= 0 ? String(params.mode) : 'duz';
  var allowed = {};
  if (isPrivate && params.host) allowed[params.host] = true;
  var state = {
    matchId: ctx.matchId,
    mode: mode,
    scores: [KAT_START, KAT_START, KAT_START, KAT_START],
    totals: [0, 0, 0, 0],
    melds: [],
    notes: [],
    handNo: 0,
    nextHandAt: 0,
    gameOver: false,
    private: isPrivate,
    name: isPrivate ? String(params.name || 'Özel oda') : '',
    code: isPrivate ? String(params.code || '') : '',
    pin: isPrivate && params.pin ? String(params.pin) : '',
    hostUserId: isPrivate ? String(params.host || '') : '',
    allowed: allowed,
    bet: bet,
    pot: 0,
    phase: 'waiting',
    seats: [null, null, null, null],
    stock: [],
    indicator: null,
    okey: null,
    turn: -1,
    stage: 'draw',
    turnEndsAt: 0,
    fillAt: 0,
    closeAt: 0,
    emptySince: Date.now(),
    result: null,
  };
  return { state: state, tickRate: 5, label: okeyLabel(state) };
}

function okeyMatchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  if (seatOfUser(state, presence.userId) >= 0) return { state: state, accept: true };
  if (state.private && !state.allowed[presence.userId]) {
    return { state: state, accept: false, rejectMessage: 'Bu odaya kodla katılmalısın' };
  }
  if (!hasRoomFor(state)) {
    return { state: state, accept: false, rejectMessage: 'Masa dolu' };
  }
  if (walletChips(nk, presence.userId) < state.bet) {
    return { state: state, accept: false, rejectMessage: 'Bu masa için çipin yetmiyor' };
  }
  return { state: state, accept: true };
}

function okeyMatchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  var now = Date.now();
  for (var i = 0; i < presences.length; i++) {
    var p = presences[i];
    var at = seatOfUser(state, p.userId);
    if (at >= 0) {
      var back = state.seats[at];
      back.presence = p;
      back.connected = true;
      back.auto = false;
      back.timeouts = 0;
      continue;
    }
    var free = freeSeat(state);
    if (free < 0) continue;
    var level = 1;
    try {
      level = progressOf(nk, p.userId).level;
    } catch (e) {
      logger.warn('Seviye okunamadı: %s', e);
    }
    state.seats[free] = newSeat(p.userId, p.username, level, false, p);
    if (!state.fillAt && !state.private) state.fillAt = now + FILL_MS;
  }
  state.emptySince = 0;
  dispatcher.matchLabelUpdate(okeyLabel(state));
  broadcastState(state, dispatcher, now);
  return { state: state };
}

function okeyMatchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  var now = Date.now();
  for (var i = 0; i < presences.length; i++) {
    var at = seatOfUser(state, presences[i].userId);
    if (at < 0) continue;
    if (state.phase === 'waiting' || (state.private && state.phase === 'finished')) {
      state.seats[at] = null;
    } else {
      state.seats[at].connected = false;
      state.seats[at].presence = null;
    }
  }
  if (state.phase === 'waiting' && seatedCount(state) === 0) state.fillAt = 0;
  if (humansConnected(state) === 0) state.emptySince = now;
  passHostIfGone(state);
  dispatcher.matchLabelUpdate(okeyLabel(state));
  broadcastState(state, dispatcher, now);
  return { state: state };
}

function okeyMatchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  var now = Date.now();
  var rng = Math.random;
  var changed = false;

  if (humansConnected(state) === 0 && state.emptySince && now - state.emptySince > EMPTY_MS) {
    return null; // herkes gitti
  }

  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var seatIndex = seatOfUser(state, m.sender.userId);
    if (seatIndex < 0) continue;
    var body = {};
    try {
      body = JSON.parse(nk.binaryToString(m.data) || '{}');
    } catch (e) {
      body = {};
    }
    if (m.opCode === OP_START) {
      var startError = canStart(state, m.sender.userId);
      if (startError) {
        notice(dispatcher, m.sender, startError);
      } else {
        if (midGame(state)) startHand(state, rng, now);
        else startGame(state, nk, logger, rng, now);
        dispatcher.matchLabelUpdate(okeyLabel(state));
        changed = true;
      }
      continue;
    }
    if (m.opCode === OP_SHOW) {
      var showError = showIndicator(state, seatIndex);
      if (showError) {
        notice(dispatcher, m.sender, showError);
      } else {
        noticeAll(state, dispatcher, state.seats[seatIndex].name + ' göstergeyi gösterdi: diğerleri 1 puan kaybetti');
        changed = true;
      }
      continue;
    }
    var move = null;
    if (m.opCode === OP_DRAW) move = { type: 'draw', from: body.from === 'discard' ? 'discard' : 'stock' };
    if (m.opCode === OP_DISCARD) move = { type: 'discard', id: body.id };
    if (m.opCode === OP_FINISH) move = { type: 'finish', id: body.id };
    if (m.opCode === OP_OPEN) move = { type: 'open', groups: body.groups };
    if (m.opCode === OP_ADD) move = { type: 'add', id: body.id, meld: body.meld };
    if (!move) continue;
    var error = applyMove(state, seatIndex, move, nk, logger, now, rng);
    if (error) {
      notice(dispatcher, m.sender, error);
    } else {
      var seat = state.seats[seatIndex];
      seat.timeouts = 0;
      seat.auto = false;
      changed = true;
    }
  }

  if (state.phase === 'waiting' && !state.private) {
    if (seatedCount(state) === 4 || (state.fillAt && now >= state.fillAt && seatedCount(state) > 0)) {
      startGame(state, nk, logger, rng, now);
      dispatcher.matchLabelUpdate(okeyLabel(state));
      changed = true;
    }
  } else if (state.phase === 'playing' && now >= state.turnEndsAt) {
    var current = state.seats[state.turn];
    if (!current.bot) {
      current.timeouts++;
      if (current.timeouts >= AUTO_AFTER_TIMEOUTS) current.auto = true;
    }
    var shownBefore = current.shown;
    autoPlay(state, nk, logger, now, rng);
    if (current.shown && !shownBefore) {
      noticeAll(state, dispatcher, current.name + ' göstergeyi gösterdi: diğerleri 1 puan kaybetti');
    }
    changed = true;
  } else if (state.phase === 'finished' && state.nextHandAt && now >= state.nextHandAt) {
    startHand(state, rng, now); // katlamalı, hızlı masa: sonraki el
    changed = true;
  } else if (state.phase === 'finished' && state.closeAt && now >= state.closeAt) {
    return null;
  }

  if (state.notes && state.notes.length) {
    for (var n = 0; n < state.notes.length; n++) noticeAll(state, dispatcher, state.notes[n]);
    state.notes = [];
  }
  if (changed) broadcastState(state, dispatcher, now);
  return { state: state };
}

function okeyMatchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  // Sunucu kapanırken oynanan el yarıda kalırsa bahisler iade edilir.
  if (state.phase === 'playing') {
    for (var i = 0; i < 4; i++) {
      var s = state.seats[i];
      if (s && s.paid) safeWallet(nk, logger, s.userId, state.bet, { reason: 'okey_iade', match: state.matchId });
    }
  }
  return { state: state };
}

/**
 * Özel odaya giriş izni (okey_private_join RPC'si gönderir).
 * Yanıt: 'ok' | 'pin' (şifre yanlış/eksik) | 'full' | 'started'
 */
function okeyMatchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  var req = {};
  try {
    req = JSON.parse(data);
  } catch (e) {
    return { state: state, data: 'bad' };
  }
  if (req.type !== 'allow' || !req.userId) return { state: state, data: 'bad' };
  if (seatOfUser(state, req.userId) >= 0) {
    state.allowed[req.userId] = true;
    return { state: state, data: 'ok' };
  }
  if (state.pin && String(req.pin || '') !== state.pin) return { state: state, data: 'pin' };
  if (state.phase === 'playing' || midGame(state)) return { state: state, data: 'started' };
  if (!hasRoomFor(state)) return { state: state, data: 'full' };
  state.allowed[req.userId] = true;
  return { state: state, data: 'ok' };
}

// ---------------------------------------------------------------- Özel oda kuralları

/** Yeni gelen için yer var mı? Özel odada el arasında botun yerine geçilebilir. */
function hasRoomFor(state) {
  return freeSeat(state) >= 0;
}

/** Katlamalıda iki el arası: oyun sürüyor, yeni oyuncu alınmaz. */
function midGame(state) {
  return state.mode !== 'duz' && state.phase === 'finished' && !state.gameOver;
}

function freeSeat(state) {
  if (state.phase === 'playing' || midGame(state)) return -1;
  if (state.phase === 'finished' && !state.private) return -1;
  for (var i = 0; i < 4; i++) if (!state.seats[i]) return i;
  if (state.private && state.phase === 'finished') {
    for (var j = 0; j < 4; j++) if (state.seats[j].bot) return j;
  }
  return -1;
}

/** Başlatma isteği geçerli mi? Geçersizse oyuncuya gösterilecek metin. */
function canStart(state, userId) {
  if (!state.private) return 'Bu masa kendiliğinden başlar';
  if (userId !== state.hostUserId) return 'Eli oda sahibi başlatır';
  if (state.phase === 'playing') return 'El zaten sürüyor';
  return null;
}

/** Oda sahibi ayrılırsa oturan ilk oyuncu oda sahibi olur. */
function passHostIfGone(state) {
  if (!state.private) return;
  var at = seatOfUser(state, state.hostUserId);
  if (at >= 0 && state.seats[at].connected) return;
  for (var i = 0; i < 4; i++) {
    var s = state.seats[i];
    if (s && !s.bot && s.connected) {
      state.hostUserId = s.userId;
      return;
    }
  }
}

// ---------------------------------------------------------------- Hızlı oyun

var OKEY_BETS = [100, 500, 1000, 5000, 10000];

/** Bakiyeye uygun masa: bakiyenin en az 20 katı bahis kadar olduğu en yüksek seviye. */
function betForChips(chips) {
  var bet = 0;
  for (var i = 0; i < OKEY_BETS.length; i++) if (chips >= OKEY_BETS[i] * 20) bet = OKEY_BETS[i];
  if (!bet && chips >= OKEY_BETS[0]) bet = OKEY_BETS[0];
  return bet;
}

function rpcOkeyQuick(ctx, logger, nk, payload) {
  if (!ctx.userId) throw Error('Oturum gerekli');
  var mode = modeOf(parseRequest(payload));
  var chips = walletChips(nk, ctx.userId);
  var bet = betForChips(chips);
  if (!bet) throw Error('SALON:Okey masası için en az ' + OKEY_BETS[0] + ' çip gerekli');
  var query = '+label.game:okey +label.open:1 +label.private:0 +label.mode:' + mode + ' +label.bet:b' + bet;
  var matches = nk.matchList(10, true, null, 0, 3, query) || [];
  var matchId = matches.length ? matches[0].matchId : nk.matchCreate('okey', { bet: String(bet), mode: mode });
  return JSON.stringify({ matchId: matchId, bet: bet, mode: mode });
}

// ---------------------------------------------------------------- Özel oda RPC'leri

var ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O, 1/I karışmasın
var ROOM_NAME_MAX = 24;

function randomRoomCode(rng) {
  var code = '';
  for (var i = 0; i < 6; i++) code += ROOM_CODE_CHARS[Math.floor(rng() * ROOM_CODE_CHARS.length)];
  return code;
}

function findRoom(nk, code) {
  var list = nk.matchList(1, true, null, 0, 4, '+label.game:okey +label.private:1 +label.code:' + code) || [];
  return list.length ? list[0] : null;
}

function modeOf(req) {
  var mode = String((req && req.mode) || 'duz');
  if (MODES.indexOf(mode) < 0) throw Error('SALON:Bu oyun türü henüz yok');
  return mode;
}

function parseRequest(payload) {
  try {
    return JSON.parse(payload || '{}');
  } catch (e) {
    throw Error('SALON:İstek okunamadı');
  }
}

/** Özel oda kurar. Girdi: {name, bet, pin?}. Çıktı: {matchId, bet, code}. */
function rpcOkeyPrivateCreate(ctx, logger, nk, payload) {
  if (!ctx.userId) throw Error('Oturum gerekli');
  var req = parseRequest(payload);
  var bet = parseInt(req.bet, 10);
  if (OKEY_BETS.indexOf(bet) < 0) throw Error('SALON:Geçersiz bahis');
  if (walletChips(nk, ctx.userId) < bet) throw Error('SALON:Bu bahis için çipin yetmiyor');
  var pin = req.pin ? String(req.pin) : '';
  if (pin && !/^[0-9]{4}$/.test(pin)) throw Error('SALON:Şifre 4 rakam olmalı');
  var name = String(req.name || '').replace(/\s+/g, ' ').trim().slice(0, ROOM_NAME_MAX);
  if (!name) name = 'Özel oda';
  var code = '';
  for (var tries = 0; tries < 5; tries++) {
    code = randomRoomCode(Math.random);
    if (!findRoom(nk, code)) break;
  }
  var matchId = nk.matchCreate('okey', {
    bet: String(bet),
    mode: modeOf(req),
    private: '1',
    name: name,
    code: code,
    pin: pin,
    host: ctx.userId,
  });
  return JSON.stringify({ matchId: matchId, bet: bet, code: code });
}

/** Kodla özel odaya katılma izni. Girdi: {code, pin?}. Çıktı: {matchId, bet, code}. */
function rpcOkeyPrivateJoin(ctx, logger, nk, payload) {
  if (!ctx.userId) throw Error('Oturum gerekli');
  var req = parseRequest(payload);
  var code = String(req.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) throw Error('SALON:Oda kodu 6 karakter olmalı');
  var room = findRoom(nk, code);
  if (!room) throw Error('SALON:Bu kodla açık oda yok');
  var label = JSON.parse(room.label);
  var bet = parseInt(String(label.bet).slice(1), 10);
  if (walletChips(nk, ctx.userId) < bet) throw Error('SALON:Bu oda için çipin yetmiyor');
  var answer = nk.matchSignal(room.matchId, JSON.stringify({ type: 'allow', userId: ctx.userId, pin: req.pin || '' }));
  if (answer === 'pin') throw Error(req.pin ? 'SALON:Şifre yanlış' : 'SALON:PIN_GEREKLI');
  if (answer === 'full') throw Error('SALON:Oda dolu');
  if (answer === 'started') throw Error('SALON:El başladı, bitince tekrar dene');
  if (answer !== 'ok') throw Error('SALON:Odaya girilemedi');
  return JSON.stringify({ matchId: room.matchId, bet: bet, code: code });
}
