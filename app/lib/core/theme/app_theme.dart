import 'package:flutter/material.dart';

import '../design/tokens.dart';

/// Salon’un tek teması. Kullanıcı renk seçmez; sadece oda arka planı,
/// ıstaka ve tavla zarı kişiselleştirilir.
abstract final class AppTheme {
  static ThemeData get salon {
    const c = SalonColors.salon;
    final scheme = ColorScheme.dark(
      primary: c.accent,
      onPrimary: c.onAccent,
      secondary: c.secondary,
      onSecondary: c.background,
      error: c.danger,
      onError: c.background,
      surface: c.surface,
      onSurface: c.text,
      onSurfaceVariant: c.textSecondary,
      surfaceContainerHighest: c.surfaceHigh,
      outline: c.outline,
    );
    const shape = RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(Radii.control)));
    const minSize = Size(kMinTap, 48);
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: scheme,
      scaffoldBackgroundColor: c.background,
      textTheme: salonTextTheme(c.text, c.textSecondary),
      extensions: const [c],
      filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: minSize, shape: shape)),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: minSize,
          shape: shape,
          foregroundColor: c.text,
          side: BorderSide(color: c.outline),
        ),
      ),
      textButtonTheme:
          TextButtonThemeData(style: TextButton.styleFrom(minimumSize: minSize, foregroundColor: c.accent)),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }
}
