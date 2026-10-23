import 'package:flutter/material.dart';

import '../customization.dart';
import '../tokens.dart';
import 'game_pieces.dart';

/// Salon logosu: iç içe geçmiş okey taşı, iskambil kartı ve zar.
/// Tamamen vektör; her boyutta keskin.
class SalonLogo extends StatelessWidget {
  const SalonLogo({super.key, this.size = 120});

  final double size;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final u = size / 120;
    return Semantics(
      label: 'Salon logosu',
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(30 * u),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [c.surfaceHigh, c.background],
          ),
          border: Border.all(color: c.accent, width: 2.5 * u),
          boxShadow: [BoxShadow(color: c.accent.withValues(alpha: 0.25), blurRadius: 24 * u)],
        ),
        child: Stack(
          children: [
            Positioned(
              left: 58 * u,
              top: 20 * u,
              child: Transform.rotate(
                angle: 0.24,
                child: PlayingCardView(rank: 'A', suit: CardSuit.hearts, width: 36 * u),
              ),
            ),
            Positioned(
              left: 24 * u,
              top: 28 * u,
              child: Transform.rotate(
                angle: -0.21,
                child: OkeyTile(number: 7, color: TileColor.blue, width: 36 * u),
              ),
            ),
            Positioned(
              left: 46 * u,
              top: 70 * u,
              child: Transform.rotate(
                angle: 0.14,
                child: DieFace(value: 3, size: 32 * u, style: DiceStyle.altin),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
