import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/game_pieces.dart';
import '../../../core/design/widgets/glass_panel.dart';
import '../../../core/design/widgets/salon_button.dart';
import '../application/card_table_controller.dart';
import '../domain/card_models.dart';
import 'trick_table.dart';

/// Batak türleri (sunucudaki adlarıyla).
String batakModeLabel(String mode) => switch (mode) {
      'ihaleli' => 'İhaleli batak',
      'esli' => 'Eşli batak',
      _ => 'Batak · koz maça',
    };

/// Batak masası: ortak el masası + söz/ihale/koz seçimi ve bilgi paneli.
class BatakBody extends StatelessWidget {
  const BatakBody({super.key, required this.table, required this.ctl});

  final CardTableState table;
  final CardTableController ctl;

  @override
  Widget build(BuildContext context) {
    final g = table.g;
    final stage = g['stage'] as String? ?? 'bid';
    final bids = (g['bids'] as List?) ?? const [];
    final tricks = intsOf(g['tricks']);
    final declarer = (g['declarer'] as num?)?.toInt() ?? -1;
    String info(int seat) {
      final bid = seat < bids.length ? bids[seat] : null;
      final bidText = bid == null
          ? null
          : (bid == 'pas' ? 'Pas' : (table.mode == 'koz' ? 'Söz $bid' : (seat == declarer ? 'İhale $bid' : '$bid')));
      return [if (bidText != null) bidText, if (seat < tricks.length) '${tricks[seat]} el'].join(' · ');
    }

    return TrickTable(
      table: table,
      ctl: ctl,
      playing: stage == 'play',
      seatInfo: info,
      infoPanel: _InfoPanel(table: table),
      overlay: table.isMyTurn && (stage == 'bid' || stage == 'trump')
          ? _BidPanel(table: table, ctl: ctl, stage: stage)
          : null,
    );
  }
}

/// Sağ üst: tür, koz, ihale ve puanlar.
class _InfoPanel extends StatelessWidget {
  const _InfoPanel({required this.table});

  final CardTableState table;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final g = table.g;
    final trump = (g['trump'] as num?)?.toInt() ?? -1;
    final declarer = (g['declarer'] as num?)?.toInt() ?? -1;
    final highBid = (g['highBid'] as num?)?.toInt() ?? 0;
    final scores = intsOf(g['scores']);
    final tricks = intsOf(g['tricks']);
    final bids = (g['bids'] as List?) ?? const [];
    final myBid = table.you < bids.length ? bids[table.you] : null;
    final hands = (g['hands'] as num?)?.toInt() ?? 5;
    final team = table.mode == 'esli';
    final suit = trump >= 0 ? CardSuit.values[trump] : null;
    return GlassPanel(
      padding: const EdgeInsets.symmetric(horizontal: Space.md, vertical: Space.sm),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text('${batakModeLabel(table.mode)} · El ${table.handNo}/$hands', style: context.text.bodySmall),
        Row(mainAxisSize: MainAxisSize.min, children: [
          Text('Koz ', style: context.text.labelLarge),
          if (suit != null) SuitBadge(suit: suit, size: 22) else Text('—', style: context.text.labelLarge),
          if (declarer >= 0 && table.mode != 'koz') ...[
            Text('  İhale $highBid · ', style: context.text.bodySmall),
            Flexible(
              child: Text(declarer == table.you ? 'Sen' : table.seats[declarer]?.name ?? '',
                  maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.labelMedium),
            ),
          ],
        ]),
        Text(
          'Sen: ${table.you < tricks.length ? tricks[table.you] : 0} el'
          '${table.mode == 'koz' && myBid is num ? ' / söz $myBid' : ''}'
          ' · ${team ? 'Takım' : 'Puan'} ${table.you < scores.length ? scores[table.you] : 0}',
          style: context.text.labelMedium?.copyWith(color: c.accent),
        ),
      ]),
    );
  }
}

/// Söz (koz maça), ihale ya da koz seçimi.
class _BidPanel extends StatelessWidget {
  const _BidPanel({required this.table, required this.ctl, required this.stage});

  final CardTableState table;
  final CardTableController ctl;
  final String stage;

