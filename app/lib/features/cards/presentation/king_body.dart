import 'package:flutter/material.dart';

import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/game_pieces.dart';
import '../../../core/design/widgets/glass_panel.dart';
import '../../../core/design/widgets/salon_button.dart';
import '../application/card_table_controller.dart';
import '../domain/card_models.dart';
import 'trick_table.dart';

/// King sözleşmeleri: sunucudaki ad → (görünen ad, kısa açıklama).
const kingContracts = {
  'el': ('El almaz', 'El başına −50'),
  'kupa': ('Kupa almaz', 'Kupa başına −30'),
  'erkek': ('Erkek almaz', 'Papaz ve vale −60'),
  'kiz': ('Kız almaz', 'Kız başına −100'),
  'rifki': ('Rıfkı', 'Kupa papazı −320'),
  'soniki': ('Son iki', 'Son iki el −180'),
  'koz': ('Koz', 'El başına +50'),
};

/// King masası: ortak el masası + sözleşme seçimi ve bilgi paneli.
class KingBody extends StatelessWidget {
  const KingBody({super.key, required this.table, required this.ctl});

  final CardTableState table;
  final CardTableController ctl;

  @override
  Widget build(BuildContext context) {
    final g = table.g;
    final stage = g['stage'] as String? ?? 'choose';
    final tricks = intsOf(g['tricks']);
    final chooser = (g['chooser'] as num?)?.toInt() ?? -1;
    return TrickTable(
      table: table,
      ctl: ctl,
      playing: stage == 'play',
      seatInfo: (seat) => [
        if (seat == chooser) 'Seçen',
        if (seat < tricks.length) '${tricks[seat]} el',
      ].join(' · '),
      infoPanel: _KingInfo(table: table),
      overlay: table.isMyTurn && stage == 'choose' ? _ChoosePanel(table: table, ctl: ctl) : null,
    );
  }
}

class _KingInfo extends StatelessWidget {
  const _KingInfo({required this.table});

  final CardTableState table;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final g = table.g;
    final contract = g['contract'] as String?;
    final trump = (g['trump'] as num?)?.toInt() ?? -1;
    final chooser = (g['chooser'] as num?)?.toInt() ?? -1;
    final scores = intsOf(g['scores']);
    final games = (g['games'] as num?)?.toInt() ?? 20;
    final name = contract == null ? null : kingContracts[contract]?.$1;
    final chooserName = chooser == table.you ? 'Sen' : (chooser >= 0 ? table.seats[chooser]?.name ?? '' : '');
    return GlassPanel(
      padding: const EdgeInsets.symmetric(horizontal: Space.md, vertical: Space.sm),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text('King · Oyun ${table.handNo}/$games', style: context.text.bodySmall),
        Row(mainAxisSize: MainAxisSize.min, children: [
          Text(name ?? '$chooserName seçiyor…', style: context.text.labelLarge),
          if (contract == 'koz' && trump >= 0) ...[
            const SizedBox(width: Space.xs),
            SuitBadge(suit: CardSuit.values[trump], size: 22),
          ],
        ]),
        Text('Puanın ${table.you < scores.length ? scores[table.you] : 0}',
            style: context.text.labelMedium?.copyWith(color: c.accent)),
      ]),
    );
  }
}

/// Sırası gelen oyuncunun sözleşme seçimi. Koz seçilirse renk sorulur.
class _ChoosePanel extends StatefulWidget {
  const _ChoosePanel({required this.table, required this.ctl});

  final CardTableState table;
  final CardTableController ctl;

  @override
  State<_ChoosePanel> createState() => _ChoosePanelState();
}

class _ChoosePanelState extends State<_ChoosePanel> {
  bool _pickTrump = false;

