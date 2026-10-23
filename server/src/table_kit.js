// Kart masaları için ortak iskelet (Pişti, Batak, King).
//
// İskelet; koltukları, botları, bahsi, süreyi, özel odayı, yeniden bağlanmayı,
// el/oyun sonunu ve ödemeyi yönetir. Her oyun yalnızca kurallarını verir:
//
//   GAME = {
//     id: 'pisti', seats: 2, modes: ['tekli'], turnMs: 20000,
//     newMatch(state, rng),                 // maç başı: puanlar sıfırlanır
//     newHand(state, rng),                  // dağıtım; state.turn ayarlanır
//     move(state, seat, body, ctx),         // hamle; hata metni ya da null
//     auto(state, seat, ctx),               // bot / süresi dolan oyuncu (mutlaka ilerlemeli)
//     view(state, seat),                    // oyuncuya özel görünüm (gizli kartlar hariç)
//   }
//
// Oyun, sıra değişince `state.turnSerial++` yapar. El bitince
// `state.handResult = {..., gameOver, winners}` yazar; gerisini iskelet yapar.
// Oyuncuya gösterilecek hatalar "SALON:" önekiyle atılır (RPC).
//
// Mesaj kodları (bütün kart oyunları):
//   1 → durum (sunucu → oyuncu)       5 → başlat (özel oda sahibi)
//   2 → hamle {…oyuna özgü…}          9 → uyarı {msg}

var K_OP_STATE = 1;
var K_OP_MOVE = 2;
var K_OP_START = 5;
var K_OP_NOTICE = 9;

var K_AUTO_MS = 2500;
var K_BOT_MIN_MS = 800;
var K_BOT_MAX_MS = 1500;
var K_FILL_MS = 8000;
var K_NEXT_HAND_MS = 6000;
var K_RESULT_MS = 15000;
var K_EMPTY_MS = 30000;
var K_AUTO_AFTER = 2;
var K_BOT_NAMES = ['Kahveci Rıza', 'Hacer Abla', 'Sinan Usta', 'Melek Hanım', 'Ziya Bey', 'Leyla', 'Cemil Dayı', 'Tavlacı Nuri'];

/** Kayıtlı kart oyunları: id → tanım. */
var CARD_GAMES = {};

function registerCardGame(def) {
  CARD_GAMES[def.id] = def;
}

// ---------------------------------------------------------------- Yardımcılar

function kLabel(state) {
  return JSON.stringify({
    game: state.game,
    mode: state.mode,
    bet: 'b' + state.bet,
    open: !state.private && state.phase === 'waiting' && kSeated(state) < state.seats.length ? 1 : 0,
    private: state.private ? 1 : 0,
    code: state.code || '',
  });
}

function kSeated(state) {
  var n = 0;
  for (var i = 0; i < state.seats.length; i++) if (state.seats[i]) n++;
  return n;
}

function kSeatOf(state, userId) {
  for (var i = 0; i < state.seats.length; i++) if (state.seats[i] && state.seats[i].userId === userId) return i;
  return -1;
}

function kHumans(state) {
  var n = 0;
  for (var i = 0; i < state.seats.length; i++) {
    var s = state.seats[i];
    if (s && !s.bot && s.connected) n++;
  }
  return n;
}

function kDeadline(state, now, rng) {
  var s = state.seats[state.turn];
  if (!s) return now + K_AUTO_MS;
  if (s.bot) return now + K_BOT_MIN_MS + Math.floor(rng() * (K_BOT_MAX_MS - K_BOT_MIN_MS));
  if (s.auto || !s.connected) return now + K_AUTO_MS;
  return now + CARD_GAMES[state.game].turnMs;
}

function kNote(state, msg) {
  state.notes = (state.notes || []).concat([msg]);
}

function kBroadcast(state, dispatcher, now) {
  var def = CARD_GAMES[state.game];
  for (var i = 0; i < state.seats.length; i++) {
    var s = state.seats[i];
    if (!s || s.bot || !s.connected || !s.presence) continue;
    var seats = [];
    for (var k = 0; k < state.seats.length; k++) {
      var t = state.seats[k];
      seats.push(t ? { name: t.name, level: t.level, bot: t.bot ? 1 : 0, connected: t.connected ? 1 : 0, auto: t.auto ? 1 : 0 } : null);
    }
    var view = {
      game: state.game,
      mode: state.mode,
      phase: state.phase,
      bet: state.bet,
      pot: state.pot,
      you: i,
      seats: seats,
      turn: state.turn,
      turnEndsAt: state.turnEndsAt,
      turnMs: def.turnMs,
      fillAt: state.fillAt,
      nextHandAt: state.nextHandAt,
      handNo: state.handNo,
      serverNow: now,
      result: state.handResult,
      room: state.private
        ? { name: state.name, code: state.code, locked: state.pin ? 1 : 0, host: kSeatOf(state, state.hostUserId) }
        : null,
      g: state.phase === 'waiting' ? null : def.view(state, i),
    };
    dispatcher.broadcastMessage(K_OP_STATE, JSON.stringify(view), [s.presence], null, true);
  }
}

