import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:nakama/nakama.dart';

import '../constants/nakama_config.dart';
import 'player_profile.dart';
import 'session_storage.dart';

export 'player_profile.dart';

/// Gerçek zamanlı soketin durumu. Masa ekranı bunu "Bağlantı yenileniyor"
/// göstermek için kullanır.
enum SocketStatus { disconnected, connecting, connected }

/// Oturum açmış oyuncu.
class SignedInUser {
  const SignedInUser({
    required this.userId,
    required this.username,
    required this.isGuest,
    required this.isNewAccount,
    this.chips = 0,
    this.level = 1,
  });

  final String userId;
  final String username;

  /// Nakama cüzdanındaki çip bakiyesi.
  final int chips;

  /// Oyuncu seviyesi (ıstaka ve zar kilitleri buna bağlı).
  final int level;

  /// Sadece cihaz kimliğiyle giriş yaptı; e-posta/Google/Apple bağlanmadı.
  final bool isGuest;

  /// Bu girişte hesap ilk kez oluşturuldu.
  final bool isNewAccount;
}

/// Kimlik doğrulama ve soket işlemlerinin arayüzü. Testlerde sahte
/// uygulamasıyla değiştirilir.
abstract interface class AuthGateway {
  /// Kayıtlı oturumu geri yükler. Oturum yoksa veya yenilenemiyorsa `null`.
  Future<SignedInUser?> restoreSession();

  /// Cihaz kimliğiyle misafir girişi. Hesap yoksa oluşturur.
  Future<SignedInUser> signInAsGuest();

  Future<void> signOut();

  SocketStatus get socketStatus;
  Stream<SocketStatus> get socketStatusChanges;
}

/// Sunucudaki oyuncu durumu: çip, seviye, ödüller.
abstract interface class ProfileGateway {
  /// Giriş sonrası çağrılır; hoş geldin çipini (bir kez) verir ve durumu döner.
  Future<PlayerProfile> bootstrap();

  /// Günlük ödülü almayı dener. Bugün alındıysa `justGranted` 0 olur.
  Future<PlayerProfile> claimDailyReward();
}

/// Masadan gelen mesaj: işlem kodu ve JSON gövdesi.
class TableMessage {
  const TableMessage(this.opCode, this.body);

  final int opCode;
  final Map<String, dynamic> body;
}

/// Sunucunun bulduğu ya da kurduğu masa.
class QuickMatch {
  const QuickMatch({required this.matchId, required this.bet, this.code});

  final String matchId;
  final int bet;

  /// Özel odanın paylaşılan kodu.
  final String? code;
}

/// Sunucunun oyuncuya gösterilmek üzere gönderdiği hata ("SALON:" önekli).
class TableError implements Exception {
  const TableError(this.message);

  final String message;

  /// Odaya şifreyle girilmesi gerekiyor; arayüz şifre sorar.
  bool get needsPin => message == 'PIN_GEREKLI';

  /// Sunucu hatasından oyuncuya gösterilecek metni çıkarır.
  static TableError? from(Object error) {
    final m = RegExp(r'SALON:(.+?)(?:\s+at\s|["}\n]|$)').firstMatch(error.toString());
    return m == null ? null : TableError(m.group(1)!.trim());
  }

  @override
  String toString() => message;
}

/// Gerçek zamanlı masa işlemleri. Testlerde sahte uygulamayla değiştirilir.
abstract interface class TableGateway {
  /// Masa bulan/kuran RPC'yi çağırır: okey_quick, okey_private_create,
  /// okey_private_join. Oyuncuya gösterilecek hatalar [TableError] olur.
  Future<QuickMatch> findMatch(String rpcId, [Map<String, Object?> payload = const {}]);

  Future<void> joinMatch(String matchId);
  Future<void> leaveMatch(String matchId);
  Stream<TableMessage> messages(String matchId);
  void send(String matchId, int opCode, Map<String, Object?> body);
}

/// Nakama istemcisi, oturum ve gerçek zamanlı soket.
///
/// Uygulamada tek örnek vardır; `nakamaServiceProvider` üzerinden alınır.
class NakamaService implements AuthGateway, ProfileGateway, TableGateway {
  NakamaService({
    required SessionStorage storage,
    NakamaConfig config = NakamaConfig.fromEnvironment,
  })  : _storage = storage,
        _config = config,
        client = getNakamaClient(
          host: config.host,
          httpPort: config.port,
          ssl: config.ssl,
          serverKey: config.serverKey,
        );

