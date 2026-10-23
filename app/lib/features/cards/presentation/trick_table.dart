import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/game_pieces.dart';
import '../../../core/design/widgets/player_avatar.dart';
import '../../okey/presentation/okey_table_parts.dart' show Ticking, timeLeftFraction;
import '../application/card_table_controller.dart';
import '../domain/card_models.dart';

/// El alınan (löve) kart oyunlarının ortak masası (Batak, King):
/// ben altta, sıradaki sağda, karşıdaki üstte, önceki solda; ortada açılan el.
/// Oyuna özgü bilgi paneli ve elin üstündeki seçim paneli dışarıdan verilir.
class TrickTable extends StatelessWidget {
  const TrickTable({
    super.key,
    required this.table,
    required this.ctl,
    required this.playing,
    required this.seatInfo,
    required this.infoPanel,
    this.overlay,
  });

  final CardTableState table;
  final CardTableController ctl;

  /// Kart atma aşaması (söz/ihale/seçim değil).
  final bool playing;

  /// Rakip rozetindeki ikinci satır (ör. "İhale 5 · 3 el").
  final String Function(int seat) seatInfo;

  /// Sağ üstteki bilgi paneli.
  final Widget infoPanel;

  /// Elin üstünde gösterilen seçim paneli (ihale, koz, sözleşme…).
  final Widget? overlay;

  int _seatAt(int pos) => (table.you + pos) % 4;

  @override
  Widget build(BuildContext context) {
    final g = table.g;
    final hand = cardsOf(g['hand']);
    final legal = intsOf(g['legal']).toSet();
    final trick = [for (final p in (g['trick'] as List? ?? const [])) p as Map<String, dynamic>];
    final last = g['lastTrick'] as Map<String, dynamic>?;
    final myTurn = table.isMyTurn;

    return LayoutBuilder(builder: (context, box) {
      final w = box.maxWidth;
      final h = box.maxHeight;
      final cardW = math.min(64.0, (h * 0.26) / 1.42);
      final step = math.min(cardW * 0.78, (w * 0.78 - cardW) / math.max(1, hand.length - 1));
      final trickW = math.min(48.0, (h * 0.2) / 1.42);

      // Ortadaki el: atılmamışsa son tamamlanan el soluk gösterilir.
      final showing =
          trick.isNotEmpty ? trick : [for (final p in (last?['cards'] as List? ?? const [])) p as Map<String, dynamic>];
      final faded = trick.isEmpty && last != null;
      final winner = (last?['winner'] as num?)?.toInt();

      Offset slot(int seat) {
        final pos = (seat - table.you + 4) % 4;
        return switch (pos) {
          0 => Offset(0, trickW * 0.75),
          1 => Offset(trickW * 1.15, 0),
          2 => Offset(0, -trickW * 0.75),
          _ => Offset(-trickW * 1.15, 0),
        };
      }

      return Stack(children: [
        // Rakipler
        Positioned(
            top: Space.sm,
            left: 0,
            right: 0,
            child: Center(child: _Seat(table: table, seat: _seatAt(2), info: seatInfo(_seatAt(2))))),
        Positioned(
            left: Space.md, top: h * 0.28, child: _Seat(table: table, seat: _seatAt(3), info: seatInfo(_seatAt(3)))),
        Positioned(
            right: Space.md, top: h * 0.28, child: _Seat(table: table, seat: _seatAt(1), info: seatInfo(_seatAt(1)))),
        // Bilgi: koz, ihale, puanlar
        Positioned(right: Space.sm, top: Space.sm, child: infoPanel),
        // Ortadaki el
        Positioned.fill(
          top: h * 0.24,
          bottom: h * 0.34,
          child: Center(
            child: Semantics(
              label: showing.isEmpty
                  ? 'Ortada kart yok'
                  : 'Ortadaki kartlar: ${showing.map((p) => CardData.fromJson(p['card'] as Map<String, dynamic>).spoken).join(', ')}',
              child: SizedBox(
                width: trickW * 3.6,
                height: trickW * 3,
                child: Stack(alignment: Alignment.center, children: [
                  for (final p in showing)
                    Transform.translate(
                      offset: slot((p['seat'] as num).toInt()),
                      child: AnimatedOpacity(
                        opacity: faded && (p['seat'] as num).toInt() != winner ? 0.45 : 1,
                        duration: Motion.of(context, Motion.base),
                        child: _TrickCard(
                          card: CardData.fromJson(p['card'] as Map<String, dynamic>),
                          width: trickW,
                          highlight: faded && (p['seat'] as num).toInt() == winner,
                        ),
                      ),
                    ),
                ]),
              ),
            ),
          ),
        ),
        // Söz / ihale / seçim
        if (overlay != null)
          Positioned(
            left: 0,
            right: 0,
            bottom: cardW * 1.42 + Space.lg,
            child: Center(child: overlay),
          ),
        // Elim
        Positioned(
          left: 0,
          right: 0,
          bottom: Space.xs,
          height: cardW * 1.42 + Space.md,
          child: Center(
            child: SizedBox(
              width: cardW + step * math.max(0, hand.length - 1),
              child: Stack(clipBehavior: Clip.none, children: [
                for (var i = 0; i < hand.length; i++)
                  Positioned(
                    left: i * step,
                    bottom: 0,
                    child: _HandCard(
                      card: hand[i],
                      width: cardW,
                      playable: myTurn && playing && legal.contains(hand[i].id),
                      dim: myTurn && playing && !legal.contains(hand[i].id),
                      onTap: () => ctl.move({'card': hand[i].id}),
                    ),
                  ),
              ]),
            ),
          ),
        ),
      ]);
    });
  }
}

