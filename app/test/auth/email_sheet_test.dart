import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon/core/design/widgets/salon_button.dart';
import 'package:salon/core/services/nakama_service.dart';
import 'package:salon/core/services/service_providers.dart';
import 'package:salon/core/theme/app_theme.dart';
import 'package:salon/features/auth/application/auth_controller.dart';
import 'package:salon/features/auth/presentation/email_sheet.dart';

class TestGateway implements AuthGateway {
  SignedInUser? current = const SignedInUser(userId: 'u1', username: 'Oyuncu_1234', isGuest: true, isNewAccount: false);
  Object? failWith;
  final calls = <String>[];

  @override
  Future<SignedInUser?> restoreSession() async => current;

  @override
  Future<SignedInUser> signInAsGuest() async => current!;

  @override
  Future<SignedInUser> signInWithEmail(String email, String password, {bool create = false}) async {
    calls.add('signIn $email create=$create');
    if (failWith != null) throw failWith!;
    return const SignedInUser(userId: 'u7', username: 'Kahveci', isGuest: false, isNewAccount: false);
  }

  @override
  Future<SignedInUser> linkEmail(String email, String password, {String? username}) async {
    calls.add('link $email name=$username');
    if (failWith != null) throw failWith!;
    return SignedInUser(userId: 'u1', username: username ?? 'Oyuncu_1234', isGuest: false, isNewAccount: false);
  }

  @override
  Future<void> signOut() async {}

  @override
  Future<void> requestPasswordReset(String email) async => calls.add('resetRequest $email');

  @override
  Future<SignedInUser> resetPassword(String email, String code, String newPassword) async {
    calls.add('reset $email $code');
    if (failWith != null) throw failWith!;
    return const SignedInUser(userId: 'u7', username: 'Kahveci', isGuest: false, isNewAccount: false);
  }

  @override
  SocketStatus get socketStatus => SocketStatus.connected;

  @override
  Stream<SocketStatus> get socketStatusChanges => const Stream.empty();
}

