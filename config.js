/* ============================================================
   CONFIGURACIÓN — ControlPuerta  (ya con tus datos de Supabase)
   - SUPABASE_ANON_KEY lleva la llave "publishable" (pública). OK.
   - NUNCA pongas aquí la llave "secret".
   - Cambia el PIN y las coordenadas de tu planta cuando quieras.
   ============================================================ */

window.CONFIG = {
  // ---- Supabase ----
  SUPABASE_URL: "https://ggacycayvjatfotyiekq.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_AiKHo3feb3AWID39bbaIng_52PmbNoC",

  // ---- PIN para entrar como Fábrica/Portería (cámbialo) ----
  PIN_FABRICA: "1234",

  // ---- Datos de tu planta (pon las coordenadas reales de tu planta) ----
  PLANTA: { nombre: "Planta Principal", lat: 4.6710, lng: -74.0817 },

  // ---- Minutos para marcar "demora" en puerta ----
  DEMORA_PUERTA_MIN: 15
};
