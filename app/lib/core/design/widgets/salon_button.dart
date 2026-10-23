import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../tokens.dart';

enum SalonButtonKind { primary, secondary, glass, success, danger }

/// Uygulamanın tek buton bileşeni. Basınca hafifçe küçülür ve titreşir;
/// [loading] iken yerine dönen gösterge gelir ve tekrar basılamaz.
class SalonButton extends StatefulWidget {
  const SalonButton({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.kind = SalonButtonKind.primary,
    this.loading = false,
    this.compact = false,
    this.expand = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final SalonButtonKind kind;
  final bool loading;

  /// 44 pt yükseklik; dar alanlar için. Normal yükseklik 52 pt.
  final bool compact;
  final bool expand;

  @override
  State<SalonButton> createState() => _SalonButtonState();
}

class _SalonButtonState extends State<SalonButton> {
  bool _down = false;

  bool get _enabled => widget.onPressed != null && !widget.loading;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final (bg, fg, border) = switch (widget.kind) {
      SalonButtonKind.primary => (c.accent, c.onAccent, Colors.transparent),
      SalonButtonKind.secondary => (c.surface, c.text, c.outline),
      SalonButtonKind.glass => (c.glass, c.text, c.glassBorder),
      SalonButtonKind.success => (c.success, Colors.white, Colors.transparent),
      SalonButtonKind.danger => (c.danger, Colors.white, Colors.transparent),
    };
    final height = widget.compact ? kMinTap : 52.0;
    final child = widget.loading
        ? Row(mainAxisSize: MainAxisSize.min, children: [
            SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.2, color: fg)),
          ])
        : Row(
            mainAxisSize: widget.expand ? MainAxisSize.max : MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (widget.icon != null) ...[Icon(widget.icon, size: 20, color: fg), const SizedBox(width: Space.sm)],
              Flexible(
                child: Text(widget.label,
                    overflow: TextOverflow.ellipsis, style: context.text.labelLarge?.copyWith(color: fg)),
              ),
            ],
          );

    return Semantics(
      button: true,
      enabled: _enabled,
      label: widget.label,
      child: GestureDetector(
        onTapDown: _enabled ? (_) => setState(() => _down = true) : null,
        onTapCancel: () => setState(() => _down = false),
        onTapUp: _enabled
            ? (_) {
                setState(() => _down = false);
                HapticFeedback.selectionClick();
                widget.onPressed!();
              }
            : null,
        child: AnimatedScale(
          scale: _down ? 0.96 : 1,
          duration: Motion.of(context, Motion.fast),
          curve: Motion.curve,
          child: AnimatedOpacity(
            opacity: _enabled || widget.loading ? 1 : 0.45,
            duration: Motion.of(context, Motion.base),
            child: Container(
              height: height,
              width: widget.expand ? double.infinity : null,
              constraints: const BoxConstraints(minWidth: kMinTap),
              padding: EdgeInsets.symmetric(horizontal: widget.compact ? Space.lg : Space.xl),
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(Radii.control),
                border: Border.all(color: border),
                boxShadow: widget.kind == SalonButtonKind.primary || widget.kind == SalonButtonKind.success
                    ? [BoxShadow(color: bg.withValues(alpha: 0.35), blurRadius: 14, offset: const Offset(0, 6))]
                    : null,
              ),
              child: widget.expand ? Center(child: child) : child,
            ),
          ),
        ),
      ),
    );
  }
}
