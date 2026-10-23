import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// Cihaz kimliği ve oturum belirteçlerini güvenli depoda tutar
/// (iOS Keychain / Android Keystore).
abstract interface class SessionStorage {
  /// Misafir hesabın anahtarı. Uygulama silinmedikçe değişmez, böylece
  /// "Misafir olarak gir" her seferinde aynı hesaba döner.
  Future<String> readOrCreateDeviceId();

  Future<StoredSession?> readSession();
  Future<void> writeSession(StoredSession session);
  Future<void> clearSession();
}

class StoredSession {
  const StoredSession({required this.token, required this.refreshToken});

  final String token;
  final String refreshToken;
}

class SecureSessionStorage implements SessionStorage {
  SecureSessionStorage([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  static const _deviceIdKey = 'salon.device_id';
  static const _tokenKey = 'salon.session_token';
  static const _refreshKey = 'salon.refresh_token';

  final FlutterSecureStorage _storage;

  @override
  Future<String> readOrCreateDeviceId() async {
    final existing = await _storage.read(key: _deviceIdKey);
    if (existing != null && existing.length >= 10) return existing;
    // Nakama cihaz kimliği 10–128 karakter olmalı; UUID 36 karakter.
    final created = const Uuid().v4();
    await _storage.write(key: _deviceIdKey, value: created);
    return created;
  }

  @override
  Future<StoredSession?> readSession() async {
    final token = await _storage.read(key: _tokenKey);
    final refresh = await _storage.read(key: _refreshKey);
    if (token == null || refresh == null) return null;
    return StoredSession(token: token, refreshToken: refresh);
  }

  @override
  Future<void> writeSession(StoredSession session) async {
    await _storage.write(key: _tokenKey, value: session.token);
    await _storage.write(key: _refreshKey, value: session.refreshToken);
  }

  @override
  Future<void> clearSession() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _refreshKey);
  }
}
