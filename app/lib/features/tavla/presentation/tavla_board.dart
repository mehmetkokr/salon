import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/design/tokens.dart';
import '../application/tavla_controller.dart';
import '../domain/tavla_models.dart';
import 'tavla_scene.dart';

/// Kahvehane tavlası: ceviz çerçeve, açık ceviz yüzey, her yarıda pirinç
/// kakma yıldız, nar kırmızısı ve fildişi haneler, ortada menteşeli bar.
/// Ekran bunu perspektifle (oyuncunun oturduğu yerden) eğik gösterir.
///
/// Oyuncu tahtaya hep kendi evinden bakar: ev sağ altta (1..6 beyaz için).
/// Siyah oynayan için haneler aynalanır (görünen d → gerçek 25 − d).
/// Düzen (görünen haneler): üst sıra 13..18 | bar | 19..24, alt sıra
/// 12..7 | bar | 6..1; en sağda toplama yuvası.
class TavlaBoard extends StatelessWidget {
  const TavlaBoard({
    super.key,
    required this.table,
    required this.selected,
    required this.targets,
    required this.onTapPoint,
    required this.onTapBar,
    required this.onTapOff,
    this.center,
  });

  final TavlaState table;
  final int? selected;
  final List<TavlaStep> targets;
  final ValueChanged<int> onTapPoint;
  final VoidCallback onTapBar;
  final VoidCallback onTapOff;

  /// Sağ yarının üstünde gösterilen içerik (atılan zarlar, "Zar at").
  final Widget? center;

  int _real(int display) => table.you == 0 ? display : 25 - display;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, box) {
      final outerW = box.maxWidth;
      final outerH = box.maxHeight;
      // Çerçeve kalınlığı; iç alan: 12 hane + bar (0.8) + toplama (1.1)
      final frame = math.max(10.0, outerH * 0.045);
      final w = outerW - frame * 2;
      final h = outerH - frame * 2;
      final col = w / 13.9;
      final barW = col * 0.8;
      final offW = col * 1.1;
      final half = h / 2;
      final checker = math.min(col * 0.9, (half - 8) / 5.2);
      final me = table.you;
      final opp = table.opponent;
      final last = table.lastMoves?.seat == opp ? table.lastMoves!.moves : const <TavlaStep>[];
      final lastFrom = {
        for (final m in last)
          if (m.from != null) m.from!
      };
      final lastTo = {
        for (final m in last)
          if (m.to != null) m.to!
      };
      final targetPoints = {
        for (final m in targets)
          if (m.to != null) m.to!
      };
      final canOff = targets.any((m) => m.to == null);

      double xOf(int slot) => slot < 6 ? slot * col : barW + slot * col; // slot 0..11 soldan sağa

      final children = <Widget>[
        // Yüzey: iki yarı, her birinde kakma yıldız
        Positioned(left: 0, top: 0, width: 6 * col, height: h, child: const _Surface()),
        Positioned(left: 6 * col + barW, top: 0, width: 6 * col, height: h, child: const _Surface()),
      ];
      for (var slot = 0; slot < 12; slot++) {
        for (final top in [true, false]) {
          final display = top ? 13 + slot : 12 - slot;
          final point = _real(display);
          final whiteHere = table.board.countOf(0, point);
          final blackHere = table.board.countOf(1, point);
          final count = whiteHere + blackHere;
          final isWhite = whiteHere > 0;
          final mine = table.board.countOf(me, point) > 0;
          children.add(Positioned(
            left: xOf(slot),
            top: top ? 0 : half,
            width: col,
            height: half,
            child: _PointColumn(
              top: top,
              red: slot.isEven,
              count: count,
              white: isWhite,
              checker: checker,
              selected: selected == point,
              target: targetPoints.contains(point),
              lastFrom: lastFrom.contains(point),
              lastTo: lastTo.contains(point),
              semantics: 'Hane $display'
                  '${count > 0 ? ', $count ${isWhite ? 'beyaz' : 'siyah'} pul' : ', boş'}'
                  '${mine && table.legal.any((m) => m.from == point) ? ', oynatmak için dokun' : ''}'
                  '${targetPoints.contains(point) ? ', buraya oynayabilirsin' : ''}',
              onTap: () => onTapPoint(point),
            ),
          ));
        }
      }

      // Bar: menteşeli ceviz şerit; rakibin kırık pulları üstte, benimkiler altta.
      children.add(Positioned(
        left: 6 * col,
        top: 0,
        width: barW,
        height: h,
        child: _Bar(
          mine: table.board.bar[me],
          theirs: table.board.bar[opp],
          meWhite: me == 0,
          checker: math.min(barW * 0.92, checker),
          selected: selected == tavlaBar,
          onTap: onTapBar,
        ),
      ));

      // Toplama yuvası: rakip üstte, ben altta.
      children.add(Positioned(
        left: 12 * col + barW,
        top: 0,
        width: offW,
        height: h,
        child: _OffTray(
          mine: table.board.off[me],
          theirs: table.board.off[opp],
          meWhite: me == 0,
          target: canOff,
          onTap: onTapOff,
        ),
      ));

      if (center != null) {
        children.add(Positioned(left: 6 * col + barW, top: 0, width: 6 * col, height: h, child: center!));
      }

      return Container(
        padding: EdgeInsets.all(frame),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(frame * 0.9),
          gradient: const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [TavlaWood.frameDark, TavlaWood.frameLight, TavlaWood.frameDark],
            stops: [0, 0.55, 1],
          ),
          boxShadow: const [
            BoxShadow(color: Color(0xAA000000), blurRadius: 28, offset: Offset(0, 18)),
          ],
        ),
        child: DecoratedBox(
          // İç kenarda gölge: yüzey çerçevenin içine gömülü görünsün
          position: DecorationPosition.foreground,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: const Color(0x66000000), width: 2),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: Stack(clipBehavior: Clip.none, children: children),
          ),
        ),
      );
    });
  }
}

