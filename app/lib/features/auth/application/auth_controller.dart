import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/nakama_service.dart';
import '../../../core/services/service_providers.dart';

/// Oturum durumu: `null` = giriş yapılmamış.
///
/// Uygulama açılınca kayıtlı oturumu geri yüklemeyi dener; bu sırada
/// durum `AsyncLoading` olur ve yükleme ekranı görünür.
class AuthController extends AsyncNotifier<SignedInUser?> {
  @override
  Future<SignedInUser?> build() async {
    try {
      return await ref.read(authGatewayProvider).restoreSession();
    } catch (_) {
      // Sunucuya ulaşılamadıysa giriş ekranı gösterilir; kullanıcı tekrar dener.
      return null;
    }
  }

  /// Başarısız olursa durum `AsyncError` olur; giriş ekranı hatayı gösterir.
  /// Bekleme göstergesini giriş ekranı kendisi tutar, böylece ekran
  /// yükleme sayfasına atlamaz.
  Future<void> signInAsGuest() async {
    state = await AsyncValue.guard(() => ref.read(authGatewayProvider).signInAsGuest());
  }

  /// E-postayla giriş ya da yeni hesap. Hata olursa oyuncuya gösterilecek
  /// metni döner, durum değişmez; böylece hata giriş penceresinde kalır.
  Future<String?> signInWithEmail(String email, String password, {bool create = false}) =>
      _attempt(() => ref.read(authGatewayProvider).signInWithEmail(email, password, create: create));

  /// Misafir hesabını e-postaya bağlar (profili kaydeder).
  Future<String?> linkEmail(String email, String password, {String? username}) =>
      _attempt(() => ref.read(authGatewayProvider).linkEmail(email, password, username: username));

  Future<String?> _attempt(Future<SignedInUser> Function() run) async {
    try {
      final user = await run();
      if (ref.mounted) state = AsyncData(user);
      return null;
    } on AuthFailure catch (e) {
      return e.message;
    } catch (_) {
      return 'Sunucuya bağlanılamadı. İnternet bağlantını kontrol edip tekrar dene.';
    }
  }

  Future<void> signOut() async {
    await ref.read(authGatewayProvider).signOut();
    state = const AsyncData(null);
  }
}

final authControllerProvider = AsyncNotifierProvider<AuthController, SignedInUser?>(AuthController.new);
