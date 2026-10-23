// Çalışan Nakama'ya karşı özel oda denemesi (birim testi değil).
// Çalıştırma: node server/test/e2e_private.mjs   (docker compose up gerekli)
const HOST = '127.0.0.1:7350';
const basic = 'Basic ' + Buffer.from('defaultkey:').toString('base64');

async function login(deviceId) {
  const r = await fetch(`http://${HOST}/v2/account/authenticate/device?create=true`, {
    method: 'POST',
    headers: { Authorization: basic, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: deviceId }),
  });
  const token = (await r.json()).token;
  await rpc(token, 'bootstrap'); // hoş geldin çipi
  return token;
}

async function rpc(token, id, payload = {}) {
  const r = await fetch(`http://${HOST}/v2/rpc/${id}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(payload)),
  });
  const j = await r.json();
  if (!r.ok) return { error: j.message || j.error, raw: j };
  return JSON.parse(j.payload);
}

function socket(token, onState) {
  const ws = new WebSocket(`ws://${HOST}/ws?lang=en&status=true&token=${token}`);
  ws.onmessage = (ev) => {
    const env = JSON.parse(ev.data);
    if (env.error) console.log('soket hatası:', env.error.message);
    if (!env.match_data) return;
    const data = JSON.parse(Buffer.from(env.match_data.data, 'base64').toString());
    onState(Number(env.match_data.op_code), data);
  };
  return new Promise((resolve) => (ws.onopen = () => resolve(ws)));
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const host = await login('e2e-private-host-01');
const guest = await login('e2e-private-guest-01');

const created = await rpc(host, 'okey_private_create', { name: '  Cuma   akşamı  ', bet: 500, pin: '4821' });
console.log('kuruldu:', created);
console.log('hatalı şifre biçimi:', (await rpc(host, 'okey_private_create', { name: 'x', bet: 500, pin: '12a4' })).error);
console.log('geçersiz bahis:', (await rpc(host, 'okey_private_create', { name: 'x', bet: 123 })).error);

let hostView = null;
let guestView = null;
const hs = await socket(host, (op, d) => (op === 1 ? (hostView = d) : console.log('ev sahibine uyarı:', d.msg)));
hs.send(JSON.stringify({ cid: '1', match_join: { match_id: created.matchId } }));
await wait(500);
console.log('oda bilgisi:', hostView?.room, 'faz:', hostView?.phase);

console.log('yanlış kod:', (await rpc(guest, 'okey_private_join', { code: 'ZZZZZZ' })).error);
console.log('şifresiz:', (await rpc(guest, 'okey_private_join', { code: created.code })).error);
console.log('yanlış şifre:', (await rpc(guest, 'okey_private_join', { code: created.code, pin: '0000' })).error);

// İzin almadan doğrudan katılma denemesi reddedilmeli
const gs = await socket(guest, (op, d) => (op === 1 ? (guestView = d) : console.log('misafire uyarı:', d.msg)));
gs.send(JSON.stringify({ cid: '2', match_join: { match_id: created.matchId } }));
await wait(500);
console.log('izinsiz katılma sonrası misafir durumu:', guestView ? 'GİRDİ (hata!)' : 'giremedi (doğru)');

const joined = await rpc(guest, 'okey_private_join', { code: created.code.toLowerCase(), pin: '4821' });
console.log('doğru şifre:', joined);
gs.send(JSON.stringify({ cid: '3', match_join: { match_id: joined.matchId } }));
await wait(500);
console.log('misafir görüyor:', guestView?.room, 'oturan:', guestView?.seats.filter(Boolean).length);

gs.send(JSON.stringify({ match_data_send: { match_id: joined.matchId, op_code: 5, data: b64({}) } }));
await wait(500);
hs.send(JSON.stringify({ match_data_send: { match_id: created.matchId, op_code: 5, data: b64({}) } }));
await wait(800);
console.log('başlatınca faz:', hostView?.phase, 'pot:', hostView?.pot, 'botlar:', hostView?.seats.filter((s) => s.bot).length);
hs.close();
gs.close();
