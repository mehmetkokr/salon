import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'customization.dart';
import 'tokens.dart';
import 'widgets/coin_balance.dart';
import 'widgets/game_card.dart';
import 'widgets/game_pieces.dart';
import 'widgets/glass_panel.dart';
import 'widgets/navigation.dart';
import 'widgets/player_avatar.dart';
import 'widgets/salon_button.dart';
import 'widgets/selectables.dart';

/// Tasarım sistemi vitrini: renk paleti, bileşenler ve kişiselleştirme
/// seçenekleri tek sayfada. Çalıştırma: flutter run -t lib/main_design.dart
class DesignGalleryApp extends StatelessWidget {
  const DesignGalleryApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Salon · Tasarım sistemi',
      theme: AppTheme.salon,
      home: const _Gallery(),
    );
  }
}

class _Gallery extends StatefulWidget {
  const _Gallery();

  @override
  State<_Gallery> createState() => _GalleryState();
}

class _GalleryState extends State<_Gallery> {
  /// Örnek oyuncunun seviyesi: kilitli seçenekleri göstermek için.
  static const _playerLevel = 27;

  int _nav = 0;
  int _seg = 0;
  int _chips = 25400;
  bool _loading = false;
  int? _selectedTile;
  RoomBackground _room = RoomBackground.kizKulesi;
  RackStyle _rack = RackStyle.ceviz;
  DiceStyle _dice = DiceStyle.kehribar;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(Space.xxl, Space.lg, Space.xxl, Space.xxl),
          children: [
            Row(
              children: [
                Text('Salon · Tasarım sistemi', style: context.text.headlineSmall),
                const Spacer(),
                Text('Örnek oyuncu: Seviye $_playerLevel · Usta', style: context.text.bodySmall),
              ],
            ),
            _Section('Renk paleti · Gece kahvehanesi', children: [
              for (final (name, color) in [
                ('Zemin', c.background),
                ('Yüzey', c.surface),
                ('Yüzey 2', c.surfaceHigh),
                ('Çizgi', c.outline),
                ('Metin · fildişi', c.text),
                ('İkincil metin', c.textSecondary),
                ('Vurgu · altın', c.accent),
                ('İkincil · çini', c.secondary),
                ('Çip / ödül', c.reward),
                ('Başarı', c.success),
                ('Uyarı', c.warning),
                ('Hata', c.danger),
                ('Süre halkası', c.timer),
              ])
                _Swatch(name, color),
            ]),
            _Section('Yazı ölçeği (sistem yazı tipi, Dinamik Yazı ile büyür)', children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Salon · 34', style: context.text.displaySmall),
                  Text('Hoş geldin, Oyuncu_6399 · 24', style: context.text.headlineSmall),
                  Text('Okey / 101 Salonu · 20', style: context.text.titleLarge),
                  Text('Özel oda kur · 16', style: context.text.titleMedium),
                  Text('Masana isim ver, şifre koy, arkadaşlarını çağır. · 16', style: context.text.bodyLarge),
                  Text('Kazanana 3.000 çip · 12', style: context.text.bodySmall),
                ],
              ),
            ]),
            _Section('Butonlar (en az 44 pt, basınca küçülür ve titreşir)', children: [
              SalonButton(label: 'Hemen başla', icon: Icons.bolt_rounded, onPressed: () {}),
              SalonButton(
                  label: 'Özel oda kur',
                  icon: Icons.lock_outline_rounded,
                  kind: SalonButtonKind.secondary,
                  onPressed: () {}),
              SalonButton(label: 'Çifte git', icon: Icons.copy_rounded, kind: SalonButtonKind.glass, onPressed: () {}),
              SalonButton(label: 'Bitti', icon: Icons.check_rounded, kind: SalonButtonKind.success, onPressed: () {}),
              SalonButton(label: 'Masadan kalk', kind: SalonButtonKind.danger, compact: true, onPressed: () {}),
              SalonButton(
                label: 'Bekleme göster',
                loading: _loading,
                onPressed: () async {
                  setState(() => _loading = true);
                  await Future<void>.delayed(const Duration(seconds: 2));
                  if (mounted) setState(() => _loading = false);
                },
              ),
              const SalonButton(label: 'Sıra sende değil', onPressed: null),
            ]),
            _Section('Paneller ve etiketler', children: [
              SizedBox(
                width: 340,
                child: _PhotoBackdrop(
                  asset: _room.asset,
                  child: GlassPanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Cam panel', style: context.text.titleMedium),
                        const SizedBox(height: Space.xs),
                        Text('Fotoğrafın üstünde metin okunur kalır.', style: context.text.bodySmall),
                        const SizedBox(height: Space.md),
                        const Wrap(spacing: 6, children: [
                          SalonTag('Düz'),
                          SalonTag('Katlamalı'),
                          SalonTag('101'),
                          SalonTag('Yeni', highlight: true),
                        ]),
                      ],
                    ),
                  ),
                ),
              ),
              CoinBalance(value: _chips, onTap: () => setState(() => _chips += 500)),
              SalonSegmented(
                  options: const ['Okey', 'Tavla', 'Kart'], index: _seg, onChanged: (i) => setState(() => _seg = i)),
            ]),
            _Section('Okey taşları (dokununca seçilir)', children: [
              for (final (i, n, col) in [
                (0, 7, TileColor.red),
                (1, 8, TileColor.blue),
                (2, 9, TileColor.yellow),
                (3, 13, TileColor.black),
              ])
                GestureDetector(
                  onTap: () => setState(() => _selectedTile = _selectedTile == i ? null : i),
                  child: OkeyTile(number: n, color: col, width: 48, selected: _selectedTile == i),
                ),
              const OkeyTile(number: 5, color: TileColor.blue, width: 48, isOkey: true),
              const OkeyTile(isFalseJoker: true, width: 48),
              const OkeyTile(faceDown: true, width: 48),
            ]),
            const _Section('Kartlar ve tavla pulları (siyah / beyaz)', children: [
              PlayingCardView(rank: 'A', suit: CardSuit.hearts),
              PlayingCardView(rank: 'K', suit: CardSuit.spades),
              PlayingCardView(rank: 'J', suit: CardSuit.diamonds),
              PlayingCardView(rank: '10', suit: CardSuit.clubs),
              PlayingCardView(faceDown: true),
              SizedBox(width: Space.lg),
              Checker(),
              Checker(),
              Checker(white: false),
              Checker(white: false),
            ]),
            const _Section('Oyuncular', children: [
              _LabeledAvatar('Sırası gelen', _TurnDemo()),
              _LabeledAvatar(
                  'Bekliyor', PlayerAvatar(name: 'Can', level: 61, gradient: [Color(0xFF2FB68E), Color(0xFF11705A)])),
              _LabeledAvatar(
                  'Bağlantı yenileniyor',
                  PlayerAvatar(
                      name: 'Ahmet',
                      level: 12,
                      state: PlayerState.disconnected,
                      gradient: [Color(0xFFF09A4A), Color(0xFFA5521B)])),
              _LabeledAvatar(
                  'Bot oynuyor',
                  PlayerAvatar(
                      name: 'Merve',
                      level: 34,
                      state: PlayerState.bot,
                      gradient: [Color(0xFFE26D9A), Color(0xFF9A2E5C)])),
            ]),
            _Section('Kişiselleştirme 1 · Oda arka planı', children: [
              for (final r in RoomBackground.values)
                SelectableTile(
                  label: r.label,
                  selected: _room == r,
                  onTap: () => setState(() => _room = r),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(Radii.sm + 4),
                    child: Image.asset(r.asset, height: 86, width: double.infinity, fit: BoxFit.cover),
                  ),
                ),
            ]),
            _Section('Kişiselleştirme 2 · Istaka (seviyeyle açılır)', children: [
              for (final r in RackStyle.values)
                SelectableTile(
                  label: '${r.label} · ${r.rank}',
                  selected: _rack == r,
                  lockedUntilLevel: r.unlockedAt(_playerLevel) ? null : r.level,
                  onTap: () => setState(() => _rack = r),
                  child: Padding(padding: const EdgeInsets.symmetric(vertical: Space.sm), child: RackPreview(style: r)),
                ),
            ]),
            _Section('Kişiselleştirme 3 · Tavla zarı (seviyeyle açılır)', children: [
              for (final d in DiceStyle.values)
                SelectableTile(
                  label: '${d.label} · Sv. ${d.level}',
                  selected: _dice == d,
                  lockedUntilLevel: d.unlockedAt(_playerLevel) ? null : d.level,
                  onTap: () => setState(() => _dice = d),
                  width: 150,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: Space.md),
                    child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      DieFace(value: 5, style: d),
                      const SizedBox(width: Space.sm),
                      DieFace(value: 3, style: d),
                    ]),
                  ),
                ),
            ]),
            _Section('Oyun kartları (ana sayfa)', children: [
              SizedBox(
                height: 230,
                width: 900,
                child: Row(
                  children: [
                    Expanded(
                      child: GameCard(
                        title: 'Okey / 101 Salonu',
                        image: _room.asset,
                        tags: const ['Düz', 'Katlamalı', '101'],
                        pieces: const Row(children: [
                          OkeyTile(number: 5, color: TileColor.red, width: 30),
                          SizedBox(width: 3),
                          OkeyTile(number: 6, color: TileColor.red, width: 30),
                          SizedBox(width: 3),
                          OkeyTile(number: 7, color: TileColor.red, width: 30),
                        ]),
                        onTap: () {},
                      ),
                    ),
                    const SizedBox(width: Space.md),
                    Expanded(
                      child: GameCard(
                        title: 'Tavla Salonu',
                        image: RoomBackground.kapadokya.asset,
                        tags: const ['5 puanlık maç'],
                        pieces: Row(children: [
                          const Checker(size: 30),
                          const SizedBox(width: 4),
                          const Checker(white: false, size: 30),
                          const SizedBox(width: 6),
                          DieFace(value: 4, size: 30, style: _dice),
                        ]),
                        onTap: () {},
                      ),
                    ),
                    const SizedBox(width: Space.md),
                    Expanded(
                      child: GameCard(
                        title: 'Kart Oyunları',
                        image: RoomBackground.oludeniz.asset,
                        tags: const ['Batak', 'İhaleli', 'Pişti', 'King'],
                        pieces: const Row(children: [
                          PlayingCardView(rank: 'J', suit: CardSuit.clubs, width: 32),
                          SizedBox(width: 3),
                          PlayingCardView(rank: 'A', suit: CardSuit.hearts, width: 32),
                        ]),
                        onTap: () {},
                      ),
                    ),
                  ],
                ),
              ),
            ]),
            _Section('Alt menü', children: [
              SalonNavBar(
                items: const [
                  NavItem(Icons.home_rounded, 'Ana Sayfa'),
                  NavItem(Icons.people_alt_rounded, 'Arkadaşlar'),
                  NavItem(Icons.emoji_events_rounded, 'Liderlik'),
                  NavItem(Icons.storefront_rounded, 'Mağaza'),
                ],
                index: _nav,
                onChanged: (i) => setState(() => _nav = i),
              ),
            ]),
          ],
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.title, {required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: Space.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: context.text.titleMedium?.copyWith(color: context.salon.textSecondary)),
          const SizedBox(height: Space.md),
          Wrap(
              spacing: Space.md,
              runSpacing: Space.md,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: children),
        ],
      ),
    );
  }
}

