import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design/customization.dart';
import '../../core/design/tokens.dart';
import '../../core/design/widgets/coin_balance.dart';
import '../../core/design/widgets/empty_state.dart';
import '../../core/design/widgets/game_card.dart';
import '../../core/design/widgets/game_pieces.dart';
import '../../core/design/widgets/glass_panel.dart';
import '../../core/design/widgets/navigation.dart';
import '../../core/design/widgets/player_avatar.dart';
import '../../core/design/widgets/salon_button.dart';
import '../../core/services/nakama_service.dart';
import '../../core/services/service_providers.dart';
import '../settings/customization_providers.dart';
import '../cards/application/card_table_controller.dart';
import '../cards/presentation/card_game_screen.dart';
import '../okey/application/okey_table_controller.dart';
import '../okey/domain/okey_models.dart';
import '../okey/presentation/okey_table_screen.dart';
import '../okey/presentation/room_sheets.dart';
import '../tavla/application/tavla_controller.dart';
import '../tavla/presentation/tavla_screen.dart';
import '../profile/profile_controller.dart';
import 'widgets/entering_overlay.dart';
import 'widgets/sheets.dart';

/// Ana kabuk: arka planda seçili oda manzarası, üstte oyuncu ve cüzdan,
/// ortada seçili sekme, altta sabit menü.
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key, required this.user, this.intro = false});

  final SignedInUser user;

  /// Girişten hemen sonra mı açıldı? Öyleyse kısa yükleme geçişi gösterilir.
  final bool intro;

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _tab = 0;
  late bool _entering = widget.intro;
  Timer? _introTimer;

  static const _tabs = [
    NavItem(Icons.home_rounded, 'Ana Sayfa'),
    NavItem(Icons.people_alt_rounded, 'Arkadaşlar'),
    NavItem(Icons.emoji_events_rounded, 'Liderlik'),
    NavItem(Icons.storefront_rounded, 'Mağaza'),
  ];

  @override
  void initState() {
    super.initState();
    if (_entering) {
      _introTimer = Timer(const Duration(milliseconds: 1600), () {
        if (mounted) setState(() => _entering = false);
      });
    }
  }

  @override
  void dispose() {
    _introTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final custom = ref.watch(customizationProvider);
    final socket = ref.watch(socketStatusProvider).value ?? SocketStatus.connecting;
    final user = widget.user;
    ref.listen(profileProvider, (prev, next) {
      final p = next.value;
      if (prev?.value == null && p != null && p.justGranted > 0) {
        showSoon(context, 'Hoş geldin! ${formatChips(p.justGranted)} çip hesabına eklendi');
      }
    });

    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          // Arka plan: seçili oda, hafif bulanık ve karartılmış.
          AnimatedSwitcher(
            duration: Motion.of(context, Motion.slow),
            child: Image.asset(custom.room.asset, key: ValueKey(custom.room), fit: BoxFit.cover),
          ),
          BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
            child: ColoredBox(color: c.background.withValues(alpha: 0.62)),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(Space.xxl, Space.md, Space.xxl, 0),
              child: Column(
                children: [
                  _Header(user: user),
                  if (socket == SocketStatus.disconnected) const _ReconnectingBanner(),
                  const SizedBox(height: Space.md),
                  Expanded(
                    child: AnimatedSwitcher(
                      duration: Motion.of(context, Motion.base),
                      child: KeyedSubtree(key: ValueKey(_tab), child: _tabBody(user)),
                    ),
                  ),
                  const SizedBox(height: 74),
                ],
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: Space.md,
            child: SafeArea(
              top: false,
              child: Center(
                child: SalonNavBar(items: _tabs, index: _tab, onChanged: (i) => setState(() => _tab = i)),
              ),
            ),
          ),
          if (_entering) Positioned.fill(child: EnteringOverlay(dice: custom.dice)),
        ],
      ),
    );
  }

  Widget _tabBody(SignedInUser user) {
    switch (_tab) {
      case 1:
        return EmptyState(
          icon: Icons.person_add_alt_1_rounded,
          title: 'Arkadaşlarını Salon’a çağır',
          message: 'Arkadaşların burada görünür: çevrimiçi mi, hangi masada, kaçıncı elde.',
          actionLabel: 'Davet bağlantısı paylaş',
          onAction: () => showSoon(context, 'Davet bağlantısı bir sonraki adımda'),
        );
      case 2:
        return EmptyState(
          icon: Icons.emoji_events_outlined,
          title: 'Sıralaman ilk maçından sonra açılır',
          message: 'Günlük ve haftalık liderlik tablosunda okey, tavla ve kart oyunları ayrı ayrı sıralanır.',
          actionLabel: 'Hemen oyna',
          onAction: () => setState(() => _tab = 0),
        );
      case 3:
        return const _StoreTab();
      default:
        return _HomeTab(user: user);
    }
  }
}

