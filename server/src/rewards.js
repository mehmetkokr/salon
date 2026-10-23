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
  var p = progressOf(nk, userId);
  p.xp += amount;
  while (p.xp >= xpNeed(p.level)) {
    p.xp -= xpNeed(p.level);
    p.level += 1;
  }
  writeObject(nk, userId, PROGRESS, p);
  return p;
}
