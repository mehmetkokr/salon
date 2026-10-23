import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/game_pieces.dart';
import '../../../core/design/widgets/glass_panel.dart';
import '../../../core/design/widgets/player_avatar.dart';
import '../../okey/presentation/okey_table_parts.dart' show Ticking, timeLeftFraction;
import '../../settings/customization_providers.dart';
import '../application/card_table_controller.dart';
import '../domain/card_models.dart';

/// Pişti masası (iki kişilik). Karta dokununca atılır.
/// Pişti olunca kısa süre "PİŞTİ!" yazısı çıkar ve telefon titrer.
class PistiBody extends ConsumerStatefulWidget {
  const PistiBody({super.key, required this.table, required this.ctl});

  final CardTableState table;
  final CardTableController ctl;

  @override
  ConsumerState<PistiBody> createState() => _PistiBodyState();
}

class _PistiBodyState extends ConsumerState<PistiBody> {
  /// Görünen pişti puanı (20: vale piştisi), 0: yok.
  int _flash = 0;
  int _flashSeq = 0;

  @override
  void didUpdateWidget(PistiBody old) {
    super.didUpdateWidget(old);
    final lp = widget.table.g['lastPlay'] as Map<String, dynamic>?;
    final before = old.table.g['lastPlay'] as Map<String, dynamic>?;
    final pisti = (lp?['pisti'] as num?)?.toInt() ?? 0;
    final same =
        before != null && lp != null && before['card']?['id'] == lp['card']?['id'] && before['seat'] == lp['seat'];
    if (pisti > 0 && !same) {
      // Pişti nadir ve önemli: en güçlü geri bildirim (yazı + ağır titreşim).
      if (ref.read(customizationProvider).haptics) HapticFeedback.heavyImpact();
      final seq = ++_flashSeq;
      _flash = pisti;
      Future.delayed(const Duration(milliseconds: 1400), () {
        if (mounted && seq == _flashSeq) setState(() => _flash = 0);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Stack(children: [
      Positioned.fill(child: _PistiTable(table: widget.table, onPlay: (card) => widget.ctl.move({'card': card.id}))),
      if (_flash > 0) Center(child: _PistiFlash(points: _flash)),
    ]);
  }
}

class _PistiTable extends StatelessWidget {
  const _PistiTable({required this.table, required this.onPlay});

  final CardTableState table;
  final ValueChanged<CardData> onPlay;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final g = table.g;
    final me = table.you;
    final opp = 1 - me;
    final hand = cardsOf(g['hand']);
    final pile = cardsOf(g['pile']);
    final hidden = (g['pileHidden'] as num?)?.toInt() ?? 0;
    final deck = (g['deck'] as num?)?.toInt() ?? 0;
    final oppCount = (g['oppCount'] as num?)?.toInt() ?? 0;
    final captured = intsOf(g['captured']);
    final scores = intsOf(g['scores']);
    final pistis = [
      for (final p in (g['pistis'] as List? ?? const [[], []])) (p as List).length
    ];
    final target = (g['target'] as num?)?.toInt() ?? 101;

    return LayoutBuilder(builder: (context, box) {
      final h = box.maxHeight;
      final handW = math.min(84.0, (h * 0.30) / 1.42);
      final pileW = math.min(72.0, (h * 0.30) / 1.42);
      final backW = handW * 0.42;

      Widget playerInfo(int seat) {
        final s = table.seats[seat];
        final turn = table.phase == CardPhase.playing && table.turn == seat;
        final state = turn
            ? PlayerState.turn
            : s == null
                ? PlayerState.idle
                : s.isBot
                    ? PlayerState.bot
                    : (!s.connected || s.autoPlaying)
                        ? PlayerState.disconnected
                        : PlayerState.idle;
        final avatar = s == null
            ? const SizedBox.square(dimension: 40)
            : turn
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
        return Row(mainAxisSize: MainAxisSize.min, children: [
          avatar,
          const SizedBox(width: Space.sm),
          Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(seat == me ? 'Sen' : s?.name ?? '', style: context.text.labelLarge),
            Text(
              '${seat < captured.length ? captured[seat] : 0} kart'
              '${seat < pistis.length && pistis[seat] > 0 ? ' · ${pistis[seat]} pişti' : ''}',
              style: context.text.bodySmall,
            ),
          ]),
        ]);
      }

      return Stack(children: [
        // Rakip: üstte, kapalı elinin arkası
        Positioned(
          top: Space.sm,
          left: 0,
          right: 0,
          child: Center(
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              playerInfo(opp),
              const SizedBox(width: Space.md),
              for (var i = 0; i < oppCount; i++)
                Padding(
                  padding: const EdgeInsets.only(left: 2),
                  child: PlayingCardView(rank: '', suit: CardSuit.spades, width: backW, faceDown: true),
                ),
            ]),
          ),
        ),
        // Skor: sağda
        Positioned(
          right: Space.md,
          top: h * 0.3,
          child: GlassPanel(
            padding: const EdgeInsets.symmetric(horizontal: Space.md, vertical: Space.sm),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text('$target puana', style: context.text.bodySmall),
              const SizedBox(height: Space.xs),
              Text('${scores.length > me ? scores[me] : 0}',
                  style: context.text.headlineSmall?.copyWith(color: c.accent)),
              Text('Sen', style: context.text.bodySmall),
              const SizedBox(height: Space.xs),
              Text('${scores.length > opp ? scores[opp] : 0}', style: context.text.titleLarge),
              Text(table.seats[opp]?.name ?? '', maxLines: 1, style: context.text.bodySmall),
            ]),
          ),
        ),
        // Deste: solda
        if (deck > 0)
          Positioned(
            left: Space.lg,
            top: h * 0.36,
            child: Semantics(
              label: 'Destede $deck kart',
              child: Column(children: [
                PlayingCardView(rank: '', suit: CardSuit.spades, width: pileW * 0.8, faceDown: true),
                const SizedBox(height: 2),
                Text('$deck', style: context.text.labelLarge),
              ]),
            ),
          ),
        // Yer: ortada
        Positioned.fill(
          top: h * 0.2,
          bottom: h * 0.36,
          child: Center(child: _Pile(pile: pile, hidden: hidden, width: pileW)),
        ),
        // Benim elim: altta
        Positioned(
          left: 0,
          right: 0,
          bottom: Space.sm,
          child:
              Row(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
            playerInfo(me),
            const SizedBox(width: Space.lg),
            for (final card in hand)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: _HandCard(card: card, width: handW, enabled: table.isMyTurn, onTap: () => onPlay(card)),
              ),
          ]),
        ),
      ]);
    });
  }
}

