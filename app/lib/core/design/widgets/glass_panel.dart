import 'dart:ui';

import 'package:flutter/material.dart';

import '../tokens.dart';

/// Arkasını bulanıklaştıran cam panel. Fotoğraflı arka planların üstünde
/// metnin okunmasını sağlar.
class GlassPanel extends StatelessWidget {
  const GlassPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(Space.lg),
    this.radius = Radii.card,
    this.blur = 18,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final double blur;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            color: c.glass,
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(color: c.glassBorder),
          ),
          child: child,
        ),
      ),
    );
  }
}

/// Küçük etiket: "Düz", "Katlamalı", "Yeni" gibi.
class SalonTag extends StatelessWidget {
  const SalonTag(this.label, {super.key, this.highlight = false, this.onPhoto = false});

  final String label;
  final bool highlight;

  /// Fotoğraf üstünde kullanılıyorsa beyaz yarı saydam stil.
  final bool onPhoto;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final bg = highlight
        ? c.accent
        : onPhoto
            ? Colors.white.withValues(alpha: 0.18)
            : c.surfaceHigh;
    final fg = highlight
        ? c.onAccent
        : onPhoto
            ? Colors.white
            : c.textSecondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(Radii.sm),
        border: onPhoto ? Border.all(color: Colors.white.withValues(alpha: 0.3)) : null,
      ),
      child: Text(label, style: context.text.labelSmall?.copyWith(color: fg)),
    );
  }
}
