import '../../../core/design/tokens.dart';

/// Sunucudan gelen okey taşı. Sahte okeyin rengi ve sayısı yoktur.
class OkeyTileData {
  const OkeyTileData({required this.id, required this.color, required this.number});

  final int id;
  final TileColor? color;
  final int number;

  bool get isFake => color == null;

  factory OkeyTileData.fromJson(Map<String, dynamic> j) {
    final c = (j['c'] as num).toInt();
    return OkeyTileData(
      id: (j['id'] as num).toInt(),
      color: c < 0 ? null : TileColor.values[c],
      number: (j['n'] as num).toInt(),
    );
  }

  /// Elde sayıldığı değer: sahte okey okeyin yerine geçer.
  (TileColor, int) valueWith(TileColor okeyColor, int okeyNumber) =>
      isFake ? (okeyColor, okeyNumber) : (color!, number);

  @override
  bool operator ==(Object other) => other is OkeyTileData && other.id == id;

  @override
  int get hashCode => id;
}

class OkeySeatView {
  const OkeySeatView({
    required this.name,
    required this.level,
    required this.isBot,
    required this.connected,
    required this.autoPlaying,
    required this.tileCount,
    required this.discardTop,
    required this.discardCount,
  });

  final String name;
  final int level;
  final bool isBot;
  final bool connected;

  /// Süresi üst üste doldu ya da bağlantısı koptu; sunucu onun yerine oynuyor.
  final bool autoPlaying;
  final int tileCount;
  final OkeyTileData? discardTop;
  final int discardCount;

  factory OkeySeatView.fromJson(Map<String, dynamic> j) => OkeySeatView(
        name: j['name'] as String? ?? '',
        level: (j['level'] as num?)?.toInt() ?? 1,
        isBot: j['bot'] == 1,
        connected: j['connected'] == 1,
        autoPlaying: j['auto'] == 1,
        tileCount: (j['count'] as num?)?.toInt() ?? 0,
        discardTop: j['discardTop'] == null ? null : OkeyTileData.fromJson(j['discardTop'] as Map<String, dynamic>),
        discardCount: (j['discardCount'] as num?)?.toInt() ?? 0,
      );
}

enum OkeyPhase { waiting, playing, finished }

/// Okey türü. `wire` sunucudaki adıdır.
enum OkeyMode {
  duz('duz', 'Düz okey'),
  katlamali('katlamali', 'Katlamalı okey'),
  yuzbir('101', '101 okey');

  const OkeyMode(this.wire, this.label);
  final String wire;
  final String label;

  static OkeyMode parse(Object? v) => values.firstWhere((m) => m.wire == v, orElse: () => duz);
}

/// 101: masaya açılmış bir per.
class OkeyMeldView {
  const OkeyMeldView({required this.owner, required this.kind, required this.value, required this.tiles});

  final int owner;

  /// 'run', 'set' ya da 'pair'.
  final String kind;
  final int value;
  final List<OkeyTileData> tiles;

  factory OkeyMeldView.fromJson(Map<String, dynamic> j) => OkeyMeldView(
        owner: (j['owner'] as num).toInt(),
        kind: j['kind'] as String? ?? 'run',
        value: (j['value'] as num?)?.toInt() ?? 0,
        tiles: [for (final t in j['tiles'] as List) OkeyTileData.fromJson(t as Map<String, dynamic>)],
      );
}

/// 101'e özgü masa bilgileri.
class Okey101View {
  const Okey101View({
    required this.melds,
    required this.opened,
    required this.totals,
    required this.hands,
    required this.sideTile,
    required this.extra,
  });

  final List<OkeyMeldView> melds;

  /// Koltuk başına: 0 açmadı, 1 per ile açtı, 2 çift ile açtı.
  final List<int> opened;

  /// Oyun boyunca toplanan cezalar (düşük olan iyi).
  final List<int> totals;
  final int hands;

  /// Bu tur yandan aldığım ve kullanmam gereken taş.
  final int? sideTile;

  /// Bu elde yazılan ek cezam (işlek taş, yandan alıp kullanmama).
  final int extra;

  bool openedBy(int seat) => seat < opened.length && opened[seat] > 0;

  factory Okey101View.fromJson(Map<String, dynamic> j) => Okey101View(
        melds: [for (final m in (j['melds'] as List? ?? const [])) OkeyMeldView.fromJson(m as Map<String, dynamic>)],
        opened: [for (final o in (j['opened'] as List? ?? const [])) (o as num).toInt()],
        totals: [
          for (final t in (j['totals'] as List? ?? const [0, 0, 0, 0])) (t as num).toInt()
        ],
        hands: (j['hands'] as num?)?.toInt() ?? 5,
        sideTile: (j['sideTile'] as num?)?.toInt(),
        extra: (j['extra'] as num?)?.toInt() ?? 0,
      );
}

