import '../../../core/design/tokens.dart';
import 'okey_models.dart';

/// Istakadaki dizilim: 2 sıra × 15 yuva. Yalnızca oyuncunun cihazında
/// tutulur; sunucu taşların sırasını bilmez, bitişi kendisi kontrol eder.
class RackLayout {
  const RackLayout._(this.slots);

  static const columns = 15;
  static const rows = 2;
  static const size = columns * rows;

  /// Her yuvadaki taşın kimliği (boşsa null).
  final List<int?> slots;

  factory RackLayout.empty() => RackLayout._(List<int?>.filled(size, null));

  /// Istakadaki gruplar: her rafta boşlukla ayrılmış, en az iki taşlık diziler.
  /// 101'de "Aç" bunları sunucuya gönderir.
  List<List<int>> groups() {
    final out = <List<int>>[];
    for (var row = 0; row < rows; row++) {
      var current = <int>[];
      for (var col = 0; col < columns; col++) {
        final id = slots[row * columns + col];
        if (id == null) {
          if (current.length >= 2) out.add(current);
          current = <int>[];
        } else {
          current.add(id);
        }
      }
      if (current.length >= 2) out.add(current);
    }
    return out;
  }

  int? slotOf(int tileId) {
    final i = slots.indexOf(tileId);
    return i < 0 ? null : i;
  }

  /// Eldeki taşlarla eşitler: gidenler kalkar, yeni gelenler boş yuvaya
  /// girer. Yeni çekilen taş ilk sıranın sonundaki boşluğa konur.
  RackLayout sync(List<OkeyTileData> hand, {int? lastDrawn}) {
    final ids = {for (final t in hand) t.id};
    final next = [for (final s in slots) s != null && ids.contains(s) ? s : null];
    final placed = next.whereType<int>().toSet();
    for (final t in hand) {
      if (placed.contains(t.id)) continue;
      final at = t.id == lastDrawn ? _lastFree(next) : next.indexOf(null);
      if (at < 0) break;
      next[at] = t.id;
    }
    return RackLayout._(next);
  }

  static int _lastFree(List<int?> s) {
    // Önce ilk sıranın sonundan, yoksa ikinci sıranın sonundan.
    for (final row in [0, 1]) {
      for (var c = columns - 1; c >= 0; c--) {
        if (s[row * columns + c] == null) return row * columns + c;
      }
    }
    return -1;
  }

  /// Taşı hedef yuvaya taşır. Hedef doluysa aynı sıradaki taşlar en yakın
  /// boşluğa doğru kayar; sırada boşluk yoksa iki taş yer değiştirir.
  RackLayout move(int tileId, int target) {
    final from = slotOf(tileId);
    if (from == null || from == target || target < 0 || target >= size) return this;
    final next = [...slots];
    next[from] = null;
    if (next[target] == null) {
      next[target] = tileId;
      return RackLayout._(next);
    }
    final row = target ~/ columns;
    final rowStart = row * columns;
    final rowEnd = rowStart + columns - 1;
    int? gap;
    for (var d = 1; d < columns && gap == null; d++) {
      if (target + d <= rowEnd && next[target + d] == null) gap = target + d;
      if (gap == null && target - d >= rowStart && next[target - d] == null) gap = target - d;
    }
    if (gap == null) {
      next[from] = next[target];
      next[target] = tileId;
      return RackLayout._(next);
    }
    if (gap > target) {
      for (var i = gap; i > target; i--) {
        next[i] = next[i - 1];
      }
    } else {
      for (var i = gap; i < target; i++) {
        next[i] = next[i + 1];
      }
    }
    next[target] = tileId;
    return RackLayout._(next);
  }

  /// Seri diz: en az üç ardışık taştan oluşan seriler ayrı gruplara, aralarında
  /// boşlukla dizilir. Seriye girmeyen taşlar renk ve sayı sırasıyla sonda,
  /// okeyler en sonda. Böylece 101'de "Aç" serileri doğrudan bulur.
  RackLayout arrangeRuns(List<OkeyTileData> hand, OkeyTableState table) {
    final jokers = hand.where(table.isOkey).toList();
    final runs = <List<OkeyTileData>>[];
    final rest = <OkeyTileData>[];
    for (final color in TileColor.values) {
      final same = hand.where((t) => !table.isOkey(t) && _value(t, table).$1 == color).toList()
        ..sort((a, b) => _value(a, table).$2.compareTo(_value(b, table).$2));
      var current = <OkeyTileData>[];
      void close() {
        if (current.length >= 3) {
          runs.add(current);
        } else {
          rest.addAll(current);
        }
        current = <OkeyTileData>[];
      }

      for (final t in same) {
        final n = _value(t, table).$2;
        if (current.isNotEmpty && _value(current.last, table).$2 == n) {
          rest.add(t); // aynı taşın ikincisi seriye girmez
          continue;
        }
        if (current.isNotEmpty && _value(current.last, table).$2 != n - 1) close();
        current.add(t);
      }
      close();
    }
    rest.sort((a, b) {
      final va = _value(a, table);
      final vb = _value(b, table);
      if (va.$1.index != vb.$1.index) return va.$1.index.compareTo(vb.$1.index);
      return va.$2 != vb.$2 ? va.$2.compareTo(vb.$2) : a.id.compareTo(b.id);
    });
    return RackLayout._(_pack([...runs, if (rest.isNotEmpty) rest, if (jokers.isNotEmpty) jokers]));
  }

  /// Çift diz: aynı taşlar yan yana, çiftler arasında boşluk. Tekler sonda.
  RackLayout arrangePairs(List<OkeyTileData> hand, OkeyTableState table) {
    final byValue = <(TileColor, int), List<OkeyTileData>>{};
    final jokers = <OkeyTileData>[];
    for (final t in hand) {
      if (table.isOkey(t)) {
        jokers.add(t);
      } else {
        byValue.putIfAbsent(_value(t, table), () => []).add(t);
      }
    }
    final keys = byValue.keys.toList()
      ..sort((a, b) => a.$1.index != b.$1.index ? a.$1.index.compareTo(b.$1.index) : a.$2.compareTo(b.$2));
    final pairs = [
      for (final k in keys)
        if (byValue[k]!.length >= 2) byValue[k]!
    ];
    final singles = [
      for (final k in keys)
        if (byValue[k]!.length < 2) ...byValue[k]!
    ];
    return RackLayout._(_pack([...pairs, if (singles.isNotEmpty) singles, if (jokers.isNotEmpty) jokers]));
  }

  static (TileColor, int) _value(OkeyTileData t, OkeyTableState table) =>
      t.valueWith(table.okeyColor ?? TileColor.red, table.okeyNumber ?? 1);

  /// Grupları iki sıraya yerleştirir. Grup bir sıranın sonuna sığmıyorsa
  /// alt sıraya geçer; yine de sığmazsa boşluklar kaldırılır.
  static List<int?> _pack(List<List<OkeyTileData>> groups) {
    final out = List<int?>.filled(size, null);
    var row = 0;
    var col = 0;
    var ok = true;
    for (final g in groups) {
      if (col > 0 && col + g.length > columns && row == 0) {
        row = 1;
        col = 0;
      }
      for (final t in g) {
        if (col >= columns) {
          row++;
          col = 0;
        }
        if (row >= rows) {
          ok = false;
          break;
        }
        out[row * columns + col] = t.id;
        col++;
      }
      if (!ok) break;
      col++; // gruplar arasında boşluk
    }
    if (ok) return out;
    final flat = [for (final g in groups) ...g.map((t) => t.id)];
    return [for (var i = 0; i < size; i++) i < flat.length ? flat[i] : null];
  }
}
