// OTOMATİK ÜRETİLDİ: elle düzenleme, server/src altını değiştirip server/build.mjs çalıştır.

// ===== src/rewards.js =====
// Salon sunucu modülü (Nakama JavaScript çalışma ortamı).
//
// Oyuncu ilerlemesi ve çip ödülleri burada, sunucuda hesaplanır; istemci
// sadece sonucu gösterir. Bütün çip hareketleri cüzdan defterine (ledger)
// gerekçesiyle yazılır: “çip hareketleri defteri” bunun üstüne kurulacak.
//
// RPC’ler:
//   bootstrap     → giriş sonrası çağrılır. Hoş geldin çipini (bir kez) verir,
//                   çip, seviye, XP ve günlük ödül durumunu döner.
//   daily_reward  → günlük ödülü alır (Türkiye saatiyle günde bir kez).

var WELCOME_CHIPS = 10000;
var DAILY_CHIPS = 500;
var WIN_XP = 60; // oyun sonunda kazanana
var PLAY_XP = 20; // oynayan herkese
var TR_OFFSET_MS = 3 * 60 * 60 * 1000; // Türkiye: UTC+3, yaz saati yok

var PROGRESS = { collection: 'profile', key: 'progress' };
var WELCOME = { collection: 'rewards', key: 'welcome' };
var DAILY = { collection: 'rewards', key: 'daily' };

/** Seviye atlamak için gereken XP (istemcideki tasarımla aynı formül). */
function xpNeed(level) {
  return 400 + 40 * level;
}

function turkeyDay(ms) {
  return new Date(ms + TR_OFFSET_MS).toISOString().slice(0, 10);
}

function nextTurkeyMidnight(ms) {
  var d = new Date(ms + TR_OFFSET_MS);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime() - TR_OFFSET_MS;
}

function readObject(nk, userId, spec) {
  var res = nk.storageRead([{ collection: spec.collection, key: spec.key, userId: userId }]);
  return res && res.length ? res[0].value : null;
}

/** Oyuncu okuyabilir, sadece sunucu yazabilir (permissionWrite: 0). */
function writeObject(nk, userId, spec, value) {
  nk.storageWrite([
    { collection: spec.collection, key: spec.key, userId: userId, value: value, permissionRead: 1, permissionWrite: 0 },
  ]);
}

function walletChips(nk, userId) {
  var account = nk.accountGetId(userId);
  var wallet = account && account.wallet ? account.wallet : {};
  return wallet.chips || 0;
}

function progressOf(nk, userId) {
  var p = readObject(nk, userId, PROGRESS);
  if (!p) {
    p = { level: 1, xp: 0 };
    writeObject(nk, userId, PROGRESS, p);
  }
  return p;
}

function dailyState(nk, userId, now) {
  var d = readObject(nk, userId, DAILY);
  var available = !d || d.lastDay !== turkeyDay(now);
  return { available: available, nextAt: available ? now : nextTurkeyMidnight(now) };
}

function profileOf(nk, userId) {
  var now = Date.now();
  var p = progressOf(nk, userId);
  return {
    chips: walletChips(nk, userId),
    level: p.level,
    xp: p.xp,
    xpNeed: xpNeed(p.level),
    played: p.played || 0,
    won: p.won || 0,
    daily: dailyState(nk, userId, now),
  };
}

function rpcBootstrap(ctx, logger, nk, payload) {
  var userId = ctx.userId;
  if (!userId) throw Error('Oturum gerekli');
  var welcomed = false;
  if (!readObject(nk, userId, WELCOME)) {
    nk.walletUpdate(userId, { chips: WELCOME_CHIPS }, { reason: 'hosgeldin' }, true);
    writeObject(nk, userId, WELCOME, { at: Date.now(), amount: WELCOME_CHIPS });
    welcomed = true;
    logger.info('Hoş geldin çipi verildi: %s', userId);
  }
  var profile = profileOf(nk, userId);
  profile.welcomeGranted = welcomed ? WELCOME_CHIPS : 0;
  return JSON.stringify(profile);
}

function rpcDailyReward(ctx, logger, nk, payload) {
  var userId = ctx.userId;
  if (!userId) throw Error('Oturum gerekli');
  var now = Date.now();
  var granted = 0;
  if (dailyState(nk, userId, now).available) {
    nk.walletUpdate(userId, { chips: DAILY_CHIPS }, { reason: 'gunluk_odul', day: turkeyDay(now) }, true);
    writeObject(nk, userId, DAILY, { lastDay: turkeyDay(now), at: now });
    granted = DAILY_CHIPS;
  }
  var profile = profileOf(nk, userId);
  profile.granted = granted;
  return JSON.stringify(profile);
}

