import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/design/customization.dart';
import '../../../core/design/widgets/game_pieces.dart';

/// Tahtaya atılan iki zar. Yeni bir atış geldiğinde ([rollKey] değişince)
/// zarlar atanın tarafından fırlar, yuvarlanır, iki kez seker ve durur.
/// Durana kadar yüzler döner; durunca gerçek değer görünür.
/// Azaltılmış hareket açıksa zarlar doğrudan yerinde görünür.
class ThrownDice extends StatefulWidget {
  const ThrownDice({
    super.key,
    required this.dice,
    required this.used,
    required this.rollKey,
    required this.fromBottom,
    required this.style,
    this.doublesLeft,
  });

  /// Atılan iki zar.
  final List<int> dice;

  /// Zar kullanıldıysa soluk gösterilir.
  final List<bool> used;

  /// Her yeni atışta değişen anahtar (oyun, sıra, zar).
  final String rollKey;

  /// Zarı ben attıysam alttan, rakip attıysa üstten gelir.
  final bool fromBottom;
  final DiceStyle style;

  /// Çiftte kalan hamle sayısı (gösterim için).
  final int? doublesLeft;

  @override
  State<ThrownDice> createState() => _ThrownDiceState();
}

class _ThrownDiceState extends State<ThrownDice> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1150));
  final _rnd = math.Random();
  late List<double> _tilt; // durunca her zarın hafif açısı
  late List<Offset> _rest; // durduğu yer (alanın oranı)

  @override
  void initState() {
    super.initState();
    _pickRest();
    _c.value = 1; // ekran açıldığında mevcut zar zaten yerinde
  }

  void _pickRest() {
    _tilt = [(_rnd.nextDouble() - 0.5) * 0.5, (_rnd.nextDouble() - 0.5) * 0.5];
    _rest = [
      Offset(0.36 + _rnd.nextDouble() * 0.06, 0.46 + (_rnd.nextDouble() - 0.5) * 0.12),
      Offset(0.6 + _rnd.nextDouble() * 0.06, 0.52 + (_rnd.nextDouble() - 0.5) * 0.12),
    ];
  }

  @override
  void didUpdateWidget(ThrownDice old) {
    super.didUpdateWidget(old);
    if (old.rollKey != widget.rollKey) {
      _pickRest();
      if (MediaQuery.of(context).disableAnimations) {
        _c.value = 1;
      } else {
        _c.forward(from: 0);
      }
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Zarlar ${widget.dice.join(' ve ')}',
      child: LayoutBuilder(builder: (context, box) {
        final w = box.maxWidth;
        final h = box.maxHeight;
        final size = math.min(46.0, math.min(w, h) * 0.17);
        return AnimatedBuilder(
          animation: _c,
          builder: (context, _) {
            final t = _c.value;
            final children = <Widget>[];
            for (var i = 0; i < math.min(2, widget.dice.length); i++) {
              // Her zar biraz farklı zamanda yola çıkar
              final ti = ((t - i * 0.06) / 0.94).clamp(0.0, 1.0);
              final p = Curves.easeOutCubic.transform(ti);
              final start = Offset(
                widget.fromBottom ? 1.05 : -0.05,
                widget.fromBottom ? 1.08 + i * 0.05 : -0.08 - i * 0.05,
              );
              final end = _rest[i];
              final ground = Offset.lerp(start, end, p)!;
              // Sekme: iki kez yükselip alçalır, giderek söner
              final bounce = (1 - p) * (1 - p) * (math.sin(p * math.pi * 2.6)).abs();
              final lift = bounce * h * 0.55;
              final angle = _tilt[i] + (1 - p) * (1 - p) * math.pi * 7 * (i.isEven ? 1 : -1);
              final settled = ti >= 0.78;
              final face = settled ? widget.dice[i] : 1 + ((ti * 23 + i * 3).floor() % 6);
              final used = settled && i < widget.used.length && widget.used[i];
              final x = ground.dx * w - size / 2;
              final y = ground.dy * h - size / 2;
              // Gölge: zar yükseldikçe küçülür ve solar
              children.add(Positioned(
                left: x + size * 0.1,
                top: y + size * 0.75,
                child: Opacity(
                  opacity: (0.45 - bounce * 0.3).clamp(0.08, 0.45),
                  child: Container(
                    width: size * (0.9 - bounce * 0.3),
                    height: size * 0.32,
                    decoration: const BoxDecoration(
                      color: Colors.black,
                      borderRadius: BorderRadius.all(Radius.elliptical(40, 14)),
                    ),
                  ),
                ),
              ));
              children.add(Positioned(
                left: x,
                top: y - lift,
                child: Transform.rotate(
                  angle: angle,
                  child: Transform.scale(
                    scale: 1 + bounce * 0.25,
                    child: AnimatedOpacity(
                      opacity: used ? 0.4 : 1,
                      duration: const Duration(milliseconds: 200),
                      child: ExcludeSemantics(child: DieFace(value: face, size: size, style: widget.style)),
                    ),
                  ),
                ),
              ));
            }
            final left = widget.doublesLeft;
            if (left != null && t >= 1 && left > 0) {
              children.add(Positioned(
                left: _rest[1].dx * w + size * 0.6,
                top: _rest[1].dy * h - size * 0.9,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: const Color(0xCC1A110A), borderRadius: BorderRadius.circular(10)),
                  child: Text('×$left', style: const TextStyle(color: Color(0xFFF2D27A), fontWeight: FontWeight.w800)),
                ),
              ));
            }
            return Stack(clipBehavior: Clip.none, children: children);
          },
        );
      }),
    );
  }
}
