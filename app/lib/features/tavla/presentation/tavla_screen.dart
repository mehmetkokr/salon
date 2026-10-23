import 'dart:convert';
import 'dart:math' as math;

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/customization.dart';
import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/coin_balance.dart';
import '../../../core/design/widgets/glass_panel.dart';
import '../../../core/design/widgets/player_avatar.dart';
import '../../../core/design/widgets/salon_button.dart';
import '../../home/widgets/sheets.dart';
import '../../okey/presentation/okey_table_parts.dart' show Ticking, timeLeftFraction;
import '../../profile/profile_controller.dart';
import '../../settings/customization_providers.dart';
import '../../table_common/table_widgets.dart';
import '../application/tavla_controller.dart';
import '../domain/tavla_models.dart';
import 'dice_throw.dart';
import 'tavla_board.dart';
import 'tavla_scene.dart';

/// Tavla masası: gece kahvehanesinde, lamba altında ahşap bir tahta.
/// Üstte ince bilgi şeridi; tahta oyuncunun oturduğu yerden eğik görünür.
class TavlaScreen extends ConsumerStatefulWidget {
  const TavlaScreen({super.key, this.entry = const TavlaQuick()});

  final TavlaEntry entry;

  @override
  ConsumerState<TavlaScreen> createState() => _TavlaScreenState();
}

class _TavlaScreenState extends ConsumerState<TavlaScreen> {
  TavlaController get _ctl => ref.read(tavlaProvider.notifier);

  @override
  void initState() {
    super.initState();
    Future.microtask(() => _ctl.begin(widget.entry));
  }

  void _haptic(void Function() fire) {
    if (ref.read(customizationProvider).haptics) fire();
  }

  Future<void> _leave() async {
    final t = ref.read(tavlaProvider).table;
    final inMatch = t != null && (t.phase == TavlaPhase.playing || (t.result != null && !t.result!.gameOver));
    if (inMatch) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Masadan kalkılsın mı?'),
          content: Text('Maç devam ediyor. Kalkarsan ${formatChips(t.bet)} çiplik bahsin iade edilmez, '
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
    final ui = ref.watch(tavlaProvider);
    final custom = ref.watch(customizationProvider);
    final c = context.salon;

    // Geri bildirim tek yerden: sıra bana geçti, zar, kırma, oyun sonu, uyarı.
    ref.listen(tavlaProvider, (prev, next) {
      final was = prev?.table;
      final now = next.table;
      if (now == null) return;
      if (now.isMyTurn && now.rolling && !(was != null && was.isMyTurn && was.rolling)) {
        _haptic(HapticFeedback.mediumImpact);
        // Ayarlarda açıksa zar kendiliğinden atılır (kısa bir bekleme, sıra geldiği fark edilsin).
        if (ref.read(customizationProvider).autoRoll) {
          Future.delayed(const Duration(milliseconds: 500), () {
            if (mounted) _ctl.roll();
          });
        }
      }
      if (was != null && now.board.bar[now.opponent] > was.board.bar[now.opponent]) {
        _haptic(HapticFeedback.mediumImpact); // rakibi kırdım
      }
      if (was != null && now.dice.isNotEmpty && was.rolling && !now.rolling) _haptic(HapticFeedback.lightImpact);
      if (now.result != null && was?.result == null) {
        _haptic(now.result!.winner == now.you ? HapticFeedback.heavyImpact : HapticFeedback.lightImpact);
        if (now.result!.gameOver) ref.invalidate(profileProvider);
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
          const TableBackdrop(),
          SafeArea(
            child: table == null
                ? ConnectingPanel(
                    failed: ui.connection == TavlaConnection.failed,
                    needsPin: ui.needsPin,
                    error: ui.error,
                    creating: widget.entry is TavlaCreate,
                    onRetry: _ctl.start,
                    onPin: _ctl.retryWithPin,
                    onBack: _leave,
                  )
                : Column(children: [
                    _Hud(table: table, onLeave: _leave, onFair: () => _showFairDice(table)),
                    Expanded(
                      child: table.phase == TavlaPhase.waiting
                          ? Center(child: _Waiting(table: table, onStart: _ctl.startMatch))
                          : _BoardStage(
                              child: TavlaBoard(
                                table: table,
                                selected: ui.selected,
                                targets: ui.targets,
                                onTapPoint: _ctl.tapPoint,
                                onTapBar: _ctl.tapBar,
                                onTapOff: _ctl.tapOff,
                                center: _DiceLayer(
                                  table: table,
                                  style: custom.dice,
                                  onRoll: () {
                                    _haptic(HapticFeedback.selectionClick);
                                    _ctl.roll();
                                  },
                                  onUndo: _ctl.undo,
                                ),
                              ),
                            ),
                    ),
                  ]),
          ),
          if (table?.result != null)
            _ResultOverlay(table: table!, onAgain: _ctl.playAgain, onBack: _leave, onFair: () => _showFairDice(table)),
        ]),
      ),
    );
  }

