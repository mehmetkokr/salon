import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Kahvehane tavlasının malzemeleri. Uygulamanın "Gece kahvehanesi"
/// paletinin içinde; tahta ve aksesuarlar bunları kullanır.
abstract final class TavlaWood {
  static const frameDark = Color(0xFF3A2314); // ceviz çerçeve
  static const frameLight = Color(0xFF6B4428); // ışık alan kenar
  static const surface = Color(0xFFB98A5A); // açık ceviz oyun yüzeyi
  static const surfaceDeep = Color(0xFF8E6440);
  static const pointRed = Color(0xFF8C2B22); // nar kırmızısı hane
  static const pointCream = Color(0xFFE8D9BC); // fildişi hane
  static const brass = Color(0xFFC9A14A); // pirinç kakma ve pul kenarı
  static const lamp = Color(0xFFF2B35E); // lamba ışığı
  static const night = Color(0xFF0B1418); // gece
}

/// Masa: koyu ahşap kalaslar, tepeden vuran lamba ışığı ve kenarlarda gece.
class TableBackdrop extends StatelessWidget {
  const TableBackdrop({super.key});

  @override
  Widget build(BuildContext context) =>
      const RepaintBoundary(child: CustomPaint(painter: _TablePainter(), size: Size.infinite));
}

class _TablePainter extends CustomPainter {
  const _TablePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(rect, Paint()..color = const Color(0xFF1A110A));
    // Kalaslar: hafif ton farkıyla yatay şeritler ve damar çizgileri
    final plank = size.height / 5;
    final rnd = math.Random(7);
    for (var i = 0; i < 6; i++) {
      final r = Rect.fromLTWH(0, i * plank, size.width, plank);
      final tone = Color.lerp(const Color(0xFF2A1A0F), const Color(0xFF3A2416), rnd.nextDouble())!;
      canvas.drawRect(r, Paint()..color = tone);
      final grain = Paint()
        ..color = const Color(0x22000000)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1;
      for (var g = 0; g < 7; g++) {
        final y = r.top + rnd.nextDouble() * plank;
        final path = Path()..moveTo(0, y);
        for (var x = 0.0; x <= size.width; x += size.width / 8) {
          path.lineTo(x, y + math.sin(x / 90 + g) * 3);
        }
        canvas.drawPath(path, grain);
      }
      canvas.drawLine(Offset(0, r.top), Offset(size.width, r.top), Paint()..color = const Color(0x55000000));
    }
    // Lamba: tahtanın üstüne sıcak bir ışık, kenarlara doğru gece
    canvas.drawRect(
      rect,
      Paint()
        ..shader = RadialGradient(
          center: const Alignment(0, -0.15),
          radius: 0.95,
          colors: [
            TavlaWood.lamp.withValues(alpha: 0.30),
            TavlaWood.lamp.withValues(alpha: 0.06),
            TavlaWood.night.withValues(alpha: 0.85),
          ],
          stops: const [0, 0.45, 1],
        ).createShader(rect),
    );
  }

  @override
  bool shouldRepaint(_TablePainter oldDelegate) => false;
}

/// İnce belli çay bardağı, tabağıyla.
class TeaGlass extends StatelessWidget {
  const TeaGlass({super.key, this.size = 70});

  final double size;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: CustomPaint(size: Size(size, size * 1.2), painter: _TeaPainter()),
      );
}

class _TeaPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size s) {
    final w = s.width;
    final h = s.height;
    // Tabak
    final saucer = Rect.fromCenter(center: Offset(w / 2, h * 0.9), width: w, height: h * 0.16);
    canvas.drawOval(saucer.shift(const Offset(2, 4)), Paint()..color = const Color(0x66000000));
    canvas.drawOval(saucer, Paint()..color = const Color(0xFFE9E2D2));
    canvas.drawOval(saucer.deflate(w * 0.12), Paint()..color = const Color(0xFFD4CAB5));
    // Bardak (lale biçimi)
    final glass = Path()
      ..moveTo(w * 0.22, h * 0.08)
      ..cubicTo(w * 0.20, h * 0.35, w * 0.36, h * 0.46, w * 0.36, h * 0.55)
      ..cubicTo(w * 0.36, h * 0.66, w * 0.26, h * 0.76, w * 0.30, h * 0.86)
      ..lineTo(w * 0.70, h * 0.86)
      ..cubicTo(w * 0.74, h * 0.76, w * 0.64, h * 0.66, w * 0.64, h * 0.55)
      ..cubicTo(w * 0.64, h * 0.46, w * 0.80, h * 0.35, w * 0.78, h * 0.08)
      ..close();
    canvas.save();
    canvas.clipPath(glass);
    // Çay: tavşan kanı
    canvas.drawRect(
      Rect.fromLTWH(0, h * 0.2, w, h),
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [Color(0xFF6E1E0E), Color(0xFFB4441C), Color(0xFF7A220F)],
        ).createShader(Rect.fromLTWH(0, 0, w, h)),
    );
    canvas.drawRect(Rect.fromLTWH(0, 0, w, h * 0.2), Paint()..color = const Color(0x22FFFFFF));
    canvas.restore();
    canvas.drawPath(
      glass,
      Paint()
        ..color = const Color(0x99FFFFFF)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4,
    );
    // Parlama
    canvas.drawLine(
        Offset(w * 0.3, h * 0.14),
        Offset(w * 0.32, h * 0.4),
        Paint()
          ..color = const Color(0x88FFFFFF)
          ..strokeWidth = 2
          ..strokeCap = StrokeCap.round);
  }

  @override
  bool shouldRepaint(_TeaPainter oldDelegate) => false;
}

/// Kehribar tespih: bir yay boyunca boncuklar ve püskül.
class Tesbih extends StatelessWidget {
  const Tesbih({super.key, this.size = 90});

  final double size;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: CustomPaint(size: Size(size, size), painter: _TesbihPainter()),
      );
}

class _TesbihPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size s) {
    final c = Offset(s.width * 0.5, s.height * 0.45);
    final rx = s.width * 0.38;
    final ry = s.height * 0.26;
    const beads = 22;
    final r = s.width * 0.05;
    for (var i = 0; i < beads; i++) {
      final a = math.pi * 0.62 + (i / (beads - 1)) * math.pi * 1.76;
      final p = c + Offset(math.cos(a) * rx, math.sin(a) * ry);
      canvas.drawCircle(p + const Offset(1, 2), r, Paint()..color = const Color(0x55000000));
      canvas.drawCircle(
        p,
        r,
        Paint()
          ..shader = const RadialGradient(
            center: Alignment(-0.4, -0.4),
            colors: [Color(0xFFF6C46A), Color(0xFFB8641A), Color(0xFF6E3608)],
          ).createShader(Rect.fromCircle(center: p, radius: r)),
      );
    }
    // İmame ve püskül
    final top = c + Offset(0, ry + r * 1.2);
    canvas.drawCircle(top, r * 1.2, Paint()..color = const Color(0xFF8A4A12));
    final tassel = Paint()
      ..color = const Color(0xFF7A1F1A)
      ..strokeWidth = 1.6
      ..strokeCap = StrokeCap.round;
    for (var k = -3; k <= 3; k++) {
      canvas.drawLine(top + Offset(0, r), top + Offset(k * 1.6, r * 4.2), tassel);
    }
  }

  @override
  bool shouldRepaint(_TesbihPainter oldDelegate) => false;
}
