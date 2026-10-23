import 'package:flutter/painting.dart';

/// Kullanıcının kişiselleştirebildiği şeyler sadece bunlar:
/// oda arka planı (salon manzarası), ıstaka ve tavla zarı.
/// Uygulamanın renkleri sabittir.

/// Oda arka planı: Türkiye’nin gerçek manzaraları.
enum RoomBackground {
  kizKulesi('Kız Kulesi', 'assets/backgrounds/kiz-kulesi-aksam.jpg'),
  kizKulesiGunduz('Kız Kulesi · Gündüz', 'assets/backgrounds/kiz-kulesi-gunduz.jpg'),
  kapadokya('Kapadokya', 'assets/backgrounds/kapadokya.jpg'),
  pamukkale('Pamukkale', 'assets/backgrounds/pamukkale.jpg'),
  oludeniz('Ölüdeniz', 'assets/backgrounds/oludeniz.jpg'),
  uzungol('Uzungöl', 'assets/backgrounds/uzungol.jpg');

  const RoomBackground(this.label, this.asset);
  final String label;
  final String asset;
}

/// Okey ıstakası. Seviye yükseldikçe yenisi açılır; açılan eskiler de seçilebilir.
enum RackStyle {
  cam('Çam', 1, 'Acemi', Color(0xFFC9A574), Color(0xFFE8CB9C)),
  gurgen('Klasik gürgen', 10, 'Kahvehane', Color(0xFF8A5A36), Color(0xFFC08A5F)),
  ceviz('Ceviz', 25, 'Usta', Color(0xFF5E3820), Color(0xFF9A6A45)),
  sedef('Sedef kakma', 50, 'Üstat', Color(0xFF3A1D12), Color(0xFFF3ECDD)),
  altin('Altın işlemeli', 100, 'Efsane', Color(0xFF151515), Color(0xFFD4AF37));

  const RackStyle(this.label, this.level, this.rank, this.wood, this.trim);
  final String label;
  final int level;

  /// Bu ıstakayı açan unvan.
  final String rank;
  final Color wood;

  /// Raf kenarı / süsleme rengi.
  final Color trim;

  bool unlockedAt(int playerLevel) => playerLevel >= level;
}

/// Tavla zarı. Istaka gibi seviyeyle açılır.
enum DiceStyle {
  klasik('Klasik beyaz', 1, Color(0xFFFFFFFF), Color(0xFF1A1A1A), Color(0xFFD8D2C4)),
  fildisi('Fildişi', 10, Color(0xFFF3EAD3), Color(0xFF6E1A1A), Color(0xFFD9CBAA)),
  kehribar('Kehribar', 25, Color(0xFFE9A23B), Color(0xFF3B2106), Color(0xFFB8741C)),
  cini('Çini mavisi', 50, Color(0xFF1C5E8C), Color(0xFFF3EEE3), Color(0xFF113F60)),
  altin('Altın', 100, Color(0xFFE7C35A), Color(0xFF3B2A06), Color(0xFFB08A2A));

  const DiceStyle(this.label, this.level, this.face, this.pip, this.edge);
  final String label;
  final int level;
  final Color face;
  final Color pip;
  final Color edge;

  bool unlockedAt(int playerLevel) => playerLevel >= level;
}