/// Oyun yüzeyinin bir yarısı: açık ceviz, damarlar ve ortada pirinç yıldız.
class _Surface extends StatelessWidget {
  const _Surface();

  @override
  Widget build(BuildContext context) => const RepaintBoundary(child: CustomPaint(painter: _SurfacePainter()));
}

class _SurfacePainter extends CustomPainter {
  const _SurfacePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = const RadialGradient(
          radius: 0.9,
          colors: [TavlaWood.surface, TavlaWood.surfaceDeep],
        ).createShader(rect),
    );
    final grain = Paint()
      ..color = const Color(0x18000000)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    for (var i = 0; i < 18; i++) {
      final x = size.width * (i + 0.5) / 18;
      final path = Path()..moveTo(x, 0);
      for (var y = 0.0; y <= size.height; y += size.height / 10) {
        path.lineTo(x + math.sin(y / 30 + i * 1.7) * 2.5, y);
      }
      canvas.drawPath(path, grain);
    }
    // Sekiz kollu kakma yıldız
    final c = rect.center;
    final r = math.min(size.width, size.height) * 0.14;
    final star = Path();
    for (var k = 0; k < 16; k++) {
      final a = -math.pi / 2 + k * math.pi / 8;
      final rr = k.isEven ? r : r * 0.45;
      final p = c + Offset(math.cos(a) * rr, math.sin(a) * rr);
      if (k == 0) {
        star.moveTo(p.dx, p.dy);
      } else {
        star.lineTo(p.dx, p.dy);
      }
    }
    star.close();
    canvas.drawPath(star, Paint()..color = TavlaWood.brass.withValues(alpha: 0.55));
    canvas.drawPath(
      star,
      Paint()
        ..color = const Color(0x55000000)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
  }

  @override
  bool shouldRepaint(_SurfacePainter oldDelegate) => false;
}

class _PointColumn extends StatelessWidget {
  const _PointColumn({
    required this.top,
    required this.red,
    required this.count,
    required this.white,
    required this.checker,
    required this.selected,
    required this.target,
    required this.lastFrom,
    required this.lastTo,
    required this.semantics,
    required this.onTap,
  });

  final bool top;
  final bool red;
  final int count;
  final bool white;
  final double checker;
  final bool selected;
  final bool target;
  final bool lastFrom;
  final bool lastTo;
  final String semantics;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final shown = math.min(count, 5);
    final step = checker * 0.94;
    return Semantics(
      button: true,
      label: semantics,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Stack(clipBehavior: Clip.none, children: [
          Positioned.fill(
            child: CustomPaint(
              painter: _TrianglePainter(
                top: top,
                red: red,
                glow: target,
                outline: lastTo ? 0.75 : (lastFrom ? 0.35 : 0),
              ),
            ),
          ),
          for (var i = 0; i < shown; i++)
            Positioned(
              left: 0,
              right: 0,
              top: top ? 2 + i * step : null,
              bottom: top ? null : 2 + i * step,
              child: Center(
                child: Checker3D(
                  white: white,
                  size: checker,
                  lifted: selected && i == shown - 1,
                ),
              ),
            ),
          if (count > 5)
            Positioned(
              left: 0,
              right: 0,
              top: top ? 2 + 4 * step : null,
              bottom: top ? null : 2 + 4 * step,
              height: checker,
              child: Center(
                child: Text(
                  '$count',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: checker * 0.4,
                    color: white ? const Color(0xFF2A1A0F) : const Color(0xFFF3E7CF),
                  ),
                ),
              ),
            ),
        ]),
      ),
    );
  }
}

