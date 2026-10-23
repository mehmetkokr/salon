// Tavla masası: sunucunun yönettiği iki kişilik Nakama maçı.
//
// Koltuk 0 beyaz, koltuk 1 siyah. Maç 5 puana oynanır (mars 2 puan). Bahis
// maç başında bir kez alınır, maçı kazanan potu alır.
//
// Mesaj kodları:
//   1 → durum (sunucu → oyuncu)
//   2 → zar at        {}
//   3 → pul oynat     {from, to}   (from: hane ya da 'bar', to: hane ya da 'off')
//   4 → turu geri al  {}           (bu turdaki hamleleri geri alır)
//   5 → başlat        {}           (özel odada oda sahibi)
//   9 → uyarı         {msg}
//
// Adil zar: maç başında gizli tohum seçilir, özeti (commitment) baştan
// gösterilir; zarlar tohumdan türetilir, maç sonunda tohum açıklanır.

var T_OP_STATE = 1;
var T_OP_ROLL = 2;
var T_OP_MOVE = 3;
var T_OP_UNDO = 4;
var T_OP_START = 5;
var T_OP_NOTICE = 9;

var T_TURN_MS = 30000;
var T_AUTO_MS = 2500;
var T_BOT_MIN_MS = 900;
var T_BOT_MAX_MS = 1600;
var T_PASS_MS = 1500; // oynanacak hamle yoksa sıra bu kadar sonra geçer
var T_FILL_MS = 8000;
var T_NEXT_GAME_MS = 6000;
var T_RESULT_MS = 15000;
var T_EMPTY_MS = 30000;
var T_MATCH_POINTS = 5;
var T_AUTO_AFTER_TIMEOUTS = 3; // tavlada düşünme payı: üç süre aşımından sonra otomatik
var T_BOT_NAMES = ['Tavlacı Nuri', 'Sinan Usta', 'Kahveci Rıza', 'Ziya Bey', 'Melek Hanım', 'Cemil Dayı'];

// ---------------------------------------------------------------- Yardımcılar

function tavlaLabel(state) {
  return JSON.stringify({
    game: 'tavla',
    bet: 'b' + state.bet,
    open: !state.private && state.phase === 'waiting' && tSeated(state) < 2 ? 1 : 0,
    private: state.private ? 1 : 0,
    code: state.code || '',
  });
}

function tSeated(state) {
  return (state.seats[0] ? 1 : 0) + (state.seats[1] ? 1 : 0);
}

function tSeatOf(state, userId) {
  for (var i = 0; i < 2; i++) if (state.seats[i] && state.seats[i].userId === userId) return i;
  return -1;
}

function tHumansConnected(state) {
  var n = 0;
  for (var i = 0; i < 2; i++) if (state.seats[i] && !state.seats[i].bot && state.seats[i].connected) n++;
  return n;
}

function tNewSeat(userId, name, level, bot, presence) {
  return { userId: userId, name: name, level: level, bot: bot, presence: presence, connected: !bot, auto: false, timeouts: 0, paid: false };
}

function tDeadline(state, now, rng) {
  var s = state.seats[state.turn];
  if (s.bot) return now + T_BOT_MIN_MS + Math.floor(rng() * (T_BOT_MAX_MS - T_BOT_MIN_MS));
  if (s.auto || !s.connected) return now + T_AUTO_MS;
  return now + T_TURN_MS;
}

function tRoll(state, nk) {
  var dice = diceFromSeed(
    function (text) {
      return nk.sha256Hash(text);
    },
    state.seed,
    state.rollIndex
  );
  state.rollIndex++;
  return dice;
}

// ---------------------------------------------------------------- Görünüm

