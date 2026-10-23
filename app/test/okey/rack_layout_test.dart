import 'package:flutter_test/flutter_test.dart';
import 'package:salon/features/okey/domain/okey_models.dart';
import 'package:salon/features/okey/domain/rack_layout.dart';

import 'okey_fixtures.dart';

void main() {
  OkeyTableState table(List<int> hand) => OkeyTableState.fromJson(stateJson(hand: hand));
  List<OkeyTileData> tiles(List<int> ids) => table(ids).hand;

  test('seri diz: ardışık en az üç taş ayrı seri, kalanlar sonda, okey en sonda', () {
    final hand = [
      tid(0, 4), tid(0, 4, 1), tid(0, 11), tid(0, 12), tid(0, 13), // kırmızı 4,4 + 11-12-13
      tid(1, 9), tid(1, 10), tid(1, 11), tid(1, 6), // mavi 9-11 + 6
      tid(2, 5), // okey (sarı 5)
    ];
    final t = table(hand);
    final r = RackLayout.empty().arrangeRuns(t.hand, t);
    expect(r.slots.sublist(0, 15), [
      tid(0, 11), tid(0, 12), tid(0, 13), null, //
      tid(1, 9), tid(1, 10), tid(1, 11), null, //
      tid(0, 4), tid(0, 4, 1), tid(1, 6), null, //
      tid(2, 5), null, null,
    ]);
    expect(r.groups(), [
      [tid(0, 11), tid(0, 12), tid(0, 13)],
      [tid(1, 9), tid(1, 10), tid(1, 11)],
      [tid(0, 4), tid(0, 4, 1), tid(1, 6)],
    ]);
  });

  test('çift diz: aynı taşlar yan yana, tekler sonra', () {
    final hand = [tid(3, 4), tid(0, 2), tid(3, 4, 1), tid(1, 8), tid(0, 2, 1)];
    final t = table(hand);
    final r = RackLayout.empty().arrangePairs(t.hand, t);
    expect(
        r.slots.sublist(0, 9), [tid(0, 2), tid(0, 2, 1), null, tid(3, 4), tid(3, 4, 1), null, tid(1, 8), null, null]);
  });

  test('15 taş iki sıraya sığar', () {
    final hand = [for (var n = 1; n <= 13; n++) tid(0, n), tid(1, 1), tid(3, 13)];
    final t = table(hand);
    final r = RackLayout.empty().arrangeRuns(t.hand, t);
    expect(r.slots.whereType<int>().length, 15);
  });

  test('eşitleme: atılan taş kalkar, çekilen taş ilk sıranın sonuna girer', () {
    final start = RackLayout.empty().sync(tiles([1, 2, 3]));
    expect(start.slots.sublist(0, 3), [1, 2, 3]);
    final next = start.sync(tiles([1, 3, 40]), lastDrawn: 40);
    expect(next.slots.sublist(0, 3), [1, null, 3]);
    expect(next.slots[RackLayout.columns - 1], 40);
  });

  test('dolu yuvaya bırakınca taşlar boşluğa doğru kayar', () {
    final r = RackLayout.empty().sync(tiles([1, 2, 3, 4]));
    // 4'ü 1. yuvaya (2'nin yerine) taşı: 2 ve 3 sağa kayar
    final moved = r.move(4, 1);
    expect(moved.slots.sublist(0, 5), [1, 4, 2, 3, null]);
    // boş yuvaya taşıma
    expect(r.move(1, 20).slots[20], 1);
  });
}
