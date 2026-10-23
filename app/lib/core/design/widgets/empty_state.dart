import 'package:flutter/material.dart';

import '../tokens.dart';
import 'glass_panel.dart';
import 'salon_button.dart';

/// Boş ekran yerine ne yapılacağını söyleyen davet: simge, başlık,
/// tek cümle açıklama ve bir buton.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 440),
        child: GlassPanel(
          padding: const EdgeInsets.all(Space.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(color: c.secondary.withValues(alpha: 0.16), shape: BoxShape.circle),
                child: Icon(icon, color: c.secondary, size: 28),
              ),
              const SizedBox(height: Space.md),
              Text(title, style: context.text.titleLarge, textAlign: TextAlign.center),
              const SizedBox(height: Space.xs),
              Text(message,
                  style: context.text.bodyMedium?.copyWith(color: c.textSecondary), textAlign: TextAlign.center),
              if (actionLabel != null) ...[
                const SizedBox(height: Space.lg),
                SalonButton(label: actionLabel!, onPressed: onAction),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
