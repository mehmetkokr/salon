import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../tokens.dart';

enum PlayerState { idle, turn, disconnected, bot }

/// Masadaki oyuncu: baş harf, seviye rozeti, sıra süresi halkası.
/// Bağlantısı kopan oyuncu soluklaşır; bot her zaman "Bot" rozetiyle görünür.
class PlayerAvatar extends StatelessWidget {
  const PlayerAvatar({
    super.key,
    required this.name,
    this.level,
    this.size = 56,
    this.state = PlayerState.idle,
    this.timeLeft = 1,
    this.gradient = const [Color(0xFF5B7BD5), Color(0xFF2E3F8F)],
  });

  final String name;
  final int? level;
  final double size;
  final PlayerState state;

  /// Sıra süresinden kalan oran (1 → 0). Son %33’te halka uyarı rengine döner.
  final double timeLeft;
  final List<Color> gradient;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final dc = state == PlayerState.disconnected;
    final ringColor = dc ? c.warning : (timeLeft < 0.33 ? c.danger : c.timer);
    final semantics = switch (state) {
      PlayerState.turn => '$name, sıra onda',
      PlayerState.disconnected => '$name, bağlantı yenileniyor',
      PlayerState.bot => '$name, yapay zekâ oynuyor',
      PlayerState.idle => name,
    };
    return Semantics(
      label: semantics,
      child: SizedBox.square(
        dimension: size,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            if (state == PlayerState.turn || dc)
              Positioned.fill(
                child: CustomPaint(
                    painter: _RingPainter(progress: dc ? 1 : timeLeft, color: ringColor, dashed: dc, track: c.outline)),
              ),
            Positioned.fill(
              child: Padding(
                padding: EdgeInsets.all(size * 0.09),
                child: AnimatedOpacity(
                  opacity: dc ? 0.4 : 1,
                  duration: Motion.of(context, Motion.base),
                  child: Container(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(colors: gradient, begin: Alignment.topLeft, end: Alignment.bottomRight),
                      border: Border.all(color: c.accent, width: 2),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      name.characters.first.toUpperCase(),
                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: size * 0.34),
                    ),
                  ),
                ),
              ),
            ),
            if (level != null)
              Positioned(
                right: -2,
                bottom: -2,
                child: _Badge(text: '$level', bg: c.accent, fg: c.onAccent),
              ),
            if (state == PlayerState.bot)
              const Positioned(
                left: -4,
                bottom: -2,
                child: _Badge(text: 'Bot', bg: Color(0xFF5B7BD5), fg: Colors.white, icon: Icons.smart_toy_outlined),
              ),
          ],
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.text, required this.bg, required this.fg, this.icon});

  final String text;
  final Color bg;
  final Color fg;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 11, color: fg), const SizedBox(width: 2)],
        Text(text, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: fg, height: 1.3)),
      ]),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({required this.progress, required this.color, required this.track, this.dashed = false});

  final double progress;
  final Color color;
  final Color track;
  final bool dashed;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final r = rect.deflate(2);
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.5
      ..strokeCap = StrokeCap.round;
    if (dashed) {
      p.color = color;
      const n = 14;
      for (var i = 0; i < n; i++) {
        canvas.drawArc(r, i * 2 * math.pi / n, math.pi / n * 0.9, false, p);
      }
      return;
    }
    canvas.drawArc(r, 0, 2 * math.pi, false, p..color = track);
    canvas.drawArc(r, -math.pi / 2, 2 * math.pi * progress.clamp(0, 1), false, p..color = color);
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.progress != progress || old.color != color || old.dashed != dashed || old.track != track;
}
