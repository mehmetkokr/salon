import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/nakama_service.dart';
import '../../../core/services/service_providers.dart';
import '../domain/card_models.dart';

/// Sunucuyla aynı işlem kodları (server/src/table_kit.js).
abstract final class CardOp {
  static const state = 1;
  static const move = 2;
  static const start = 5;
  static const notice = 9;
}

/// Kart masasına nasıl gelindiği.
sealed class CardEntry {
  const CardEntry();
}

class CardQuick extends CardEntry {
  const CardQuick({required this.game, this.mode});

  final String game;
  final String? mode;
}

class CardCreate extends CardEntry {
  const CardCreate({required this.game, this.mode, required this.name, required this.bet, this.pin});

  final String game;
  final String? mode;
  final String name;
  final int bet;
  final String? pin;
}

class CardJoin extends CardEntry {
  const CardJoin({required this.code, this.pin});

  final String code;
  final String? pin;
}

enum CardConnection { finding, live, failed }

class CardTableUi {
  const CardTableUi({
    this.connection = CardConnection.finding,
    this.error,
    this.needsPin = false,
    this.table,
    this.notice,
    this.noticeSeq = 0,
  });

  final CardConnection connection;
  final String? error;
  final bool needsPin;
  final CardTableState? table;
  final String? notice;
  final int noticeSeq;

  CardTableUi copyWith({
    CardConnection? connection,
    String? error,
    bool? needsPin,
    CardTableState? table,
    String? notice,
    int? noticeSeq,
  }) =>
      CardTableUi(
        connection: connection ?? this.connection,
        error: error ?? this.error,
        needsPin: needsPin ?? this.needsPin,
        table: table ?? this.table,
        notice: notice ?? this.notice,
        noticeSeq: noticeSeq ?? this.noticeSeq,
      );
}

/// Bütün kart oyunlarının istemci tarafı: masa bulur, katılır, hamle gönderir.
/// Oyuna özgü ekranlar [CardTableState.g] içeriğini çizer.
class CardTableController extends Notifier<CardTableUi> {
  String? _matchId;
  StreamSubscription<TableMessage>? _sub;
  CardEntry _entry = const CardQuick(game: 'pisti');
  late TableGateway _gateway;

  @override
  CardTableUi build() {
    _gateway = ref.read(tableGatewayProvider);
    ref.onDispose(() {
      _sub?.cancel();
      final id = _matchId;
      if (id != null) unawaited(_gateway.leaveMatch(id));
    });
    ref.listen(socketStatusProvider, (prev, next) {
      if (next.value == SocketStatus.connected && prev?.value != SocketStatus.connected && _matchId != null) {
        unawaited(_join(_matchId!));
      }
    });
    return const CardTableUi();
  }

  Future<void> begin(CardEntry entry) {
    _entry = entry;
    return start();
  }

  Future<void> retryWithPin(String pin) {
    final e = _entry;
    if (e is CardJoin) _entry = CardJoin(code: e.code, pin: pin);
    return start();
  }

  Future<void> start() async {
    state = const CardTableUi();
    try {
      final e = _entry;
      final match = await switch (e) {
        CardQuick() => _gateway.findMatch('card_quick', {'game': e.game, if (e.mode != null) 'mode': e.mode}),
        CardCreate() => _gateway.findMatch('card_private_create', {
            'game': e.game,
            if (e.mode != null) 'mode': e.mode,
            'name': e.name,
            'bet': e.bet,
            if (e.pin != null && e.pin!.isNotEmpty) 'pin': e.pin,
          }),
        CardJoin() => _gateway.findMatch('card_private_join', {
            'code': e.code,
            if (e.pin != null && e.pin!.isNotEmpty) 'pin': e.pin,
          }),
      };
      if (e is CardCreate && match.code != null) _entry = CardJoin(code: match.code!, pin: e.pin);
      _matchId = match.matchId;
      await _join(match.matchId);
      if (!ref.mounted) return;
      state = state.copyWith(connection: CardConnection.live);
    } catch (e) {
      if (!ref.mounted) return;
      final te = e is TableError ? e : TableError.from(e);
      state = state.copyWith(
        connection: CardConnection.failed,
        needsPin: te?.needsPin ?? false,
        error: te == null
            ? 'Masaya bağlanılamadı. Bağlantını kontrol edip tekrar dene.'
            : te.needsPin
                ? 'Bu oda şifreli. Oda sahibinden 4 haneli şifreyi iste.'
                : te.message,
      );
    }
  }

  Future<void> _join(String matchId) async {
    unawaited(_sub?.cancel());
    _sub = _gateway.messages(matchId).listen(_onMessage);
    await _gateway.joinMatch(matchId);
  }

  void _onMessage(TableMessage m) {
    if (m.opCode == CardOp.notice) {
      state = state.copyWith(notice: m.body['msg'] as String? ?? '', noticeSeq: state.noticeSeq + 1);
      return;
    }
    if (m.opCode != CardOp.state) return;
    state = state.copyWith(connection: CardConnection.live, table: CardTableState.fromJson(m.body));
  }

  /// Oyuna özgü hamle (pişti: {card}).
  void move(Map<String, Object?> body) {
    final t = state.table;
    if (t == null || t.phase != CardPhase.playing) return;
    _send(CardOp.move, body);
  }

  void startGame() {
    final t = state.table;
    if (t == null || !t.isHost || t.phase == CardPhase.playing) return;
    _send(CardOp.start, const {});
  }

  void _send(int op, Map<String, Object?> body) {
    final id = _matchId;
    if (id != null) _gateway.send(id, op, body);
  }

  Future<void> leave() async {
    final id = _matchId;
    _matchId = null;
    unawaited(_sub?.cancel());
    _sub = null;
    if (id != null) await _gateway.leaveMatch(id);
  }

  Future<void> playAgain() async {
    if (state.table?.room != null) return startGame();
    await leave();
    await start();
  }
}

final cardTableProvider = NotifierProvider.autoDispose<CardTableController, CardTableUi>(CardTableController.new);