function tavlaView(state, seatIndex, now) {
  var seats = [];
  for (var i = 0; i < 2; i++) {
    var s = state.seats[i];
    seats.push(s ? { name: s.name, level: s.level, bot: s.bot ? 1 : 0, connected: s.connected ? 1 : 0, auto: s.auto ? 1 : 0 } : null);
  }
  var mine = state.phase === 'playing' && state.turn === seatIndex && state.stage === 'move';
  return {
    phase: state.phase,
    bet: state.bet,
    pot: state.pot,
    you: seatIndex,
    seats: seats,
    turn: state.turn,
    stage: state.stage,
    dice: state.dice,
    remaining: state.remaining,
    board: state.board,
    legal: mine ? legalSteps(state.board, seatIndex, state.remaining, state.dice) : [],
    canUndo: mine && state.played.length > 0 ? 1 : 0,
    lastMoves: state.lastMoves,
    turnEndsAt: state.turnEndsAt,
    turnMs: T_TURN_MS,
    fillAt: state.fillAt,
    serverNow: now,
    score: state.score,
    target: T_MATCH_POINTS,
    gameNo: state.gameNo,
    openingDice: state.openingDice,
    commitment: state.commitment,
    nextGameAt: state.nextGameAt,
    result: state.result,
    room: state.private
      ? { name: state.name, code: state.code, locked: state.pin ? 1 : 0, host: tSeatOf(state, state.hostUserId) }
      : null,
  };
}

function tBroadcast(state, dispatcher, now) {
  for (var i = 0; i < 2; i++) {
    var s = state.seats[i];
    if (s && !s.bot && s.connected && s.presence) {
      dispatcher.broadcastMessage(T_OP_STATE, JSON.stringify(tavlaView(state, i, now)), [s.presence], null, true);
    }
  }
}

function tNotice(dispatcher, presence, msg) {
  dispatcher.broadcastMessage(T_OP_NOTICE, JSON.stringify({ msg: msg }), [presence], null, true);
}

// ---------------------------------------------------------------- Oyun akışı

/** Maçı başlatır: boş koltuğa bot, bahisler, adil zar tohumu. */
function tStartMatch(state, nk, logger, rng, now) {
  for (var r = 0; r < 2; r++) {
    var old = state.seats[r];
    if (old && !old.bot && !old.connected) state.seats[r] = null;
  }
  for (var j = 0; j < 2; j++) {
    if (state.seats[j]) continue;
    var other = state.seats[1 - j];
    var name;
    do {
      name = T_BOT_NAMES[Math.floor(rng() * T_BOT_NAMES.length)];
    } while (other && other.name === name);
    state.seats[j] = tNewSeat('bot:' + j, name, 1 + Math.floor(rng() * 30), true, null);
  }
  var payers = 0;
  for (var i = 0; i < 2; i++) {
    var s = state.seats[i];
    s.paid = false;
    s.auto = false;
    s.timeouts = 0;
    if (s.bot) continue;
    try {
      nk.walletUpdate(s.userId, { chips: -state.bet }, { reason: 'tavla_bahis', match: state.matchId }, true);
      s.paid = true;
      payers++;
    } catch (e) {
      logger.warn('Bahis alınamadı (%s): %s', s.userId, e);
      s.bot = true;
      s.connected = false;
    }
  }
  state.pot = state.bet * payers;
  state.score = [0, 0];
  state.gameNo = 0;
  state.gameOver = false;
  state.seed = nk.sha256Hash(state.matchId + ':' + now + ':' + rng() + ':' + rng());
  state.commitment = nk.sha256Hash(state.seed);
  state.rollIndex = 0;
  tStartGame(state, nk, rng, now);
}

/** Yeni oyun: başlangıç dizilişi, açılış zarı (büyük atan başlar). */
function tStartGame(state, nk, rng, now) {
  state.board = initialBoard();
  state.gameNo++;
  state.result = null;
  state.nextGameAt = 0;
  state.closeAt = 0;
  var a;
  var b;
  do {
    var d = tRoll(state, nk);
    a = d[0];
    b = d[1];
  } while (a === b);
  state.openingDice = [a, b]; // [beyaz, siyah]
  state.turn = a > b ? 0 : 1;
  state.phase = 'playing';
  tBeginTurn(state, rng, now);
}

function tBeginTurn(state, rng, now) {
  state.stage = 'roll';
  state.dice = [];
  state.remaining = [];
  state.played = [];
  state.turnStart = null;
  state.passAt = 0;
  state.turnEndsAt = tDeadline(state, now, rng);
}

