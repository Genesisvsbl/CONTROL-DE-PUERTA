/* ============================================================
   CONFIGURACIÓN — ControlPuerta  (con Supabase)
   - SUPABASE_ANON_KEY lleva la llave "publishable" (pública). OK.
   - NUNCA pongas aquí la llave "secret".
   ============================================================ */

window.CONFIG = {
  // ---- Supabase ----
  SUPABASE_URL: "https://ggacycayvjatfotyiekq.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_AiKHo3feb3AWID39bbaIng_52PmbNoC",

  // ---- PIN de ADMINISTRADOR (superadmin) ----
  // Con este PIN entras al panel para crear/editar usuarios de portería.
  // ¡Cámbialo por uno tuyo y no lo compartas!
  ADMIN_PIN: "9999",

  // ---- PIN de respaldo de Portería ----
  // Sirve para entrar como portería ANTES de crear usuarios.
  // Cuando ya crees usuarios desde el panel, usa los de cada persona.
  PIN_FABRICA: "1234",

  // ---- Datos de tu planta (pon las coordenadas reales) ----
  PLANTA: { nombre: "Planta Principal", lat: 4.6710, lng: -74.0817 },

  // ---- Minutos para marcar "demora" en puerta ----
  DEMORA_PUERTA_MIN: 15
};