function kNotice(dispatcher, presence, msg) {
  dispatcher.broadcastMessage(K_OP_NOTICE, JSON.stringify({ msg: msg }), [presence], null, true);
}

function kNoticeAll(state, dispatcher, msg) {
  for (var i = 0; i < state.seats.length; i++) {
    var s = state.seats[i];
    if (s && !s.bot && s.connected && s.presence) kNotice(dispatcher, s.presence, msg);
  }
}

// ---------------------------------------------------------------- Akış

function kStartMatch(state, nk, logger, rng, now) {
  for (var r = 0; r < state.seats.length; r++) {
    var old = state.seats[r];
    if (old && !old.bot && !old.connected) state.seats[r] = null;
  }
  var used = {};
  for (var u = 0; u < state.seats.length; u++) if (state.seats[u]) used[state.seats[u].name] = true;
  for (var j = 0; j < state.seats.length; j++) {
    if (state.seats[j]) continue;
    var name;
    do {
      name = K_BOT_NAMES[Math.floor(rng() * K_BOT_NAMES.length)];
    } while (used[name]);
    used[name] = true;
    state.seats[j] = { userId: 'bot:' + j, name: name, level: 1 + Math.floor(rng() * 30), bot: true, presence: null, connected: false, auto: false, timeouts: 0, paid: false };
  }
  var payers = 0;
  for (var i = 0; i < state.seats.length; i++) {
    var s = state.seats[i];
    s.paid = false;
    s.auto = false;
    s.timeouts = 0;
    if (s.bot) continue;
    try {
      nk.walletUpdate(s.userId, { chips: -state.bet }, { reason: state.game + '_bahis', match: state.matchId }, true);
      s.paid = true;
      payers++;
    } catch (e) {
      logger.warn('Bahis alınamadı (%s): %s', s.userId, e);
      s.bot = true;
      s.connected = false;
    }
  }
  state.pot = state.bet * payers;
  state.handNo = 0;
  state.gameOver = false;
  CARD_GAMES[state.game].newMatch(state, rng);
  kStartHand(state, rng, now);
}

function kStartHand(state, rng, now) {
  state.handNo++;
  state.handResult = null;
  state.nextHandAt = 0;
  state.closeAt = 0;
  state.phase = 'playing';
  state.turnSerial = 0;
  CARD_GAMES[state.game].newHand(state, rng);
  state.lastSerial = state.turnSerial;
  state.turnEndsAt = kDeadline(state, now, rng);
}

/** Hamleden sonra: el bittiyse kapatır, sıra değiştiyse süreyi yeniler. */
function kAfterMove(state, nk, logger, rng, now) {
  if (state.handResult) {
    kFinishHand(state, nk, logger, now);
    return;
  }
  if (state.turnSerial !== state.lastSerial) {
    state.lastSerial = state.turnSerial;
    state.turnEndsAt = kDeadline(state, now, rng);
  }
}

function kFinishHand(state, nk, logger, now) {
  var r = state.handResult;
  state.phase = 'finished';
  state.turnEndsAt = 0;
  if (!r.gameOver) {
    state.nextHandAt = state.private ? 0 : now + K_NEXT_HAND_MS;
    return;
  }
  state.gameOver = true;
  var n = state.seats.length;
  var payouts = [];
  for (var i = 0; i < n; i++) payouts.push(state.seats[i].paid ? -state.bet : 0);
  var winners = r.winners || [];
  var share = winners.length ? Math.floor(state.pot / winners.length) : 0;
  for (var w = 0; w < winners.length; w++) {
    var seat = state.seats[winners[w]];
    if (!seat.bot && share > 0) {
      safeWallet(nk, logger, seat.userId, share, { reason: state.game + '_kazanc', match: state.matchId });
      payouts[winners[w]] += share;
    }
  }
  for (var k = 0; k < n; k++) {
    var h = state.seats[k];
    if (h.bot) continue;
    try {
      addXp(nk, h.userId, winners.indexOf(k) >= 0 ? WIN_XP : PLAY_XP);
    } catch (e) {
      logger.warn('XP yazılamadı: %s', e);
    }
  }
  r.payouts = payouts;
  state.closeAt = state.private ? 0 : now + K_RESULT_MS;
}

