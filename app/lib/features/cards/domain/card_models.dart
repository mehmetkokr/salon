import '../../../core/design/widgets/game_pieces.dart';
import '../../okey/domain/okey_models.dart' show OkeyRoomInfo;

/// Oyun kartı. Sunucuda renk 0 maça, 1 kupa, 2 karo, 3 sinek; değer 2..14 (14 as).
class CardData {
  const CardData({required this.id, required this.suit, required this.rank});

  final int id;
  final CardSuit suit;
  final int rank;

  factory CardData.fromJson(Map<String, dynamic> j) => CardData(
        id: (j['id'] as num).toInt(),
        suit: CardSuit.values[(j['s'] as num).toInt()],
        rank: (j['r'] as num).toInt(),
      );

  /// Kartın üstünde yazan: A, K, Q, J, 10…2.
  String get face => switch (rank) {
        14 => 'A',
        13 => 'K',
        12 => 'Q',
        11 => 'J',
        _ => '$rank',
      };

  /// Ekran okuyucu için: “kupa papaz”.
  String get spoken => '${suit.label} ${switch (rank) {
        14 => 'as',
        13 => 'papaz',
        12 => 'kız',
        11 => 'vale',
        _ => '$rank',
      }}';

  @override
  bool operator ==(Object other) => other is CardData && other.id == id;

  @override
  int get hashCode => id;
}

class CardSeat {
  const CardSeat(
      {required this.name,
      required this.level,
      required this.isBot,
      required this.connected,
      required this.autoPlaying});

  final String name;
  final int level;
  final bool isBot;
  final bool connected;
  final bool autoPlaying;

  factory CardSeat.fromJson(Map<String, dynamic> j) => CardSeat(
        name: j['name'] as String? ?? '',
        level: (j['level'] as num?)?.toInt() ?? 1,
        isBot: j['bot'] == 1,
        connected: j['connected'] == 1,
        autoPlaying: j['auto'] == 1,
      );
}

enum CardPhase { waiting, playing, finished }

/// Bütün kart oyunlarının ortak masa durumu. Oyuna özgü kısım [g] içindedir.
class CardTableState {
  const CardTableState({
    required this.game,
    required this.mode,
    required this.phase,
    required this.bet,
    required this.pot,
    required this.you,
    required this.seats,
    required this.turn,
    required this.turnEndsAt,
    required this.turnMs,
    required this.fillAt,
    required this.nextHandAt,
    required this.handNo,
    required this.result,
    required this.room,
    required this.g,
  });

  final String game;
  final String mode;
  final CardPhase phase;
  final int bet;
  final int pot;
  final int you;
  final List<CardSeat?> seats;
  final int turn;
  final DateTime? turnEndsAt;
  final int turnMs;
  final DateTime? fillAt;
  final DateTime? nextHandAt;
  final int handNo;

  /// El sonucu (oyuna özgü alanlar + gameOver, winners, payouts).
  final Map<String, dynamic>? result;
  final OkeyRoomInfo? room;

  /// Oyuna özgü görünüm (pişti: el, yer…).
  final Map<String, dynamic> g;

  bool get isMyTurn => phase == CardPhase.playing && turn == you;
  bool get isHost => room != null && room!.hostSeat == you;
  bool get gameOver => result?['gameOver'] == true;
  List<int> get payouts => [for (final p in (result?['payouts'] as List? ?? const [])) (p as num).toInt()];

  factory CardTableState.fromJson(Map<String, dynamic> j, {DateTime? receivedAt}) {
    final local = (receivedAt ?? DateTime.now()).millisecondsSinceEpoch;
    final offset = ((j['serverNow'] as num?)?.toInt() ?? local) - local;
    DateTime? at(Object? v) {
      final ms = (v as num?)?.toInt() ?? 0;
      return ms <= 0 ? null : DateTime.fromMillisecondsSinceEpoch(ms - offset);
    }

    return CardTableState(
      game: j['game'] as String? ?? '',
      mode: j['mode'] as String? ?? '',
      phase: switch (j['phase']) {
        'playing' => CardPhase.playing,
        'finished' => CardPhase.finished,
        _ => CardPhase.waiting,
      },
      bet: (j['bet'] as num?)?.toInt() ?? 0,
      pot: (j['pot'] as num?)?.toInt() ?? 0,
      you: (j['you'] as num?)?.toInt() ?? 0,
      seats: [
        for (final s in (j['seats'] as List? ?? const []))
          s == null ? null : CardSeat.fromJson(s as Map<String, dynamic>)
      ],
      turn: (j['turn'] as num?)?.toInt() ?? 0,
      turnEndsAt: at(j['turnEndsAt']),
      turnMs: (j['turnMs'] as num?)?.toInt() ?? 20000,
      fillAt: at(j['fillAt']),
      nextHandAt: at(j['nextHandAt']),
      handNo: (j['handNo'] as num?)?.toInt() ?? 0,
      result: j['result'] as Map<String, dynamic>?,
      room: j['room'] == null ? null : OkeyRoomInfo.fromJson(j['room'] as Map<String, dynamic>),
      g: j['g'] as Map<String, dynamic>? ?? const {},
    );
  }
}

List<CardData> cardsOf(Object? list) =>
    [for (final c in (list as List? ?? const [])) CardData.fromJson(c as Map<String, dynamic>)];

List<int> intsOf(Object? list) => [for (final x in (list as List? ?? const [])) (x as num).toInt()];
