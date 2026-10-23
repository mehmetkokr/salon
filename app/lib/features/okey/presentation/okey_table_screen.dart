import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/coin_balance.dart';
import '../../../core/design/widgets/game_pieces.dart';
import '../../../core/design/widgets/glass_panel.dart';
import '../../../core/design/widgets/salon_button.dart';
import '../../home/widgets/sheets.dart';
import '../../profile/profile_controller.dart';
import '../../settings/customization_providers.dart';
import '../application/okey_table_controller.dart';
import '../domain/okey_models.dart';
import '../../table_common/table_widgets.dart';
import 'okey_table_parts.dart';

/// Okey masası. Arka planda oyuncunun seçtiği oda fotoğrafı görünür;
/// masa örtüsü yok, orta alan buzlu cam.
///
/// Ekrandaki yerler (saat yönünün tersine oynanır):
///   karşı (üst) · sol = benden önceki oyuncu · sağ = benden sonraki
///   sol alt: önceki oyuncunun attığı taş (alınabilir) · sağ alt: benim attığım
class OkeyTableScreen extends ConsumerStatefulWidget {
  const OkeyTableScreen({super.key, this.entry = const QuickEntry()});

  /// Hemen başla, özel oda kur ya da kodla katıl.
  final OkeyEntry entry;

  @override
  ConsumerState<OkeyTableScreen> createState() => _OkeyTableScreenState();
}

class _OkeyTableScreenState extends ConsumerState<OkeyTableScreen> {
  bool _dragging = false;

  OkeyTableController get _ctl => ref.read(okeyTableProvider.notifier);

  @override
  void initState() {
    super.initState();
    Future.microtask(() => _ctl.begin(widget.entry));
  }

  void _haptic(void Function() fire) {
    if (ref.read(customizationProvider).haptics) fire();
  }

  /// Masadan kalkma. Oyun sürüyorsa bahsin yanacağını önce söyler.
  Future<void> _leave() async {
    final table = ref.read(okeyTableProvider).table;
    // Katlamalıda iki el arası da oyunun içidir.
    final inGame =
        table != null && (table.phase == OkeyPhase.playing || (table.result != null && !table.result!.gameOver));
    if (inGame) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Masadan kalkılsın mı?'),
          content: Text('Oyun devam ediyor. Kalkarsan ${formatChips(table.bet)} çiplik bahsin iade edilmez, '
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
    final ui = ref.watch(okeyTableProvider);
    final custom = ref.watch(customizationProvider);
    final c = context.salon;

    // Geri bildirim tek yerden: sıra bana geçti, el bitti, sunucu uyarısı.
    ref.listen(okeyTableProvider, (prev, next) {
      final was = prev?.table;
      final now = next.table;
      if (now != null && now.isMyTurn && !(was?.isMyTurn ?? false)) {
        _haptic(HapticFeedback.mediumImpact);
      }
      if (now?.result != null && was?.result == null) {
        final won = now!.result!.winner == now.you;
        _haptic(won ? HapticFeedback.heavyImpact : HapticFeedback.lightImpact);
        ref.invalidate(profileProvider); // bakiye ve XP değişti
      }
      if (next.noticeSeq != (prev?.noticeSeq ?? 0) && next.notice != null) {
        _haptic(HapticFeedback.lightImpact);
        showSoon(context, next.notice!);
      }
    });

    final table = ui.table;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _leave();
      },
      child: Scaffold(
        backgroundColor: c.background,
        body: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset(custom.room.asset, fit: BoxFit.cover),
            BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 3, sigmaY: 3),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      c.background.withValues(alpha: 0.35),
                      c.background.withValues(alpha: 0.15),
                      c.background.withValues(alpha: 0.7),
                    ],
                  ),
                ),
              ),
            ),
            SafeArea(
              child: table == null
                  ? ConnectingPanel(
                      failed: ui.connection == TableConnection.failed,
                      needsPin: ui.needsPin,
                      error: ui.error,
                      creating: widget.entry is CreateRoomEntry,
                      onRetry: _ctl.start,
                      onPin: _ctl.retryWithPin,
                      onBack: _leave,
                    )
                  : LayoutBuilder(
                      builder: (context, box) => _TableLayout(
                        box: box,
                        ui: ui,
                        table: table,
                        dragging: _dragging,
                        onLeave: _leave,
                        onDragChange: (v) => setState(() => _dragging = v),
                        onDiscarded: () => _haptic(HapticFeedback.selectionClick),
                      ),
                    ),
            ),
            if (table?.result != null)
              _ResultOverlay(
                table: table!,
                onAgain: _ctl.playAgain,
                onBack: _leave,
              ),
          ],
        ),
      ),
    );
  }
}

