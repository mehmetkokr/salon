import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon/core/design/widgets/salon_button.dart';
import 'package:salon/core/services/nakama_service.dart';
import 'package:salon/core/services/service_providers.dart';
import 'package:salon/core/theme/app_theme.dart';
import 'package:salon/features/cards/application/card_table_controller.dart';
import 'package:salon/features/cards/presentation/card_game_screen.dart';

import '../okey/okey_fixtures.dart' show FakeTables;

Map<String, Object?> card(int suit, int rank) => {'id': suit * 13 + rank - 2, 's': suit, 'r': rank};
int cid(int suit, int rank) => suit * 13 + rank - 2;

/// 13 kart: maça A K 7 3, kupa Q 9 4, karo A 10 8 2, sinek J 5
final hand = [
  card(0, 14),
  card(0, 13),
  card(0, 7),
  card(0, 3),
  card(1, 12),
  card(1, 9),
  card(1, 4),
  card(2, 14),
  card(2, 10),
  card(2, 8),
  card(2, 2),
  card(3, 11),
  card(3, 5),
];

Map<String, dynamic> batakJson({
  String mode = 'ihaleli',
  String stage = 'bid',
  int turn = 0,
  List<int> legal = const [],
  List<Object?> bids = const [null, null, null, null],
  int highBid = 0,
  int declarer = -1,
  int trump = -1,
  List<Map<String, Object?>> trick = const [],
  String phase = 'playing',
  Map<String, Object?>? result,
}) {
  final now = DateTime.now().millisecondsSinceEpoch;
  return {
    'game': 'batak',
    'mode': mode,
    'phase': phase,
    'bet': 500,
    'pot': 500,
    'you': 0,
    'seats': [
      {'name': 'Oyuncu_4829', 'level': 3, 'bot': 0, 'connected': 1, 'auto': 0},
      {'name': 'Hacer Abla', 'level': 9, 'bot': 1, 'connected': 0, 'auto': 0},
      {'name': 'Sinan Usta', 'level': 14, 'bot': 1, 'connected': 0, 'auto': 0},
      {'name': 'Leyla', 'level': 6, 'bot': 1, 'connected': 0, 'auto': 0},
    ],
    'turn': turn,
    'turnEndsAt': now + 20000,
    'turnMs': 20000,
    'fillAt': 0,
    'nextHandAt': 0,
    'handNo': 2,
    'serverNow': now,
    'result': result,
    'room': null,
    'g': {
      'stage': stage,
      'hand': hand,
      'legal': legal,
      'counts': [13, 13, 13, 13],
      'bids': bids,
      'highBid': highBid,
      'minBid': mode == 'esli' ? 7 : 5,
      'declarer': declarer,
      'trump': trump,
      'trick': trick,
      'lastTrick': null,
      'tricks': [2, 1, 0, 3],
      'scores': [12, -5, 4, 8],
      'hands': 5,
      'dealer': 3,
    },
  };
}

void main() {
  Future<FakeTables> pump(WidgetTester tester, {String mode = 'ihaleli'}) async {
    tester.view.physicalSize = const Size(2532, 1170);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final tables = FakeTables();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        tableGatewayProvider.overrideWithValue(tables),
        socketStatusProvider.overrideWith((ref) => Stream.value(SocketStatus.connected)),
      ],
      child: MaterialApp(theme: AppTheme.salon, home: CardGameScreen(entry: CardQuick(game: 'batak', mode: mode))),
    ));
    await tester.pump();
    await tester.pump();
    return tables;
  }

  testWidgets('ihale: telefona sığar, en az 6 (5 alınmış), pas', (tester) async {
    final tables = await pump(tester);
    expect(tables.calls.single.$2, {'game': 'batak', 'mode': 'ihaleli'});
    tables.push(batakJson(bids: [null, 5, null, 'pas'], highBid: 5, declarer: 1));
    await tester.pump();
    expect(find.text('İhale 5 · artır ya da pas'), findsOneWidget);
    expect(find.widgetWithText(SalonButton, '5'), findsNothing, reason: 'en düşük seçenek 6');
    await tester.tap(find.widgetWithText(SalonButton, '7'));
    expect(tables.sent.last.$2, {'bid': 7});
    await tester.tap(find.text('Pas'));
    expect(tables.sent.last.$2, {'pass': true});
  });

  testWidgets('koz seçimi', (tester) async {
    final tables = await pump(tester);
    tables.push(batakJson(stage: 'trump', bids: [8, 'pas', 'pas', 'pas'], highBid: 8, declarer: 0));
    await tester.pump();
    expect(find.text('İhaleyi aldın. Kozu seç'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Koz karo'));
    expect(tables.sent.last.$2, {'trump': 2});
  });

  testWidgets('oyun: yalnızca kurala uyan kartlar atılır', (tester) async {
    final tables = await pump(tester);
    tables.push(batakJson(
      stage: 'play',
      trump: 0,
      declarer: 1,
      highBid: 6,
      bids: ['pas', 6, 'pas', 'pas'],
      trick: [
        {'seat': 1, 'card': card(1, 10)},
      ],
      legal: [cid(1, 12)], // kupa 10 açıldı: kız ile yükseltmek zorunlu
    ));
    await tester.pump();
    expect(find.bySemanticsLabel(RegExp(r'^kupa 9, şu an atılamaz')), findsOneWidget);
    await tester.tap(find.bySemanticsLabel(RegExp(r'^kupa 9')));
    expect(tables.sent, isEmpty);
    await tester.tap(find.bySemanticsLabel(RegExp(r'^kupa kız, atmak için dokun')));
    expect(tables.sent.last.$2, {'card': cid(1, 12)});
  });

  testWidgets('koz maça: söz 1-13', (tester) async {
    final tables = await pump(tester, mode: 'koz');
    tables.push(batakJson(mode: 'koz', trump: 0));
    await tester.pump();
    expect(find.text('Kaç el alacaksın?'), findsOneWidget);
    await tester.tap(find.widgetWithText(SalonButton, '4'));
    expect(tables.sent.last.$2, {'bid': 4});
  });

  testWidgets('el sonu tablosu', (tester) async {
    final tables = await pump(tester);
    tables.push(batakJson(phase: 'finished', result: {
      'points': [-7, 3, 2, 2],
      'tricks': [6, 3, 2, 2],
      'bids': [7, 'pas', 'pas', 'pas'],
      'declarer': 0,
      'highBid': 7,
      'trump': 2,
      'scores': [5, 10, 6, 10],
      'gameOver': false,
      'winners': <int>[],
    }));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('El bitti'), findsOneWidget);
    expect(find.text('-7'), findsOneWidget);
    expect(find.text('+3'), findsOneWidget);
  });
}