class _Swatch extends StatelessWidget {
  const _Swatch(this.name, this.color);

  final String name;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 104,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: 44,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(Radii.sm),
              border: Border.all(color: context.salon.outline),
            ),
          ),
          const SizedBox(height: 4),
          Text(name, style: context.text.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }
}

class _LabeledAvatar extends StatelessWidget {
  const _LabeledAvatar(this.label, this.avatar);

  final String label;
  final Widget avatar;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 120,
      child: Column(children: [avatar, const SizedBox(height: Space.sm), Text(label, style: context.text.bodySmall)]),
    );
  }
}

/// Sıra süresi halkasını canlı gösterir: 15 sn’de dolar, son 5 sn’de kırmızı olur.
class _TurnDemo extends StatefulWidget {
  const _TurnDemo();

  @override
  State<_TurnDemo> createState() => _TurnDemoState();
}

class _TurnDemoState extends State<_TurnDemo> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 15))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) => PlayerAvatar(name: 'Mehmet', level: 27, state: PlayerState.turn, timeLeft: 1 - _c.value),
    );
  }
}

class _PhotoBackdrop extends StatelessWidget {
  const _PhotoBackdrop({required this.asset, required this.child});

  final String asset;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(Radii.card),
      child: Stack(
        children: [
          Positioned.fill(child: Image.asset(asset, fit: BoxFit.cover)),
          Padding(padding: const EdgeInsets.all(Space.lg), child: child),
        ],
      ),
    );
  }
}