/// Yerdeki kartlar: dipte kapalı olanlar, üstte son atılanlar hafif kaydırılmış.
class _Pile extends StatelessWidget {
  const _Pile({required this.pile, required this.hidden, required this.width});

  final List<CardData> pile;
  final int hidden;
  final double width;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final shown = pile.length > 4 ? pile.sublist(pile.length - 4) : pile;
    final total = pile.length + hidden;
    final h = width * 1.42;
    return Semantics(
      label: total == 0 ? 'Yer boş' : 'Yerde $total kart, en üstte ${pile.isEmpty ? 'kapalı kart' : pile.last.spoken}',
      child: SizedBox(
        width: width * 2.4,
        height: h + 20,
        child: total == 0
            ? Center(
                child: Container(
                  width: width,
                  height: h,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(width * 0.1),
                    border: Border.all(color: c.glassBorder, width: 1.5),
                  ),
                ),
              )
            : Stack(alignment: Alignment.center, children: [
                for (var i = 0; i < math.min(hidden, 3); i++)
                  Transform.translate(
                    offset: Offset(-6.0 + i * 3, -4.0 + i * 2),
                    child: PlayingCardView(rank: '', suit: CardSuit.spades, width: width, faceDown: true),
                  ),
                for (var i = 0; i < shown.length; i++)
                  Transform.translate(
                    offset: Offset((i - (shown.length - 1)) * width * 0.22, 0),
                    child: Transform.rotate(
                      angle: (i - shown.length + 1) * 0.05,
                      child: PlayingCardView(rank: shown[i].face, suit: shown[i].suit, width: width),
                    ),
                  ),
                Positioned(
                  bottom: 0,
                  right: 0,
                  child: Text('$total', style: context.text.labelMedium),
                ),
              ]),
      ),
    );
  }
}

class _HandCard extends StatefulWidget {
  const _HandCard({required this.card, required this.width, required this.enabled, required this.onTap});

  final CardData card;
  final double width;
  final bool enabled;
  final VoidCallback onTap;

  @override
  State<_HandCard> createState() => _HandCardState();
}

class _HandCardState extends State<_HandCard> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: widget.enabled,
      label: '${widget.card.spoken}${widget.enabled ? ', atmak için dokun' : ''}',
      child: GestureDetector(
        onTapDown: widget.enabled ? (_) => setState(() => _down = true) : null,
        onTapCancel: () => setState(() => _down = false),
        onTapUp: widget.enabled
            ? (_) {
                setState(() => _down = false);
                HapticFeedback.selectionClick();
                widget.onTap();
              }
            : null,
        child: AnimatedSlide(
          offset: widget.enabled ? (_down ? const Offset(0, -0.12) : const Offset(0, -0.04)) : Offset.zero,
          duration: Motion.of(context, Motion.fast),
          curve: Motion.curve,
          child: Opacity(
            opacity: widget.enabled ? 1 : 0.85,
            child: PlayingCardView(rank: widget.card.face, suit: widget.card.suit, width: widget.width),
          ),
        ),
      ),
    );
  }
}