class _TableLayout extends ConsumerWidget {
  const _TableLayout({
    required this.box,
    required this.ui,
    required this.table,
    required this.dragging,
    required this.onLeave,
    required this.onDragChange,
    required this.onDiscarded,
  });

  final BoxConstraints box;
  final OkeyTableUi ui;
  final OkeyTableState table;
  final bool dragging;
  final VoidCallback onLeave;
  final ValueChanged<bool> onDragChange;
  final VoidCallback onDiscarded;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ctl = ref.read(okeyTableProvider.notifier);
    final style = ref.watch(customizationProvider.select((s) => s.rack));
    final c = context.salon;
    final w = box.maxWidth;
    final h = box.maxHeight;

    // Taş boyu: ıstaka genişliğin ~%72'si, yüksekliğin ~%40'ı kadar olabilir.
    final byWidth = (w * 0.72 - 16) / 15 - 3;
    final byHeight = ((h * 0.38 - 30) / 2 - 8) / 1.42;
    final tileW = math.max(24.0, math.min(byWidth, math.min(byHeight, 46.0)));
    final smallTile = math.max(22.0, tileW * 0.78);

    final left = table.seats[table.seatAt(3)];
    final across = table.seats[table.seatAt(2)];
    final right = table.seats[table.seatAt(1)];
    final prevTop = left?.discardTop;
    final selected = ui.selected;
    final waiting = table.phase == OkeyPhase.waiting;

