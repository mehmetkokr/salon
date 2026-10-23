import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon/core/services/nakama_service.dart';
import 'package:salon/core/services/service_providers.dart';
import 'package:salon/core/theme/app_theme.dart';
import 'package:salon/features/cards/application/card_table_controller.dart';
import 'package:salon/features/cards/presentation/card_game_screen.dart';

import '../okey/okey_fixtures.dart' show FakeTables;

Map<String, Object?> card(int suit, int rank) => {'id': suit * 13 + rank - 2, 's': suit, 'r': rank};

Map<String, dynamic> pistiJson({
  int turn = 0,
  String phase = 'playing',
  List<Map<String, Object?>>? hand,
  List<Map<String, Object?>> pile = const [],
  int hidden = 3,
  Map<String, Object?>? lastPlay,
  Map<String, Object?>? result,
}) {
  final now = DateTime.now().millisecondsSinceEpoch;
  return {
    'game': 'pisti',
    'mode': 'tekli',
    'phase': phase,
    'bet': 500,
    'pot': 500,
    'you': 0,
    'seats': [
      {'name': 'Oyuncu_4829', 'level': 3, 'bot': 0, 'connected': 1, 'auto': 0},
      {'name': 'Hacer Abla', 'level': 9, 'bot': 1, 'connected': 0, 'auto': 0},
    ],
    'turn': turn,
    'turnEndsAt': now + 15000,
    'turnMs': 15000,
    'fillAt': 0,
    'nextHandAt': 0,
    'handNo': 1,
    'serverNow': now,
    'result': result,
    'room': null,
    'g': {
      'hand': hand ?? [card(1, 14), card(0, 11), card(2, 7), card(3, 2)],
      'oppCount': 4,
      'pile': pile.isEmpty ? [card(1, 7)] : pile,
      'pileHidden': hidden,
      'deck': 40,
      'captured': [0, 0],
      'pistis': [[], []],
      'scores': [12, 30],
      'target': 101,
      'lastPlay': lastPlay,
    },
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
      child: MaterialApp(theme: AppTheme.salon, home: const CardGameScreen(entry: CardQuick(game: 'pisti'))),
    ));
    await tester.pump();
    await tester.pump();
    return tables;
  }

  testWidgets('pişti masası telefona sığar; karta dokununca atılır', (tester) async {
    final tables = await pump(tester);
    expect(tables.calls.single.$1, 'card_quick');
    expect(tables.calls.single.$2, {'game': 'pisti'});
    tables.push(pistiJson());
    await tester.pump();
    expect(find.bySemanticsLabel(RegExp('^Yerde 4 kart, en üstte kupa 7')), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('^Destede 40 kart')), findsOneWidget);
    expect(find.text('101 puana'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel(RegExp('^karo 7')));
    await tester.pump();
    expect(tables.sent.last.$1, CardOp.move);
    expect(tables.sent.last.$2, {'card': 2 * 13 + 5});
  });

  testWidgets('sıra rakipteyken kart atılmaz', (tester) async {
    final tables = await pump(tester);
    tables.push(pistiJson(turn: 1));
    await tester.pump();
    await tester.tap(find.bySemanticsLabel(RegExp('^karo 7')));
    expect(tables.sent, isEmpty);
  });

  testWidgets('pişti olunca yazı çıkar', (tester) async {
    final tables = await pump(tester);
    tables.push(pistiJson(turn: 1));
    await tester.pump();
    tables.push(pistiJson(turn: 1, lastPlay: {'seat': 0, 'card': card(2, 7), 'took': 1, 'pisti': 10}));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('PİŞTİ!'), findsOneWidget);
    await tester.pump(const Duration(seconds: 2));
    expect(find.text('PİŞTİ!'), findsNothing);
  });

  testWidgets('el sonu puan tablosu', (tester) async {
    final tables = await pump(tester);
    Map<String, Object?> b(int cards, int most, int aces, int jacks, int two, int ten, int pistis, int total) => {
          'cards': cards,
          'most': most,
          'aces': aces,
          'jacks': jacks,
          'two': two,
          'ten': ten,
          'pistis': pistis,
          'total': total
        };
    tables.push(pistiJson(phase: 'finished', result: {
      'breakdown': [b(30, 3, 3, 2, 2, 0, 10, 20), b(22, 0, 1, 2, 0, 3, 0, 6)],
      'scores': [105, 64],
      'gameOver': true,
      'winners': [0],
      'payouts': [500, 0],
    }));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Oyunu kazandın!'), findsOneWidget);
    expect(find.text('Toplam: 105 – 64 · 101 puana'), findsOneWidget);
    expect(find.text('+500 çip'), findsOneWidget);
    expect(find.text('Yeni oyun'), findsOneWidget);
  });
}