function kMidGame(state) {
  return state.phase === 'finished' && !state.gameOver;
}

function kFreeSeat(state) {
  if (state.phase === 'playing' || kMidGame(state)) return -1;
  if (state.phase === 'finished' && !state.private) return -1;
  for (var i = 0; i < state.seats.length; i++) if (!state.seats[i]) return i;
  if (state.private && state.phase === 'finished') {
    for (var j = 0; j < state.seats.length; j++) if (state.seats[j].bot) return j;
  }
  return -1;
}

// ---------------------------------------------------------------- Nakama işleyicileri (oyundan bağımsız)

function kInit(gameId, ctx, logger, nk, params) {
  params = params || {};
  var def = CARD_GAMES[gameId];
  var isPrivate = String(params.private) === '1';
  var allowed = {};
  if (isPrivate && params.host) allowed[params.host] = true;
  var seats = [];
  for (var i = 0; i < def.seats; i++) seats.push(null);
  var mode = def.modes.indexOf(String(params.mode)) >= 0 ? String(params.mode) : def.modes[0];
  var state = {
    game: gameId,
    mode: mode,
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
    seats: seats,
    turn: 0,
    turnSerial: 0,
    lastSerial: 0,
    turnEndsAt: 0,
    fillAt: 0,
    closeAt: 0,
    nextHandAt: 0,
    emptySince: Date.now(),
    handNo: 0,
    handResult: null,
    gameOver: false,
    notes: [],
  };
  return { state: state, tickRate: 5, label: kLabel(state) };
}

function kJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  if (kSeatOf(state, presence.userId) >= 0) return { state: state, accept: true };
  if (state.private && !state.allowed[presence.userId]) {
    return { state: state, accept: false, rejectMessage: 'Bu odaya kodla katılmalısın' };
  }
  if (kFreeSeat(state) < 0) return { state: state, accept: false, rejectMessage: 'Masa dolu' };
  if (walletChips(nk, presence.userId) < state.bet) {
    return { state: state, accept: false, rejectMessage: 'Bu masa için çipin yetmiyor' };
  }
  return { state: state, accept: true };
}

function kJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  var now = Date.now();
  for (var i = 0; i < presences.length; i++) {
    var p = presences[i];
    var at = kSeatOf(state, p.userId);
    if (at >= 0) {
      var back = state.seats[at];
      back.presence = p;
      back.connected = true;
      back.auto = false;
      back.timeouts = 0;
      continue;
    }
    var free = kFreeSeat(state);
    if (free < 0) continue;
    var level = 1;
    try {
      level = progressOf(nk, p.userId).level;
    } catch (e) {
      logger.warn('Seviye okunamadı: %s', e);
    }
    state.seats[free] = { userId: p.userId, name: p.username, level: level, bot: false, presence: p, connected: true, auto: false, timeouts: 0, paid: false };
    if (!state.fillAt && !state.private) state.fillAt = now + K_FILL_MS;
  }
  state.emptySince = 0;
  dispatcher.matchLabelUpdate(kLabel(state));
  kBroadcast(state, dispatcher, now);
  return { state: state };
}

function kLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  var now = Date.now();
  for (var i = 0; i < presences.length; i++) {
    var at = kSeatOf(state, presences[i].userId);
    if (at < 0) continue;
    if (state.phase === 'waiting' || (state.private && state.phase === 'finished' && state.gameOver)) {
      state.seats[at] = null;
    } else {
      state.seats[at].connected = false;
      state.seats[at].presence = null;
    }
  }
  if (state.phase === 'waiting' && kSeated(state) === 0) state.fillAt = 0;
  if (kHumans(state) === 0) state.emptySince = now;
  if (state.private) {
    var host = kSeatOf(state, state.hostUserId);
    if (host < 0 || !state.seats[host].connected) {
      for (var s = 0; s < state.seats.length; s++) {
        var seat = state.seats[s];
        if (seat && !seat.bot && seat.connected) {
          state.hostUserId = seat.userId;
          break;
        }
      }
    }
  }
  dispatcher.matchLabelUpdate(kLabel(state));
  kBroadcast(state, dispatcher, now);
  return { state: state };
}

function kLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  var now = Date.now();
  var rng = Math.random;
  var def = CARD_GAMES[state.game];
  var changed = false;
  var mctx = { now: now, rng: rng, nk: nk, logger: logger, note: function (msg) { kNote(state, msg); } };

  if (kHumans(state) === 0 && state.emptySince && now - state.emptySince > K_EMPTY_MS) return null;

  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var seat = kSeatOf(state, m.sender.userId);
    if (seat < 0) continue;
    var body = {};
    try {
      body = JSON.parse(nk.binaryToString(m.data) || '{}');
    } catch (e) {
      body = {};
    }
    var error = null;
    if (m.opCode === K_OP_START) {
      if (!state.private) error = 'Bu masa kendiliğinden başlar';
      else if (m.sender.userId !== state.hostUserId) error = 'Oyunu oda sahibi başlatır';
      else if (state.phase === 'playing') error = 'Oyun zaten sürüyor';
      else if (kMidGame(state)) kStartHand(state, rng, now);
      else kStartMatch(state, nk, logger, rng, now);
      if (!error) dispatcher.matchLabelUpdate(kLabel(state));
    } else if (m.opCode === K_OP_MOVE) {
      if (state.phase !== 'playing') error = 'Oyun başlamadı';
      else error = def.move(state, seat, body, mctx);
      if (!error) kAfterMove(state, nk, logger, rng, now);
    } else {
      continue;
    }
    if (error) {
      kNotice(dispatcher, m.sender, error);
    } else {
      state.seats[seat].timeouts = 0;
      state.seats[seat].auto = false;
      changed = true;
    }
  }

  if (state.phase === 'waiting' && !state.private) {
    if (kSeated(state) === state.seats.length || (state.fillAt && now >= state.fillAt && kSeated(state) > 0)) {
      kStartMatch(state, nk, logger, rng, now);
      dispatcher.matchLabelUpdate(kLabel(state));
      changed = true;
    }
  } else if (state.phase === 'playing' && now >= state.turnEndsAt) {
    var cur = state.seats[state.turn];
    if (!cur.bot) {
      cur.timeouts++;
      if (cur.timeouts >= K_AUTO_AFTER) cur.auto = true;
    }
    def.auto(state, state.turn, mctx);
    kAfterMove(state, nk, logger, rng, now);
    // Oyun sırayı değiştirmediyse (ör. aynı oyuncu yine oynayacak) süre yenilenir.
    if (state.phase === 'playing' && now >= state.turnEndsAt) state.turnEndsAt = kDeadline(state, now, rng);
    changed = true;
  } else if (state.phase === 'finished' && state.nextHandAt && now >= state.nextHandAt) {
    kStartHand(state, rng, now);
    changed = true;
  } else if (state.phase === 'finished' && state.closeAt && now >= state.closeAt) {
    return null;
  }

  if (state.notes && state.notes.length) {
    for (var n = 0; n < state.notes.length; n++) kNoticeAll(state, dispatcher, state.notes[n]);
    state.notes = [];
  }
  if (changed) kBroadcast(state, dispatcher, now);
  return { state: state };
}

function kTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  if (!state.gameOver && state.phase !== 'waiting') {
    for (var i = 0; i < state.seats.length; i++) {
      var s = state.seats[i];
      if (s && s.paid) safeWallet(nk, logger, s.userId, state.bet, { reason: state.game + '_iade', match: state.matchId });
    }
  }
  return { state: state };
}

function kSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  var req = {};
  try {
    req = JSON.parse(data);
  } catch (e) {
    return { state: state, data: 'bad' };
  }
  if (req.type !== 'allow' || !req.userId) return { state: state, data: 'bad' };
  if (kSeatOf(state, req.userId) >= 0) {
    state.allowed[req.userId] = true;
    return { state: state, data: 'ok' };
  }
  if (state.pin && String(req.pin || '') !== state.pin) return { state: state, data: 'pin' };
  if (state.phase === 'playing' || kMidGame(state)) return { state: state, data: 'started' };
  if (kFreeSeat(state) < 0) return { state: state, data: 'full' };
  state.allowed[req.userId] = true;
  return { state: state, data: 'ok' };
}

// ---------------------------------------------------------------- RPC'ler (bütün kart oyunları)

