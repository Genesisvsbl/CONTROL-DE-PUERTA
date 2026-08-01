/* ============================================================
   ControlPuerta — lógica principal
   Roles: conductor · fábrica (usuarios con PIN) · administrador
   ============================================================ */
const App = (function () {
  const C = window.CONFIG;
  const PLANTA = C.PLANTA;
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

  const $ = s => document.querySelector(s);
  const el = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, "0");
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
    else if (savedRole === "admin") openAdmin(true);
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
    el("roleLabel").textContent = "Administrador";
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
      if (v === String(C.ADMIN_PIN)) { closePin(); openAdmin(); }
      else { el("pinErr").hidden = false; }
      return;
    }
    // fábrica: valida contra usuarios activos, o PIN de respaldo
    const u = usuarios.find(x => String(x.pin) === v && x.activo !== false);
    if (u) { currentUser = { id: u.id, nombre: u.nombre }; sessionStorage.setItem("cp_user", JSON.stringify(currentUser)); closePin(); enterRole("fabrica"); }
    else if (v === String(C.PIN_FABRICA)) { currentUser = { nombre: "Portería" }; sessionStorage.setItem("cp_user", JSON.stringify(currentUser)); closePin(); enterRole("fabrica"); }
    else { el("pinErr").hidden = false; }
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
          <div class="field"><label>Placa del vehículo</label><input id="fPlaca" placeholder="Ej: SXK-482" style="text-transform:uppercase" maxlength="8" autocomplete="off"></div>
          <div class="field"><label>Empresa / motivo <small>(opcional)</small></label><input id="fMotivo" placeholder="Ej: Transportes ABC · Cargue" autocomplete="off"></div>
          <div class="field"><label>Tipo de vehículo</label>
            <select id="fTipo"><option>Tractocamión</option><option>Turbo / NHR</option><option>Camión sencillo</option><option>Furgón</option><option>Camioneta</option><option>Otro</option></select></div>
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
        { t: "Ingreso autorizado", d: r.t_ingreso ? "Entraste a planta · " + fmtHM(D(r.t_ingreso)) : "Esperando autorización de portería…" },
        { t: "Salida registrada", d: r.t_salida ? "Cerrado · " + fmtHM(D(r.t_salida)) : "Aún dentro de la planta" }
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
              <div class="ct"><span>Tiempo en planta</span><b>${durTxt(t.planta)}</b></div>
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
    const nombre = el("fNombre").value.trim(), cedula = el("fCedula").value.trim(), placa = el("fPlaca").value.trim().toUpperCase();
    const motivo = el("fMotivo").value.trim(), tipo = el("fTipo").value;
    let bad = false;
    [["fNombre", nombre], ["fCedula", cedula], ["fPlaca", placa]].forEach(([id, val]) => { el(id).style.borderColor = val ? "" : "var(--rojo)"; if (!val) bad = true; });
    if (bad) { toast("blue", "Faltan datos", "Completa nombre, cédula y placa."); return; }
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
    if (tab === "dashboard") return renderDashboard(body, cerrado, puerta, planta);
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
        <button class="btn btn-primary" onclick="App.autorizar('${v.id}')"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>Autorizar ingreso</button>
        <button class="btn btn-ghost" title="Rechazar" onclick="App.rechazar('${v.id}')">✕</button></div>`;
    else if (v.estado === "planta") actions = `<div class="vc-actions">
        <button class="btn btn-green" onclick="App.openOut('${v.id}')"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>Registrar salida</button></div>`;
    const cargo = v.estado === "cerrado" ? `<div class="cargo-box"><div class="l">Salió con</div>${esc(v.salida_tipo || "—")}${v.salida_detalle ? " — " + esc(v.salida_detalle) : ""}${v.salida_doc ? " · " + esc(v.salida_doc) : ""}</div>` : "";
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
          <div class="tbox"><div class="l">Ingreso</div><div class="n">${fmtHM(D(v.t_ingreso))}</div></div>
          <div class="tbox"><div class="l">Salida</div><div class="n">${fmtHM(D(v.t_salida))}</div></div>
        </div>
        ${v.estado !== "puerta" ? `<div class="mini-int">${t.espera != null ? "Espera: <b>" + durTxt(t.espera) + "</b>" : ""}${t.planta != null ? " · En planta: <b>" + durTxt(t.planta) + "</b>" : (v.estado === "planta" ? " · En planta: <b>" + durTxt(diffMin(v.t_ingreso, new Date().toISOString())) + "</b>" : "")}</div>` : (esperaNow != null ? `<div class="mini-int">Esperando hace <b>${durTxt(esperaNow)}</b></div>` : "")}
        ${cargo}
      </div>${actions}</div>`;
  }
  async function autorizar(id) { await Store.update(id, { estado: "planta", t_ingreso: new Date().toISOString() }); await refresh(); const v = data.find(x => x.id === id); toast("blue", "🏭 Ingreso autorizado", (v ? v.placa : "Vehículo") + " entró a la planta."); }
  async function rechazar(id) { await Store.update(id, { estado: "rechazado" }); await refresh(); toast("amber", "Solicitud rechazada", "El conductor verá el aviso."); }
  function openOut(id) { outTargetId = id; const v = data.find(x => x.id === id); el("outSub").textContent = v ? v.placa + " · " + v.nombre : "Cierre"; el("outDetalle").value = ""; el("outDoc").value = ""; el("outTipo").selectedIndex = 0; el("outOverlay").classList.add("show"); }
  function closeOut() { el("outOverlay").classList.remove("show"); outTargetId = null; }
  async function confirmOut() {
    if (!outTargetId) return closeOut();
    await Store.update(outTargetId, { estado: "cerrado", t_salida: new Date().toISOString(), salida_tipo: el("outTipo").value, salida_detalle: el("outDetalle").value.trim(), salida_doc: el("outDoc").value.trim() });
    const id = outTargetId; closeOut(); await refresh();
    const v = data.find(x => x.id === id); toast("green", "✅ Salida registrada", (v ? v.placa : "Vehículo") + " cerrado correctamente.");
  }

  /* ===================== DASHBOARD ===================== */
  function renderDashboard(body, cerrado, puerta, planta) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const cerradosHoy = cerrado.filter(r => new Date(r.t_salida) >= hoy);
    const esperas = cerrado.map(r => tiempos(r).espera).filter(v => v != null);
    const plantas = cerrado.map(r => tiempos(r).planta).filter(v => v != null);
    const ciclos = cerrado.map(r => tiempos(r).ciclo).filter(v => v != null);
    const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
    const max = a => a.length ? Math.max(...a) : null;
    const demorasCount = cerrado.filter(r => { const e = tiempos(r).espera; return e != null && e >= C.DEMORA_PUERTA_MIN; }).length + puerta.filter(r => diffMin(r.t_puerta, new Date().toISOString()) >= C.DEMORA_PUERTA_MIN).length;
    body.innerHTML = `
      <div class="dash">
        <div class="dash-head"><div><h3>Tablero de tiempos</h3><small>Indicadores del proceso en planta</small></div>
          <div class="exp-btns"><button class="btn-exp" onclick="App.exportCSV()">⬇️ CSV</button><button class="btn-exp xls" onclick="App.exportXLSX()">⬇️ Excel</button></div></div>
        <div class="dkpis">
          <div class="dkpi"><span class="l">En puerta ahora</span><b class="ambar">${puerta.length}</b></div>
          <div class="dkpi"><span class="l">En planta ahora</span><b class="azul">${planta.length}</b></div>
          <div class="dkpi"><span class="l">Cerrados hoy</span><b class="verde">${cerradosHoy.length}</b></div>
          <div class="dkpi"><span class="l">Con demora (>${C.DEMORA_PUERTA_MIN}m)</span><b class="rojo">${demorasCount}</b></div>
        </div>
        <div class="dcards">
          <div class="dcard"><span class="l">⏳ Espera en puerta (prom.)</span><b>${durTxt(avg(esperas))}</b><small>máx ${durTxt(max(esperas))}</small></div>
          <div class="dcard"><span class="l">🏭 Tiempo en planta (prom.)</span><b>${durTxt(avg(plantas))}</b><small>máx ${durTxt(max(plantas))}</small></div>
          <div class="dcard"><span class="l">🔄 Ciclo total (prom.)</span><b>${durTxt(avg(ciclos))}</b><small>máx ${durTxt(max(ciclos))}</small></div>
        </div>
        <div class="chart-box"><canvas id="chart" height="150"></canvas></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Placa</th><th>Conductor</th><th>Llegada</th><th>Ingreso</th><th>Salida</th><th>Espera</th><th>En planta</th><th>Ciclo</th><th>Salió con</th></tr></thead>
          <tbody>${cerrado.length ? cerrado.map(rowHTML).join("") : '<tr><td colspan="9" class="tc-empty">Aún no hay registros cerrados.</td></tr>'}</tbody>
        </table></div>
      </div>`;
    drawChart(cerrado.slice(0, 10).reverse());
  }
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
  function rowsForExport() {
    return data.filter(r => r.estado !== "rechazado").map(r => { const t = tiempos(r);
      return { Folio: r.folio || "", Placa: r.placa, Conductor: r.nombre, Cedula: r.cedula, Vehiculo: r.tipo || "", Motivo: r.motivo || "", Estado: r.estado,
        Llegada: fmtFull(D(r.t_puerta)), Ingreso: fmtFull(D(r.t_ingreso)), Salida: fmtFull(D(r.t_salida)),
        Espera_min: t.espera ?? "", En_planta_min: t.planta ?? "", Ciclo_min: t.ciclo ?? "",
        Salio_con: r.salida_tipo || "", Detalle: r.salida_detalle || "", Documento: r.salida_doc || "", Lat: r.lat, Lng: r.lng }; });
  }
  function stamp() { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; }
  function exportCSV() { const rows = rowsForExport(); if (!rows.length) return toast("blue", "Sin datos", "No hay registros para exportar.");
    const heads = Object.keys(rows[0]); const q = s => `"${String(s).replace(/"/g, '""')}"`;
    const csv = "﻿" + [heads.join(","), ...rows.map(r => heads.map(h => q(r[h])).join(","))].join("\n");
    download(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `ControlPuerta_${stamp()}.csv`); toast("green", "CSV exportado", rows.length + " registros."); }
  function exportXLSX() { const rows = rowsForExport(); if (!rows.length) return toast("blue", "Sin datos", "No hay registros para exportar.");
    const go = () => { const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Registros"); XLSX.writeFile(wb, `ControlPuerta_${stamp()}.xlsx`); toast("green", "Excel exportado", rows.length + " registros."); };
    if (window.XLSX) go(); else { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = go; s.onerror = () => toast("blue", "No se pudo cargar Excel", "Usa CSV."); document.head.appendChild(s); } }
  function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

  /* ===================== ADMINISTRADOR ===================== */
  function renderAdmin() {
    const body = el("adminBody");
    const activos = usuarios.filter(u => u.activo !== false).length;
    body.innerHTML = `
      <div class="admin">
        <div class="admin-hero">
          <div class="ah-ic">👑</div>
          <div><h2>Panel de Administrador</h2><small>Gestiona los usuarios que pueden entrar como Portería</small></div>
        </div>
        <div class="admin-kpis">
          <div class="akpi"><span>Usuarios</span><b>${usuarios.length}</b></div>
          <div class="akpi"><span>Activos</span><b class="verde">${activos}</b></div>
          <div class="akpi"><span>Inactivos</span><b class="gris">${usuarios.length - activos}</b></div>
        </div>
        <div class="admin-actions">
          <h3>Usuarios de portería</h3>
          <button class="btn-add" onclick="App.openUser()">＋ Nuevo usuario</button>
        </div>
        ${usuarios.length ? `<div class="ulist">${usuarios.map(userRow).join("")}</div>` : `
          <div class="empty small"><p>Aún no has creado usuarios.<br>Crea el primero con <b>＋ Nuevo usuario</b>. Cada uno entrará a Portería con su propio PIN.</p></div>`}
        <p class="admin-note">🔒 El PIN de administrador se cambia en el archivo <b>config.js</b> (ADMIN_PIN).</p>
      </div>`;
  }
  function userRow(u) {
    const act = u.activo !== false;
    return `<div class="ucard ${act ? '' : 'off'}">
      <div class="uav">${esc((u.nombre || "?").trim().charAt(0).toUpperCase())}</div>
      <div class="uinfo"><b>${esc(u.nombre)}</b><span>${esc(u.cargo || "Portería")} · PIN ${esc(u.pin)}</span></div>
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
    el("uErr").hidden = true;
    el("userOverlay").classList.add("show");
    setTimeout(() => el("uNombre").focus(), 100);
  }
  function closeUser() { el("userOverlay").classList.remove("show"); editUserId = null; }
  async function saveUser() {
    const nombre = el("uNombre").value.trim(), cargo = el("uCargo").value.trim(), pin = el("uPin").value.trim(), activo = el("uActivo").checked;
    const err = m => { const e = el("uErr"); e.textContent = m; e.hidden = false; };
    if (!nombre) return err("Escribe el nombre.");
    if (!/^\d{3,10}$/.test(pin)) return err("El PIN debe tener de 3 a 10 dígitos.");
    if (String(pin) === String(C.ADMIN_PIN)) return err("Ese PIN es el del administrador, usa otro.");
    const dup = usuarios.find(u => String(u.pin) === pin && u.id !== editUserId);
    if (dup) return err("Ese PIN ya lo usa " + dup.nombre + ".");
    const saveBtn = document.querySelector("#userOverlay .btn-primary");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Guardando…"; }
    try {
      if (editUserId) { await Users.update(editUserId, { nombre, cargo, pin, activo }); toast("green", "Usuario actualizado", nombre); }
      else { await Users.insert({ nombre, cargo, pin, activo, created_at: new Date().toISOString() }); toast("green", "Usuario creado", nombre + " ya puede entrar con su PIN."); }
      closeUser(); await refreshUsers();
    } catch (e) {
      err("No se pudo guardar: " + (e && e.message ? e.message : e) + ". Revisa tu conexión o que la tabla 'usuarios' exista en Supabase.");
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Guardar"; }
    }
  }
  async function toggleUser(id) { const u = usuarios.find(x => x.id === id); if (!u) return; await Users.update(id, { activo: !(u.activo !== false) }); await refreshUsers(); }
  async function deleteUser(id) { const u = usuarios.find(x => x.id === id); if (!u) return; if (!confirm("¿Eliminar a " + u.nombre + "?")) return; await Users.remove(id); await refreshUsers(); toast("amber", "Usuario eliminado", u.nombre); }

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
    openUser, closeUser, saveUser, toggleUser, deleteUser, installApp, closeIos
  };
})();

document.getElementById("btnExit").addEventListener("click", App.exitRole);
document.getElementById("pinInput").addEventListener("keydown", e => { if (e.key === "Enter") App.checkPin(); });
App.boot();