class _TrianglePainter extends CustomPainter {
  _TrianglePainter({required this.top, required this.red, required this.glow, required this.outline});

  final bool top;
  final bool red;
  final bool glow;

  /// Rakibin son hamlesi: 0 yok, 0.35 çıktığı hane, 0.75 vardığı hane.
  final double outline;

  @override
  void paint(Canvas canvas, Size size) {
    final inset = size.width * 0.08;
    final tip = size.height * 0.88;
    final path = Path();
    if (top) {
      path
        ..moveTo(inset, 0)
        ..lineTo(size.width - inset, 0)
        ..lineTo(size.width / 2, tip)
        ..close();
    } else {
      path
        ..moveTo(inset, size.height)
        ..lineTo(size.width - inset, size.height)
        ..lineTo(size.width / 2, size.height - tip)
        ..close();
    }
    final base = red ? TavlaWood.pointRed : TavlaWood.pointCream;
    final shade = Color.lerp(base, Colors.black, 0.25)!;
    canvas.drawPath(
      path,
      Paint()
        ..shader = LinearGradient(
          begin: top ? Alignment.topCenter : Alignment.bottomCenter,
          end: top ? Alignment.bottomCenter : Alignment.topCenter,
          colors: [shade, base],
        ).createShader(Offset.zero & size),
    );
    if (glow) {
      canvas.drawPath(
        path,
        Paint()
          ..color = TavlaWood.brass
          ..style = PaintingStyle.stroke
          ..strokeWidth = 3
          ..maskFilter = const MaskFilter.blur(BlurStyle.solid, 3),
      );
    } else if (outline > 0) {
      canvas.drawPath(
        path,
        Paint()
          ..color = Colors.white.withValues(alpha: outline)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5,
      );
    }
  }

  @override
  bool shouldRepaint(_TrianglePainter old) =>
      old.red != red || old.glow != glow || old.outline != outline || old.top != top;
}

/// Kalınlığı görünen pul: alt kenar (yan yüz), üst yüz, pirinç kenar, oluk.
class Checker3D extends StatelessWidget {
  const Checker3D({super.key, required this.white, required this.size, this.lifted = false});

  final bool white;
  final double size;

  /// Seçili pul: hafif kalkık ve ışıklı.
  final bool lifted;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: white ? 'Beyaz pul' : 'Siyah pul',
      child: AnimatedSlide(
        offset: lifted ? const Offset(0, -0.12) : Offset.zero,
        duration: Motion.of(context, Motion.fast),
        curve: Motion.curve,
        child: CustomPaint(size: Size.square(size), painter: _CheckerPainter(white: white, lifted: lifted)),
      ),
    );
  }
}

class _CheckerPainter extends CustomPainter {
  _CheckerPainter({required this.white, required this.lifted});

  final bool white;
  final bool lifted;

  @override
  void paint(Canvas canvas, Size s) {
    final d = s.width;
    final thick = d * 0.13;
    final face = Rect.fromLTWH(0, 0, d, d - thick);
    final side = face.shift(Offset(0, thick));
    final top = white ? const Color(0xFFF3E9D4) : const Color(0xFF221A16);
    final edge = white ? const Color(0xFFBFAE8E) : const Color(0xFF0E0A08);
    // Gölge ve yan yüz
    canvas.drawOval(side.shift(Offset(d * 0.04, d * 0.05)), Paint()..color = const Color(0x77000000));
    canvas.drawOval(side, Paint()..color = edge);
    canvas.drawRect(Rect.fromLTRB(0, face.center.dy, d, side.center.dy), Paint()..color = edge);
    // Üst yüz
    canvas.drawOval(
      face,
      Paint()
        ..shader = RadialGradient(
          center: const Alignment(-0.35, -0.4),
          colors: [Color.lerp(top, Colors.white, white ? 0.5 : 0.18)!, top],
        ).createShader(face),
    );
    // Pirinç kenar ve iç oluk
    canvas.drawOval(
      face.deflate(d * 0.04),
      Paint()
        ..color = lifted ? const Color(0xFFF2D27A) : TavlaWood.brass
        ..style = PaintingStyle.stroke
        ..strokeWidth = d * 0.06,
    );
    canvas.drawOval(
      face.deflate(d * 0.2),
      Paint()
        ..color = (white ? Colors.black : Colors.white).withValues(alpha: 0.12)
        ..style = PaintingStyle.stroke
        ..strokeWidth = d * 0.03,
    );
    if (lifted) {
      canvas.drawOval(
        face.inflate(d * 0.05),
        Paint()
          ..color = TavlaWood.lamp.withValues(alpha: 0.55)
          ..style = PaintingStyle.stroke
          ..strokeWidth = d * 0.05
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4),
      );
    }
  }

  @override
  bool shouldRepaint(_CheckerPainter old) => old.white != white || old.lifted != lifted;
}

