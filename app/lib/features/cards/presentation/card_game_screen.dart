import 'package:flutter/material.dart';

import '../application/card_table_controller.dart';
import 'batak_body.dart';
import 'card_table_shell.dart';
import 'king_body.dart';
import 'pisti_screen.dart';

/// Bütün kart oyunlarının tek ekranı. Hangi oyunun masası olduğu (kodla
/// katılırken de) sunucudan gelen durumdan anlaşılır.
class CardGameScreen extends StatelessWidget {
  const CardGameScreen({super.key, required this.entry});

  final CardEntry entry;

  @override
  Widget build(BuildContext context) {
    return CardTableShell(
      entry: entry,
      bodyBuilder: (context, table, ctl) => switch (table.game) {
        'batak' => BatakBody(table: table, ctl: ctl),
        'king' => KingBody(table: table, ctl: ctl),
        _ => PistiBody(table: table, ctl: ctl),
      },
      resultBuilder: (context, table) => switch (table.game) {
        'batak' => BatakResult(table: table),
        'king' => KingResult(table: table),
        _ => PistiResult(table: table),
      },
    );
  }
}
