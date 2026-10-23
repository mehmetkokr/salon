// Masa testleri için sahte Nakama ortamı.
import { createHash } from 'node:crypto';
import { loadWith } from './load.mjs';

/** Sahte saat, cüzdan, depolama ve mesaj dağıtıcısıyla bir masa kurar. `game`: 'okey' ya da 'tavla'. */
export function setup({ chips = 10000, params = { bet: '500' }, game = 'okey' } = {}) {
  let now = 1_000_000;
  class FakeDate extends Date {
    static now() {
      return now;
    }
  }
  const M = loadWith({ Date: FakeDate }, 'rewards.js', 'okey_rules.js', 'okey101_rules.js', 'okey_match.js', 'okey101_match.js', 'tavla_rules.js', 'tavla_match.js', 'cards.js', 'table_kit.js', 'pisti.js', 'batak.js', 'king.js');
  const wallets = { u1: chips, u2: chips };
  const ledger = [];
  const storage = {};
  const sent = [];
  const nk = {
    walletUpdate(userId, change, meta) {
      const next = wallets[userId] + change.chips;
      if (next < 0) throw new Error('negatif bakiye');
      wallets[userId] = next;
      ledger.push({ userId, amount: change.chips, reason: meta.reason });
    },
    accountGetId: (id) => ({ wallet: { chips: wallets[id] } }),
    storageRead: (reqs) => reqs.filter((r) => storage[r.userId + r.key]).map((r) => ({ value: storage[r.userId + r.key] })),
    storageWrite: (objs) => objs.forEach((o) => (storage[o.userId + o.key] = o.value)),
    binaryToString: (s) => s,
    sha256Hash: (s) => createHash('sha256').update(s).digest('hex'),
    matchList: () => [],
  };
  const dispatcher = {
    broadcastMessage: (op, data, to) => sent.push({ op, data: JSON.parse(data), to: to.map((p) => p.userId) }),
    matchLabelUpdate() {},
  };
  const logger = { info() {}, warn() {}, error() {} };
  const ctx = { matchId: 'm1' };
  // Kart oyunları ortak iskeletin (k…) işleyicilerini kullanır.
  const handler = (name) => M[game + 'Match' + name] || M['k' + name];
  let { state } = handler('Init')(ctx, logger, nk, params);
  const presence = (userId) => ({ userId, username: userId === 'u1' ? 'Oyuncu_1' : 'Oyuncu_2', sessionId: 's' + userId });
  return {
    M,
    nk,
    wallets,
    ledger,
    storage,
    sent,
    get state() {
      return state;
    },
    advance(ms) {
      now += ms;
    },
    attempt: (userId) => handler('JoinAttempt')(ctx, logger, nk, dispatcher, 0, state, presence(userId), {}),
    join(...ids) {
      state = handler('Join')(ctx, logger, nk, dispatcher, 0, state, ids.map(presence)).state;
    },
    leave(...ids) {
      state = handler('Leave')(ctx, logger, nk, dispatcher, 0, state, ids.map(presence)).state;
    },
    loop(messages = []) {
      const r = handler('Loop')(ctx, logger, nk, dispatcher, 0, state, messages.map((m) => ({ sender: presence(m.from), opCode: m.op, data: JSON.stringify(m.body || {}) })));
      if (r) state = r.state;
      return r;
    },
    signal(data) {
      const r = handler('Signal')(ctx, logger, nk, dispatcher, 0, state, JSON.stringify(data));
      state = r.state;
      return r.data;
    },
    lastStateFor: (userId) => [...sent].reverse().find((m) => m.op === 1 && m.to.includes(userId))?.data,
  };
}