  void _showFairDice(TavlaState table) {
    showSalonSheet<void>(context,
        builder: (_) => FairDiceSheet(commitment: table.commitment, seed: table.result?.seed));
  }
}

/// Tahtanın durduğu sahne: tahta oyuncunun oturduğu yerden eğik görünür;
/// yanında çay bardağı ve tespih.
class _BoardStage extends StatelessWidget {
  const _BoardStage({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, box) {
      final w = box.maxWidth;
      final h = box.maxHeight;
      // Tahta oranı yaklaşık 2:1; perspektif üst kenarı daralttığı için
      // köşelerde aksesuarlara yer kalır.
      final boardW = math.min(w * 0.94, (h - 6) * 2.15);
      final boardH = math.min(h - 6, boardW / 2.05);
      return Stack(clipBehavior: Clip.none, children: [
        Positioned(left: w * 0.015, top: 2, child: TeaGlass(size: math.min(64, h * 0.2))),
        Positioned(right: w * 0.02, top: 0, child: Tesbih(size: math.min(84, h * 0.26))),
        Align(
          alignment: Alignment.bottomCenter,
          child: Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Transform(
              alignment: Alignment.bottomCenter,
              transform: Matrix4.identity()
                ..setEntry(3, 2, 0.0009)
                ..rotateX(-0.42),
              child: SizedBox(width: boardW, height: boardH, child: child),
            ),
          ),
        ),
      ]);
    });
  }
}

/// İnce bilgi şeridi: çıkış, iki oyuncu (pip, toplanan, maç puanı), skor,
/// sıra ve süre, adil zar.
class _Hud extends StatelessWidget {
  const _Hud({required this.table, required this.onLeave, required this.onFair});

  final TavlaState table;
  final VoidCallback onLeave;
  final VoidCallback onFair;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return Padding(
      padding: const EdgeInsets.fromLTRB(Space.sm, Space.xs, Space.sm, 0),
      child: SizedBox(
        height: 48,
        child: Row(children: [
          GlassIconButton(icon: Icons.close_rounded, label: 'Masadan kalk', onTap: onLeave),
          const SizedBox(width: Space.sm),
          Expanded(child: _PlayerTag(table: table, seat: table.you, alignEnd: false)),
          // Ortada skor ve sıra; dar ekranda küçülerek sığar.
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 260),
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                Text(
                  '${table.score[table.you]} – ${table.score[table.opponent]}',
                  style: context.text.titleLarge?.copyWith(color: c.accent, fontWeight: FontWeight.w800),
                ),
                _TurnHint(table: table),
              ]),
            ),
          ),
          Expanded(child: _PlayerTag(table: table, seat: table.opponent, alignEnd: true)),
          const SizedBox(width: Space.sm),
          GlassIconButton(icon: Icons.verified_outlined, label: 'Adil zar: zar tohumunun özeti', onTap: onFair),
        ]),
      ),
    );
  }
}

class _PlayerTag extends StatelessWidget {
  const _PlayerTag({required this.table, required this.seat, required this.alignEnd});

  final TavlaState table;
  final int seat;
  final bool alignEnd;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final s = table.seats[seat];
    final isTurn = table.phase == TavlaPhase.playing && table.turn == seat;
    final white = seat == 0;
    final state = isTurn
        ? PlayerState.turn
        : s == null
            ? PlayerState.idle
            : (!s.isBot && (!s.connected || s.autoPlaying))
                ? PlayerState.disconnected
                : s.isBot
                    ? PlayerState.bot
                    : PlayerState.idle;
    final avatar = s == null
        ? Icon(Icons.event_seat_outlined, color: c.textSecondary)
        : isTurn
            ? Ticking(
                builder: (_, now) => PlayerAvatar(
                  name: s.name,
                  level: s.level,
                  size: 40,
                  state: state,
                  timeLeft: timeLeftFraction(table.turnEndsAt, now, totalMs: table.turnMs),
                ),
              )
            : PlayerAvatar(name: s.name, level: s.level, size: 40, state: state);
    final info = Column(
      crossAxisAlignment: alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(seat == table.you ? 'Sen' : s?.name ?? 'Bekleniyor',
            maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.labelLarge),
        Row(mainAxisSize: MainAxisSize.min, children: [
          Checker3D(white: white, size: 13),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              table.phase == TavlaPhase.waiting
                  ? (white ? 'Beyaz' : 'Siyah')
                  : 'Pip ${table.board.pips(seat)} · ${table.board.off[seat]}/15',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.text.bodySmall,
            ),
          ),
        ]),
      ],
    );
    return Row(
      mainAxisAlignment: alignEnd ? MainAxisAlignment.end : MainAxisAlignment.start,
      children: alignEnd
          ? [Flexible(child: info), const SizedBox(width: Space.sm), avatar]
          : [avatar, const SizedBox(width: Space.sm), Flexible(child: info)],
    );
  }
}