function tDoRoll(state, nk, now) {
  state.dice = tRoll(state, nk);
  state.remaining = diceList(state.dice);
  state.stage = 'move';
  state.turnStart = { board: state.board, remaining: state.remaining };
  state.played = [];
  if (!legalSteps(state.board, state.turn, state.remaining, state.dice).length) {
    state.passAt = now + T_PASS_MS; // oynanacak hamle yok
  }
}

/** Tek adım oynatır. Geçersizse hata metni. */
function tApplyStep(state, seatIndex, step, nk, logger, now, rng) {
  if (state.phase !== 'playing') return 'Oyun başlamadı';
  if (seatIndex !== state.turn) return 'Sıra sende değil';
  if (state.stage !== 'move') return 'Önce zar at';
  var steps = legalSteps(state.board, seatIndex, state.remaining, state.dice);
  var m = findStep(steps, step);
  if (!m) return 'Bu hamle olmaz';
  state.board = applySingle(state.board, seatIndex, m);
  state.remaining = withoutDie(state.remaining, m.die);
  state.played = state.played.concat([m]);
  var res = gameResult(state.board);
  if (res) {
    tFinishGame(state, nk, logger, now, res);
    return null;
  }
  if (!state.remaining.length || !legalSteps(state.board, seatIndex, state.remaining, state.dice).length) {
    tEndTurn(state, rng, now);
  }
  return null;
}

function tEndTurn(state, rng, now) {
  state.lastMoves = { seat: state.turn, dice: state.dice, moves: state.played };
  state.turn = 1 - state.turn;
  tBeginTurn(state, rng, now);
}

function tUndo(state, seatIndex) {
  if (state.phase !== 'playing' || seatIndex !== state.turn || state.stage !== 'move') return 'Geri alınacak hamle yok';
  if (!state.played.length) return 'Geri alınacak hamle yok';
  state.board = state.turnStart.board;
  state.remaining = state.turnStart.remaining;
  state.played = [];
  return null;
}

/** Oyun bitti: puan yazılır; maç bittiyse pot ödenir, tohum açıklanır. */
function tFinishGame(state, nk, logger, now, res) {
  var score = state.score.slice();
  score[res.winner] += res.points;
  state.score = score;
  state.lastMoves = { seat: state.turn, dice: state.dice, moves: state.played };
  state.phase = 'finished';
  state.turnEndsAt = 0;
  var over = score[res.winner] >= T_MATCH_POINTS;
  state.result = { winner: res.winner, points: res.points, mars: res.mars ? 1 : 0, gameOver: over ? 1 : 0, payouts: [0, 0], seed: null };
  if (!over) {
    state.nextGameAt = state.private ? 0 : now + T_NEXT_GAME_MS;
    return;
  }
  state.gameOver = true;
  var payouts = [0, 0];
  for (var i = 0; i < 2; i++) if (state.seats[i].paid) payouts[i] = -state.bet;
  var w = state.seats[res.winner];
  if (!w.bot && state.pot > 0) {
    safeWallet(nk, logger, w.userId, state.pot, { reason: 'tavla_kazanc', match: state.matchId });
    payouts[res.winner] += state.pot;
  }
  for (var k = 0; k < 2; k++) {
    var h = state.seats[k];
    if (h.bot) continue;
    try {
      recordGame(nk, h.userId, k === res.winner);
    } catch (e) {
      logger.warn('XP yazılamadı: %s', e);
    }
  }
  state.result.payouts = payouts;
  state.result.seed = state.seed; // adil zar: artık doğrulanabilir
  state.closeAt = state.private ? 0 : now + T_RESULT_MS;
}

/** Bot ya da süresi dolan oyuncu: zar atar ve en iyi diziyi oynar. */
function tAutoPlay(state, nk, logger, now, rng) {
  var seat = state.turn;
  if (state.stage === 'roll') tDoRoll(state, nk, now);
  // Oyuncu turu yarım bıraktıysa kalan zarlar da burada oynanır.
  var guard = 0;
  while (state.phase === 'playing' && state.turn === seat && state.stage === 'move' && guard++ < 8) {
    var seq = botSequence(state.board, seat, state.dice);
    var steps = legalSteps(state.board, seat, state.remaining, state.dice);
    if (!steps.length) {
      tEndTurn(state, rng, now);
      return;
    }
    // Botun dizisi tur başından hesaplanır; yarım turda geçerli ilk adımı seç.
    var pick = null;
    for (var i = 0; i < seq.length && !pick; i++) pick = findStep(steps, seq[i]);
    if (!pick) pick = steps[0];
    tApplyStep(state, seat, pick, nk, logger, now, rng);
  }
}

