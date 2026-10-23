// Giriş noktası: RPC'leri ve maç işleyicilerini Nakama'ya tanıtır.
// Nakama işleyici fonksiyonlarının adlarını kaynaktan okur; bu yüzden
// hepsi dosyada üst düzeyde tanımlı olmalı (satır içi fonksiyon olmaz).
function InitModule(ctx, logger, nk, initializer) {
  initializer.registerRpc('bootstrap', rpcBootstrap);
  initializer.registerRpc('daily_reward', rpcDailyReward);
  initializer.registerRpc('password_reset_request', rpcPasswordResetRequest);
  initializer.registerRpc('password_reset_confirm', rpcPasswordResetConfirm);
  initializer.registerRpc('okey_quick', rpcOkeyQuick);
  initializer.registerRpc('okey_private_create', rpcOkeyPrivateCreate);
  initializer.registerRpc('okey_private_join', rpcOkeyPrivateJoin);
  initializer.registerRpc('tavla_quick', rpcTavlaQuick);
  initializer.registerRpc('tavla_private_create', rpcTavlaPrivateCreate);
  initializer.registerRpc('tavla_private_join', rpcTavlaPrivateJoin);
  initializer.registerMatch('tavla', {
    matchInit: tavlaMatchInit,
    matchJoinAttempt: tavlaMatchJoinAttempt,
    matchJoin: tavlaMatchJoin,
    matchLeave: tavlaMatchLeave,
    matchLoop: tavlaMatchLoop,
    matchTerminate: tavlaMatchTerminate,
    matchSignal: tavlaMatchSignal,
  });
  initializer.registerRpc('card_quick', rpcCardQuick);
  initializer.registerRpc('card_private_create', rpcCardPrivateCreate);
  initializer.registerRpc('card_private_join', rpcCardPrivateJoin);
  initializer.registerMatch('batak', {
    matchInit: batakMatchInit,
    matchJoinAttempt: kJoinAttempt,
    matchJoin: kJoin,
    matchLeave: kLeave,
    matchLoop: kLoop,
    matchTerminate: kTerminate,
    matchSignal: kSignal,
  });
  initializer.registerMatch('king', {
    matchInit: kingMatchInit,
    matchJoinAttempt: kJoinAttempt,
    matchJoin: kJoin,
    matchLeave: kLeave,
    matchLoop: kLoop,
    matchTerminate: kTerminate,
    matchSignal: kSignal,
  });
  initializer.registerMatch('pisti', {
    matchInit: pistiMatchInit,
    matchJoinAttempt: kJoinAttempt,
    matchJoin: kJoin,
    matchLeave: kLeave,
    matchLoop: kLoop,
    matchTerminate: kTerminate,
    matchSignal: kSignal,
  });
  initializer.registerMatch('okey', {
    matchInit: okeyMatchInit,
    matchJoinAttempt: okeyMatchJoinAttempt,
    matchJoin: okeyMatchJoin,
    matchLeave: okeyMatchLeave,
    matchLoop: okeyMatchLoop,
    matchTerminate: okeyMatchTerminate,
    matchSignal: okeyMatchSignal,
  });
  logger.info('Salon modülü yüklendi');
}
