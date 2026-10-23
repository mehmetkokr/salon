import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/nakama_service.dart';
import '../../../core/services/service_providers.dart';
import '../domain/okey_models.dart';
import '../domain/rack_layout.dart';

/// Sunucuyla aynı işlem kodları (server/src/okey_match.js).
abstract final class OkeyOp {
  static const state = 1;
  static const draw = 2;
  static const discard = 3;
  static const finish = 4;
  static const start = 5;
  static const showIndicator = 6;
  static const open = 7;
  static const addToMeld = 8;
  static const notice = 9;
}

enum TableConnection { finding, live, failed }

/// Masaya nasıl gelindiği.
sealed class OkeyEntry {
  const OkeyEntry();
}

/// Hemen başla: çipe uygun açık masa.
class QuickEntry extends OkeyEntry {
  const QuickEntry({this.mode = OkeyMode.duz});

  final OkeyMode mode;
}

/// Özel oda kur.
class CreateRoomEntry extends OkeyEntry {
  const CreateRoomEntry({required this.name, required this.bet, this.pin, this.mode = OkeyMode.duz});

  final OkeyMode mode;
  final String name;
  final int bet;

  /// 4 rakam; boşsa oda şifresiz.
  final String? pin;
}

/// Kodla özel odaya katıl.
class JoinRoomEntry extends OkeyEntry {
  const JoinRoomEntry({required this.code, this.pin});

  final String code;
  final String? pin;
}

class OkeyTableUi {
  const OkeyTableUi({
    this.connection = TableConnection.finding,
    this.error,
    this.needsPin = false,
    this.table,
    required this.rack,
    this.selected,
    this.notice,
    this.noticeSeq = 0,
  });

  final TableConnection connection;
  final String? error;

  /// Kodla katılırken odanın şifresi soruluyor.
  final bool needsPin;
  final OkeyTableState? table;
  final RackLayout rack;

  /// Dokunarak seçilen taş (At / Bitir düğmeleri bunu kullanır).
  final int? selected;

  /// Sunucudan gelen son uyarı; `noticeSeq` her yenisinde artar.
  final String? notice;
  final int noticeSeq;

  OkeyTableUi copyWith({
    TableConnection? connection,
    String? error,
    bool? needsPin,
    OkeyTableState? table,
    RackLayout? rack,
    int? Function()? selected,
    String? notice,
    int? noticeSeq,
  }) =>
      OkeyTableUi(
        connection: connection ?? this.connection,
        error: error ?? this.error,
        needsPin: needsPin ?? this.needsPin,
        table: table ?? this.table,
        rack: rack ?? this.rack,
        selected: selected == null ? this.selected : selected(),
        notice: notice ?? this.notice,
        noticeSeq: noticeSeq ?? this.noticeSeq,
      );
}

/// Okey masasının istemci tarafı: masa bulur, katılır, sunucudan gelen
/// durumu ıstaka dizilimiyle birleştirir, hamleleri gönderir.
class OkeyTableController extends Notifier<OkeyTableUi> {
  String? _matchId;
  OkeyEntry _entry = const QuickEntry();
  StreamSubscription<TableMessage>? _sub;
  bool _arranged = false;

  late TableGateway _gateway;

  @override
  OkeyTableUi build() {
    // Kapanışta (onDispose) ref kullanılamaz; ağ geçidini baştan alıyoruz.
    _gateway = ref.read(tableGatewayProvider);
    ref.onDispose(() {
      _sub?.cancel();
      final id = _matchId;
      if (id != null) unawaited(_gateway.leaveMatch(id));
    });
    // Bağlantı kopup geri gelince masaya yeniden otur (koltuk sunucuda tutulur).
    ref.listen(socketStatusProvider, (prev, next) {
      if (next.value == SocketStatus.connected && prev?.value != SocketStatus.connected && _matchId != null) {
        unawaited(_join(_matchId!));
      }
    });
    return OkeyTableUi(rack: RackLayout.empty());
  }

  /// Ekran açılınca çağrılır: masa bulur/kurar ve katılır.
  Future<void> begin(OkeyEntry entry) {
    _entry = entry;
    return start();
  }

  /// Kodla katılırken sorulan şifreyle yeniden dener.
  Future<void> retryWithPin(String pin) {
    final e = _entry;
    if (e is JoinRoomEntry) _entry = JoinRoomEntry(code: e.code, pin: pin);
    return start();
  }

