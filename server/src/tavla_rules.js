// Tavla kuralları (genel kurallar). Saf fonksiyonlar; Node testleriyle doğrulanır.
//
// Tahta: 24 hane. Beyaz (renk 0) 24'ten 1'e, siyah (renk 1) 1'den 24'e oynar.
//   points[i] (i = 1..24): >0 beyaz pul sayısı, <0 siyah pul sayısı.
//   bar[0|1]: kırık pullar, off[0|1]: toplanan pullar.
// Beyazın evi 1..6, siyahın evi 19..24.
//
// Hamle: {from, to}. from = 'bar' ya da hane; to = hane ya da 'off'.
// Kurallar: kırık pul önce girer; zarlar mümkün olduğunca çok kullanılır;
// yalnız biri kullanılabiliyorsa büyüğü kullanılır; çift gelirse dört hamle.

var WHITE = 0;
var BLACK = 1;

function initialBoard() {
  var p = [];
  for (var i = 0; i <= 25; i++) p.push(0);
  // Beyaz: 24'te 2, 13'te 5, 8'de 3, 6'da 5
  p[24] = 2;
  p[13] = 5;
  p[8] = 3;
  p[6] = 5;
  // Siyah (ayna): 1'de 2, 12'de 5, 17'de 3, 19'da 5
  p[1] = -2;
  p[12] = -5;
  p[17] = -3;
  p[19] = -5;
  return { points: p, bar: [0, 0], off: [0, 0] };
}

function cloneBoard(b) {
  return { points: b.points.slice(), bar: b.bar.slice(), off: b.off.slice() };
}

function sign(color) {
  return color === WHITE ? 1 : -1;
}

function owns(b, color, i) {
  return b.points[i] * sign(color) > 0;
}

function countAt(b, i) {
  return Math.abs(b.points[i]);
}

/** Hane, oyuncunun yönüne göre kaç adım ilerde: beyaz aşağı, siyah yukarı. */
function target(color, from, die) {
  return color === WHITE ? from - die : from + die;
}

function entryPoint(color, die) {
  return color === WHITE ? 25 - die : die;
}

function allHome(b, color) {
  if (b.bar[color] > 0) return false;
  for (var i = 1; i <= 24; i++) {
    if (!owns(b, color, i)) continue;
    if (color === WHITE && i > 6) return false;
    if (color === BLACK && i < 19) return false;
  }
  return true;
}

/** Evdeki haneyi toplamak için gereken uzaklık (beyaz: hane, siyah: 25 - hane). */
function distanceHome(color, i) {
  return color === WHITE ? i : 25 - i;
}

/** Bu zarla oynanabilecek tek adımlık hamleler. */
function singleMoves(b, color, die) {
  var moves = [];
  var opp = 1 - color;
  var open = function (i) {
    // Rakibin iki ya da daha fazla pulu yoksa konulabilir.
    return !(b.points[i] * sign(opp) >= 2);
  };
  if (b.bar[color] > 0) {
    var e = entryPoint(color, die);
    if (open(e)) moves.push({ from: 'bar', to: e, die: die });
    return moves;
  }
  var home = allHome(b, color);
  for (var i = 1; i <= 24; i++) {
    if (!owns(b, color, i)) continue;
    var t = target(color, i, die);
    if (t >= 1 && t <= 24) {
      if (open(t)) moves.push({ from: i, to: t, die: die });
    } else if (home) {
      var d = distanceHome(color, i);
      if (d === die) {
        moves.push({ from: i, to: 'off', die: die });
      } else if (d < die && !hasFurther(b, color, d)) {
        // Zar büyükse, ondan daha uzakta pul yoksa en uzaktaki toplanır.
        moves.push({ from: i, to: 'off', die: die });
      }
    }
  }
  return moves;
}

/** Evde, verilen uzaklıktan daha uzakta pul var mı? */
function hasFurther(b, color, d) {
  for (var i = 1; i <= 24; i++) {
    if (!owns(b, color, i)) continue;
    if (distanceHome(color, i) > d) return true;
  }
  return false;
}

function applySingle(b, color, m) {
  var n = cloneBoard(b);
  var s = sign(color);
  if (m.from === 'bar') n.bar[color]--;
  else n.points[m.from] -= s;
  if (m.to === 'off') {
    n.off[color]++;
    return n;
  }
  if (n.points[m.to] * s === -1) {
    // Tek rakip pulu: kırılır.
    n.points[m.to] = 0;
    n.bar[1 - color]++;
  }
  n.points[m.to] += s;
  return n;
}

function diceList(dice) {
  return dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : [dice[0], dice[1]];
}

function boardKey(b, remaining) {
  return b.points.join(',') + '|' + b.bar.join(',') + '|' + b.off.join(',') + '|' + remaining.slice().sort().join('');
}

function withoutDie(remaining, die) {
  var at = remaining.indexOf(die);
  return remaining.slice(0, at).concat(remaining.slice(at + 1));
}

/** Kalan zarlardan en çok kaçı kullanılabilir? */
function maxDice(b, color, remaining, memo) {
  if (!remaining.length) return 0;
  var key = boardKey(b, remaining);
  if (memo[key] !== undefined) return memo[key];
  var best = 0;
  var tried = {};
  for (var k = 0; k < remaining.length && best < remaining.length; k++) {
    var die = remaining[k];
    if (tried[die]) continue;
    tried[die] = true;
    var ms = singleMoves(b, color, die);
    for (var j = 0; j < ms.length && best < remaining.length; j++) {
      var v = 1 + maxDice(applySingle(b, color, ms[j]), color, withoutDie(remaining, die), memo);
      if (v > best) best = v;
    }
  }
  memo[key] = best;
  return best;
}

