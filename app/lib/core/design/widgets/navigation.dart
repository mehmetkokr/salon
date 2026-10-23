import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../tokens.dart';

class NavItem {
  const NavItem(this.icon, this.label);
  final IconData icon;
  final String label;
}

/// Alt menü: Ana Sayfa, Arkadaşlar, Liderlik, Mağaza. Cam görünümlü, ortada yüzer.
class SalonNavBar extends StatelessWidget {
  const SalonNavBar({super.key, required this.items, required this.index, required this.onChanged});

  final List<NavItem> items;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return ClipRRect(
      borderRadius: BorderRadius.circular(Radii.card),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: Container(
          padding: const EdgeInsets.all(Space.xs),
          decoration: BoxDecoration(
            color: c.glass,
            borderRadius: BorderRadius.circular(Radii.card),
            border: Border.all(color: c.glassBorder),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (var i = 0; i < items.length; i++)
                Semantics(
                  selected: i == index,
                  button: true,
                  label: items[i].label,
                  child: GestureDetector(
                    onTap: () {
                      HapticFeedback.selectionClick();
                      onChanged(i);
                    },
                    child: AnimatedContainer(
                      duration: Motion.of(context, Motion.base),
                      curve: Motion.curve,
                      width: 100,
                      height: 50,
                      decoration: BoxDecoration(
                        color: i == index ? c.accent.withValues(alpha: 0.16) : Colors.transparent,
                        borderRadius: BorderRadius.circular(Radii.control),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(items[i].icon, size: 22, color: i == index ? c.accent : c.textSecondary),
                          const SizedBox(height: 2),
                          Text(items[i].label,
                              style: context.text.labelSmall?.copyWith(color: i == index ? c.accent : c.textSecondary)),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Bölümlü seçici: "Günlük | Haftalık", "Okey | Tavla | Kart".
class SalonSegmented extends StatelessWidget {
  const SalonSegmented({super.key, required this.options, required this.index, required this.onChanged});

  final List<String> options;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: c.outline),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < options.length; i++)
            Semantics(
              selected: i == index,
              button: true,
              child: GestureDetector(
                onTap: () => onChanged(i),
                child: AnimatedContainer(
                  duration: Motion.of(context, Motion.base),
                  curve: Motion.curve,
                  constraints: const BoxConstraints(minHeight: 38, minWidth: 72),
                  padding: const EdgeInsets.symmetric(horizontal: Space.md),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: i == index ? c.surfaceHigh : Colors.transparent,
                    borderRadius: BorderRadius.circular(Radii.control - 3),
                  ),
                  child: Text(options[i],
                      style: context.text.labelMedium?.copyWith(color: i == index ? c.text : c.textSecondary)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
