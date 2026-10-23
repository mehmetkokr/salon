import 'dart:convert';

/// Sunucudan gelen oyuncu durumu: çip, seviye, XP ve günlük ödül.
/// Bu değerleri sadece sunucu değiştirir; uygulama gösterir.
class PlayerProfile {
  const PlayerProfile({
    required this.chips,
    required this.level,
    required this.xp,
    required this.xpNeed,
    required this.dailyAvailable,
    required this.dailyNextAt,
    this.justGranted = 0,
  });

  final int chips;
  final int level;
  final int xp;
  final int xpNeed;
  final bool dailyAvailable;
  final DateTime dailyNextAt;

  /// Bu çağrıda verilen çip (hoş geldin veya günlük ödül), yoksa 0.
  final int justGranted;

  double get levelProgress => xpNeed == 0 ? 0 : (xp / xpNeed).clamp(0, 1).toDouble();

  factory PlayerProfile.fromJson(String json) {
    final m = jsonDecode(json) as Map<String, dynamic>;
    final daily = (m['daily'] as Map<String, dynamic>?) ?? const {};
    int asInt(Object? v) => v is num ? v.toInt() : 0;
    return PlayerProfile(
      chips: asInt(m['chips']),
      level: asInt(m['level']).clamp(1, 1 << 20),
      xp: asInt(m['xp']),
      xpNeed: asInt(m['xpNeed']),
      dailyAvailable: daily['available'] == true,
      dailyNextAt: DateTime.fromMillisecondsSinceEpoch(asInt(daily['nextAt'])),
      justGranted: asInt(m['welcomeGranted']) + asInt(m['granted']),
    );
  }
}
