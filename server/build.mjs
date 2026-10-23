// Nakama JavaScript çalışma ortamı tek dosya yükler. src/ altındaki
// dosyaları sırayla birleştirip modules/index.js üretir.
// Çalıştırma: node server/build.mjs   (sonra: docker compose restart nakama)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const order = ['rewards.js', 'account.js', 'okey_rules.js', 'okey101_rules.js', 'okey_match.js', 'okey101_match.js', 'tavla_rules.js', 'tavla_match.js', 'cards.js', 'table_kit.js', 'pisti.js', 'batak.js', 'king.js', 'main.js'];
const parts = order.map((name) => `// ===== src/${name} =====\n` + readFileSync(root + 'src/' + name, 'utf8').trim() + '\n');
const header = '// OTOMATİK ÜRETİLDİ: elle düzenleme, server/src altını değiştirip server/build.mjs çalıştır.\n\n';
writeFileSync(root + 'modules/index.js', header + parts.join('\n'));
console.log('modules/index.js yazıldı');
