import 'package:flutter/material.dart';

import '../../core/design/tokens.dart';
import '../../core/design/widgets/salon_logo.dart';

/// Açılış: logo hafifçe büyüyerek belirir, üstünden parlama geçer,
/// ardından “Salon” yazısı aşağıdan kayarak yerleşir. Toplam ~1,5 sn.
/// “Hareketi azalt” açıksa animasyonsuz gösterilir.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, required this.onFinished, this.waiting = false});

  final VoidCallback onFinished;

  /// Animasyon bitti ama oturum hâlâ yükleniyorsa küçük bir bekleme yazısı.
  final bool waiting;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1500));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_c.isAnimating || _c.isCompleted) return;
    if (MediaQuery.of(context).disableAnimations) {
      _c.value = 1;
      WidgetsBinding.instance.addPostFrameCallback((_) => widget.onFinished());
    } else {
      _c.forward().whenComplete(widget.onFinished);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final logoIn = CurvedAnimation(parent: _c, curve: const Interval(0, 0.5, curve: Curves.easeOutBack));
    final shine = CurvedAnimation(parent: _c, curve: const Interval(0.3, 0.75, curve: Curves.easeInOut));
    final nameIn = CurvedAnimation(parent: _c, curve: const Interval(0.5, 0.95, curve: Curves.easeOutCubic));

    return Scaffold(
      body: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(radius: 1.1, colors: [c.surfaceHigh, c.background]),
        ),
        child: Center(
          child: AnimatedBuilder(
            animation: _c,
            builder: (context, _) => Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Opacity(
                  opacity: logoIn.value.clamp(0, 1),
                  child: Transform.scale(
                    scale: 0.82 + 0.18 * logoIn.value,
                    child: ShaderMask(
                      blendMode: BlendMode.srcATop,
                      shaderCallback: (rect) {
                        final x = -0.6 + 2.2 * shine.value;
                        return LinearGradient(
                          begin: Alignment(x - 0.35, -1),
                          end: Alignment(x + 0.35, 1),
                          colors: [Colors.transparent, Colors.white.withValues(alpha: 0.55), Colors.transparent],
                        ).createShader(rect);
                      },
                      child: const SalonLogo(size: 128),
                    ),
                  ),
                ),
                const SizedBox(height: Space.lg),
                Opacity(
                  opacity: nameIn.value,
                  child: Transform.translate(
                    offset: Offset(0, 16 * (1 - nameIn.value)),
                    child: Text('Salon', style: context.text.displaySmall?.copyWith(letterSpacing: 1)),
                  ),
                ),
                const SizedBox(height: Space.sm),
                AnimatedOpacity(
                  opacity: widget.waiting && _c.isCompleted ? 1 : 0,
                  duration: Motion.of(context, Motion.slow),
                  child: Text('Salonlar hazırlanıyor…', style: context.text.bodySmall),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
