import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/nakama_service.dart';
import '../../../core/services/service_providers.dart';
import '../domain/tavla_models.dart';

/// Sunucuyla aynı işlem kodları (server/src/tavla_match.js).
abstract final class TavlaOp {
  static const state = 1;
  static const roll = 2;
  static const move = 3;
  static const undo = 4;
  static const start = 5;
  static const notice = 9;
}

/// Masaya nasıl gelindiği.
sealed class TavlaEntry {
  const TavlaEntry();
}

class TavlaQuick extends TavlaEntry {
  const TavlaQuick();
}

class TavlaCreate extends TavlaEntry {
  const TavlaCreate({required this.name, required this.bet, this.pin});

  final String name;
  final int bet;
  final String? pin;
}

class TavlaJoin extends TavlaEntry {
  const TavlaJoin({required this.code, this.pin});

  final String code;
  final String? pin;
}

enum TavlaConnection { finding, live, failed }

/// Seçilen kaynak: kırık pul ya da hane.
const tavlaBar = 0;

class TavlaUi {
  const TavlaUi({
    this.connection = TavlaConnection.finding,
    this.error,
    this.needsPin = false,
    this.table,
    this.selected,
    this.notice,
    this.noticeSeq = 0,
  });

  final TavlaConnection connection;
  final String? error;
  final bool needsPin;
  final TavlaState? table;

  /// Seçili kaynak hane (1..24) ya da [tavlaBar].
  final int? selected;
  final String? notice;
  final int noticeSeq;

  /// Seçili kaynaktan gidilebilecek hedefler (null: toplama).
  List<TavlaStep> get targets {
    final t = table;
    final s = selected;
    if (t == null || s == null) return const [];
    return [
      for (final m in t.legal)
        if ((m.from ?? tavlaBar) == s) m
    ];
  }

  TavlaUi copyWith({
    TavlaConnection? connection,
    String? error,
    bool? needsPin,
    TavlaState? table,
    int? Function()? selected,
    String? notice,
    int? noticeSeq,
  }) =>
      TavlaUi(
        connection: connection ?? this.connection,
        error: error ?? this.error,
        needsPin: needsPin ?? this.needsPin,
        table: table ?? this.table,
        selected: selected == null ? this.selected : selected(),
        notice: notice ?? this.notice,
        noticeSeq: noticeSeq ?? this.noticeSeq,
      );
}

/// Tavla masasının istemci tarafı: masa bulur, katılır, dokunuşları hamleye çevirir.
class TavlaController extends Notifier<TavlaUi> {
  String? _matchId;
  StreamSubscription<TableMessage>? _sub;
  TavlaEntry _entry = const TavlaQuick();
  late TableGateway _gateway;

  @override
  TavlaUi build() {
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
    return const TavlaUi();
  }

  Future<void> begin(TavlaEntry entry) {
    _entry = entry;
    return start();
  }

  Future<void> retryWithPin(String pin) {
    final e = _entry;
    if (e is TavlaJoin) _entry = TavlaJoin(code: e.code, pin: pin);
    return start();
  }

  Future<void> start() async {
    state = const TavlaUi();
    try {
      final e = _entry;
      final match = await switch (e) {
        TavlaQuick() => _gateway.findMatch('tavla_quick'),
        TavlaCreate() => _gateway.findMatch('tavla_private_create', {
            'name': e.name,
            'bet': e.bet,
            if (e.pin != null && e.pin!.isNotEmpty) 'pin': e.pin,
          }),
        TavlaJoin() => _gateway.findMatch('tavla_private_join', {
            'code': e.code,
            if (e.pin != null && e.pin!.isNotEmpty) 'pin': e.pin,
          }),
      };
      if (e is TavlaCreate && match.code != null) _entry = TavlaJoin(code: match.code!, pin: e.pin);
      _matchId = match.matchId;
      await _join(match.matchId);
      if (!ref.mounted) return;
      state = state.copyWith(connection: TavlaConnection.live);
    } catch (e) {
      if (!ref.mounted) return;
      final te = e is TableError ? e : TableError.from(e);
      state = state.copyWith(
        connection: TavlaConnection.failed,
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
    if (m.opCode == TavlaOp.notice) {
      state = state.copyWith(notice: m.body['msg'] as String? ?? '', noticeSeq: state.noticeSeq + 1);
      return;
    }
    if (m.opCode != TavlaOp.state) return;
    final table = TavlaState.fromJson(m.body);
    // Tek kaynak varsa (ör. kırık pul) kendiliğinden seçilir.
    final sources = {for (final s in table.legal) s.from ?? tavlaBar};
    final keep = state.selected != null && sources.contains(state.selected);
    state = state.copyWith(
      connection: TavlaConnection.live,
      table: table,
      selected: () => keep ? state.selected : (sources.length == 1 ? sources.first : null),
    );
  }

  // ---------------------------------------------------------------- Hamleler

  void roll() {
    final t = state.table;
    if (t == null || !t.canRoll) return;
    _send(TavlaOp.roll, const {});
  }

  /// Haneye dokunuş: seçili kaynaktan oraya gidilebiliyorsa oynar, değilse
  /// o haneyi kaynak olarak seçer.
  void tapPoint(int point) {
    final target = state.targets.where((m) => m.to == point).firstOrNull;
    if (target != null) {
      _play(target);
      return;
    }
    final t = state.table;
    final isSource = t != null && t.legal.any((m) => (m.from ?? tavlaBar) == point);
    state = state.copyWith(selected: () => isSource && state.selected != point ? point : null);
  }

  void tapBar() => tapPoint(tavlaBar);

  /// Toplama alanına dokunuş.
  void tapOff() {
    final target = state.targets.where((m) => m.to == null).firstOrNull;
    if (target != null) _play(target);
  }

  void _play(TavlaStep step) {
    state = state.copyWith(selected: () => null);
    _send(TavlaOp.move, step.toMove());
  }

  void undo() {
    final t = state.table;
    if (t == null || !t.canUndo) return;
    _send(TavlaOp.undo, const {});
  }

  void startMatch() {
    final t = state.table;
    if (t == null || !t.isHost || t.phase == TavlaPhase.playing) return;
    _send(TavlaOp.start, const {});
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

  /// Maç bitince: özel odada sahibi yeni maçı başlatır, hızlı oyunda yeni masa.
  Future<void> playAgain() async {
    if (state.table?.room != null) return startMatch();
    await leave();
    await start();
  }
}

final tavlaProvider = NotifierProvider.autoDispose<TavlaController, TavlaUi>(TavlaController.new);
