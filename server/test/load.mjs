// Sunucu kaynak dosyaları Nakama'da tek bir betik olarak çalışır (modül
// sistemi yok). Testlerde aynı dosyaları bir vm bağlamına yükleyip
// fonksiyonlarına erişiyoruz.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

export function loadScripts(...names) {
  return loadWith({}, ...names);
}

/** `globals` ile (örneğin sahte Date) bağlam kurar. */
export function loadWith(globals, ...names) {
  const context = vm.createContext({ ...globals });
  for (const name of names) {
    vm.runInContext(readFileSync(srcDir + name, 'utf8'), context, { filename: name });
  }
  // vm bağlamındaki nesnelerin prototipleri farklıdır; deepEqual için
  // fonksiyon sonuçlarını düz nesnelere çeviriyoruz.
  return new Proxy(context, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = value(...args);
        return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
      };
    },
  });
}