class _Header extends ConsumerWidget {
  const _Header({required this.user});

  final SignedInUser user;

  Future<void> _claim(BuildContext context, WidgetRef ref) async {
    try {
      final got = await ref.read(profileProvider.notifier).claimDaily();
      if (context.mounted) {
        showSoon(context, got > 0 ? 'Günlük ödül: +${formatChips(got)} çip' : 'Bugünün ödülünü zaten aldın');
      }
    } catch (_) {
      if (context.mounted) showSoon(context, 'Ödül alınamadı. Bağlantını kontrol edip tekrar dene.');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.salon;
    final profile = ref.watch(profileProvider).value;
    final level = profile?.level ?? user.level;
    final chips = profile?.chips ?? user.chips;
    final daily = profile?.dailyAvailable ?? false;
    return Row(
      children: [
        // Dar ekranda ödül butonu da görünürken taşmasın: gerekirse ad kısalır.
        Flexible(
          child: Semantics(
            button: true,
            label: 'Profil: ${user.username}',
            child: GestureDetector(
              onTap: () => showSalonSheet<void>(context, builder: (_) => ProfileSheet(user: user)),
              child: Container(
                padding: const EdgeInsets.fromLTRB(4, 4, Space.lg, 4),
                decoration: BoxDecoration(
                  color: c.glass,
                  borderRadius: BorderRadius.circular(Radii.pill),
                  border: Border.all(color: c.glassBorder),
                ),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  PlayerAvatar(name: user.username, size: 42, level: level),
                  const SizedBox(width: Space.sm),
                  Flexible(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user.username,
                            style: context.text.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                        Text('Seviye $level${user.isGuest ? ' · Misafir' : ''}',
                            style: context.text.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                      ],
                    ),
                  ),
                ]),
              ),
            ),
          ),
        ),
        if (user.isGuest) ...[
          const SizedBox(width: Space.sm),
          SalonButton(
            label: 'Kaydet',
            // Günlük ödül butonu da görünürken telefon genişliğine sığsın diye ikon yok.
            icon: daily ? null : Icons.shield_outlined,
            kind: SalonButtonKind.glass,
            compact: true,
            onPressed: () => showSaveProfileSheet(context, user),
          ),
        ],
        const Spacer(),
        if (daily) ...[
          SalonButton(
            label: 'Ödül',
            icon: Icons.card_giftcard_rounded,
            kind: SalonButtonKind.glass,
            compact: true,
            onPressed: () => _claim(context, ref),
          ),
          const SizedBox(width: Space.sm),
        ],
        CoinBalance(value: chips, onTap: () => showSoon(context, 'Çip paketleri Mağaza sekmesinde')),
        const SizedBox(width: Space.sm),
        _RoundIcon(
          icon: Icons.notifications_none_rounded,
          label: daily ? 'Bildirimler, 1 yeni' : 'Bildirimler',
          badge: daily,
          onTap: () => showSalonSheet<void>(
            context,
            widthFactor: 0.5,
            builder: (sheetContext) => Padding(
              padding: const EdgeInsets.symmetric(vertical: Space.lg),
              child: daily
                  ? EmptyState(
                      icon: Icons.card_giftcard_rounded,
                      title: 'Günlük ödülün hazır',
                      message: 'Her gün 500 çip. Yeni ödül Türkiye saatiyle gece yarısı açılır.',
                      actionLabel: 'Ödülü al',
                      onAction: () {
                        Navigator.pop(sheetContext);
                        _claim(context, ref);
                      },
                    )
                  : const EmptyState(
                      icon: Icons.notifications_none_rounded,
                      title: 'Yeni bildirim yok',
                      message: 'Masa davetleri, ödüller ve turnuva haberleri burada görünür.',
                    ),
            ),
          ),
        ),
        const SizedBox(width: Space.sm),
        _RoundIcon(
          icon: Icons.settings_rounded,
          label: 'Ayarlar',
          onTap: () => showSalonSheet<void>(context, widthFactor: 0.85, builder: (_) => SettingsSheet(user: user)),
        ),
      ],
    );
  }
}

