import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon/app.dart';
import 'package:salon/core/services/nakama_service.dart';
import 'package:salon/core/services/service_providers.dart';

class _Gateway implements AuthGateway {
  @override
  Future<SignedInUser?> restoreSession() async => null;

  @override
  Future<SignedInUser> signInAsGuest() async =>
      const SignedInUser(userId: 'u1', username: 'Oyuncu_4829', isGuest: true, isNewAccount: true);

  @override
  Future<void> signOut() async {}

  @override
  Future<SignedInUser> signInWithEmail(String email, String password, {bool create = false}) async =>
      SignedInUser(userId: 'u2', username: email.split('@').first, isGuest: false, isNewAccount: create);

  @override
  Future<SignedInUser> linkEmail(String email, String password, {String? username}) async =>
      SignedInUser(userId: 'u1', username: username ?? 'Oyuncu_1234', isGuest: false, isNewAccount: false);

  @override
  SocketStatus get socketStatus => SocketStatus.connected;

  @override
  Stream<SocketStatus> get socketStatusChanges => const Stream.empty();
}

class _Profiles implements ProfileGateway {
  bool claimed = false;

  PlayerProfile _p({required int chips, required bool daily, int granted = 0}) => PlayerProfile(
        chips: chips,
        level: 1,
        xp: 0,
        xpNeed: 440,
        dailyAvailable: daily,
        dailyNextAt: DateTime(2026),
        justGranted: granted,
      );

  @override
  Future<PlayerProfile> bootstrap() async => _p(chips: 10000, daily: !claimed, granted: 10000);

  @override
  Future<PlayerProfile> claimDailyReward() async {
    final first = !claimed;
    claimed = true;
    return _p(chips: first ? 10500 : 10500, daily: false, granted: first ? 500 : 0);
  }
}

void main() {
  testWidgets('misafir girişi lobiyi açar', (tester) async {
    tester.view.physicalSize = const Size(2532, 1170); // yatay telefon
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(ProviderScope(
      overrides: [
        authGatewayProvider.overrideWithValue(_Gateway()),
        profileGatewayProvider.overrideWithValue(_Profiles()),
      ],
      child: const SalonApp(),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Türkiye’nin Dijital Salonu'), findsOneWidget);
    await tester.tap(find.text('Misafir olarak gir'));
    await tester.pumpAndSettle();

    // Ana sayfa: oyuncu adı, üç oyun kartı ve alt menü.
    expect(find.text('Oyuncu_4829'), findsOneWidget);
    expect(find.text('Okey / 101 Salonu'), findsOneWidget);
    expect(find.text('Tavla Salonu'), findsOneWidget);
    expect(find.text('Kart Oyunları'), findsOneWidget);
    expect(find.text('Mağaza'), findsOneWidget);

    // Hoş geldin çipi sunucudan gelir; günlük ödül alınınca bakiye artar, buton kaybolur.
    expect(find.text('10.000'), findsOneWidget);
    await tester.tap(find.text('Ödül'));
    await tester.pumpAndSettle();
    expect(find.text('10.500'), findsOneWidget);
    expect(find.text('Ödül'), findsNothing);

    // Oyun kartı: Hemen başla / Özel oda kur paneli açılır.
    await tester.tap(find.text('Okey / 101 Salonu'));
    await tester.pumpAndSettle();
    expect(find.text('Hemen başla'), findsOneWidget);
    expect(find.text('Özel oda kur'), findsOneWidget);
  });
}
