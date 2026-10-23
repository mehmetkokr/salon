import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme/app_theme.dart';
import 'features/auth/application/auth_controller.dart';
import 'features/auth/presentation/login_screen.dart';
import 'features/home/home_shell.dart';
import 'features/splash/splash_screen.dart';

class SalonApp extends StatelessWidget {
  const SalonApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Salon',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.salon,
      home: const _AuthGate(),
    );
  }
}

/// Açılış animasyonu → (oturum varsa) ana sayfa, yoksa giriş ekranı.
/// Girişten sonra ana sayfa kısa bir yükleme geçişiyle açılır.
class _AuthGate extends ConsumerStatefulWidget {
  const _AuthGate();

  @override
  ConsumerState<_AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends ConsumerState<_AuthGate> {
  bool _splashDone = false;

  /// Giriş ekranı gösterildiyse, ana sayfaya geçerken yükleme geçişi oynar.
  bool _cameFromLogin = false;

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final restoring = auth.isLoading && !auth.hasValue && !auth.hasError;

    final Widget screen;
    if (!_splashDone || restoring) {
      screen = SplashScreen(
        key: const ValueKey('splash'),
        waiting: restoring,
        onFinished: () {
          if (mounted) setState(() => _splashDone = true);
        },
      );
    } else if (auth.value case final user?) {
      screen = HomeShell(key: ValueKey(user.userId), user: user, intro: _cameFromLogin);
    } else {
      _cameFromLogin = true;
      screen = const LoginScreen(key: ValueKey('login'));
    }

    return AnimatedSwitcher(duration: const Duration(milliseconds: 350), child: screen);
  }
}
