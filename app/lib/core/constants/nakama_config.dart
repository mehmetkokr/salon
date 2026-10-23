/// Nakama sunucu ayarları.
///
/// Değerler derleme sırasında `--dart-define` ile verilir; verilmezse yerel
/// geliştirme sunucusu (docker-compose) kullanılır:
///
///   flutter run --dart-define=NAKAMA_HOST=10.0.2.2
///
/// Android emülatöründe bilgisayarın localhost'u 10.0.2.2'dir.
class NakamaConfig {
  const NakamaConfig({
    required this.host,
    required this.port,
    required this.ssl,
    required this.serverKey,
  });

  static const fromEnvironment = NakamaConfig(
    host: String.fromEnvironment('NAKAMA_HOST', defaultValue: '127.0.0.1'),
    port: int.fromEnvironment('NAKAMA_PORT', defaultValue: 7350),
    ssl: bool.fromEnvironment('NAKAMA_SSL', defaultValue: false),
    serverKey: String.fromEnvironment('NAKAMA_SERVER_KEY', defaultValue: 'defaultkey'),
  );

  final String host;
  final int port;
  final bool ssl;
  final String serverKey;
}
