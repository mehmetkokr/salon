import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/customization.dart';
import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/game_pieces.dart';
import '../../../core/design/widgets/glass_panel.dart';
import '../../../core/design/widgets/navigation.dart';
import '../../../core/design/widgets/player_avatar.dart';
import '../../../core/design/widgets/salon_button.dart';
import '../../../core/design/widgets/selectables.dart';
import '../../../core/services/nakama_service.dart';
import '../../auth/application/auth_controller.dart';
import '../../profile/profile_controller.dart';
import '../../settings/customization_providers.dart';

/// Alttan açılan cam panel. Bütün paneller bunu kullanır.
/// [maxWidth]: Material alt panelleri varsayılan olarak 640 noktayla sınırlar;
/// geniş form panelleri bunu kaldırabilir.
Future<T?> showSalonSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
  double widthFactor = 0.7,
  double maxWidth = 640,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    constraints: BoxConstraints(maxWidth: maxWidth),
    backgroundColor: Colors.transparent,
    barrierColor: context.salon.scrim,
    builder: (ctx) {
      final c = ctx.salon;
      return Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(ctx).bottom),
        child: FractionallySizedBox(
          widthFactor: widthFactor,
          child: ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(Radii.sheet)),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
              child: Container(
                constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.88),
                decoration: BoxDecoration(
                  color: c.surface.withValues(alpha: 0.94),
                  border: Border(top: BorderSide(color: c.glassBorder)),
                ),
                padding: const EdgeInsets.fromLTRB(Space.xl, Space.sm, Space.xl, Space.xl),
                child: SafeArea(
                  top: false,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Container(
                          width: 40,
                          height: 5,
                          margin: const EdgeInsets.only(bottom: Space.md),
                          decoration: BoxDecoration(color: c.outline, borderRadius: BorderRadius.circular(3)),
                        ),
                      ),
                      Flexible(child: SingleChildScrollView(child: builder(ctx))),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
}

void showSoon(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

/// Oyun kartına dokununca: oyun türü seçimi, “Hemen başla” ve “Özel oda kur”.
class GameChoiceSheet extends StatefulWidget {
  const GameChoiceSheet({
    super.key,
    required this.title,
    required this.modes,
    this.playableModes = 0,
    this.onQuickStart,
    this.onPrivateRoom,
    this.onJoinWithCode,
  });

  final String title;
  final List<String> modes;

  /// İlk kaç tür oynanabilir; gerisi “yakında” sayılır.
  final int playableModes;

  /// Seçilen türle hemen başla. Verilmezse bu oyunun masası henüz yok.
  final ValueChanged<int>? onQuickStart;

  /// Seçilen türle özel oda kur; kodla katıl.
  final ValueChanged<int>? onPrivateRoom;
  final VoidCallback? onJoinWithCode;

  @override
  State<GameChoiceSheet> createState() => _GameChoiceSheetState();
}

class _GameChoiceSheetState extends State<GameChoiceSheet> {
  int _mode = 0;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final w = widget;
    Widget option(
        {required IconData icon,
        required String t,
        required String d,
        required bool primary,
        required VoidCallback onTap}) {
      return Expanded(
        child: Semantics(
          button: true,
          label: t,
          child: Material(
            color: primary ? c.accent : c.surfaceHigh,
            borderRadius: BorderRadius.circular(Radii.card),
            child: InkWell(
              borderRadius: BorderRadius.circular(Radii.card),
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.all(Space.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(icon, size: 28, color: primary ? c.onAccent : c.accent),
                    const SizedBox(height: Space.sm),
                    Text(t, style: context.text.titleMedium?.copyWith(color: primary ? c.onAccent : c.text)),
                    const SizedBox(height: Space.xs),
                    Text(d,
                        style: context.text.bodySmall
                            ?.copyWith(color: primary ? c.onAccent.withValues(alpha: 0.75) : c.textSecondary)),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    final selectable = w.playableModes > 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          Expanded(child: Text(w.title, style: context.text.titleLarge)),
          if (!selectable)
            for (final m in w.modes) Padding(padding: const EdgeInsets.only(left: 6), child: SalonTag(m)),
        ]),
        if (selectable) ...[
          const SizedBox(height: Space.md),
          Align(
            alignment: Alignment.centerLeft,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SalonSegmented(
                options: [
                  for (var i = 0; i < w.modes.length; i++) i < w.playableModes ? w.modes[i] : '${w.modes[i]} · yakında',
                ],
                index: _mode,
                onChanged: (i) {
                  if (i < w.playableModes) {
                    setState(() => _mode = i);
                  } else {
                    showSoon(context, '${w.modes[i]} bir sonraki adımda geliyor');
                  }
                },
              ),
            ),
          ),
        ],
        const SizedBox(height: Space.lg),
        Row(children: [
          option(
            icon: Icons.bolt_rounded,
            t: 'Hemen başla',
            d: 'Seviyene ve çipine uygun masaya otur',
            primary: true,
            onTap: () {
              Navigator.pop(context);
              final start = w.onQuickStart;
              if (start != null) {
                start(_mode);
              } else {
                showSoon(context, 'Bu oyunun masaları bir sonraki adımda açılıyor');
              }
            },
          ),
          const SizedBox(width: Space.md),
          option(
            icon: Icons.lock_outline_rounded,
            t: 'Özel oda kur',
            d: 'Masana isim ver, şifre koy, arkadaşlarını çağır',
            primary: false,
            onTap: () {
              Navigator.pop(context);
              final open = w.onPrivateRoom;
              if (open != null) {
                open(_mode);
              } else {
                showSoon(context, 'Bu oyunda özel oda bir sonraki adımda');
              }
            },
          ),
        ]),
        if (w.onJoinWithCode != null) ...[
          const SizedBox(height: Space.sm),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              style: TextButton.styleFrom(minimumSize: const Size(kMinTap, kMinTap)),
              onPressed: () {
                Navigator.pop(context);
                w.onJoinWithCode!();
              },
              icon: const Icon(Icons.vpn_key_outlined, size: 18),
              label: const Text('Oda kodun mu var? Kodla katıl'),
            ),
          ),
        ],
      ],
    );
  }
}

