import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon/core/design/tokens.dart';
import 'package:salon/core/design/widgets/game_pieces.dart';
import 'package:salon/core/services/nakama_service.dart';
import 'package:salon/core/services/service_providers.dart';
import 'package:salon/core/theme/app_theme.dart';
import 'package:salon/features/okey/application/okey_table_controller.dart';
import 'package:salon/features/okey/presentation/okey_table_screen.dart';

import 'okey_fixtures.dart';

void main() {
  Future<FakeTables> pumpTable(WidgetTester tester, [FakeTables? given]) async {
    // Telefon yatay: 844 × 390 nokta
    tester.view.physicalSize = const Size(2532, 1170);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final tables = given ?? FakeTables();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        tableGatewayProvider.overrideWithValue(tables),
        socketStatusProvider.overrideWith((ref) => Stream.value(SocketStatus.connected)),
      ],
      child: MaterialApp(theme: AppTheme.salon, home: const OkeyTableScreen()),
    ));
    await tester.pump();
    await tester.pump();
    return tables;
  }

  final hand = [
    tid(0, 1), tid(0, 2), tid(0, 3), tid(1, 7), tid(2, 7), tid(3, 7), tid(3, 9), tid(3, 10), //
    tid(3, 11), tid(1, 11), tid(1, 12), tid(1, 13), tid(0, 9), tid(2, 5), // sarı 5 = okey
  ];

  testWidgets('masa aranır, katılınır, bekleme paneli görünür', (tester) async {
    final tables = await pumpTable(tester);
    expect(tables.joined, 1);
    tables.push(stateJson(phase: 'waiting', hand: const [], seated: 1));
    await tester.pump();
    expect(find.text('Oyuncular bekleniyor · 1/4'), findsOneWidget);
    expect(find.text('Bekleniyor'), findsNWidgets(3));
  });

  testWidgets('sıra bende: desteden çekme, sonra seçip atma', (tester) async {
    final tables = await pumpTable(tester);
    tables.push(stateJson(hand: hand, stage: 'draw', prevDiscard: tid(0, 4)));
    await tester.pump();
    expect(find.textContaining('Sıra sende'), findsOneWidget);

    await tester.tap(find.bySemanticsLabel(RegExp('^Deste')));
    expect(tables.sent.last.$1, OkeyOp.draw);
    expect(tables.sent.last.$2, {'from': 'stock'});

    // Soldaki oyuncunun attığı taş da alınabilir
    await tester.tap(find.bySemanticsLabel(RegExp('^Soldaki oyuncunun attığı')));
    expect(tables.sent.last.$1, OkeyOp.draw);
    expect(tables.sent.last.$2, {'from': 'discard'});

    final drawn = tid(2, 9);
    tables.push(stateJson(hand: [...hand, drawn], stage: 'discard', lastDrawn: drawn));
    await tester.pump();
    expect(find.textContaining('Taş at ya da bitir'), findsOneWidget);
    await tester.tap(find.byWidgetPredicate((w) => w is OkeyTile && w.number == 9 && w.color == TileColor.yellow));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('At'));
    expect(tables.sent.last.$1, OkeyOp.discard);
    expect(tables.sent.last.$2, {'id': drawn});
    await tester.tap(find.text('Bitir'));
    expect(tables.sent.last.$1, OkeyOp.finish);
    expect(tables.sent.last.$2, {'id': drawn});
  });

  testWidgets('sunucu uyarısı ve kazanma ekranı', (tester) async {
    final tables = await pumpTable(tester);
    tables.push(stateJson(hand: hand, turn: 1, stage: 'draw'));
    await tester.pump();
    expect(find.text('Sıra: Hacer Abla'), findsOneWidget);
    tables.notice('Sıra sende değil');
    await tester.pump();
    expect(find.text('Sıra sende değil'), findsOneWidget);

    tables.push(stateJson(
      phase: 'finished',
      hand: hand,
      result: {
        'reason': 'win',
        'winner': 0,
        'kind': 'seri',
        'okeyFinish': 0,
        'finishTile': tileJson(tid(2, 9)),
        'hand': [for (final id in hand) tileJson(id)],
        'payouts': [1500, 0, 0, 0],
      },
    ));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Kazandın!'), findsOneWidget);
    expect(find.text('+1.500 çip'), findsOneWidget);
    final btn = find.text('Yeni el');
    await tester.tap(btn);
    await tester.pump();
    await tester.pump();
    expect(tables.left, 1);
    expect(tables.joined, 2);
  });

  testWidgets('masa bulunamazsa nedeni ve tekrar dene', (tester) async {
    await pumpTable(tester, FakeTables()..failWith = Exception('SALON:Okey masası için en az 100 çip gerekli'));
    expect(find.text('Masaya oturulamadı'), findsOneWidget);
    expect(find.text('Okey masası için en az 100 çip gerekli'), findsOneWidget);
    expect(find.text('Tekrar dene'), findsOneWidget);
  });
}
