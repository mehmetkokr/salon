# Görsel üretim komutları

Görsellerde yazı, buton, avatar gibi arayüz öğeleri olmamalı. Arayüzü kod çiziyor, görsel sadece sahneyi veriyor.

## Salon arka planları

Kayıt yeri: `assets/backgrounds/<salon>-aksam.jpg` ve `assets/backgrounds/<salon>-gunduz.jpg`
Ölçü: 2796 × 1290 (2,17:1), JPG veya WebP, 600 KB altı.

Kompozisyon kuralı: Ekranın alt %60'ını masa kaplıyor. Simge yapı (kule, cami, balon) görselin üst yarısında ve sol ya da sağ üçte birlik bölümde olmalı.

### Kız Kulesi, akşam (koyu tema)

```
Photorealistic wide photo of the Maiden's Tower (Kız Kulesi) in Istanbul at golden-hour sunset, seen from an elevated waterfront terrace, tower in the left third and in the upper half of the frame, warm lit windows, distant Istanbul skyline with mosques and minarets and the Bosphorus Bridge with lights on the horizon, purple-orange sky. 24mm lens, natural colors, high detail. No people, no text, no UI, no frame. Aspect ratio 2.17:1, 2796x1290.
```

### Kız Kulesi, gündüz (açık tema)

Yukarıdaki komutta `at golden-hour sunset ... purple-orange sky` yerine:

```
on a clear sunny morning, turquoise Bosphorus water, soft blue sky with light clouds
```

### Diğer salonlar

Aynı komutta yapı tarifini değiştirin:

| Salon | Yapı tarifi |
|---|---|
| Kapadokya | `hot air balloons over the fairy chimneys of Cappadocia, Göreme valley` |
| Efes | `the Library of Celsus in ancient Ephesus, marble columns` |
| Nemrut | `the colossal stone heads on Mount Nemrut at sunrise` |

## Istakalar (seviyeye göre)

Kayıt yeri: `assets/racks/<anahtar>.png` (düz ön görünüm, masada kendi ıstakan) ve `assets/racks/<anahtar>-aci.png` (3/4 açı, rakip ıstakaları ve seviye atlama ekranı).
Ölçü: 2400 × 700, şeffaf arka planlı PNG.

```
Photorealistic product render of an empty traditional Turkish okey tile rack (ıstaka) made of dark walnut wood, two tiers, front view straight-on, slightly from above, soft studio lighting, visible wood grain, isolated on a transparent background, no tiles, no text. 2400x700.
```

| Seviye | Anahtar | `dark walnut wood` yerine |
|---|---|---|
| 1 · Acemi | `cam` | `light pine wood` |
| 10 · Kahvehane | `gurgen` | `hornbeam wood` |
| 25 · Usta | `ceviz` | `dark walnut wood` |
| 50 · Üstat | `sedef` | `rosewood with mother-of-pearl inlay` |
| 100 · Efsane | `altin` | `black lacquer with gold filigree` |

Açılı görünüm için komutun sonuna `three-quarter angle view` ekleyin.