/** Oyun sonunda XP ekler; gerekirse seviye atlatır. Yeni ilerlemeyi döner. */
function addXp(nk, userId, amount) {
  return addProgress(nk, userId, amount, null);
}

/**
 * Bitmiş bir oyunu oyuncunun karnesine yazar: oynanan ve kazanılan sayısı
 * (profildeki Maç / Kazanma) ve XP, tek kayıtta.
 */
function recordGame(nk, userId, won) {
  return addProgress(nk, userId, won ? WIN_XP : PLAY_XP, won);
}

function addProgress(nk, userId, amount, won) {
  var p = progressOf(nk, userId);
  if (won !== null) {
    p.played = (p.played || 0) + 1;
    if (won) p.won = (p.won || 0) + 1;
  }
  p.xp += amount;
  while (p.xp >= xpNeed(p.level)) {
    p.xp -= xpNeed(p.level);
    p.level += 1;
  }
  writeObject(nk, userId, PROGRESS, p);
  return p;
}

// ===== src/account.js =====
// Şifre sıfırlama.
//
// Oyuncu giriş ekranında, yani oturumu yokken şifresini unutur. Bu yüzden iki
// RPC http_key ile çağrılır (ctx.userId boş gelir):
//   password_reset_request {email}               → e-postaya 6 haneli kod gönderir
//   password_reset_confirm {email, code, password} → kod doğruysa şifreyi değiştirir
//
// Güvenlik:
// - İstek her zaman "gönderildi" der; e-postanın kayıtlı olup olmadığı belli olmaz.
// - Kod 15 dakika geçerli, en fazla 5 yanlış deneme; sonra yeni kod istenir.
// - Aynı hesaba dakikada bir, günde en fazla 5 kod gönderilir.
// - Kodun kendisi saklanmaz, özeti saklanır.
//
// E-posta gönderimi: Nakama'nın runtime.env ayarında RESET_MAIL_API_KEY ve
// RESET_MAIL_FROM varsa Resend (resend.com) üzerinden gönderilir. Yoksa
// (yerel geliştirme) kod sunucu günlüğüne yazılır.

var RESET_COLLECTION = 'password_reset';
var RESET_TTL_MS = 15 * 60 * 1000;
var RESET_MAX_TRIES = 5;
var RESET_COOLDOWN_MS = 60 * 1000;
var RESET_DAILY_MAX = 5;
var SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
var MIN_PASSWORD = 8;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function userIdByEmail(nk, email) {
  var rows = nk.sqlQuery('SELECT id FROM users WHERE email = $1', [email]);
  return rows && rows.length ? String(rows[0].id) : null;
}

function resetRecord(nk, userId) {
  var res = nk.storageRead([{ collection: RESET_COLLECTION, key: userId, userId: SYSTEM_USER_ID }]);
  return res && res.length ? res[0].value : null;
}

/** Sadece sunucu okur ve yazar. */
function writeReset(nk, userId, value) {
  nk.storageWrite([
    { collection: RESET_COLLECTION, key: userId, userId: SYSTEM_USER_ID, value: value, permissionRead: 0, permissionWrite: 0 },
  ]);
}

function resetCodeHash(nk, userId, code) {
  return nk.sha256Hash(userId + ':' + code);
}

/** 6 haneli kod; uuid'nin rastgele bitlerinden. */
function newResetCode(nk) {
  var hex = nk.uuidv4().replace(/-/g, '');
  var n = parseInt(hex.slice(0, 12), 16) % 1000000;
  return ('000000' + n).slice(-6);
}

