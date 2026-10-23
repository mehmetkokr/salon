import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/coin_balance.dart';
import '../../../core/design/widgets/glass_panel.dart';
import '../../../core/design/widgets/salon_button.dart';
import '../../home/widgets/sheets.dart';
import '../../okey/presentation/okey_table_parts.dart' show Ticking;
import '../../profile/profile_controller.dart';
import '../../settings/customization_providers.dart';
import '../../table_common/table_widgets.dart';
import '../application/card_table_controller.dart';
import '../domain/card_models.dart';

/// Kart masalarının ortak çerçevesi: arka plan, bağlanma, bekleme, sonuç,
/// masadan kalkma onayı, uyarılar ve sıra/el sonu titreşimi.
/// Oyuna özgü ekranlar yalnızca masayı ve sonuç içeriğini çizer.
class CardTableShell extends ConsumerStatefulWidget {
  const CardTableShell({
    super.key,
    required this.entry,
    required this.bodyBuilder,
    required this.resultBuilder,
    this.onChange,
  });

  final CardEntry entry;
  final Widget Function(BuildContext context, CardTableState table, CardTableController ctl) bodyBuilder;

  /// Sonuç kartının oyuna özgü kısmı (başlık, puan tablosu…).
  final Widget Function(BuildContext context, CardTableState table) resultBuilder;

  /// Oyuna özgü geri bildirim (ör. pişti).
  final void Function(CardTableState? previous, CardTableState next)? onChange;

  @override
  ConsumerState<CardTableShell> createState() => _CardTableShellState();
}

class _CardTableShellState extends ConsumerState<CardTableShell> {
  CardTableController get _ctl => ref.read(cardTableProvider.notifier);

  @override
  void initState() {
    super.initState();
    Future.microtask(() => _ctl.begin(widget.entry));
  }

  void _haptic(void Function() fire) {
    if (ref.read(customizationProvider).haptics) fire();
  }

  Future<void> _leave() async {
    final t = ref.read(cardTableProvider).table;
    final inGame = t != null && (t.phase == CardPhase.playing || (t.result != null && !t.gameOver));
    if (inGame) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Masadan kalkılsın mı?'),
          content: Text('Oyun devam ediyor. Kalkarsan ${formatChips(t.bet)} çiplik bahsin iade edilmez, '
              'yerine sunucu oynar.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Oyuna dön')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Masadan kalk')),
          ],
        ),
      );
      if (ok != true) return;
    }
    await _ctl.leave();
    ref.invalidate(profileProvider);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final ui = ref.watch(cardTableProvider);
    final custom = ref.watch(customizationProvider);
    final c = context.salon;

    ref.listen(cardTableProvider, (prev, next) {
      final was = prev?.table;
      final now = next.table;
      if (now != null) {
        if (now.isMyTurn && !(was?.isMyTurn ?? false)) _haptic(HapticFeedback.mediumImpact);
        if (now.result != null && was?.result == null && now.gameOver) {
          final won = (now.result!['winners'] as List? ?? const []).contains(now.you);
          _haptic(won ? HapticFeedback.heavyImpact : HapticFeedback.lightImpact);
          ref.invalidate(profileProvider);
        }
        widget.onChange?.call(was, now);
      }
      if (next.noticeSeq != (prev?.noticeSeq ?? 0) && next.notice != null) showSoon(context, next.notice!);
    });

    final table = ui.table;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _leave();
      },
      child: Scaffold(
        backgroundColor: c.background,
        body: Stack(fit: StackFit.expand, children: [
          Image.asset(custom.room.asset, fit: BoxFit.cover),
          BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 4, sigmaY: 4),
            child: ColoredBox(color: c.background.withValues(alpha: 0.4)),
          ),
          SafeArea(
            child: table == null
                ? ConnectingPanel(
                    failed: ui.connection == CardConnection.failed,
                    needsPin: ui.needsPin,
                    error: ui.error,
                    creating: widget.entry is CardCreate,
                    onRetry: _ctl.start,
                    onPin: _ctl.retryWithPin,
                    onBack: _leave,
                  )
                : Stack(children: [
                    Positioned.fill(
                      child: table.phase == CardPhase.waiting
                          ? Center(child: _Waiting(table: table, capacity: table.seats.length, onStart: _ctl.startGame))
                          : widget.bodyBuilder(context, table, _ctl),
                    ),
                    Positioned(
                      left: Space.sm,
                      top: Space.sm,
                      child: Row(children: [
                        GlassIconButton(icon: Icons.close_rounded, label: 'Masadan kalk', onTap: _leave),
                        const SizedBox(width: Space.xs),
                        InfoPill(children: [
                          const ChipCoin(size: 14),
                          Text(' ${formatChips(table.pot > 0 ? table.pot : table.bet)}',
                              style: context.text.labelLarge?.copyWith(color: c.reward)),
                        ]),
                      ]),
                    ),
                  ]),
          ),
          if (table?.result != null)
            _ResultOverlay(
              table: table!,
              content: widget.resultBuilder(context, table),
              onAgain: _ctl.playAgain,
              onBack: _leave,
            ),
        ]),
      ),
    );
  }
}

