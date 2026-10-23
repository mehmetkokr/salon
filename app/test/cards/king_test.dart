import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon/core/services/nakama_service.dart';
import 'package:salon/core/services/service_providers.dart';
import 'package:salon/core/theme/app_theme.dart';
import 'package:salon/features/cards/application/card_table_controller.dart';
import 'package:salon/features/cards/presentation/card_game_screen.dart';

import '../okey/okey_fixtures.dart' show FakeTables;
import 'batak_test.dart' show hand;

Map<String, dynamic> kingJson({
  String stage = 'choose',
  List<String> allowed = const ['kupa', 'kiz', 'soniki', 'koz'],
  String? contract,
  int trump = -1,
  String phase = 'playing',
  Map<String, Object?>? result,
}) {
  final now = DateTime.now().millisecondsSinceEpoch;
  return {
    'game': 'king',
    'mode': 'tekli',
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
    'turn': 0,
    'turnEndsAt': now + 20000,
    'turnMs': 20000,
    'fillAt': 0,
    'nextHandAt': now + 6000,
    'handNo': 7,
    'serverNow': now,
    'result': result,
    'room': null,
    'g': {
      'stage': stage,
      'hand': hand,
      'legal': <int>[],
      'allowed': allowed,
      'chooser': 0,
      'contract': contract,
      'trump': trump,
      'trick': <Object>[],
      'lastTrick': null,
      'tricks': [0, 0, 0, 0],
      'scores': [-180, 250, -60, -410],
      'games': 20,
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
      child: MaterialApp(theme: AppTheme.salon, home: const CardGameScreen(entry: CardQuick(game: 'king'))),
    ));
    await tester.pump();
    await tester.pump();
    return tables;
  }

  testWidgets('sözleşme seçimi: yalnızca kalan haklar; ceza doğrudan, koz renkle gider', (tester) async {
    final tables = await pump(tester);
    expect(tables.calls.single.$2, {'game': 'king'});
    tables.push(kingJson());
    await tester.pump();
    expect(find.text('Bu oyunu sen seçiyorsun'), findsOneWidget);
    expect(find.text('King · Oyun 7/20'), findsOneWidget);
    expect(find.text('Kız almaz'), findsOneWidget);
    expect(find.text('Rıfkı'), findsNothing, reason: 'hakkı bitmiş sözleşme görünmez');
    await tester.tap(find.text('Kız almaz'));
    expect(tables.sent.last.$2, {'contract': 'kiz'});
    await tester.tap(find.text('Koz'));
    await tester.pump();
    await tester.tap(find.bySemanticsLabel('Koz sinek'));
    expect(tables.sent.last.$2, {'contract': 'koz', 'trump': 3});
  });

  testWidgets('oyun sonu tablosu', (tester) async {
    final tables = await pump(tester);
    tables.push(kingJson(phase: 'finished', contract: 'kiz', result: {
      'contract': 'kiz',
      'tricks': [3, 4, 3, 3],
      'points': [0, -200, -100, -100],
      'scores': [-180, 50, -160, -510],
      'gameOver': false,
      'winners': <int>[],
    }));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Kız almaz bitti'), findsOneWidget);
    expect(find.text('-200'), findsOneWidget);
    expect(find.textContaining('Sonraki el'), findsOneWidget);
  });
}
