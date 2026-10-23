import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadWith } from './load.mjs';

const SYSTEM = '00000000-0000-0000-0000-000000000000';

function setup() {
  let now = Date.UTC(2026, 9, 23, 12);
  class FakeDate extends Date {
    constructor(...a) {
      super(...(a.length ? a : [now]));
    }
    static now() {
      return now;
    }
  }
  const M = loadWith({ Date: FakeDate }, 'rewards.js', 'account.js');
  const users = { 'ayse@ornek.com': 'u1' };
  const storage = {};
  const passwords = {};
  const logs = [];
  let uuid = 0;
  const nk = {
    sqlQuery: (q, [email]) => (users[email] ? [{ id: users[email] }] : []),
    sqlExec: (q, [hash, id]) => {
      passwords[id] = hash;
      return { rowsAffected: 1 };
    },
    bcryptHash: (p) => 'bcrypt(' + p + ')',
    sha256Hash: (s) => createHash('sha256').update(s).digest('hex'),
    uuidv4: () => (++uuid).toString(16).padStart(12, '0') + '-0000-4000-8000-000000000000',
    storageRead: (keys) =>
      keys.filter((k) => storage[k.userId + k.key]).map((k) => ({ value: JSON.parse(storage[k.userId + k.key]) })),
    storageWrite: (objs) => objs.forEach((o) => (storage[o.userId + o.key] = JSON.stringify(o.value))),
    httpRequest: () => assert.fail('e-posta servisi ayarlı değilken istek atılmamalı'),
  };
  const logger = { warn: (...a) => logs.push(a), info: () => {}, error: () => {} };
  const ctx = { env: {} };
  const call = (fn, body) => JSON.parse(M[fn](ctx, logger, nk, JSON.stringify(body)));
  const codeSent = () => logs[logs.length - 1][2];
  return { M, call, codeSent, logs, storage, passwords, advance: (ms) => (now += ms), nk, ctx };
}

test('kayıtsız e-posta için de "gönderildi" der, kod üretmez', () => {
  const t = setup();
  assert.deepEqual(t.call('rpcPasswordResetRequest', { email: 'yok@ornek.com' }), { sent: true });
  assert.equal(t.logs.length, 0);
});

test('kod doğruysa şifre değişir, kod ikinci kez kullanılamaz', () => {
  const t = setup();
  t.call('rpcPasswordResetRequest', { email: ' Ayse@Ornek.com ' });
  const code = t.codeSent();
  assert.match(code, /^\d{6}$/);
  assert.ok(!JSON.stringify(t.storage).includes('"' + code + '"'), 'kodun kendisi saklanmaz');
  assert.deepEqual(t.call('rpcPasswordResetConfirm', { email: 'ayse@ornek.com', code, password: 'yeni-sifre' }), {
    reset: true,
  });
  assert.equal(t.passwords.u1, 'bcrypt(yeni-sifre)');
  assert.throws(
    () => t.call('rpcPasswordResetConfirm', { email: 'ayse@ornek.com', code, password: 'baska-sifre' }),
    /SALON:Kod yanlış/
  );
});

test('kısa şifre, süresi dolmuş kod ve 5 yanlış deneme reddedilir', () => {
  const t = setup();
  t.call('rpcPasswordResetRequest', { email: 'ayse@ornek.com' });
  const code = t.codeSent();
  assert.throws(() => t.call('rpcPasswordResetConfirm', { email: 'ayse@ornek.com', code, password: 'kisa' }), /8 karakter/);
  for (let i = 0; i < 5; i++) {
    assert.throws(() =>
      t.call('rpcPasswordResetConfirm', { email: 'ayse@ornek.com', code: '999999' === code ? '000000' : '999999', password: 'yeni-sifre' })
    );
  }
  assert.throws(
    () => t.call('rpcPasswordResetConfirm', { email: 'ayse@ornek.com', code, password: 'yeni-sifre' }),
    /SALON:Kod yanlış/,
    'beş yanlıştan sonra doğru kod da geçmez'
  );
  t.advance(61000);
  t.call('rpcPasswordResetRequest', { email: 'ayse@ornek.com' });
  const fresh = t.codeSent();
  t.advance(16 * 60 * 1000);
  assert.throws(() => t.call('rpcPasswordResetConfirm', { email: 'ayse@ornek.com', code: fresh, password: 'yeni-sifre' }));
  assert.equal(t.passwords.u1, undefined);
});

test('dakikada bir, günde en fazla beş kod gönderilir', () => {
  const t = setup();
  t.call('rpcPasswordResetRequest', { email: 'ayse@ornek.com' });
  t.call('rpcPasswordResetRequest', { email: 'ayse@ornek.com' });
  assert.equal(t.logs.length, 1, 'bir dakika dolmadan ikinci kod yok');
  for (let i = 0; i < 6; i++) {
    t.advance(61000);
    t.call('rpcPasswordResetRequest', { email: 'ayse@ornek.com' });
  }
  assert.equal(t.logs.length, 5);
});

test('e-posta servisi ayarlıysa Resend ile gönderir', () => {
  const t = setup();
  const sent = [];
  t.ctx.env = { RESET_MAIL_API_KEY: 're_test', RESET_MAIL_FROM: 'Salon <kod@salon.test>' };
  t.nk.httpRequest = (url, method, headers, body) => {
    sent.push({ url, headers, body: JSON.parse(body) });
    return { code: 200, body: '{}' };
  };
  t.call('rpcPasswordResetRequest', { email: 'ayse@ornek.com' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.equal(sent[0].headers.Authorization, 'Bearer re_test');
  assert.deepEqual(sent[0].body.to, ['ayse@ornek.com']);
  assert.match(sent[0].body.text, /\d{6}/);
  assert.equal(t.logs.length, 0, 'kod günlüğe yazılmaz');
});