  final SessionStorage _storage;
  final NakamaConfig _config;
  final NakamaBaseClient client;

  Session? _session;
  Session? get session => _session;

  final _statusController = StreamController<SocketStatus>.broadcast();
  SocketStatus _status = SocketStatus.disconnected;
  Timer? _reconnectTimer;
  int _reconnectAttempt = 0;
  bool _signingOut = false;

  static final _random = Random.secure();

  @override
  SocketStatus get socketStatus => _status;

  @override
  Stream<SocketStatus> get socketStatusChanges => _statusController.stream;

  // ---------------------------------------------------------------- Giriş

  @override
  Future<SignedInUser> signInAsGuest() async {
    final deviceId = await _storage.readOrCreateDeviceId();
    // Kullanıcı adı yalnızca hesap ilk kez oluşturulurken kullanılır.
    // Nakama'da kullanıcı adları benzersizdir; çakışırsa yeni bir ad dener.
    for (var attempt = 0;; attempt++) {
      try {
        final session = await client.authenticateDevice(
          deviceId: deviceId,
          create: true,
          username: _randomGuestName(),
        );
        return await _completeSignIn(session, isGuest: true);
      } catch (error) {
        if (attempt < 3 && _isUsernameTaken(error)) continue;
        rethrow;
      }
    }
  }

  @override
  Future<SignedInUser?> restoreSession() async {
    final stored = await _storage.readSession();
    if (stored == null) return null;

    var session = Session.restore(token: stored.token, refreshToken: stored.refreshToken);
    if (session == null) {
      await _storage.clearSession();
      return null;
    }
    if (session.hasExpired(DateTime.now().add(const Duration(minutes: 5)))) {
      try {
        session = await client.sessionRefresh(session: session);
      } catch (_) {
        // Yenileme belirteci de dolmuş. Misafir için girişi sessizce
        // tekrarlamak yerine giriş ekranını gösteriyoruz.
        await _storage.clearSession();
        return null;
      }
    }
    return _completeSignIn(session, isGuest: true);
  }

  Future<SignedInUser> _completeSignIn(Session session, {required bool isGuest}) async {
    _session = session;
    _signingOut = false;
    final refreshToken = session.refreshToken;
    if (refreshToken != null) {
      await _storage.writeSession(StoredSession(token: session.token, refreshToken: refreshToken));
    }
    final account = await client.getAccount(session);
    final linked = (account.email?.isNotEmpty ?? false) || (account.customId?.isNotEmpty ?? false);
    await connectSocket();
    return SignedInUser(
      userId: session.userId,
      username: account.user.username ?? 'Misafir',
      isGuest: isGuest && !linked,
      isNewAccount: session.created,
      chips: _walletChips(account.wallet),
    );
  }

  /// Nakama cüzdanı JSON metnidir: {"chips": 1000}.
  static int _walletChips(String? wallet) {
    if (wallet == null || wallet.isEmpty) return 0;
    try {
      final decoded = jsonDecode(wallet);
      if (decoded is Map && decoded['chips'] is num) return (decoded['chips'] as num).toInt();
    } catch (_) {
      // Bozuk cüzdan verisi: bakiye 0 gösterilir, sunucu düzeltir.
    }
    return 0;
  }

  @override
  Future<void> signOut() async {
    _signingOut = true;
    _reconnectTimer?.cancel();
    await _closeSocket();
    final session = _session;
    _session = null;
    if (session != null) {
      try {
        await client.sessionLogout(session: session);
      } catch (_) {
        // Sunucuya ulaşılamasa da yerel oturum silinir.
      }
    }
    // Cihaz kimliği silinmez: misafir tekrar girdiğinde aynı hesabına döner.
    await _storage.clearSession();
    _setStatus(SocketStatus.disconnected);
  }

  // ---------------------------------------------------------------- Profil

  @override
  Future<PlayerProfile> bootstrap() => _rpc('bootstrap');

  @override
  Future<PlayerProfile> claimDailyReward() => _rpc('daily_reward');

  Future<PlayerProfile> _rpc(String id) async => PlayerProfile.fromJson(await _rpcRaw(id) ?? '{}');