/**
 * Şu an oynanabilecek tek adımlar. Zarlar mümkün olduğunca çok kullanılmalı;
 * turun başında yalnız bir zar kullanılabiliyorsa büyüğü zorunludur.
 * `remaining`: bu turda kalan zarlar, `dice`: atılan iki zar.
 */
function legalSteps(b, color, remaining, dice, memo) {
  memo = memo || {};
  var max = maxDice(b, color, remaining, memo);
  if (!max) return [];
  var out = [];
  var tried = {};
  for (var k = 0; k < remaining.length; k++) {
    var die = remaining[k];
    if (tried[die]) continue;
    tried[die] = true;
    var ms = singleMoves(b, color, die);
    for (var j = 0; j < ms.length; j++) {
      if (1 + maxDice(applySingle(b, color, ms[j]), color, withoutDie(remaining, die), memo) === max) out.push(ms[j]);
    }
  }
  var turnStart = remaining.length === diceList(dice).length;
  if (turnStart && max === 1 && dice[0] !== dice[1]) {
    var big = Math.max(dice[0], dice[1]);
    var withBig = out.filter(function (m) {
      return m.die === big;
    });
    if (withBig.length) out = withBig;
  }
  return out;
}

/** Oyuncunun seçtiği adımı (zarı belirtmeyebilir) geçerli adımlarda bulur. */
function findStep(steps, step) {
  for (var i = 0; i < steps.length; i++) {
    var m = steps[i];
    if (m.from === step.from && m.to === step.to && (step.die === undefined || step.die === m.die)) return m;
  }
  return null;
}

/**
 * Bütün geçerli tam hamle dizileri (aynı sonuca varan sıralamalar tekilleşir).
 * Bot ve testler kullanır.
 */
function legalSequences(b, color, dice) {
  var memo = {};
  var results = [];
  var seen = {};
  function walk(board, remaining, seq) {
    var steps = remaining.length ? legalSteps(board, color, remaining, dice, memo) : [];
    if (!steps.length) {
      results.push(seq);
      return;
    }
    for (var i = 0; i < steps.length; i++) {
      var next = applySingle(board, color, steps[i]);
      var rest = withoutDie(remaining, steps[i].die);
      var key = boardKey(next, rest);
      if (seen[key]) continue;
      seen[key] = true;
      walk(next, rest, seq.concat([steps[i]]));
    }
  }
  walk(b, diceList(dice), []);
  return results;
}

/** Oyun bitti mi? Bittiyse kazanan ve puan (mars 2). */
function gameResult(b) {
  for (var c = 0; c < 2; c++) {
    if (b.off[c] === 15) return { winner: c, points: b.off[1 - c] === 0 ? 2 : 1, mars: b.off[1 - c] === 0 };
  }
  return null;
}

/** Pip sayısı: bitirmek için gereken toplam adım (bot ve bilgi için). */
function pipCount(b, color) {
  var sum = b.bar[color] * 25;
  for (var i = 1; i <= 24; i++) if (owns(b, color, i)) sum += countAt(b, i) * distanceHome(color, i);
  return sum;
}

// ---------------------------------------------------------------- Adil zar

/**
 * Doğrulanabilir zar: maç başında gizli tohum seçilir, özeti (sha256)
 * oyunculara gösterilir. n'inci atış sha256(tohum + ':' + n) değerinden
 * türetilir. Maç sonunda tohum açıklanır; herkes atışları yeniden hesaplar.
 * `sha256hex`: ortamın sha256 fonksiyonu (Nakama: nk.sha256Hash).
 */
function diceFromSeed(sha256hex, seed, n) {
  var hex = sha256hex(seed + ':' + n);
  var out = [];
  for (var i = 0; i + 2 <= hex.length && out.length < 2; i += 2) {
    var byte = parseInt(hex.substr(i, 2), 16);
    if (byte < 252) out.push((byte % 6) + 1); // 252 = 6 × 42: eşit dağılım
  }
  while (out.length < 2) out.push(1); // pratikte olmaz
  return out;
}

// ---------------------------------------------------------------- Bot

/** Hamle dizisi sonrası tahtanın puanı (yüksek iyi). */
function evaluateBoard(b, color) {
  var opp = 1 - color;
  var score = (pipCount(b, opp) - pipCount(b, color)) * 1.0;
  score += b.off[color] * 8;
  score += b.bar[opp] * 12;
  for (var i = 1; i <= 24; i++) {
    if (!owns(b, color, i)) continue;
    var n = countAt(b, i);
    if (n === 1) score -= 6 * exposure(b, color, i); // açık pul
    if (n >= 2) score += 3; // kapı
  }
  return score;
}

/** Açık pul rakibe ne kadar yakın (kırılma riski kabaca). */
function exposure(b, color, i) {
  var opp = 1 - color;
  var risk = 0;
  for (var j = 1; j <= 24; j++) {
    if (!owns(b, opp, j)) continue;
    // Rakip pulu bu pulun "arkasında" ise ileri gelip kırabilir.
    var dist = color === WHITE ? (j < i ? i - j : -1) : j > i ? j - i : -1;
    if (dist >= 1 && dist <= 12) risk += dist <= 6 ? 1 : 0.4;
  }
  if (b.bar[opp] > 0) risk += 0.5;
  return Math.min(risk, 3);
}

/** Botun en iyi hamle dizisi. */
function botSequence(b, color, dice) {
  var seqs = legalSequences(b, color, dice);
  var best = null;
  var bestScore = -Infinity;
  for (var i = 0; i < seqs.length; i++) {
    var board = b;
    for (var j = 0; j < seqs[i].length; j++) board = applySingle(board, color, seqs[i][j]);
    var sc = evaluateBoard(board, color);
    if (sc > bestScore) {
      bestScore = sc;
      best = seqs[i];
    }
  }
  return best || [];
}
