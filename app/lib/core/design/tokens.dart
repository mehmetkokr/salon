import 'package:flutter/material.dart';

/// Salon tasarım sistemi: boşluk, köşe, süre ve gölge ölçüleri.
/// Ekranlar sabit sayı yazmaz, buradaki değerleri kullanır.
abstract final class Space {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
}

abstract final class Radii {
  static const sm = 8.0;
  static const control = 14.0;
  static const card = 20.0;
  static const sheet = 26.0;
  static const pill = 999.0;
}

/// Hareket süreleri. "Hareketi azalt" açıksa [Motion.of] sıfır döner.
abstract final class Motion {
  static const fast = Duration(milliseconds: 120);
  static const base = Duration(milliseconds: 220);
  static const slow = Duration(milliseconds: 380);
  static const curve = Curves.easeOutCubic;
  static const spring = Curves.easeOutBack;

  static Duration of(BuildContext context, Duration d) => MediaQuery.of(context).disableAnimations ? Duration.zero : d;
}

/// Erişilebilir en küçük dokunma alanı (Apple: 44 pt).
const kMinTap = 44.0;

/// Okey taşı renkleri. Her renk ayrıca bir şekille eşleşir; renk körü
/// oyuncular taşları şekilden ayırt eder.
enum TileColor {
  red(Color(0xFFC8262C), '●', 'Kırmızı'),
  blue(Color(0xFF1F5FC4), '▲', 'Mavi'),
  yellow(Color(0xFFC27D0A), '■', 'Sarı'),
  black(Color(0xFF16181D), '◆', 'Siyah');

  const TileColor(this.color, this.shape, this.label);
  final Color color;
  final String shape;
  final String label;
}

/// Uygulamanın renkleri. `Theme.of(context).extension<SalonColors>()!`
/// veya kısaca `context.salon` ile okunur.
@immutable
class SalonColors extends ThemeExtension<SalonColors> {
  const SalonColors({
    required this.background,
    required this.surface,
    required this.surfaceHigh,
    required this.glass,
    required this.glassBorder,
    required this.outline,
    required this.text,
    required this.textSecondary,
    required this.accent,
    required this.onAccent,
    required this.secondary,
    required this.reward,
    required this.success,
    required this.warning,
    required this.danger,
    required this.timer,
    required this.scrim,
  });

  final Color background;
  final Color surface;
  final Color surfaceHigh;
  final Color glass;
  final Color glassBorder;
  final Color outline;
  final Color text;
  final Color textSecondary;
  final Color accent;
  final Color onAccent;

  /// Çini turkuazı: bilgi, seçili durumlar, ikincil vurgu.
  final Color secondary;

  /// Çip ve ödüller.
  final Color reward;
  final Color success;
  final Color warning;
  final Color danger;

  /// Sıra süresi halkası.
  final Color timer;
  final Color scrim;

  /// Salon’un tek renk paleti: “Gece kahvehanesi”.
  ///
  /// Gece yarısı petrol mavisi zemin, sıcak fildişi metin, altın vurgu ve
  /// İznik çinisinden turkuaz. Fotoğraflı salonlarla ve ahşap ıstakalarla
  /// uyumlu; uzun oyunlarda göz yormaz. Kullanıcı tema seçmez.
  static const salon = SalonColors(
    background: Color(0xFF0B1418),
    surface: Color(0xFF13222A),
    surfaceHigh: Color(0xFF1B2E37),
    glass: Color(0xB813222A),
    glassBorder: Color(0x2EF3EEE3),
    outline: Color(0xFF274049),
    text: Color(0xFFF3EEE3),
    textSecondary: Color(0xFF9FB4B6),
    accent: Color(0xFFE0B04A),
    onAccent: Color(0xFF1A1205),
    secondary: Color(0xFF2EB5A5),
    reward: Color(0xFFF0C25A),
    success: Color(0xFF3CC48A),
    warning: Color(0xFFF2A04A),
    danger: Color(0xFFFF6B6B),
    timer: Color(0xFF4FD6C6),
    scrim: Color(0xA6050B0E),
  );

  @override
  SalonColors copyWith() => this;

  @override
  SalonColors lerp(SalonColors? other, double t) {
    if (other == null) return this;
    Color l(Color a, Color b) => Color.lerp(a, b, t)!;
    return SalonColors(
      background: l(background, other.background),
      surface: l(surface, other.surface),
      surfaceHigh: l(surfaceHigh, other.surfaceHigh),
      glass: l(glass, other.glass),
      glassBorder: l(glassBorder, other.glassBorder),
      outline: l(outline, other.outline),
      text: l(text, other.text),
      textSecondary: l(textSecondary, other.textSecondary),
      accent: l(accent, other.accent),
      onAccent: l(onAccent, other.onAccent),
      secondary: l(secondary, other.secondary),
      reward: l(reward, other.reward),
      success: l(success, other.success),
      warning: l(warning, other.warning),
      danger: l(danger, other.danger),
      timer: l(timer, other.timer),
      scrim: l(scrim, other.scrim),
    );
  }
}

extension SalonThemeX on BuildContext {
  SalonColors get salon => Theme.of(this).extension<SalonColors>()!;
  TextTheme get text => Theme.of(this).textTheme;
}

/// Yazı ölçeği. Sistem yazı tipi kullanılır (iOS’ta SF Pro, Android’de Roboto)
/// ve Dinamik Yazı ayarına uyar.
TextTheme salonTextTheme(Color text, Color secondary) {
  const tabular = [FontFeature.tabularFigures()];
  return TextTheme(
    displaySmall: TextStyle(fontSize: 34, fontWeight: FontWeight.w700, height: 1.1, letterSpacing: -0.5, color: text),
    headlineSmall: TextStyle(fontSize: 24, fontWeight: FontWeight.w600, height: 1.2, letterSpacing: -0.2, color: text),
    titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, height: 1.25, color: text),
    titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, height: 1.3, color: text),
    bodyLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w400, height: 1.4, color: text),
    bodyMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.w400, height: 1.4, color: text),
    bodySmall: TextStyle(fontSize: 12, fontWeight: FontWeight.w400, height: 1.35, color: secondary),
    labelLarge: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, height: 1.2, color: text),
    labelMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, height: 1.2, color: text, fontFeatures: tabular),
    labelSmall: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, height: 1.2, color: secondary, letterSpacing: 0.2),
  );
}
