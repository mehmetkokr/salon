# Salon · Flutter uygulaması

## İlk kurulum

1. Flutter SDK'yı kurun (https://docs.flutter.dev/get-started/install/windows).
2. Bu klasörde platform dosyalarını oluşturun. Mevcut `lib/` dosyalarının üzerine yazılmaz:
   ```
   flutter create --org com.salon --project-name salon --platforms android,ios .
   ```
3. Paketleri indirin ve testleri çalıştırın:
   ```
   flutter pub get
   flutter test
   ```

## Nakama sunucusunu açma

Docker Desktop kuruluysa `server/` klasöründe:
```
docker compose up
```
Konsol: http://127.0.0.1:7351 (admin / password)

## Uygulamayı çalıştırma

- iOS simülatörü veya masaüstü: `flutter run`
- Android emülatörü (bilgisayarın localhost'u 10.0.2.2): `flutter run --dart-define=NAKAMA_HOST=10.0.2.2`
- Gerçek telefon: bilgisayarın yerel IP'sini verin, örn. `--dart-define=NAKAMA_HOST=192.168.1.20`

Android'de şifresiz HTTP (yerel sunucu) için `android/app/src/main/AndroidManifest.xml` içindeki `<application>` etiketine geliştirme süresince `android:usesCleartextTraffic="true"` ekleyin. `flutter_secure_storage` için `android/app/build.gradle` içinde `minSdkVersion` en az 23 olmalı.

## Klasörler

```
lib/
  core/constants/   renkler, Nakama ayarları
  core/theme/       Gece masası (koyu) ve Su yeşili (açık) Material 3 temaları
  core/services/    NakamaService, oturum deposu, Riverpod sağlayıcıları
  features/auth/    misafir girişi (Google, Apple, e-posta sırada)
  features/lobby/   geçici lobi: kullanıcı adı ve soket durumu
```