/// Özel odanın bilgileri. Hızlı oyun masasında yoktur.
class OkeyRoomInfo {
  const OkeyRoomInfo({required this.name, required this.code, required this.locked, required this.hostSeat});

  final String name;
  final String code;

  /// 4 haneli şifreyle korunuyor.
  final bool locked;

  /// Oda sahibinin koltuğu (-1: henüz yok).
  final int hostSeat;

  factory OkeyRoomInfo.fromJson(Map<String, dynamic> j) => OkeyRoomInfo(
        name: j['name'] as String? ?? '',
        code: j['code'] as String? ?? '',
        locked: j['locked'] == 1,
        hostSeat: (j['host'] as num?)?.toInt() ?? -1,
      );
}

enum OkeyStage { draw, discard }

class OkeyResult {
  const OkeyResult({
    required this.isDraw,
    required this.winner,
    required this.kind,
    required this.okeyFinish,
    required this.finishTile,
    required this.hand,
    required this.payouts,
    this.scoreDeltas,
    this.gameOver = true,
    this.gameWinners = const [],
    this.penalties,
    this.elden = false,
  });

  /// 101: bu elin cezaları (biten −101 ya da −202).
  final List<int>? penalties;

  /// 101: aynı turda açıp bitti (cezalar katlandı).
  final bool elden;

  /// Katlamalı: bu elde koltuk başına puan değişimi.
  final List<int>? scoreDeltas;

  /// Oyun (ve pot) bitti mi? Düz okeyde her el bir oyundur.
  final bool gameOver;

  /// Katlamalı oyun sonunda en yüksek puanlı koltuk(lar).
  final List<int> gameWinners;

  /// Deste bitti, kimse bitiremedi: bahisler iade edildi.
  final bool isDraw;
  final int winner;

  /// 'seri' ya da 'cift'.
  final String? kind;
  final bool okeyFinish;
  final OkeyTileData? finishTile;
  final List<OkeyTileData> hand;

  /// Koltuk sırasıyla çip değişimi.
  final List<int> payouts;

  factory OkeyResult.fromJson(Map<String, dynamic> j) => OkeyResult(
        isDraw: j['reason'] == 'draw',
        winner: (j['winner'] as num?)?.toInt() ?? -1,
        kind: j['kind'] as String?,
        okeyFinish: j['okeyFinish'] == 1,
        finishTile: j['finishTile'] == null ? null : OkeyTileData.fromJson(j['finishTile'] as Map<String, dynamic>),
        hand: [for (final t in (j['hand'] as List? ?? const [])) OkeyTileData.fromJson(t as Map<String, dynamic>)],
        payouts: [for (final p in (j['payouts'] as List? ?? const [])) (p as num).toInt()],
        scoreDeltas: j['scoreDeltas'] == null ? null : [for (final d in j['scoreDeltas'] as List) (d as num).toInt()],
        gameOver: j['gameOver'] != 0,
        gameWinners: [for (final w in (j['gameWinners'] as List? ?? const [])) (w as num).toInt()],
        penalties: j['penalties'] == null ? null : [for (final p in j['penalties'] as List) (p as num).toInt()],
        elden: j['elden'] == 1,
      );
}

/// Bir oyuncunun gördüğü masa. Başkalarının eli ve deste gizlidir.
class OkeyTableState {
  const OkeyTableState({
    required this.phase,
    required this.bet,
    required this.pot,
    required this.you,
    required this.seats,
    required this.turn,
    required this.stage,
    required this.turnEndsAt,
    required this.fillAt,
    required this.stockCount,
    required this.indicator,
    required this.okeyColor,
    required this.okeyNumber,
    required this.hand,
    required this.lastDrawn,
    required this.result,
    this.room,
    this.mode = OkeyMode.duz,
    this.scores,
    this.handNo = 1,
    this.nextHandAt,
    this.canShowIndicator = false,
    this.turnMs = 20000,
    this.o101,
  });

  /// Hamle süresi (101'de daha uzun).
  final int turnMs;
  final Okey101View? o101;

  bool get is101 => mode == OkeyMode.yuzbir;

  final OkeyPhase phase;
  final OkeyMode mode;

  /// Katlamalı: koltuk sırasıyla puanlar (düzde null).
  final List<int>? scores;
  final int handNo;