class _TurnHint extends StatelessWidget {
  const _TurnHint({required this.table});

  final TavlaState table;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    if (table.phase != TavlaPhase.playing) {
      return Text('${table.target} puanlık maç', style: context.text.bodySmall);
    }
    if (!table.isMyTurn) {
      return Text('Sıra rakipte', style: context.text.bodySmall?.copyWith(color: c.textSecondary));
    }
    return Ticking(builder: (context, now) {
      final secs =
          table.turnEndsAt == null ? 0 : math.max(0, (table.turnEndsAt!.difference(now).inMilliseconds / 1000).ceil());
      final text = table.rolling
          ? 'Sıra sende · zar at'
          : table.legal.isEmpty
              ? 'Oynanacak hamle yok'
              : 'Pulunu seç, sonra haneye dokun';
      return Text('$text · $secs sn', style: context.text.labelMedium?.copyWith(color: secs <= 5 ? c.danger : c.text));
    });
  }
}

/// Tahtanın sağ yarısı: atılan zarlar ya da "Zar at"; tur içinde "Geri al".
class _DiceLayer extends StatelessWidget {
  const _DiceLayer({required this.table, required this.style, required this.onRoll, required this.onUndo});

  final TavlaState table;
  final DiceStyle style;
  final VoidCallback onRoll;
  final VoidCallback onUndo;

  @override
  Widget build(BuildContext context) {
    if (table.phase != TavlaPhase.playing) return const SizedBox.shrink();
    if (table.canRoll) {
      return Center(child: SalonButton(label: 'Zar at', icon: Icons.casino_outlined, onPressed: onRoll));
    }
    if (table.dice.length < 2) return const SizedBox.shrink();
    final doubles = table.dice[0] == table.dice[1];
    final used = doubles
        ? [table.remaining.length < 2, table.remaining.isEmpty]
        : [!table.remaining.contains(table.dice[0]), !table.remaining.contains(table.dice[1])];
    return Stack(children: [
      Positioned.fill(
        child: ThrownDice(
          dice: table.dice,
          used: used,
          rollKey: '${table.gameNo}-${table.turn}-${table.dice.join()}-${table.lastMoves?.moves.length}',
          fromBottom: table.turn == table.you,
          style: style,
          doublesLeft: doubles ? table.remaining.length : null,
        ),
      ),
      if (table.isMyTurn && table.canUndo)
        Positioned(
          right: 6,
          bottom: 6,
          child: SalonButton(
              label: 'Geri al',
              icon: Icons.undo_rounded,
              kind: SalonButtonKind.glass,
              compact: true,
              onPressed: onUndo),
        ),
    ]);
  }
}

class _Waiting extends StatelessWidget {
  const _Waiting({required this.table, required this.onStart});

  final TavlaState table;
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
        capacity: 2,
        isHost: table.isHost,
        onStart: onStart,
        waitingText: 'Oda sahibi başlatınca maç açılır',
      );
    }
    return GlassPanel(
      padding: const EdgeInsets.symmetric(horizontal: Space.xl, vertical: Space.md),
      child: Ticking(builder: (context, now) {
        final left = table.fillAt == null ? null : (table.fillAt!.difference(now).inMilliseconds / 1000).ceil();
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Text('Rakip bekleniyor', style: context.text.titleMedium),
          const SizedBox(height: Space.xs),
          Text(
            left == null || left <= 0 ? 'Pullar diziliyor…' : 'Rakip gelmezse $left sn sonra bot oturur',
            style: context.text.bodySmall,
          ),
        ]);
      }),
    );
  }
}

/// Oyun ve maç sonu.
class _ResultOverlay extends StatelessWidget {
  const _ResultOverlay({required this.table, required this.onAgain, required this.onBack, required this.onFair});