function sendResetMail(ctx, logger, nk, email, code) {
  var env = ctx.env || {};
  var key = env.RESET_MAIL_API_KEY;
  if (!key) {
    logger.warn('[geliştirme] E-posta servisi ayarlı değil. %s için şifre sıfırlama kodu: %s', email, code);
    return;
  }
  var body = {
    from: env.RESET_MAIL_FROM || 'Salon <no-reply@salon.app>',
    to: [email],
    subject: 'Salon şifre sıfırlama kodun: ' + code,
    text:
      'Merhaba,\n\nSalon hesabının şifresini sıfırlamak için kodun: ' +
      code +
      '\n\nKod 15 dakika geçerlidir. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; şifren değişmez.\n\nSalon',
  };
  var res = nk.httpRequest(
    'https://api.resend.com/emails',
    'post',
    { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    JSON.stringify(body),
    10000
  );
  if (!res || res.code >= 300) {
    logger.error('Şifre sıfırlama e-postası gönderilemedi: %s', res ? res.code + ' ' + res.body : 'yanıt yok');
    throw Error('SALON:E-posta şu an gönderilemedi, biraz sonra tekrar dene');
  }
}

function parseResetRequest(payload) {
  try {
    return JSON.parse(payload || '{}');
  } catch (e) {
    throw Error('SALON:İstek okunamadı');
  }
}

function rpcPasswordResetRequest(ctx, logger, nk, payload) {
  var email = normalizeEmail(parseResetRequest(payload).email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) throw Error('SALON:Geçerli bir e-posta adresi yaz');
  var ok = JSON.stringify({ sent: true });
  var userId = userIdByEmail(nk, email);
  if (!userId) return ok; // kayıtlı değil; dışarıdan bakan bunu ayırt edemez
  var now = Date.now();
  var day = turkeyDay(now);
  var prev = resetRecord(nk, userId);
  if (prev && now - prev.sentAt < RESET_COOLDOWN_MS) return ok;
  var sentToday = prev && prev.day === day ? prev.sentToday : 0;
  if (sentToday >= RESET_DAILY_MAX) return ok;
  var code = newResetCode(nk);
  sendResetMail(ctx, logger, nk, email, code);
  writeReset(nk, userId, {
    hash: resetCodeHash(nk, userId, code),
    expiresAt: now + RESET_TTL_MS,
    tries: 0,
    sentAt: now,
    day: day,
    sentToday: sentToday + 1,
  });
  return ok;
}

function rpcPasswordResetConfirm(ctx, logger, nk, payload) {
  var req = parseResetRequest(payload);
  var email = normalizeEmail(req.email);
  var code = String(req.code || '').replace(/\D/g, '');
  var password = String(req.password || '');
  if (password.length < MIN_PASSWORD) throw Error('SALON:Şifre en az ' + MIN_PASSWORD + ' karakter olmalı');
  var wrong = 'SALON:Kod yanlış ya da süresi dolmuş. Yeni kod isteyebilirsin';
  var userId = userIdByEmail(nk, email);
  if (!userId) throw Error(wrong);
  var rec = resetRecord(nk, userId);
  if (!rec || !rec.hash || Date.now() > rec.expiresAt || rec.tries >= RESET_MAX_TRIES) throw Error(wrong);
  if (code.length !== 6 || resetCodeHash(nk, userId, code) !== rec.hash) {
    rec.tries += 1;
    if (rec.tries >= RESET_MAX_TRIES) rec.hash = null;
    writeReset(nk, userId, rec);
    throw Error(wrong);
  }
  // Nakama şifreyi bcrypt özeti olarak bytea sütununda tutar.
  nk.sqlExec("UPDATE users SET password = convert_to($1, 'UTF8'), update_time = now() WHERE id = $2", [
    nk.bcryptHash(password),
    userId,
  ]);
  // Kod tek kullanımlık; günlük sayaç kalsın diye kayıt silinmez, kod boşaltılır.
  rec.hash = null;
  writeReset(nk, userId, rec);
  logger.info('Şifre sıfırlandı: %s', userId);
  return JSON.stringify({ reset: true });
}

// ===== src/okey_rules.js =====
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

// ===== src/okey101_rules.js =====
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

// ===== src/okey_match.js =====
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

// ===== src/okey101_match.js =====
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

// ===== src/tavla_rules.js =====
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

// ===== src/tavla_match.js =====
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

// ===== src/cards.js =====
// Ortak kart yardımcıları. 52 kart, kimlik 0..51:
//   renk = id / 13  (0 maça ♠, 1 kupa ♥, 2 karo ♦, 3 sinek ♣ — istemcideki CardSuit sırası)
//   değer = id % 13 + 2  (2..10, 11 vale, 12 kız, 13 papaz, 14 as)

var SPADES = 0;
var HEARTS = 1;
var DIAMONDS = 2;
var CLUBS = 3;
var JACK = 11;
var ACE = 14;

function cardSuit(id) {
  return Math.floor(id / 13);
}

function cardRank(id) {
  return (id % 13) + 2;
}

function cardId(suit, rank) {
  return suit * 13 + (rank - 2);
}

function shuffledCards(rng) {
  var deck = [];
  for (var i = 0; i < 52; i++) deck.push(i);
  for (var j = deck.length - 1; j > 0; j--) {
    var k = Math.floor(rng() * (j + 1));
    var t = deck[j];
    deck[j] = deck[k];
    deck[k] = t;
  }
  return deck;
}

/** İstemciye kart: {id, s, r}. */
function cardView(id) {
  return { id: id, s: cardSuit(id), r: cardRank(id) };
}

function withoutCard(list, id) {
  var at = list.indexOf(id);
  if (at < 0) return list;
  return list.slice(0, at).concat(list.slice(at + 1));
}

var SUIT_NAMES = ['maça', 'kupa', 'karo', 'sinek'];
var RANK_NAMES = { 11: 'vale', 12: 'kız', 13: 'papaz', 14: 'as' };

function cardName(id) {
  var r = cardRank(id);
  return SUIT_NAMES[cardSuit(id)] + ' ' + (RANK_NAMES[r] || String(r));
}

// ===== src/table_kit.js =====
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
      recordGame(nk, h.userId, winners.indexOf(k) >= 0);
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

// ===== src/pisti.js =====
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

// ===== src/batak.js =====
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

// ===== src/king.js =====
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

// ===== src/main.js =====
// Giriş noktası: RPC'leri ve maç işleyicilerini Nakama'ya tanıtır.
// Nakama işleyici fonksiyonlarının adlarını kaynaktan okur; bu yüzden
// hepsi dosyada üst düzeyde tanımlı olmalı (satır içi fonksiyon olmaz).
function InitModule(ctx, logger, nk, initializer) {
  initializer.registerRpc('bootstrap', rpcBootstrap);
  initializer.registerRpc('daily_reward', rpcDailyReward);
  initializer.registerRpc('password_reset_request', rpcPasswordResetRequest);
  initializer.registerRpc('password_reset_confirm', rpcPasswordResetConfirm);
  initializer.registerRpc('okey_quick', rpcOkeyQuick);
  initializer.registerRpc('okey_private_create', rpcOkeyPrivateCreate);
  initializer.registerRpc('okey_private_join', rpcOkeyPrivateJoin);
  initializer.registerRpc('tavla_quick', rpcTavlaQuick);
  initializer.registerRpc('tavla_private_create', rpcTavlaPrivateCreate);
  initializer.registerRpc('tavla_private_join', rpcTavlaPrivateJoin);
  initializer.registerMatch('tavla', {
    matchInit: tavlaMatchInit,
    matchJoinAttempt: tavlaMatchJoinAttempt,
    matchJoin: tavlaMatchJoin,
    matchLeave: tavlaMatchLeave,
    matchLoop: tavlaMatchLoop,
    matchTerminate: tavlaMatchTerminate,
    matchSignal: tavlaMatchSignal,
  });
  initializer.registerRpc('card_quick', rpcCardQuick);
  initializer.registerRpc('card_private_create', rpcCardPrivateCreate);
  initializer.registerRpc('card_private_join', rpcCardPrivateJoin);
  initializer.registerMatch('batak', {
    matchInit: batakMatchInit,
    matchJoinAttempt: kJoinAttempt,
    matchJoin: kJoin,
    matchLeave: kLeave,
    matchLoop: kLoop,
    matchTerminate: kTerminate,
    matchSignal: kSignal,
  });
  initializer.registerMatch('king', {
    matchInit: kingMatchInit,
    matchJoinAttempt: kJoinAttempt,
    matchJoin: kJoin,
    matchLeave: kLeave,
    matchLoop: kLoop,
    matchTerminate: kTerminate,
    matchSignal: kSignal,
  });
  initializer.registerMatch('pisti', {
    matchInit: pistiMatchInit,
    matchJoinAttempt: kJoinAttempt,
    matchJoin: kJoin,
    matchLeave: kLeave,
    matchLoop: kLoop,
    matchTerminate: kTerminate,
    matchSignal: kSignal,
  });
  initializer.registerMatch('okey', {
    matchInit: okeyMatchInit,
    matchJoinAttempt: okeyMatchJoinAttempt,
    matchJoin: okeyMatchJoin,
    matchLeave: okeyMatchLeave,
    matchLoop: okeyMatchLoop,
    matchTerminate: okeyMatchTerminate,
    matchSignal: okeyMatchSignal,
  });
  logger.info('Salon modülü yüklendi');
}
