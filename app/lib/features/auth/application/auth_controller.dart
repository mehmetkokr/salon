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

  Future<void> signOut() async {
    await ref.read(authGatewayProvider).signOut();
    state = const AsyncData(null);
  }
}

final authControllerProvider = AsyncNotifierProvider<AuthController, SignedInUser?>(AuthController.new);
