import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon/core/services/nakama_service.dart';
import 'package:salon/core/services/service_providers.dart';
import 'package:salon/features/auth/application/auth_controller.dart';

class FakeGateway implements AuthGateway {
  SignedInUser? restored;
  bool failGuest = false;
  int signOutCalls = 0;

  @override
  Future<SignedInUser?> restoreSession() async => restored;

  @override
  Future<SignedInUser> signInAsGuest() async {
    if (failGuest) throw Exception('sunucuya ulaşılamadı');
    return const SignedInUser(userId: 'u1', username: 'Oyuncu_1234', isGuest: true, isNewAccount: true);
  }

  @override
  Future<void> signOut() async => signOutCalls++;

  @override
  SocketStatus get socketStatus => SocketStatus.disconnected;

  @override
  Stream<SocketStatus> get socketStatusChanges => const Stream.empty();
}

void main() {
  late FakeGateway gateway;
  late ProviderContainer container;

  setUp(() {
    gateway = FakeGateway();
    container = ProviderContainer(overrides: [authGatewayProvider.overrideWithValue(gateway)]);
  });
  tearDown(() => container.dispose());

  test('kayıtlı oturum yoksa giriş yapılmamış başlar', () async {
    expect(await container.read(authControllerProvider.future), isNull);
  });

  test('kayıtlı oturum varsa geri yüklenir', () async {
    gateway.restored = const SignedInUser(userId: 'u9', username: 'Oyuncu_9999', isGuest: true, isNewAccount: false);
    final user = await container.read(authControllerProvider.future);
    expect(user?.username, 'Oyuncu_9999');
  });

  test('misafir girişi oyuncuyu döndürür', () async {
    await container.read(authControllerProvider.future);
    await container.read(authControllerProvider.notifier).signInAsGuest();
    final state = container.read(authControllerProvider);
    expect(state.value?.username, 'Oyuncu_1234');
    expect(state.value?.isGuest, isTrue);
  });

  test('sunucuya ulaşılamazsa hata durumuna geçer', () async {
    gateway.failGuest = true;
    await container.read(authControllerProvider.future);
    await container.read(authControllerProvider.notifier).signInAsGuest();
    expect(container.read(authControllerProvider).hasError, isTrue);
  });

  test('çıkış yapınca oturum kapanır', () async {
    await container.read(authControllerProvider.future);
    await container.read(authControllerProvider.notifier).signInAsGuest();
    await container.read(authControllerProvider.notifier).signOut();
    expect(container.read(authControllerProvider).value, isNull);
    expect(gateway.signOutCalls, 1);
  });
}
