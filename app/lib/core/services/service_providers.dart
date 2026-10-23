import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'nakama_service.dart';
import 'session_storage.dart';

final sessionStorageProvider = Provider<SessionStorage>((ref) => SecureSessionStorage());

/// Uygulama boyunca tek Nakama servisi.
final nakamaServiceProvider = Provider<NakamaService>((ref) {
  final service = NakamaService(storage: ref.watch(sessionStorageProvider));
  ref.onDispose(service.dispose);
  return service;
});

/// Giriş akışının kullandığı arayüz. Testlerde sahte uygulamayla değiştirilir.
final authGatewayProvider = Provider<AuthGateway>((ref) => ref.watch(nakamaServiceProvider));

/// Çip, seviye ve ödül çağrıları. Testlerde sahte uygulamayla değiştirilir.
final profileGatewayProvider = Provider<ProfileGateway>((ref) => ref.watch(nakamaServiceProvider));

/// Gerçek zamanlı masalar. Testlerde sahte uygulamayla değiştirilir.
final tableGatewayProvider = Provider<TableGateway>((ref) => ref.watch(nakamaServiceProvider));

/// Soket durumu: bağlı / bağlanıyor / bağlantı yok.
final socketStatusProvider = StreamProvider<SocketStatus>((ref) async* {
  final gateway = ref.watch(authGatewayProvider);
  yield gateway.socketStatus;
  yield* gateway.socketStatusChanges;
});
