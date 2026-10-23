import 'package:flutter/material.dart';

import '../customization.dart';
import '../tokens.dart';

/// Okey taşı. Rengin altında renk körü oyuncular için şekil işareti vardır.
class OkeyTile extends StatelessWidget {
  const OkeyTile({
    super.key,
    this.number,
    this.color = TileColor.red,
    this.width = 40,
    this.isOkey = false,
    this.isFalseJoker = false,
    this.faceDown = false,
    this.selected = false,
  });

  final int? number;
  final TileColor color;
  final double width;

  /// Bu elin okeyi: köşede altın nokta.
  final bool isOkey;

  /// Sahte okey: yıldız simgesi.
  final bool isFalseJoker;
  final bool faceDown;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final h = width * 1.42;
    final label = faceDown
        ? 'Kapalı taş'
        : isFalseJoker
            ? 'Sahte okey'
            : '${color.label} $number${isOkey ? ', okey' : ''}';
    return Semantics(
      label: label,
      child: AnimatedSlide(
        offset: selected ? const Offset(0, -0.16) : Offset.zero,
        duration: Motion.of(context, Motion.fast),
        curve: Motion.curve,
        child: Container(
          width: width,
          height: h,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(width * 0.16),
            gradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFFFFFDF7), Color(0xFFEFE6D1)],
            ),
            border: selected ? Border.all(color: context.salon.accent, width: 2) : null,
            boxShadow: const [
              BoxShadow(color: Color(0xFFC9BB9A), offset: Offset(0, 2)),
              BoxShadow(color: Color(0x55000000), blurRadius: 5, offset: Offset(1, 4)),
            ],
          ),
          child: faceDown
              ? Center(
                  child: Container(
                    width: width * 0.55,
                    height: h * 0.6,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(width * 0.08),
                      border: Border.all(color: const Color(0x55A08C64)),
                    ),
                  ),
                )
              : Stack(
                  children: [
                    Center(
                      child: isFalseJoker
                          ? Icon(Icons.star_rounded, size: width * 0.6, color: TileColor.black.color)
                          // Çok küçük taşlarda (masadaki perler) yazı taşmasın.
                          : FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text('$number',
                                      style: TextStyle(
                                        fontSize: width * 0.52,
                                        height: 1,
                                        fontWeight: FontWeight.w800,
                                        color: color.color,
                                      )),
                                  SizedBox(height: width * 0.04),
                                  Text(color.shape,
                                      style: TextStyle(fontSize: width * 0.26, height: 1, color: color.color)),
                                ],
                              ),
                            ),
                    ),
                    if (isOkey)
                      Positioned(
                        top: width * 0.1,
                        right: width * 0.1,
                        child: Container(
                          width: width * 0.16,
                          height: width * 0.16,
                          decoration: const BoxDecoration(color: Color(0xFFD4AF37), shape: BoxShape.circle),
                        ),
                      ),
                  ],
                ),
        ),
      ),
    );
  }
}

enum CardSuit {
  spades('♠', false, 'maça'),
  hearts('♥', true, 'kupa'),
  diamonds('♦', true, 'karo'),
  clubs('♣', false, 'sinek');

  const CardSuit(this.symbol, this.red, this.label);
  final String symbol;

  /// Simgenin yazı biçimi (U+FE0E): Android'de emoji gibi gri çizilmez,
  /// verilen rengi alır.
  String get glyph => '$symbol︎';
  final bool red;
  final String label;
}

/// İskambil kartı (Batak, Pişti, King).
/// Renk (maça, kupa…) rozeti: beyaz zeminde simge. Koyu yüzeylerde de
/// siyah renkler okunur kalır (Android simgeleri emoji gibi çizebiliyor).
class SuitBadge extends StatelessWidget {
  const SuitBadge({super.key, required this.suit, this.size = 28});

  final CardSuit suit;
  final double size;

  @override
  Widget build(BuildContext context) {
    final fg = suit.red ? const Color(0xFFC8262C) : const Color(0xFF16181D);
    return Semantics(
      label: suit.label,
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: const Color(0xFFFFFDF7),
          borderRadius: BorderRadius.circular(size * 0.22),
          boxShadow: const [BoxShadow(color: Color(0x44000000), blurRadius: 3, offset: Offset(0, 1))],
        ),
        child: ExcludeSemantics(
          child: Text(suit.glyph, style: TextStyle(fontSize: size * 0.68, height: 1, color: fg)),
        ),
      ),
    );
  }
}

