# Salon · Frontend mimarisi (Adım 8)

Bu belge prototipteki davranışların Flutter uygulamasında nasıl kurulacağını anlatır. Prototip: `prototype/demo.html` (akış) ve `prototype/index.html` (okey masası).

## Katmanlar

| Katman | Seçim | Görev |
|---|---|---|
| Arayüz | Flutter (Dart), masa için Flame | Lobi, menüler, formlar Flutter widget'ı; masa (ıstaka, taş, zar animasyonları) Flame bileşeni |
| Durum yönetimi | Riverpod (`riverpod_generator` ile) | Masa, oyuncular, bakiye, sıra, bağlantı durumu |
| Gerçek zamanlı | WebSocket (Nakama realtime socket) | Taş çekme/atma, zar, oda kurma, davet, sohbet. Milisaniyelik paketler |
| REST | Nakama RPC / HTTP | Profil kaydı, mağaza alışverişi, liderlik tablosu |
| Kalıcı veri | PostgreSQL (Nakama içinde) + Redis | Hesap, çip, istatistik / anlık masa durumu |

Not: Metin Socket.io veya gRPC öneriyor. Nakama'nın realtime socket'i de çift yönlü WebSocket akışıdır ve resmi Dart istemcisi vardır. Üstelik oturum, eşleştirme, parti (arkadaşla aynı masa), sohbet ve liderlik tablosunu hazır verdiği için ilk planladığımız Nakama ile devam etmek daha az iş. Kendi sunucumuzu yazmak istersek alternatif: Node.js + Socket.io + `socket_io_client` (Dart).

## Riverpod durum ağacı

```
authProvider            → oturum, misafir mi, kullanıcı adı
walletProvider          → çip bakiyesi (REST + sokettan gelen anlık değişim)
socketProvider          → tek WebSocket bağlantısı, yeniden bağlanma
connectionProvider      → online | reconnecting(kalanSaniye) | offline
tableProvider(family: tableId)
  ├─ seatsProvider      → 4 koltuk: oyuncu, bağlantı durumu, bot mu
  ├─ rackProvider       → kendi ıstakam (sadece bende)
  ├─ turnProvider       → sıra kimde, kalan süre
  ├─ pilesProvider      → atılan taşlar
  └─ voteProvider       → bağlantı oylaması (varsa)
friendsProvider         → arkadaşlar ve detaylı durumları (Nakama presence)
audioProvider           → ortam sesi seviyesi, efekt, titreşim, sesli sohbet
```

Kural: Widget'lar `ref.watch(tableProvider(id).select((t) => t.turn))` gibi `select` ile sadece ihtiyaç duyduğu alanı dinler. Böylece bir taş atıldığında bütün ekran değil, sadece değişen parça yeniden çizilir (60/120 FPS hedefi).

## Soket mesajları (masa)

| Yön | Mesaj | İçerik |
|---|---|---|
| İstemci → sunucu | `draw` | `{source: "deck" \| "left"}` |
| İstemci → sunucu | `discard` | `{tileId}` |
| İstemci → sunucu | `finish` | `{tileId, groups}` (sunucu doğrular) |
| İstemci → sunucu | `vote` | `{choice: "cancel" \| "ai"}` |
| Sunucu → istemci | `state` | Masanın tam anlık görüntüsü (bağlanınca ve yeniden bağlanınca) |
| Sunucu → istemci | `event` | `drew`, `discarded`, `turn`, `presence`, `vote_open`, `vote_result`, `hand_over` |

Oyun kuralları ve taş dağıtımı her zaman sunucuda çalışır. İstemci sadece niyet gönderir, sonucu sunucudan alır (hile önleme).

## Adım 6: Bağlantı kopması ve 30 saniyelik tolerans

