import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/services/nakama_service.dart';
import '../../core/services/service_providers.dart';
import '../auth/application/auth_controller.dart';

/// Oturum açmış oyuncunun sunucudaki durumu. Giriş yapılınca otomatik
/// yüklenir; çıkış yapılınca `null` olur.
class ProfileController extends AsyncNotifier<PlayerProfile?> {
  @override
  Future<PlayerProfile?> build() async {
    final user = ref.watch(authControllerProvider.select((a) => a.value?.userId));
    if (user == null) return null;
    return ref.read(profileGatewayProvider).bootstrap();
  }

  /// Günlük ödülü alır. Verilen çip miktarını döner (bugün alındıysa 0).
  Future<int> claimDaily() async {
    final p = await ref.read(profileGatewayProvider).claimDailyReward();
    state = AsyncData(p);
    return p.justGranted;
  }
}

final profileProvider = AsyncNotifierProvider<ProfileController, PlayerProfile?>(ProfileController.new);
