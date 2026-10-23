import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon/core/services/nakama_service.dart';
import 'package:salon/core/services/service_providers.dart';
import 'package:salon/core/theme/app_theme.dart';
import 'package:salon/features/okey/application/okey_table_controller.dart';
import 'package:salon/features/okey/presentation/okey_table_screen.dart';
import 'package:salon/features/okey/presentation/room_sheets.dart';
import 'package:salon/features/profile/profile_controller.dart';

import 'okey_fixtures.dart';

class _Profile extends ProfileController {
  @override
  Future<PlayerProfile?> build() async => PlayerProfile(
        chips: 12000,
        level: 3,
        xp: 0,
        xpNeed: 520,
        dailyAvailable: false,
        dailyNextAt: DateTime(2026),
        justGranted: 0,
      );
}

void main() {
  void phone(WidgetTester tester) {
    tester.view.physicalSize = const Size(2532, 1170);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  Future<FakeTables> pumpTable(WidgetTester tester, OkeyEntry entry, [FakeTables? given]) async {
    phone(tester);
    final tables = given ?? FakeTables();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        tableGatewayProvider.overrideWithValue(tables),
        socketStatusProvider.overrideWith((ref) => Stream.value(SocketStatus.connected)),
      ],
      child: MaterialApp(theme: AppTheme.salon, home: OkeyTableScreen(entry: entry)),
    ));
    await tester.pump();
    await tester.pump();
    return tables;
  }

  const room = {'name': 'Cuma akşamı', 'code': 'K7P2QX', 'locked': 1, 'host': 0};

  testWidgets('oda kurulur: kod görünür, sahibi başlatır', (tester) async {
    final tables = await pumpTable(tester, const CreateRoomEntry(name: 'Cuma akşamı', bet: 500, pin: '4821'));
    expect(tables.calls.single.$1, 'okey_private_create');
    expect(tables.calls.single.$2, {'name': 'Cuma akşamı', 'bet': 500, 'mode': 'duz', 'pin': '4821'});

    tables.push(stateJson(phase: 'waiting', hand: const [], seated: 1, room: room));
    await tester.pump();
    expect(find.text('Cuma akşamı · 1/4'), findsOneWidget);
    expect(find.text('K7P2QX'), findsOneWidget);
    expect(find.text(' şifreli'), findsOneWidget);
    await tester.tap(find.text('Başlat'));
    expect(tables.sent.last.$1, OkeyOp.start);
  });

  testWidgets('misafir oyuncu başlatamaz, bekler', (tester) async {
    final tables = await pumpTable(tester, const JoinRoomEntry(code: 'K7P2QX'));
    tables.push(stateJson(phase: 'waiting', hand: const [], seated: 2, you: 1, room: room));
    await tester.pump();
    expect(find.text('Başlat'), findsNothing);
    expect(find.text('Oda sahibi başlatınca el açılır'), findsOneWidget);
  });

  testWidgets('şifreli odaya kodla girerken şifre sorulur', (tester) async {
    final tables = FakeTables()..failWith = const TableError('PIN_GEREKLI');
    await pumpTable(tester, const JoinRoomEntry(code: 'K7P2QX'), tables);
    expect(find.text('Oda şifresi'), findsOneWidget);
    tables.failWith = null;
    await tester.enterText(find.byType(TextField), '4821');
    await tester.pump();
    await tester.tap(find.text('Odaya gir'));
    await tester.pump();
    await tester.pump();
    expect(tables.calls.last.$1, 'okey_private_join');
    expect(tables.calls.last.$2, {'code': 'K7P2QX', 'pin': '4821'});
    expect(tables.joined, 1);
  });

  testWidgets('sunucu hatası olduğu gibi gösterilir', (tester) async {
    await pumpTable(
        tester,
        const JoinRoomEntry(code: 'AAAAAA'),
        FakeTables()
          ..failWith = Exception('rpc error: SALON:Bu kodla açık oda yok at rpcOkeyPrivateJoin (index.js:900)'));
    expect(find.text('Bu kodla açık oda yok'), findsOneWidget);
  });

  testWidgets('oda kurma paneli: bakiyeye uygun bahisler, şifre 4 rakam', (tester) async {
    phone(tester);
    ({String name, int bet, String? pin})? created;
    await tester.pumpWidget(ProviderScope(
      overrides: [profileProvider.overrideWith(_Profile.new)],
      child: MaterialApp(
        theme: AppTheme.salon,
        home: Scaffold(
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: CreateRoomSheet(
              tag: 'Düz okey',
              onCreate: (name, bet, pin) => created = (name: name, bet: bet, pin: pin),
            ),
          ),
        ),
      ),
    ));
    await tester.pump();
    // 12.000 çip: 10.000'e kadar bahisler seçilebilir, varsayılan 500
    expect(find.text('10.000'), findsOneWidget);
    await tester.tap(find.text('Şifreli'));
    await tester.pump();
    await tester.enterText(find.widgetWithText(TextField, '4 haneli şifre'), '12');
    await tester.pump();
    await tester.tap(find.text('Odayı kur'));
    expect(created, isNull, reason: 'şifre eksikken kurulmaz');
    await tester.enterText(find.widgetWithText(TextField, '4 haneli şifre'), '1234');
    await tester.pump();
    await tester.tap(find.text('Odayı kur'));
    expect(created?.bet, 500);
    expect(created?.pin, '1234');
  });
}
