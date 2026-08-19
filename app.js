/* ============================================================
   ControlPuerta — lógica principal
   Roles: conductor · fábrica (usuarios con PIN) · administrador
   ============================================================ */
const App = (function () {
  const C = window.CONFIG;
  const PLANTA = C.PLANTA;
  // Categorías con las que puede salir un vehículo (varias a la vez, cada una con observación)
  const VIDRIO_SUBS = ["Ambar 250", "Ambar 330", "Ambar 1.000", "Flint 250", "Flint 330", "Flint 1.000", "Trophic 330", "GREEN 175", "GREEN 320"];
  const CATS = [
    { key: "producto_terminado", nombre: "Producto terminado", subs: ["PT PET 330", "PT PET 200", "PT PET 1.500", "PT PET 1.000"] },
    { key: "lavado", nombre: "Lavado", subs: VIDRIO_SUBS },
    { key: "casco", nombre: "Casco de vidrio", subs: VIDRIO_SUBS },
    { key: "caja_mala", nombre: "Caja mala" },
    { key: "caja_vacia", nombre: "Caja vacía" }
  ];
  let role = null;            // 'conductor' | 'fabrica' | 'admin'
  let data = [];             // registros
  let usuarios = [];         // usuarios de portería
  let tab = "puerta";
  let myId = null;           // registro del conductor actual
  let cStep = "inicio";
  let cGPS = null;
  let outTargetId = null;
  let chart = null;
  let pinMode = "fabrica";   // 'fabrica' | 'admin'
  let currentUser = null;    // usuario de portería logueado
  let editUserId = null;
  let adminTab = "usuarios"; // 'usuarios' | 'indicadores'
  let indicFilter = "todo";  // 'hoy' | '7d' | '30d' | 'todo'

  const $ = s => document.querySelector(s);
  const el = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, "0");
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const D = v => v ? new Date(v) : null;
  const fmtHM = d => d ? pad(d.getHours()) + ":" + pad(d.getMinutes()) : "—";
  const fmtFull = d => d ? d.toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  function haversine(a, b) {
    const R = 6371, r = x => x * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  const distTxt = km => km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(1) + " km";
  const diffMin = (a, b) => (a && b) ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null;
  const durTxt = m => m == null ? "—" : (m < 60 ? m + " min" : Math.floor(m / 60) + "h " + (m % 60) + "m");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function tiempos(r) {
    return { espera: diffMin(r.t_puerta, r.t_ingreso), planta: diffMin(r.t_ingreso, r.t_salida), ciclo: diffMin(r.t_puerta, r.t_salida) };
  }
  function catsOf(r) {
    let c = r.salida_categorias;
    if (!c) return [];
    if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { return []; } }
    return Array.isArray(c) ? c : [];
  }
  /* Tipos de vehículo (por defecto SIDER; se pueden agregar con "+") */
  function getTipos() { try { const a = JSON.parse(localStorage.getItem("cp_tipos") || "null"); if (Array.isArray(a) && a.length) return a; } catch (e) {} return ["SIDER"]; }
  function saveTipos(a) { localStorage.setItem("cp_tipos", JSON.stringify(a)); }
  function addTipo() {
    const v = (prompt("Nuevo tipo de vehículo:") || "").trim();
    if (!v) return;
    const a = getTipos();
    if (!a.some(x => x.toLowerCase() === v.toLowerCase())) { a.push(v); saveTipos(a); }
    const sel = el("fTipo"); if (!sel) return;
    let opt = [...sel.options].find(o => o.value.toLowerCase() === v.toLowerCase());
    if (!opt) { opt = document.createElement("option"); opt.textContent = v; sel.appendChild(opt); }
    sel.value = opt.value;
    toast("green", "Tipo agregado", v);
  }

  /* ===================== ARRANQUE ===================== */
  async function boot() {
    await Store.init(refresh);
    await Users.init(refreshUsers);
    el("gateMode").innerHTML = Store.mode === "supabase"
      ? '<span class="dotok"></span> Sistema en línea · sincronización activa'
      : '<span class="dotlocal"></span> Modo prueba · sin sincronización entre equipos';
    await refreshUsers();
    await refresh();
    const savedRole = sessionStorage.getItem("cp_role");
    myId = localStorage.getItem("cp_myId") || null;
    const savedUser = sessionStorage.getItem("cp_user");
    if (savedRole === "conductor") enterRole("conductor", true);
    else if (savedRole === "fabrica" && savedUser) { currentUser = JSON.parse(savedUser); enterRole("fabrica", true); }
    else if (savedRole === "admin") { if (savedUser) { try { currentUser = JSON.parse(savedUser); } catch (e) {} } openAdmin(true); }
    setInterval(() => { if (role === "conductor" && cStep === "inicio") renderConductor(); }, 30000);
    setupInstall();
  }

  /* ===================== INSTALAR (PWA) ===================== */
  let deferredPrompt = null;
  let iosMode = false;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); deferredPrompt = e;
    const b = el("btnInstall"); if (b) { b.hidden = false; b.textContent = "📲 Instalar app en el celular"; }
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    const b = el("btnInstall"); if (b) b.hidden = true;
    toast("green", "App instalada", "Ábrela desde tu pantalla de inicio.");
  });
  async function installApp() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) {}
      deferredPrompt = null;
      const b = el("btnInstall"); if (b) b.hidden = true;
      return;
    }
    if (iosMode) { el("iosOverlay").classList.add("show"); return; }
    toast("blue", "Instalación", "Abre el menú del navegador y elige “Instalar app” o “Agregar a inicio”.");
  }
  function closeIos() { el("iosOverlay").classList.remove("show"); }
  function setupInstall() {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPad iPadOS
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    iosMode = isIOS;
    if (standalone) return; // ya está instalada
    if (isIOS) { const b = el("btnInstall"); if (b) { b.hidden = false; b.textContent = "📲 Cómo instalar en iPhone"; } }
  }
  async function refresh() { data = await Store.list(); updateConn(); if (role === "fabrica") renderFabrica(); if (role === "conductor") renderConductor(); }
  async function refreshUsers() { usuarios = await Users.list(); if (role === "admin") renderAdmin(); }
  function updateConn() {
    const b = el("connBadge"); if (!b) return;
    if (Store.mode === "supabase") { b.textContent = "● En vivo"; b.className = "conn ok"; }
    else { b.textContent = "● Local"; b.className = "conn local"; }
  }

  /* ===================== ROLES / ACCESO ===================== */
  function showView(v) {
    el("gate").hidden = v !== "gate";
    el("appbar").hidden = v === "gate";
    el("viewConductor").hidden = v !== "conductor";
    el("viewFabrica").hidden = v !== "fabrica";
    el("viewAdmin").hidden = v !== "admin";
  }
  function enterRole(r, silent) {
    role = r;
    sessionStorage.setItem("cp_role", r);
    showView(r);
    if (r === "conductor") { el("roleLabel").textContent = "Conductor"; cStep = myId ? "enviado" : "inicio"; renderConductor(); }
    else if (r === "fabrica") { el("roleLabel").textContent = currentUser ? currentUser.nombre : "Portería"; renderFabrica(); }
    updateConn();
  }
  function openAdmin(silent) {
    role = "admin";
    sessionStorage.setItem("cp_role", "admin");
    el("roleLabel").textContent = (currentUser && currentUser.nombre) ? currentUser.nombre + " · Admin" : "Administrador";
    showView("admin");
    updateConn();
    renderAdmin();
  }
  function exitRole() {
    role = null; currentUser = null;
    sessionStorage.removeItem("cp_role"); sessionStorage.removeItem("cp_user");
    showView("gate");
  }

  function askPin(mode) {
    pinMode = mode;
    el("pinTitle").textContent = mode === "admin" ? "Acceso Administrador" : "Acceso Portería";
    el("pinSubt").textContent = mode === "admin" ? "PIN de administrador" : "Ingresa tu PIN";
    el("pinIcon").textContent = mode === "admin" ? "👑" : "🔒";
    el("pinErr").hidden = true; el("pinInput").value = "";
    el("pinOverlay").classList.add("show");
    setTimeout(() => el("pinInput").focus(), 100);
  }
  function closePin() { el("pinOverlay").classList.remove("show"); }
  function checkPin() {
    const v = el("pinInput").value.trim();
    if (pinMode === "admin") {
      if (v === String(C.ADMIN_PIN)) { currentUser = { nombre: "Administrador" }; sessionStorage.setItem("cp_user", JSON.stringify(currentUser)); closePin(); openAdmin(); return; }
      const au = usuarios.find(x => String(x.pin) === v && x.activo !== false && x.rol === "admin");
      if (au) { currentUser = { id: au.id, nombre: au.nombre }; sessionStorage.setItem("cp_user", JSON.stringify(currentUser)); closePin(); openAdmin(); return; }
      el("pinErr").hidden = false; return;
    }
    // fábrica: usuarios activos (incluye premium), PIN de respaldo, o el PIN maestro de admin (acceso total)
    const u = usuarios.find(x => String(x.pin) === v && x.activo !== false);
    if (u) { currentUser = { id: u.id, nombre: u.nombre + (u.rol === "admin" ? " · Admin" : "") }; sessionStorage.setItem("cp_user", JSON.stringify(currentUser)); closePin(); enterRole("fabrica"); return; }
    if (v === String(C.PIN_FABRICA)) { currentUser = { nombre: "Portería" }; sessionStorage.setItem("cp_user", JSON.stringify(currentUser)); closePin(); enterRole("fabrica"); return; }
    if (v === String(C.ADMIN_PIN)) { currentUser = { nombre: "Administrador" }; sessionStorage.setItem("cp_user", JSON.stringify(currentUser)); closePin(); enterRole("fabrica"); return; }
    el("pinErr").hidden = false;
  }

  /* ===================== CONDUCTOR ===================== */
  function renderConductor() {
    const v = el("viewConductor");
    if (cStep === "inicio") {
      v.innerHTML = `
        <div class="c-wrap">
          <div class="steps"><div class="s on"></div><div class="s"></div><div class="s"></div></div>
          <div class="c-hero">
            <div class="gate-ic"><span class="ripple"></span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="7" width="15" height="10" rx="2"/><path d="M16 10h4l3 3v4h-7z"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/></svg>
            </div>
            <h2>¿Ya estás en la puerta?</h2>
            <p>Toca el botón para avisar a portería. Vamos a tomar tu ubicación GPS.</p>
            <button class="big-btn" onclick="App.markArrival(this)">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              Estoy en puerta
            </button>
          </div>
        </div>`;
    } else if (cStep === "datos") {
      const gps = cGPS
        ? `<div class="gps-card"><div class="ic ok"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
             <div><b>Ubicación registrada</b><div class="co">${cGPS.lat.toFixed(5)}, ${cGPS.lng.toFixed(5)} · ±${Math.round(cGPS.acc)}m · a ${distTxt(haversine(cGPS, PLANTA))} de la planta</div></div></div>`
        : `<div class="gps-card err"><div class="ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg></div>
             <div><b>Ubicación aproximada</b><div class="co">No se pudo leer el GPS. Se usará una ubicación cercana a la planta.</div></div></div>`;
      v.innerHTML = `
        <div class="c-wrap">
          <div class="steps"><div class="s done"></div><div class="s on"></div><div class="s"></div></div>
          ${gps}
          <div class="field"><label>Nombre completo</label><input id="fNombre" placeholder="Ej: Juan Carlos Pérez" autocomplete="off"></div>
          <div class="field"><label>Cédula</label><input id="fCedula" inputmode="numeric" placeholder="Ej: 1010234567" autocomplete="off"></div>
          <div class="field"><label>Placa del vehículo</label><input id="fPlaca" placeholder="Ej: SXK482" style="text-transform:uppercase;letter-spacing:2px;font-weight:700" maxlength="6" autocomplete="off" oninput="this.value=this.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase()"><div style="font-size:11px;color:var(--gris);margin-top:4px">Se pone en mayúscula sola · 6 caracteres (ej: SXK482)</div></div>
          <div class="field"><label>Empresa / motivo</label><input id="fMotivo" placeholder="Ej: Transportes ABC · Cargue" autocomplete="off"></div>
          <div class="field"><label>Tipo de vehículo</label>
            <div style="display:flex;gap:8px">
              <select id="fTipo" style="flex:1">${getTipos().map(t => `<option>${esc(t)}</option>`).join("")}</select>
              <button type="button" title="Agregar tipo" onclick="App.addTipo()" style="flex:none;width:50px;border:1.5px solid var(--linea);background:#fff;border-radius:12px;font-size:24px;line-height:1;color:var(--azul);cursor:pointer">+</button>
            </div></div>
          <button class="big-btn" id="cSend" onclick="App.submitConductor(this)">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            Avisar a portería
          </button>
        </div>`;
    } else if (cStep === "enviado") {
      const r = data.find(x => x.id === myId);
      if (!r) { cStep = "inicio"; myId = null; localStorage.removeItem("cp_myId"); return renderConductor(); }
      if (r.estado === "rechazado") {
        v.innerHTML = `<div class="c-wrap"><div class="c-hero"><div class="gate-ic err">✕</div><h2>Ingreso no autorizado</h2>
          <p>Portería no autorizó el ingreso de <b>${esc(r.placa)}</b>. Acércate a portería o intenta de nuevo.</p>
          <button class="big-btn" onclick="App.newConductor()">Registrar de nuevo</button></div></div>`;
        return;
      }
      const t = tiempos(r);
      const curIdx = r.estado === "puerta" ? 0 : r.estado === "planta" ? 1 : 2;
      const done = r.estado === "cerrado";
      const stages = [
        { t: "En puerta", d: "Portería recibió tu aviso · " + fmtHM(D(r.t_puerta)) },
        { t: "Inicio de cargue", d: r.t_ingreso ? "Cargue iniciado · " + fmtHM(D(r.t_ingreso)) : "Esperando autorización de portería…" },
        { t: "Fin de cargue", d: r.t_salida ? "Cerrado · " + fmtHM(D(r.t_salida)) : "En cargue…" }
      ];
      let tl = "";
      stages.forEach((s, i) => {
        const cls = i < curIdx ? "done" : (i === curIdx ? (done ? "done" : "now") : "pending");
        const ic = (i < curIdx || (i === curIdx && done))
          ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
          : (i === curIdx ? '•' : '');
        tl += `<div class="node ${cls}"><div class="mk">${ic}</div><div class="tt">${s.t}</div><div class="ds">${s.d}</div></div>`;
      });
      v.innerHTML = `
        <div class="c-wrap">
          <div class="steps"><div class="s done"></div><div class="s done"></div><div class="s ${done ? 'done' : 'on'}"></div></div>
          <div class="plate-show"><div class="plate">${esc(r.placa)}</div><small>${esc(r.nombre)} · CC ${esc(r.cedula)}</small></div>
          <div class="tl">${tl}</div>
          ${done ? `
            <div class="cargo-box"><div class="l">Salió con</div>${esc(r.salida_tipo || "—")}${r.salida_detalle ? " · " + esc(r.salida_detalle) : ""}</div>
            <div class="c-times">
              <div class="ct"><span>Espera en puerta</span><b>${durTxt(t.espera)}</b></div>
              <div class="ct"><span>Tiempo de cargue</span><b>${durTxt(t.planta)}</b></div>
              <div class="ct"><span>Ciclo total</span><b>${durTxt(t.ciclo)}</b></div>
            </div>
            <p class="c-ok">✅ Proceso completado</p>
            <button class="big-btn green" onclick="App.newConductor()">Registrar otro vehículo</button>`
          : `<p class="c-wait">Portería está gestionando tu ingreso. Esta pantalla se actualiza sola. ⏳</p>`}
        </div>`;
    }
  }
  function markArrival(btn) {
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Obteniendo ubicación…';
    const go = () => { cStep = "datos"; renderConductor(); };
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(
      p => { cGPS = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy || 30 }; go(); },
      () => { cGPS = null; go(); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
    else { cGPS = null; go(); }
  }
  async function submitConductor(btn) {
    const nombre = el("fNombre").value.trim().toUpperCase(), cedula = el("fCedula").value.trim(), placa = el("fPlaca").value.trim().toUpperCase();
    const motivo = el("fMotivo").value.trim().toUpperCase(), tipo = el("fTipo").value;
    let bad = false;
    [["fNombre", nombre], ["fCedula", cedula], ["fPlaca", placa], ["fMotivo", motivo]].forEach(([id, val]) => { el(id).style.borderColor = val ? "" : "var(--rojo)"; if (!val) bad = true; });
    if (bad) { toast("blue", "Faltan datos", "Todos los campos son obligatorios."); return; }
    if (!/^[A-Z0-9]{6}$/.test(placa)) { el("fPlaca").style.borderColor = "var(--rojo)"; toast("blue", "Placa inválida", "La placa debe tener 6 caracteres (ej: SXK482)."); return; }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Enviando…';
    const loc = cGPS || { lat: PLANTA.lat + (Math.random() - .5) * .004, lng: PLANTA.lng + (Math.random() - .5) * .004, acc: 25, sim: true };
    const rec = {
      id: Store.uuid(), folio: "IN-" + String(Date.now()).slice(-5),
      nombre, cedula, placa, motivo: motivo || "—", tipo,
      lat: loc.lat, lng: loc.lng, gps_sim: !!loc.sim, estado: "puerta",
      t_puerta: new Date().toISOString(), t_ingreso: null, t_salida: null,
      salida_tipo: null, salida_detalle: null, salida_doc: null
    };
    try {
      const saved = await Store.insert(rec);
      myId = saved.id || rec.id; localStorage.setItem("cp_myId", myId);
      cStep = "enviado"; await refresh();
      toast("green", "✅ Aviso enviado", "Portería ya ve tu vehículo en puerta.");
    } catch (e) { btn.disabled = false; btn.innerHTML = "Avisar a portería"; toast("blue", "No se pudo enviar", "Revisa la conexión e inténtalo otra vez."); }
  }
  function newConductor() { cStep = "inicio"; cGPS = null; myId = null; localStorage.removeItem("cp_myId"); renderConductor(); }

  /* ===================== FÁBRICA ===================== */
  function setTab(t, elm) { tab = t; document.querySelectorAll(".ftab").forEach(x => x.classList.remove("on")); if (elm) elm.classList.add("on"); renderFabrica(); }
  function renderFabrica() {
    const puerta = data.filter(r => r.estado === "puerta"), planta = data.filter(r => r.estado === "planta"), cerrado = data.filter(r => r.estado === "cerrado");
    el("tabPuerta").textContent = puerta.length; el("tabPlanta").textContent = planta.length; el("tabCerrado").textContent = cerrado.length;
    const body = el("fabBody");
    const list = tab === "puerta" ? puerta : tab === "planta" ? planta : cerrado;
    if (!list.length) {
      body.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="7" width="15" height="10" rx="2"/><path d="M16 10h4l3 3v4h-7z"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/></svg>
        <p>${tab === "puerta" ? "No hay vehículos en puerta." : tab === "planta" ? "No hay vehículos dentro de la planta." : "Aún no hay vehículos cerrados."}</p></div>`;
      return;
    }
    body.innerHTML = `<div class="vgrid">${list.map(cardHTML).join("")}</div>`;
  }
  function cardHTML(v) {
    const st = { puerta: ["st-puerta", "En puerta"], planta: ["st-planta", "En planta"], cerrado: ["st-cerrado", "Cerrado"] }[v.estado];
    const t = tiempos(v);
    const esperaNow = v.estado === "puerta" ? diffMin(v.t_puerta, new Date().toISOString()) : t.espera;
    const demora = v.estado === "puerta" && esperaNow != null && esperaNow >= C.DEMORA_PUERTA_MIN;
    const dist = haversine({ lat: v.lat, lng: v.lng }, PLANTA);
    const mapUrl = `https://www.google.com/maps?q=${v.lat},${v.lng}`;
    let actions = "";
    if (v.estado === "puerta") actions = `<div class="vc-actions">
        <button class="btn btn-primary" onclick="App.autorizar('${v.id}')"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>Iniciar cargue</button>
        <button class="btn btn-ghost" title="Rechazar" onclick="App.rechazar('${v.id}')">✕</button></div>`;
    else if (v.estado === "planta") actions = `<div class="vc-actions">
        <button class="btn btn-green" onclick="App.openOut('${v.id}')"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>Fin de cargue</button></div>`;
    let cargo = "";
    if (v.estado === "cerrado") {
      const cats = catsOf(v);
      const body = cats.length
        ? cats.map(c => `<div class="catline"><b>${esc(c.cat)}</b>${c.items && c.items.length ? " · " + esc(c.items.map(itemLabel).join(", ")) : ""}${c.obs ? `<span class="obs">📝 ${esc(c.obs)}</span>` : ""}</div>`).join("")
        : esc(v.salida_tipo || "—");
      cargo = `<div class="cargo-box"><div class="l">Salió con</div>${body}${v.salida_doc ? `<div class="docline">📄 ${esc(v.salida_doc)}</div>` : ""}</div>`;
    }
    return `<div class="vcard${demora ? ' warn' : ''}">
      <div class="vc-top"><span class="plate">${esc(v.placa)}</span><span class="st-pill ${st[0]}"><span class="d"></span>${st[1]}${demora ? ' · demora' : ''}</span></div>
      <div class="vc-body">
        <div class="drow"><span class="k">Conductor</span><span class="v">${esc(v.nombre)}</span></div>
        <div class="drow"><span class="k">Cédula</span><span class="v">${esc(v.cedula)}</span></div>
        <div class="drow"><span class="k">Vehículo</span><span class="v">${esc(v.tipo || "—")}</span></div>
        <div class="drow"><span class="k">Motivo</span><span class="v">${esc(v.motivo || "—")}</span></div>
        <div class="loc-line"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${v.gps_sim ? "Aprox." : "GPS"}: ${(+v.lat).toFixed(4)}, ${(+v.lng).toFixed(4)} · ${distTxt(dist)}<a href="${mapUrl}" target="_blank" rel="noopener">Mapa ↗</a></div>
        <div class="times">
          <div class="tbox"><div class="l">Llegada</div><div class="n">${fmtHM(D(v.t_puerta))}</div></div>
          <div class="tbox"><div class="l">Inicio cargue</div><div class="n">${fmtHM(D(v.t_ingreso))}</div></div>
          <div class="tbox"><div class="l">Fin cargue</div><div class="n">${fmtHM(D(v.t_salida))}</div></div>
        </div>
        ${v.estado !== "puerta" ? `<div class="mini-int">${t.espera != null ? "Espera: <b>" + durTxt(t.espera) + "</b>" : ""}${t.planta != null ? " · En cargue: <b>" + durTxt(t.planta) + "</b>" : (v.estado === "planta" ? " · En cargue: <b>" + durTxt(diffMin(v.t_ingreso, new Date().toISOString())) + "</b>" : "")}</div>` : (esperaNow != null ? `<div class="mini-int">Esperando hace <b>${durTxt(esperaNow)}</b></div>` : "")}
        ${cargo}
      </div>${actions}</div>`;
  }
  async function autorizar(id) { await Store.update(id, { estado: "planta", t_ingreso: new Date().toISOString() }); await refresh(); const v = data.find(x => x.id === id); toast("blue", "🏭 Cargue iniciado", (v ? v.placa : "Vehículo") + " inició cargue."); }
  async function rechazar(id) { await Store.update(id, { estado: "rechazado" }); await refresh(); toast("amber", "Solicitud rechazada", "El conductor verá el aviso."); }
  function openOut(id) {
    outTargetId = id;
    const v = data.find(x => x.id === id);
    el("outSub").textContent = v ? v.placa + " · " + v.nombre : "Cierre";
    el("outBody").innerHTML = `
      <p class="out-hint">Marca todo con lo que sale el vehículo (puede ser varias). Cada categoría lleva su observación.</p>
      ${CATS.map(catCard).join("")}
      <div class="field" style="margin-top:14px"><label># Remisión / precinto (opcional)</label>
        <input id="outDoc" placeholder="Ej: REM-4521 · Precinto 00987" autocomplete="off"></div>`;
    el("outOverlay").classList.add("show");
  }
  function catCard(cat) {
    const subs = cat.subs ? `<div class="subitems">${cat.subs.map(s => `
      <div class="subitem">
        <label class="subck"><input type="checkbox" value="${esc(s)}" onchange="App.toggleSub(this)"><span>${esc(s)}</span></label>
        <input class="subcant" type="text" inputmode="numeric" placeholder="Cantidad" hidden>
      </div>`).join("")}</div>` : "";
    return `<div class="catrow" data-cat="${cat.key}">
      <label class="catchk"><input type="checkbox" onchange="App.toggleCat(this)"><b>${esc(cat.nombre)}</b></label>
      <div class="catdetail" hidden>${subs}<input class="catobs" placeholder="Observación de ${esc(cat.nombre)} (opcional)" autocomplete="off"></div>
    </div>`;
  }
  function toggleCat(input) {
    const row = input.closest(".catrow");
    row.classList.toggle("on", input.checked);
    row.querySelector(".catdetail").hidden = !input.checked;
  }
  function toggleSub(input) {
    const it = input.closest(".subitem");
    const cant = it.querySelector(".subcant");
    it.classList.toggle("on", input.checked);
    cant.hidden = !input.checked;
    if (input.checked) setTimeout(() => cant.focus(), 30);
  }
  function itemLabel(it) { if (it == null) return ""; if (typeof it === "string") return it; return it.sub + (it.cant ? " ×" + it.cant : ""); }
  function closeOut() { el("outOverlay").classList.remove("show"); outTargetId = null; }
  async function confirmOut() {
    if (!outTargetId) return closeOut();
    const cats = [];
    document.querySelectorAll("#outBody .catrow").forEach(row => {
      const chk = row.querySelector(".catchk input");
      if (!chk || !chk.checked) return;
      const def = CATS.find(c => c.key === row.getAttribute("data-cat"));
      const items = [...row.querySelectorAll(".subitem")]
        .filter(si => si.querySelector(".subck input") && si.querySelector(".subck input").checked)
        .map(si => ({ sub: si.querySelector(".subck input").value, cant: (si.querySelector(".subcant").value || "").trim() }));
      const obs = (row.querySelector(".catobs") && row.querySelector(".catobs").value || "").trim().toUpperCase();
      const items2 = items.map(it => ({ sub: it.sub, cant: (it.cant || "").toUpperCase() }));
      cats.push({ cat: def ? def.nombre : row.getAttribute("data-cat"), items: items2, obs });
    });
    // Todos los campos obligatorios: al menos una categoría, y cada subtipo marcado con su cantidad
    if (!cats.length) { toast("blue", "Falta información", "Selecciona al menos una categoría."); return; }
    for (const c of cats) {
      const def = CATS.find(d => d.nombre === c.cat);
      if (def && def.subs && c.items.length === 0) { toast("blue", "Falta información", "Marca al menos un subtipo en " + c.cat + "."); return; }
      for (const it of c.items) { if (!it.cant) { toast("blue", "Falta cantidad", "Escribe la cantidad de " + it.sub + " (" + c.cat + ")."); return; } }
    }
    const tipo = cats.map(c => c.cat).join(", ");
    const detalle = cats.map(c => c.cat + (c.items.length ? " (" + c.items.map(itemLabel).join(", ") + ")" : "") + (c.obs ? " — " + c.obs : "")).join(" | ");
    const doc = (el("outDoc") && el("outDoc").value || "").trim().toUpperCase();
    await Store.update(outTargetId, { estado: "cerrado", t_salida: new Date().toISOString(), salida_tipo: tipo, salida_detalle: detalle, salida_doc: doc, salida_categorias: cats });
    const id = outTargetId; closeOut(); await refresh();
    const v = data.find(x => x.id === id); toast("green", "✅ Fin de cargue", (v ? v.placa : "Vehículo") + " cerrado (" + tipo + ").");
  }

  /* ===================== INDICADORES (solo admin/premium) ===================== */
  function rangeStart() {
    if (indicFilter === "hoy") { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
    if (indicFilter === "7d") return new Date(Date.now() - 7 * 86400000);
    if (indicFilter === "30d") return new Date(Date.now() - 30 * 86400000);
    return null;
  }
  function inRange(r) { const s = rangeStart(); if (!s) return true; const t = r.t_salida || r.t_puerta; return t && new Date(t) >= s; }

  function renderIndicadores(box) {
    const puerta = data.filter(r => r.estado === "puerta");
    const planta = data.filter(r => r.estado === "planta");
    const cerrados = data.filter(r => r.estado === "cerrado" && inRange(r));
    const esperas = cerrados.map(r => tiempos(r).espera).filter(v => v != null);
    const plantas = cerrados.map(r => tiempos(r).planta).filter(v => v != null);
    const ciclos = cerrados.map(r => tiempos(r).ciclo).filter(v => v != null);
    const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
    const max = a => a.length ? Math.max(...a) : null;
    const demoras = cerrados.filter(r => { const e = tiempos(r).espera; return e != null && e >= C.DEMORA_PUERTA_MIN; }).length;
    const pctDem = cerrados.length ? Math.round(demoras * 100 / cerrados.length) : 0;
    let rapido = null, lento = null;
    cerrados.forEach(r => { const c = tiempos(r).ciclo; if (c == null) return; if (!rapido || c < tiempos(rapido).ciclo) rapido = r; if (!lento || c > tiempos(lento).ciclo) lento = r; });
    const chips = [["hoy", "Hoy"], ["7d", "7 días"], ["30d", "30 días"], ["todo", "Todo"]]
      .map(([k, l]) => `<button class="chip ${indicFilter === k ? 'on' : ''}" onclick="App.setIndicFilter('${k}')">${l}</button>`).join("");
    box.innerHTML = `
      <div class="dash">
        <div class="dash-head">
          <div><h3>Indicadores de tiempos</h3><small>Cuánto demoran los vehículos en cada etapa</small></div>
          <div class="exp-btns"><button class="btn-exp" onclick="App.exportCSV()">⬇️ CSV</button><button class="btn-exp xls" onclick="App.exportXLSX()">⬇️ Excel</button></div>
        </div>
        <div class="indic-filter">${chips}</div>
        <div class="dkpis">
          <div class="dkpi"><span class="l">Vehículos (periodo)</span><b class="azul">${cerrados.length}</b></div>
          <div class="dkpi"><span class="l">En cargue ahora</span><b class="azul">${planta.length}</b></div>
          <div class="dkpi"><span class="l">En puerta ahora</span><b class="ambar">${puerta.length}</b></div>
          <div class="dkpi"><span class="l">% con demora</span><b class="rojo">${pctDem}%</b></div>
        </div>
        <div class="dcards">
          <div class="dcard"><span class="l">⏳ Espera en puerta (prom.)</span><b>${durTxt(avg(esperas))}</b><small>máx ${durTxt(max(esperas))}</small></div>
          <div class="dcard"><span class="l">🏭 Tiempo de cargue (prom.)</span><b>${durTxt(avg(plantas))}</b><small>máx ${durTxt(max(plantas))}</small></div>
          <div class="dcard"><span class="l">🔄 Ciclo total (prom.)</span><b>${durTxt(avg(ciclos))}</b><small>máx ${durTxt(max(ciclos))}</small></div>
        </div>
        ${(rapido || lento) ? `<div class="hl-cards">
          ${rapido ? `<div class="hl fast"><span>⚡ Más rápido</span><b>${esc(rapido.placa)}</b><small>${durTxt(tiempos(rapido).ciclo)}</small></div>` : ""}
          ${lento ? `<div class="hl slow"><span>🐢 Más lento</span><b>${esc(lento.placa)}</b><small>${durTxt(tiempos(lento).ciclo)}</small></div>` : ""}
        </div>` : ""}
        <div class="chart-box"><canvas id="chart" height="150"></canvas></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Placa</th><th>Conductor</th><th>Llegada</th><th>Inicio cargue</th><th>Fin cargue</th><th>Espera</th><th>Cargue</th><th>Ciclo</th><th>Salió con</th></tr></thead>
          <tbody>${cerrados.length ? cerrados.map(rowHTML).join("") : '<tr><td colspan="9" class="tc-empty">No hay registros cerrados en este periodo.</td></tr>'}</tbody>
        </table></div>
      </div>`;
    drawChart(cerrados.slice(0, 12).reverse());
  }
  function setIndicFilter(f) { indicFilter = f; renderAdmin(); }
  function rowHTML(r) { const t = tiempos(r); const dem = t.espera != null && t.espera >= C.DEMORA_PUERTA_MIN;
    return `<tr><td><b>${esc(r.placa)}</b></td><td>${esc(r.nombre)}</td><td>${fmtHM(D(r.t_puerta))}</td><td>${fmtHM(D(r.t_ingreso))}</td><td>${fmtHM(D(r.t_salida))}</td><td class="${dem ? 'dem' : ''}">${durTxt(t.espera)}</td><td>${durTxt(t.planta)}</td><td>${durTxt(t.ciclo)}</td><td>${esc(r.salida_tipo || "—")}</td></tr>`; }
  function drawChart(rows) {
    const cv = el("chart"); if (!cv || !rows.length) return;
    const draw = () => { if (chart) { try { chart.destroy(); } catch (e) {} }
      chart = new Chart(cv.getContext("2d"), { type: "bar",
        data: { labels: rows.map(r => r.placa), datasets: [
          { label: "Espera en puerta (min)", data: rows.map(r => tiempos(r).espera || 0), backgroundColor: "#f0a500" },
          { label: "Tiempo en planta (min)", data: rows.map(r => tiempos(r).planta || 0), backgroundColor: "#1552d6" }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { font: { size: 10 } } } } } });
    };
    if (window.Chart) draw(); else { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"; s.onload = draw; document.head.appendChild(s); }
  }
  const estadoLabel = e => ({ puerta: "En puerta", planta: "En cargue", cerrado: "Cerrado" }[e] || e);
  const EXP_HEAD = ["Folio", "Placa", "Conductor", "Cédula", "Vehículo", "Estado", "Llegada", "Inicio cargue", "Fin cargue", "Espera (min)", "Cargue (min)", "Ciclo (min)", "Categoría", "Detalle", "Observación", "Remisión"];
  function rowsForExport() {
    const out = [];
    data.filter(r => r.estado !== "rechazado" && inRange(r)).forEach(r => {
      const t = tiempos(r);
      const U = v => (typeof v === "string" ? v.toUpperCase() : v);
      const mk = (categoria, detalle, obs) => [
        U(r.folio || ""), U(r.placa), U(r.nombre), U(r.cedula), U(r.tipo || ""), U(estadoLabel(r.estado)),
        U(fmtFull(D(r.t_puerta))), U(fmtFull(D(r.t_ingreso))), U(fmtFull(D(r.t_salida))),
        t.espera ?? "", t.planta ?? "", t.ciclo ?? "", U(categoria), U(detalle), U(obs), U(r.salida_doc || "")
      ];
      const cats = catsOf(r);
      if (cats.length) cats.forEach(c => out.push(mk(c.cat, (c.items || []).map(itemLabel).join(", "), c.obs || "")));
      else out.push(mk(r.estado === "cerrado" ? (r.salida_tipo || "Sin novedad") : "", "", ""));
    });
    return out;
  }
  function stamp() { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; }
  function periodoLabel() { return ({ hoy: "Hoy", "7d": "Últimos 7 días", "30d": "Últimos 30 días", todo: "Todo" }[indicFilter] || "Todo"); }
  function exportCSV() {
    const rows = rowsForExport(); if (!rows.length) return toast("blue", "Sin datos", "No hay registros para exportar.");
    const q = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
    const csv = "﻿" + [EXP_HEAD.map(h => h.toUpperCase()).join(","), ...rows.map(r => r.map(q).join(","))].join("\n");
    download(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `ControlPuerta_${stamp()}.csv`);
    toast("green", "CSV exportado", rows.length + " filas.");
  }
  function loadExcelJS() { return new Promise(res => { if (window.ExcelJS) return res(); const s = document.createElement("script"); s.src = "exceljs.min.js"; s.onload = res; s.onerror = res; document.head.appendChild(s); }); }
  async function iconBase64() {
    try { const r = await fetch("icon-512.png"); const b = await r.blob(); return await new Promise(rs => { const fr = new FileReader(); fr.onload = () => rs(String(fr.result).split(",")[1]); fr.onerror = () => rs(null); fr.readAsDataURL(b); }); }
    catch (e) { return null; }
  }
  async function exportXLSX() {
    const rows = rowsForExport(); if (!rows.length) return toast("blue", "Sin datos", "No hay registros para exportar.");
    toast("blue", "Generando Excel…", "Armando el reporte con diseño.");
    await loadExcelJS();
    if (!window.ExcelJS) return toast("blue", "No se pudo cargar Excel", "Usa la exportación CSV.");
    try { await buildBrandedXlsx(rows); }
    catch (e) { console.error(e); toast("blue", "Error al exportar", (e && e.message) || "Usa CSV."); }
  }
  async function buildBrandedXlsx(rows) {
    const BLUE = "FF1552D6", DARK = "FF0B2F7A", SLATE = "FF334155", HEADFILL = "FFEAF1FF", ZEBRA = "FFF6F9FF", LINE = "FFE2E7EF", CARD = "FFF9FBFF";
    const bd = a => ({ style: "thin", color: { argb: a } });
    const box = a => ({ top: bd(a), left: bd(a), bottom: bd(a), right: bd(a) });

    const src = data.filter(r => r.estado !== "rechazado" && inRange(r));
    const cerr = src.filter(r => r.estado === "cerrado");
    const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
    const cargas = cerr.map(r => tiempos(r).planta).filter(v => v != null);
    const esp = cerr.map(r => tiempos(r).espera).filter(v => v != null);
    const dem = cerr.filter(r => { const e = tiempos(r).espera; return e != null && e >= C.DEMORA_PUERTA_MIN; }).length;
    const kpis = [
      { l: "Vehículos", v: String(src.length) },
      { l: "Tiempo cargue prom.", v: durTxt(avg(cargas)) },
      { l: "Espera prom.", v: durTxt(avg(esp)) },
      { l: "% con demora", v: (cerr.length ? Math.round(dem * 100 / cerr.length) : 0) + "%" }
    ];

    const wb = new ExcelJS.Workbook();
    wb.creator = "ControlPuerta";
    const ws = wb.addWorksheet("Movimientos", { views: [{ showGridLines: false, state: "frozen", ySplit: 9 }] });
    const widths = [11, 12, 22, 13, 12, 11, 17, 17, 17, 11, 12, 11, 18, 26, 30, 20];
    ws.getColumn(1).width = 3;
    widths.forEach((w, i) => ws.getColumn(i + 2).width = w);

    // Logo (embebido)
    try {
      let b64 = window.LOGO_B64 || null;
      if (!b64) b64 = await iconBase64();
      if (b64) { const id = wb.addImage({ base64: b64, extension: "png" }); ws.addImage(id, { tl: { col: 1.15, row: 0.4 }, ext: { width: 62, height: 62 } }); }
    } catch (e) { console.error("logo", e); }

    ws.mergeCells("D2:J2"); const t1 = ws.getCell("D2"); t1.value = "ControlPuerta"; t1.font = { size: 20, bold: true, color: { argb: DARK } };
    ws.mergeCells("D3:J3"); const t2 = ws.getCell("D3"); t2.value = "Reporte de movimientos en planta"; t2.font = { size: 11, color: { argb: SLATE } };
    ws.mergeCells("D4:M4"); const t3 = ws.getCell("D4"); t3.value = "Periodo: " + periodoLabel() + "   ·   Generado " + fmtFull(new Date()); t3.font = { size: 9, color: { argb: "FF7A8699" } };

    // KPIs (fila 6-7), 4 tarjetas
    const spans = [["B", "E"], ["F", "I"], ["J", "M"], ["N", "Q"]];
    ws.getRow(6).height = 18; ws.getRow(7).height = 20;
    kpis.forEach((k, i) => {
      const [a, z] = spans[i];
      ws.mergeCells(`${a}6:${z}7`);
      const cell = ws.getCell(`${a}6`);
      cell.value = { richText: [{ text: k.l + "\n", font: { size: 9, color: { argb: SLATE } } }, { text: k.v, font: { size: 15, bold: true, color: { argb: BLUE } } }] };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CARD } };
      cell.border = box(LINE);
    });

    // Encabezados tabla (fila 9)
    const HR = 9;
    EXP_HEAD.forEach((h, i) => {
      const c = ws.getCell(HR, i + 2);
      c.value = h.toUpperCase(); c.font = { size: 9, bold: true, color: { argb: SLATE } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADFILL } };
      c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      c.border = { bottom: bd(BLUE), top: bd(LINE) };
    });
    ws.getRow(HR).height = 22;

    rows.forEach((row, ri) => {
      const r = HR + 1 + ri;
      row.forEach((val, ci) => {
        const c = ws.getCell(r, ci + 2);
        c.value = (val === "" || val == null) ? null : val;
        c.font = { size: 10, color: { argb: "FF1F2937" } };
        c.alignment = { vertical: "middle", horizontal: (ci >= 9 && ci <= 11) ? "center" : "left", wrapText: (ci === 13 || ci === 14) };
        c.border = { bottom: bd(LINE) };
        if (ri % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      });
      const pc = ws.getCell(r, 3); pc.font = { size: 10, bold: true, color: { argb: DARK } };
      const cat = ws.getCell(r, 14); cat.font = { size: 10, bold: true, color: { argb: BLUE } };
    });

    const buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `ControlPuerta_Reporte_${stamp()}.xlsx`);
    toast("green", "Excel exportado", rows.length + " filas con diseño.");
  }
  function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

  /* ===================== ADMINISTRADOR ===================== */
  function renderAdmin() {
    const body = el("adminBody");
    body.innerHTML = `
      <div class="admin">
        <div class="admin-hero">
          <div class="ah-ic">👑</div>
          <div><h2>Panel de Administrador</h2><small>Usuarios e indicadores de la operación</small></div>
        </div>
        <div class="admin-tabs">
          <button class="atab ${adminTab === 'usuarios' ? 'on' : ''}" onclick="App.setAdminTab('usuarios')">👥 Usuarios</button>
          <button class="atab ${adminTab === 'indicadores' ? 'on' : ''}" onclick="App.setAdminTab('indicadores')">📊 Indicadores</button>
          <button class="atab ${adminTab === 'inventario' ? 'on' : ''}" onclick="App.setAdminTab('inventario')">📦 Inventario</button>
        </div>
        <div id="adminContent"></div>
      </div>`;
    if (adminTab === "indicadores") renderIndicadores(el("adminContent"));
    else if (adminTab === "inventario") renderInventario(el("adminContent"));
    else renderAdminUsuarios(el("adminContent"));
  }
  function setAdminTab(t) { adminTab = t; renderAdmin(); }
  function renderAdminUsuarios(box) {
    const activos = usuarios.filter(u => u.activo !== false).length;
    box.innerHTML = `
      <div class="admin-kpis">
        <div class="akpi"><span>Usuarios</span><b>${usuarios.length}</b></div>
        <div class="akpi"><span>Activos</span><b class="verde">${activos}</b></div>
        <div class="akpi"><span>Inactivos</span><b class="gris">${usuarios.length - activos}</b></div>
      </div>
      <div class="admin-actions">
        <h3>Usuarios</h3>
        <button class="btn-add" onclick="App.openUser()">＋ Nuevo usuario</button>
      </div>
      ${usuarios.length ? `<div class="ulist">${usuarios.map(userRow).join("")}</div>` : `
        <div class="empty small"><p>Aún no has creado usuarios.<br>Crea el primero con <b>＋ Nuevo usuario</b>. Cada uno entra con su propio PIN.</p></div>`}
      <p class="admin-note">👑 Los usuarios tipo <b>Administrador (premium)</b> entran a este panel con su propio PIN. El PIN maestro está en <b>config.js</b> (ADMIN_PIN).</p>`;
  }
  function userRow(u) {
    const act = u.activo !== false;
    return `<div class="ucard ${act ? '' : 'off'}">
      <div class="uav">${esc((u.nombre || "?").trim().charAt(0).toUpperCase())}</div>
      <div class="uinfo"><b>${esc(u.nombre)}</b><span>${u.rol === "admin" ? "👑 " : ""}${esc(u.cargo || (u.rol === "admin" ? "Administrador" : "Portería"))} · PIN ${esc(u.pin)}</span></div>
      <div class="ubadge ${act ? 'on' : ''}">${act ? "Activo" : "Inactivo"}</div>
      <div class="uacts">
        <button title="${act ? 'Desactivar' : 'Activar'}" onclick="App.toggleUser('${u.id}')">${act ? '⏸' : '▶'}</button>
        <button title="Editar" onclick="App.openUser('${u.id}')">✎</button>
        <button title="Eliminar" class="del" onclick="App.deleteUser('${u.id}')">🗑</button>
      </div></div>`;
  }
  function openUser(id) {
    editUserId = id || null;
    const u = id ? usuarios.find(x => x.id === id) : null;
    el("userTitle").textContent = u ? "Editar usuario" : "Nuevo usuario";
    el("uNombre").value = u ? u.nombre : "";
    el("uCargo").value = u ? (u.cargo || "") : "";
    el("uPin").value = u ? u.pin : "";
    el("uActivo").checked = u ? (u.activo !== false) : true;
    if (el("uRol")) el("uRol").value = (u && u.rol === "admin") ? "admin" : "porteria";
    el("uErr").hidden = true;
    el("userOverlay").classList.add("show");
    setTimeout(() => el("uNombre").focus(), 100);
  }
  function closeUser() { el("userOverlay").classList.remove("show"); editUserId = null; }
  async function saveUser() {
    const nombre = el("uNombre").value.trim().toUpperCase(), cargo = el("uCargo").value.trim().toUpperCase(), pin = el("uPin").value.trim(), activo = el("uActivo").checked;
    const rol = el("uRol") ? el("uRol").value : "porteria";
    const err = m => { const e = el("uErr"); e.textContent = m; e.hidden = false; };
    if (!nombre) return err("Escribe el nombre.");
    if (!/^\d{3,10}$/.test(pin)) return err("El PIN debe tener de 3 a 10 dígitos.");
    if (String(pin) === String(C.ADMIN_PIN)) return err("Ese PIN es el del administrador, usa otro.");
    const dup = usuarios.find(u => String(u.pin) === pin && u.id !== editUserId);
    if (dup) return err("Ese PIN ya lo usa " + dup.nombre + ".");
    const saveBtn = document.querySelector("#userOverlay .btn-primary");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Guardando…"; }
    try {
      if (editUserId) { await Users.update(editUserId, { nombre, cargo, pin, activo, rol }); toast("green", "Usuario actualizado", nombre); }
      else { await Users.insert({ nombre, cargo, pin, activo, rol, created_at: new Date().toISOString() }); toast("green", "Usuario creado", nombre + (rol === "admin" ? " (Admin) " : " ") + "ya puede entrar con su PIN."); }
      closeUser(); await refreshUsers();
    } catch (e) {
      err("No se pudo guardar: " + (e && e.message ? e.message : e) + ". Revisa tu conexión o que la tabla 'usuarios' exista en Supabase.");
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Guardar"; }
    }
  }
  async function toggleUser(id) { const u = usuarios.find(x => x.id === id); if (!u) return; await Users.update(id, { activo: !(u.activo !== false) }); await refreshUsers(); }
  async function deleteUser(id) { const u = usuarios.find(x => x.id === id); if (!u) return; if (!confirm("¿Eliminar a " + u.nombre + "?")) return; await Users.remove(id); await refreshUsers(); toast("amber", "Usuario eliminado", u.nombre); }

  /* ===================== INVENTARIO · Existencias + Movimientos (entradas/salidas) =====================
     El PATRÓN por estiba (ancho×fondo×alto) define cuántas cajas arma una estiba completa (editable).
     El STOCK de cada envase = ENTRADAS − SALIDAS (pestaña Movimientos).
     El escáner suma ENTRADAS; también puedes registrar SALIDAS.  */
  const INV_ENVASES = VIDRIO_SUBS.slice(); // canastas de vidrio por tipo de lavado
  const INV_PATRON_DEF = { "250": { a: 3, f: 3, h: 5 }, "330": { a: 3, f: 3, h: 5 }, "320": { a: 3, f: 3, h: 5 }, "1.000": { a: 3, f: 3, h: 4 }, "175": { a: 3, f: 3, h: 6 } };
  function invSizeOf(sub) { const m = String(sub).match(/1\.000|250|330|320|175/); return m ? m[0] : "330"; }
  function invGetTricaje() {
    let saved = {}; try { saved = JSON.parse(localStorage.getItem("cp_tricaje") || "{}") || {}; } catch (e) {}
    const out = {};
    INV_ENVASES.forEach(sub => {
      const def = INV_PATRON_DEF[invSizeOf(sub)] || { a: 3, f: 3, h: 5 };
      const s = saved[sub] || {};
      out[sub] = { a: +s.a || def.a, f: +s.f || def.f, h: +s.h || def.h };
    });
    return out;
  }
  function invSaveTricaje(t) { localStorage.setItem("cp_tricaje", JSON.stringify(t)); }

  /* ---- Movimientos (entradas / salidas) ---- */
  function movUuid() { try { if (Store.uuid) return Store.uuid(); } catch (e) {} return "m" + Date.now() + Math.floor(Math.random() * 1e6); }
  function movGet() { try { const a = JSON.parse(localStorage.getItem("cp_mov") || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function movSave(a) { localStorage.setItem("cp_mov", JSON.stringify(a)); }
  function movAdd(m) {
    const a = movGet();
    a.push({ id: movUuid(), ts: new Date().toISOString(), tipo: m.tipo === "salida" ? "salida" : "entrada", sub: m.sub, cajas: Math.max(0, Math.floor(+m.cajas || 0)), nota: (m.nota || "").toUpperCase(), origen: m.origen || "manual" });
    movSave(a); return a;
  }
  function movRemove(id) { movSave(movGet().filter(x => x.id !== id)); }
  function movTotals() {
    const t = {}; INV_ENVASES.forEach(s => t[s] = { ent: 0, sal: 0 });
    movGet().forEach(m => { if (!t[m.sub]) t[m.sub] = { ent: 0, sal: 0 }; if (m.tipo === "salida") t[m.sub].sal += +m.cajas || 0; else t[m.sub].ent += +m.cajas || 0; });
    return t;
  }

  let invTab = "existencias"; // 'existencias' | 'movimientos'
  let movFilter = "todo";
  function setInvTab(t) { invTab = t; renderInventario(el("adminContent")); }
  function renderInventario(box) {
    box.innerHTML = `
      <div class="inv">
        <div class="inv-head">
          <div><h3>Inventario</h3><small>Existencias por patrón de estiba · entradas y salidas</small></div>
          <div class="exp-btns"><button class="btn-exp scan" onclick="App.openScan()">📷 Escáner</button></div>
        </div>
        <div class="inv-subtabs">
          <button class="istab ${invTab === 'existencias' ? 'on' : ''}" onclick="App.setInvTab('existencias')">📦 Existencias</button>
          <button class="istab ${invTab === 'movimientos' ? 'on' : ''}" onclick="App.setInvTab('movimientos')">🔄 Movimientos</button>
        </div>
        <div id="invSub"></div>
      </div>`;
    if (invTab === "movimientos") renderMovimientos(el("invSub"));
    else renderExistencias(el("invSub"));
  }
  function renderExistencias(box) {
    const tri = invGetTricaje(), tt = movTotals();
    const groups = [];
    INV_ENVASES.forEach(sub => { const marca = sub.split(" ")[0]; let g = groups.find(x => x.marca === marca); if (!g) { g = { marca, subs: [] }; groups.push(g); } g.subs.push(sub); });
    let grand = 0;
    const rowHTML = sub => {
      const t = tri[sub], per = t.a * t.f * t.h, x = tt[sub] || { ent: 0, sal: 0 }, st = x.ent - x.sal, s2 = esc(sub); grand += st;
      return `<tr data-sub="${s2}">
        <td class="inv-name">${s2}</td>
        <td><input class="inv-i pat" type="number" min="1" step="1" value="${t.a}" data-k="a" oninput="App.invRecalc()"></td>
        <td class="inv-x">×</td>
        <td><input class="inv-i pat" type="number" min="1" step="1" value="${t.f}" data-k="f" oninput="App.invRecalc()"></td>
        <td class="inv-x">×</td>
        <td><input class="inv-i pat" type="number" min="1" step="1" value="${t.h}" data-k="h" oninput="App.invRecalc()"></td>
        <td class="inv-tot"><b>${per}</b></td>
        <td class="inv-ent">${x.ent.toLocaleString("es-CO")}</td>
        <td class="inv-sal">${x.sal.toLocaleString("es-CO")}</td>
        <td class="inv-sub"><b>${st.toLocaleString("es-CO")}</b></td>
      </tr>`;
    };
    const blocks = groups.map(g => `<tr class="inv-grp"><td colspan="10">${esc(g.marca)}</td></tr>${g.subs.map(rowHTML).join("")}`).join("");
    box.innerHTML = `
      <button class="scan-cta" onclick="App.openScan()"><span class="sc-ic">📷</span><span class="sc-tx"><b>Escanear estiba con la cámara</b><small>Cuenta y suma como ENTRADA al inventario</small></span><span class="sc-go">›</span></button>
      <div class="inv-grand"><span>📦 Stock total (entradas − salidas)</span><b id="invGrand">${grand.toLocaleString("es-CO")}</b></div>
      <div class="inv-wrap"><table class="inv-tbl" id="invTable">
        <thead><tr>
          <th class="l">Tipo de lavado</th><th>Ancho</th><th></th><th>Fondo</th><th></th><th>Alto</th>
          <th class="hl">× estiba</th><th>Entradas</th><th>Salidas</th><th class="hl">Stock</th>
        </tr></thead>
        <tbody>${blocks}</tbody>
      </table></div>
      <div class="exp-btns" style="margin-top:12px"><button class="btn-exp" onclick="App.invExport()">⬇️ Exportar existencias</button></div>
      <p class="inv-note">💡 El <b>Stock</b> = Entradas − Salidas (ver pestaña 🔄 Movimientos). El <b>× estiba</b> = ancho × fondo × alto y es editable; el escáner lo usa para contar.</p>`;
  }
  function invRecalc() {
    const tri = {};
    document.querySelectorAll("#invTable tr[data-sub]").forEach(tr => {
      const sub = tr.getAttribute("data-sub");
      const gv = k => { const i = tr.querySelector('.inv-i[data-k="' + k + '"]'); return i ? i.value : ""; };
      const a = Math.max(1, Math.floor(+gv("a") || 1)), f = Math.max(1, Math.floor(+gv("f") || 1)), h = Math.max(1, Math.floor(+gv("h") || 1));
      tri[sub] = { a, f, h };
      const tb = tr.querySelector(".inv-tot b"); if (tb) tb.textContent = a * f * h;
    });
    invSaveTricaje(tri);
  }
  function invExport() {
    const tri = invGetTricaje(), tt = movTotals();
    const head = ["TIPO DE LAVADO", "ANCHO", "FONDO", "ALTO", "CAJAS X ESTIBA", "ENTRADAS", "SALIDAS", "STOCK"];
    const rows = []; let ge = 0, gs = 0, gk = 0;
    INV_ENVASES.forEach(sub => { const t = tri[sub], per = t.a * t.f * t.h, x = tt[sub] || { ent: 0, sal: 0 }, st = x.ent - x.sal; ge += x.ent; gs += x.sal; gk += st; rows.push([sub.toUpperCase(), t.a, t.f, t.h, per, x.ent, x.sal, st]); });
    rows.push(["TOTAL", "", "", "", "", ge, gs, gk]);
    const q = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
    const csv = "﻿" + [head.join(","), ...rows.map(r => r.map(q).join(","))].join("\n");
    download(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `ControlPuerta_Existencias_${stamp()}.csv`);
    toast("green", "Existencias exportadas", gk.toLocaleString("es-CO") + " cajas en stock.");
  }
  function setMovFilter(f) { movFilter = f; renderMovimientos(el("invSub")); }
  function renderMovimientos(box) {
    const all = movGet().slice().sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const list = all.filter(m => movFilter === "todo" ? true : m.tipo === movFilter);
    const opts = INV_ENVASES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    const chips = [["todo", "Todo"], ["entrada", "Entradas"], ["salida", "Salidas"]].map(([k, l]) => `<button class="chip ${movFilter === k ? 'on' : ''}" onclick="App.setMovFilter('${k}')">${l}</button>`).join("");
    const totEnt = all.filter(m => m.tipo !== "salida").reduce((s, m) => s + (+m.cajas || 0), 0);
    const totSal = all.filter(m => m.tipo === "salida").reduce((s, m) => s + (+m.cajas || 0), 0);
    const rowsHTML = list.length ? list.map(m => `
      <div class="mv-row ${m.tipo}">
        <div class="mv-ic">${m.tipo === "salida" ? "➖" : "➕"}</div>
        <div class="mv-main"><b>${esc(m.sub)}</b><small>${esc(fmtFull(D(m.ts)))}${m.origen === "escaner" ? " · 📷 escáner" : ""}${m.nota ? " · " + esc(m.nota) : ""}</small></div>
        <div class="mv-q ${m.tipo}">${m.tipo === "salida" ? "−" : "+"}${(+m.cajas).toLocaleString("es-CO")}</div>
        <button class="mv-del" title="Eliminar" onclick="App.movDel('${m.id}')">🗑</button>
      </div>`).join("") : `<div class="empty small"><p>Sin movimientos todavía.<br>Usa el 📷 escáner (entradas) o registra uno aquí.</p></div>`;
    box.innerHTML = `
      <div class="mv-kpis">
        <div class="mvk ent"><span>Entradas</span><b>${totEnt.toLocaleString("es-CO")}</b></div>
        <div class="mvk sal"><span>Salidas</span><b>${totSal.toLocaleString("es-CO")}</b></div>
        <div class="mvk stk"><span>Stock</span><b>${(totEnt - totSal).toLocaleString("es-CO")}</b></div>
      </div>
      <div class="mv-form">
        <select id="mvTipo"><option value="entrada">➕ Entrada</option><option value="salida">➖ Salida</option></select>
        <select id="mvSub">${opts}</select>
        <input id="mvCajas" type="number" min="1" inputmode="numeric" placeholder="Cajas">
        <input id="mvNota" placeholder="Nota / remisión (opcional)" style="text-transform:uppercase">
        <button class="btn-add" onclick="App.movAddManual()">Guardar</button>
      </div>
      <div class="mv-bar"><div class="indic-filter">${chips}</div><button class="btn-exp" onclick="App.movExport()">⬇️ CSV</button></div>
      <div class="mv-list">${rowsHTML}</div>`;
  }
  function movAddManual() {
    const tipo = el("mvTipo").value, sub = el("mvSub").value, cajas = Math.floor(+el("mvCajas").value || 0), nota = (el("mvNota").value || "").trim().toUpperCase();
    if (cajas <= 0) { toast("blue", "Falta la cantidad", "Escribe cuántas cajas."); return; }
    movAdd({ tipo, sub, cajas, nota, origen: "manual" });
    toast(tipo === "salida" ? "amber" : "green", tipo === "salida" ? "Salida registrada" : "Entrada registrada", (tipo === "salida" ? "−" : "+") + cajas + " " + sub + ".");
    renderMovimientos(el("invSub"));
  }
  function movDel(id) {
    const m = movGet().find(x => x.id === id); if (!m) return;
    if (!confirm("¿Eliminar este movimiento? (" + (m.tipo === "salida" ? "−" : "+") + m.cajas + " " + m.sub + ")")) return;
    movRemove(id); renderMovimientos(el("invSub")); toast("amber", "Movimiento eliminado", "");
  }
  function movExport() {
    const all = movGet().slice().sort((a, b) => (a.ts < b.ts ? 1 : -1));
    if (!all.length) return toast("blue", "Sin datos", "No hay movimientos.");
    const head = ["FECHA", "TIPO", "TIPO DE LAVADO", "CAJAS", "ORIGEN", "NOTA"];
    const q = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
    const rows = all.map(m => [fmtFull(D(m.ts)), m.tipo.toUpperCase(), m.sub.toUpperCase(), (m.tipo === "salida" ? "-" : "") + m.cajas, (m.origen || "").toUpperCase(), (m.nota || "").toUpperCase()]);
    const csv = "﻿" + [head.join(","), ...rows.map(r => r.map(q).join(","))].join("\n");
    download(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `ControlPuerta_Movimientos_${stamp()}.csv`);
    toast("green", "Movimientos exportados", all.length + " registros.");
  }

  /* ===================== ESCÁNER DE ESTIBAS (cámara + patrón) =====================
     Flujo: elige el tipo de lavado → toma la foto → aparece una grilla del patrón
     sobre la foto → ajusta Ancho/Fondo/Alto y descuenta Huecos/Malas con +/− →
     "Sumar al inventario" agrega las cajas contadas al total de ese envase.  */
  const scan = { sub: INV_ENVASES[0], mtipo: "entrada", est: 1, a: 3, f: 3, h: 5, extra: 0, gap: 0, bad: 0, img: null, log: [] };
  function scanPer() { return scan.a * scan.f * scan.h; }              // cajas por estiba completa (patrón)
  function scanNet() { return Math.max(0, scan.est * scanPer() + scan.extra - scan.gap - scan.bad); }
  function openScan() {
    const tri = invGetTricaje(), t = tri[scan.sub] || { a: 3, f: 3, h: 5 };
    scan.est = 1; scan.a = t.a; scan.f = t.f; scan.h = t.h; scan.extra = 0; scan.gap = 0; scan.bad = 0; scan.img = null;
    renderScan();
    el("scanOverlay").classList.add("show", "scan-full");
  }
  function closeScan() { el("scanOverlay").classList.remove("show", "scan-full"); }
  function scanSetTipo(v) { scan.mtipo = v === "salida" ? "salida" : "entrada"; renderScan(); }
  function scanPickSub(v) {
    scan.sub = v;
    const tri = invGetTricaje(), t = tri[v] || { a: 3, f: 3, h: 5 };
    scan.est = 1; scan.a = t.a; scan.f = t.f; scan.h = t.h; scan.extra = 0; scan.gap = 0; scan.bad = 0; scanRefresh();
  }
  const stepBtn = (t, d) => `<button type="button" class="stp" onclick="App.scanStep('${t}',${d})">${d > 0 ? '+' : '−'}</button>`;
  function stepper(label, key, hint, hl) {
    return `<div class="stp-row${hl ? ' hl' : ''}"><div class="stp-lab">${label}${hint ? `<small>${hint}</small>` : ""}</div>
      <div class="stp-ctl">${stepBtn(key, -1)}<span class="stp-val" id="sv-${key}">${scan[key]}</span>${stepBtn(key, 1)}</div></div>`;
  }
  function renderScan() {
    const opts = INV_ENVASES.map(s => `<option value="${esc(s)}"${s === scan.sub ? " selected" : ""}>${esc(s)}</option>`).join("");
    el("scanBody").innerHTML = `
     <div class="scan-2col">
      <div class="sc-left">
        <label class="scan-photo" id="scPhoto">
          <input type="file" accept="image/*" capture="environment" hidden onchange="App.scanPhoto(this)">
          <div class="sp-inner" id="spInner">
            <div class="sp-ic">📸</div>
            <b>Tomar foto de las estibas</b>
            <small>Encuadra el frente completo · detecta y cuenta solo</small>
          </div>
        </label>
        <button type="button" class="scan-detect" id="scDetectBtn" onclick="App.scanDetect()" hidden>🔍 Volver a escanear la foto</button>
      </div>
      <div class="sc-right">
        <div class="mtipo-tog">
          <button type="button" class="mt ent ${scan.mtipo === 'entrada' ? 'on' : ''}" onclick="App.scanSetTipo('entrada')">➕ Entrada</button>
          <button type="button" class="mt sal ${scan.mtipo === 'salida' ? 'on' : ''}" onclick="App.scanSetTipo('salida')">➖ Salida</button>
        </div>
        <div class="field"><label>Tipo de lavado a contar</label>
          <select id="scSub" onchange="App.scanPickSub(this.value)">${opts}</select></div>
        <div class="scan-steps">
          <div class="stp-lead">Estibas detectadas en la foto</div>
          <div class="stp-grid one">${stepper("Estibas", "est", "pilas en la foto", true)}</div>
          <div class="stp-lead">Patrón por estiba (editable)</div>
          <div class="stp-grid">
            ${stepper("Ancho", "a", "a lo ancho")}
            ${stepper("Fondo", "f", "de fondo")}
            ${stepper("Alto", "h", "de alto")}
          </div>
          <div class="stp-lead">Estiba mocha / cajas sueltas <small>(pilas incompletas)</small></div>
          <div class="mocha">
            <div class="mocha-in">
              <button type="button" class="stp" onclick="App.scanExtraAdd(-1)">−</button>
              <input id="sc-extra" type="number" min="0" inputmode="numeric" value="${scan.extra || ''}" placeholder="0" oninput="App.scanExtra(this)">
              <button type="button" class="stp" onclick="App.scanExtraAdd(1)">+</button>
            </div>
            <button type="button" class="mocha-hil" onclick="App.scanExtraHilera()">+1 hilera <small>(+<span id="scHil">${scan.a * scan.f}</span>)</small></button>
          </div>
          <div class="stp-lead">Descuentos</div>
          <div class="stp-grid two">
            ${stepper("Huecos", "gap", "espacios vacíos")}
            ${stepper("Malas", "bad", "cajas dañadas")}
          </div>
        </div>
        <div class="scan-res ${scan.mtipo}">
          <span id="scResLbl">Cajas contadas en la foto</span>
          <b id="scNet">${scanNet()}</b>
          <small id="scFormula"></small>
        </div>
        <div id="scLog" class="scan-log"></div>
      </div>
     </div>`;
    scanRefresh();
  }
  function scanUpdateNet() {
    const net = scanNet(), nb = el("scNet"); if (nb) nb.textContent = net.toLocaleString("es-CO");
    const per = scanPer(), ff = el("scFormula");
    if (ff) ff.textContent = `${scan.est} estiba(s) × ${per}${scan.extra ? ` + ${scan.extra} mocha/sueltas` : ""}${(scan.gap || scan.bad) ? ` − ${scan.gap + scan.bad}` : ""} = ${net}`;
  }
  function scanExtra(input) { scan.extra = clamp(Math.floor(+input.value || 0), 0, 99999); scanUpdateNet(); }
  function scanExtraAdd(d) { scan.extra = clamp(scan.extra + d, 0, 99999); const i = el("sc-extra"); if (i) i.value = scan.extra || ""; scanUpdateNet(); }
  function scanExtraHilera() { scanExtraAdd(scan.a * scan.f); }
  function scanStep(t, d) {
    const lim = { est: [1, 999], a: [1, 40], f: [1, 40], h: [1, 40], gap: [0, 9999], bad: [0, 9999] }[t] || [0, 9999];
    scan[t] = clamp((scan[t] || 0) + d, lim[0], lim[1]);
    scanRefresh();
  }
  function scanRefresh() {
    ["est", "a", "f", "h", "gap", "bad"].forEach(k => { const e = el("sv-" + k); if (e) e.textContent = scan[k]; });
    const hil = el("scHil"); if (hil) hil.textContent = scan.a * scan.f;
    scanUpdateNet();
    const sal = scan.mtipo === "salida";
    const ab = el("scanAdd"); if (ab) { ab.innerHTML = sal ? "➖ Registrar salida" : "➕ Sumar entrada"; ab.className = "btn-lg " + (sal ? "btn-salida" : "btn-green"); }
    const rl = el("scResLbl"); if (rl) rl.textContent = sal ? "Cajas que SALEN en la foto" : "Cajas que ENTRAN en la foto";
    const db = el("scDetectBtn"); if (db) db.hidden = !scan.img;
    drawScanGrid();
    const log = el("scLog");
    if (log) log.innerHTML = scan.log.length
      ? `<div class="sl-title">Movimientos de esta sesión</div>` + scan.log.map(x => `<div class="sl-row ${x.tipo}"><span>${x.tipo === "salida" ? "➖" : "➕"} ${esc(x.sub)}${x.est > 1 ? ` · ${x.est} estibas` : ""}</span><b>${x.tipo === "salida" ? "−" : "+"}${x.net}</b></div>`).join("")
      : "";
  }
  function scanPhoto(input) {
    const f = input.files && input.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { scan.img = r.result; scanRefresh(); scanDetect(); }; // escanea solo al tomar la foto
    r.readAsDataURL(f);
  }
  function drawScanGrid() {
    const inner = el("spInner"); if (!inner) return;
    if (!scan.img) return; // deja el placeholder
    const cols = clamp(scan.est * scan.a, 1, 60), rows = clamp(scan.h, 1, 40);
    let cells = "";
    for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
      const sep = (cc > 0 && cc % scan.a === 0) ? " est-sep" : "";
      cells += `<div class="gc${sep}"></div>`;
    }
    inner.innerHTML = `<div class="sp-photo"><img src="${scan.img}" alt="estibas">
      <div class="sp-grid" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)">${cells}</div>
      <div class="sp-badge">${scan.est} estiba(s) · ${scan.a}×${scan.h} cara · fondo ${scan.f}</div></div>`;
  }
  /* ---- auto-detección del patrón (autocorrelación de bordes, tipo escáner) ---- */
  function scanSmooth(a, k) { const n = a.length, o = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = -k; j <= k; j++) { const t = i + j; if (t >= 0 && t < n) { s += a[t]; c++; } } o[i] = s / c; } return o; }
  function scanPeriod(a, minL, maxL) {
    const n = a.length; let m = 0; for (let i = 0; i < n; i++) m += a[i]; m /= n;
    const z = new Float32Array(n); for (let i = 0; i < n; i++) z[i] = a[i] - m;
    let e = 0; for (let i = 0; i < n; i++) e += z[i] * z[i]; if (e < 1e-6) return null;
    const varz = e / n, sc = new Float32Array(maxL + 1);
    for (let L = minL; L <= maxL; L++) { let s = 0, c = 0; for (let i = 0; i + L < n; i++) { s += z[i] * z[i + L]; c++; } sc[L] = c ? (s / c) / varz : 0; }
    let smax = -1; for (let L = minL; L <= maxL; L++) if (sc[L] > smax) smax = sc[L];
    if (smax < 0.1) return null;
    const th = Math.max(0.78 * smax, 0.1);
    for (let L = minL + 1; L < maxL; L++) {
      if (sc[L] >= th && sc[L] >= sc[L - 1] && sc[L] >= sc[L + 1]) {
        const d = (sc[L - 1] - sc[L + 1]) / (2 * (sc[L - 1] - 2 * sc[L] + sc[L + 1]) || 1);
        return { L: L + clamp(d, -.5, .5), score: sc[L] };
      }
    }
    let bl = minL; for (let L = minL; L <= maxL; L++) if (sc[L] === smax) { bl = L; break; }
    return { L: bl, score: smax };
  }
  // Analiza SOLO cuántas estibas (pilas) hay a lo ancho. El patrón (alto/ancho/fondo)
  // no se toca: lo define el tipo de lavado. Se mira la banda central-baja (las canastas),
  // evitando el edificio/cielo de arriba y el piso de abajo.
  function scanDetectEstibas(img) {
    const N = 360, cv = document.createElement("canvas"); cv.width = N; cv.height = N;
    const cx = cv.getContext("2d"); cx.drawImage(img, 0, 0, N, N);
    const d = cx.getImageData(0, 0, N, N).data, g = new Float32Array(N * N);
    for (let i = 0, p = 0; i < N * N; i++, p += 4) g[i] = d[p] * .299 + d[p + 1] * .587 + d[p + 2] * .114;
    const y0 = Math.floor(N * 0.42), y1 = Math.floor(N * 0.93);   // franja de las canastas
    const x0 = Math.floor(N * 0.03), x1 = Math.floor(N * 0.97), W = x1 - x0;
    // Perfil de bordes VERTICALES por columna (marca los bordes entre canastas y entre estibas)
    const col = new Float32Array(W);
    for (let y = y0 + 1; y < y1 - 1; y++) for (let x = x0 + 1; x < x1 - 1; x++) {
      col[x - x0] += Math.abs(g[y * N + x + 1] - g[y * N + x - 1]);
    }
    const cs = scanSmooth(col, 3);
    // Periodo FINO = una canasta (columna). Rango amplio para no confundir con el edificio.
    const a = scanPeriod(cs, Math.floor(W / 22), Math.floor(W / 2.2));
    const colsCanastas = a ? clamp(Math.round(W / a.L), 1, 60) : null;
    return { cols: colsCanastas, conf: a ? a.score : 0 };
  }
  function scanDetect() {
    if (!scan.img) { toast("blue", "Primero toma la foto", "Toca “Tomar foto de las estibas”."); return; }
    const ph = document.querySelector(".sp-photo");
    if (ph && !ph.querySelector(".sp-scan")) {
      const o = document.createElement("div"); o.className = "sp-scan";
      o.innerHTML = '<div class="sp-laser"></div><div class="sp-analyzing">⣿ Escaneando estibas…</div>';
      ph.appendChild(o);
    }
    const img = new Image();
    img.onload = () => setTimeout(() => {
      let res = null; try { res = scanDetectEstibas(img); } catch (e) {}
      const o = document.querySelector(".sp-scan"); if (o) o.remove();
      if (res && res.cols && res.conf >= 0.12) {
        // estibas = columnas de canastas detectadas ÷ ancho del patrón
        scan.est = clamp(Math.round(res.cols / Math.max(1, scan.a)), 1, 30);
        scanRefresh();
        toast("green", "📷 Escaneo listo", "Detecté ≈ " + scan.est + " estiba(s) (" + Math.round(res.conf * 100) + "%). Cada una son " + scanPer() + ". Verifica el número.");
      } else {
        scanRefresh();
        toast("amber", "Cuenta las estibas", "No quedó claro. Pon cuántas pilas hay con el botón grande de Estibas.");
      }
    }, 1400);
    img.onerror = () => { const o = document.querySelector(".sp-scan"); if (o) o.remove(); toast("blue", "No pude leer la foto", "Intenta con otra."); };
    img.src = scan.img;
  }
  function scanAdd() {
    const net = scanNet();
    if (net <= 0) { toast("blue", "Nada que contar", "La cuenta da 0. Ajusta el patrón."); return; }
    const sal = scan.mtipo === "salida";
    movAdd({ tipo: scan.mtipo, sub: scan.sub, cajas: net, nota: scan.est + " estiba(s) escaneadas", origen: "escaner" });
    scan.log.unshift({ sub: scan.sub, net, est: scan.est, tipo: scan.mtipo });
    scan.img = null; scan.est = 1; scan.extra = 0; scan.gap = 0; scan.bad = 0;
    renderScan();
    if (adminTab === "inventario") { const box = el("adminContent"); if (box) renderInventario(box); }
    toast(sal ? "amber" : "green", sal ? "➖ Salida registrada" : "✅ Entrada registrada", (sal ? "−" : "+") + net + " cajas de " + scan.sub + ".");
  }

  /* ===================== TOASTS ===================== */
  function toast(type, title, msg) {
    const t = document.createElement("div");
    t.className = "toast " + (type === "green" ? "green" : type === "blue" ? "blue" : "amber");
    t.innerHTML = `<div class="tic"></div><div><b>${esc(title)}</b><span>${esc(msg)}</span></div>`;
    el("toasts").appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 350); }, 4000);
  }

  return {
    boot, enterRole, exitRole, askPin, closePin, checkPin,
    markArrival, submitConductor, newConductor,
    setTab, autorizar, rechazar, openOut, closeOut, confirmOut, exportCSV, exportXLSX,
    openUser, closeUser, saveUser, toggleUser, deleteUser, installApp, closeIos,
    setAdminTab, setIndicFilter, addTipo, toggleCat, toggleSub,
    invRecalc, invExport, setInvTab, setMovFilter, movAddManual, movDel, movExport,
    openScan, closeScan, scanPickSub, scanStep, scanPhoto, scanAdd, scanDetect, scanSetTipo,
    scanExtra, scanExtraAdd, scanExtraHilera
  };
})();

document.getElementById("btnExit").addEventListener("click", App.exitRole);
document.getElementById("pinInput").addEventListener("keydown", e => { if (e.key === "Enter") App.checkPin(); });
App.boot();