    void discard(int id) {
      onDiscarded();
      ctl.discard(id);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Space.md, vertical: Space.sm),
      child: Column(
        children: [
          // Üst sıra: çıkış · karşıdaki oyuncu ve iki yanında atılan taşlar · masa bilgisi.
          // Karşıdakinin attığı taş onun sağına (bizden bakınca sola), sağdaki
          // oyuncununki ise karşıya doğru düşer.
          SizedBox(
            height: 56,
            child: Stack(children: [
              Align(
                alignment: Alignment.topLeft,
                child: GlassIconButton(icon: Icons.close_rounded, label: 'Masadan kalk', onTap: onLeave),
              ),
              Align(
                alignment: Alignment.topCenter,
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  if (!waiting) ...[
                    DiscardPile(
                      top: across?.discardTop,
                      count: across?.discardCount ?? 0,
                      table: table,
                      tileWidth: smallTile,
                      label: 'Karşıdaki oyuncunun attığı',
                    ),
                    const SizedBox(width: Space.md),
                  ],
                  OpponentBadge(
                    seat: across,
                    isTurn: table.turn == table.seatAt(2) && table.phase == OkeyPhase.playing,
                    endsAt: table.turnEndsAt,
                    horizontal: true,
                    info: _seatInfo(table, table.seatAt(2)),
                    totalMs: table.turnMs,
                  ),
                  if (!waiting) ...[
                    const SizedBox(width: Space.md),
                    DiscardPile(
                      top: right?.discardTop,
                      count: right?.discardCount ?? 0,
                      table: table,
                      tileWidth: smallTile,
                      label: 'Sağdaki oyuncunun attığı',
                    ),
                  ],
                ]),
              ),
              Align(
                alignment: Alignment.topRight,
                child: InfoPill(children: [
                  if (table.room != null) ...[
                    Icon(table.room!.locked ? Icons.lock_rounded : Icons.group_rounded,
                        size: 14, color: c.textSecondary),
                    const SizedBox(width: 4),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 110),
                      child: Text(table.room!.name,
                          maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.labelLarge),
                    ),
                    Text(' · ', style: context.text.bodySmall),
                  ],
                  if (table.o101 != null) ...[
                    Text('El ${table.handNo}/${table.o101!.hands} · ', style: context.text.bodySmall),
                    Text('Ceza ${table.o101!.totals[table.you]}',
                        style: context.text.labelLarge?.copyWith(color: c.accent)),
                    Text(' · ', style: context.text.bodySmall),
                  ],
                  if (table.scores != null) ...[
                    Text('El ${table.handNo} · ', style: context.text.bodySmall),
                    Text('${table.scores![table.you]} puan', style: context.text.labelLarge?.copyWith(color: c.accent)),
                    Text(' · ', style: context.text.bodySmall),
                  ],
                  const ChipCoin(size: 14),
                  Text(' ${formatChips(table.bet)}', style: context.text.labelLarge),
                  if (table.pot > 0) ...[
                    Text(' · Pot ', style: context.text.bodySmall),
                    Text(formatChips(table.pot), style: context.text.labelLarge?.copyWith(color: c.reward)),
                  ],
                ]),
              ),
            ]),
          ),
          // Orta: sol oyuncu · deste ve gösterge · sağ oyuncu
          Expanded(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                SizedBox(
                  width: 112,
                  child: OpponentBadge(
                    seat: left,
                    isTurn: table.turn == table.seatAt(3) && table.phase == OkeyPhase.playing,
                    endsAt: table.turnEndsAt,
                    info: _seatInfo(table, table.seatAt(3)),
                    totalMs: table.turnMs,
                  ),
                ),
                Expanded(
                  child: Center(
                    child: waiting
                        ? _WaitingPanel(table: table, onStart: ctl.startHand)
                        : table.is101
                            ? Row(children: [
                                _CenterPanel(
                                  table: table,
                                  tileWidth: smallTile,
                                  dragging: dragging,
                                  compact: true,
                                  onDraw: () => ctl.draw(fromDiscard: false),
                                  onFinish: ctl.finish,
                                ),
                                const SizedBox(width: Space.sm),
                                Expanded(child: _MeldArea(table: table, selected: selected, onAdd: ctl.addToMeld)),
                              ])
                            : _CenterPanel(
                                table: table,
                                tileWidth: smallTile,
                                dragging: dragging,
                                onDraw: () => ctl.draw(fromDiscard: false),
                                onFinish: ctl.finish,
                              ),
                  ),
                ),
                SizedBox(
                  width: 112,
                  child: OpponentBadge(
                    seat: right,
                    isTurn: table.turn == table.seatAt(1) && table.phase == OkeyPhase.playing,
                    endsAt: table.turnEndsAt,
                    info: _seatInfo(table, table.seatAt(1)),
                    totalMs: table.turnMs,
                  ),
                ),
              ],
            ),
          ),
          // Durum ve düğmeler
          SizedBox(
            height: kMinTap,
            child: Row(children: [
              _SmallAction(label: 'Seri diz', icon: Icons.view_week_outlined, onTap: ctl.arrangeRuns),
              const SizedBox(width: Space.sm),
              _SmallAction(label: 'Çift diz', icon: Icons.view_agenda_outlined, onTap: ctl.arrangePairs),
              const SizedBox(width: Space.md),
              if (table.canShowIndicator) ...[
                SalonButton(
                  label: 'Göstergeyi göster',
                  icon: Icons.visibility_outlined,
                  kind: SalonButtonKind.glass,
                  compact: true,
                  onPressed: ctl.showIndicator,
                ),
                const SizedBox(width: Space.sm),
              ],
              Expanded(child: Align(alignment: Alignment.centerRight, child: _TurnStatus(table: table))),
              if (table.is101 && table.canDiscard) ...[
                const SizedBox(width: Space.sm),
                SalonButton(
                  label: (table.o101?.openedBy(table.you) ?? false) ? 'Per indir' : 'Aç',
                  icon: Icons.table_rows_outlined,
                  compact: true,
                  onPressed: ctl.openHand,
                ),
              ],
              if (table.canDiscard && selected != null) ...[
                const SizedBox(width: Space.sm),
                SalonButton(
                  label: 'At',
                  icon: Icons.south_east_rounded,
                  kind: SalonButtonKind.glass,
                  compact: true,
                  onPressed: () => discard(selected),
                ),
                if (!table.is101) ...[
                  const SizedBox(width: Space.sm),
                  SalonButton(
                    label: 'Bitir',
                    icon: Icons.emoji_events_outlined,
                    compact: true,
                    onPressed: () => ctl.finish(selected),
                  ),
                ],
              ],
            ]),
          ),
          const SizedBox(height: Space.xs),
          // Alt: önceki oyuncunun attığı · ıstaka · benim attığım
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Align(
                  alignment: Alignment.bottomLeft,
                  child: waiting
                      ? const SizedBox.shrink()
                      : DiscardPile(
                          top: prevTop,
                          count: left?.discardCount ?? 0,
                          table: table,
                          tileWidth: tileW,
                          label: 'Soldaki oyuncunun attığı, almak için dokun',
                          highlight: table.canDraw && prevTop != null,
                          onTap: table.canDraw && prevTop != null ? () => ctl.draw(fromDiscard: true) : null,
                        ),
                ),
              ),
              OkeyRack(
                table: table,
                layout: ui.rack,
                style: style,
                tileWidth: tileW,
                selected: selected,
                onTapTile: ctl.select,
                onMove: ctl.moveTile,
                onDragStart: () => onDragChange(true),
                onDragEnd: () => onDragChange(false),
              ),
              Expanded(
                child: Align(
                  alignment: Alignment.bottomRight,
                  child: waiting
                      ? const SizedBox.shrink()
                      : DragTarget<int>(
                          onWillAcceptWithDetails: (_) => table.canDiscard,
                          onAcceptWithDetails: (d) => discard(d.data),
                          builder: (context, cand, _) {
                            final me = table.seats[table.you];
                            return DiscardPile(
                              top: me?.discardTop,
                              count: me?.discardCount ?? 0,
                              table: table,
                              tileWidth: tileW,
                              label: 'Attığın taşlar, atmak için taşı buraya sürükle',
                              highlight: cand.isNotEmpty || (dragging && table.canDiscard),
                            );
                          },
                        ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Ortadaki buzlu cam: kapalı deste (dokununca çeker) ve gösterge.
/// Taş sürüklenirken "Bitir" alanına dönüşür.
class _CenterPanel extends StatelessWidget {
  const _CenterPanel({
    required this.table,
    required this.tileWidth,
    required this.dragging,
    required this.onDraw,
    required this.onFinish,
    this.compact = false,
  });

  final OkeyTableState table;
  final double tileWidth;
  final bool dragging;

  /// 101: yanında perler durduğu için yalnızca deste ve gösterge; bitirme
  /// alanı yok (son taşı atan biter).
  final bool compact;
  final VoidCallback onDraw;
  final ValueChanged<int> onFinish;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final indicator = table.indicator;
    return DragTarget<int>(
      onWillAcceptWithDetails: (_) => table.canDiscard && !compact,
      onAcceptWithDetails: (d) => onFinish(d.data),
      builder: (context, cand, _) {
        final finishing = dragging && table.canDiscard && !compact;
        return GlassPanel(
          padding: EdgeInsets.symmetric(horizontal: compact ? Space.md : Space.lg, vertical: Space.sm),
          child: AnimatedSwitcher(
            duration: Motion.of(context, Motion.fast),
            child: finishing
                ? SizedBox(
                    key: const ValueKey('bitir'),
                    height: tileWidth * 1.42 + 22,
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.emoji_events_outlined, color: cand.isNotEmpty ? c.reward : c.accent),
                      const SizedBox(width: Space.sm),
                      Text('Eli bitirmek için buraya bırak',
                          style: context.text.labelLarge?.copyWith(color: cand.isNotEmpty ? c.reward : c.text)),
                    ]),
                  )
                : Row(
                    key: const ValueKey('orta'),
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Semantics(
                        button: table.canDraw,
                        label: 'Deste, ${table.stockCount} taş${table.canDraw ? ', çekmek için dokun' : ''}',
                        child: GestureDetector(
                          onTap: table.canDraw ? onDraw : null,
                          child: Column(mainAxisSize: MainAxisSize.min, children: [
                            AnimatedContainer(
                              duration: Motion.of(context, Motion.base),
                              padding: const EdgeInsets.all(3),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: table.canDraw ? c.accent : Colors.transparent, width: 2),
                                boxShadow: table.canDraw
                                    ? [BoxShadow(color: c.accent.withValues(alpha: 0.4), blurRadius: 14)]
                                    : null,
                              ),
                              child: OkeyTile(width: tileWidth, faceDown: true),
                            ),
                            const SizedBox(height: 2),
                            Text('${table.stockCount}', style: context.text.labelLarge),
                          ]),
                        ),
                      ),
                      SizedBox(width: compact ? Space.md : Space.lg),
                      if (indicator != null)
                        Column(mainAxisSize: MainAxisSize.min, children: [
                          TableTile(tile: indicator, table: table, width: tileWidth),
                          const SizedBox(height: 2),
                          Text(
                            compact && table.okeyColor != null
                                ? 'Okey ${table.okeyColor!.label} ${table.okeyNumber}'
                                : 'Gösterge',
                            style: context.text.bodySmall,
                          ),
                        ]),
                      if (table.okeyColor != null && !compact) ...[
                        const SizedBox(width: Space.md),
                        Column(mainAxisSize: MainAxisSize.min, children: [
                          Text('Okey', style: context.text.bodySmall),
                          Text(
                            '${table.okeyColor!.label} ${table.okeyNumber}',
                            style: context.text.labelLarge,
                          ),
                        ]),
                      ],
                    ],
                  ),
          ),
        );
      },
    );
  }
}