  /// Masa bulur ve katılır. Hata olursa `failed` durumuna geçer.
  Future<void> start() async {
    state = OkeyTableUi(rack: RackLayout.empty());
    _arranged = false;
    try {
      final e = _entry;
      final match = await switch (e) {
        QuickEntry() => _gateway.findMatch('okey_quick', {'mode': e.mode.wire}),
        CreateRoomEntry() => _gateway.findMatch('okey_private_create', {
            'name': e.name,
            'bet': e.bet,
            'mode': e.mode.wire,
            if (e.pin != null && e.pin!.isNotEmpty) 'pin': e.pin,
          }),
        JoinRoomEntry() => _gateway.findMatch('okey_private_join', {
            'code': e.code,
            if (e.pin != null && e.pin!.isNotEmpty) 'pin': e.pin,
          }),
      };
      // Kurulan özel odaya bir daha "kur" denmesin: yeniden bağlanırken kodla girilir.
      if (e is CreateRoomEntry && match.code != null) _entry = JoinRoomEntry(code: match.code!, pin: e.pin);
      _matchId = match.matchId;
      await _join(match.matchId);
      if (!ref.mounted) return;
      state = state.copyWith(connection: TableConnection.live);
    } catch (e) {
      if (!ref.mounted) return;
      final te = e is TableError ? e : TableError.from(e);
      state = state.copyWith(
        connection: TableConnection.failed,
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
    // Dinlemeyi bırakmak için beklemeye gerek yok.
    unawaited(_sub?.cancel());
    _sub = _gateway.messages(matchId).listen(_onMessage);
    await _gateway.joinMatch(matchId);
  }

  void _onMessage(TableMessage m) {
    if (m.opCode == OkeyOp.notice) {
      state = state.copyWith(notice: m.body['msg'] as String? ?? '', noticeSeq: state.noticeSeq + 1);
      return;
    }
    if (m.opCode != OkeyOp.state) return;
    final table = OkeyTableState.fromJson(m.body);
    var rack = state.rack;
    if (!_arranged && table.hand.isNotEmpty) {
      rack = rack.arrangeRuns(table.hand, table);
      _arranged = true;
    } else {
      rack = rack.sync(table.hand, lastDrawn: table.lastDrawn);
    }
    final keep = state.selected != null && table.hand.any((t) => t.id == state.selected);
    state = state.copyWith(
      connection: TableConnection.live,
      table: table,
      rack: rack,
      selected: () => keep ? state.selected : null,
    );
  }

  // ---------------------------------------------------------------- Hamleler

  void draw({required bool fromDiscard}) {
    final t = state.table;
    if (t == null || !t.canDraw) return;
    _send(OkeyOp.draw, {'from': fromDiscard ? 'discard' : 'stock'});
  }

  void discard(int tileId) {
    final t = state.table;
    if (t == null || !t.canDiscard) return;
    _send(OkeyOp.discard, {'id': tileId});
  }

  void finish(int tileId) {
    final t = state.table;
    if (t == null || !t.canDiscard) return;
    _send(OkeyOp.finish, {'id': tileId});
  }

  /// Özel odada eli (ya da yeni eli) oda sahibi başlatır.
  void startHand() {
    final t = state.table;
    if (t == null || !t.isHost || t.phase == OkeyPhase.playing) return;
    _send(OkeyOp.start, const {});
  }

  /// Katlamalı: ilk turda göstergenin eşini göster (diğerleri 1 puan kaybeder).
  void showIndicator() {
    final t = state.table;
    if (t == null || !t.canShowIndicator) return;
    _send(OkeyOp.showIndicator, const {});
  }

  /// 101: ıstakadaki gruplarla el açar (ya da açmışsa yeni per indirir).
  void openHand() {
    final t = state.table;
    if (t == null || !t.canDiscard || !t.is101) return;
    _send(OkeyOp.open, {'groups': state.rack.groups()});
  }

  /// 101: taşı masadaki pere işler.
  void addToMeld(int tileId, int meldIndex) {
    final t = state.table;
    if (t == null || !t.canDiscard || !t.is101) return;
    state = state.copyWith(selected: () => null);
    _send(OkeyOp.addToMeld, {'id': tileId, 'meld': meldIndex});
  }

  void _send(int op, Map<String, Object?> body) {
    final id = _matchId;
    if (id != null) _gateway.send(id, op, body);
  }

  // ---------------------------------------------------------------- Istaka

  void select(int tileId) => state = state.copyWith(selected: () => state.selected == tileId ? null : tileId);

  void moveTile(int tileId, int slot) => state = state.copyWith(rack: state.rack.move(tileId, slot));

  void arrangeRuns() {
    final t = state.table;
    if (t != null) state = state.copyWith(rack: state.rack.arrangeRuns(t.hand, t));
  }

  void arrangePairs() {
    final t = state.table;
    if (t != null) state = state.copyWith(rack: state.rack.arrangePairs(t.hand, t));
  }

  // ---------------------------------------------------------------- Masa

  Future<void> leave() async {
    final id = _matchId;
    _matchId = null;
    // Dinlemeyi bırakmak için beklemeye gerek yok.
    unawaited(_sub?.cancel());
    _sub = null;
    if (id != null) await _gateway.leaveMatch(id);
  }

  /// El bitince: özel odada oda sahibi yeni eli başlatır, hızlı oyunda yeni masa aranır.
  Future<void> playAgain() async {
    if (state.table?.room != null) return startHand();
    await leave();
    await start();
  }
}

final okeyTableProvider = NotifierProvider.autoDispose<OkeyTableController, OkeyTableUi>(OkeyTableController.new);