class _Bar extends StatelessWidget {
  const _Bar({
    required this.mine,
    required this.theirs,
    required this.meWhite,
    required this.checker,
    required this.selected,
    required this.onTap,
  });

  final int mine;
  final int theirs;
  final bool meWhite;
  final double checker;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    Widget stack(int n, bool white, bool lift) => Column(mainAxisSize: MainAxisSize.min, children: [
          if (n > 0) Checker3D(white: white, size: checker, lifted: lift),
          if (n > 1)
            Text('×$n', style: const TextStyle(color: Color(0xFFF3E7CF), fontWeight: FontWeight.w700, fontSize: 12)),
        ]);
    Widget hinge() => Container(
          width: checker * 0.7,
          height: 6,
          decoration: BoxDecoration(
            color: TavlaWood.brass,
            borderRadius: BorderRadius.circular(2),
            boxShadow: const [BoxShadow(color: Color(0x88000000), blurRadius: 2, offset: Offset(0, 1))],
          ),
        );
    return Semantics(
      button: mine > 0,
      label: 'Kırık pullar: senin $mine, rakibin $theirs',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [TavlaWood.frameDark, TavlaWood.frameLight, TavlaWood.frameDark],
            ),
          ),
          child: Stack(alignment: Alignment.center, children: [
            Positioned(
                top: 0,
                bottom: 0,
                child: Center(
                    child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [hinge(), SizedBox(height: checker * 2.2), hinge()]))),
            Column(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Padding(padding: const EdgeInsets.only(top: Space.sm), child: stack(theirs, !meWhite, false)),
              Padding(padding: const EdgeInsets.only(bottom: Space.sm), child: stack(mine, meWhite, selected)),
            ]),
          ]),
        ),
      ),
    );
  }
}

class _OffTray extends StatelessWidget {
  const _OffTray(
      {required this.mine, required this.theirs, required this.meWhite, required this.target, required this.onTap});

  final int mine;
  final int theirs;
  final bool meWhite;
  final bool target;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Toplanan pullar yuvada yan yatmış durur: ince şeritler.
    Widget tray(int n, bool white, bool fromTop) => Expanded(
          child: Container(
            margin: const EdgeInsets.all(3),
            padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFF2A1A0F),
              borderRadius: BorderRadius.circular(4),
              border: Border.all(color: const Color(0x55000000)),
            ),
            child: Column(
              mainAxisAlignment: fromTop ? MainAxisAlignment.start : MainAxisAlignment.end,
              children: [
                for (var i = 0; i < math.min(n, 15); i++)
                  Container(
                    height: 3.2,
                    margin: const EdgeInsets.symmetric(vertical: 0.6),
                    decoration: BoxDecoration(
                      color: white ? const Color(0xFFF3E9D4) : const Color(0xFF221A16),
                      borderRadius: BorderRadius.circular(2),
                      border: Border.all(color: TavlaWood.brass.withValues(alpha: 0.7), width: 0.6),
                    ),
                  ),
              ],
            ),
          ),
        );
    return Semantics(
      button: target,
      label: 'Toplanan pullar: senin $mine, rakibin $theirs${target ? ', toplamak için dokun' : ''}',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: AnimatedContainer(
          duration: Motion.of(context, Motion.fast),
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [TavlaWood.frameDark, TavlaWood.frameLight]),
            boxShadow: target ? [BoxShadow(color: TavlaWood.brass.withValues(alpha: 0.7), blurRadius: 14)] : null,
          ),
          child: Column(children: [tray(theirs, !meWhite, true), tray(mine, meWhite, false)]),
        ),
      ),
    );
  }
}
