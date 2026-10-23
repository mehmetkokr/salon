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
