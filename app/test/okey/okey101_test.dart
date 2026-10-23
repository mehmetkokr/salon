import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon/core/design/tokens.dart';
import 'package:salon/core/design/widgets/game_pieces.dart';
import 'package:salon/core/services/nakama_service.dart';
import 'package:salon/core/services/service_providers.dart';
import 'package:salon/core/theme/app_theme.dart';
import 'package:salon/features/okey/application/okey_table_controller.dart';
import 'package:salon/features/okey/domain/okey_models.dart';
import 'package:salon/features/okey/presentation/okey_table_screen.dart';

import 'okey_fixtures.dart';

void main() {
  Future<FakeTables> pumpTable(WidgetTester tester) async {
    tester.view.physicalSize = const Size(2532, 1170);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final tables = FakeTables();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        tableGatewayProvider.overrideWithValue(tables),
        socketStatusProvider.overrideWith((ref) => Stream.value(SocketStatus.connected)),
      ],
      child: MaterialApp(
        theme: AppTheme.salon,
        home: const OkeyTableScreen(entry: QuickEntry(mode: OkeyMode.yuzbir)),
      ),
    ));
    await tester.pump();
    await tester.pump();
    return tables;
  }

  // 22 taş: üç geçerli per (39 + 33 + 30) ve dağınık taşlar
  final hand = [
    tid(3, 13), tid(1, 13), tid(0, 13), //
    tid(0, 10), tid(0, 11), tid(0, 12), //
    tid(1, 9), tid(1, 10), tid(1, 11), //
    tid(3, 1), tid(3, 3), tid(2, 9), tid(1, 2), tid(0, 5), tid(3, 7), tid(1, 6), tid(2, 1), tid(2, 12),
    tid(0, 2), tid(3, 10), tid(1, 4), tid(2, 7),
  ];

  Map<String, Object?> o101({List<Map<String, Object?>> melds = const [], List<int> opened = const [0, 0, 0, 0]}) => {
        'melds': melds,
        'opened': opened,
        'totals': [202, 114, 0, 404],
        'hands': 5,
        'sideTile': null,
        'extra': 0,
      };

  testWidgets('101 masası telefona sığar; Aç ıstakadaki grupları gönderir', (tester) async {
    final tables = await pumpTable(tester);
    expect(tables.calls.single.$2, {'mode': '101'});
    tables.push(stateJson(hand: hand, stage: 'discard', mode: '101', o101: o101(), turnMs: 35000));
    await tester.pump();
    expect(find.text('El 1/5 · '), findsOneWidget);
    expect(find.text('Ceza 202'), findsOneWidget);
    expect(find.text('Henüz açan yok. 101 puanlık per ya da 5 çiftle açılır.'), findsOneWidget);
    expect(find.text('Bitir'), findsNothing);
    await tester.tap(find.text('Aç'));
    final (op, body) = tables.sent.last;
    expect(op, OkeyOp.open);
    final groups = body['groups'] as List<List<int>>;
    // Seri diz: renk grupları boşlukla ayrılır; her grup en az 2 taş
    expect(groups, isNotEmpty);
    expect(groups.every((g) => g.length >= 2), isTrue);
    expect(groups.expand((g) => g).toSet().length, groups.expand((g) => g).length);
  });

  testWidgets('açılmış perler görünür; seçili taş pere dokunarak işlenir', (tester) async {
    final tables = await pumpTable(tester);
    final melds = [
      {
        'owner': 0,
        'kind': 'set',
        'value': 39,
        'tiles': [tileJson(tid(3, 13)), tileJson(tid(1, 13)), tileJson(tid(0, 13))]
      },
      {
        'owner': 1,
        'kind': 'run',
        'value': 30,
        'tiles': [tileJson(tid(1, 9)), tileJson(tid(1, 10)), tileJson(tid(1, 11))]
      },
    ];
    tables.push(stateJson(
      hand: [tid(2, 13), tid(1, 12), tid(3, 1)],
      stage: 'discard',
      mode: '101',
      o101: o101(melds: melds, opened: [1, 1, 0, 2]),
      turnMs: 35000,
    ));
    await tester.pump();
    expect(find.text('Per indir'), findsOneWidget);
    expect(find.text('açtı · 14 taş'), findsOneWidget); // sağdaki oyuncu
    expect(find.text('çift açtı · 14 taş'), findsOneWidget); // soldaki oyuncu
    expect(find.bySemanticsLabel(RegExp('^Senin perin, 3 taş')), findsOneWidget);

    // mavi 12'yi seç, Hacer Abla'nın mavi 9-11 serisine işle
    tables.sent.clear();
    final rackTile = find.byWidgetPredicate((w) => w is OkeyTile && w.number == 12 && w.color == TileColor.blue);
    await tester.tap(rackTile);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.bySemanticsLabel(RegExp('^Hacer Abla perin')));
    expect(tables.sent.last.$1, OkeyOp.addToMeld);
    expect(tables.sent.last.$2, {'id': tid(1, 12), 'meld': 1});
  });

  testWidgets('101 el sonu: cezalar ve toplamlar', (tester) async {
    final tables = await pumpTable(tester);
    tables.push(stateJson(
      phase: 'finished',
      hand: const [],
      mode: '101',
      o101: o101(),
      nextHandInMs: 7000,
      result: {
        'reason': 'win',
        'winner': 2,
        'kind': 'per',
        'okeyFinish': 0,
        'elden': 1,
        'finishTile': tileJson(tid(3, 1)),
        'hand': <Object>[],
        'payouts': [0, 0, 0, 0],
        'penalties': [404, 228, -202, 404],
        'gameOver': 0,
      },
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Sinan Usta eli bitirdi'), findsOneWidget);
    expect(find.text('Elden bitti, cezalar katlandı'), findsOneWidget);
    expect(find.text('+404'), findsNWidgets(2));
    expect(find.text('-202'), findsOneWidget);
    expect(find.textContaining('Sonraki el'), findsOneWidget);
  });
}