/// “PİŞTİ!” yazısı. Azaltılmış hareket açıksa ölçeklenmeden görünür.
class _PistiFlash extends StatelessWidget {
  const _PistiFlash({required this.points});

  final int points;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final reduce = MediaQuery.of(context).disableAnimations;
    final label = Container(
      padding: const EdgeInsets.symmetric(horizontal: Space.xl, vertical: Space.md),
      decoration: BoxDecoration(
        color: c.reward,
        borderRadius: BorderRadius.circular(Radii.card),
        boxShadow: [BoxShadow(color: c.reward.withValues(alpha: 0.6), blurRadius: 30)],
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(points == 20 ? 'VALE PİŞTİSİ!' : 'PİŞTİ!',
            style: context.text.displaySmall?.copyWith(color: c.onAccent, fontWeight: FontWeight.w900)),
        Text('+$points', style: context.text.titleLarge?.copyWith(color: c.onAccent)),
      ]),
    );
    return Semantics(
      liveRegion: true,
      label: points == 20 ? 'Vale piştisi, 20 puan' : 'Pişti, 10 puan',
      child: reduce
          ? label
          : TweenAnimationBuilder<double>(
              tween: Tween(begin: 0.6, end: 1),
              duration: const Duration(milliseconds: 380),
              curve: Curves.easeOutBack,
              builder: (_, s, child) => Transform.scale(scale: s, child: child),
              child: label,
            ),
    );
  }
}

class PistiResult extends StatelessWidget {
  const PistiResult({super.key, required this.table});

  final CardTableState table;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final r = table.result!;
    final me = table.you;
    final opp = 1 - me;
    final b = [for (final x in (r['breakdown'] as List? ?? const [])) x as Map<String, dynamic>];
    final scores = intsOf(r['scores']);
    final winners = intsOf(r['winners']);
    final over = table.gameOver;
    final title = over
        ? (winners.contains(me) ? 'Oyunu kazandın!' : '${table.seats[opp]?.name ?? ''} oyunu kazandı')
        : 'El bitti';
    int v(int seat, String key) => b.length > seat ? ((b[seat][key] as num?)?.toInt() ?? 0) : 0;
    TableRow row(String label, String key) => TableRow(children: [
          Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text(label, style: context.text.bodySmall)),
          Text('${v(me, key)}', textAlign: TextAlign.center, style: context.text.bodyMedium),
          Text('${v(opp, key)}', textAlign: TextAlign.center, style: context.text.bodyMedium),
        ]);
    return Column(mainAxisSize: MainAxisSize.min, children: [
      if (over && winners.contains(me)) Icon(Icons.emoji_events_rounded, color: c.reward, size: 40),
      Text(title, style: context.text.headlineSmall),
      const SizedBox(height: Space.md),
      SizedBox(
        width: 300,
        child: Table(
          columnWidths: const {0: FlexColumnWidth(2), 1: FlexColumnWidth(1), 2: FlexColumnWidth(1)},
          children: [
            TableRow(children: [
              const SizedBox.shrink(),
              Text('Sen', textAlign: TextAlign.center, style: context.text.labelLarge),
              Text(table.seats[opp]?.name ?? '',
                  textAlign: TextAlign.center, maxLines: 1, style: context.text.labelLarge),
            ]),
            row('Kart sayısı', 'cards'),
            row('Çok kart (+3)', 'most'),
            row('As', 'aces'),
            row('Vale', 'jacks'),
            row('Sinek ikilisi', 'two'),
            row('Karo onlusu', 'ten'),
            row('Pişti', 'pistis'),
            TableRow(children: [
              Text('Bu el', style: context.text.labelLarge),
              Text('${v(me, 'total')}',
                  textAlign: TextAlign.center, style: context.text.titleMedium?.copyWith(color: c.accent)),
              Text('${v(opp, 'total')}', textAlign: TextAlign.center, style: context.text.titleMedium),
            ]),
          ],
        ),
      ),
      const SizedBox(height: Space.sm),
      Text(
        'Toplam: ${scores.length > me ? scores[me] : 0} – ${scores.length > opp ? scores[opp] : 0}'
        ' · ${(table.g['target'] as num?)?.toInt() ?? 101} puana',
        style: context.text.titleMedium,
      ),
    ]);
  }
}