/// Masa dolana kadar: kaç kişi oturdu, botlar ne zaman oturacak.
/// Özel odada oda adı, paylaşılacak kod ve (sahibine) "Başlat" görünür.
class _WaitingPanel extends StatelessWidget {
  const _WaitingPanel({required this.table, required this.onStart});

  final OkeyTableState table;
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
        capacity: 4,
        isHost: table.isHost,
        onStart: onStart,
        waitingText: 'Oda sahibi başlatınca el açılır',
      );
    }
    return GlassPanel(
      padding: const EdgeInsets.symmetric(horizontal: Space.xl, vertical: Space.md),
      child: Ticking(
        builder: (context, now) {
          final left = table.fillAt == null ? null : (table.fillAt!.difference(now).inMilliseconds / 1000).ceil();
          return Column(mainAxisSize: MainAxisSize.min, children: [
            Text('Oyuncular bekleniyor · $seated/4', style: context.text.titleMedium),
            const SizedBox(height: Space.xs),
            Text(
              left == null || left <= 0
                  ? 'Taşlar dağıtılıyor…'
                  : 'Masa dolmazsa $left sn sonra boş koltuklara bot oturur',
              style: context.text.bodySmall,
            ),
          ]);
        },
      ),
    );
  }
}

/// Sıra kimde ve ne yapmalı; benim sıramda kalan süre.
class _TurnStatus extends StatelessWidget {
  const _TurnStatus({required this.table});