// ---------------------------------------------------------------- Nakama maç işleyicisi

function tavlaMatchInit(ctx, logger, nk, params) {
  params = params || {};
  var isPrivate = String(params.private) === '1';
  var allowed = {};
  if (isPrivate && params.host) allowed[params.host] = true;
  var state = {
    matchId: ctx.matchId,
    private: isPrivate,
    name: isPrivate ? String(params.name || 'Özel oda') : '',
    code: isPrivate ? String(params.code || '') : '',
    pin: isPrivate && params.pin ? String(params.pin) : '',
    hostUserId: isPrivate ? String(params.host || '') : '',
    allowed: allowed,
    bet: parseInt(params.bet, 10) || 100,
    pot: 0,
    phase: 'waiting',
    seats: [null, null],
    board: initialBoard(),
    turn: 0,
    stage: 'roll',
    dice: [],
    remaining: [],
    played: [],
    turnStart: null,
    lastMoves: null,
    passAt: 0,
    turnEndsAt: 0,
    fillAt: 0,
    closeAt: 0,
    nextGameAt: 0,
    emptySince: Date.now(),
    score: [0, 0],
    gameNo: 0,
    gameOver: false,
    openingDice: null,
    seed: '',
    commitment: '',
    rollIndex: 0,
    result: null,
  };
  return { state: state, tickRate: 5, label: tavlaLabel(state) };
}

function tFreeSeat(state) {
  if (state.phase === 'playing') return -1;
  if (state.phase === 'finished' && (!state.private || !state.gameOver)) return -1;
  for (var i = 0; i < 2; i++) if (!state.seats[i]) return i;
  if (state.private && state.phase === 'finished') for (var j = 0; j < 2; j++) if (state.seats[j].bot) return j;
  return -1;
}

function tavlaMatchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  if (tSeatOf(state, presence.userId) >= 0) return { state: state, accept: true };
  if (state.private && !state.allowed[presence.userId]) {
    return { state: state, accept: false, rejectMessage: 'Bu odaya kodla katılmalısın' };
  }
  if (tFreeSeat(state) < 0) return { state: state, accept: false, rejectMessage: 'Masa dolu' };
  if (walletChips(nk, presence.userId) < state.bet) {
    return { state: state, accept: false, rejectMessage: 'Bu masa için çipin yetmiyor' };
  }
  return { state: state, accept: true };
}

function tavlaMatchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  var now = Date.now();
  for (var i = 0; i < presences.length; i++) {
    var p = presences[i];
    var at = tSeatOf(state, p.userId);
    if (at >= 0) {
      state.seats[at].presence = p;
      state.seats[at].connected = true;
      state.seats[at].auto = false;
      state.seats[at].timeouts = 0;
      continue;
    }
    var free = tFreeSeat(state);
    if (free < 0) continue;
    var level = 1;
    try {
      level = progressOf(nk, p.userId).level;
    } catch (e) {
      logger.warn('Seviye okunamadı: %s', e);
    }
    state.seats[free] = tNewSeat(p.userId, p.username, level, false, p);
    if (!state.fillAt && !state.private) state.fillAt = now + T_FILL_MS;
  }
  state.emptySince = 0;
  dispatcher.matchLabelUpdate(tavlaLabel(state));
  tBroadcast(state, dispatcher, now);
  return { state: state };
}

function tavlaMatchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  var now = Date.now();
  for (var i = 0; i < presences.length; i++) {
    var at = tSeatOf(state, presences[i].userId);
    if (at < 0) continue;
    if (state.phase === 'waiting' || (state.private && state.phase === 'finished' && state.gameOver)) {
      state.seats[at] = null;
    } else {
      state.seats[at].connected = false;
      state.seats[at].presence = null;
    }
  }
  if (state.phase === 'waiting' && tSeated(state) === 0) state.fillAt = 0;
  if (tHumansConnected(state) === 0) state.emptySince = now;
  if (state.private) {
    var host = tSeatOf(state, state.hostUserId);
    if (host < 0 || !state.seats[host].connected) {
      for (var s = 0; s < 2; s++) {
        var seat = state.seats[s];
        if (seat && !seat.bot && seat.connected) state.hostUserId = seat.userId;
      }
    }
  }
  dispatcher.matchLabelUpdate(tavlaLabel(state));
  tBroadcast(state, dispatcher, now);
  return { state: state };
}

function tavlaMatchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  var now = Date.now();
  var rng = Math.random;
  var changed = false;

  if (tHumansConnected(state) === 0 && state.emptySince && now - state.emptySince > T_EMPTY_MS) return null;

  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var seatIndex = tSeatOf(state, m.sender.userId);
    if (seatIndex < 0) continue;
    var body = {};
    try {
      body = JSON.parse(nk.binaryToString(m.data) || '{}');
    } catch (e) {
      body = {};
    }
    var error = null;
    if (m.opCode === T_OP_START) {
      if (!state.private) error = 'Bu masa kendiliğinden başlar';
      else if (m.sender.userId !== state.hostUserId) error = 'Maçı oda sahibi başlatır';
      else if (state.phase === 'playing') error = 'Oyun zaten sürüyor';
      else if (state.phase === 'finished' && !state.gameOver) tStartGame(state, nk, rng, now);
      else tStartMatch(state, nk, logger, rng, now);
      if (!error) dispatcher.matchLabelUpdate(tavlaLabel(state));
    } else if (m.opCode === T_OP_ROLL) {
      if (state.phase !== 'playing' || state.turn !== seatIndex) error = 'Sıra sende değil';
      else if (state.stage !== 'roll') error = 'Zar zaten atıldı';
      else tDoRoll(state, nk, now);
    } else if (m.opCode === T_OP_MOVE) {
      var from = body.from === 'bar' ? 'bar' : parseInt(body.from, 10);
      var to = body.to === 'off' ? 'off' : parseInt(body.to, 10);
      error = tApplyStep(state, seatIndex, { from: from, to: to }, nk, logger, now, rng);
    } else if (m.opCode === T_OP_UNDO) {
      error = tUndo(state, seatIndex);
    } else {
      continue;
    }
    if (error) {
      tNotice(dispatcher, m.sender, error);
    } else {
      state.seats[seatIndex].timeouts = 0;
      state.seats[seatIndex].auto = false;
      changed = true;
    }
  }

  if (state.phase === 'waiting' && !state.private) {
    if (tSeated(state) === 2 || (state.fillAt && now >= state.fillAt && tSeated(state) > 0)) {
      tStartMatch(state, nk, logger, rng, now);
      dispatcher.matchLabelUpdate(tavlaLabel(state));
      changed = true;
    }
  } else if (state.phase === 'playing' && state.passAt && now >= state.passAt) {
    tEndTurn(state, rng, now); // oynanacak hamle yoktu
    changed = true;
  } else if (state.phase === 'playing' && now >= state.turnEndsAt) {
    var cur = state.seats[state.turn];
    if (!cur.bot) {
      cur.timeouts++;
      if (cur.timeouts >= T_AUTO_AFTER_TIMEOUTS) cur.auto = true;
    }
    tAutoPlay(state, nk, logger, now, rng);
    changed = true;
  } else if (state.phase === 'finished' && state.nextGameAt && now >= state.nextGameAt) {
    tStartGame(state, nk, rng, now);
    changed = true;
  } else if (state.phase === 'finished' && state.closeAt && now >= state.closeAt) {
    return null;
  }

  if (changed) tBroadcast(state, dispatcher, now);
  return { state: state };
}

function tavlaMatchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  if (!state.gameOver && state.phase !== 'waiting') {
    for (var i = 0; i < 2; i++) {
      var s = state.seats[i];
      if (s && s.paid) safeWallet(nk, logger, s.userId, state.bet, { reason: 'tavla_iade', match: state.matchId });
    }
  }
  return { state: state };
}

function tavlaMatchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  var req = {};
  try {
    req = JSON.parse(data);
  } catch (e) {
    return { state: state, data: 'bad' };
  }
  if (req.type !== 'allow' || !req.userId) return { state: state, data: 'bad' };
  if (tSeatOf(state, req.userId) >= 0) {
    state.allowed[req.userId] = true;
    return { state: state, data: 'ok' };
  }
  if (state.pin && String(req.pin || '') !== state.pin) return { state: state, data: 'pin' };
  if (state.phase === 'playing' || (state.phase === 'finished' && !state.gameOver)) return { state: state, data: 'started' };
  if (tFreeSeat(state) < 0) return { state: state, data: 'full' };
  state.allowed[req.userId] = true;
  return { state: state, data: 'ok' };
}

// ---------------------------------------------------------------- RPC

var TAVLA_BETS = [100, 500, 1000, 5000, 10000];

function rpcTavlaQuick(ctx, logger, nk, payload) {
  if (!ctx.userId) throw Error('Oturum gerekli');
  var bet = betForChips(walletChips(nk, ctx.userId));
  if (!bet) throw Error('SALON:Tavla masası için en az ' + TAVLA_BETS[0] + ' çip gerekli');
  var query = '+label.game:tavla +label.open:1 +label.private:0 +label.bet:b' + bet;
  var matches = nk.matchList(10, true, null, 0, 1, query) || [];
  var matchId = matches.length ? matches[0].matchId : nk.matchCreate('tavla', { bet: String(bet) });
  return JSON.stringify({ matchId: matchId, bet: bet });
}

function findTavlaRoom(nk, code) {
  var list = nk.matchList(1, true, null, 0, 2, '+label.game:tavla +label.private:1 +label.code:' + code) || [];
  return list.length ? list[0] : null;
}

function rpcTavlaPrivateCreate(ctx, logger, nk, payload) {
  if (!ctx.userId) throw Error('Oturum gerekli');
  var req = parseRequest(payload);
  var bet = parseInt(req.bet, 10);
  if (TAVLA_BETS.indexOf(bet) < 0) throw Error('SALON:Geçersiz bahis');
  if (walletChips(nk, ctx.userId) < bet) throw Error('SALON:Bu bahis için çipin yetmiyor');
  var pin = req.pin ? String(req.pin) : '';
  if (pin && !/^[0-9]{4}$/.test(pin)) throw Error('SALON:Şifre 4 rakam olmalı');
  var name = String(req.name || '').replace(/\s+/g, ' ').trim().slice(0, ROOM_NAME_MAX) || 'Özel oda';
  var code = '';
  for (var tries = 0; tries < 5; tries++) {
    code = randomRoomCode(Math.random);
    if (!findTavlaRoom(nk, code) && !findRoom(nk, code)) break;
  }
  var matchId = nk.matchCreate('tavla', { bet: String(bet), private: '1', name: name, code: code, pin: pin, host: ctx.userId });
  return JSON.stringify({ matchId: matchId, bet: bet, code: code });
}

function rpcTavlaPrivateJoin(ctx, logger, nk, payload) {
  if (!ctx.userId) throw Error('Oturum gerekli');
  var req = parseRequest(payload);
  var code = String(req.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) throw Error('SALON:Oda kodu 6 karakter olmalı');
  var room = findTavlaRoom(nk, code);
  if (!room) throw Error('SALON:Bu kodla açık oda yok');
  var label = JSON.parse(room.label);
  var bet = parseInt(String(label.bet).slice(1), 10);
  if (walletChips(nk, ctx.userId) < bet) throw Error('SALON:Bu oda için çipin yetmiyor');
  var answer = nk.matchSignal(room.matchId, JSON.stringify({ type: 'allow', userId: ctx.userId, pin: req.pin || '' }));
  if (answer === 'pin') throw Error(req.pin ? 'SALON:Şifre yanlış' : 'SALON:PIN_GEREKLI');
  if (answer === 'full') throw Error('SALON:Oda dolu');
  if (answer === 'started') throw Error('SALON:Maç başladı, bitince tekrar dene');
  if (answer !== 'ok') throw Error('SALON:Odaya girilemedi');
  return JSON.stringify({ matchId: room.matchId, bet: bet, code: code });
}
