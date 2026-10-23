import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/coin_balance.dart';
import '../../../core/design/widgets/glass_panel.dart';
import '../../../core/design/widgets/navigation.dart';
import '../../../core/design/widgets/salon_button.dart';
import '../../auth/application/auth_controller.dart';
import '../../profile/profile_controller.dart';

/// Sunucudaki bahis seviyeleriyle aynı (server/src/okey_match.js OKEY_BETS).
const okeyBets = [100, 500, 1000, 5000, 10000];

/// Özel oda kur: ad, bahis ve isteğe bağlı 4 haneli şifre.
class CreateRoomSheet extends ConsumerStatefulWidget {
  const CreateRoomSheet({super.key, required this.onCreate, required this.tag});

  /// Oda kurulunca: ad, bahis, şifre (yoksa null).
  final void Function(String name, int bet, String? pin) onCreate;

  /// Başlığın yanındaki oyun etiketi (ör. “Katlamalı okey”, “Tavla”).
  final String tag;

  @override
  ConsumerState<CreateRoomSheet> createState() => _CreateRoomSheetState();
}

class _CreateRoomSheetState extends ConsumerState<CreateRoomSheet> {
  late final TextEditingController _name;
  final _pin = TextEditingController();
  bool _locked = false;
  int? _bet;

  @override
  void initState() {
    super.initState();
    final user = ref.read(authControllerProvider).value;
    _name = TextEditingController(text: user == null ? 'Özel oda' : '${user.username} masası');
  }

  @override
  void dispose() {
    _name.dispose();
    _pin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final chips = ref.watch(profileProvider).value?.chips ?? 0;
    final affordable = [
      for (final b in okeyBets)
        if (chips >= b) b
    ];
    // Varsayılan: bakiyenin yirmide birini geçmeyen en yüksek bahis.
    final suggested =
        affordable.lastWhere((b) => b * 20 <= chips, orElse: () => affordable.isEmpty ? 0 : affordable.first);
    final bet = _bet != null && affordable.contains(_bet) ? _bet! : suggested;
    final pinOk = !_locked || _pin.text.length == 4;
    final canCreate = affordable.isNotEmpty && pinOk && _name.text.trim().isNotEmpty;

    // Yatay telefonda kısa kalsın: ad ve şifre bir satırda, bahis ve düğme bir satırda.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          Expanded(child: Text('Özel oda kur', style: context.text.titleLarge)),
          SalonTag(widget.tag),
        ]),
        const SizedBox(height: Space.sm),
        Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Expanded(
            child: TextField(
              controller: _name,
              maxLength: 24,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Oda adı', counterText: ''),
              onChanged: (_) => setState(() {}),
            ),
          ),
          const SizedBox(width: Space.lg),
          Semantics(
            toggled: _locked,
            label: 'Şifreli oda',
            child: InkWell(
              borderRadius: BorderRadius.circular(Radii.control),
              onTap: () => setState(() => _locked = !_locked),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: kMinTap),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(_locked ? Icons.lock_rounded : Icons.lock_open_rounded, size: 20, color: c.textSecondary),
                  const SizedBox(width: Space.xs),
                  const Text('Şifreli'),
                  Switch.adaptive(value: _locked, onChanged: (v) => setState(() => _locked = v)),
                ]),
              ),
            ),
          ),
          if (_locked) ...[
            const SizedBox(width: Space.sm),
            SizedBox(
              width: 110,
              child: TextField(
                controller: _pin,
                keyboardType: TextInputType.number,
                maxLength: 4,
                obscureText: true,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(labelText: '4 haneli şifre', counterText: ''),
                onChanged: (_) => setState(() {}),
              ),
            ),
          ],
        ]),
        const SizedBox(height: Space.lg),
        Row(children: [
          Text('Bahis', style: context.text.titleSmall?.copyWith(color: c.textSecondary)),
          const SizedBox(width: Space.md),
          Expanded(
            child: affordable.isEmpty
                ? Text('Özel oda için en az ${formatChips(okeyBets.first)} çip gerekli.',
                    style: context.text.bodyMedium)
                : Align(
                    alignment: Alignment.centerLeft,
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: SalonSegmented(
                        options: [for (final b in affordable) formatChips(b)],
                        index: affordable.indexOf(bet),
                        onChanged: (i) => setState(() => _bet = affordable[i]),
                      ),
                    ),
                  ),
          ),
          const SizedBox(width: Space.md),
          SalonButton(
            label: 'Odayı kur',
            icon: Icons.add_rounded,
            compact: true,
            onPressed: canCreate ? () => widget.onCreate(_name.text.trim(), bet, _locked ? _pin.text : null) : null,
          ),
        ]),
      ],
    );
  }
}

/// Kodla odaya katıl. Oda şifreliyse şifre masa açılırken sorulur.
class JoinRoomSheet extends StatefulWidget {
  const JoinRoomSheet({super.key, required this.onJoin});

  /// Girilen 6 haneli kod.
  final ValueChanged<String> onJoin;

  @override
  State<JoinRoomSheet> createState() => _JoinRoomSheetState();
}

class _JoinRoomSheetState extends State<JoinRoomSheet> {
  final _code = TextEditingController();

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ready = _code.text.length == 6;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Kodla katıl', style: context.text.titleLarge),
        const SizedBox(height: Space.xs),
        Text('Arkadaşının gönderdiği 6 haneli oda kodunu yaz.', style: context.text.bodyMedium),
        const SizedBox(height: Space.md),
        Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          Expanded(
            child: TextField(
              controller: _code,
              autofocus: true,
              maxLength: 6,
              textCapitalization: TextCapitalization.characters,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp('[a-zA-Z0-9]')),
                TextInputFormatter.withFunction((_, v) => v.copyWith(text: v.text.toUpperCase())),
              ],
              style: context.text.headlineSmall?.copyWith(letterSpacing: 6),
              decoration: const InputDecoration(labelText: 'Oda kodu', counterText: '', hintText: 'K7P2QX'),
              onChanged: (_) => setState(() {}),
              onSubmitted: (v) {
                if (v.length == 6) widget.onJoin(v);
              },
            ),
          ),
          const SizedBox(width: Space.lg),
          SalonButton(
            label: 'Katıl',
            icon: Icons.login_rounded,
            compact: true,
            onPressed: ready ? () => widget.onJoin(_code.text) : null,
          ),
        ]),
      ],
    );
  }
}