/// Ayarlar: oda arka planı, ıstaka, zar, ses, titreşim ve çıkış.
/// Kilitli ıstaka ve zarlar oyuncunun seviyesine göre gösterilir.
class SettingsSheet extends ConsumerWidget {
  const SettingsSheet({super.key, required this.user});

  final SignedInUser user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(customizationProvider);
    final ctl = ref.read(customizationProvider.notifier);
    final c = context.salon;
    final level = ref.watch(profileProvider).value?.level ?? user.level;

    Widget section(String title, List<Widget> items) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: Space.lg),
            Text(title, style: context.text.titleMedium?.copyWith(color: c.textSecondary)),
            const SizedBox(height: Space.sm),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                for (final w in items) Padding(padding: const EdgeInsets.only(right: Space.md), child: w)
              ]),
            ),
          ],
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Ayarlar', style: context.text.titleLarge),
        section('Oda arka planı', [
          for (final r in RoomBackground.values)
            SelectableTile(
              label: r.label,
              selected: s.room == r,
              width: 160,
              onTap: () => ctl.setRoom(r),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(Radii.sm + 4),
                child: Image.asset(r.asset, height: 74, width: double.infinity, fit: BoxFit.cover),
              ),
            ),
        ]),
        section('Istaka (seviyeyle açılır)', [
          for (final r in RackStyle.values)
            SelectableTile(
              label: '${r.label} · ${r.rank}',
              selected: s.rack == r,
              width: 170,
              lockedUntilLevel: r.unlockedAt(level) ? null : r.level,
              onTap: () => ctl.setRack(r),
              child: Padding(padding: const EdgeInsets.symmetric(vertical: Space.xs), child: RackPreview(style: r)),
            ),
        ]),
        section('Tavla zarı (seviyeyle açılır)', [
          for (final d in DiceStyle.values)
            SelectableTile(
              label: d.label,
              selected: s.dice == d,
              width: 140,
              lockedUntilLevel: d.unlockedAt(level) ? null : d.level,
              onTap: () => ctl.setDice(d),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: Space.sm),
                child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  DieFace(value: 5, size: 34, style: d),
                  const SizedBox(width: 6),
                  DieFace(value: 3, size: 34, style: d),
                ]),
              ),
            ),
        ]),
        const SizedBox(height: Space.lg),
        Row(children: [
          Expanded(
            child: SwitchListTile.adaptive(
              value: s.sound,
              onChanged: (_) => ctl.toggleSound(),
              title: const Text('Ses ve kahvehane ortamı'),
              secondary: const Icon(Icons.volume_up_rounded),
            ),
          ),
          Expanded(
            child: SwitchListTile.adaptive(
              value: s.haptics,
              onChanged: (_) => ctl.toggleHaptics(),
              title: const Text('Titreşim'),
              secondary: const Icon(Icons.vibration_rounded),
            ),
          ),
        ]),
        SwitchListTile.adaptive(
          value: s.autoRoll,
          onChanged: (_) => ctl.toggleAutoRoll(),
          title: const Text('Tavlada zarı otomatik at'),
          subtitle: const Text('Sıra sana gelince zar kendiliğinden atılır.'),
          secondary: const Icon(Icons.casino_outlined),
        ),
        const SizedBox(height: Space.md),
        Align(
          alignment: Alignment.centerLeft,
          child: SalonButton(
            label: 'Çıkış yap',
            icon: Icons.logout_rounded,
            kind: SalonButtonKind.secondary,
            compact: true,
            onPressed: () {
              Navigator.pop(context);
              ref.read(authControllerProvider.notifier).signOut();
            },
          ),
        ),
      ],
    );
  }
}

