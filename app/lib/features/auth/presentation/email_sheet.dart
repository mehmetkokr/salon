import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/salon_button.dart';
import '../application/auth_controller.dart';
import 'password_reset_panel.dart';

enum EmailSheetMode {
  /// Giriş ekranından: var olan hesaba gir ya da yeni hesap aç.
  signIn,

  /// Misafir oyuncu: bu hesabı e-postaya bağla, çipler ve seviye kalsın.
  saveGuest,
}

/// E-posta ve şifre penceresi. Yatay telefonda klavye açıkken de sığsın diye
/// alanlar yan yana durur.
class EmailAuthSheet extends ConsumerStatefulWidget {
  const EmailAuthSheet({super.key, required this.mode, this.currentName});

  final EmailSheetMode mode;

  /// Misafirin şu anki adı; kaydederken değiştirebilir.
  final String? currentName;

  /// Basit biçim denetimi; asıl denetimi sunucu yapar.
  static bool validEmail(String v) => RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]{2,}$').hasMatch(v.trim());

  /// Nakama oyuncu adı: boşluk olmadan 3–20 karakter.
  static bool validName(String v) => v.trim().length >= 3 && v.trim().length <= 20 && !v.contains(' ');

  @override
  ConsumerState<EmailAuthSheet> createState() => _EmailAuthSheetState();
}

class _EmailAuthSheetState extends ConsumerState<EmailAuthSheet> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  late final TextEditingController _name = TextEditingController(text: widget.currentName ?? '');
  bool _hidden = true;
  bool _busy = false;
  bool _resetting = false;
  String? _error;

  bool get _saving => widget.mode == EmailSheetMode.saveGuest;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _name.dispose();
    super.dispose();
  }

  bool get _ready =>
      EmailAuthSheet.validEmail(_email.text) &&
      _password.text.length >= 8 &&
      (!_saving || EmailAuthSheet.validName(_name.text));

  Future<void> _submit({bool create = false}) async {
    if (!_ready || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final auth = ref.read(authControllerProvider.notifier);
    final error = _saving
        ? await auth.linkEmail(_email.text, _password.text,
            username: _name.text.trim() == widget.currentName ? null : _name.text.trim())
        : await auth.signInWithEmail(_email.text, _password.text, create: create);
    if (!mounted) return;
    if (error == null) {
      final messenger = ScaffoldMessenger.maybeOf(context);
      Navigator.pop(context);
      if (_saving) {
        messenger
          ?..hideCurrentSnackBar()
          ..showSnackBar(const SnackBar(content: Text('Profilin kaydedildi. Başka telefonda da bu e-postayla girebilirsin.')));
      }
      return;
    }
    setState(() {
      _busy = false;
      _error = error;
    });
  }

  String? get _hint {
    if (_email.text.isNotEmpty && !EmailAuthSheet.validEmail(_email.text)) return 'E-posta adresini kontrol et.';
    if (_password.text.isNotEmpty && _password.text.length < 8) return 'Şifre en az 8 karakter olmalı.';
    if (_saving && !EmailAuthSheet.validName(_name.text)) return 'Oyuncu adı boşluksuz 3–20 karakter olmalı.';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    if (_resetting) {
      return PasswordResetPanel(initialEmail: _email.text, onBack: () => setState(() => _resetting = false));
    }
    final c = context.salon;
    final note = _error ?? _hint;
    final fields = [
      if (_saving)
        Expanded(
          flex: 4,
          child: TextField(
            controller: _name,
            maxLength: 20,
            inputFormatters: [FilteringTextInputFormatter.deny(RegExp(r'\s'))],
            autofillHints: const [AutofillHints.username],
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(labelText: 'Oyuncu adı', counterText: ''),
            onChanged: (_) => setState(() => _error = null),
          ),
        ),
      Expanded(
        flex: 5,
        child: TextField(
          controller: _email,
          autofocus: !_saving,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          autofillHints: const [AutofillHints.email],
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(labelText: 'E-posta'),
          onChanged: (_) => setState(() => _error = null),
        ),
      ),
      Expanded(
        flex: 4,
        child: TextField(
          controller: _password,
          obscureText: _hidden,
          autocorrect: false,
          enableSuggestions: false,
          autofillHints: [_saving ? AutofillHints.newPassword : AutofillHints.password],
          textInputAction: TextInputAction.done,
          decoration: InputDecoration(
            labelText: 'Şifre',
            suffixIcon: IconButton(
              tooltip: _hidden ? 'Şifreyi göster' : 'Şifreyi gizle',
              icon: Icon(_hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined),
              onPressed: () => setState(() => _hidden = !_hidden),
            ),
          ),
          onChanged: (_) => setState(() => _error = null),
          onSubmitted: (_) => _submit(),
        ),
      ),
    ];

    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            Expanded(child: Text(_saving ? 'Profilini kaydet' : 'E-postayla giriş', style: context.text.titleLarge)),
            if (!_saving)
              TextButton(
                style: TextButton.styleFrom(minimumSize: const Size(kMinTap, kMinTap)),
                onPressed: _busy ? null : () => setState(() => _resetting = true),
                child: const Text('Şifremi unuttum'),
              ),
          ]),
          const SizedBox(height: Space.xs),
          Text(
            _saving
                ? 'Çiplerin ve seviyen bu hesapta kalır. Telefon değişse de e-postanla girersin.'
                : 'Kayıtlı hesabına gir ya da yeni bir hesap aç.',
            style: context.text.bodyMedium?.copyWith(color: c.textSecondary),
          ),
          const SizedBox(height: Space.sm),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            for (final (i, f) in fields.indexed) ...[if (i > 0) const SizedBox(width: Space.md), f],
          ]),
          const SizedBox(height: Space.md),
          Row(children: [
            Expanded(
              child: Semantics(
                liveRegion: _error != null,
                child: Text(
                  note ?? '',
                  style: context.text.bodySmall?.copyWith(color: _error != null ? c.danger : c.textSecondary),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
            const SizedBox(width: Space.md),
            if (!_saving) ...[
              SalonButton(
                label: 'Yeni hesap aç',
                kind: SalonButtonKind.secondary,
                compact: true,
                onPressed: _ready && !_busy ? () => _submit(create: true) : null,
              ),
              const SizedBox(width: Space.sm),
            ],
            SalonButton(
              label: _saving ? 'Kaydet' : 'Giriş yap',
              icon: _saving ? Icons.verified_user_outlined : Icons.login_rounded,
              compact: true,
              loading: _busy,
              onPressed: _ready ? _submit : null,
            ),
          ]),
        ],
      ),
    );
  }
}