  final OkeyTableState table;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    if (table.phase != OkeyPhase.playing) return const SizedBox.shrink();
    if (!table.isMyTurn) {
      final name = table.seats[table.turn]?.name ?? '';
      return Text('Sıra: $name',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: context.text.bodyMedium?.copyWith(color: c.textSecondary));
    }
    final side = table.o101?.sideTile != null;
    final text = table.canDraw
        ? 'Sıra sende · taş çek'
        : side
            ? 'Yandan aldığın taşı kullan'
            : table.is101
                ? 'Aç, işle ya da taş at'
                : 'Taş at ya da bitir';
    return Ticking(
      builder: (context, now) {
        final secs = table.turnEndsAt == null
            ? 0
            : math.max(0, (table.turnEndsAt!.difference(now).inMilliseconds / 1000).ceil());
        final urgent = secs <= 5;
        return Row(mainAxisSize: MainAxisSize.min, children: [
          SizedBox.square(
            dimension: 22,
            child: CircularProgressIndicator(
              value: timeLeftFraction(table.turnEndsAt, now, totalMs: table.turnMs),
              strokeWidth: 3,
              color: urgent ? c.danger : c.timer,
              backgroundColor: c.outline,
            ),
          ),
          const SizedBox(width: Space.sm),
          Flexible(
            child: Text('$text · $secs sn',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.text.labelLarge?.copyWith(color: urgent ? c.danger : c.text)),
          ),
        ]);
      },
    );
  }
}