class _TrickCard extends StatelessWidget {
  const _TrickCard({required this.card, required this.width, required this.highlight});

  final CardData card;
  final double width;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return Container(
      decoration: highlight
          ? BoxDecoration(
              borderRadius: BorderRadius.circular(width * 0.12),
              boxShadow: [BoxShadow(color: c.accent.withValues(alpha: 0.7), blurRadius: 12, spreadRadius: 1)],
            )
          : null,
      child: PlayingCardView(rank: card.face, suit: card.suit, width: width),
    );
  }
}

class _HandCard extends StatelessWidget {
  const _HandCard(
      {required this.card, required this.width, required this.playable, required this.dim, required this.onTap});

  final CardData card;
  final double width;
  final bool playable;
  final bool dim;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: playable,
      label: '${card.spoken}${playable ? ', atmak için dokun' : dim ? ', şu an atılamaz' : ''}',
      child: GestureDetector(
        onTap: playable
            ? () {
                HapticFeedback.selectionClick();
                onTap();
              }
            : null,
        child: AnimatedSlide(
          offset: playable ? const Offset(0, -0.08) : Offset.zero,
          duration: Motion.of(context, Motion.fast),
          curve: Motion.curve,
          child: AnimatedOpacity(
            opacity: dim ? 0.45 : 1,
            duration: Motion.of(context, Motion.fast),
            child: PlayingCardView(rank: card.face, suit: card.suit, width: width),
          ),
        ),
      ),
    );
  }
}

/// Rakip: avatar, ad ve oyuna özgü bilgi satırı.
class _Seat extends StatelessWidget {
  const _Seat({required this.table, required this.seat, required this.info});

  final CardTableState table;
  final int seat;
  final String info;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final s = table.seats.length > seat ? table.seats[seat] : null;
    if (s == null) return const SizedBox.shrink();
    final turn = table.phase == CardPhase.playing && table.turn == seat;
    final state = turn
        ? PlayerState.turn
        : s.isBot
            ? PlayerState.bot
            : (!s.connected || s.autoPlaying)
                ? PlayerState.disconnected
                : PlayerState.idle;
    final avatar = turn
        ? Ticking(
            builder: (_, now) => PlayerAvatar(
                name: s.name,
                level: s.level,
                size: 40,
                state: state,
                timeLeft: timeLeftFraction(table.turnEndsAt, now, totalMs: table.turnMs)),
          )
        : PlayerAvatar(name: s.name, level: s.level, size: 40, state: state);
    return Column(mainAxisSize: MainAxisSize.min, children: [
      avatar,
      const SizedBox(height: 2),
      Container(
        constraints: const BoxConstraints(maxWidth: 120),
        padding: const EdgeInsets.symmetric(horizontal: Space.sm, vertical: 2),
        decoration: BoxDecoration(
          color: turn ? c.accent : c.glass,
          borderRadius: BorderRadius.circular(Radii.pill),
          border: Border.all(color: turn ? c.accent : c.glassBorder),
        ),
        child: Column(children: [
          Text(s.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.text.labelMedium?.copyWith(color: turn ? c.onAccent : c.text)),
          Text(
            info,
            style: context.text.bodySmall?.copyWith(fontSize: 11, color: turn ? c.onAccent : c.textSecondary),
          ),
        ]),
      ),
    ]);
  }
}
