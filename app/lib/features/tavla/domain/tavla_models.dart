import '../../okey/domain/okey_models.dart' show OkeyRoomInfo;

/// Tek adımlık pul hamlesi. `from == null` kırık pul (bar), `to == null` toplama.
class TavlaStep {
  const TavlaStep({required this.from, required this.to, required this.die});

  final int? from;
  final int? to;
  final int die;

  factory TavlaStep.fromJson(Map<String, dynamic> j) => TavlaStep(
        from: j['from'] == 'bar' ? null : (j['from'] as num).toInt(),
        to: j['to'] == 'off' ? null : (j['to'] as num).toInt(),
        die: (j['die'] as num?)?.toInt() ?? 0,
      );

  Map<String, Object?> toMove() => {'from': from ?? 'bar', 'to': to ?? 'off'};
}

/// Tahta: points[1..24] (>0 beyaz, <0 siyah), kırık ve toplanan pullar.
class TavlaBoardState {
  const TavlaBoardState({required this.points, required this.bar, required this.off});

  final List<int> points;
  final List<int> bar;
  final List<int> off;

  factory TavlaBoardState.fromJson(Map<String, dynamic> j) => TavlaBoardState(
        points: [for (final p in j['points'] as List) (p as num).toInt()],
        bar: [for (final b in j['bar'] as List) (b as num).toInt()],
        off: [for (final o in j['off'] as List) (o as num).toInt()],
      );

  /// Renk 0 beyaz, 1 siyah. Bu hanedeki pul sayısı (o renge aitse).
  int countOf(int color, int point) {
    final v = points[point];
    return color == 0 ? (v > 0 ? v : 0) : (v < 0 ? -v : 0);
  }

  /// Bitirmek için gereken toplam adım.
  int pips(int color) {
    var sum = bar[color] * 25;
    for (var i = 1; i <= 24; i++) {
      sum += countOf(color, i) * (color == 0 ? i : 25 - i);
    }
    return sum;
  }
}

class TavlaSeat {
  const TavlaSeat(
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

  factory TavlaSeat.fromJson(Map<String, dynamic> j) => TavlaSeat(
        name: j['name'] as String? ?? '',
        level: (j['level'] as num?)?.toInt() ?? 1,
        isBot: j['bot'] == 1,
        connected: j['connected'] == 1,
        autoPlaying: j['auto'] == 1,
      );
}

class TavlaResult {
  const TavlaResult({
    required this.winner,
    required this.points,
    required this.mars,
    required this.gameOver,
    required this.payouts,
    required this.seed,
  });

  final int winner;

  /// Bu oyunun puanı (mars 2).
  final int points;
  final bool mars;

  /// Maç bitti mi (5 puan)?
  final bool gameOver;
  final List<int> payouts;

  /// Maç sonunda açıklanan zar tohumu (adil zar doğrulaması).
  final String? seed;

  factory TavlaResult.fromJson(Map<String, dynamic> j) => TavlaResult(
        winner: (j['winner'] as num).toInt(),
        points: (j['points'] as num?)?.toInt() ?? 1,
        mars: j['mars'] == 1,
        gameOver: j['gameOver'] == 1,
        payouts: [
          for (final p in (j['payouts'] as List? ?? const [0, 0])) (p as num).toInt()
        ],
        seed: j['seed'] as String?,
      );
}

/// Rakibin son turu (tahtada vurgulanır).
class TavlaLastMoves {
  const TavlaLastMoves({required this.seat, required this.moves});

  final int seat;
  final List<TavlaStep> moves;

  factory TavlaLastMoves.fromJson(Map<String, dynamic> j) => TavlaLastMoves(
        seat: (j['seat'] as num).toInt(),
        moves: [for (final m in (j['moves'] as List? ?? const [])) TavlaStep.fromJson(m as Map<String, dynamic>)],
      );
}

enum TavlaPhase { waiting, playing, finished }

/// Bir oyuncunun gördüğü tavla masası.
class TavlaState {
  const TavlaState({
    required this.phase,
    required this.bet,
    required this.pot,
    required this.you,
    required this.seats,
    required this.turn,
    required this.rolling,
    required this.dice,
    required this.remaining,
    required this.board,
    required this.legal,
    required this.canUndo,
    required this.lastMoves,
    required this.turnEndsAt,
    required this.turnMs,
    required this.fillAt,
    required this.score,
    required this.target,
    required this.gameNo,
    required this.openingDice,
    required this.commitment,
    required this.nextGameAt,
    required this.result,
    required this.room,
  });