  @override
  Widget build(BuildContext context) {
    final g = table.g;
    if (stage == 'trump') {
      return GlassPanel(
        padding: const EdgeInsets.all(Space.md),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text('İhaleyi aldın. Kozu seç', style: context.text.titleMedium),
          const SizedBox(height: Space.sm),
          Row(mainAxisSize: MainAxisSize.min, children: [
            for (final s in CardSuit.values)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Semantics(
                  button: true,
                  label: 'Koz ${s.label}',
                  child: Material(
                    color: context.salon.glass,
                    borderRadius: BorderRadius.circular(Radii.control),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(Radii.control),
                      onTap: () => ctl.move({'trump': s.index}),
                      child: SizedBox(
                          width: 64,
                          height: 52,
                          child: Center(child: ExcludeSemantics(child: SuitBadge(suit: s, size: 34)))),
                    ),
                  ),
                ),
              ),
          ]),
        ]),
      );
    }
    final koz = table.mode == 'koz';
    final min = (g['minBid'] as num?)?.toInt() ?? 1;
    final high = (g['highBid'] as num?)?.toInt() ?? 0;
    final from = koz ? 1 : math.max(min, high + 1);
    return GlassPanel(
      padding: const EdgeInsets.all(Space.sm),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(koz ? 'Kaç el alacaksın?' : (high > 0 ? 'İhale $high · artır ya da pas' : 'İhale en az $min'),
            style: context.text.titleSmall),
        const SizedBox(height: Space.xs),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (!koz)
              Padding(
                padding: const EdgeInsets.only(right: Space.sm),
                child: SalonButton(
                    label: 'Pas',
                    kind: SalonButtonKind.secondary,
                    compact: true,
                    onPressed: () => ctl.move({'pass': true})),
              ),
            for (var n = from; n <= 13; n++)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minWidth: kMinTap),
                  child: SalonButton(
                      label: '$n', kind: SalonButtonKind.glass, compact: true, onPressed: () => ctl.move({'bid': n})),
                ),
              ),
          ]),
        ),
      ]),
    );
  }
}

/// El ve oyun sonu: söz/ihale, alınan el, puan, toplam.
class BatakResult extends StatelessWidget {
  const BatakResult({super.key, required this.table});

  final CardTableState table;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final r = table.result!;
    final pts = intsOf(r['points']);
    final tricks = intsOf(r['tricks']);
    final scores = intsOf(r['scores']);
    final bids = (r['bids'] as List?) ?? const [];
    final declarer = (r['declarer'] as num?)?.toInt() ?? -1;
    final winners = intsOf(r['winners']);
    final me = table.you;
    final over = table.gameOver;
    String name(int s) => s == me ? 'Sen' : table.seats[s]?.name ?? '';
    final title = !over
        ? 'El bitti'
        : winners.contains(me)
            ? (table.mode == 'esli' ? 'Takımınız kazandı!' : 'Oyunu kazandın!')
            : '${winners.map(name).join(' ve ')} kazandı';
    return Column(mainAxisSize: MainAxisSize.min, children: [
      if (over && winners.contains(me)) Icon(Icons.emoji_events_rounded, color: c.reward, size: 40),
      Text(title, style: context.text.headlineSmall),
      const SizedBox(height: Space.md),
      SizedBox(
        width: 380,
        child: Table(
          columnWidths: const {
            0: FlexColumnWidth(2.2),
            1: FlexColumnWidth(1.2),
            2: FlexColumnWidth(1),
            3: FlexColumnWidth(1),
            4: FlexColumnWidth(1)
          },
          children: [
            TableRow(children: [
              for (final h in ['', table.mode == 'koz' ? 'Söz' : 'İhale', 'El', 'Puan', 'Toplam'])
                Text(h, textAlign: TextAlign.center, style: context.text.labelMedium),
            ]),
            for (var s = 0; s < 4; s++)
              TableRow(
                decoration: s == me
                    ? BoxDecoration(color: c.accent.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(6))
                    : null,
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 4),
                    child: Text(name(s), maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.bodyMedium),
                  ),
                  Text(
                    table.mode == 'koz'
                        ? '${s < bids.length ? bids[s] : ''}'
                        : (s == declarer ? '${r['highBid']}' : ''),
                    textAlign: TextAlign.center,
                    style: context.text.bodyMedium,
                  ),
                  Text('${s < tricks.length ? tricks[s] : 0}',
                      textAlign: TextAlign.center, style: context.text.bodyMedium),
                  Text(
                    s < pts.length ? (pts[s] > 0 ? '+${pts[s]}' : '${pts[s]}') : '',
                    textAlign: TextAlign.center,
                    style:
                        context.text.bodyMedium?.copyWith(color: s < pts.length && pts[s] < 0 ? c.danger : c.success),
                  ),
                  Text('${s < scores.length ? scores[s] : 0}',
                      textAlign: TextAlign.center, style: context.text.titleSmall),
                ],
              ),
          ],
        ),
      ),
    ]);
  }
}
