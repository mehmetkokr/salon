import 'package:flutter/material.dart';

import '../tokens.dart';
import 'coin_balance.dart';
import 'glass_panel.dart';
import 'salon_button.dart';

/// Ana sayfadaki büyük oyun kartı: gerçek manzara fotoğrafı, oyun parçaları,
/// modlar ve “Oyna” butonu. Çevrimiçi sayısı yalnızca sunucudan gerçek
/// bir değer geldiğinde gösterilir; uydurma sayı gösterilmez.
class GameCard extends StatefulWidget {
  const GameCard({
    super.key,
    required this.title,
    required this.image,
    required this.tags,
    this.online,
    required this.pieces,
    this.onTap,
  });

  final String title;
  final String image;
  final List<String> tags;
  final int? online;
  final Widget pieces;
  final VoidCallback? onTap;

  @override
  State<GameCard> createState() => _GameCardState();
}

class _GameCardState extends State<GameCard> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: widget.online == null ? widget.title : '${widget.title}, ${widget.online} çevrimiçi',
      child: GestureDetector(
        onTapDown: (_) => setState(() => _down = true),
        onTapCancel: () => setState(() => _down = false),
        onTapUp: (_) {
          setState(() => _down = false);
          widget.onTap?.call();
        },
        child: AnimatedScale(
          scale: _down ? 0.97 : 1,
          duration: Motion.of(context, Motion.fast),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(Radii.card + 4),
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image.asset(widget.image, fit: BoxFit.cover),
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Color(0x10000000), Color(0x22000000), Color(0xD9000000)],
                      stops: [0, 0.45, 1],
                    ),
                  ),
                ),
                Positioned(top: Space.lg, right: Space.lg, child: widget.pieces),
                Positioned(
                  left: Space.lg,
                  right: Space.lg,
                  bottom: Space.lg,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.title,
                          style: context.text.titleLarge?.copyWith(color: Colors.white, shadows: const [
                            Shadow(color: Color(0x88000000), blurRadius: 8),
                          ])),
                      const SizedBox(height: Space.sm),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [for (final t in widget.tags) SalonTag(t, onPhoto: true)],
                      ),
                      const SizedBox(height: Space.md),
                      Row(
                        children: [
                          if (widget.online != null) ...[
                            Container(
                              width: 8,
                              height: 8,
                              decoration: const BoxDecoration(color: Color(0xFF5BE38F), shape: BoxShape.circle),
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text('${formatChips(widget.online!)} çevrimiçi',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: context.text.bodySmall?.copyWith(color: Colors.white70)),
                            ),
                          ] else
                            const Spacer(),
                          const SizedBox(width: Space.sm),
                          SalonButton(label: 'Oyna', compact: true, onPressed: widget.onTap),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
