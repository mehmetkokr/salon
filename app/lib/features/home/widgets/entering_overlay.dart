import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';

import '../../../core/design/customization.dart';
import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/game_pieces.dart';

/// Girişten sonra lobiye geçiş: arka plan bulanıklaşır, zarlar döner,
/// alttaki yazı değişir. Veri yüklemesi arkada sürer; 1–2 sn’den uzun sürmez.
class EnteringOverlay extends StatefulWidget {
  const EnteringOverlay({super.key, required this.dice});

  final DiceStyle dice;

  @override
  State<EnteringOverlay> createState() => _EnteringOverlayState();
}

class _EnteringOverlayState extends State<EnteringOverlay> with SingleTickerProviderStateMixin {
  static const _messages = ['Salonlar hazırlanıyor…', 'Masalar kuruluyor…', 'Çipler sayılıyor…'];
  late final AnimationController _spin = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))
    ..repeat();
  late final Timer _timer;
  int _i = 0;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 550), (_) {
      if (mounted) setState(() => _i = (_i + 1) % _messages.length);
    });
  }

  @override
  void dispose() {
    _timer.cancel();
    _spin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final reduce = MediaQuery.of(context).disableAnimations;
    return BackdropFilter(
      filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
      child: ColoredBox(
        color: c.scrim,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  RotationTransition(
                    turns: reduce ? const AlwaysStoppedAnimation(0) : _spin,
                    child: DieFace(value: 5, size: 48, style: widget.dice),
                  ),
                  const SizedBox(width: Space.lg),
                  RotationTransition(
                    turns: reduce ? const AlwaysStoppedAnimation(0) : ReverseAnimation(_spin),
                    child: DieFace(value: 3, size: 48, style: widget.dice),
                  ),
                ],
              ),
              const SizedBox(height: Space.xl),
              AnimatedSwitcher(
                duration: Motion.of(context, Motion.base),
                child: Text(_messages[_i], key: ValueKey(_i), style: context.text.titleMedium),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