var CARD_BETS = [100, 500, 1000, 5000, 10000];

function kGameOf(req) {
  var def = CARD_GAMES[String(req.game || '')];
  if (!def) throw Error('SALON:Bu oyun henüz yok');
  var mode = String(req.mode || def.modes[0]);
  if (def.modes.indexOf(mode) < 0) throw Error('SALON:Bu oyun türü henüz yok');
  return { def: def, mode: mode };
}

/** Hızlı masa. Girdi: {game, mode}. Çıktı: {matchId, bet, game, mode}. */
function rpcCardQuick(ctx, logger, nk, payload) {
  if (!ctx.userId) throw Error('Oturum gerekli');
  var g = kGameOf(parseRequest(payload));
  var bet = betForChips(walletChips(nk, ctx.userId));
  if (!bet) throw Error('SALON:Bu masa için en az ' + CARD_BETS[0] + ' çip gerekli');
  var query = '+label.game:' + g.def.id + ' +label.mode:' + g.mode + ' +label.open:1 +label.private:0 +label.bet:b' + bet;
  var matches = nk.matchList(10, true, null, 0, g.def.seats - 1, query) || [];
  var matchId = matches.length ? matches[0].matchId : nk.matchCreate(g.def.id, { bet: String(bet), mode: g.mode });
  return JSON.stringify({ matchId: matchId, bet: bet, game: g.def.id, mode: g.mode });
}

/** Özel oda. Girdi: {game, mode, name, bet, pin?}. */
function rpcCardPrivateCreate(ctx, logger, nk, payload) {
  if (!ctx.userId) throw Error('Oturum gerekli');
  var req = parseRequest(payload);
  var g = kGameOf(req);
  var bet = parseInt(req.bet, 10);
  if (CARD_BETS.indexOf(bet) < 0) throw Error('SALON:Geçersiz bahis');
  if (walletChips(nk, ctx.userId) < bet) throw Error('SALON:Bu bahis için çipin yetmiyor');
  var pin = req.pin ? String(req.pin) : '';
  if (pin && !/^[0-9]{4}$/.test(pin)) throw Error('SALON:Şifre 4 rakam olmalı');
  var name = String(req.name || '').replace(/\s+/g, ' ').trim().slice(0, ROOM_NAME_MAX) || 'Özel oda';
  var code = '';
  for (var tries = 0; tries < 5; tries++) {
    code = randomRoomCode(Math.random);
    if (!kFindRoom(nk, code)) break;
  }
  var matchId = nk.matchCreate(g.def.id, { bet: String(bet), mode: g.mode, private: '1', name: name, code: code, pin: pin, host: ctx.userId });
  return JSON.stringify({ matchId: matchId, bet: bet, code: code, game: g.def.id, mode: g.mode });
}

/** Kodla herhangi bir oyunun özel odasını bulur (okey ve tavla dahil). */
function kFindRoom(nk, code) {
  var list = nk.matchList(1, true, null, 0, 4, '+label.private:1 +label.code:' + code) || [];
  return list.length ? list[0] : null;
}

/** Kodla katılma. Girdi: {code, pin?}. Çıktı: {matchId, bet, code, game, mode}. */
function rpcCardPrivateJoin(ctx, logger, nk, payload) {
  if (!ctx.userId) throw Error('Oturum gerekli');
  var req = parseRequest(payload);
  var code = String(req.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) throw Error('SALON:Oda kodu 6 karakter olmalı');
  var room = kFindRoom(nk, code);
  if (!room) throw Error('SALON:Bu kodla açık oda yok');
  var label = JSON.parse(room.label);
  var bet = parseInt(String(label.bet).slice(1), 10);
  if (walletChips(nk, ctx.userId) < bet) throw Error('SALON:Bu oda için çipin yetmiyor');
  var answer = nk.matchSignal(room.matchId, JSON.stringify({ type: 'allow', userId: ctx.userId, pin: req.pin || '' }));
  if (answer === 'pin') throw Error(req.pin ? 'SALON:Şifre yanlış' : 'SALON:PIN_GEREKLI');
  if (answer === 'full') throw Error('SALON:Oda dolu');
  if (answer === 'started') throw Error('SALON:Oyun başladı, bitince tekrar dene');
  if (answer !== 'ok') throw Error('SALON:Odaya girilemedi');
  return JSON.stringify({ matchId: room.matchId, bet: bet, code: code, game: label.game, mode: label.mode || '' });
}
