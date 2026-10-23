import 'package:flutter/material.dart';

import '../tokens.dart';

/// Çip simgesi.
class ChipCoin extends StatelessWidget {
  const ChipCoin({super.key, this.size = 22});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const RadialGradient(
          center: Alignment(-0.3, -0.3),
          colors: [Color(0xFFFFF1B8), Color(0xFFE3B341), Color(0xFF9C7414)],
          stops: [0, 0.55, 1],
        ),
        border: Border.all(color: const Color(0x997A5608), width: 1.2),
      ),
      child: Icon(Icons.star_rounded, size: size * 0.6, color: const Color(0xFF7A5608)),
    );
  }
}

String formatChips(int value) {
  final s = value.abs().toString();
  final b = StringBuffer(value < 0 ? '-' : '');
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write('.');
    b.write(s[i]);
  }
  return b.toString();
}

/// Çip bakiyesi. Değer değişince sayarak artar/azalır.
class CoinBalance extends StatelessWidget {
  const CoinBalance({super.key, required this.value, this.onTap});

  final int value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return Semantics(
      button: onTap != null,
      label: '${formatChips(value)} çip',
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          height: kMinTap,
          padding: const EdgeInsets.only(left: 6, right: 6),
          decoration: BoxDecoration(
            color: c.glass,
            borderRadius: BorderRadius.circular(Radii.pill),
            border: Border.all(color: c.glassBorder),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            const ChipCoin(),
            const SizedBox(width: Space.sm),
            TweenAnimationBuilder<int>(
              tween: IntTween(end: value),
              duration: Motion.of(context, Motion.slow * 2),
              curve: Motion.curve,
              builder: (context, v, _) => Text(
                formatChips(v),
                style: context.text.labelMedium?.copyWith(color: c.reward, fontSize: 15),
              ),
            ),
            if (onTap != null) ...[
              const SizedBox(width: Space.sm),
              Container(
                width: 30,
                height: 30,
                decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle),
                child: Icon(Icons.add_rounded, size: 20, color: c.onAccent),
              ),
            ],
          ]),
        ),
      ),
    );
  }
}