class _SmallAction extends StatelessWidget {
  const _SmallAction({required this.label, required this.icon, required this.onTap});

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) =>
      SalonButton(label: label, icon: icon, kind: SalonButtonKind.glass, compact: true, onPressed: onTap);
}

/// El sonu: kazanan, eli ve çip değişimi. Katlamalıda puan tablosu ve
/// sonraki elin ne zaman açılacağı da görünür.
class _ResultOverlay extends StatelessWidget {
  const _ResultOverlay({required this.table, required this.onAgain, required this.onBack});

  final OkeyTableState table;
  final VoidCallback onAgain;
  final VoidCallback onBack;

  String _name(int seat) => seat == table.you ? 'Sen' : table.seats[seat]?.name ?? '';

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final r = table.result!;
    final kat = table.mode != OkeyMode.duz; // birden çok el süren oyun
    final midGame = kat && !r.gameOver;
    final wonHand = !r.isDraw && r.winner == table.you;
    final wonGame = kat ? r.gameWinners.contains(table.you) : wonHand;
    final myChange = table.you < r.payouts.length ? r.payouts[table.you] : 0;

    final String title;
    if (kat && r.gameOver) {
      final names = [
        for (final w in r.gameWinners)
          if (w != table.you) _name(w)
      ];
      title = wonGame
          ? (r.gameWinners.length > 1 ? 'Oyunu paylaştınız' : 'Oyunu kazandın!')
          : '${names.join(', ')} oyunu kazandı';
    } else if (r.isDraw) {
      title = 'Deste bitti, el berabere';
    } else {
      title = wonHand ? (kat ? 'Eli bitirdin!' : 'Kazandın!') : '${_name(r.winner)} eli bitirdi';
    }
    final o = table.o101;
    final penalty = r.scoreDeltas?.where((d) => d < 0).fold<int>(0, (a, d) => d < a ? d : a) ?? 0;
    final how = r.isDraw
        ? (o != null
            ? 'Deste bitti; açamayanlara 202 ceza yazıldı.'
            : kat
                ? 'Puanlar değişmedi.'
                : 'Bahisler iade edildi.')
        : o != null
            ? [
                if (r.elden) 'Elden bitti' else 'Son taşını attı',
                if (r.okeyFinish) 'okeyle',
                if (r.elden || r.okeyFinish) 'cezalar katlandı',
              ].join(', ')
            : [
                if (r.kind == 'cift') 'Çift ile bitti' else 'Seri ile bitti',
                if (r.okeyFinish) 'okey atarak',
                if (kat && penalty < 0) 'diğerleri $penalty puan',
              ].join(', ');
    final tileW = math.min(30.0, (MediaQuery.sizeOf(context).width * 0.62) / 15);