class PlayingCardView extends StatelessWidget {
  const PlayingCardView({
    super.key,
    this.rank = 'A',
    this.suit = CardSuit.spades,
    this.width = 52,
    this.faceDown = false,
  });

  final String rank;
  final CardSuit suit;
  final double width;
  final bool faceDown;

  @override
  Widget build(BuildContext context) {
    final h = width * 1.42;
    final fg = suit.red ? const Color(0xFFC8262C) : const Color(0xFF16181D);
    return Semantics(
      label: faceDown ? 'Kapalı kart' : '${suit.label} $rank',
      child: Container(
        width: width,
        height: h,
        padding: EdgeInsets.all(width * 0.08),
        decoration: BoxDecoration(
          color: const Color(0xFFFFFDF9),
          borderRadius: BorderRadius.circular(width * 0.12),
          border: Border.all(color: const Color(0xFFDAD3C3)),
          boxShadow: const [BoxShadow(color: Color(0x44000000), blurRadius: 6, offset: Offset(1, 4))],
        ),
        child: faceDown
            ? Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(width * 0.08),
                  gradient: const LinearGradient(
                    colors: [Color(0xFF1F3A6B), Color(0xFF14264A)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
                child: Center(
                  child: Icon(Icons.diamond_outlined, size: width * 0.4, color: const Color(0x88D4AF37)),
                ),
              )
            : Stack(
                children: [
                  Positioned(
                    left: 0,
                    top: 0,
                    child: Column(
                      children: [
                        Text(rank,
                            style:
                                TextStyle(fontSize: width * 0.28, height: 1, fontWeight: FontWeight.w700, color: fg)),
                        Text(suit.glyph, style: TextStyle(fontSize: width * 0.22, height: 1.1, color: fg)),
                      ],
                    ),
                  ),
                  Center(child: Text(suit.glyph, style: TextStyle(fontSize: width * 0.6, color: fg))),
                ],
              ),
      ),
    );
  }
}

/// Tavla zarı. Görünüşü [DiceStyle] ile seviyeye göre değişir.
class DieFace extends StatelessWidget {
  const DieFace({super.key, required this.value, this.size = 40, this.style = DiceStyle.klasik});

  final int value;
  final double size;
  final DiceStyle style;

  static const _pips = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };

  @override
  Widget build(BuildContext context) {
    final on = _pips[value]!;
    return Semantics(
      label: 'Zar $value',
      child: Container(
        width: size,
        height: size,
        padding: EdgeInsets.all(size * 0.15),
        decoration: BoxDecoration(
          color: style.face,
          borderRadius: BorderRadius.circular(size * 0.22),
          border: Border(bottom: BorderSide(color: style.edge, width: size * 0.06)),
          boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 6, offset: Offset(1, 4))],
        ),
        child: GridView.count(
          crossAxisCount: 3,
          physics: const NeverScrollableScrollPhysics(),
          padding: EdgeInsets.zero,
          children: List.generate(
            9,
            (i) => Center(
              child: on.contains(i)
                  ? Container(
                      width: size * 0.17,
                      height: size * 0.17,
                      decoration: BoxDecoration(color: style.pip, shape: BoxShape.circle),
                    )
                  : null,
            ),
          ),
        ),
      ),
    );
  }
}

/// Tavla pulu: beyaz veya siyah.
class Checker extends StatelessWidget {
  const Checker({super.key, this.white = true, this.size = 34});

  final bool white;
  final double size;

  @override
  Widget build(BuildContext context) {
    final base = white ? const Color(0xFFF7F4EC) : const Color(0xFF1C1D21);
    final ring = white ? const Color(0xFFCFC8B8) : const Color(0xFF3A3C42);
    return Semantics(
      label: white ? 'Beyaz pul' : 'Siyah pul',
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            center: const Alignment(-0.3, -0.35),
            colors: [Color.lerp(base, Colors.white, white ? 0.6 : 0.18)!, base],
          ),
          border: Border.all(color: ring, width: 2),
          boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 5, offset: Offset(1, 3))],
        ),
        child: Center(
          child: Container(
            width: size * 0.55,
            height: size * 0.55,
            decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: ring)),
          ),
        ),
      ),
    );
  }
}