  final TavlaState table;
  final VoidCallback onAgain;
  final VoidCallback onBack;
  final VoidCallback onFair;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final r = table.result!;
    final won = r.winner == table.you;
    final winnerName = won ? 'Sen' : table.seats[r.winner]?.name ?? '';
    final title = r.gameOver
        ? (won ? 'Maçı kazandın!' : '$winnerName maçı kazandı')
        : (won ? 'Oyunu kazandın' : '$winnerName oyunu kazandı');
    final myChange = table.you < r.payouts.length ? r.payouts[table.you] : 0;
    final card = GlassPanel(
      padding: const EdgeInsets.all(Space.xl),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        if (won && r.gameOver) Icon(Icons.emoji_events_rounded, color: c.reward, size: 40),
        Text(title, style: context.text.headlineSmall, textAlign: TextAlign.center),
        const SizedBox(height: Space.xs),
        Text(r.mars ? 'Mars! ${r.points} puan' : '${r.points} puan',
            style: context.text.bodyMedium?.copyWith(color: c.textSecondary)),
        const SizedBox(height: Space.md),
        Text('${table.score[table.you]} – ${table.score[table.opponent]}', style: context.text.displaySmall),
        Text('Sen – ${table.seats[table.opponent]?.name ?? ''}', style: context.text.bodySmall),
        if (r.gameOver) ...[
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
            if (r.gameOver)
              SalonButton(
                  label: 'Zarları doğrula',
                  icon: Icons.verified_outlined,
                  kind: SalonButtonKind.glass,
                  compact: true,
                  onPressed: onFair),
            if (!r.gameOver && table.room == null)
              Ticking(builder: (context, now) {
                final secs = table.nextGameAt == null
                    ? 0
                    : math.max(0, (table.nextGameAt!.difference(now).inMilliseconds / 1000).ceil());
                return Text('Sonraki oyun $secs sn içinde', style: context.text.bodyMedium);
              })
            else if (table.room == null || table.isHost)
              SalonButton(
                label: r.gameOver ? 'Yeni maç' : 'Sonraki oyun',
                icon: Icons.replay_rounded,
                compact: true,
                onPressed: onAgain,
              )
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

/// Adil zar: maç başında gösterilen özet ve maç sonunda açıklanan tohum.
/// Tohumun özeti eşleşirse zarlar önceden belirlenmiş ve değiştirilmemiştir.
class FairDiceSheet extends StatelessWidget {
  const FairDiceSheet({super.key, required this.commitment, this.seed});

  final String commitment;
  final String? seed;

  /// Sunucudakiyle aynı türetme: sha256(tohum + ':' + n), 252'den küçük baytlar.
  static List<int> diceAt(String seed, int n) {
    final bytes = sha256.convert(utf8.encode('$seed:$n')).bytes;
    final out = <int>[];
    for (final b in bytes) {
      if (out.length == 2) break;
      if (b < 252) out.add(b % 6 + 1);
    }
    while (out.length < 2) {
      out.add(1);
    }
    return out;
  }

  static bool verify(String seed, String commitment) => sha256.convert(utf8.encode(seed)).toString() == commitment;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final s = seed;
    final ok = s != null && verify(s, commitment);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Adil zar', style: context.text.titleLarge),
      const SizedBox(height: Space.xs),
      Text(
        'Zarlar maç başlamadan sunucuda seçilen gizli bir tohumdan üretilir. Tohumun özeti maç başında gösterilir, '
        'tohum maç bitince açıklanır. Özet tutuyorsa zarlar sonradan değiştirilmemiştir.',
        style: context.text.bodyMedium,
      ),
      const SizedBox(height: Space.md),
      SelectableText('Özet: $commitment', style: context.text.bodySmall),
      if (s != null) ...[
        SelectableText('Tohum: $s', style: context.text.bodySmall),
        const SizedBox(height: Space.sm),
        Row(children: [
          Icon(ok ? Icons.verified_rounded : Icons.error_outline_rounded, color: ok ? c.success : c.danger),
          const SizedBox(width: Space.sm),
          Expanded(
            child: Text(ok ? 'Tohum özetle eşleşti: zarlar baştan belirlenmişti.' : 'Tohum özetle eşleşmedi!',
                style: context.text.titleSmall?.copyWith(color: ok ? c.success : c.danger)),
          ),
        ]),
        const SizedBox(height: Space.sm),
        Text('İlk atışlar: ${[for (var n = 0; n < 8; n++) diceAt(s, n).join('-')].join('  ')}',
            style: context.text.bodySmall),
      ] else
        Text('Tohum maç bitince açıklanacak.', style: context.text.bodySmall),
    ]);
  }
}