    final card = GlassPanel(
      padding: const EdgeInsets.all(Space.xl),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        if (wonGame && !midGame) Icon(Icons.emoji_events_rounded, color: c.reward, size: 40),
        Text(title, style: context.text.headlineSmall, textAlign: TextAlign.center),
        const SizedBox(height: Space.xs),
        Text(how, style: context.text.bodyMedium?.copyWith(color: c.textSecondary), textAlign: TextAlign.center),
        if (r.hand.isNotEmpty && !(kat && r.gameOver) && o == null) ...[
          const SizedBox(height: Space.md),
          Wrap(
            spacing: 2,
            runSpacing: 4,
            alignment: WrapAlignment.center,
            children: [for (final t in r.hand) TableTile(tile: t, table: table, width: tileW)],
          ),
        ],
        if (table.scores != null) ...[
          const SizedBox(height: Space.md),
          _ScoreRow(table: table, values: table.scores!, deltas: r.scoreDeltas, name: _name, lowIsGood: false),
        ],
        if (o != null) ...[
          const SizedBox(height: Space.md),
          _ScoreRow(table: table, values: o.totals, deltas: r.penalties, name: _name, lowIsGood: true),
          const SizedBox(height: Space.xs),
          Text('Toplam ceza · bu elde', style: context.text.bodySmall),
        ],
        if (!midGame) ...[
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
            if (midGame && table.room == null)
              Ticking(builder: (context, now) {
                final secs = table.nextHandAt == null
                    ? 0
                    : math.max(0, (table.nextHandAt!.difference(now).inMilliseconds / 1000).ceil());
                return Text('Sonraki el $secs sn içinde açılıyor', style: context.text.bodyMedium);
              })
            else if (table.room == null || table.isHost)
              SalonButton(
                label: midGame ? 'Sonraki el' : (kat ? 'Yeni oyun' : 'Yeni el'),
                icon: Icons.replay_rounded,
                compact: true,
                onPressed: onAgain,
              )
            else
              Text('Oda sahibi ${midGame ? 'sonraki' : 'yeni'} eli başlatınca devam edersin',
                  style: context.text.bodySmall),
          ],
        ),
      ]),
    );

    return Positioned.fill(
      child: ColoredBox(
        color: c.scrim,
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Space.lg),
            child: wonGame && !midGame
                ? TweenAnimationBuilder<double>(
                    tween: Tween(begin: 0.85, end: 1),
                    duration: Motion.of(context, Motion.slow),
                    curve: Curves.easeOutBack,
                    builder: (_, s, child) => Transform.scale(scale: s, child: child),
                    child: card,
                  )
                : card,
          ),
        ),
      ),
    );
  }
}

/// Puan tablosu: dört oyuncu, toplamı ve bu eldeki değişim. Katlamalıda
/// puan (yüksek iyi), 101'de ceza toplamı (düşük iyi).
class _ScoreRow extends StatelessWidget {
  const _ScoreRow({
    required this.table,
    required this.values,
    required this.deltas,
    required this.name,
    required this.lowIsGood,
  });

  final OkeyTableState table;
  final List<int> values;
  final List<int>? deltas;
  final String Function(int seat) name;
  final bool lowIsGood;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return Wrap(
      spacing: Space.sm,
      runSpacing: Space.sm,
      alignment: WrapAlignment.center,
      children: [
        for (var i = 0; i < 4; i++)
          Container(
            constraints: const BoxConstraints(minWidth: 96),
            padding: const EdgeInsets.symmetric(horizontal: Space.md, vertical: Space.xs),
            decoration: BoxDecoration(
              color: i == table.you ? c.accent.withValues(alpha: 0.18) : c.surfaceHigh,
              borderRadius: BorderRadius.circular(Radii.control),
              border: !lowIsGood && values[i] <= 0 ? Border.all(color: c.danger) : null,
            ),
            child: Column(children: [
              Text(name(i), maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.bodySmall),
              Row(mainAxisSize: MainAxisSize.min, children: [
                Text('${values[i]}', style: context.text.titleMedium),
                if (deltas != null && deltas![i] != 0) ...[
                  const SizedBox(width: 4),
                  Text(
                    deltas![i] > 0 ? '+${deltas![i]}' : '${deltas![i]}',
                    style: context.text.labelMedium?.copyWith(
                      color: (lowIsGood ? deltas![i] > 0 : deltas![i] < 0) ? c.danger : c.success,
                    ),
                  ),
                ],
              ]),
            ]),
          ),
      ],
    );
  }
}

