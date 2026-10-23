import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design/customization.dart';

/// Kullanıcının seçtiği oda arka planı, ıstaka ve zar.
/// Şimdilik cihazda tutulur; sunucu profiline kaydetme sonraki adımda.
class Customization {
  const Customization({
    this.room = RoomBackground.kizKulesi,
    this.rack = RackStyle.cam,
    this.dice = DiceStyle.klasik,
    this.sound = true,
    this.haptics = true,
    this.autoRoll = false,
  });

  final RoomBackground room;
  final RackStyle rack;
  final DiceStyle dice;
  final bool sound;
  final bool haptics;

  /// Tavlada sıra gelince zar kendiliğinden atılır.
  final bool autoRoll;

  Customization copyWith({
    RoomBackground? room,
    RackStyle? rack,
    DiceStyle? dice,
    bool? sound,
    bool? haptics,
    bool? autoRoll,
  }) =>
      Customization(
        room: room ?? this.room,
        rack: rack ?? this.rack,
        dice: dice ?? this.dice,
        sound: sound ?? this.sound,
        haptics: haptics ?? this.haptics,
        autoRoll: autoRoll ?? this.autoRoll,
      );
}

class CustomizationController extends Notifier<Customization> {
  @override
  Customization build() => const Customization();

  void setRoom(RoomBackground v) => state = state.copyWith(room: v);
  void setRack(RackStyle v) => state = state.copyWith(rack: v);
  void setDice(DiceStyle v) => state = state.copyWith(dice: v);
  void toggleSound() => state = state.copyWith(sound: !state.sound);
  void toggleHaptics() => state = state.copyWith(haptics: !state.haptics);
  void toggleAutoRoll() => state = state.copyWith(autoRoll: !state.autoRoll);
}

final customizationProvider = NotifierProvider<CustomizationController, Customization>(CustomizationController.new);
