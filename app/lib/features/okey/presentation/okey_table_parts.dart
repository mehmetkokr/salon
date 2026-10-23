import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/design/customization.dart';
import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/game_pieces.dart';
import '../../../core/design/widgets/player_avatar.dart';
import '../domain/okey_models.dart';
import '../domain/rack_layout.dart';

/// Süreye bağlı parçaları (halka, geri sayım) saniyede birkaç kez yeniler.
/// Ekranın geri kalanı sunucudan durum geldiğinde yenilenir.
class Ticking extends StatefulWidget {
  const Ticking({super.key, required this.builder});

  final Widget Function(BuildContext context, DateTime now) builder;

  @override
  State<Ticking> createState() => _TickingState();
}

class _TickingState extends State<Ticking> {
  late final Timer _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 250), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, DateTime.now());
}

/// Kalan süre oranı (1 → 0).
double timeLeftFraction(DateTime? endsAt, DateTime now, {int totalMs = 20000}) {
  if (endsAt == null) return 1;
  final left = endsAt.difference(now).inMilliseconds;
  return (left / totalMs).clamp(0.0, 1.0);
}

/// Okey taşı: sunucu verisinden çizilir.
class TableTile extends StatelessWidget {
  const TableTile({super.key, required this.tile, required this.table, required this.width, this.selected = false});

  final OkeyTileData tile;
  final OkeyTableState table;
  final double width;
  final bool selected;

  @override
  Widget build(BuildContext context) => OkeyTile(
        number: tile.isFake ? null : tile.number,
        color: tile.color ?? TileColor.black,
        width: width,
        isFalseJoker: tile.isFake,
        isOkey: table.isOkey(tile),
        selected: selected,
      );
}

/// Rakip oyuncu: avatar, ad, taş sayısı ve durum.
class OpponentBadge extends StatelessWidget {
  const OpponentBadge(
      {super.key,
      required this.seat,
      required this.isTurn,
      required this.endsAt,
      this.horizontal = false,
      this.info,
      this.totalMs = 20000});

  final OkeySeatView? seat;
  final bool isTurn;
  final DateTime? endsAt;

  /// Taş sayısının önündeki ek bilgi: katlamalıda puan, 101'de açıp açmadığı.
  final String? info;

  /// Hamle süresi (halkanın oranı için).
  final int totalMs;

  /// Karşıdaki oyuncu için: avatar solda, ad sağda (daha az yükseklik).
  final bool horizontal;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final s = seat;
    const size = 46.0;
    if (s == null) {
      return Semantics(
        label: 'Boş koltuk',
        child: Flex(direction: horizontal ? Axis.horizontal : Axis.vertical, mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: c.glassBorder, width: 1.5),
              color: c.glass,
            ),
            child: Icon(Icons.event_seat_outlined, color: c.textSecondary, size: 22),
          ),
          const SizedBox(width: Space.xs, height: Space.xs),
          Text('Bekleniyor', style: context.text.bodySmall),
        ]),
      );
    }
    final state = isTurn
        ? PlayerState.turn
        : (!s.isBot && (!s.connected || s.autoPlaying))
            ? PlayerState.disconnected
            : s.isBot
                ? PlayerState.bot
                : PlayerState.idle;
    final avatar = isTurn
        ? Ticking(
            builder: (_, now) => PlayerAvatar(
                name: s.name,
                level: s.level,
                size: size,
                state: state,
                timeLeft: timeLeftFraction(endsAt, now, totalMs: totalMs)),
          )
        : PlayerAvatar(name: s.name, level: s.level, size: size, state: state);
    final status = !s.isBot && !s.connected
        ? 'Bağlantı bekleniyor'
        : s.autoPlaying
            ? 'Otomatik oynuyor'
            : info != null
                ? '$info · ${s.tileCount} taş'
                : '${s.tileCount} taş';
    return Flex(
      direction: horizontal ? Axis.horizontal : Axis.vertical,
      mainAxisSize: MainAxisSize.min,
      children: [
        avatar,
        const SizedBox(width: Space.xs, height: Space.xs),
        Container(
          constraints: const BoxConstraints(maxWidth: 130),
          padding: const EdgeInsets.symmetric(horizontal: Space.sm, vertical: 3),
          decoration: BoxDecoration(
            color: isTurn ? c.accent : c.glass,
            borderRadius: BorderRadius.circular(Radii.pill),
            border: Border.all(color: isTurn ? c.accent : c.glassBorder),
          ),
          child: Column(children: [
            Text(
              s.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.text.labelLarge?.copyWith(color: isTurn ? c.onAccent : c.text),
            ),
            Text(
              status,
              style: context.text.bodySmall?.copyWith(
                color: isTurn ? c.onAccent.withValues(alpha: 0.8) : c.textSecondary,
                fontSize: 11,
              ),
            ),
          ]),
        ),
      ],
    );
  }
}

/// Bir oyuncunun attığı taşlar: üstteki taş görünür, altında yığın hissi.
class DiscardPile extends StatelessWidget {
  const DiscardPile({
    super.key,
    required this.top,
    required this.count,
    required this.table,
    required this.tileWidth,
    required this.label,
    this.highlight = false,
    this.onTap,
  });

  final OkeyTileData? top;
  final int count;
  final OkeyTableState table;
  final double tileWidth;
  final String label;