/// Rakip rozetindeki ek bilgi: katlamalıda puan, 101'de açıp açmadığı.
String? _seatInfo(OkeyTableState table, int seat) {
  final scores = table.scores;
  if (scores != null) return '${scores[seat]} puan';
  final o = table.o101;
  if (o != null && seat < o.opened.length && o.opened[seat] > 0) return o.opened[seat] == 2 ? 'çift açtı' : 'açtı';
  return null;
}

/// 101: masaya açılmış perler. Elini açmış oyuncu ıstakadan taşı bir pere
/// sürükleyerek (ya da taşı seçip pere dokunarak) işler.
class _MeldArea extends StatelessWidget {
  const _MeldArea({required this.table, required this.selected, required this.onAdd});

  final OkeyTableState table;
  final int? selected;
  final void Function(int tileId, int meldIndex) onAdd;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final o = table.o101!;
    final canAdd = table.canDiscard && o.openedBy(table.you);
    if (o.melds.isEmpty) {
      return Center(
        child: Text(
          'Henüz açan yok. 101 puanlık per ya da 5 çiftle açılır.',
          textAlign: TextAlign.center,
          style: context.text.bodySmall?.copyWith(color: c.text),
        ),
      );
    }
    return SingleChildScrollView(
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (var i = 0; i < o.melds.length; i++)
            _MeldChip(
              meld: o.melds[i],
              table: table,
              ownerName: table.seats[o.melds[i].owner]?.name ?? '',
              canAdd: canAdd,
              armed: canAdd && selected != null,
              onAdd: (id) => onAdd(id, i),
              onTap: canAdd && selected != null ? () => onAdd(selected!, i) : null,
            ),
        ],
      ),
    );
  }
}

class _MeldChip extends StatelessWidget {
  const _MeldChip({
    required this.meld,
    required this.table,
    required this.ownerName,
    required this.canAdd,
    required this.armed,
    required this.onAdd,
    this.onTap,
  });

  final OkeyMeldView meld;
  final OkeyTableState table;
  final String ownerName;
  final bool canAdd;

  /// Bir taş seçili: dokununca işlenir.
  final bool armed;
  final ValueChanged<int> onAdd;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final mine = meld.owner == table.you;
    return Semantics(
      button: onTap != null,
      label:
          '${mine ? 'Senin' : ownerName} perin, ${meld.tiles.length} taş${onTap != null ? ', seçili taşı işlemek için dokun' : ''}',
      child: DragTarget<int>(
        onWillAcceptWithDetails: (_) => canAdd,
        onAcceptWithDetails: (d) => onAdd(d.data),
        builder: (context, cand, _) {
          final hot = cand.isNotEmpty;
          return GestureDetector(
            onTap: onTap,
            child: AnimatedContainer(
              duration: Motion.of(context, Motion.fast),
              padding: const EdgeInsets.fromLTRB(4, 4, 6, 4),
              decoration: BoxDecoration(
                color: (hot ? c.accent.withValues(alpha: 0.25) : c.glass).withValues(alpha: hot ? 0.35 : 0.7),
                borderRadius: BorderRadius.circular(Radii.sm),
                border: Border.all(color: hot || armed ? c.accent : (mine ? c.secondary : c.glassBorder)),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Container(
                  width: 16,
                  height: 16,
                  alignment: Alignment.center,
                  margin: const EdgeInsets.only(right: 4),
                  decoration: BoxDecoration(color: mine ? c.secondary : c.surfaceHigh, shape: BoxShape.circle),
                  child: Text(
                    ownerName.isEmpty ? '?' : ownerName.characters.first.toUpperCase(),
                    style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: c.text),
                  ),
                ),
                for (final t in meld.tiles)
                  Padding(
                    padding: const EdgeInsets.only(right: 1),
                    child: TableTile(tile: t, table: table, width: 18),
                  ),
              ]),
            ),
          );
        },
      ),
    );
  }
}