void main() {
  group('AuthFailure', () {
    test('Nakama hatalarını Türkçe cümleye çevirir', () {
      expect(AuthFailure.from(Exception('gRPC Error (code: 16, message: Invalid credentials.)')).message,
          'E-posta ya da şifre yanlış.');
      expect(AuthFailure.from(Exception('code: 5, message: User account not found.')).message,
          contains('hesap yok'));
      expect(AuthFailure.from(Exception('code: 6, message: Email is already in use.')).message,
          contains('başka bir hesaba bağlı'));
      expect(AuthFailure.from(Exception('code: 6, message: Username is already in use.')).message,
          contains('oyuncu adı alınmış'));
      expect(AuthFailure.from(Exception('SocketException: Connection refused')).message,
          contains('Sunucuya bağlanılamadı'));
    });
  });

  Future<(TestGateway, ProviderContainer)> pump(WidgetTester tester, EmailSheetMode mode) async {
    tester.view.physicalSize = const Size(2532, 1170);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final gateway = TestGateway();
    final container = ProviderContainer(overrides: [authGatewayProvider.overrideWithValue(gateway)]);
    addTearDown(container.dispose);
    await container.read(authControllerProvider.future);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: AppTheme.salon,
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => Padding(
                    padding: const EdgeInsets.all(24),
                    child: EmailAuthSheet(mode: mode, currentName: 'Oyuncu_1234'),
                  ),
                ),
                child: const Text('aç'),
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('aç'));
    await tester.pumpAndSettle();
    return (gateway, container);
  }

  SalonButtonFinder button(String label) => SalonButtonFinder(label);

  testWidgets('giriş: geçerli e-posta ve 8 karakterlik şifre girilince düğme açılır', (tester) async {
    final (gateway, container) = await pump(tester, EmailSheetMode.signIn);
    expect(button('Giriş yap').enabled(tester), isFalse);
    await tester.enterText(find.widgetWithText(TextField, 'E-posta'), 'ali@ornek.com');
    await tester.enterText(find.widgetWithText(TextField, 'Şifre'), 'kisa');
    await tester.pump();
    expect(find.text('Şifre en az 8 karakter olmalı.'), findsOneWidget);
    expect(button('Giriş yap').enabled(tester), isFalse);
    await tester.enterText(find.widgetWithText(TextField, 'Şifre'), 'gizli-sifre');
    await tester.pump();
    await tester.tap(find.text('Giriş yap'));
    await tester.pumpAndSettle();
    expect(gateway.calls, ['signIn ali@ornek.com create=false']);
    expect(container.read(authControllerProvider).value?.username, 'Kahveci');
    expect(find.byType(EmailAuthSheet), findsNothing);
  });

  testWidgets('giriş hatası pencerede gösterilir, oturum değişmez', (tester) async {
    final (gateway, container) = await pump(tester, EmailSheetMode.signIn);
    gateway.failWith = const AuthFailure('E-posta ya da şifre yanlış.');
    await tester.enterText(find.widgetWithText(TextField, 'E-posta'), 'ali@ornek.com');
    await tester.enterText(find.widgetWithText(TextField, 'Şifre'), 'yanlis-sifre');
    await tester.pump();
    await tester.tap(find.text('Yeni hesap aç'));
    await tester.pumpAndSettle();
    expect(gateway.calls, ['signIn ali@ornek.com create=true']);
    expect(find.text('E-posta ya da şifre yanlış.'), findsOneWidget);
    expect(container.read(authControllerProvider).value?.isGuest, isTrue);
  });

  testWidgets('misafir profilini yeni adla kaydeder', (tester) async {
    final (gateway, container) = await pump(tester, EmailSheetMode.saveGuest);
    expect(find.text('Profilini kaydet'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'Oyuncu adı'), 'Tavlaci Ayse');
    await tester.pump();
    // Boşluk yazılamaz
    expect(find.text('TavlaciAyse'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'E-posta'), 'ayse@ornek.com');
    await tester.enterText(find.widgetWithText(TextField, 'Şifre'), 'gizli-sifre');
    await tester.pump();
    await tester.tap(find.text('Kaydet'));
    await tester.pumpAndSettle();
    expect(gateway.calls, ['link ayse@ornek.com name=TavlaciAyse']);
    final user = container.read(authControllerProvider).value!;
    expect((user.username, user.isGuest), ('TavlaciAyse', false));
    expect(find.textContaining('Profilin kaydedildi'), findsOneWidget);
  });

  testWidgets('şifremi unuttum: kod gelir, yeni şifreyle giriş yapılır', (tester) async {
    final (gateway, container) = await pump(tester, EmailSheetMode.signIn);
    await tester.enterText(find.widgetWithText(TextField, 'E-posta'), 'ali@ornek.com');
    await tester.tap(find.text('Şifremi unuttum'));
    await tester.pumpAndSettle();
    expect(find.text('Şifreni yenile'), findsOneWidget);
    await tester.tap(find.text('Kod gönder'));
    await tester.pumpAndSettle();
    expect(gateway.calls, ['resetRequest ali@ornek.com']);
    expect(find.textContaining('adresine bir kod gönderdik'), findsOneWidget);
    expect(button('Şifreyi değiştir').enabled(tester), isFalse);
    await tester.enterText(find.widgetWithText(TextField, 'Kod'), '12a345 6');
    await tester.enterText(find.widgetWithText(TextField, 'Yeni şifre'), 'yeni-sifre');
    await tester.pump();
    expect(find.text('123456'), findsOneWidget, reason: 'sadece rakam');
    gateway.failWith = const AuthFailure('Kod yanlış ya da süresi dolmuş. Yeni kod isteyebilirsin');
    await tester.tap(find.text('Şifreyi değiştir'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Kod yanlış'), findsOneWidget);
    gateway.failWith = null;
    await tester.tap(find.text('Şifreyi değiştir'));
    await tester.pumpAndSettle();
    expect(gateway.calls.last, 'reset ali@ornek.com 123456');
    expect(container.read(authControllerProvider).value?.username, 'Kahveci');
    expect(find.text('Şifren değişti, giriş yaptın.'), findsOneWidget);
  });

  test('Sunucunun SALON: mesajı olduğu gibi gösterilir', () {
    expect(AuthFailure.from(Exception('code: 13, message: Error: SALON:Kod yanlış ya da süresi dolmuş at x')).message,
        'Kod yanlış ya da süresi dolmuş');
  });
}

/// Etiketiyle bulunan SalonButton'ın basılabilir olup olmadığını okur.
class SalonButtonFinder {
  SalonButtonFinder(this.label);

  final String label;

  bool enabled(WidgetTester tester) => tester
      .widget<SalonButton>(find.byWidgetPredicate((w) => w is SalonButton && w.label == label))
      .onPressed != null;
}