1. Sunucu, oyuncunun soketi düşünce koltuğu hemen bota vermez. `presence: reconnecting, deadline: +30s` olayını masadaki herkese yollar.
2. Diğer istemciler avatarı yarı saydam gösterir, sayacı `deadline`'a göre kendi saatinden hesaplar.
3. Kopan oyuncunun sırası gelirse masa bekler. Diğer oyuncuların süre sayaçları durmaz, sadece kopan oyuncunun hamlesi beklenir.
4. Oyuncu 30 saniye içinde aynı oturum belirteciyle (session token) bağlanırsa sunucu `state` anlık görüntüsünü yollar, oyuncu kaldığı yerden devam eder.
5. Süre dolarsa sunucu `vote_open` yollar. Kalan oyuncular "Eli iptal et" veya "Yapay zekâ ile devam" seçer. Çoğunluk kazanır, eşitlikte yapay zekâ ile devam edilir. İptal edilirse bahisler iade edilir.
6. Kendi bağlantım koptuğunda istemci `connectivity_plus` ile bunu anlar, tam ekran "Bağlantın koptu, yeniden bağlanılıyor (Xs)" katmanını gösterir ve üstel bekleme ile yeniden bağlanmayı dener.

## Adım 6: Dokunma hissi ve ses

| Olay | Titreşim | Ses |
|---|---|---|
| Taş çekme | `HapticFeedback.selectionClick()` | Kısa tahta tıkırtısı |
| Taş atma | `HapticFeedback.mediumImpact()` | Taşın masaya vuruşu |
| Zar atma | `HapticFeedback.mediumImpact()` × 3 | Zar yuvarlanma |
| El kazanma | `HapticFeedback.heavyImpact()` | Çip sesi |
| Son 5 saniye | `HapticFeedback.lightImpact()` her saniye | Tik tak |

- Android'de daha zengin desenler için `vibration` paketi, iOS'ta Core Haptics desenleri (Flutter'dan platform kanalıyla).
- Ortam sesi: `flame_audio` (veya `just_audio`) ile döngüde kahvehane uğultusu ve rastgele aralıklarla çay kaşığı tıngırtısı. Seviyesi ayarlardan değişir.
- Sesli sohbet: LiveKit (veya Agora). Mikrofon açılınca ortam sesi `audio_session` üzerinden %10'a yumuşakça kısılır, kapanınca eski seviyesine döner.
- Prototipte bunlar Web Audio ve `navigator.vibrate` ile taklit ediliyor (iPhone tarayıcısı titreşimi desteklemez, gerçek uygulamada sorun değil).

## Adım 7: Arkadaşlar, gizli odalar, davet bağlantıları

- Arkadaş durumu Nakama presence ile gelir: `{status: "table", host: "Ahmet", mode: "101 Okey", hand: 5}`. Gizli odadaki arkadaş için sadece "Gizli bir masada" gösterilir.
- "Masama çağır" tek dokunuşla bildirim (push + uygulama içi) yollar.
- Oda şifreli veya gizliyse sunucu tek kullanımlık bir geçiş anahtarı üretir: rastgele 6+ karakterlik kod, sunucuda saklanır, 10 dakika geçerli, ilk kullanımda silinir. Bağlantı: `https://salon.app/masa/<oda>?anahtar=<kod>`.
- Bağlantılar iOS Universal Links ve Android App Links ile uygulamayı açar (`app_links` paketi). Uygulama anahtarı sunucuya yollar, sunucu doğrularsa oyuncu şifre sormadan oturur.
- Gizli odalar salon listelerinde ve arama sonuçlarında hiç görünmez. Sadece davetle veya anahtarla girilir.

## Klasör yapısı

```
lib/
  app/            → yönlendirme (go_router), tema (Gece masası / Su yeşili)
  core/           → soket istemcisi, REST, hata yönetimi, ses ve titreşim servisleri
  features/
    auth/         → giriş, misafir, profil kaydı
    lobby/        → ana sayfa, oyun kartları, alt menü
    table_okey/   → okey masası (Flame), kurallar sadece sunucuda
    room/         → özel oda kurma, davet, geçiş anahtarı
    friends/      → arkadaş listesi, durumlar, davetler
    store/        → mağaza, uygulama içi satın alma (in_app_purchase)
    leaderboard/  → günlük / haftalık sıralama
```

## Performans kuralları

- Masa Flame içinde ayrı bir `GameWidget`; Flutter ağacının geri kalanı her taş hareketinde yeniden çizilmez.
- Sık değişen bölgeler (`ıstaka`, `sayaç halkası`) `RepaintBoundary` içinde.
- Arka plan fotoğrafları ekran çözünürlüğüne göre küçültülüp önbelleğe alınır (`precacheImage`).
- Animasyonlar sadece `transform` ve `opacity` değiştirir. "Hareketi azalt" açıksa kısaltılır.