  /// Alınabilir ya da bırakılabilir olduğunu gösterir.
  final bool highlight;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final h = tileWidth * 1.42;
    final t = top;
    return Semantics(
      button: onTap != null,
      label: t == null ? '$label, boş' : '$label, $count taş',
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: Motion.of(context, Motion.base),
          constraints: const BoxConstraints(minWidth: kMinTap, minHeight: kMinTap),
          padding: const EdgeInsets.all(Space.xs),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(Radii.sm + 4),
            color: c.glass.withValues(alpha: 0.35),
            border: Border.all(color: highlight ? c.accent : c.glassBorder, width: highlight ? 2 : 1),
            boxShadow: highlight ? [BoxShadow(color: c.accent.withValues(alpha: 0.35), blurRadius: 14)] : null,
          ),
          child: SizedBox(
            width: tileWidth + 4,
            height: h + 4,
            child: t == null
                ? Center(child: Icon(Icons.south_east_rounded, size: 16, color: c.textSecondary.withValues(alpha: 0.6)))
                : Stack(children: [
                    if (count > 1)
                      Positioned(
                        left: 3,
                        top: 3,
                        child: OkeyTile(width: tileWidth, faceDown: true),
                      ),
                    TableTile(tile: t, table: table, width: tileWidth),
                  ]),
          ),
        ),
      ),
    );
  }
}

/// Istaka: iki raf, her rafta 15 yuva. Taşlar sürüklenip bırakılır.
class OkeyRack extends StatelessWidget {
  const OkeyRack({
    super.key,
    required this.table,
    required this.layout,
    required this.style,
    required this.tileWidth,
    required this.selected,
    required this.onTapTile,
    required this.onMove,
    this.onDragStart,
    this.onDragEnd,
  });

  final OkeyTableState table;
  final RackLayout layout;
  final RackStyle style;
  final double tileWidth;
  final int? selected;
  final ValueChanged<int> onTapTile;
  final void Function(int tileId, int slot) onMove;
  final VoidCallback? onDragStart;
  final VoidCallback? onDragEnd;

  @override
  Widget build(BuildContext context) {
    final byId = {for (final t in table.hand) t.id: t};
    final slotW = tileWidth + 3;
    final tileH = tileWidth * 1.42;

    Widget shelf(int row) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var col = 0; col < RackLayout.columns; col++)
              _Slot(
                index: row * RackLayout.columns + col,
                width: slotW,
                height: tileH + 8,
                tile: byId[layout.slots[row * RackLayout.columns + col]],
                table: table,
                tileWidth: tileWidth,
                selected: selected,
                onTapTile: onTapTile,
                onMove: onMove,
                onDragStart: onDragStart,
                onDragEnd: onDragEnd,
              ),
          ],
        );

    Widget lip() => Container(
          height: 7,
          width: slotW * RackLayout.columns + 16,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(3),
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color.lerp(style.wood, Colors.white, 0.25)!, Color.lerp(style.wood, Colors.black, 0.25)!],
            ),
            border: Border(top: BorderSide(color: style.trim, width: style.level >= 50 ? 2 : 1)),
          ),
        );

    return Semantics(
      label: 'Istaka, ${table.hand.length} taş',
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 4, 8, 4),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(Radii.sm + 2),
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color.lerp(style.wood, Colors.black, 0.35)!, style.wood],
          ),
          boxShadow: const [BoxShadow(color: Color(0x88000000), blurRadius: 18, offset: Offset(0, 8))],
        ),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          shelf(0),
          lip(),
          shelf(1),
          lip(),
        ]),
      ),
    );
  }
}

class _Slot extends StatelessWidget {
  const _Slot({
    required this.index,
    required this.width,
    required this.height,
    required this.tile,
    required this.table,
    required this.tileWidth,
    required this.selected,
    required this.onTapTile,
    required this.onMove,
    this.onDragStart,
    this.onDragEnd,
  });

  final int index;
  final double width;
  final double height;
  final OkeyTileData? tile;
  final OkeyTableState table;
  final double tileWidth;
  final int? selected;
  final ValueChanged<int> onTapTile;
  final void Function(int tileId, int slot) onMove;
  final VoidCallback? onDragStart;
  final VoidCallback? onDragEnd;

  @override
  Widget build(BuildContext context) {
    final t = tile;
    return DragTarget<int>(
      onAcceptWithDetails: (d) => onMove(d.data, index),
      builder: (context, candidates, _) {
        final hovering = candidates.isNotEmpty;
        return Container(
          width: width,
          height: height,
          alignment: Alignment.bottomCenter,
          padding: const EdgeInsets.only(bottom: 2),
          decoration: hovering
              ? BoxDecoration(
                  color: context.salon.accent.withValues(alpha: 0.25),
                  borderRadius: BorderRadius.circular(6),
                )
              : null,
          child: t == null
              ? null
              : Draggable<int>(
                  data: t.id,
                  onDragStarted: onDragStart,
                  onDragEnd: (_) => onDragEnd?.call(),
                  feedback: Material(
                    color: Colors.transparent,
                    child: Transform.scale(scale: 1.12, child: TableTile(tile: t, table: table, width: tileWidth)),
                  ),
                  childWhenDragging: Opacity(opacity: 0.25, child: TableTile(tile: t, table: table, width: tileWidth)),
                  child: GestureDetector(
                    onTap: () => onTapTile(t.id),
                    child: TableTile(tile: t, table: table, width: tileWidth, selected: selected == t.id),
                  ),
                ),
        );
      },
    );
  }
}