/// Profil özeti: kimlik, seviye ve (misafirse) profili kaydetme çağrısı.
class ProfileSheet extends ConsumerWidget {
  const ProfileSheet({super.key, required this.user});

  final SignedInUser user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.salon;
    final profile = ref.watch(profileProvider).value;
    final level = profile?.level ?? user.level;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PlayerAvatar(name: user.username, level: level, size: 84),
        const SizedBox(width: Space.xl),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(user.username, style: context.text.headlineSmall),
              const SizedBox(height: Space.xs),
              Text('Seviye $level · ${RackStyle.values.lastWhere((r) => r.unlockedAt(level)).rank}',
                  style: context.text.bodyMedium?.copyWith(color: c.textSecondary)),
              if (profile != null) ...[
                const SizedBox(height: Space.sm),
                ClipRRect(
                  borderRadius: BorderRadius.circular(3),
                  child: LinearProgressIndicator(
                    value: profile.levelProgress,
                    minHeight: 6,
                    backgroundColor: c.surfaceHigh,
                    color: c.accent,
                  ),
                ),
                const SizedBox(height: Space.xs),
                Text('${profile.xp} / ${profile.xpNeed} XP', style: context.text.bodySmall),
              ],
              const SizedBox(height: Space.lg),
              Row(children: [
                for (final (v, l) in [('0', 'Maç'), ('%0', 'Kazanma'), ('0', 'Rozet')])
                  Expanded(
                    child: Container(
                      margin: const EdgeInsets.only(right: Space.sm),
                      padding: const EdgeInsets.symmetric(vertical: Space.md),
                      decoration:
                          BoxDecoration(color: c.surfaceHigh, borderRadius: BorderRadius.circular(Radii.control)),
                      child: Column(children: [
                        Text(v, style: context.text.titleLarge),
                        Text(l, style: context.text.bodySmall),
                      ]),
                    ),
                  ),
              ]),
              if (user.isGuest) ...[
                const SizedBox(height: Space.lg),
                Text('Misafir olarak oynuyorsun. Çiplerin ve seviyen kaybolmasın diye profilini kaydet.',
                    style: context.text.bodyMedium),
                const SizedBox(height: Space.md),
                SalonButton(
                  label: 'Profilini kaydet',
                  icon: Icons.verified_user_outlined,
                  compact: true,
                  onPressed: () => showSoon(context, 'Profil kaydetme bir sonraki adımda'),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
