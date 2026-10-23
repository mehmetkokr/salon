import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon/core/services/nakama_service.dart';
import 'package:salon/core/services/service_providers.dart';
import 'package:salon/core/theme/app_theme.dart';
import 'package:salon/features/home/widgets/sheets.dart';
import 'package:salon/features/okey/application/okey_table_controller.dart';
import 'package:salon/features/okey/domain/okey_models.dart';
import 'package:salon/features/okey/presentation/okey_table_screen.dart';

import 'okey_fixtures.dart';

void main() {
  void phone(WidgetTester tester) {
    tester.view.physicalSize = const Size(2532, 1170);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  Future<FakeTables> pumpTable(WidgetTester tester) async {
    phone(tester);
    final tables = FakeTables();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        tableGatewayProvider.overrideWithValue(tables),
        socketStatusProvider.overrideWith((ref) => Stream.value(SocketStatus.connected)),
      ],
      child: MaterialApp(
        theme: AppTheme.salon,
        home: const OkeyTableScreen(entry: QuickEntry(mode: OkeyMode.katlamali)),
      ),
    ));
    await tester.pump();
    await tester.pump();
    return tables;
  }

  final hand = [for (var n = 1; n <= 13; n++) tid(0, n), tid(1, 4)];

  testWidgets('katlamalı masa: tür sunucuya gider, puanlar görünür, gösterge gösterilir', (tester) async {
    final tables = await pumpTable(tester);
    expect(tables.calls.single.$2, {'mode': 'katlamali'});
    tables.push(stateJson(
      hand: hand,
      stage: 'discard',
      mode: 'katlamali',
      scores: [20, 18, 16, 20],
      canShow: true,
      handNo: 3,
    ));
    await tester.pump();
    expect(find.text('El 3 · '), findsOneWidget);
    expect(find.text('20 puan'), findsOneWidget); // benim puanım
    expect(find.text('18 puan · 14 taş'), findsOneWidget);
    expect(find.text('16 puan · 14 taş'), findsOneWidget);
    await tester.tap(find.text('Göstergeyi göster'));
    expect(tables.sent.last.$1, OkeyOp.showIndicator);
  });

  testWidgets('katlamalı el sonu: puan tablosu ve sonraki el geri sayımı; oyun sonu: pot', (tester) async {
    final tables = await pumpTable(tester);
    Map<String, Object?> result({required bool over, List<int> payouts = const [0, 0, 0, 0]}) => {
          'reason': 'win',
          'winner': 1,
          'kind': 'seri',
          'okeyFinish': 1,
          'finishTile': tileJson(tid(2, 9)),
          'hand': [for (final id in hand.take(14)) tileJson(id)],
          'payouts': payouts,
          'scoreDeltas': [-4, 0, -4, -4],
          'gameOver': over ? 1 : 0,
          'gameWinners': over ? [0] : null,
        };
    tables.push(stateJson(
      phase: 'finished',
      hand: hand,
      mode: 'katlamali',
      scores: [16, 18, 12, 16],
      result: result(over: false),
      nextHandInMs: 7000,
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Hacer Abla eli bitirdi'), findsOneWidget);
    expect(find.text('Seri ile bitti, okey atarak, diğerleri -4 puan'), findsOneWidget);
    expect(find.textContaining('Sonraki el'), findsOneWidget);
    expect(find.text('Çip değişmedi'), findsNothing, reason: 'ara elde çip satırı yok');

    tables.push(stateJson(
      phase: 'finished',
      hand: hand,
      mode: 'katlamali',
      scores: [12, 6, 0, 8],
      result: result(over: true, payouts: [1500, 0, 0, 0]),
    ));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Oyunu kazandın!'), findsOneWidget);
    expect(find.text('+1.500 çip'), findsOneWidget);
    expect(find.text('Yeni oyun'), findsOneWidget);
  });

  testWidgets('oyun türü seçilir; 101 henüz yakında', (tester) async {
    phone(tester);
    int? started;
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.salon,
      home: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: TextButton(
              onPressed: () => showSalonSheet<void>(
                context,
                builder: (_) => GameChoiceSheet(
                  title: 'Okey / 101 Salonu',
                  modes: const ['Düz', 'Katlamalı', '101'],
                  playableModes: 2,
                  onQuickStart: (i) => started = i,
                ),
              ),
              child: const Text('aç'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('aç'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('101 · yakında'));
    await tester.pump();
    expect(find.text('101 bir sonraki adımda geliyor'), findsOneWidget);
    await tester.tap(find.text('Katlamalı'));
    await tester.pump();
    await tester.tap(find.text('Hemen başla'));
    expect(started, 1);
  });
}
