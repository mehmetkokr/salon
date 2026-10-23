import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/tokens.dart';
import '../../../core/design/widgets/salon_button.dart';
import '../application/auth_controller.dart';
import 'email_sheet.dart';

/// "Şifremi unuttum": önce e-postaya 6 haneli kod gider, sonra kod ve yeni
/// şifreyle şifre değişir ve oyuncu giriş yapmış olur.
class PasswordResetPanel extends ConsumerStatefulWidget {
  const PasswordResetPanel({super.key, required this.initialEmail, required this.onBack});

  final String initialEmail;
  final VoidCallback onBack;

  @override
  ConsumerState<PasswordResetPanel> createState() => _PasswordResetPanelState();
}

class _PasswordResetPanelState extends ConsumerState<PasswordResetPanel> {
  late final _email = TextEditingController(text: widget.initialEmail.trim());
  final _code = TextEditingController();
  final _password = TextEditingController();
  bool _codeSent = false;
  bool _hidden = true;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    if (!EmailAuthSheet.validEmail(_email.text) || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final error = await ref.read(authControllerProvider.notifier).requestPasswordReset(_email.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = error;
      if (error == null) _codeSent = true;
    });
  }

  Future<void> _reset() async {
    if (!_canReset || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final error =
        await ref.read(authControllerProvider.notifier).resetPassword(_email.text, _code.text, _password.text);
    if (!mounted) return;
    if (error == null) {
      final messenger = ScaffoldMessenger.maybeOf(context);
      Navigator.pop(context);
      messenger
        ?..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('Şifren değişti, giriş yaptın.')));
      return;
    }
    setState(() {
      _busy = false;
      _error = error;
    });
  }

  bool get _canReset => _code.text.length == 6 && _password.text.length >= 8;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final String? note = _error ??
        (_codeSent
            ? (_password.text.isNotEmpty && _password.text.length < 8
                ? 'Şifre en az 8 karakter olmalı.'
                : '${_email.text.trim()} adresine bir kod gönderdik. Gelmediyse gereksiz klasörüne bak.')
            : null);

    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            IconButton(
              tooltip: 'Geri',
              onPressed: _busy ? null : widget.onBack,
              icon: const Icon(Icons.arrow_back_rounded),
            ),
            const SizedBox(width: Space.xs),
            Text('Şifreni yenile', style: context.text.titleLarge),
          ]),
          Text(
            _codeSent
                ? 'E-postana gelen 6 haneli kodu ve yeni şifreni yaz.'
                : 'Hesabının e-postasını yaz, sana bir kod gönderelim.',
            style: context.text.bodyMedium?.copyWith(color: c.textSecondary),
          ),
          const SizedBox(height: Space.sm),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              flex: 5,
              child: TextField(
                controller: _email,
                enabled: !_codeSent,
                autofocus: !_codeSent && _email.text.isEmpty,
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                autofillHints: const [AutofillHints.email],
                decoration: const InputDecoration(labelText: 'E-posta'),
                onChanged: (_) => setState(() => _error = null),
                onSubmitted: (_) => _sendCode(),
              ),
            ),
            if (_codeSent) ...[
              const SizedBox(width: Space.md),
              Expanded(
                flex: 3,
                child: TextField(
                  controller: _code,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  autofillHints: const [AutofillHints.oneTimeCode],
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  style: context.text.titleMedium?.copyWith(letterSpacing: 4),
                  decoration: const InputDecoration(labelText: 'Kod', counterText: ''),
                  onChanged: (_) => setState(() => _error = null),
                ),
              ),
              const SizedBox(width: Space.md),
              Expanded(
                flex: 4,
                child: TextField(
                  controller: _password,
                  obscureText: _hidden,
                  autocorrect: false,
                  enableSuggestions: false,
                  autofillHints: const [AutofillHints.newPassword],
                  decoration: InputDecoration(
                    labelText: 'Yeni şifre',
                    suffixIcon: IconButton(
                      tooltip: _hidden ? 'Şifreyi göster' : 'Şifreyi gizle',
                      icon: Icon(_hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                      onPressed: () => setState(() => _hidden = !_hidden),
                    ),
                  ),
                  onChanged: (_) => setState(() => _error = null),
                  onSubmitted: (_) => _reset(),
                ),
              ),
            ],
          ]),
          const SizedBox(height: Space.md),
          Row(children: [
            Expanded(
              child: Semantics(
                liveRegion: true,
                child: Text(
                  note ?? '',
                  style: context.text.bodySmall?.copyWith(color: _error != null ? c.danger : c.textSecondary),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
            const SizedBox(width: Space.md),
            if (_codeSent) ...[
              SalonButton(
                label: 'Tekrar gönder',
                kind: SalonButtonKind.secondary,
                compact: true,
                onPressed: _busy ? null : _sendCode,
              ),
              const SizedBox(width: Space.sm),
              SalonButton(
                label: 'Şifreyi değiştir',
                icon: Icons.lock_reset_rounded,
                compact: true,
                loading: _busy,
                onPressed: _canReset ? _reset : null,
              ),
            ] else
              SalonButton(
                label: 'Kod gönder',
                icon: Icons.send_rounded,
                compact: true,
                loading: _busy,
                onPressed: EmailAuthSheet.validEmail(_email.text) ? _sendCode : null,
              ),
          ]),
        ],
      ),
    );
  }
}
