// Çalışan Nakama'ya karşı uçtan uca deneme (birim testi değil).
// Çalıştırma: node server/test/e2e_okey.mjs [duz|katlamali]   (docker compose up gerekli)
const MODE = process.argv[2] || 'duz';
const HOST = '127.0.0.1:7350';
const basic = 'Basic ' + Buffer.from('defaultkey:').toString('base64');

async function login(deviceId) {
  const r = await fetch(`http://${HOST}/v2/account/authenticate/device?create=true`, {
    method: 'POST',
    headers: { Authorization: basic, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: deviceId }),
  });
  return (await r.json()).token;
}

async function rpc(token, id, payload = {}) {
  const r = await fetch(`http://${HOST}/v2/rpc/${id}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(payload)),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return JSON.parse(j.payload);
}

const token = await login('e2e-okey-device-0001');
const before = await rpc(token, 'bootstrap');
console.log('bakiye', before.chips);
const quick = await rpc(token, 'okey_quick', { mode: MODE });
console.log('masa', quick);

const ws = new WebSocket(`ws://${HOST}/ws?lang=en&status=true&token=${token}`);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
let last = null;
let moves = 0;
let lastResult = null;
const done = new Promise((resolve) => {
  ws.onmessage = (ev) => {
    const env = JSON.parse(ev.data);
    if (env.error) console.log('hata', env.error);
    if (!env.match_data) return;
    const op = Number(env.match_data.op_code);
    const data = JSON.parse(Buffer.from(env.match_data.data, 'base64').toString());
    if (op === 9) console.log('uyarı:', data.msg);
    if (op !== 1) return;
    last = data;
    if (data.phase === 'finished' && data.result.gameOver) return resolve(data);
    if (data.phase === 'finished' && data.result !== lastResult) {
      lastResult = data.result;
      console.log('el', data.handNo, data.result.reason, 'puan değişimi', data.result.scoreDeltas, 'puanlar', data.scores);
    }
    if (data.phase === 'playing' && data.turn === data.you) {
      const send = (code, body) => ws.send(JSON.stringify({ match_data_send: { match_id: quick.matchId, op_code: code, data: b64(body) } }));
      if (data.stage === 'draw') send(2, { from: 'stock' });
      else if (moves++ < 3) { const id = data.lastDrawn ?? data.hand[0].id; console.log('at', id, 'el', data.hand.map((t) => t.id).join(','), 'stage', data.stage); send(3, { id }); }
      // 3 hamleden sonra süre aşımına bırak: sunucu otomatik oynamalı
    }
  };
});
ws.onopen = () => ws.send(JSON.stringify({ cid: '1', match_join: { match_id: quick.matchId } }));
const timeout = setTimeout(() => {
  console.log('zaman aşımı; son durum:', last && { phase: last.phase, stock: last.stockCount, turn: last.turn });
  process.exit(1);
}, 15 * 60 * 1000);
const end = await done;
clearTimeout(timeout);
console.log('el sayısı', end.handNo, 'son puanlar', end.scores, 'kazananlar', end.result.gameWinners);
console.log('sonuç', end.result.reason, 'kazanan', end.result.winner, 'tür', end.result.kind, 'çip', end.result.payouts, 'seats', end.seats.map((s) => s.name));
const after = await rpc(token, 'bootstrap');
console.log('bakiye', before.chips, '→', after.chips, 'xp', before.xp, '→', after.xp);
ws.close();