  @override
  Widget build(BuildContext context) {
    final g = widget.table.g;
    final allowed = [for (final a in (g['allowed'] as List? ?? const [])) a as String];
    if (_pickTrump) {
      return GlassPanel(
        padding: const EdgeInsets.all(Space.md),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text('Kozu seç', style: context.text.titleMedium),
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
                      onTap: () => widget.ctl.move({'contract': 'koz', 'trump': s.index}),
                      child: SizedBox(
                        width: 64,
                        height: 52,
                        child: Center(child: ExcludeSemantics(child: SuitBadge(suit: s, size: 34))),
                      ),
                    ),
                  ),
                ),
              ),
            const SizedBox(width: Space.sm),
            SalonButton(
              label: 'Geri',
              kind: SalonButtonKind.secondary,
              compact: true,
              onPressed: () => setState(() => _pickTrump = false),
            ),
          ]),
        ]),
      );
    }
    return GlassPanel(
      padding: const EdgeInsets.all(Space.sm),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text('Bu oyunu sen seçiyorsun', style: context.text.titleSmall),
        const SizedBox(height: Space.xs),
        Wrap(spacing: Space.xs, runSpacing: Space.xs, alignment: WrapAlignment.center, children: [
          for (final entry in kingContracts.entries)
            if (allowed.contains(entry.key))
              Semantics(
                button: true,
                label: '${entry.value.$1}, ${entry.value.$2}',
                child: Material(
                  color: entry.key == 'koz' ? context.salon.accent : context.salon.glass,
                  borderRadius: BorderRadius.circular(Radii.control),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(Radii.control),
                    onTap: () {
                      if (entry.key == 'koz') {
                        setState(() => _pickTrump = true);
                      } else {
                        widget.ctl.move({'contract': entry.key});
                      }
                    },
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: kMinTap, minWidth: 96),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: Space.md, vertical: Space.xs),
                        child: ExcludeSemantics(
                          child: Column(mainAxisSize: MainAxisSize.min, children: [
                            Text(entry.value.$1,
                                style: context.text.labelLarge?.copyWith(
                                    color: entry.key == 'koz' ? context.salon.onAccent : context.salon.text)),
                            Text(entry.value.$2,
                                style: context.text.bodySmall?.copyWith(
                                    fontSize: 11,
                                    color: entry.key == 'koz' ? context.salon.onAccent : context.salon.textSecondary)),
                          ]),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
        ]),
      ]),
    );
  }
}

/// Oyun ve maç sonu: sözleşme, oyuncuların puanı ve toplamlar.
class KingResult extends StatelessWidget {
  const KingResult({super.key, required this.table});

  final CardTableState table;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final r = table.result!;
    final pts = intsOf(r['points']);
    final scores = intsOf(r['scores']);
    final tricks = intsOf(r['tricks']);
    final winners = intsOf(r['winners']);
    final me = table.you;
    final over = table.gameOver;
    final contract = kingContracts[r['contract']]?.$1 ?? '';
    String name(int s) => s == me ? 'Sen' : table.seats[s]?.name ?? '';
    final title = !over
        ? '$contract bitti'
        : winners.contains(me)
            ? 'Maçı kazandın!'
            : '${winners.map(name).join(' ve ')} kazandı';
    return Column(mainAxisSize: MainAxisSize.min, children: [
      if (over && winners.contains(me)) Icon(Icons.emoji_events_rounded, color: c.reward, size: 40),
      Text(title, style: context.text.headlineSmall),
      Text('Oyun ${table.handNo}/${(table.g['games'] as num?)?.toInt() ?? 20}', style: context.text.bodySmall),
      const SizedBox(height: Space.md),
      SizedBox(
        width: 340,
        child: Table(
          columnWidths: const {
            0: FlexColumnWidth(2.2),
            1: FlexColumnWidth(1),
            2: FlexColumnWidth(1.2),
            3: FlexColumnWidth(1.2)
          },
          children: [
            TableRow(children: [
              for (final h in ['', 'El', 'Puan', 'Toplam'])
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
                  Text('${s < tricks.length ? tricks[s] : 0}',
                      textAlign: TextAlign.center, style: context.text.bodyMedium),
                  Text(
                    s < pts.length ? (pts[s] > 0 ? '+${pts[s]}' : '${pts[s]}') : '',
                    textAlign: TextAlign.center,
                    style: context.text.bodyMedium?.copyWith(
                        color: s < pts.length && pts[s] < 0
                            ? c.danger
                            : s < pts.length && pts[s] > 0
                                ? c.success
                                : c.text),
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
