// 101 okey masası: okey_match.js'teki masa yönetimine eklenen hamleler.
//
// Ek mesaj kodları:
//   7 → per indir / el aç  {groups: [[id, id, id], ...]}
//   8 → taş işle           {id, meld}   (meld: masadaki perin sırası)
// Elinde taş kalmayan oyuncu son taşını atınca eli bitirir.

var OP_OPEN = 7;
var OP_ADD = 8;
var HANDS_101 = 5; // bir oyun kaç el sürer
var SIDE_PENALTY_101 = 101; // yandan alıp kullanmama
var LIVE_TILE_PENALTY_101 = 101; // işlenebilir taş atma

/** El başında 101'e özgü alanları sıfırlar. */
function reset101Hand(state) {
  state.melds = [];
  state.turnCount = 0;
  for (var i = 0; i < 4; i++) {
    var s = state.seats[i];
    s.opened = false;
    s.openedKind = null;
    s.openedTurn = -1;
    s.sideTile = null;
    s.extra = 0;
  }
}

function addNote(state, msg) {
  state.notes = (state.notes || []).concat([msg]);
}

/** 101 hamlesi. Geçersizse hata metni, geçerliyse null. */
function applyMove101(state, seatIndex, move, nk, logger, now, rng) {
  if (state.phase !== 'playing') return 'Oyun başlamadı';
  if (seatIndex !== state.turn) return 'Sıra sende değil';
  var seat = state.seats[seatIndex];
  var okey = state.okey;

  if (move.type === 'draw') {
    if (state.stage !== 'draw') return 'Önce bir taş atmalısın';
    var id;
    if (move.from === 'discard') {
      var prev = state.seats[prevSeat(seatIndex)];
      if (!prev.discards.length) return 'Yerde alınacak taş yok';
      id = prev.discards[prev.discards.length - 1];
      prev.discards = prev.discards.slice(0, -1);
      seat.sideTile = id; // bu turda kullanılmalı
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

  if (move.type === 'open') {
    if (state.stage !== 'discard') return 'Önce taş çekmelisin';
    var groups = move.groups || [];
    var melds;
    var wasOpened = seat.opened;
    if (!seat.opened) {
      var ev = evaluateOpening(groups, seat.hand, okey);
      if (!ev.ok) return ev.error;
      melds = ev.melds;
      seat.opened = true;
      seat.openedKind = ev.kind;
      seat.openedTurn = state.turnCount;
    } else {
      // Açmış oyuncu yeni per indirebilir; en az puan şartı yok.
      // Geçerli olanlar indirilir, diğerleri ıstakada kalır.
      melds = [];
      for (var k = 0; k < groups.length; k++) {
        for (var x = 0; x < groups[k].length; x++) if (seat.hand.indexOf(groups[k][x]) < 0) return 'Bu taş elinde yok';
        var pairOk = seat.openedKind === 'cift' && groups[k].length === 2 && isPair(groups[k][0], groups[k][1], okey);
        var meld = pairOk ? { kind: 'pair', ids: groups[k].slice(), value: 0 } : analyzeMeld(groups[k], okey);
        if (meld) melds.push(meld);
      }
      if (!melds.length) return 'Istakada indirilecek geçerli per yok';
    }
    var laid = 0;
    for (var u = 0; u < melds.length; u++) laid += melds[u].ids.length;
    if (laid >= seat.hand.length) {
      if (!wasOpened) {
        seat.opened = false;
        seat.openedKind = null;
        seat.openedTurn = -1;
      }
      return 'Elinde atacak bir taş kalmalı';
    }
    var hand = seat.hand.slice();
    var all = [];
    for (var m = 0; m < melds.length; m++) {
      melds[m].owner = seatIndex;
      all = all.concat([melds[m]]);
      for (var t = 0; t < melds[m].ids.length; t++) {
        var at = hand.indexOf(melds[m].ids[t]);
        if (at >= 0) hand.splice(at, 1);
        if (melds[m].ids[t] === seat.sideTile) seat.sideTile = null;
      }
    }
    seat.hand = hand;
    state.melds = state.melds.concat(all);
    return null;
  }

  if (move.type === 'add') {
    if (state.stage !== 'discard') return 'Önce taş çekmelisin';
    if (!seat.opened) return 'Taş işlemek için önce elini açmalısın';
    var idx = seat.hand.indexOf(move.id);
    if (idx < 0) return 'Bu taş elinde yok';
    if (seat.hand.length <= 1) return 'Son taşını atarak bitirmelisin';
    var target = state.melds[move.meld];
    if (!target) return 'Böyle bir per yok';
    var updated = addToMeld(target, move.id, okey);
    if (!updated) return 'Bu taş o pere işlenmez';
    var list = state.melds.slice();
    list[move.meld] = updated;
    state.melds = list;
    var rest = seat.hand.slice();
    rest.splice(idx, 1);
    seat.hand = rest;
    if (move.id === seat.sideTile) seat.sideTile = null;
    return null;
  }

  if (move.type === 'discard' || move.type === 'finish') {
    if (state.stage !== 'discard') return 'Önce taş çekmelisin';
    var di = seat.hand.indexOf(move.id);
    if (di < 0) return 'Bu taş elinde yok';
    var last = seat.hand.length === 1;
    if (isJoker(move.id, okey) && !last) return 'Okey yalnızca son taş olarak atılır';
    if (last && !seat.opened) return 'Bitirmek için önce elini açmalısın';
    if (seat.sideTile !== null) {
      seat.extra += SIDE_PENALTY_101;
      addNote(state, seat.name + ' yandan aldığı taşı kullanmadı: 101 ceza');
    }
    if (!last && !isJoker(move.id, okey) && canAddAnywhere(state.melds, move.id, okey)) {
      seat.extra += LIVE_TILE_PENALTY_101;
      addNote(state, seat.name + ' işlenebilir taş attı: 101 ceza');
    }
    var after = seat.hand.slice();
    after.splice(di, 1);
    seat.hand = after;
    seat.sideTile = null;
    seat.lastDrawn = null;
    seat.moved = true;
    if (!after.length) {
      finish101Hand(state, nk, logger, now, {
        reason: 'win',
        winner: seatIndex,
        kind: seat.openedKind,
        okeyFinish: isJoker(move.id, okey),
        elden: seat.openedTurn === state.turnCount,
        finishTile: move.id,
        hand: [],
      });
      return null;
    }
    seat.discards = seat.discards.concat([move.id]);
    if (!state.stock.length) {
      finish101Hand(state, nk, logger, now, {
        reason: 'draw', winner: -1, kind: null, okeyFinish: false, elden: false, finishTile: null, hand: [],
      });
      return null;
    }
    state.turnCount++;
    nextTurn(state, now, rng);
    return null;
  }
  return 'Bilinmeyen hamle';
}

/** El sonu: cezalar toplama eklenir; son elde en düşük toplam potu alır. */
function finish101Hand(state, nk, logger, now, result) {
  var info = [];
  for (var i = 0; i < 4; i++) {
    var s = state.seats[i];
    info.push({ opened: s.opened, openedKind: s.openedKind, hand: s.hand, extra: s.extra });
  }
  var doubled = result.reason === 'win' && (result.okeyFinish || result.elden);
  var pens = handPenalties101(info, result.winner, doubled, state.okey);
  var totals = state.totals.slice();
  for (var j = 0; j < 4; j++) totals[j] += pens[j];
  state.totals = totals;
  result.penalties = pens;
  result.payouts = [0, 0, 0, 0];
  state.result = result;
  state.phase = 'finished';
  state.turnEndsAt = 0;
  if (state.handNo < HANDS_101) {
    result.gameOver = false;
    state.nextHandAt = state.private ? 0 : now + NEXT_HAND_MS;
    state.closeAt = 0;
    return;
  }
  var best = Math.min(totals[0], totals[1], totals[2], totals[3]);
  var winners = [];
  for (var w = 0; w < 4; w++) if (totals[w] === best) winners.push(w);
  result.gameOver = true;
  result.gameWinners = winners;
  state.gameOver = true;
  payGame(state, nk, logger, winners, result);
  state.nextHandAt = 0;
  state.closeAt = state.private ? 0 : now + RESULT_MS;
}

/** Bot ya da süresi dolan oyuncu (101). */
function autoPlay101(state, nk, logger, now, rng) {
  var seatIndex = state.turn;
  var seat = state.seats[seatIndex];
  var okey = state.okey;
  if (state.stage === 'draw') {
    var prev = state.seats[prevSeat(seatIndex)];
    var top = topDiscard(prev);
    var takeSide = seat.bot && top !== null && botWantsSide101(seat, top, state);
    applyMove101(state, seatIndex, { type: 'draw', from: takeSide ? 'discard' : 'stock' }, nk, logger, now, rng);
  }
  if (state.phase !== 'playing') return;
  if (seat.bot) {
    // Aç ya da yeni per indir (elde en az bir taş kalsın).
    var best = bestOpening(seat.hand, okey);
    var enough = seat.opened ? best.melds.length > 0 : best.value >= OPEN_MIN_101;
    if (enough) {
      var groups = [];
      var count = 0;
      for (var g = 0; g < best.melds.length; g++) {
        if (count + best.melds[g].ids.length >= seat.hand.length) break;
        groups.push(best.melds[g].ids);
        count += best.melds[g].ids.length;
      }
      if (groups.length) applyMove101(state, seatIndex, { type: 'open', groups: groups }, nk, logger, now, rng);
    }
    // İşlenebilecek her taşı işle.
    if (seat.opened) {
      var progress = true;
      while (progress && seat.hand.length > 1) {
        progress = false;
        for (var i = 0; i < seat.hand.length && !progress; i++) {
          for (var m = 0; m < state.melds.length; m++) {
            if (addToMeld(state.melds[m], seat.hand[i], okey)) {
              if (!applyMove101(state, seatIndex, { type: 'add', id: seat.hand[i], meld: m }, nk, logger, now, rng)) progress = true;
              break;
            }
          }
        }
      }
    }
  }
  if (state.phase !== 'playing') return;
  var id = seat.hand.length === 1 && seat.opened ? seat.hand[0] : botDiscard101(seat.hand, state.melds, okey);
  var error = applyMove101(state, seatIndex, { type: 'discard', id: id }, nk, logger, now, rng);
  if (error) {
    // Son taş okeyse ama açılmamışsa vb.: işe yaramaz ilk taşı at.
    for (var k = 0; k < seat.hand.length && error; k++) {
      error = applyMove101(state, seatIndex, { type: 'discard', id: seat.hand[k] }, nk, logger, now, rng);
    }
  }
}

/**
 * Bot yandaki taşı alsın mı? Açmışsa işleyebileceği ya da yeni per kurabileceği
 * taşı alır; açmamışsa yalnızca o taşla bu tur açabilecekse alır (yoksa ceza).
 */
function botWantsSide101(seat, top, state) {
  var okey = state.okey;
  if (isJoker(top, okey)) return seat.opened;
  if (seat.opened) return canAddAnywhere(state.melds, top, okey) || bestOpening(seat.hand.concat([top]), okey).value > bestOpening(seat.hand, okey).value;
  var withTop = bestOpening(seat.hand.concat([top]), okey);
  if (withTop.value < OPEN_MIN_101) return false;
  for (var i = 0; i < withTop.melds.length; i++) if (withTop.melds[i].ids.indexOf(top) >= 0) return true;
  return false;
}

/** Görünüme 101 alanları. */
function view101(state, seatIndex) {
  var melds = [];
  for (var i = 0; i < (state.melds || []).length; i++) {
    var m = state.melds[i];
    melds.push({ owner: m.owner, kind: m.kind, value: m.value, tiles: m.ids.map(tileOf) });
  }
  var opened = [];
  for (var s = 0; s < 4; s++) {
    var seat = state.seats[s];
    opened.push(seat && seat.opened ? (seat.openedKind === 'cift' ? 2 : 1) : 0);
  }
  var me = seatIndex >= 0 ? state.seats[seatIndex] : null;
  return {
    melds: melds,
    opened: opened,
    totals: state.totals,
    hands: HANDS_101,
    sideTile: me && me.sideTile !== null && me.sideTile !== undefined ? me.sideTile : null,
    extra: me ? me.extra || 0 : 0,
  };
}
