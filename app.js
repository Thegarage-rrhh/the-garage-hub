// =====================================================
//  THE GARAGE HUB · Fase 1
//  Login · Roles · Empleados · Novedades · Cuentas
// =====================================================

const root = document.getElementById("root");

// ---------- Revisión de configuración ----------
if (typeof CONFIG === "undefined" || CONFIG.SUPABASE_URL.includes("PEGA_AQUI") || CONFIG.SUPABASE_KEY.includes("PEGA_AQUI")) {
  root.innerHTML = `<div class="login"><div class="login-caja">
    <img src="logo.png" alt="The Garage">
    <div class="aviso">Falta configurar la conexión. Abre el archivo <b>config.js</b> y pega la URL y la llave de Supabase.</div>
  </div></div>`;
  throw new Error("Configuración pendiente");
}

const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
// Segundo cliente: crea usuarios nuevos sin cerrar la sesión del administrador
const sbAlta = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "garage-alta" }
});

let perfil = null;

// ---------- Utilidades ----------
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const hoyISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const fechaCorta = (iso) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "—");

function toast(msg, tipo = "ok") {
  const t = document.createElement("div");
  t.className = "toast" + (tipo === "error" ? " error" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function traducirError(error) {
  const m = error?.message || String(error);
  if (m.includes("Invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (m.includes("Email not confirmed")) return "El correo no está confirmado. Desactiva 'Confirm email' en Supabase.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Ya existe un usuario con ese correo.";
  if (m.includes("Password should be")) return "La contraseña debe tener mínimo 6 caracteres.";
  if (m.includes("Unable to validate email")) return "El correo no es válido.";
  if (m.includes("rate limit")) return "Demasiados intentos seguidos. Espera un minuto e intenta de nuevo.";
  if (error?.code === "23505") return "Ya existe un registro con ese nombre.";
  if (error?.code === "23503") return "No se puede eliminar porque tiene movimientos asociados.";
  return "Ocurrió un error: " + m;
}

function abrirModal({ titulo, cuerpo, botonTexto = "Guardar", alGuardar, sinPie = false }) {
  const fondo = document.createElement("div");
  fondo.className = "fondo-modal";
  fondo.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
    <header><h3>${esc(titulo)}</h3><button class="btn btn-texto" data-cerrar aria-label="Cerrar">✕</button></header>
    <form class="cuerpo">${cuerpo}</form>
    ${sinPie ? "" : `<footer><button class="btn btn-texto" data-cerrar type="button">Cancelar</button>
      <button class="btn btn-rojo" data-guardar type="button">${esc(botonTexto)}</button></footer>`}
  </div>`;
  const cerrar = () => fondo.remove();
  fondo.addEventListener("click", (e) => { if (e.target === fondo || e.target.closest("[data-cerrar]")) cerrar(); });
  const form = $("form", fondo);
  form.addEventListener("submit", (e) => e.preventDefault());
  const btn = $("[data-guardar]", fondo);
  if (btn) btn.addEventListener("click", async () => {
    if (!form.reportValidity()) return;
    btn.disabled = true;
    const datos = Object.fromEntries(new FormData(form));
    const ok = await alGuardar(datos, form);
    btn.disabled = false;
    if (ok) cerrar();
  });
  document.body.appendChild(fondo);
  const primero = $("input, select, textarea", fondo);
  if (primero) primero.focus();
  return { fondo, form, cerrar };
}

// ---------- Menú ----------
// listo: true = ya funciona · fase = en qué fase llega
const MENU = {
  admin: [
    { grupo: "General", items: [{ id: "inicio", label: "Inicio", listo: true }] },
    { grupo: "Equipo", items: [
      { id: "empleados", label: "Empleados", listo: true },
      { id: "asistencia", label: "Asistencia", fase: 2 },
      { id: "tareas", label: "Tareas", fase: 3 } ] },
    { grupo: "Operación", items: [
      { id: "inventarios", label: "Inventarios", fase: 4 },
      { id: "agenda", label: "Agenda de entregas", fase: 7 } ] },
    { grupo: "Comercial", items: [
      { id: "clientes", label: "Clientes", fase: 5 },
      { id: "proveedores", label: "Proveedores", fase: 5 },
      { id: "precios", label: "Precios", fase: 5 } ] },
    { grupo: "Dinero", items: [
      { id: "facturacion", label: "Facturación", fase: 6 },
      { id: "contabilidad", label: "Contabilidad", fase: 8 },
      { id: "cuentas", label: "Cuentas de dinero", listo: true } ] }
  ],
  empleado: [
    { grupo: "Mi día", items: [
      { id: "inicio", label: "Inicio", listo: true },
      { id: "jornada", label: "Mi jornada", fase: 2 },
      { id: "mis-tareas", label: "Mis tareas", fase: 3 } ] },
    { grupo: "Consultas", items: [
      { id: "inventario", label: "Inventario", fase: 4 },
      { id: "moldes", label: "Moldes", fase: 4 },
      { id: "precios", label: "Precios", fase: 5 } ] }
  ]
};

const VISTAS = { inicio: vistaInicio, empleados: vistaEmpleados, cuentas: vistaCuentas };

// ---------- Sesión ----------
async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return mostrarLogin();
  await cargarPerfil(session.user);
}

async function cargarPerfil(user) {
  const { data, error } = await sb.from("perfiles").select("*").eq("id", user.id).single();
  if (error || !data) {
    await sb.auth.signOut();
    return mostrarLogin("No encontramos tu perfil. Pide ayuda a un administrador.");
  }
  if (!data.activo) {
    await sb.auth.signOut();
    return mostrarLogin("Tu acceso está desactivado. Habla con un administrador.");
  }
  perfil = data;
  mostrarApp();
}

function mostrarLogin(mensaje = "") {
  root.innerHTML = `<main class="login"><form class="login-caja" id="form-login">
    <img src="logo.png" alt="The Garage Interior Custom">
    <h1>HUB</h1>
    ${mensaje ? `<div class="aviso">${esc(mensaje)}</div>` : ""}
    <div class="campo"><label for="l-email">Correo</label><input id="l-email" name="email" type="email" required autocomplete="username"></div>
    <div class="campo"><label for="l-pass">Contraseña</label><input id="l-pass" name="password" type="password" required autocomplete="current-password"></div>
    <button class="btn btn-rojo" type="submit" style="justify-content:center">Entrar</button>
  </form></main>`;
  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button", e.target);
    btn.disabled = true; btn.textContent = "Entrando…";
    const { email, password } = Object.fromEntries(new FormData(e.target));
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { btn.disabled = false; btn.textContent = "Entrar"; return toast(traducirError(error), "error"); }
    await cargarPerfil(data.user);
  });
}

async function salir() {
  await sb.auth.signOut();
  perfil = null;
  location.hash = "";
  mostrarLogin();
}

// ---------- Estructura principal ----------
function mostrarApp() {
  const menu = MENU[perfil.rol];
  root.innerHTML = `<div class="app">
    <div class="barra-movil">
      <img src="logo.png" alt="The Garage">
      <button class="btn" id="abrir-menu" aria-label="Abrir menú">☰ Menú</button>
    </div>
    <nav class="lateral" id="lateral" aria-label="Menú principal">
      <div class="marca"><img src="logo.png" alt="The Garage"></div>
      ${menu.map((g) => `<div class="grupo"><div class="grupo-titulo">${g.grupo}</div>
        ${g.items.map((i) => `<button class="nav-item ${i.listo ? "" : "pronto"}" data-vista="${i.id}">
          <span>${i.label}</span>${i.listo ? "" : `<span class="etiqueta-pronto">Fase ${i.fase}</span>`}</button>`).join("")}
      </div>`).join("")}
      <div class="pie">
        <strong>${esc(perfil.nombre || perfil.email)}</strong>
        <span>${perfil.rol === "admin" ? "Administrador" : esc(perfil.cargo || "Empleado")}</span>
        <div><button class="btn btn-texto btn-chico" id="salir" style="padding-left:0">Cerrar sesión</button></div>
      </div>
    </nav>
    <main class="contenido" id="contenido"></main>
  </div>`;

  $("#salir").addEventListener("click", salir);
  $("#abrir-menu").addEventListener("click", () => $("#lateral").classList.toggle("abierto"));
  $("#lateral").addEventListener("click", (e) => {
    const b = e.target.closest("[data-vista]");
    if (!b) return;
    location.hash = b.dataset.vista;
    $("#lateral").classList.remove("abierto");
  });
  window.onhashchange = navegar;
  navegar();
}

function navegar() {
  if (!perfil) return;
  const menu = MENU[perfil.rol].flatMap((g) => g.items);
  let id = location.hash.replace("#", "") || "inicio";
  let item = menu.find((i) => i.id === id);
  if (!item) { id = "inicio"; item = menu[0]; }
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("activo", b.dataset.vista === id));
  const el = $("#contenido");
  if (item.listo && VISTAS[id]) VISTAS[id](el);
  else vistaProximamente(el, item);
  window.scrollTo(0, 0);
}

function encabezado(titulo, subtitulo = "", accion = "") {
  return `<div class="titulo-pagina"><div><h1>${titulo}</h1>${subtitulo ? `<p>${subtitulo}</p>` : ""}</div>${accion}</div>`;
}

// ---------- Vista: Próximamente ----------
function vistaProximamente(el, item) {
  el.innerHTML = encabezado(esc(item.label)) + `<div class="panel">
    <p style="margin:0">Esta sección se construye en la <b>Fase ${item.fase}</b> del HUB. La base de datos ya está preparada para recibirla.</p>
  </div>`;
}

// ---------- Vista: Inicio ----------
async function vistaInicio(el) {
  const fecha = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" });
  const nombre = (perfil.nombre || "").split(" ")[0] || "equipo";
  el.innerHTML = encabezado(`Hola, ${esc(nombre)}`, fecha.charAt(0).toUpperCase() + fecha.slice(1));

  if (perfil.rol !== "admin") {
    el.innerHTML += `<div class="panel"><h2>Tu espacio de trabajo</h2>
      <p style="margin:0">Muy pronto aquí vas a marcar tu entrada, salida, breaks y almuerzo, y a ver tus tareas del día con sus tiempos.</p></div>`;
    return;
  }

  el.innerHTML += `<div class="cifras" id="cifras"><div class="cifra"><b>…</b><span>Cargando</span></div></div>
    <div class="panel"><h2>Primeros pasos</h2>
      <p style="margin-top:0">Registra a tu equipo en <b>Empleados</b> y revisa que las <b>Cuentas de dinero</b> sean las correctas. Las demás secciones se irán activando fase por fase.</p>
    </div>`;

  const [emp, cue, nov] = await Promise.all([
    sb.from("perfiles").select("id", { count: "exact", head: true }).eq("activo", true),
    sb.from("cuentas").select("id", { count: "exact", head: true }).eq("activa", true),
    sb.from("novedades_empleado").select("id", { count: "exact", head: true }).gte("fecha_inicio", hoyISO().slice(0, 7) + "-01")
  ]);
  $("#cifras").innerHTML = `
    <div class="cifra"><b>${emp.count ?? 0}</b><span>Personas con acceso activo</span></div>
    <div class="cifra"><b>${cue.count ?? 0}</b><span>Cuentas de dinero activas</span></div>
    <div class="cifra"><b>${nov.count ?? 0}</b><span>Novedades registradas este mes</span></div>`;
}

// ---------- Vista: Empleados ----------
async function vistaEmpleados(el) {
  el.innerHTML = encabezado("Empleados", "Da o quita acceso al HUB y lleva el control de novedades.",
    `<button class="btn btn-rojo" id="nuevo-emp">+ Agregar empleado</button>`) +
    `<div class="panel"><div class="tabla-wrap" id="tabla-emp"><p class="vacio">Cargando…</p></div></div>`;
  $("#nuevo-emp").addEventListener("click", () => formEmpleado());
  await pintarEmpleados();
}

async function pintarEmpleados() {
  const cont = $("#tabla-emp");
  if (!cont) return;
  const { data, error } = await sb.from("perfiles").select("*").order("activo", { ascending: false }).order("nombre");
  if (error) { cont.innerHTML = `<p class="vacio">${esc(traducirError(error))}</p>`; return; }
  if (!data.length) { cont.innerHTML = `<p class="vacio">Aún no hay empleados. Agrega el primero.</p>`; return; }

  cont.innerHTML = `<table><thead><tr><th>Nombre</th><th>Cargo</th><th>Rol</th><th>Acceso</th><th></th></tr></thead><tbody>
    ${data.map((p) => `<tr>
      <td><b>${esc(p.nombre || "Sin nombre")}</b><span class="sub">${esc(p.email)}</span></td>
      <td>${esc(p.cargo || "—")}<span class="sub">${p.fecha_ingreso ? "Desde " + fechaCorta(p.fecha_ingreso) : ""}</span></td>
      <td>${p.rol === "admin" ? `<span class="estado admin">Admin</span>` : "Empleado"}</td>
      <td>${p.activo ? `<span class="estado si">Activo</span>` : `<span class="estado no">Sin acceso</span>`}</td>
      <td><div class="acciones">
        <button class="btn btn-chico" data-acc="novedades" data-id="${p.id}">Novedades</button>
        <button class="btn btn-chico" data-acc="editar" data-id="${p.id}">Editar</button>
        <button class="btn btn-chico" data-acc="acceso" data-id="${p.id}" ${p.id === perfil.id ? "disabled title='No puedes quitarte el acceso a ti mismo'" : ""}>
          ${p.activo ? "Quitar acceso" : "Dar acceso"}</button>
      </div></td></tr>`).join("")}
  </tbody></table>`;

  cont.onclick = async (e) => {
    const b = e.target.closest("[data-acc]");
    if (!b) return;
    const p = data.find((x) => x.id === b.dataset.id);
    if (b.dataset.acc === "editar") formEmpleado(p);
    if (b.dataset.acc === "novedades") modalNovedades(p);
    if (b.dataset.acc === "acceso") {
      const accion = p.activo ? "quitarle el acceso" : "darle acceso";
      if (!confirm(`¿Seguro que quieres ${accion} a ${p.nombre || p.email}?`)) return;
      const { error } = await sb.from("perfiles").update({ activo: !p.activo }).eq("id", p.id);
      if (error) return toast(traducirError(error), "error");
      toast(p.activo ? "Acceso quitado" : "Acceso activado");
      pintarEmpleados();
    }
  };
}

function formEmpleado(p = null) {
  const nuevo = !p;
  const v = (campo) => esc(p?.[campo] ?? "");
  abrirModal({
    titulo: nuevo ? "Agregar empleado" : "Editar empleado",
    botonTexto: nuevo ? "Crear acceso" : "Guardar cambios",
    cuerpo: `
      <div class="rejilla">
        <div class="campo"><label>Nombre completo *</label><input name="nombre" required value="${v("nombre")}"></div>
        <div class="campo"><label>Cargo</label><input name="cargo" placeholder="Tapicero, Detailer…" value="${v("cargo")}"></div>
        <div class="campo"><label>Documento</label><input name="documento" value="${v("documento")}"></div>
        <div class="campo"><label>Teléfono</label><input name="telefono" type="tel" value="${v("telefono")}"></div>
        <div class="campo"><label>Fecha de ingreso</label><input name="fecha_ingreso" type="date" value="${v("fecha_ingreso")}"></div>
        <div class="campo"><label>Rol en el HUB</label><select name="rol">
          <option value="empleado" ${p?.rol !== "admin" ? "selected" : ""}>Empleado</option>
          <option value="admin" ${p?.rol === "admin" ? "selected" : ""}>Administrador</option></select></div>
      </div>
      ${nuevo ? `<div class="rejilla">
        <div class="campo"><label>Correo para entrar *</label><input name="email" type="email" required></div>
        <div class="campo"><label>Contraseña inicial *</label><input name="password" type="text" minlength="6" required></div>
      </div>
      <p class="ayuda">Entrégale este correo y contraseña al empleado para que entre al HUB.</p>` :
      `<p class="ayuda">Correo de acceso: ${v("email")}</p>`}`,
    alGuardar: async (d) => {
      if (!nuevo && p.id === perfil.id && d.rol !== "admin") {
        toast("No puedes quitarte el rol de administrador a ti mismo.", "error");
        return false;
      }
      const datos = {
        nombre: d.nombre.trim(), cargo: d.cargo.trim() || null, documento: d.documento.trim() || null,
        telefono: d.telefono.trim() || null, fecha_ingreso: d.fecha_ingreso || null, rol: d.rol
      };
      let id = p?.id;
      if (nuevo) {
        const { data, error } = await sbAlta.auth.signUp({
          email: d.email.trim().toLowerCase(), password: d.password, options: { data: { nombre: datos.nombre } }
        });
        if (error) { toast(traducirError(error), "error"); return false; }
        if (!data.user || (data.user.identities && data.user.identities.length === 0)) {
          toast("Ya existe un usuario con ese correo.", "error"); return false;
        }
        id = data.user.id;
        datos.activo = true;
      }
      const { error } = await sb.from("perfiles").update(datos).eq("id", id);
      if (error) { toast(traducirError(error), "error"); return false; }
      toast(nuevo ? "Empleado creado con acceso al HUB" : "Cambios guardados");
      pintarEmpleados();
      return true;
    }
  });
}

// ---------- Novedades de un empleado ----------
async function modalNovedades(p) {
  const hoy = hoyISO();
  const { fondo } = abrirModal({
    titulo: `Novedades · ${p.nombre || p.email}`,
    sinPie: true,
    cuerpo: `
      <div class="rejilla">
        <div class="campo"><label>Tipo</label><select name="tipo">
          ${["Incapacidad", "Falla", "Permiso", "Vacaciones", "Llegada tarde", "Otro"].map((t) => `<option>${t}</option>`).join("")}
        </select></div>
        <div class="campo"><label>Desde</label><input type="date" name="fecha_inicio" value="${hoy}" required></div>
        <div class="campo"><label>Hasta</label><input type="date" name="fecha_fin" value="${hoy}" required></div>
      </div>
      <div class="campo"><label>Descripción</label><input name="descripcion" placeholder="Ej: incapacidad médica por 3 días"></div>
      <div><button class="btn btn-rojo" type="button" id="agregar-nov">Registrar novedad</button></div>
      <div class="tabla-wrap" id="lista-nov"><p class="vacio">Cargando…</p></div>`
  });

  const pintar = async () => {
    const { data, error } = await sb.from("novedades_empleado").select("*").eq("empleado_id", p.id).order("fecha_inicio", { ascending: false });
    const cont = $("#lista-nov", fondo);
    if (error) { cont.innerHTML = `<p class="vacio">${esc(traducirError(error))}</p>`; return; }
    if (!data.length) { cont.innerHTML = `<p class="vacio">Sin novedades registradas.</p>`; return; }
    const totales = data.reduce((acc, n) => ({ ...acc, [n.tipo]: (acc[n.tipo] || 0) + n.dias }), {});
    cont.innerHTML = `<p class="ayuda" style="margin-bottom:.5rem">Total días: ${Object.entries(totales).map(([t, d]) => `${t} ${d}`).join(", ")}</p>
      <table><thead><tr><th>Tipo</th><th>Fechas</th><th>Días</th><th>Descripción</th><th></th></tr></thead><tbody>
      ${data.map((n) => `<tr><td>${esc(n.tipo)}</td><td>${fechaCorta(n.fecha_inicio)}${n.fecha_fin !== n.fecha_inicio ? " a " + fechaCorta(n.fecha_fin) : ""}</td>
        <td>${n.dias}</td><td>${esc(n.descripcion || "—")}</td>
        <td><button class="btn btn-chico btn-texto" data-borrar="${n.id}">Eliminar</button></td></tr>`).join("")}
      </tbody></table>`;
    cont.onclick = async (e) => {
      const b = e.target.closest("[data-borrar]");
      if (!b || !confirm("¿Eliminar esta novedad?")) return;
      const { error } = await sb.from("novedades_empleado").delete().eq("id", b.dataset.borrar);
      if (error) return toast(traducirError(error), "error");
      toast("Novedad eliminada");
      pintar();
    };
  };

  $("#agregar-nov", fondo).addEventListener("click", async () => {
    const d = Object.fromEntries(new FormData($("form", fondo)));
    if (d.fecha_fin < d.fecha_inicio) return toast("La fecha 'Hasta' no puede ser antes de 'Desde'.", "error");
    const dias = Math.round((new Date(d.fecha_fin) - new Date(d.fecha_inicio)) / 86400000) + 1;
    const { error } = await sb.from("novedades_empleado").insert({
      empleado_id: p.id, tipo: d.tipo, fecha_inicio: d.fecha_inicio, fecha_fin: d.fecha_fin, dias, descripcion: d.descripcion.trim() || null
    });
    if (error) return toast(traducirError(error), "error");
    toast("Novedad registrada");
    $("[name=descripcion]", fondo).value = "";
    pintar();
  });
  pintar();
}

// ---------- Vista: Cuentas de dinero ----------
const TIPOS_CUENTA = ["Efectivo", "Datáfono", "Banco", "Billetera digital", "Otro"];

async function vistaCuentas(el) {
  el.innerHTML = encabezado("Cuentas de dinero", "A estas cuentas entra y sale el dinero en facturas, abonos y gastos.") +
    `<div class="panel"><h2>Agregar cuenta</h2>
      <form class="fila-form" id="form-cuenta">
        <div class="campo"><label for="c-nombre">Nombre</label><input id="c-nombre" name="nombre" placeholder="Ej: Davivienda" required></div>
        <div class="campo"><label for="c-tipo">Tipo</label><select id="c-tipo" name="tipo">${TIPOS_CUENTA.map((t) => `<option>${t}</option>`).join("")}</select></div>
        <button class="btn btn-rojo" type="submit">Agregar cuenta</button>
      </form>
    </div>
    <div class="panel"><div class="tabla-wrap" id="tabla-cuentas"><p class="vacio">Cargando…</p></div></div>`;

  $("#form-cuenta").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const { error } = await sb.from("cuentas").insert({ nombre: d.nombre.trim(), tipo: d.tipo });
    if (error) return toast(traducirError(error), "error");
    toast("Cuenta agregada");
    e.target.reset();
    pintarCuentas();
  });
  pintarCuentas();
}

async function pintarCuentas() {
  const cont = $("#tabla-cuentas");
  if (!cont) return;
  const { data, error } = await sb.from("cuentas").select("*").order("activa", { ascending: false }).order("nombre");
  if (error) { cont.innerHTML = `<p class="vacio">${esc(traducirError(error))}</p>`; return; }
  if (!data.length) { cont.innerHTML = `<p class="vacio">No hay cuentas. Agrega la primera arriba.</p>`; return; }

  cont.innerHTML = `<table><thead><tr><th>Cuenta</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>
    ${data.map((c) => `<tr>
      <td><b>${esc(c.nombre)}</b></td><td>${esc(c.tipo)}</td>
      <td>${c.activa ? `<span class="estado si">Activa</span>` : `<span class="estado no">Inactiva</span>`}</td>
      <td><div class="acciones">
        <button class="btn btn-chico" data-acc="editar" data-id="${c.id}">Editar</button>
        <button class="btn btn-chico" data-acc="estado" data-id="${c.id}">${c.activa ? "Desactivar" : "Activar"}</button>
        <button class="btn btn-chico btn-texto" data-acc="borrar" data-id="${c.id}">Eliminar</button>
      </div></td></tr>`).join("")}
  </tbody></table>
  <p class="ayuda" style="margin-top:1rem">Si una cuenta ya tiene pagos o gastos registrados, desactívala en lugar de eliminarla para no perder el historial.</p>`;

  cont.onclick = async (e) => {
    const b = e.target.closest("[data-acc]");
    if (!b) return;
    const c = data.find((x) => String(x.id) === b.dataset.id);
    if (b.dataset.acc === "editar") {
      abrirModal({
        titulo: "Editar cuenta",
        cuerpo: `<div class="campo"><label>Nombre</label><input name="nombre" required value="${esc(c.nombre)}"></div>
          <div class="campo"><label>Tipo</label><select name="tipo">${TIPOS_CUENTA.map((t) => `<option ${t === c.tipo ? "selected" : ""}>${t}</option>`).join("")}</select></div>`,
        alGuardar: async (d) => {
          const { error } = await sb.from("cuentas").update({ nombre: d.nombre.trim(), tipo: d.tipo }).eq("id", c.id);
          if (error) { toast(traducirError(error), "error"); return false; }
          toast("Cambios guardados"); pintarCuentas(); return true;
        }
      });
    }
    if (b.dataset.acc === "estado") {
      const { error } = await sb.from("cuentas").update({ activa: !c.activa }).eq("id", c.id);
      if (error) return toast(traducirError(error), "error");
      toast(c.activa ? "Cuenta desactivada" : "Cuenta activada");
      pintarCuentas();
    }
    if (b.dataset.acc === "borrar") {
      if (!confirm(`¿Eliminar la cuenta "${c.nombre}"? Esta acción no se puede deshacer.`)) return;
      const { error } = await sb.from("cuentas").delete().eq("id", c.id);
      if (error) {
        return toast(error.code === "23503"
          ? "Esta cuenta ya tiene movimientos. Desactívala en lugar de eliminarla." : traducirError(error), "error");
      }
      toast("Cuenta eliminada");
      pintarCuentas();
    }
  };
}

// ---------- Arranque ----------
sb.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT" && perfil) { perfil = null; mostrarLogin(); } });
iniciar();