  /// Katlamalı hızlı masada sonraki elin açılacağı an.
  final DateTime? nextHandAt;

  /// İlk turumda elimde göstergenin eşi var: gösterebilirim.
  final bool canShowIndicator;
  final int bet;
  final int pot;

  /// Benim koltuğum (0..3).
  final int you;
  final List<OkeySeatView?> seats;
  final int turn;
  final OkeyStage stage;

  /// Cihaz saatine çevrilmiş süre sonu.
  final DateTime? turnEndsAt;
  final DateTime? fillAt;
  final int stockCount;
  final OkeyTileData? indicator;
  final TileColor? okeyColor;
  final int? okeyNumber;
  final List<OkeyTileData> hand;
  final int? lastDrawn;
  final OkeyResult? result;
  final OkeyRoomInfo? room;

  /// Özel odada eli ben başlatırım.
  bool get isHost => room != null && room!.hostSeat == you;

  bool get isMyTurn => phase == OkeyPhase.playing && turn == you;
  bool get canDraw => isMyTurn && stage == OkeyStage.draw;
  bool get canDiscard => isMyTurn && stage == OkeyStage.discard;

  /// Benden önceki oyuncu: attığı taşı alabilirim.
  int get previousSeat => (you + 3) % 4;

  /// Ekrandaki konuma göre koltuk: 0 ben, 1 sağ (sonraki), 2 karşı, 3 sol (önceki).
  int seatAt(int position) => (you + position) % 4;

  bool isOkey(OkeyTileData t) => !t.isFake && t.color == okeyColor && t.number == okeyNumber;

  /// `receivedAt` cihaz saatine göre, sunucu saatiyle aradaki fark düzeltilir.
  factory OkeyTableState.fromJson(Map<String, dynamic> j, {DateTime? receivedAt}) {
    final local = (receivedAt ?? DateTime.now()).millisecondsSinceEpoch;
    final offset = ((j['serverNow'] as num?)?.toInt() ?? local) - local;
    DateTime? at(Object? v) {
      final ms = (v as num?)?.toInt() ?? 0;
      return ms <= 0 ? null : DateTime.fromMillisecondsSinceEpoch(ms - offset);
    }

    final okey = j['okey'] as Map<String, dynamic>?;
    return OkeyTableState(
      phase: switch (j['phase']) {
        'playing' => OkeyPhase.playing,
        'finished' => OkeyPhase.finished,
        _ => OkeyPhase.waiting,
      },
      bet: (j['bet'] as num?)?.toInt() ?? 0,
      pot: (j['pot'] as num?)?.toInt() ?? 0,
      you: (j['you'] as num?)?.toInt() ?? 0,
      seats: [
        for (final s in (j['seats'] as List? ?? const [null, null, null, null]))
          s == null ? null : OkeySeatView.fromJson(s as Map<String, dynamic>),
      ],
      turn: (j['turn'] as num?)?.toInt() ?? -1,
      stage: j['stage'] == 'discard' ? OkeyStage.discard : OkeyStage.draw,
      turnEndsAt: at(j['turnEndsAt']),
      fillAt: at(j['fillAt']),
      stockCount: (j['stockCount'] as num?)?.toInt() ?? 0,
      indicator: j['indicator'] == null ? null : OkeyTileData.fromJson(j['indicator'] as Map<String, dynamic>),
      okeyColor: okey == null ? null : TileColor.values[(okey['c'] as num).toInt()],
      okeyNumber: okey == null ? null : (okey['n'] as num).toInt(),
      hand: [for (final t in (j['hand'] as List? ?? const [])) OkeyTileData.fromJson(t as Map<String, dynamic>)],
      lastDrawn: (j['lastDrawn'] as num?)?.toInt(),
      result: j['result'] == null ? null : OkeyResult.fromJson(j['result'] as Map<String, dynamic>),
      room: j['room'] == null ? null : OkeyRoomInfo.fromJson(j['room'] as Map<String, dynamic>),
      mode: OkeyMode.parse(j['mode']),
      scores: j['scores'] == null ? null : [for (final s in j['scores'] as List) (s as num).toInt()],
      handNo: (j['handNo'] as num?)?.toInt() ?? 1,
      nextHandAt: at(j['nextHandAt']),
      canShowIndicator: j['canShow'] == 1,
      turnMs: (j['turnMs'] as num?)?.toInt() ?? 20000,
      o101: j['o101'] == null ? null : Okey101View.fromJson(j['o101'] as Map<String, dynamic>),
    );
  }
}
