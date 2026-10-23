import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../customization.dart';
import '../tokens.dart';
import 'game_pieces.dart';

/// Istaka önizlemesi: ahşap gövde, ön raf ve üstünde duran taşlar.
class RackPreview extends StatelessWidget {
  const RackPreview({super.key, required this.style, this.width = 150});

  final RackStyle style;
  final double width;

  @override
  Widget build(BuildContext context) {
    final tile = width * 0.15;
    return SizedBox(
      width: width,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: EdgeInsets.fromLTRB(width * 0.06, width * 0.05, width * 0.06, 0),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.vertical(top: Radius.circular(width * 0.06)),
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color.lerp(style.wood, Colors.black, 0.35)!, style.wood],
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                OkeyTile(number: 3, color: TileColor.red, width: tile),
                OkeyTile(number: 4, color: TileColor.red, width: tile),
                OkeyTile(number: 5, color: TileColor.red, width: tile),
                OkeyTile(number: 9, color: TileColor.blue, width: tile),
                OkeyTile(number: 9, color: TileColor.black, width: tile),
              ],
            ),
          ),
          // Ön raf: süsleme rengiyle; sedef ve altında motif.
          Container(
            height: width * 0.1,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.vertical(bottom: Radius.circular(width * 0.06)),
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color.lerp(style.wood, Colors.white, 0.25)!, Color.lerp(style.wood, Colors.black, 0.2)!],
              ),
              border: Border(top: BorderSide(color: style.trim, width: style.level >= 50 ? 2 : 1)),
              boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 8, offset: Offset(0, 5))],
            ),
            child: style.level >= 50
                ? Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: List.generate(
                      9,
                      (_) => Transform.rotate(
                        angle: 0.785,
                        child: Container(width: width * 0.025, height: width * 0.025, color: style.trim),
                      ),
                    ),
                  )
                : null,
          ),
        ],
      ),
    );
  }
}

/// Seçilebilir öğe kartı: oda arka planı, ıstaka veya zar için ortak çerçeve.
/// Kilitliyse hangi seviyede açılacağını gösterir ve seçilemez.
class SelectableTile extends StatelessWidget {
  const SelectableTile({
    super.key,
    required this.child,
    required this.label,
    required this.selected,
    this.lockedUntilLevel,
    this.onTap,
    this.width = 170,
  });

  final Widget child;
  final String label;
  final bool selected;
  final int? lockedUntilLevel;
  final VoidCallback? onTap;
  final double width;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final locked = lockedUntilLevel != null;
    return Semantics(
      button: !locked,
      selected: selected,
      label: locked ? '$label, seviye $lockedUntilLevel ile açılır' : label,
      child: GestureDetector(
        onTap: locked
            ? null
            : () {
                HapticFeedback.selectionClick();
                onTap?.call();
              },
        child: AnimatedContainer(
          duration: Motion.of(context, Motion.base),
          width: width,
          padding: const EdgeInsets.all(Space.sm),
          decoration: BoxDecoration(
            color: c.surface,
            borderRadius: BorderRadius.circular(Radii.card),
            border: Border.all(color: selected ? c.accent : c.outline, width: selected ? 2 : 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                children: [
                  Opacity(opacity: locked ? 0.4 : 1, child: Center(child: child)),
                  if (locked)
                    Positioned(
                      top: 4,
                      right: 4,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                            color: c.background.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(8)),
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          Icon(Icons.lock_rounded, size: 12, color: c.textSecondary),
                          const SizedBox(width: 3),
                          Text('Sv. $lockedUntilLevel', style: context.text.labelSmall),
                        ]),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: Space.sm),
              Row(
                children: [
                  Expanded(child: Text(label, style: context.text.labelMedium, overflow: TextOverflow.ellipsis)),
                  if (selected) Icon(Icons.check_circle_rounded, size: 18, color: c.accent),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
