import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/customization.dart';
import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/glass_panel.dart';
import '../../../core/design/widgets/salon_button.dart';
import '../../../core/design/widgets/salon_logo.dart';
import '../../home/widgets/sheets.dart' show showSalonSheet;
import '../application/auth_controller.dart';
import 'email_sheet.dart';

/// Giriş ekranı (yatay). Solda logo ve slogan, sağda giriş seçenekleri.
/// Misafir ve e-posta girişi çalışır; Google ve Apple sırada.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  bool _busy = false;

  Future<void> _guest() async {
    setState(() => _busy = true);
    await ref.read(authControllerProvider.notifier).signInAsGuest();
    if (mounted) setState(() => _busy = false);
  }

  void _soon(String provider) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text('$provider ile giriş bir sonraki adımda geliyor')));
  }

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final failed = ref.watch(authControllerProvider).hasError && !_busy;

    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          Image.asset(RoomBackground.kapadokya.asset, fit: BoxFit.cover),
          BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 6, sigmaY: 6),
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  colors: [c.background.withValues(alpha: 0.9), c.background.withValues(alpha: 0.55)],
                ),
              ),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: Space.xxl + Space.lg, vertical: Space.lg),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SalonLogo(size: 92),
                        const SizedBox(height: Space.lg),
                        Text('Salon', style: context.text.displaySmall),
                        const SizedBox(height: Space.xs),
                        Text('Türkiye’nin Dijital Salonu',
                            style:
                                context.text.titleLarge?.copyWith(color: c.textSecondary, fontWeight: FontWeight.w400)),
                        const SizedBox(height: Space.lg),
                        Text('Okey, 101, tavla ve kart oyunları. Tek hesap, tek cüzdan.',
                            style: context.text.bodyMedium?.copyWith(color: c.textSecondary)),
                      ],
                    ),
                  ),
                  const SizedBox(width: Space.xl),
                  SizedBox(
                    width: 380,
                    child: Center(
                      child: SingleChildScrollView(
                        child: GlassPanel(
                          padding: const EdgeInsets.all(Space.lg),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              SalonButton(
                                label: 'Google ile devam et',
                                icon: Icons.g_mobiledata_rounded,
                                kind: SalonButtonKind.secondary,
                                compact: true,
                                expand: true,
                                onPressed: _busy ? null : () => _soon('Google'),
                              ),
                              const SizedBox(height: Space.sm),
                              _AppleButton(onPressed: _busy ? null : () => _soon('Apple')),
                              const SizedBox(height: Space.sm),
                              SalonButton(
                                label: 'E-posta ile giriş yap',
                                icon: Icons.mail_outline_rounded,
                                kind: SalonButtonKind.secondary,
                                compact: true,
                                expand: true,
                                onPressed: _busy
                                    ? null
                                    : () => showSalonSheet<void>(context,
                                        widthFactor: 0.8,
                                        maxWidth: 720,
                                        builder: (_) => const EmailAuthSheet(mode: EmailSheetMode.signIn)),
                              ),
                              Padding(
                                padding: const EdgeInsets.symmetric(vertical: Space.md),
                                child: Row(children: [
                                  Expanded(child: Divider(color: c.outline)),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: Space.md),
                                    child: Text('veya', style: context.text.bodySmall),
                                  ),
                                  Expanded(child: Divider(color: c.outline)),
                                ]),
                              ),
                              SalonButton(
                                label: 'Misafir olarak gir',
                                icon: Icons.person_outline_rounded,
                                compact: true,
                                expand: true,
                                loading: _busy,
                                onPressed: _guest,
                              ),
                              const SizedBox(height: Space.sm),
                              AnimatedSwitcher(
                                duration: Motion.of(context, Motion.base),
                                child: failed
                                    ? Text(
                                        'Sunucuya bağlanılamadı. İnternet bağlantını kontrol edip tekrar dene.',
                                        key: const ValueKey('err'),
                                        style: context.text.bodySmall?.copyWith(color: c.danger),
                                        textAlign: TextAlign.center,
                                      )
                                    : Text(
                                        'Devam ederek Koşullar ve Gizlilik’i kabul edersin.',
                                        key: const ValueKey('legal'),
                                        style: context.text.bodySmall,
                                        textAlign: TextAlign.center,
                                      ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Apple’ın kuralı: koyu zeminde beyaz “Apple ile giriş yap” butonu.
class _AppleButton extends StatelessWidget {
  const _AppleButton({this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Apple ile giriş yap',
      child: Opacity(
        opacity: onPressed == null ? 0.45 : 1,
        child: Material(
          color: Colors.white,
          borderRadius: BorderRadius.circular(Radii.control),
          child: InkWell(
            borderRadius: BorderRadius.circular(Radii.control),
            onTap: onPressed,
            child: SizedBox(
              height: kMinTap,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.apple, color: Colors.black, size: 22),
                  const SizedBox(width: Space.sm),
                  Text('Apple ile giriş yap', style: context.text.labelLarge?.copyWith(color: Colors.black)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