class _RoundIcon extends StatelessWidget {
  const _RoundIcon({required this.icon, required this.label, required this.onTap, this.badge = false});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  /// Sağ üstte kırmızı nokta: okunmamış bildirim.
  final bool badge;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: c.glass,
        shape: CircleBorder(side: BorderSide(color: c.glassBorder)),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox.square(
            dimension: kMinTap,
            child: Stack(alignment: Alignment.center, children: [
              Icon(icon, color: c.text, size: 22),
              if (badge)
                Positioned(
                  top: 9,
                  right: 10,
                  child: Container(
                    width: 9,
                    height: 9,
                    decoration: BoxDecoration(
                      color: c.danger,
                      shape: BoxShape.circle,
                      border: Border.all(color: c.background, width: 1.5),
                    ),
                  ),
                ),
            ]),
          ),
        ),
      ),
    );
  }
}

class _ReconnectingBanner extends StatelessWidget {
  const _ReconnectingBanner();

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return Padding(
      padding: const EdgeInsets.only(top: Space.sm),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.sm),
        decoration:
            BoxDecoration(color: c.warning.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(Radii.control)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.wifi_off_rounded, size: 18, color: c.warning),
          const SizedBox(width: Space.sm),
          Text('Bağlantı yenileniyor…', style: context.text.labelMedium?.copyWith(color: c.warning)),
        ]),
      ),
    );
  }
}

class _HomeTab extends ConsumerWidget {
  const _HomeTab({required this.user});