  final TavlaPhase phase;
  final int bet;
  final int pot;

  /// Benim koltuğum; 0 beyaz, 1 siyah.
  final int you;
  final List<TavlaSeat?> seats;
  final int turn;

  /// Sıradaki oyuncu henüz zar atmadı.
  final bool rolling;
  final List<int> dice;
  final List<int> remaining;
  final TavlaBoardState board;

  /// Benim sıramda oynayabileceğim adımlar.
  final List<TavlaStep> legal;
  final bool canUndo;
  final TavlaLastMoves? lastMoves;
  final DateTime? turnEndsAt;
  final int turnMs;
  final DateTime? fillAt;
  final List<int> score;
  final int target;
  final int gameNo;
  final List<int>? openingDice;

  /// Adil zar: maç başında açıklanan tohum özeti.
  final String commitment;
  final DateTime? nextGameAt;
  final TavlaResult? result;
  final OkeyRoomInfo? room;

  int get opponent => 1 - you;
  bool get isMyTurn => phase == TavlaPhase.playing && turn == you;
  bool get canRoll => isMyTurn && rolling;
  bool get isHost => room != null && room!.hostSeat == you;

  factory TavlaState.fromJson(Map<String, dynamic> j, {DateTime? receivedAt}) {
    final local = (receivedAt ?? DateTime.now()).millisecondsSinceEpoch;
    final offset = ((j['serverNow'] as num?)?.toInt() ?? local) - local;
    DateTime? at(Object? v) {
      final ms = (v as num?)?.toInt() ?? 0;
      return ms <= 0 ? null : DateTime.fromMillisecondsSinceEpoch(ms - offset);
    }

    List<int> ints(Object? v) => [for (final x in (v as List? ?? const [])) (x as num).toInt()];

    return TavlaState(
      phase: switch (j['phase']) {
        'playing' => TavlaPhase.playing,
        'finished' => TavlaPhase.finished,
        _ => TavlaPhase.waiting,
      },
      bet: (j['bet'] as num?)?.toInt() ?? 0,
      pot: (j['pot'] as num?)?.toInt() ?? 0,
      you: (j['you'] as num?)?.toInt() ?? 0,
      seats: [
        for (final s in (j['seats'] as List? ?? const [null, null]))
          s == null ? null : TavlaSeat.fromJson(s as Map<String, dynamic>),
      ],
      turn: (j['turn'] as num?)?.toInt() ?? 0,
      rolling: j['stage'] != 'move',
      dice: ints(j['dice']),
      remaining: ints(j['remaining']),
      board: TavlaBoardState.fromJson(j['board'] as Map<String, dynamic>),
      legal: [for (final m in (j['legal'] as List? ?? const [])) TavlaStep.fromJson(m as Map<String, dynamic>)],
      canUndo: j['canUndo'] == 1,
      lastMoves: j['lastMoves'] == null ? null : TavlaLastMoves.fromJson(j['lastMoves'] as Map<String, dynamic>),
      turnEndsAt: at(j['turnEndsAt']),
      turnMs: (j['turnMs'] as num?)?.toInt() ?? 30000,
      fillAt: at(j['fillAt']),
      score: j['score'] == null ? const [0, 0] : ints(j['score']),
      target: (j['target'] as num?)?.toInt() ?? 5,
      gameNo: (j['gameNo'] as num?)?.toInt() ?? 0,
      openingDice: j['openingDice'] == null ? null : ints(j['openingDice']),
      commitment: j['commitment'] as String? ?? '',
      nextGameAt: at(j['nextGameAt']),
      result: j['result'] == null ? null : TavlaResult.fromJson(j['result'] as Map<String, dynamic>),
      room: j['room'] == null ? null : OkeyRoomInfo.fromJson(j['room'] as Map<String, dynamic>),
    );
  }
}