  Future<String?> _rpcRaw(String id, [String? payload]) async {
    await _refreshIfNeeded();
    final session = _session;
    if (session == null) throw StateError('Oturum yok');
    return client.rpc(session: session, id: id, payload: payload);
  }

  // ---------------------------------------------------------------- Masa

  @override
  Future<QuickMatch> findMatch(String rpcId, [Map<String, Object?> payload = const {}]) async {
    final String? answer;
    try {
      answer = await _rpcRaw(rpcId, jsonEncode(payload));
    } catch (e) {
      throw TableError.from(e) ?? e;
    }
    final raw = jsonDecode(answer ?? '{}') as Map<String, dynamic>;
    return QuickMatch(
      matchId: raw['matchId'] as String,
      bet: (raw['bet'] as num).toInt(),
      code: raw['code'] as String?,
    );
  }

  @override
  Future<void> joinMatch(String matchId) async {
    await NakamaWebsocketClient.instance.joinMatch(matchId);
  }

  @override
  Future<void> leaveMatch(String matchId) async {
    try {
      await NakamaWebsocketClient.instance.leaveMatch(matchId);
    } catch (_) {
      // Soket zaten kapalıysa sunucu oyuncuyu düşmüş sayar.
    }
  }

  @override
  Stream<TableMessage> messages(String matchId) => NakamaWebsocketClient.instance.onMatchData
      .where((m) => m.matchId == matchId)
      .map((m) => TableMessage(m.opCode, _decodeBody(m.data)));

  static Map<String, dynamic> _decodeBody(List<int>? data) {
    if (data == null || data.isEmpty) return const {};
    try {
      return jsonDecode(utf8.decode(data)) as Map<String, dynamic>;
    } catch (_) {
      return const {};
    }
  }

  @override
  void send(String matchId, int opCode, Map<String, Object?> body) {
    NakamaWebsocketClient.instance.sendMatchData(
      matchId: matchId,
      opCode: opCode,
      data: utf8.encode(jsonEncode(body)),
    );
  }

  // ---------------------------------------------------------------- Soket

  /// Gerçek zamanlı soketi açar. Bağlantı koparsa artan aralıklarla
  /// (1, 2, 4 … en fazla 30 sn) yeniden dener.
  Future<void> connectSocket() async {
    final session = _session;
    if (session == null || _status == SocketStatus.connected) return;
    _setStatus(SocketStatus.connecting);
    await _closeSocket();
    NakamaWebsocketClient.init(
      host: _config.host,
      port: _config.port,
      ssl: _config.ssl,
      token: session.token,
      onDone: _onSocketClosed,
      onError: (_) => _onSocketClosed(),
    );
    _reconnectAttempt = 0;
    _setStatus(SocketStatus.connected);
  }

  void _onSocketClosed() {
    if (_signingOut || _session == null) return;
    _setStatus(SocketStatus.disconnected);
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    final seconds = min(30, 1 << min(_reconnectAttempt, 5));
    _reconnectAttempt++;
    _reconnectTimer = Timer(Duration(seconds: seconds), () async {
      try {
        await _refreshIfNeeded();
        await connectSocket();
      } catch (_) {
        _setStatus(SocketStatus.disconnected);
        _scheduleReconnect();
      }
    });
  }

  Future<void> _refreshIfNeeded() async {
    final session = _session;
    if (session == null) return;
    if (session.hasExpired(DateTime.now().add(const Duration(minutes: 1)))) {
      _session = await client.sessionRefresh(session: session);
      final refreshToken = _session!.refreshToken;
      if (refreshToken != null) {
        await _storage.writeSession(StoredSession(token: _session!.token, refreshToken: refreshToken));
      }
    }
  }

  Future<void> _closeSocket() async {
    try {
      await NakamaWebsocketClient.instance.close();
    } catch (_) {
      // Henüz açılmış bir soket yok.
    }
  }

  void _setStatus(SocketStatus status) {
    if (_status == status) return;
    _status = status;
    _statusController.add(status);
  }

  void dispose() {
    _reconnectTimer?.cancel();
    unawaited(_closeSocket());
    unawaited(_statusController.close());
  }

  // ---------------------------------------------------------------- Yardımcılar

  static String _randomGuestName() => 'Oyuncu_${1000 + _random.nextInt(9000)}';

  static bool _isUsernameTaken(Object error) {
    final text = error.toString().toLowerCase();
    return text.contains('already') || text.contains('409') || text.contains('username');
  }
}