  final SignedInUser user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final custom = ref.watch(customizationProvider);
    void open(
      String title,
      List<String> modes, {
      int playableModes = 0,
      ValueChanged<int>? onQuickStart,
      ValueChanged<int>? onPrivateRoom,
      VoidCallback? onJoinWithCode,
    }) =>
        showSalonSheet<void>(
          context,
          builder: (_) => GameChoiceSheet(
            title: title,
            modes: modes,
            playableModes: playableModes,
            onQuickStart: onQuickStart,
            onPrivateRoom: onPrivateRoom,
            onJoinWithCode: onJoinWithCode,
          ),
        );
    void openOkeyTable([OkeyEntry entry = const QuickEntry()]) =>
        Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => OkeyTableScreen(entry: entry)));
    // Kart oyunu seçimi: (sunucudaki oyun, tür, oda etiketi)
    const cardGames = [
      ('pisti', null, 'Pişti · 101 puan'),
      ('batak', 'koz', 'Batak · koz maça'),
      ('batak', 'ihaleli', 'İhaleli batak'),
      ('batak', 'esli', 'Eşli batak'),
      ('king', null, 'King · 20 oyun'),
    ];
    void openCards(CardEntry entry) =>
        Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => CardGameScreen(entry: entry)));
    void openTavla([TavlaEntry entry = const TavlaQuick()]) =>
        Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TavlaScreen(entry: entry)));
    void createRoom(String tag, void Function(String name, int bet, String? pin) onCreate) => showSalonSheet<void>(
          context,
          widthFactor: 0.86,
          maxWidth: double.infinity,
          builder: (sheet) => CreateRoomSheet(
              tag: tag,
              onCreate: (name, bet, pin) {
                Navigator.pop(sheet);
                onCreate(name, bet, pin);
              }),
        );
    void openCreateRoom(OkeyMode mode) => createRoom(
          mode.label,
          (name, bet, pin) => openOkeyTable(CreateRoomEntry(name: name, bet: bet, pin: pin, mode: mode)),
        );
    void joinRoom(ValueChanged<String> onJoin) => showSalonSheet<void>(
          context,
          widthFactor: 0.55,
          builder: (sheet) => JoinRoomSheet(onJoin: (code) {
            Navigator.pop(sheet);
            onJoin(code);
          }),
        );
    void openJoinRoom() => joinRoom((code) => openOkeyTable(JoinRoomEntry(code: code)));

    return Column(
      children: [
        Expanded(
          child: LayoutBuilder(
            builder: (context, box) {
              final w = (box.maxWidth - Space.md * 2) / 3;
              return ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  SizedBox(
                    width: w,
                    child: GameCard(
                      title: 'Okey / 101 Salonu',
                      image: custom.room.asset,
                      tags: const ['Düz', 'Katlamalı', '101'],
                      pieces: const Row(children: [
                        OkeyTile(number: 5, color: TileColor.red, width: 30),
                        SizedBox(width: 3),
                        OkeyTile(number: 6, color: TileColor.red, width: 30),
                        SizedBox(width: 3),
                        OkeyTile(number: 7, color: TileColor.red, width: 30),
                      ]),
                      onTap: () => open('Okey / 101 Salonu', const ['Düz', 'Katlamalı', '101'],
                          playableModes: 3,
                          onQuickStart: (i) => openOkeyTable(QuickEntry(mode: OkeyMode.values[i])),
                          onPrivateRoom: (i) => openCreateRoom(OkeyMode.values[i]),
                          onJoinWithCode: openJoinRoom),
                    ),
                  ),
                  const SizedBox(width: Space.md),
                  SizedBox(
                    width: w,
                    child: GameCard(
                      title: 'Tavla Salonu',
                      image: RoomBackground.kapadokya.asset,
                      tags: const ['5 puanlık maç'],
                      pieces: Row(children: [
                        const Checker(size: 30),
                        const SizedBox(width: 4),
                        const Checker(white: false, size: 30),
                        const SizedBox(width: 6),
                        DieFace(value: 4, size: 30, style: custom.dice),
                      ]),
                      onTap: () => open(
                        'Tavla Salonu',
                        const ['5 puanlık maç'],
                        onQuickStart: (_) => openTavla(),
                        onPrivateRoom: (_) => createRoom(
                          'Tavla · 5 puan',
                          (name, bet, pin) => openTavla(TavlaCreate(name: name, bet: bet, pin: pin)),
                        ),
                        onJoinWithCode: () => joinRoom((code) => openTavla(TavlaJoin(code: code))),
                      ),
                    ),
                  ),
                  const SizedBox(width: Space.md),
                  SizedBox(
                    width: w,
                    child: GameCard(
                      title: 'Kart Oyunları',
                      image: RoomBackground.oludeniz.asset,
                      tags: const ['Pişti', 'Batak', 'İhaleli', 'Eşli', 'King'],
                      pieces: const Row(children: [
                        PlayingCardView(rank: 'J', suit: CardSuit.clubs, width: 32),
                        SizedBox(width: 3),
                        PlayingCardView(rank: 'A', suit: CardSuit.hearts, width: 32),
                      ]),
                      onTap: () => open(
                        'Kart Oyunları',
                        const ['Pişti', 'Batak', 'İhaleli', 'Eşli', 'King'],
                        playableModes: 5,
                        onQuickStart: (i) => openCards(CardQuick(game: cardGames[i].$1, mode: cardGames[i].$2)),
                        onPrivateRoom: (i) => createRoom(
                          cardGames[i].$3,
                          (name, bet, pin) => openCards(
                              CardCreate(game: cardGames[i].$1, mode: cardGames[i].$2, name: name, bet: bet, pin: pin)),
                        ),
                        onJoinWithCode: () => joinRoom((code) => openCards(CardJoin(code: code))),
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}

/// Mağaza: sadece çip paketleri. Istaka ve zar seviyeyle açılır, satılmaz.
class _StoreTab extends StatelessWidget {
  const _StoreTab();

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    const packs = [(10000, '₺29,99'), (50000, '₺119,99'), (150000, '₺299,99'), (500000, '₺799,99')];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Çip paketleri', style: context.text.titleLarge),
        const SizedBox(height: Space.xs),
        Text('Istaka ve zarlar satılmaz, seviye atladıkça açılır. Oyunda avantaj sağlayan hiçbir şey satılmaz.',
            style: context.text.bodySmall),
        const SizedBox(height: Space.md),
        Expanded(
          child: Row(
            children: [
              for (final (amount, price) in packs)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(right: Space.md),
                    child: GlassPanel(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Spacer(),
                          const ChipCoin(size: 44),
                          const SizedBox(height: Space.sm),
                          Text(formatChips(amount), style: context.text.headlineSmall?.copyWith(color: c.reward)),
                          Text('çip', style: context.text.bodySmall),
                          const Spacer(),
                          SalonButton(
                            label: price,
                            compact: true,
                            expand: true,
                            onPressed: () =>
                                showSoon(context, 'Satın alma App Store / Google Play bağlantısıyla gelecek'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
