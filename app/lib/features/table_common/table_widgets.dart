import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/design/tokens.dart';
import '../../core/design/widgets/glass_panel.dart';
import '../../core/design/widgets/salon_button.dart';
import '../home/widgets/sheets.dart';

// Okey ve tavla masalarının ortak parçaları.

/// Özel oda bekleme paneli: ad, kaç kişi oturdu, paylaşılacak kod ve
/// (oda sahibine) "Başlat".
class RoomInfoPanel extends StatelessWidget {
  const RoomInfoPanel({
    super.key,
    required this.name,
    required this.code,
    required this.locked,
    required this.seated,
    required this.capacity,
    required this.isHost,
    required this.onStart,
    required this.waitingText,
  });

  final String name;
  final String code;
  final bool locked;
  final int seated;
  final int capacity;
  final bool isHost;
  final VoidCallback onStart;

  /// Oda sahibi olmayanlara gösterilen metin.
  final String waitingText;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return GlassPanel(
      padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Flexible(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('$name · $seated/$capacity',
                maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.titleMedium),
            const SizedBox(height: 2),
            Semantics(
              button: true,
              label: 'Oda kodu ${code.split('').join(' ')}, kopyalamak için dokun',
              child: InkWell(
                borderRadius: BorderRadius.circular(Radii.sm),
                onTap: () {
                  Clipboard.setData(ClipboardData(text: code));
                  showSoon(context, 'Oda kodu kopyalandı: $code');
                },
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: kMinTap),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text('Oda kodu ', style: context.text.bodySmall),
                    Text(code,
                        style: context.text.titleMedium?.copyWith(
                            color: c.accent, letterSpacing: 2, fontFeatures: const [FontFeature.tabularFigures()])),
                    const SizedBox(width: Space.xs),
                    Icon(Icons.copy_rounded, size: 16, color: c.textSecondary),
                    if (locked) ...[
                      const SizedBox(width: Space.sm),
                      Icon(Icons.lock_rounded, size: 14, color: c.textSecondary),
                      Text(' şifreli', style: context.text.bodySmall),
                    ],
                  ]),
                ),
              ),
            ),
          ]),
        ),
        const SizedBox(width: Space.lg),
        if (isHost)
          SalonButton(label: 'Başlat', icon: Icons.play_arrow_rounded, compact: true, onPressed: onStart)
        else
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 150),
            child: Text(waitingText, style: context.text.bodySmall),
          ),
      ]),
    );
  }
}

/// Masa üstündeki cam bilgi hapı.
class InfoPill extends StatelessWidget {
  const InfoPill({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return Container(
      height: kMinTap,
      padding: const EdgeInsets.symmetric(horizontal: Space.md),
      decoration: BoxDecoration(
        color: c.glass,
        borderRadius: BorderRadius.circular(Radii.pill),
        border: Border.all(color: c.glassBorder),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: children),
    );
  }
}

/// Masa üstündeki yuvarlak cam düğme.
class GlassIconButton extends StatelessWidget {
  const GlassIconButton({super.key, required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: c.glass,
        shape: CircleBorder(side: BorderSide(color: c.glassBorder)),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox.square(dimension: kMinTap, child: Icon(icon, color: c.text, size: 22)),
        ),
      ),
    );
  }
}

/// Masa bulunurken ya da bağlanılamazsa. Şifreli odaya kodla girerken
/// şifreyi burada sorar.
class ConnectingPanel extends StatefulWidget {
  const ConnectingPanel({
    super.key,
    required this.failed,
    required this.needsPin,
    required this.error,
    required this.creating,
    required this.onRetry,
    required this.onPin,
    required this.onBack,
  });

  /// Masa bulunamadı / bağlanılamadı.
  final bool failed;

  /// Kodla girilen oda şifreli: şifre sorulur.
  final bool needsPin;
  final String? error;
  final bool creating;
  final VoidCallback onRetry;
  final ValueChanged<String> onPin;
  final VoidCallback onBack;

  @override
  State<ConnectingPanel> createState() => _ConnectingPanelState();
}

class _ConnectingPanelState extends State<ConnectingPanel> {
  final _pin = TextEditingController();

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.salon;
    final failed = widget.failed;
    final askPin = failed && widget.needsPin;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(Space.lg),
        child: GlassPanel(
          padding: const EdgeInsets.all(Space.xl),
          child: SizedBox(
            width: 340,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              if (askPin)
                Icon(Icons.lock_rounded, color: c.accent, size: 32)
              else if (failed)
                Icon(Icons.error_outline_rounded, color: c.warning, size: 32)
              else
                SizedBox.square(dimension: 32, child: CircularProgressIndicator(color: c.accent, strokeWidth: 3)),
              const SizedBox(height: Space.md),
              Text(
                askPin
                    ? 'Oda şifresi'
                    : failed
                        ? 'Masaya oturulamadı'
                        : widget.creating
                            ? 'Odan kuruluyor…'
                            : 'Masa hazırlanıyor…',
                style: context.text.titleMedium,
                textAlign: TextAlign.center,
              ),
              if (failed) ...[
                const SizedBox(height: Space.xs),
                Text(widget.error ?? '', style: context.text.bodySmall, textAlign: TextAlign.center),
              ],
              if (askPin) ...[
                const SizedBox(height: Space.md),
                SizedBox(
                  width: 160,
                  child: TextField(
                    controller: _pin,
                    autofocus: true,
                    keyboardType: TextInputType.number,
                    obscureText: true,
                    maxLength: 4,
                    textAlign: TextAlign.center,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    style: context.text.headlineSmall?.copyWith(letterSpacing: 8),
                    decoration: const InputDecoration(counterText: '', hintText: '••••'),
                    onSubmitted: (v) {
                      if (v.length == 4) widget.onPin(v);
                    },
                  ),
                ),
              ],
              const SizedBox(height: Space.lg),
              Wrap(alignment: WrapAlignment.center, spacing: Space.sm, runSpacing: Space.sm, children: [
                SalonButton(
                    label: 'Salona dön', kind: SalonButtonKind.secondary, compact: true, onPressed: widget.onBack),
                if (askPin)
                  ListenableBuilder(
                    listenable: _pin,
                    builder: (_, __) => SalonButton(
                      label: 'Odaya gir',
                      compact: true,
                      onPressed: _pin.text.length == 4 ? () => widget.onPin(_pin.text) : null,
                    ),
                  )
                else if (failed)
                  SalonButton(label: 'Tekrar dene', compact: true, onPressed: widget.onRetry),
              ]),
            ]),
          ),
        ),
      ),
    );
  }
}
