import 'dart:async';

import 'package:salon/core/services/nakama_service.dart';

/// Taş kimliği: sunucudaki gibi renk*26 + kopya*13 + (sayı-1).
int tid(int c, int n, [int copy = 0]) => c * 26 + copy * 13 + (n - 1);

Map<String, Object?> tileJson(int id) =>
    id >= 104 ? {'id': id, 'c': -1, 'n': 0, 'f': 1} : {'id': id, 'c': id ~/ 26, 'n': id % 13 + 1};

/// Sunucunun gönderdiği durum mesajı (gerekli alanlarla).
Map<String, dynamic> stateJson({
  String phase = 'playing',
  int you = 0,
  int turn = 0,
  String stage = 'discard',
  required List<int> hand,
  int? lastDrawn,
  int? prevDiscard,
  Map<String, Object?>? result,
  int seated = 4,
  Map<String, Object?>? room,
  String mode = 'duz',
  List<int>? scores,
  bool canShow = false,
  int handNo = 1,
  int nextHandInMs = 0,
  Map<String, Object?>? o101,
  int turnMs = 20000,
}) {
  final now = DateTime.now().millisecondsSinceEpoch;
  final names = ['Oyuncu_4829', 'Hacer Abla', 'Sinan Usta', 'Kahveci Rıza'];
  return {
    'phase': phase,
    'bet': 500,
    'pot': 500,
    'you': you,
    'seats': [
      for (var i = 0; i < 4; i++)
        i >= seated
            ? null
            : {
                'name': names[i],
                'level': 3,
                'bot': i == 0 ? 0 : 1,
                'connected': i == 0 ? 1 : 0,
                'auto': 0,
                'count': i == you ? hand.length : 14,
                'discardTop': i == 3 && prevDiscard != null ? tileJson(prevDiscard) : null,
                'discardCount': i == 3 && prevDiscard != null ? 1 : 0,
              },
    ],
    'turn': turn,
    'stage': stage,
    'turnEndsAt': now + turnMs,
    'fillAt': phase == 'waiting' ? now + 8000 : 0,
    'serverNow': now,
    'stockCount': 48,
    'indicator': tileJson(tid(2, 4)),
    'okey': {'c': 2, 'n': 5},
    'hand': [for (final id in hand) tileJson(id)],
    'lastDrawn': lastDrawn,
    'result': result,
    'room': room,
    'mode': mode,
    'scores': scores,
    'canShow': canShow ? 1 : 0,
    'handNo': handNo,
    'nextHandAt': nextHandInMs > 0 ? now + nextHandInMs : 0,
    'o101': o101,
    'turnMs': turnMs,
  };
}

class FakeTables implements TableGateway {
  final controller = StreamController<TableMessage>.broadcast();
  final sent = <(int, Map<String, Object?>)>[];
  var joined = 0;
  var left = 0;
  Object? failWith;
  final calls = <(String, Map<String, Object?>)>[];

  void push(Map<String, dynamic> state) => controller.add(TableMessage(1, state));
  void notice(String msg) => controller.add(TableMessage(9, {'msg': msg}));

  @override
  Future<QuickMatch> findMatch(String rpcId, [Map<String, Object?> payload = const {}]) async {
    calls.add((rpcId, payload));
    if (failWith != null) throw failWith!;
    return QuickMatch(matchId: 'm1', bet: 500, code: rpcId == 'okey_quick' ? null : 'K7P2QX');
  }

  @override
  Future<void> joinMatch(String matchId) async => joined++;

  @override
  Future<void> leaveMatch(String matchId) async => left++;

  @override
  Stream<TableMessage> messages(String matchId) => controller.stream;

  @override
  void send(String matchId, int opCode, Map<String, Object?> body) => sent.add((opCode, body));
}
