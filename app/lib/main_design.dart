import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core/design/design_gallery.dart';

/// Tasarım sistemi vitrini. Uygulamadan bağımsız açılır:
///   flutter run -t lib/main_design.dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  runApp(const DesignGalleryApp());
}
