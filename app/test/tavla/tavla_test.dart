import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon/core/services/nakama_service.dart';
import 'package:salon/core/services/service_providers.dart';
import 'package:salon/core/theme/app_theme.dart';
import 'package:salon/features/tavla/application/tavla_controller.dart';
import 'package:salon/features/tavla/presentation/tavla_screen.dart';

import '../okey/okey_fixtures.dart' show FakeTables;

/// Başlangıç dizilişi (beyaz +, siyah −).
List<int> initialPoints() {
  final p = List.filled(26, 0);
  p[24] = 2;
  p[13] = 5;
  p[8] = 3;
  p[6] = 5;
  p[1] = -2;
  p[12] = -5;
  p[17] = -3;
  p[19] = -5;
  return p;
}

Map<String, dynamic> tavlaJson({
  int you = 0,
  int turn = 0,
  String stage = 'roll',
  List<int> dice = const [],
  List<int> remaining = const [],
  List<Map<String, Object?>> legal = const [],
  List<int>? points,
  List<int> bar = const [0, 0],
  String phase = 'playing',
  Map<String, Object?>? result,
  List<int> score = const [0, 0],
}) {
  final now = DateTime.now().millisecondsSinceEpoch;
  return {
    'phase': phase,
    'bet': 500,
    'pot': 500,
    'you': you,
    'seats': [
      {'name': 'Oyuncu_4829', 'level': 3, 'bot': 0, 'connected': 1, 'auto': 0},
      {'name': 'Tavlacı Nuri', 'level': 12, 'bot': 1, 'connected': 0, 'auto': 0},
    ],
    'turn': turn,
    'stage': stage,
    'dice': dice,
    'remaining': remaining,
    'board': {
      'points': points ?? initialPoints(),
      'bar': bar,
      'off': [0, 0]
    },
    'legal': legal,
    'canUndo': 0,
    'lastMoves': null,
    'turnEndsAt': now + 30000,
    'turnMs': 30000,
    'fillAt': 0,
    'serverNow': now,
    'score': score,
    'target': 5,
    'gameNo': 1,
    'openingDice': [5, 2],
    'commitment': '10416cbb2f22dadd6b50a9faa1302a640151cb2ffa6b4f2db9a79783adbf3157',
    'nextGameAt': 0,
    'result': result,
    'room': null,
  };
}

void main() {
  Future<FakeTables> pump(WidgetTester tester) async {
    tester.view.physicalSize = const Size(2532, 1170);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final tables = FakeTables();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        tableGatewayProvider.overrideWithValue(tables),
        socketStatusProvider.overrideWith((ref) => Stream.value(SocketStatus.connected)),
      ],
      child: MaterialApp(theme: AppTheme.salon, home: const TavlaScreen()),
    ));
    await tester.pump();
    await tester.pump();
    return tables;
  }

  testWidgets('tavla masası telefona sığar; zar at', (tester) async {
    final tables = await pump(tester);
    expect(tables.calls.single.$1, 'tavla_quick');
    tables.push(tavlaJson());
    await tester.pump();
    expect(find.text('Sen'), findsOneWidget);
    expect(find.text('Pip 167 · 0/15'), findsNWidgets(2));
    expect(find.bySemanticsLabel(RegExp(r'^Hane 24, 2 beyaz pul')), findsOneWidget);
    await tester.tap(find.text('Zar at'));
    expect(tables.sent.last.$1, TavlaOp.roll);
  });

  testWidgets('pul seç, gideceği haneye dokun: hamle gider', (tester) async {
    final tables = await pump(tester);
    tables.push(tavlaJson(stage: 'move', dice: [
      4,
      2
    ], remaining: [
      4,
      2
    ], legal: [
      {'from': 24, 'to': 20, 'die': 4},
      {'from': 24, 'to': 22, 'die': 2},
      {'from': 13, 'to': 9, 'die': 4},
    ]));
    await tester.pump();
    expect(find.bySemanticsLabel(RegExp('Zarlar 4 ve 2')), findsOneWidget);
    await tester.tap(find.bySemanticsLabel(RegExp(r'^Hane 24,')));
    await tester.pump();
    expect(find.bySemanticsLabel(RegExp(r'^Hane 20, boş, buraya oynayabilirsin')), findsOneWidget);
    await tester.tap(find.bySemanticsLabel(RegExp(r'^Hane 20,')));
    expect(tables.sent.last.$1, TavlaOp.move);
    expect(tables.sent.last.$2, {'from': 24, 'to': 20});
  });

  testWidgets('siyah oynayan tahtayı kendi evinden görür; kırık pul kendiliğinden seçilir', (tester) async {
    final tables = await pump(tester);
    final points = initialPoints()..[1] = -1;
    tables.push(tavlaJson(
        you: 1,
        turn: 1,
        stage: 'move',
        dice: [3, 1],
        remaining: [3, 1],
        points: points,
        bar: [0, 1],
        legal: [
          {'from': 'bar', 'to': 3, 'die': 3},
          {'from': 'bar', 'to': 1, 'die': 1},
        ]));
    await tester.pump();
    // Siyahın gerçek 3. hanesi, ona görünen 22. hanedir.
    await tester.tap(find.bySemanticsLabel(RegExp(r'^Hane 22,')));
    expect(tables.sent.last.$2, {'from': 'bar', 'to': 3});
  });

  testWidgets('maç sonu: tohum özetle eşleşir, zarlar sunucuyla aynı', (tester) async {
    final tables = await pump(tester);
    tables.push(tavlaJson(phase: 'finished', score: [
      5,
      2
    ], result: {
      'winner': 0,
      'points': 2,
      'mars': 1,
      'gameOver': 1,
      'payouts': [500, 0],
      'seed': 'deneme-tohum',
    }));
    await tester.pump();
    expect(find.text('Maçı kazandın!'), findsOneWidget);
    expect(find.text('Mars! 2 puan'), findsOneWidget);
    expect(find.text('+500 çip'), findsOneWidget);
    await tester.tap(find.text('Zarları doğrula'));
    await tester.pumpAndSettle();
    expect(find.text('Tohum özetle eşleşti: zarlar baştan belirlenmişti.'), findsOneWidget);
    // Sunucudaki diceFromSeed ile aynı sonuç (server/test referans değerleri)
    expect([
      for (final n in [0, 1, 2, 3, 7]) FairDiceSheet.diceAt('deneme-tohum', n)
    ], [
      [6, 2], [2, 3], [4, 1], [4, 4], [6, 5], //
    ]);
  });
}