class _Waiting extends StatelessWidget {
  const _Waiting({required this.table, required this.capacity, required this.onStart});

  final CardTableState table;
  final int capacity;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    final seated = table.seats.where((s) => s != null).length;
    final room = table.room;
    if (room != null) {
      return RoomInfoPanel(
        name: room.name,
        code: room.code,
        locked: room.locked,
        seated: seated,
        capacity: capacity,
        isHost: table.isHost,
        onStart: onStart,
        waitingText: 'Oda sahibi başlatınca oyun açılır',
      );
    }
    return GlassPanel(
      padding: const EdgeInsets.symmetric(horizontal: Space.xl, vertical: Space.md),
      child: Ticking(builder: (context, now) {
        final left = table.fillAt == null ? null : (table.fillAt!.difference(now).inMilliseconds / 1000).ceil();
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Text('Oyuncular bekleniyor · $seated/$capacity', style: context.text.titleMedium),
          const SizedBox(height: Space.xs),
          Text(
            left == null || left <= 0
                ? 'Kartlar dağıtılıyor…'
                : 'Masa dolmazsa $left sn sonra boş koltuklara bot oturur',
            style: context.text.bodySmall,
          ),
        ]);
      }),
    );
  }
}

/// Sonuç: oyuna özgü içerik + çip değişimi + düğmeler / sonraki el geri sayımı.
class _ResultOverlay extends StatelessWidget {
  const _ResultOverlay({required this.table, required this.content, required this.onAgain, required this.onBack});

  final CardTableState table;
  final Widget content;
  final VoidCallback onAgain;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final over = table.gameOver;
    final payouts = table.payouts;
    final myChange = table.you < payouts.length ? payouts[table.you] : 0;
    final card = GlassPanel(
      padding: const EdgeInsets.all(Space.xl),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        content,
        if (over) ...[
          const SizedBox(height: Space.md),
          Row(mainAxisSize: MainAxisSize.min, children: [
            const ChipCoin(size: 18),
            const SizedBox(width: Space.xs),
            Text(
              myChange > 0
                  ? '+${formatChips(myChange)} çip'
                  : myChange < 0
                      ? '−${formatChips(-myChange)} çip'
                      : 'Çip değişmedi',
              style: context.text.titleMedium?.copyWith(
                  color: myChange > 0
                      ? c.success
                      : myChange < 0
                          ? c.danger
                          : c.text),
            ),
          ]),
        ],
        const SizedBox(height: Space.lg),
        Wrap(
          alignment: WrapAlignment.center,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: Space.sm,
          runSpacing: Space.sm,
          children: [
            SalonButton(label: 'Salona dön', kind: SalonButtonKind.secondary, compact: true, onPressed: onBack),
            if (!over && table.room == null)
              Ticking(builder: (context, now) {
                final secs = table.nextHandAt == null
                    ? 0
                    : math.max(0, (table.nextHandAt!.difference(now).inMilliseconds / 1000).ceil());
                return Text('Sonraki el $secs sn içinde', style: context.text.bodyMedium);
              })
            else if (table.room == null || table.isHost)
              SalonButton(
                  label: over ? 'Yeni oyun' : 'Sonraki el',
                  icon: Icons.replay_rounded,
                  compact: true,
                  onPressed: onAgain)
            else
              Text('Oda sahibi başlatınca devam edersin', style: context.text.bodySmall),
          ],
        ),
      ]),
    );
    return Positioned.fill(
      child: ColoredBox(
        color: c.scrim,
        child: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(Space.lg), child: card)),
      ),
    );
  }
}
