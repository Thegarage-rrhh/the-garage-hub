// =====================================================
//  THE GARAGE HUB · Fase 5
//  Empleados · Asistencia · Tareas · Inventarios · Clientes · Precios
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
let intervalo = null;

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
  if (error?.code === "P0001") return m;
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
  const cerrar = () => { fondo.remove(); document.removeEventListener("keydown", alTeclado); };
  const alTeclado = (e) => { if (e.key === "Escape") cerrar(); };
  document.addEventListener("keydown", alTeclado);
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
      { id: "asistencia", label: "Asistencia", listo: true },
      { id: "jornada", label: "Mi jornada", listo: true },
      { id: "tareas", label: "Tareas", listo: true } ] },
    { grupo: "Operación", items: [
      { id: "inventarios", label: "Inventarios", listo: true },
      { id: "agenda", label: "Agenda de entregas", fase: 7 } ] },
    { grupo: "Comercial", items: [
      { id: "clientes", label: "Clientes", listo: true },
      { id: "proveedores", label: "Proveedores", listo: true },
      { id: "precios", label: "Precios", listo: true } ] },
    { grupo: "Dinero", items: [
      { id: "facturacion", label: "Facturación", fase: 6 },
      { id: "contabilidad", label: "Contabilidad", fase: 8 },
      { id: "cuentas", label: "Cuentas de dinero", listo: true } ] }
  ],
  empleado: [
    { grupo: "Mi día", items: [
      { id: "inicio", label: "Inicio", listo: true },
      { id: "jornada", label: "Mi jornada", listo: true },
      { id: "mis-tareas", label: "Mis tareas", listo: true } ] },
    { grupo: "Consultas", items: [
      { id: "inventario", label: "Inventario", listo: true },
      { id: "moldes", label: "Moldes", listo: true },
      { id: "precios", label: "Precios", listo: true } ] }
  ]
};

const VISTAS = { inicio: vistaInicio, empleados: vistaEmpleados, cuentas: vistaCuentas, jornada: vistaJornada, asistencia: vistaAsistencia, tareas: vistaTareasAdmin, "mis-tareas": vistaMisTareas,
  inventarios: vistaInventarios, inventario: vistaInventarioEmpleado, moldes: vistaMoldesEmpleado,
  clientes: vistaClientes, proveedores: vistaProveedores, precios: vistaPrecios };

// ---------- Sesión ----------
async function iniciar() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return mostrarLogin();
    await cargarPerfil(session.user);
  } catch (err) {
    mostrarLogin("No se pudo conectar con Supabase: " + (err.message || err));
  }
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
  if (intervalo) { clearInterval(intervalo); intervalo = null; }
  if (intervaloTareas) { clearInterval(intervaloTareas); intervaloTareas = null; }
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
  const nombre = perfil.nombre || "equipo";
  el.innerHTML = encabezado(`Hola, ${esc(nombre)}`, fecha.charAt(0).toUpperCase() + fecha.slice(1));

  if (perfil.rol !== "admin") {
    await vistaJornada(el, false);
    el.insertAdjacentHTML("beforeend", `<h3 class="subtitulo">Mis tareas</h3>`);
    await vistaMisTareas(el, false);
    return;
  }

  el.innerHTML += `<div class="cifras" id="cifras"><div class="cifra"><b>…</b><span>Cargando</span></div></div>
    <div class="panel"><h2>Primeros pasos</h2>
      <p style="margin-top:0">Registra a tu equipo en <b>Empleados</b> y revisa que las <b>Cuentas de dinero</b> sean las correctas. Las demás secciones se irán activando fase por fase.</p>
    </div>`;

  const [emp, cue, nov, tar] = await Promise.all([
    sb.from("perfiles").select("id", { count: "exact", head: true }).eq("activo", true),
    sb.from("cuentas").select("id", { count: "exact", head: true }).eq("activa", true),
    sb.from("novedades_empleado").select("id", { count: "exact", head: true }).gte("fecha_inicio", hoyISO().slice(0, 7) + "-01"),
    sb.from("tareas").select("id", { count: "exact", head: true }).eq("fecha", hoyISO()).neq("estado", "terminada")
  ]);
  $("#cifras").innerHTML = `
    <div class="cifra"><b>${emp.count ?? 0}</b><span>Personas con acceso activo</span></div>
    <div class="cifra"><b>${cue.count ?? 0}</b><span>Cuentas de dinero activas</span></div>
    <div class="cifra"><b>${tar.count ?? 0}</b><span>Tareas de hoy sin terminar</span></div>
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

// =====================================================
//  FASE 2 · ASISTENCIA
// =====================================================
const TZ = "America/Bogota";
const NOMBRE_MARCA = {
  entrada: "Entrada", salida: "Salida", break_inicio: "Inicio de break", break_fin: "Fin de break",
  almuerzo_inicio: "Inicio de almuerzo", almuerzo_fin: "Fin de almuerzo"
};
const DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const horaCorta = (ts) => (ts ? new Date(ts).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", timeZone: TZ }) : "—");
const fmtHora = (hhmm) => {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
};
const aMin = (hhmm) => { if (!hhmm) return null; const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
function minutosDelDia(ts) {
  const partes = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ts));
  return Number(partes.find((x) => x.type === "hour").value) * 60 + Number(partes.find((x) => x.type === "minute").value);
}
const duracion = (min) => { min = Math.max(0, Math.round(min)); const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`; };
const reloj = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};
const diaSemana = (iso) => new Date(iso + "T12:00:00").getDay();
function sumarDias(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); }
function lunesDe(iso) { const dow = diaSemana(iso); return sumarDias(iso, dow === 0 ? -6 : 1 - dow); }

// Calcula todo lo que pasó en un día a partir de las marcaciones
function analizarDia(eventos, h, aj, esHoy) {
  const r = { entrada: null, salida: null, breaks: [], almuerzos: [], estado: "sin_entrada", alertas: [], neto: 0, tardeMin: 0 };
  const ahora = Date.now();
  let abierto = null;
  for (const e of eventos) {
    const t = new Date(e.momento).getTime();
    if (e.tipo === "entrada") { r.entrada = t; r.estado = "trabajando"; }
    if (e.tipo === "salida") { r.salida = t; r.estado = "terminado"; }
    if (e.tipo === "break_inicio" || e.tipo === "almuerzo_inicio") { abierto = { tipo: e.tipo.split("_")[0], ini: t }; r.estado = abierto.tipo; }
    if ((e.tipo === "break_fin" || e.tipo === "almuerzo_fin") && abierto) {
      (abierto.tipo === "break" ? r.breaks : r.almuerzos).push({ ini: abierto.ini, fin: t });
      abierto = null; r.estado = "trabajando";
    }
  }
  if (abierto) (abierto.tipo === "break" ? r.breaks : r.almuerzos).push({ ini: abierto.ini, fin: esHoy ? ahora : abierto.ini, abierto: true });

  const dur = (x) => (x.fin - x.ini) / 60000;
  r.minBreak = r.breaks.reduce((s, x) => s + dur(x), 0);
  r.minAlm = r.almuerzos.reduce((s, x) => s + dur(x), 0);

  if (r.entrada) {
    const fin = r.salida ?? (esHoy ? ahora : null);
    if (fin) r.neto = (fin - r.entrada) / 60000 - r.minBreak - r.minAlm;
    if (h?.laboral && h.hora_entrada) {
      const llegada = minutosDelDia(r.entrada), hora = aMin(h.hora_entrada);
      if (llegada > hora + aj.minutos_tolerancia) { r.tardeMin = llegada - hora; r.alertas.push(`Llegó tarde (${r.tardeMin} min)`); }
    }
    r.breaks.forEach((b, i) => { if (!b.abierto && Math.round(dur(b)) > (h?.minutos_break ?? 10)) r.alertas.push(`Break ${i + 1}: ${Math.round(dur(b))} min`); });
    r.almuerzos.forEach((a) => { if (!a.abierto && h?.minutos_almuerzo && Math.round(dur(a)) > h.minutos_almuerzo) r.alertas.push(`Almuerzo: ${Math.round(dur(a))} min`); });
    if (r.salida && h?.hora_salida && minutosDelDia(r.salida) < aMin(h.hora_salida)) r.alertas.push("Salió antes");
    if (!r.salida && !esHoy) r.alertas.push("No marcó salida");
  }
  return r;
}

// ---------- Vista empleado: Mi jornada ----------
async function vistaJornada(el, conEncabezado = true) {
  if (conEncabezado) el.innerHTML = encabezado("Mi jornada", "Marca tu entrada, breaks, almuerzo y salida.");
  const cont = document.createElement("div");
  cont.innerHTML = `<p class="vacio">Cargando…</p>`;
  el.appendChild(cont);

  const hoy = hoyISO(), lunes = lunesDe(hoy);
  const [asis, hor, aju] = await Promise.all([
    sb.from("asistencia").select("*").eq("empleado_id", perfil.id).gte("fecha", lunes).lte("fecha", hoy).order("momento"),
    sb.from("horarios").select("*"),
    sb.from("ajustes").select("*").maybeSingle()
  ]);
  const error = asis.error || hor.error;
  if (error) { cont.innerHTML = `<p class="vacio">${esc(traducirError(error))}</p>`; return; }

  const aj = aju.data || { minutos_tolerancia: 10, max_tardanzas_semana: 2 };
  const eventos = asis.data, horarios = hor.data;
  const h = horarios.find((x) => x.dia_semana === diaSemana(hoy));
  const evHoy = eventos.filter((e) => e.fecha === hoy);

  let tardes = 0;
  for (let f = lunes; f <= hoy; f = sumarDias(f, 1)) {
    const r = analizarDia(eventos.filter((e) => e.fecha === f), horarios.find((x) => x.dia_semana === diaSemana(f)), aj, f === hoy);
    if (r.tardeMin) tardes++;
  }

  const maxB = h?.breaks_por_dia ?? 0;
  const hayAlmuerzo = (h?.minutos_almuerzo ?? 0) > 0;
  const r0 = analizarDia(evHoy, h, aj, true);
  const trabajando = r0.estado === "trabajando";
  const boton = (tipo, texto, activo, principal = false) =>
    `<button class="btn btn-grande ${principal ? "btn-rojo" : ""}" data-marcar="${tipo}" ${activo ? "" : "disabled"}>${texto}</button>`;

  const botones = [
    boton("entrada", "Marcar entrada", r0.estado === "sin_entrada", true),
    r0.estado === "break"
      ? boton("break_fin", "Terminar break", true, true)
      : boton("break_inicio", `Iniciar break · ${Math.max(0, maxB - r0.breaks.length)} de ${maxB}`, trabajando && r0.breaks.length < maxB),
    hayAlmuerzo
      ? (r0.estado === "almuerzo"
        ? boton("almuerzo_fin", "Terminar almuerzo", true, true)
        : boton("almuerzo_inicio", r0.almuerzos.length ? "Almuerzo tomado" : "Iniciar almuerzo", trabajando && !r0.almuerzos.length))
      : "",
    boton("salida", "Marcar salida", trabajando)
  ].join("");

  cont.innerHTML = `
    <div class="jornada">
      <div class="panel estado-jornada" id="estado-jornada"></div>
      <div class="botones-jornada">${botones}</div>
    </div>
    <div class="cifras">
      <div class="cifra"><b>${r0.breaks.length}/${maxB}</b><span>Breaks usados hoy (${h?.minutos_break ?? 10} min c/u)</span></div>
      <div class="cifra"><b>${hayAlmuerzo ? (r0.almuerzos.length ? "Sí" : "No") : "—"}</b><span>${hayAlmuerzo ? `Almuerzo tomado (${h.minutos_almuerzo} min)` : "Hoy no hay almuerzo"}</span></div>
      <div class="cifra ${tardes > aj.max_tardanzas_semana ? "cifra-alerta" : ""}"><b>${tardes}/${aj.max_tardanzas_semana}</b><span>Llegadas tarde esta semana</span></div>
    </div>
    <div class="panel"><h2>Marcaciones de hoy</h2>
      ${evHoy.length ? `<ul class="linea-tiempo">${evHoy.map((e) => `<li><span>${horaCorta(e.momento)}</span>${NOMBRE_MARCA[e.tipo]}</li>`).join("")}</ul>`
        : `<p class="vacio">Todavía no hay marcaciones hoy.</p>`}
    </div>`;

  const pintarEstado = () => {
    const box = $("#estado-jornada", cont);
    if (!box) { clearInterval(intervalo); return; }
    const r = analizarDia(evHoy, h, aj, true);
    let titulo, detalle, clase = "";
    if (r.estado === "sin_entrada") {
      titulo = "Aún no marcas entrada";
      detalle = h?.laboral ? `Hoy tu horario es de ${fmtHora(h.hora_entrada)} a ${fmtHora(h.hora_salida)}` : "Hoy no es día laboral";
    } else if (r.estado === "trabajando") {
      titulo = "En turno"; clase = "ok";
      detalle = `Tiempo trabajado hoy <b>${reloj(r.neto * 60000)}</b>`;
    } else if (r.estado === "break" || r.estado === "almuerzo") {
      const tramo = (r.estado === "break" ? r.breaks : r.almuerzos).at(-1);
      const limite = (r.estado === "break" ? h?.minutos_break ?? 10 : h?.minutos_almuerzo ?? 60) * 60000;
      const resta = limite - (Date.now() - tramo.ini);
      titulo = r.estado === "break" ? "En break" : "En almuerzo";
      clase = resta >= 0 ? "pausa" : "alerta";
      detalle = resta >= 0 ? `Te quedan <b>${reloj(resta)}</b>` : `Te pasaste <b>${reloj(-resta)}</b>`;
    } else {
      titulo = "Jornada terminada";
      detalle = `Trabajaste <b>${duracion(r.neto)}</b> hoy. ¡Buen trabajo!`;
    }
    box.className = `panel estado-jornada ${clase}`;
    box.innerHTML = `<span class="estado-titulo">${titulo}</span><p>${detalle}</p>`;
  };
  pintarEstado();
  if (intervalo) clearInterval(intervalo);
  intervalo = setInterval(pintarEstado, 1000);

  $(".botones-jornada", cont).addEventListener("click", async (e) => {
    const b = e.target.closest("[data-marcar]");
    if (!b || b.disabled) return;
    if (b.dataset.marcar === "salida" && !confirm("¿Seguro que quieres marcar la salida? Después no podrás marcar nada más hoy.")) return;
    b.disabled = true;
    const { error } = await sb.from("asistencia").insert({ tipo: b.dataset.marcar });
    if (error) { b.disabled = false; return toast(traducirError(error), "error"); }
    toast(`${NOMBRE_MARCA[b.dataset.marcar]} marcada a las ${horaCorta(Date.now())}`);
    navegar();
  });
}

// ---------- Vista admin: Asistencia ----------
let semanaAsistencia = null;

async function vistaAsistencia(el) {
  if (!semanaAsistencia) semanaAsistencia = lunesDe(hoyISO());
  const lunes = semanaAsistencia, sabado = sumarDias(lunes, 5), domingo = sumarDias(lunes, 6), hoy = hoyISO();

  el.innerHTML = encabezado("Asistencia", `Semana del ${fechaCorta(lunes)} al ${fechaCorta(sabado)}`,
    `<div class="acciones">
      <button class="btn" data-sem="-7">← Anterior</button>
      <button class="btn" data-sem="0">Esta semana</button>
      <button class="btn" data-sem="7">Siguiente →</button>
    </div>`) +
    `<div id="reporte"><p class="vacio">Cargando…</p></div>
     <div class="panel" id="config-horarios"><p class="vacio">Cargando horarios…</p></div>`;

  $(".titulo-pagina .acciones", el).addEventListener("click", (e) => {
    const b = e.target.closest("[data-sem]");
    if (!b) return;
    semanaAsistencia = b.dataset.sem === "0" ? lunesDe(hoyISO()) : sumarDias(semanaAsistencia, Number(b.dataset.sem));
    vistaAsistencia(el);
  });

  const [per, asis, hor, aju, nov] = await Promise.all([
    sb.from("perfiles").select("id,nombre,email,cargo,rol,activo").order("nombre"),
    sb.from("asistencia").select("*").gte("fecha", lunes).lte("fecha", domingo).order("momento"),
    sb.from("horarios").select("*").order("dia_semana"),
    sb.from("ajustes").select("*").maybeSingle(),
    sb.from("novedades_empleado").select("*").lte("fecha_inicio", domingo).gte("fecha_fin", lunes)
  ]);
  const error = per.error || asis.error || hor.error || aju.error || nov.error;
  if (error) { $("#reporte", el).innerHTML = `<p class="vacio">${esc(traducirError(error))}</p>`; return; }

  const aj = aju.data || { minutos_tolerancia: 10, max_tardanzas_semana: 2 };
  const horarios = hor.data;
  const conMarcas = new Set(asis.data.map((e) => e.empleado_id));
  const personas = per.data.filter((p) => (p.activo && p.rol === "empleado") || conMarcas.has(p.id));

  const dias = [];
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(lunes, i);
    if (i < 6 || asis.data.some((e) => e.fecha === f)) dias.push(f);
  }

  if (!personas.length) {
    $("#reporte", el).innerHTML = `<div class="panel"><p class="vacio">No hay empleados activos. Agrégalos en la sección Empleados.</p></div>`;
  } else {
    $("#reporte", el).innerHTML = personas.map((p) => {
      let horas = 0, diasTrab = 0, tardes = 0;
      const filas = dias.map((f) => {
        const h = horarios.find((x) => x.dia_semana === diaSemana(f));
        const ev = asis.data.filter((e) => e.empleado_id === p.id && e.fecha === f);
        const r = analizarDia(ev, h, aj, f === hoy);
        const novs = nov.data.filter((n) => n.empleado_id === p.id && n.fecha_inicio <= f && n.fecha_fin >= f);
        if (r.entrada) { diasTrab++; horas += r.neto; }
        if (r.tardeMin) tardes++;
        const futuro = f > hoy;
        const alertas = [
          ...novs.map((n) => `<span class="chip chip-info">${esc(n.tipo)}</span>`),
          ...r.alertas.map((a) => `<span class="chip chip-alerta">${esc(a)}</span>`),
          (!r.entrada && !futuro && h?.laboral && !novs.length) ? `<span class="chip chip-alerta">Sin marcar</span>` : ""
        ].join("");
        return `<tr class="${futuro ? "fila-futura" : ""}">
          <td><b>${DIAS_CORTOS[diaSemana(f)]}</b><span class="sub">${fechaCorta(f)}</span></td>
          <td>${r.entrada ? horaCorta(r.entrada) : "—"}</td>
          <td>${r.salida ? horaCorta(r.salida) : "—"}</td>
          <td>${r.breaks.length ? `${r.breaks.length} · ${Math.round(r.minBreak)} min` : "—"}</td>
          <td>${r.almuerzos.length ? `${Math.round(r.minAlm)} min` : "—"}</td>
          <td>${r.entrada && r.neto ? duracion(r.neto) : "—"}</td>
          <td><div class="chips">${alertas || (r.entrada ? `<span class="chip chip-ok">OK</span>` : "")}</div></td>
          <td>${futuro ? "" : `<button class="btn btn-chico" data-detalle="${p.id}|${f}">Ver</button>`}</td>
        </tr>`;
      }).join("");
      const excede = tardes > aj.max_tardanzas_semana;
      return `<div class="panel">
        <div class="resumen-emp">
          <div><h2 style="margin:0">${esc(p.nombre || p.email)}</h2><span class="sub">${esc(p.cargo || "")}</span></div>
          <div class="chips">
            <span class="chip">${diasTrab} días</span>
            <span class="chip">${duracion(horas)} trabajadas</span>
            <span class="chip ${excede ? "chip-alerta fuerte" : tardes === aj.max_tardanzas_semana ? "chip-aviso" : ""}">
              Llegadas tarde: ${tardes}/${aj.max_tardanzas_semana}${excede ? " · Supera el máximo" : ""}</span>
          </div>
        </div>
        <div class="tabla-wrap"><table>
          <thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th>Breaks</th><th>Almuerzo</th><th>Horas netas</th><th>Alertas</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table></div>
      </div>`;
    }).join("");

    $("#reporte", el).onclick = (e) => {
      const b = e.target.closest("[data-detalle]");
      if (!b) return;
      const [id, fecha] = b.dataset.detalle.split("|");
      modalMarcaciones(per.data.find((x) => x.id === id), fecha, () => vistaAsistencia(el));
    };
  }

  pintarConfigHorarios($("#config-horarios", el), horarios, aj);
}

// Detalle y corrección manual de marcaciones de un día
async function modalMarcaciones(p, fecha, alCambiar) {
  const { fondo } = abrirModal({
    titulo: `${p.nombre || p.email} · ${DIAS_CORTOS[diaSemana(fecha)]} ${fechaCorta(fecha)}`,
    sinPie: true,
    cuerpo: `
      <div class="tabla-wrap" id="lista-marcas"><p class="vacio">Cargando…</p></div>
      <h4 class="subtitulo">Agregar marcación manual</h4>
      <p class="ayuda" style="margin-top:-.5rem">Úsalo si el empleado olvidó marcar algo. Queda registrado como corrección del administrador.</p>
      <div class="fila-form">
        <div class="campo"><label>Tipo</label><select name="tipo">${Object.entries(NOMBRE_MARCA).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div class="campo"><label>Hora</label><input type="time" name="hora" required></div>
        <button class="btn btn-rojo" type="button" id="agregar-marca">Agregar</button>
      </div>`
  });

  const pintar = async () => {
    const { data, error } = await sb.from("asistencia").select("*").eq("empleado_id", p.id).eq("fecha", fecha).order("momento");
    const cont = $("#lista-marcas", fondo);
    if (error) { cont.innerHTML = `<p class="vacio">${esc(traducirError(error))}</p>`; return; }
    if (!data.length) { cont.innerHTML = `<p class="vacio">No hay marcaciones este día.</p>`; return; }
    cont.innerHTML = `<table><thead><tr><th>Hora</th><th>Marcación</th><th>Nota</th><th></th></tr></thead><tbody>
      ${data.map((m) => `<tr><td>${horaCorta(m.momento)}</td><td>${NOMBRE_MARCA[m.tipo]}</td><td>${esc(m.nota || "—")}</td>
        <td><button class="btn btn-chico btn-texto" data-borrar="${m.id}">Eliminar</button></td></tr>`).join("")}
    </tbody></table>`;
    cont.onclick = async (e) => {
      const b = e.target.closest("[data-borrar]");
      if (!b || !confirm("¿Eliminar esta marcación?")) return;
      const { error } = await sb.from("asistencia").delete().eq("id", b.dataset.borrar);
      if (error) return toast(traducirError(error), "error");
      toast("Marcación eliminada"); pintar(); alCambiar();
    };
  };

  $("#agregar-marca", fondo).addEventListener("click", async () => {
    const tipo = $("[name=tipo]", fondo).value, hora = $("[name=hora]", fondo).value;
    if (!hora) return toast("Escribe la hora de la marcación.", "error");
    const momento = new Date(`${fecha}T${hora}:00-05:00`).toISOString();
    const { error } = await sb.from("asistencia").insert({ empleado_id: p.id, tipo, momento, fecha, nota: "Corrección del administrador" });
    if (error) return toast(traducirError(error), "error");
    toast("Marcación agregada"); pintar(); alCambiar();
  });
  pintar();
}

// Configuración de horarios, tolerancia y máximo de llegadas tarde
function pintarConfigHorarios(cont, horarios, aj) {
  const orden = [1, 2, 3, 4, 5, 6, 0];
  cont.innerHTML = `<details>
    <summary><h2 style="display:inline;margin:0">Configurar horarios</h2></summary>
    <div class="fila-form" style="margin:1rem 0">
      <div class="campo"><label>Minutos de tolerancia para llegar</label><input type="number" min="0" id="aj-tol" value="${aj.minutos_tolerancia}"></div>
      <div class="campo"><label>Máximo de llegadas tarde por semana</label><input type="number" min="0" id="aj-max" value="${aj.max_tardanzas_semana}"></div>
    </div>
    <div class="tabla-wrap"><table class="tabla-config">
      <thead><tr><th>Día</th><th>Laboral</th><th>Entrada</th><th>Salida</th><th>Breaks</th><th>Min. break</th><th>Min. almuerzo</th></tr></thead>
      <tbody>${orden.map((d) => {
        const h = horarios.find((x) => x.dia_semana === d);
        return `<tr data-dia="${d}">
          <td><b>${esc(h.nombre_dia)}</b></td>
          <td><input type="checkbox" name="laboral" ${h.laboral ? "checked" : ""} aria-label="Laboral"></td>
          <td><input type="time" name="hora_entrada" value="${(h.hora_entrada || "").slice(0, 5)}"></td>
          <td><input type="time" name="hora_salida" value="${(h.hora_salida || "").slice(0, 5)}"></td>
          <td><input type="number" min="0" name="breaks_por_dia" value="${h.breaks_por_dia}"></td>
          <td><input type="number" min="0" name="minutos_break" value="${h.minutos_break}"></td>
          <td><input type="number" min="0" name="minutos_almuerzo" value="${h.minutos_almuerzo}"></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>
    <div style="margin-top:1rem"><button class="btn btn-rojo" id="guardar-horarios">Guardar horarios</button></div>
  </details>`;

  $("#guardar-horarios", cont).addEventListener("click", async (e) => {
    e.target.disabled = true;
    const cambios = [...cont.querySelectorAll("tr[data-dia]")].map((tr) => {
      const val = (n) => $(`[name=${n}]`, tr);
      return sb.from("horarios").update({
        laboral: val("laboral").checked,
        hora_entrada: val("hora_entrada").value || null,
        hora_salida: val("hora_salida").value || null,
        breaks_por_dia: Number(val("breaks_por_dia").value) || 0,
        minutos_break: Number(val("minutos_break").value) || 0,
        minutos_almuerzo: Number(val("minutos_almuerzo").value) || 0
      }).eq("dia_semana", Number(tr.dataset.dia));
    });
    cambios.push(sb.from("ajustes").update({
      minutos_tolerancia: Number($("#aj-tol", cont).value) || 0,
      max_tardanzas_semana: Number($("#aj-max", cont).value) || 0
    }).eq("id", 1));
    const resultados = await Promise.all(cambios);
    e.target.disabled = false;
    const fallo = resultados.find((x) => x.error);
    if (fallo) return toast(traducirError(fallo.error), "error");
    toast("Horarios guardados");
    navegar();
  });
}

// =====================================================
//  FASE 3 · TAREAS Y CONTROL DE TIEMPOS
// =====================================================
let intervaloTareas = null;
let diaTareas = null;

const ESTADO_TAREA = {
  pendiente: { texto: "Pendiente", clase: "" },
  en_progreso: { texto: "En progreso", clase: "chip-ok" },
  pausada: { texto: "Pausada", clase: "chip-aviso" },
  terminada: { texto: "Terminada", clase: "chip-info" }
};

// Suma los minutos reales de una tarea y dice si está corriendo
function tiempoTarea(tramos) {
  let min = 0, corriendo = null;
  for (const t of tramos) {
    const ini = new Date(t.inicio).getTime();
    const fin = t.fin ? new Date(t.fin).getTime() : Date.now();
    min += (fin - ini) / 60000;
    if (!t.fin) corriendo = ini;
  }
  return { min, corriendo };
}

async function cargarTareas(filtro) {
  const tareas = await filtro;
  if (tareas.error) return { error: tareas.error };
  const ids = tareas.data.map((t) => t.id);
  if (!ids.length) return { tareas: [], tramos: [] };
  const tramos = await sb.from("tarea_tiempos").select("*").in("tarea_id", ids).order("inicio");
  if (tramos.error) return { error: tramos.error };
  return { tareas: tareas.data, tramos: tramos.data };
}

// ---------- Vista empleado: Mis tareas ----------
async function vistaMisTareas(el, conEncabezado = true) {
  if (conEncabezado) el.innerHTML = encabezado("Mis tareas", "Inicia y termina tus tareas para llevar el tiempo real.");
  const cont = document.createElement("div");
  cont.innerHTML = `<p class="vacio">Cargando…</p>`;
  el.appendChild(cont);

  const hoy = hoyISO();
  const r = await cargarTareas(
    sb.from("tareas").select("*").eq("empleado_id", perfil.id).gte("fecha", sumarDias(hoy, -60)).order("fecha").order("id")
  );
  if (r.error) { cont.innerHTML = `<p class="vacio">${esc(traducirError(r.error))}</p>`; return; }

  const visibles = r.tareas.filter((t) => t.estado !== "terminada" || t.fecha === hoy);
  if (!visibles.length) {
    cont.innerHTML = `<div class="panel"><p class="vacio">No tienes tareas asignadas. Tu administrador te las asigna desde el HUB.</p></div>`;
    return;
  }

  const tramosDe = (id) => r.tramos.filter((x) => x.tarea_id === id);
  const activa = visibles.find((t) => t.estado === "en_progreso");

  const tarjeta = (t) => {
    const { min, corriendo } = tiempoTarea(tramosDe(t.id));
    const est = ESTADO_TAREA[t.estado];
    const terminada = t.estado === "terminada";
    const atrasada = t.minutos_estimados && min > t.minutos_estimados;
    return `<div class="panel tarea ${corriendo ? "corriendo" : ""}">
      <div class="tarea-top">
        <div>
          <h3>${esc(t.titulo)}</h3>
          ${t.descripcion ? `<p class="sub">${esc(t.descripcion)}</p>` : ""}
          <div class="chips">
            <span class="chip ${est.clase}">${est.texto}</span>
            ${t.fecha !== hoy ? `<span class="chip chip-aviso">De ${fechaCorta(t.fecha)}</span>` : ""}
            ${t.minutos_estimados ? `<span class="chip">Estimado: ${duracion(t.minutos_estimados)}</span>` : ""}
            <span class="chip ${atrasada ? "chip-alerta" : ""}">Real: <b data-tiempo="${t.id}">${duracion(min)}</b></span>
          </div>
        </div>
        <div class="tarea-acciones">
          ${terminada ? `<span class="chip chip-info">✔ Lista</span>` : `
            ${corriendo
              ? `<button class="btn btn-grande" data-tarea="pausar|${t.id}">Pausar</button>`
              : `<button class="btn btn-grande btn-rojo" data-tarea="iniciar|${t.id}">${min ? "Continuar" : "Iniciar"}</button>`}
            <button class="btn btn-grande" data-tarea="terminar|${t.id}">Terminar</button>`}
        </div>
      </div>
    </div>`;
  };

  cont.innerHTML = `
    ${activa ? `<div class="panel estado-jornada ok" id="tarea-activa"></div>` : ""}
    <h3 class="subtitulo">Por hacer</h3>
    ${visibles.filter((t) => t.estado !== "terminada").map(tarjeta).join("") || `<div class="panel"><p class="vacio">Todo al día.</p></div>`}
    ${visibles.some((t) => t.estado === "terminada") ? `<h3 class="subtitulo">Terminadas hoy</h3>${visibles.filter((t) => t.estado === "terminada").map(tarjeta).join("")}` : ""}`;

  const refrescar = () => {
    for (const t of visibles) {
      const { min } = tiempoTarea(tramosDe(t.id));
      const b = cont.querySelector(`[data-tiempo="${t.id}"]`);
      if (b) b.textContent = duracion(min);
    }
    const box = $("#tarea-activa", cont);
    if (box && activa) {
      const { min, corriendo } = tiempoTarea(tramosDe(activa.id));
      box.innerHTML = `<span class="estado-titulo">${esc(activa.titulo)}</span>
        <p>Trabajando ahora · <b>${reloj((corriendo ? Date.now() - corriendo : 0))}</b> en este tramo · ${duracion(min)} en total</p>`;
    }
  };
  refrescar();
  if (intervaloTareas) clearInterval(intervaloTareas);
  intervaloTareas = setInterval(refrescar, 1000);

  cont.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-tarea]");
    if (!b) return;
    const [accion, id] = b.dataset.tarea.split("|");
    b.disabled = true;
    let error = null;
    if (accion === "iniciar") {
      ({ error } = await sb.from("tarea_tiempos").insert({ tarea_id: Number(id) }));
    } else {
      const cierre = await sb.from("tarea_tiempos").update({ fin: new Date().toISOString() }).eq("tarea_id", Number(id)).is("fin", null);
      error = cierre.error;
      if (!error) ({ error } = await sb.from("tareas").update({ estado: accion === "terminar" ? "terminada" : "pausada" }).eq("id", Number(id)));
    }
    if (error) { b.disabled = false; return toast(traducirError(error), "error"); }
    toast(accion === "iniciar" ? "Cronómetro iniciado" : accion === "pausar" ? "Tarea pausada" : "¡Tarea terminada!");
    navegar();
  });
}

// ---------- Vista admin: Tareas ----------
async function vistaTareasAdmin(el) {
  if (!diaTareas) diaTareas = hoyISO();
  const hoy = hoyISO();

  el.innerHTML = encabezado("Tareas", `${diaTareas === hoy ? "Hoy · " : ""}${fechaCorta(diaTareas)}`,
    `<div class="acciones">
      <button class="btn" data-dia="-1">←</button>
      <button class="btn" data-dia="0">Hoy</button>
      <button class="btn" data-dia="1">→</button>
      <button class="btn btn-rojo" id="nueva-tarea">+ Asignar tarea</button>
    </div>`) + `<div id="lista-tareas"><p class="vacio">Cargando…</p></div>`;

  $(".titulo-pagina .acciones", el).addEventListener("click", (e) => {
    const b = e.target.closest("[data-dia]");
    if (!b) return;
    diaTareas = b.dataset.dia === "0" ? hoy : sumarDias(diaTareas, Number(b.dataset.dia));
    vistaTareasAdmin(el);
  });

  const per = await sb.from("perfiles").select("id,nombre,email,cargo,rol,activo").eq("activo", true).order("nombre");
  const empleados = (per.data || []).filter((p) => p.rol === "empleado");
  $("#nueva-tarea", el).addEventListener("click", () => formTarea(null, empleados, () => vistaTareasAdmin(el)));

  const r = await cargarTareas(
    sb.from("tareas").select("*").gte("fecha", sumarDias(diaTareas, -60)).lte("fecha", diaTareas).order("id")
  );
  if (r.error) { $("#lista-tareas", el).innerHTML = `<p class="vacio">${esc(traducirError(r.error))}</p>`; return; }

  const delDia = r.tareas.filter((t) => t.fecha === diaTareas);
  const atrasadas = r.tareas.filter((t) => t.fecha < diaTareas && t.estado !== "terminada");
  const nombre = (id) => (per.data || []).find((p) => p.id === id)?.nombre || "Sin asignar";

  const fila = (t) => {
    const { min, corriendo } = tiempoTarea(r.tramos.filter((x) => x.tarea_id === t.id));
    const est = ESTADO_TAREA[t.estado];
    const dif = t.minutos_estimados ? min - t.minutos_estimados : null;
    return `<tr>
      <td><b>${esc(t.titulo)}</b>${t.descripcion ? `<span class="sub">${esc(t.descripcion)}</span>` : ""}</td>
      <td>${esc(nombre(t.empleado_id))}</td>
      <td><span class="chip ${est.clase}">${est.texto}</span>${corriendo ? ` <span class="chip chip-ok">▶</span>` : ""}</td>
      <td>${t.minutos_estimados ? duracion(t.minutos_estimados) : "—"}</td>
      <td>${min ? duracion(min) : "—"}</td>
      <td>${dif === null || !min ? "—" : t.estado !== "terminada"
        ? (dif > 0 ? `<span class="chip chip-alerta">+${duracion(dif)}</span>` : `<span class="chip">En curso</span>`)
        : `<span class="chip ${dif > 0 ? "chip-alerta" : "chip-ok"}">${dif > 0 ? "+" : "−"}${duracion(Math.abs(dif))}</span>`}</td>
      <td><div class="acciones">
        <button class="btn btn-chico" data-acc="tiempos|${t.id}">Tiempos</button>
        <button class="btn btn-chico" data-acc="editar|${t.id}">Editar</button>
        <button class="btn btn-chico btn-texto" data-acc="borrar|${t.id}">Eliminar</button>
      </div></td>
    </tr>`;
  };

  const tabla = (lista) => `<div class="tabla-wrap"><table>
    <thead><tr><th>Tarea</th><th>Empleado</th><th>Estado</th><th>Estimado</th><th>Real</th><th>Diferencia</th><th></th></tr></thead>
    <tbody>${lista.map(fila).join("")}</tbody></table></div>`;

  $("#lista-tareas", el).innerHTML = `
    <div class="panel"><h2>Tareas del día</h2>
      ${delDia.length ? tabla(delDia) : `<p class="vacio">No hay tareas para este día. Asigna la primera.</p>`}
    </div>
    ${atrasadas.length ? `<div class="panel"><h2>Vienen de días anteriores</h2>${tabla(atrasadas)}</div>` : ""}`;

  $("#lista-tareas", el).onclick = async (e) => {
    const b = e.target.closest("[data-acc]");
    if (!b) return;
    const [accion, id] = b.dataset.acc.split("|");
    const t = r.tareas.find((x) => String(x.id) === id);
    if (accion === "editar") formTarea(t, empleados, () => vistaTareasAdmin(el));
    if (accion === "tiempos") modalTiempos(t, nombre(t.empleado_id), r.tramos.filter((x) => x.tarea_id === t.id));
    if (accion === "borrar") {
      if (!confirm(`¿Eliminar la tarea "${t.titulo}"? También se borra su historial de tiempos.`)) return;
      const { error } = await sb.from("tareas").delete().eq("id", t.id);
      if (error) return toast(traducirError(error), "error");
      toast("Tarea eliminada");
      vistaTareasAdmin(el);
    }
  };
}

function formTarea(t, empleados, alGuardar) {
  const nuevo = !t;
  abrirModal({
    titulo: nuevo ? "Asignar tarea" : "Editar tarea",
    botonTexto: nuevo ? "Asignar" : "Guardar cambios",
    cuerpo: `
      <div class="campo"><label>Tarea *</label>
        <input name="titulo" required placeholder="Ej: Tapizar sillas Mazda 3" value="${esc(t?.titulo ?? "")}"></div>
      <div class="campo"><label>Detalles</label>
        <textarea name="descripcion" rows="2" placeholder="Color, material, placa del carro, observaciones…">${esc(t?.descripcion ?? "")}</textarea></div>
      <div class="rejilla">
        <div class="campo"><label>Empleado *</label><select name="empleado_id" required>
          <option value="">Selecciona…</option>
          ${empleados.map((p) => `<option value="${p.id}" ${t?.empleado_id === p.id ? "selected" : ""}>${esc(p.nombre || p.email)}</option>`).join("")}
        </select></div>
        <div class="campo"><label>Fecha</label><input type="date" name="fecha" value="${esc(t?.fecha ?? diaTareas ?? hoyISO())}"></div>
        <div class="campo"><label>Tiempo estimado (minutos)</label>
          <input type="number" min="0" name="minutos_estimados" placeholder="Ej: 120" value="${t?.minutos_estimados ?? ""}"></div>
        ${nuevo ? "" : `<div class="campo"><label>Estado</label><select name="estado">
          ${Object.entries(ESTADO_TAREA).map(([k, v]) => `<option value="${k}" ${t.estado === k ? "selected" : ""}>${v.texto}</option>`).join("")}
        </select></div>`}
      </div>`,
    alGuardar: async (d) => {
      const datos = {
        titulo: d.titulo.trim(),
        descripcion: d.descripcion.trim() || null,
        empleado_id: d.empleado_id,
        fecha: d.fecha || hoyISO(),
        minutos_estimados: d.minutos_estimados ? Number(d.minutos_estimados) : null
      };
      if (!nuevo) datos.estado = d.estado;
      const { error } = nuevo
        ? await sb.from("tareas").insert(datos)
        : await sb.from("tareas").update(datos).eq("id", t.id);
      if (error) { toast(traducirError(error), "error"); return false; }
      toast(nuevo ? "Tarea asignada" : "Tarea actualizada");
      alGuardar();
      return true;
    }
  });
}

function modalTiempos(t, nombreEmpleado, tramos) {
  const { min } = tiempoTarea(tramos);
  abrirModal({
    titulo: `Tiempos · ${t.titulo}`,
    sinPie: true,
    cuerpo: `
      <div class="chips">
        <span class="chip">${esc(nombreEmpleado)}</span>
        <span class="chip">Total real: ${duracion(min)}</span>
        ${t.minutos_estimados ? `<span class="chip">Estimado: ${duracion(t.minutos_estimados)}</span>` : ""}
      </div>
      ${tramos.length ? `<div class="tabla-wrap"><table>
        <thead><tr><th>Día</th><th>Desde</th><th>Hasta</th><th>Duración</th><th>Pausa</th></tr></thead>
        <tbody>${tramos.map((x) => {
          const fin = x.fin ? new Date(x.fin).getTime() : Date.now();
          return `<tr><td>${fechaCorta(new Date(x.inicio).toLocaleDateString("en-CA", { timeZone: TZ }))}</td>
            <td>${horaCorta(x.inicio)}</td><td>${x.fin ? horaCorta(x.fin) : "En curso"}</td>
            <td>${duracion((fin - new Date(x.inicio).getTime()) / 60000)}</td>
            <td>${x.motivo_pausa === "auto" ? "Break / almuerzo" : esc(x.motivo_pausa || "—")}</td></tr>`;
        }).join("")}</tbody></table></div>`
        : `<p class="vacio">Esta tarea todavía no tiene tiempos registrados.</p>`}
      <p class="ayuda">Los tramos se cortan solos cuando el empleado sale a break, a almuerzo o marca salida, para que el tiempo real no se infle.</p>`
  });
}

// =====================================================
//  FASE 4 · INVENTARIOS
// =====================================================
let opcionesCache = null;
let tabInventario = "productos";
let nombresUsuarios = {};

async function cargarOpciones(forzar = false) {
  if (!opcionesCache || forzar) {
    const { data } = await sb.from("opciones").select("*").order("categoria").order("orden").order("valor");
    opcionesCache = data || [];
  }
  return opcionesCache;
}
const ops = (cat) => (opcionesCache || []).filter((o) => o.categoria === cat && o.activo).map((o) => o.valor);
const selectOps = (name, cat, valor = "", obligatorio = false) =>
  `<select name="${name}" ${obligatorio ? "required" : ""}><option value="">—</option>${ops(cat).map((v) => `<option ${v === valor ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
const chipCantidad = (item) => {
  const bajo = Number(item.stock_minimo) > 0 && Number(item.cantidad) <= Number(item.stock_minimo);
  return `<b class="${bajo ? "texto-alerta" : ""}">${Number(item.cantidad)}</b>${bajo ? ` <span class="chip chip-alerta">Stock bajo</span>` : ""}`;
};
const pesos = (n) => Number(n || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

async function cargarNombres() {
  if (Object.keys(nombresUsuarios).length) return;
  const { data } = await sb.from("perfiles").select("id,nombre,email");
  (data || []).forEach((p) => { nombresUsuarios[p.id] = p.nombre || p.email; });
}

// Barra de búsqueda reutilizable
function barraBusqueda(id, placeholder, filtros = "", boton = "") {
  return `<div class="barra-inv">
    <input type="search" id="${id}" placeholder="${placeholder}" autocomplete="off">
    ${filtros}${boton}</div>`;
}
const coincide = (texto, q) => !q || texto.toLowerCase().includes(q.toLowerCase());

// ---------- Vista admin: Inventarios (con pestañas) ----------
async function vistaInventarios(el) {
  await cargarOpciones();
  const pestanas = [
    ["productos", "Productos"], ["moldes", "Moldes"],
    ["materias", "Materias primas"], ["listas", "Listas"]
  ];
  el.innerHTML = encabezado("Inventarios", "Productos terminados, moldes y materias primas.") +
    `<div class="pestanas">${pestanas.map(([id, t]) => `<button class="pestana ${tabInventario === id ? "activa" : ""}" data-tab="${id}">${t}</button>`).join("")}</div>
     <div id="panel-inv"></div>`;
  $(".pestanas", el).addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    tabInventario = b.dataset.tab;
    vistaInventarios(el);
  });
  const cont = $("#panel-inv", el);
  if (tabInventario === "productos") panelProductos(cont, true);
  if (tabInventario === "moldes") panelMoldes(cont, true);
  if (tabInventario === "materias") panelMaterias(cont);
  if (tabInventario === "listas") panelListas(cont);
}

// ---------- Vistas empleado ----------
async function vistaInventarioEmpleado(el) {
  await cargarOpciones();
  el.innerHTML = encabezado("Inventario", "Consulta los productos terminados disponibles.");
  const cont = document.createElement("div");
  el.appendChild(cont);
  panelProductos(cont, false);
}
async function vistaMoldesEmpleado(el) {
  await cargarOpciones();
  el.innerHTML = encabezado("Moldes", "Consulta los moldes de tapetes, bodegas y tapicería.");
  const cont = document.createElement("div");
  el.appendChild(cont);
  panelMoldes(cont, false);
}

// ---------- Panel: Productos terminados ----------
async function panelProductos(cont, esAdmin) {
  await cargarOpciones();
  cont.innerHTML = `<div class="panel"><p class="vacio">Cargando…</p></div>`;
  const { data, error } = await sb.from("productos").select("*").order("marca").order("referencia");
  if (error) { cont.innerHTML = `<div class="panel"><p class="vacio">${esc(traducirError(error))}</p></div>`; return; }

  cont.innerHTML = `<div class="panel">
    ${barraBusqueda("q-prod", "Buscar por marca, referencia, año o material…",
      `<select id="f-cat"><option value="">Todas las categorías</option>${ops("producto_categoria").map((v) => `<option>${esc(v)}</option>`).join("")}</select>
       <select id="f-est"><option value="">Todos los estados</option>${ops("producto_estado").map((v) => `<option>${esc(v)}</option>`).join("")}</select>`,
      esAdmin ? `<button class="btn btn-rojo" id="nuevo-prod">+ Agregar producto</button>` : "")}
    <div class="tabla-wrap" id="t-prod"></div>
  </div>`;

  const pintar = () => {
    const q = $("#q-prod", cont).value, cat = $("#f-cat", cont).value, est = $("#f-est", cont).value;
    const lista = data.filter((p) =>
      coincide([p.marca, p.referencia, p.anio, p.material, p.ubicacion, p.nombre].filter(Boolean).join(" "), q) &&
      (!cat || p.categoria === cat) && (!est || p.estado === est));
    $("#t-prod", cont).innerHTML = !lista.length
      ? `<p class="vacio">No hay productos que coincidan.</p>`
      : `<table><thead><tr><th>Producto</th><th>Categoría</th><th>Estado</th><th>Cantidad</th><th>Ubicación</th>${esAdmin ? "<th>Costo</th>" : ""}<th>Precio</th><th></th></tr></thead><tbody>
        ${lista.map((p) => `<tr>
          <td><b>${esc([p.marca, p.referencia].filter(Boolean).join(" ") || p.nombre || "Sin nombre")}</b>
            <span class="sub">${esc([p.anio, p.material].filter(Boolean).join(" · ") || "")}</span></td>
          <td>${esc(p.categoria || "—")}</td>
          <td><span class="chip ${p.estado === "Defecto" ? "chip-aviso" : "chip-ok"}">${esc(p.estado || "Full")}</span></td>
          <td>${chipCantidad(p)}</td>
          <td>${esc(p.ubicacion || "—")}</td>
          ${esAdmin ? `<td>${pesos(p.costo)}</td>` : ""}
          <td>${pesos(p.precio_venta)}</td>
          <td><div class="acciones">
            ${esAdmin ? `<button class="btn btn-chico btn-rojo" data-acc="ajustar|${p.id}">Ajustar</button>
            <button class="btn btn-chico" data-acc="editar|${p.id}">Editar</button>` : ""}
            <button class="btn btn-chico" data-acc="historial|${p.id}">Historial</button>
            ${esAdmin ? `<button class="btn btn-chico btn-texto" data-acc="borrar|${p.id}">Eliminar</button>` : ""}
          </div></td></tr>`).join("")}
      </tbody></table><p class="ayuda" style="margin-top:1rem">${lista.length} producto(s) · ${lista.reduce((s, p) => s + Number(p.cantidad), 0)} unidades en total</p>`;
  };
  pintar();

  const recargar = () => panelProductos(cont, esAdmin);
  $("#q-prod", cont).addEventListener("input", pintar);
  $("#f-cat", cont).addEventListener("change", pintar);
  $("#f-est", cont).addEventListener("change", pintar);
  if (esAdmin) $("#nuevo-prod", cont).addEventListener("click", () => formProducto(null, esAdmin, recargar));
  $("#t-prod", cont).addEventListener("click", async (e) => {
    const b = e.target.closest("[data-acc]");
    if (!b) return;
    const [accion, id] = b.dataset.acc.split("|");
    const p = data.find((x) => String(x.id) === id);
    if (accion === "editar") formProducto(p, esAdmin, recargar);
    if (accion === "ajustar") modalAjustar("producto", p, [p.marca, p.referencia].filter(Boolean).join(" ") || p.nombre, "unidades", recargar);
    if (accion === "historial") modalHistorial("producto", p.id);
    if (accion === "borrar") {
      if (!confirm(`¿Eliminar "${p.marca || ""} ${p.referencia || p.nombre}" del inventario?`)) return;
      const { error } = await sb.from("productos").delete().eq("id", p.id);
      if (error) return toast(traducirError(error), "error");
      toast("Producto eliminado"); recargar();
    }
  });
}

function formProducto(p, esAdmin, alGuardar) {
  const nuevo = !p;
  const v = (c) => esc(p?.[c] ?? "");
  abrirModal({
    titulo: nuevo ? "Agregar producto" : "Editar producto",
    cuerpo: `<div class="rejilla">
        <div class="campo"><label>Marca *</label><input name="marca" required placeholder="Mazda" value="${v("marca")}"></div>
        <div class="campo"><label>Referencia *</label><input name="referencia" required placeholder="Mazda 3" value="${v("referencia")}"></div>
        <div class="campo"><label>Año</label><input name="anio" placeholder="2018-2022" value="${v("anio")}"></div>
        <div class="campo"><label>Categoría</label>${selectOps("categoria", "producto_categoria", p?.categoria ?? "Tapetes")}</div>
        <div class="campo"><label>Material</label>${selectOps("material", "producto_material", p?.material)}</div>
        <div class="campo"><label>Estado</label>${selectOps("estado", "producto_estado", p?.estado ?? "Full")}</div>
        ${nuevo ? `<div class="campo"><label>Cantidad inicial</label><input type="number" step="1" min="0" name="cantidad" value="1"></div>` : ""}
        <div class="campo"><label>Stock mínimo</label><input type="number" step="1" min="0" name="stock_minimo" value="${p?.stock_minimo ?? 0}"></div>
        <div class="campo"><label>Ubicación</label><input name="ubicacion" placeholder="Estante 3" value="${v("ubicacion")}"></div>
        ${esAdmin ? `<div class="campo"><label>Costo</label><input type="number" step="1" min="0" name="costo" value="${p?.costo ?? 0}"></div>` : ""}
        <div class="campo"><label>Precio de venta</label><input type="number" step="1" min="0" name="precio_venta" value="${p?.precio_venta ?? 0}"></div>
      </div>
      <div class="campo"><label>Notas</label><input name="notas" value="${v("notas")}"></div>`,
    alGuardar: async (d) => {
      const datos = {
        marca: d.marca.trim(), referencia: d.referencia.trim(), anio: d.anio.trim() || null,
        nombre: `${d.marca.trim()} ${d.referencia.trim()}`.trim(),
        categoria: d.categoria || "Otros", material: d.material || null, estado: d.estado || "Full",
        stock_minimo: Number(d.stock_minimo) || 0, ubicacion: d.ubicacion.trim() || null,
        precio_venta: Number(d.precio_venta) || 0, notas: d.notas.trim() || null
      };
      if (esAdmin) datos.costo = Number(d.costo) || 0;
      if (nuevo) datos.cantidad = Number(d.cantidad) || 0;
      const { error } = nuevo ? await sb.from("productos").insert(datos) : await sb.from("productos").update(datos).eq("id", p.id);
      if (error) { toast(traducirError(error), "error"); return false; }
      toast(nuevo ? "Producto agregado" : "Producto actualizado");
      alGuardar();
      return true;
    }
  });
}

// ---------- Panel: Moldes ----------
async function panelMoldes(cont, esAdmin) {
  await cargarOpciones();
  cont.innerHTML = `<div class="panel"><p class="vacio">Cargando…</p></div>`;
  const { data, error } = await sb.from("moldes").select("*").order("marca").order("referencia");
  if (error) { cont.innerHTML = `<div class="panel"><p class="vacio">${esc(traducirError(error))}</p></div>`; return; }

  cont.innerHTML = `<div class="panel">
    ${barraBusqueda("q-mol", "Buscar por marca, referencia o modelo…",
      `<select id="f-tipo"><option value="">Todos los tipos</option>${ops("molde_tipo").map((v) => `<option>${esc(v)}</option>`).join("")}</select>`,
      esAdmin ? `<button class="btn btn-rojo" id="nuevo-mol">+ Agregar molde</button>` : "")}
    <div class="tabla-wrap" id="t-mol"></div>
  </div>`;

  const pintar = () => {
    const q = $("#q-mol", cont).value, tipo = $("#f-tipo", cont).value;
    const lista = data.filter((m) =>
      coincide([m.marca, m.referencia, m.modelo, m.anio, m.version, m.ubicacion].filter(Boolean).join(" "), q) &&
      (!tipo || m.tipo === tipo));
    $("#t-mol", cont).innerHTML = !lista.length
      ? `<p class="vacio">No hay moldes que coincidan.</p>`
      : `<table><thead><tr><th>Molde</th><th>Tipo</th><th>Piezas</th><th>Cantidad</th><th>Ubicación</th><th></th></tr></thead><tbody>
        ${lista.map((m) => `<tr>
          <td><b>${esc([m.marca, m.referencia].filter(Boolean).join(" ") || "Sin nombre")}</b>
            <span class="sub">${esc([m.modelo, m.anio, m.version].filter(Boolean).join(" · "))}</span></td>
          <td>${esc(m.tipo || "—")}</td>
          <td><div class="chips">${(m.piezas || []).map((x) => `<span class="chip">${esc(x)}</span>`).join("") || "—"}</div></td>
          <td>${chipCantidad(m)}</td>
          <td>${esc(m.ubicacion || "—")}</td>
          <td><div class="acciones">
            ${esAdmin ? `<button class="btn btn-chico btn-rojo" data-acc="ajustar|${m.id}">Ajustar</button>
            <button class="btn btn-chico" data-acc="editar|${m.id}">Editar</button>` : ""}
            <button class="btn btn-chico" data-acc="historial|${m.id}">Historial</button>
            ${esAdmin ? `<button class="btn btn-chico btn-texto" data-acc="borrar|${m.id}">Eliminar</button>` : ""}
          </div></td></tr>`).join("")}
      </tbody></table><p class="ayuda" style="margin-top:1rem">${lista.length} molde(s)</p>`;
  };
  pintar();

  const recargar = () => panelMoldes(cont, esAdmin);
  $("#q-mol", cont).addEventListener("input", pintar);
  $("#f-tipo", cont).addEventListener("change", pintar);
  if (esAdmin) $("#nuevo-mol", cont).addEventListener("click", () => formMolde(null, recargar));
  $("#t-mol", cont).addEventListener("click", async (e) => {
    const b = e.target.closest("[data-acc]");
    if (!b) return;
    const [accion, id] = b.dataset.acc.split("|");
    const m = data.find((x) => String(x.id) === id);
    if (accion === "editar") formMolde(m, recargar);
    if (accion === "ajustar") modalAjustar("molde", m, [m.marca, m.referencia].filter(Boolean).join(" "), "moldes", recargar);
    if (accion === "historial") modalHistorial("molde", m.id);
    if (accion === "borrar") {
      if (!confirm(`¿Eliminar el molde "${m.marca || ""} ${m.referencia || ""}"?`)) return;
      const { error } = await sb.from("moldes").delete().eq("id", m.id);
      if (error) return toast(traducirError(error), "error");
      toast("Molde eliminado"); recargar();
    }
  });
}

function formMolde(m, alGuardar) {
  const nuevo = !m;
  const v = (c) => esc(m?.[c] ?? "");
  abrirModal({
    titulo: nuevo ? "Agregar molde" : "Editar molde",
    cuerpo: `<div class="rejilla">
        <div class="campo"><label>Tipo *</label>${selectOps("tipo", "molde_tipo", m?.tipo ?? "Tapete completo", true)}</div>
        <div class="campo"><label>Marca *</label><input name="marca" required placeholder="Mazda" value="${v("marca")}"></div>
        <div class="campo"><label>Referencia *</label><input name="referencia" required placeholder="Mazda 3" value="${v("referencia")}"></div>
        <div class="campo"><label>Modelo</label><input name="modelo" placeholder="Sedán" value="${v("modelo")}"></div>
        <div class="campo"><label>Año</label><input name="anio" placeholder="2018-2022" value="${v("anio")}"></div>
        ${nuevo ? `<div class="campo"><label>Cantidad</label><input type="number" step="1" min="0" name="cantidad" value="1"></div>` : ""}
        <div class="campo"><label>Ubicación</label><input name="ubicacion" placeholder="Caja 12" value="${v("ubicacion")}"></div>
      </div>
      <div class="campo"><label>Piezas que incluye</label>
        <div class="chips-check">${ops("molde_pieza").map((x) => `<label class="check"><input type="checkbox" name="pieza" value="${esc(x)}" ${(m?.piezas || []).includes(x) ? "checked" : ""}> ${esc(x)}</label>`).join("")}</div>
      </div>
      <div class="campo"><label>Notas</label><input name="notas" value="${v("notas")}"></div>`,
    alGuardar: async (d, form) => {
      const piezas = [...form.querySelectorAll("[name=pieza]:checked")].map((x) => x.value);
      const datos = {
        tipo: d.tipo, marca: d.marca.trim(), referencia: d.referencia.trim(),
        modelo: d.modelo.trim() || null, anio: d.anio.trim() || null,
        ubicacion: d.ubicacion.trim() || null, notas: d.notas.trim() || null, piezas
      };
      if (nuevo) datos.cantidad = Number(d.cantidad) || 0;
      const { error } = nuevo ? await sb.from("moldes").insert(datos) : await sb.from("moldes").update(datos).eq("id", m.id);
      if (error) { toast(traducirError(error), "error"); return false; }
      toast(nuevo ? "Molde agregado" : "Molde actualizado");
      alGuardar();
      return true;
    }
  });
}

// ---------- Panel: Materias primas ----------
async function panelMaterias(cont) {
  await cargarOpciones();
  cont.innerHTML = `<div class="panel"><p class="vacio">Cargando…</p></div>`;
  const [mat, prov] = await Promise.all([
    sb.from("materias_primas").select("*").order("categoria").order("nombre"),
    sb.from("proveedores").select("id,nombre").order("nombre")
  ]);
  if (mat.error) { cont.innerHTML = `<div class="panel"><p class="vacio">${esc(traducirError(mat.error))}</p></div>`; return; }
  const data = mat.data, proveedores = prov.data || [];

  cont.innerHTML = `<div class="panel">
    ${barraBusqueda("q-mp", "Buscar materia prima…",
      `<select id="f-mp"><option value="">Todas las categorías</option>${ops("mp_categoria").map((v) => `<option>${esc(v)}</option>`).join("")}</select>`,
      `<button class="btn btn-rojo" id="nueva-mp">+ Agregar materia prima</button>`)}
    <div class="tabla-wrap" id="t-mp"></div>
  </div>`;

  const pintar = () => {
    const q = $("#q-mp", cont).value, cat = $("#f-mp", cont).value;
    const lista = data.filter((m) => coincide([m.nombre, m.categoria, m.notas].filter(Boolean).join(" "), q) && (!cat || m.categoria === cat));
    $("#t-mp", cont).innerHTML = !lista.length
      ? `<p class="vacio">No hay materias primas que coincidan.</p>`
      : `<table><thead><tr><th>Material</th><th>Categoría</th><th>Cantidad</th><th>Unidad</th><th>Costo unitario</th><th>Proveedor</th><th></th></tr></thead><tbody>
        ${lista.map((m) => `<tr>
          <td><b>${esc(m.nombre)}</b>${m.notas ? `<span class="sub">${esc(m.notas)}</span>` : ""}</td>
          <td>${esc(m.categoria || "—")}</td>
          <td>${chipCantidad(m)}</td>
          <td>${esc(m.unidad || "—")}</td>
          <td>${pesos(m.costo_unitario)}</td>
          <td>${esc(proveedores.find((p) => p.id === m.proveedor_id)?.nombre || "—")}</td>
          <td><div class="acciones">
            <button class="btn btn-chico btn-rojo" data-acc="ajustar|${m.id}">Ajustar</button>
            <button class="btn btn-chico" data-acc="editar|${m.id}">Editar</button>
            <button class="btn btn-chico" data-acc="historial|${m.id}">Historial</button>
            <button class="btn btn-chico btn-texto" data-acc="borrar|${m.id}">Eliminar</button>
          </div></td></tr>`).join("")}
      </tbody></table>`;
  };
  pintar();

  const recargar = () => panelMaterias(cont);
  $("#q-mp", cont).addEventListener("input", pintar);
  $("#f-mp", cont).addEventListener("change", pintar);
  $("#nueva-mp", cont).addEventListener("click", () => formMateria(null, proveedores, recargar));
  $("#t-mp", cont).addEventListener("click", async (e) => {
    const b = e.target.closest("[data-acc]");
    if (!b) return;
    const [accion, id] = b.dataset.acc.split("|");
    const m = data.find((x) => String(x.id) === id);
    if (accion === "editar") formMateria(m, proveedores, recargar);
    if (accion === "ajustar") modalAjustar("materia_prima", m, m.nombre, m.unidad || "unidades", recargar);
    if (accion === "historial") modalHistorial("materia_prima", m.id);
    if (accion === "borrar") {
      if (!confirm(`¿Eliminar "${m.nombre}" del inventario?`)) return;
      const { error } = await sb.from("materias_primas").delete().eq("id", m.id);
      if (error) return toast(traducirError(error), "error");
      toast("Materia prima eliminada"); recargar();
    }
  });
}

function formMateria(m, proveedores, alGuardar) {
  const nuevo = !m;
  abrirModal({
    titulo: nuevo ? "Agregar materia prima" : "Editar materia prima",
    cuerpo: `<div class="rejilla">
        <div class="campo"><label>Nombre *</label><input name="nombre" required placeholder="Alfombra negra" value="${esc(m?.nombre ?? "")}"></div>
        <div class="campo"><label>Categoría</label>${selectOps("categoria", "mp_categoria", m?.categoria)}</div>
        <div class="campo"><label>Unidad</label>${selectOps("unidad", "mp_unidad", m?.unidad ?? "Metro")}</div>
        ${nuevo ? `<div class="campo"><label>Cantidad inicial</label><input type="number" step="0.01" min="0" name="cantidad" value="0"></div>` : ""}
        <div class="campo"><label>Stock mínimo</label><input type="number" step="0.01" min="0" name="stock_minimo" value="${m?.stock_minimo ?? 0}"></div>
        <div class="campo"><label>Costo por unidad</label><input type="number" step="1" min="0" name="costo_unitario" value="${m?.costo_unitario ?? 0}"></div>
        <div class="campo"><label>Proveedor</label><select name="proveedor_id"><option value="">—</option>
          ${proveedores.map((p) => `<option value="${p.id}" ${m?.proveedor_id === p.id ? "selected" : ""}>${esc(p.nombre)}</option>`).join("")}</select></div>
      </div>
      <div class="campo"><label>Notas</label><input name="notas" placeholder="Ej: 1 galón = 3.8 litros" value="${esc(m?.notas ?? "")}"></div>`,
    alGuardar: async (d) => {
      const datos = {
        nombre: d.nombre.trim(), categoria: d.categoria || null, unidad: d.unidad || "Unidad",
        stock_minimo: Number(d.stock_minimo) || 0, costo_unitario: Number(d.costo_unitario) || 0,
        proveedor_id: d.proveedor_id ? Number(d.proveedor_id) : null, notas: d.notas.trim() || null
      };
      if (nuevo) datos.cantidad = Number(d.cantidad) || 0;
      const { error } = nuevo ? await sb.from("materias_primas").insert(datos) : await sb.from("materias_primas").update(datos).eq("id", m.id);
      if (error) { toast(traducirError(error), "error"); return false; }
      toast(nuevo ? "Materia prima agregada" : "Materia prima actualizada");
      alGuardar();
      return true;
    }
  });
}

// ---------- Ajustar cantidad (entrada / salida) ----------
function modalAjustar(tipoItem, item, nombre, unidad, alGuardar) {
  abrirModal({
    titulo: `Ajustar cantidad · ${nombre}`,
    botonTexto: "Registrar movimiento",
    cuerpo: `<p class="ayuda">Cantidad actual: <b>${Number(item.cantidad)}</b> ${esc(unidad)}</p>
      <div class="rejilla">
        <div class="campo"><label>Movimiento</label><select name="signo">
          <option value="1">Entrada (sumar)</option><option value="-1">Salida (restar)</option></select></div>
        <div class="campo"><label>Cantidad *</label><input type="number" step="0.01" min="0.01" name="cantidad" required></div>
      </div>
      <div class="campo"><label>Motivo</label><input name="motivo" placeholder="Producción, venta, daño, compra…"></div>`,
    alGuardar: async (d) => {
      const cantidad = Number(d.signo) * Number(d.cantidad);
      const { error } = await sb.from("movimientos").insert({
        tipo_item: tipoItem, item_id: item.id, cantidad, motivo: d.motivo.trim() || null
      });
      if (error) { toast(traducirError(error), "error"); return false; }
      toast(`${cantidad > 0 ? "Entrada" : "Salida"} registrada`);
      alGuardar();
      return true;
    }
  });
}

// ---------- Historial de movimientos ----------
async function modalHistorial(tipoItem, itemId) {
  await cargarNombres();
  const { fondo } = abrirModal({ titulo: "Historial de movimientos", sinPie: true, cuerpo: `<div id="hist"><p class="vacio">Cargando…</p></div>` });
  const { data, error } = await sb.from("movimientos").select("*").eq("tipo_item", tipoItem).eq("item_id", itemId)
    .order("created_at", { ascending: false }).limit(50);
  const cont = $("#hist", fondo);
  if (error) { cont.innerHTML = `<p class="vacio">${esc(traducirError(error))}</p>`; return; }
  cont.innerHTML = !data.length
    ? `<p class="vacio">Todavía no hay movimientos registrados.</p>`
    : `<div class="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Motivo</th><th>Quién</th></tr></thead><tbody>
      ${data.map((m) => `<tr>
        <td>${fechaCorta(new Date(m.created_at).toLocaleDateString("en-CA", { timeZone: TZ }))}<span class="sub">${horaCorta(m.created_at)}</span></td>
        <td><span class="chip ${m.cantidad > 0 ? "chip-ok" : "chip-alerta"}">${m.cantidad > 0 ? "+" : ""}${Number(m.cantidad)}</span></td>
        <td>${esc(m.motivo || "—")}</td>
        <td>${esc(nombresUsuarios[m.usuario_id] || "—")}</td></tr>`).join("")}
    </tbody></table></div>`;
}

// ---------- Panel: Listas configurables ----------
async function panelListas(cont) {
  await cargarOpciones(true);
  const grupos = [
    ["producto_categoria", "Categorías de productos"], ["producto_material", "Materiales de productos"],
    ["producto_estado", "Estados de productos"], ["molde_tipo", "Tipos de molde"],
    ["molde_pieza", "Piezas de molde"], ["mp_categoria", "Categorías de materia prima"],
    ["mp_unidad", "Unidades de medida"]
  ];
  cont.innerHTML = `<div class="panel" id="wrap-listas">
    <h2>Listas configurables</h2>
    <p class="ayuda">Agrega o quita opciones según lo que vayan necesitando. Si quitas una opción, los registros que ya la usan la conservan.</p>
    ${grupos.map(([cat, titulo]) => `<div class="lista-grupo">
      <h3 class="subtitulo">${titulo}</h3>
      <div class="chips" id="g-${cat}">
        ${opcionesCache.filter((o) => o.categoria === cat).map((o) => `
          <span class="chip ${o.activo ? "" : "chip-apagado"}">${esc(o.valor)}
            <button class="chip-x" data-quitar="${o.id}" title="Quitar">✕</button></span>`).join("") || `<span class="sub">Sin opciones</span>`}
      </div>
      <div class="fila-form" style="margin-top:.5rem">
        <div class="campo"><input placeholder="Nueva opción" data-nueva="${cat}"></div>
        <button class="btn btn-chico" data-agregar="${cat}">Agregar</button>
      </div>
    </div>`).join("")}
  </div>`;

  $("#wrap-listas", cont).addEventListener("click", async (e) => {
    const agregar = e.target.closest("[data-agregar]");
    const quitar = e.target.closest("[data-quitar]");
    if (agregar) {
      const cat = agregar.dataset.agregar;
      const input = cont.querySelector(`[data-nueva="${cat}"]`);
      const valor = input.value.trim();
      if (!valor) return;
      const { error } = await sb.from("opciones").insert({ categoria: cat, valor, orden: 50 });
      if (error) return toast(traducirError(error), "error");
      toast("Opción agregada");
      panelListas(cont);
    }
    if (quitar) {
      if (!confirm("¿Quitar esta opción de la lista?")) return;
      const { error } = await sb.from("opciones").delete().eq("id", quitar.dataset.quitar);
      if (error) return toast(traducirError(error), "error");
      toast("Opción quitada");
      panelListas(cont);
    }
  });
}

// =====================================================
//  FASE 5 · CLIENTES, PROVEEDORES Y PRECIOS
// =====================================================

// ---------- Clientes ----------
async function vistaClientes(el) {
  await cargarOpciones();
  el.innerHTML = encabezado("Clientes", "Base de datos de clientes y sus vehículos.",
    `<button class="btn btn-rojo" id="nuevo-cli">+ Agregar cliente</button>`) +
    `<div class="panel">
      ${barraBusqueda("q-cli", "Buscar por nombre, documento, teléfono o placa…",
        `<select id="f-canal"><option value="">Todos los canales</option>${ops("canal_origen").map((v) => `<option>${esc(v)}</option>`).join("")}</select>`)}
      <div class="tabla-wrap" id="t-cli"><p class="vacio">Cargando…</p></div>
    </div>`;

  const [cli, veh] = await Promise.all([
    sb.from("clientes").select("*").order("nombre"),
    sb.from("vehiculos").select("*")
  ]);
  if (cli.error) { $("#t-cli", el).innerHTML = `<p class="vacio">${esc(traducirError(cli.error))}</p>`; return; }
  const data = cli.data, vehiculos = veh.data || [];
  const recargar = () => vistaClientes(el);
  const autosDe = (id) => vehiculos.filter((v) => v.cliente_id === id);

  const pintar = () => {
    const q = $("#q-cli", el).value, canal = $("#f-canal", el).value;
    const lista = data.filter((c) => {
      const placas = autosDe(c.id).map((v) => [v.placa, v.marca, v.referencia].filter(Boolean).join(" ")).join(" ");
      return coincide([c.nombre, c.documento, c.telefono, c.email, c.ciudad, placas].filter(Boolean).join(" "), q) &&
        (!canal || c.canal_origen === canal);
    });
    $("#t-cli", el).innerHTML = !lista.length
      ? `<p class="vacio">No hay clientes que coincidan.</p>`
      : `<table><thead><tr><th>Cliente</th><th>Documento</th><th>Contacto</th><th>Vehículos</th><th>Canal</th><th></th></tr></thead><tbody>
        ${lista.map((c) => `<tr>
          <td><b>${esc(c.nombre)}</b>${c.ciudad ? `<span class="sub">${esc(c.ciudad)}</span>` : ""}</td>
          <td>${esc([c.tipo_documento, c.documento].filter(Boolean).join(" ") || "—")}</td>
          <td>${esc(c.telefono || "—")}${c.email ? `<span class="sub">${esc(c.email)}</span>` : ""}</td>
          <td><div class="chips">${autosDe(c.id).map((v) => `<span class="chip">${esc([v.marca, v.referencia].filter(Boolean).join(" "))}${v.placa ? ` · ${esc(v.placa)}` : ""}</span>`).join("") || "—"}</div></td>
          <td>${esc(c.canal_origen || "—")}</td>
          <td><div class="acciones">
            <button class="btn btn-chico btn-rojo" data-acc="autos|${c.id}">Vehículos</button>
            <button class="btn btn-chico" data-acc="editar|${c.id}">Editar</button>
            <button class="btn btn-chico btn-texto" data-acc="borrar|${c.id}">Eliminar</button>
          </div></td></tr>`).join("")}
      </tbody></table><p class="ayuda" style="margin-top:1rem">${lista.length} cliente(s)</p>`;
  };
  pintar();

  $("#q-cli", el).addEventListener("input", pintar);
  $("#f-canal", el).addEventListener("change", pintar);
  $("#nuevo-cli", el).addEventListener("click", () => formCliente(null, recargar));
  $("#t-cli", el).addEventListener("click", async (e) => {
    const b = e.target.closest("[data-acc]");
    if (!b) return;
    const [accion, id] = b.dataset.acc.split("|");
    const c = data.find((x) => String(x.id) === id);
    if (accion === "editar") formCliente(c, recargar);
    if (accion === "autos") modalVehiculos(c, recargar);
    if (accion === "borrar") {
      if (!confirm(`¿Eliminar a "${c.nombre}"? También se borran sus vehículos registrados.`)) return;
      const { error } = await sb.from("clientes").delete().eq("id", c.id);
      if (error) return toast(error.code === "23503" ? "Este cliente tiene facturas y no se puede eliminar." : traducirError(error), "error");
      toast("Cliente eliminado"); recargar();
    }
  });
}

function formCliente(c, alGuardar) {
  const nuevo = !c;
  const v = (campo) => esc(c?.[campo] ?? "");
  abrirModal({
    titulo: nuevo ? "Agregar cliente" : "Editar cliente",
    cuerpo: `<div class="rejilla">
        <div class="campo"><label>Nombre o empresa *</label><input name="nombre" required value="${v("nombre")}"></div>
        <div class="campo"><label>Tipo de documento</label>${selectOps("tipo_documento", "tipo_documento", c?.tipo_documento)}</div>
        <div class="campo"><label>Número de documento</label><input name="documento" value="${v("documento")}"></div>
        <div class="campo"><label>Teléfono</label><input name="telefono" type="tel" value="${v("telefono")}"></div>
        <div class="campo"><label>Correo</label><input name="email" type="email" value="${v("email")}"></div>
        <div class="campo"><label>Ciudad</label><input name="ciudad" value="${v("ciudad")}"></div>
        <div class="campo"><label>Dirección</label><input name="direccion" value="${v("direccion")}"></div>
        <div class="campo"><label>¿Cómo nos conoció?</label>${selectOps("canal_origen", "canal_origen", c?.canal_origen)}</div>
      </div>
      <div class="campo"><label>Notas</label><input name="notas" placeholder="Preferencias, acuerdos, observaciones…" value="${v("notas")}"></div>
      ${nuevo ? `<p class="ayuda">Después de crearlo puedes agregarle sus vehículos con el botón "Vehículos".</p>` : ""}`,
    alGuardar: async (d) => {
      const datos = {
        nombre: d.nombre.trim(), tipo_documento: d.tipo_documento || null, documento: d.documento.trim() || null,
        telefono: d.telefono.trim() || null, email: d.email.trim() || null, ciudad: d.ciudad.trim() || null,
        direccion: d.direccion.trim() || null, canal_origen: d.canal_origen || null, notas: d.notas.trim() || null
      };
      const { error } = nuevo ? await sb.from("clientes").insert(datos) : await sb.from("clientes").update(datos).eq("id", c.id);
      if (error) { toast(traducirError(error), "error"); return false; }
      toast(nuevo ? "Cliente agregado" : "Cliente actualizado");
      alGuardar();
      return true;
    }
  });
}

async function modalVehiculos(c, alCambiar) {
  const { fondo } = abrirModal({
    titulo: `Vehículos de ${c.nombre}`,
    sinPie: true,
    cuerpo: `<div class="tabla-wrap" id="lista-autos"><p class="vacio">Cargando…</p></div>
      <h4 class="subtitulo">Agregar vehículo</h4>
      <div class="rejilla">
        <div class="campo"><label>Tipo</label>${selectOps("tipo", "tipo_vehiculo", "Automóvil")}</div>
        <div class="campo"><label>Marca</label><input name="marca" placeholder="Mazda"></div>
        <div class="campo"><label>Referencia</label><input name="referencia" placeholder="Mazda 3"></div>
        <div class="campo"><label>Año</label><input name="anio" placeholder="2019"></div>
        <div class="campo"><label>Placa</label><input name="placa" placeholder="ABC123"></div>
        <div class="campo"><label>Color</label><input name="color"></div>
      </div>
      <div><button class="btn btn-rojo" type="button" id="agregar-auto">Agregar vehículo</button></div>`
  });

  const pintar = async () => {
    const { data, error } = await sb.from("vehiculos").select("*").eq("cliente_id", c.id).order("id");
    const cont = $("#lista-autos", fondo);
    if (error) { cont.innerHTML = `<p class="vacio">${esc(traducirError(error))}</p>`; return; }
    cont.innerHTML = !data.length
      ? `<p class="vacio">Este cliente no tiene vehículos registrados.</p>`
      : `<table><thead><tr><th>Vehículo</th><th>Tipo</th><th>Placa</th><th></th></tr></thead><tbody>
        ${data.map((v) => `<tr>
          <td><b>${esc([v.marca, v.referencia].filter(Boolean).join(" ") || "Sin nombre")}</b>
            <span class="sub">${esc([v.anio, v.color].filter(Boolean).join(" · "))}</span></td>
          <td>${esc(v.tipo || "—")}</td><td>${esc(v.placa || "—")}</td>
          <td><button class="btn btn-chico btn-texto" data-borrar="${v.id}">Eliminar</button></td></tr>`).join("")}
      </tbody></table>`;
    cont.onclick = async (e) => {
      const b = e.target.closest("[data-borrar]");
      if (!b || !confirm("¿Eliminar este vehículo?")) return;
      const { error } = await sb.from("vehiculos").delete().eq("id", b.dataset.borrar);
      if (error) return toast(traducirError(error), "error");
      toast("Vehículo eliminado"); pintar(); alCambiar();
    };
  };

  $("#agregar-auto", fondo).addEventListener("click", async () => {
    const d = Object.fromEntries(new FormData($("form", fondo)));
    if (!d.marca.trim() && !d.placa.trim()) return toast("Escribe al menos la marca o la placa.", "error");
    const { error } = await sb.from("vehiculos").insert({
      cliente_id: c.id, tipo: d.tipo || null, marca: d.marca.trim() || null, referencia: d.referencia.trim() || null,
      anio: d.anio.trim() || null, placa: d.placa.trim().toUpperCase() || null, color: d.color.trim() || null
    });
    if (error) return toast(traducirError(error), "error");
    toast("Vehículo agregado");
    ["marca", "referencia", "anio", "placa", "color"].forEach((n) => { $(`[name=${n}]`, fondo).value = ""; });
    pintar(); alCambiar();
  });
  pintar();
}

// ---------- Proveedores ----------
async function vistaProveedores(el) {
  await cargarOpciones();
  el.innerHTML = encabezado("Proveedores", "A quién le compran materiales e insumos.",
    `<button class="btn btn-rojo" id="nuevo-prov">+ Agregar proveedor</button>`) +
    `<div class="panel">
      ${barraBusqueda("q-prov", "Buscar proveedor…",
        `<select id="f-prov"><option value="">Todas las categorías</option>${ops("proveedor_categoria").map((v) => `<option>${esc(v)}</option>`).join("")}</select>`)}
      <div class="tabla-wrap" id="t-prov"><p class="vacio">Cargando…</p></div>
    </div>`;

  const { data, error } = await sb.from("proveedores").select("*").order("nombre");
  if (error) { $("#t-prov", el).innerHTML = `<p class="vacio">${esc(traducirError(error))}</p>`; return; }
  const recargar = () => vistaProveedores(el);

  const pintar = () => {
    const q = $("#q-prov", el).value, cat = $("#f-prov", el).value;
    const lista = data.filter((p) => coincide([p.nombre, p.nit, p.contacto, p.telefono, p.email, p.notas].filter(Boolean).join(" "), q) && (!cat || p.categoria === cat));
    $("#t-prov", el).innerHTML = !lista.length
      ? `<p class="vacio">No hay proveedores que coincidan.</p>`
      : `<table><thead><tr><th>Proveedor</th><th>NIT</th><th>Contacto</th><th>Categoría</th><th></th></tr></thead><tbody>
        ${lista.map((p) => `<tr>
          <td><b>${esc(p.nombre)}</b>${p.notas ? `<span class="sub">${esc(p.notas)}</span>` : ""}</td>
          <td>${esc(p.nit || "—")}</td>
          <td>${esc(p.contacto || "—")}<span class="sub">${esc([p.telefono, p.email].filter(Boolean).join(" · "))}</span></td>
          <td>${esc(p.categoria || "—")}</td>
          <td><div class="acciones">
            <button class="btn btn-chico" data-acc="editar|${p.id}">Editar</button>
            <button class="btn btn-chico btn-texto" data-acc="borrar|${p.id}">Eliminar</button>
          </div></td></tr>`).join("")}
      </tbody></table>`;
  };
  pintar();

  $("#q-prov", el).addEventListener("input", pintar);
  $("#f-prov", el).addEventListener("change", pintar);
  $("#nuevo-prov", el).addEventListener("click", () => formProveedor(null, recargar));
  $("#t-prov", el).addEventListener("click", async (e) => {
    const b = e.target.closest("[data-acc]");
    if (!b) return;
    const [accion, id] = b.dataset.acc.split("|");
    const p = data.find((x) => String(x.id) === id);
    if (accion === "editar") formProveedor(p, recargar);
    if (accion === "borrar") {
      if (!confirm(`¿Eliminar al proveedor "${p.nombre}"?`)) return;
      const { error } = await sb.from("proveedores").delete().eq("id", p.id);
      if (error) return toast(error.code === "23503" ? "Este proveedor tiene gastos o materiales asociados." : traducirError(error), "error");
      toast("Proveedor eliminado"); recargar();
    }
  });
}

function formProveedor(p, alGuardar) {
  const nuevo = !p;
  const v = (campo) => esc(p?.[campo] ?? "");
  abrirModal({
    titulo: nuevo ? "Agregar proveedor" : "Editar proveedor",
    cuerpo: `<div class="rejilla">
        <div class="campo"><label>Nombre *</label><input name="nombre" required value="${v("nombre")}"></div>
        <div class="campo"><label>NIT</label><input name="nit" value="${v("nit")}"></div>
        <div class="campo"><label>Persona de contacto</label><input name="contacto" value="${v("contacto")}"></div>
        <div class="campo"><label>Teléfono</label><input name="telefono" type="tel" value="${v("telefono")}"></div>
        <div class="campo"><label>Correo</label><input name="email" type="email" value="${v("email")}"></div>
        <div class="campo"><label>Categoría</label>${selectOps("categoria", "proveedor_categoria", p?.categoria)}</div>
      </div>
      <div class="campo"><label>Notas</label><input name="notas" placeholder="Días de entrega, formas de pago…" value="${v("notas")}"></div>`,
    alGuardar: async (d) => {
      const datos = {
        nombre: d.nombre.trim(), nit: d.nit.trim() || null, contacto: d.contacto.trim() || null,
        telefono: d.telefono.trim() || null, email: d.email.trim() || null,
        categoria: d.categoria || null, notas: d.notas.trim() || null
      };
      const { error } = nuevo ? await sb.from("proveedores").insert(datos) : await sb.from("proveedores").update(datos).eq("id", p.id);
      if (error) { toast(traducirError(error), "error"); return false; }
      toast(nuevo ? "Proveedor agregado" : "Proveedor actualizado");
      alGuardar();
      return true;
    }
  });
}

// ---------- Precios ----------
async function vistaPrecios(el) {
  await cargarOpciones();
  const esAdmin = perfil.rol === "admin";
  el.innerHTML = encabezado("Precios", esAdmin
    ? "Tabla de precios por tipo de vehículo."
    : "Consulta los precios actualizados de servicios y productos.",
    esAdmin ? `<button class="btn btn-rojo" id="nuevo-serv">+ Agregar servicio o producto</button>` : "") +
    `<div class="panel">
      ${barraBusqueda("q-pre", "Buscar servicio o producto…",
        `<select id="f-tipo-serv"><option value="">Servicios y productos</option><option>Servicio</option><option>Producto</option></select>
         <select id="f-cat-serv"><option value="">Todas las categorías</option>${ops("servicio_categoria").map((v) => `<option>${esc(v)}</option>`).join("")}</select>`)}
      <div class="tabla-wrap" id="t-pre"><p class="vacio">Cargando…</p></div>
    </div>`;

  const [cat, pv] = await Promise.all([
    sb.from("catalogo").select("*").order("categoria").order("nombre"),
    sb.from("precios_vehiculo").select("*")
  ]);
  if (cat.error) { $("#t-pre", el).innerHTML = `<p class="vacio">${esc(traducirError(cat.error))}</p>`; return; }
  const data = cat.data, precios = pv.data || [];
  const tipos = ops("tipo_vehiculo");
  const recargar = () => vistaPrecios(el);
  const precioDe = (id, tipo) => precios.find((x) => x.catalogo_id === id && x.tipo_vehiculo === tipo);

  const pintar = () => {
    const q = $("#q-pre", el).value, tipo = $("#f-tipo-serv", el).value, cate = $("#f-cat-serv", el).value;
    const lista = data.filter((s) => coincide([s.nombre, s.categoria, s.descripcion].filter(Boolean).join(" "), q) &&
      (!tipo || s.tipo === tipo) && (!cate || s.categoria === cate) && (esAdmin || s.activo));
    $("#t-pre", el).innerHTML = !lista.length
      ? `<p class="vacio">No hay servicios ni productos que coincidan. ${esAdmin ? "Agrega el primero." : ""}</p>`
      : `<table><thead><tr><th>Servicio o producto</th><th>Categoría</th><th>Precio base</th>
          ${tipos.map((t) => `<th>${esc(t)}</th>`).join("")}${esAdmin ? "<th></th>" : ""}</tr></thead><tbody>
        ${lista.map((s) => `<tr class="${s.activo ? "" : "fila-futura"}">
          <td><b>${esc(s.nombre)}</b><span class="sub">${esc(s.tipo)}${s.descripcion ? " · " + esc(s.descripcion) : ""}</span></td>
          <td>${esc(s.categoria || "—")}</td>
          <td><b>${pesos(s.precio)}</b></td>
          ${tipos.map((t) => {
            const p = precioDe(s.id, t);
            return `<td>${p && Number(p.precio) ? pesos(p.precio) : `<span class="sub">—</span>`}</td>`;
          }).join("")}
          ${esAdmin ? `<td><div class="acciones">
            <button class="btn btn-chico btn-rojo" data-acc="precios|${s.id}">Precios</button>
            <button class="btn btn-chico" data-acc="editar|${s.id}">Editar</button>
            <button class="btn btn-chico btn-texto" data-acc="borrar|${s.id}">Eliminar</button>
          </div></td>` : ""}
        </tr>`).join("")}
      </tbody></table>
      <p class="ayuda" style="margin-top:1rem">El precio base se usa cuando el tipo de vehículo no tiene un precio propio. Un guion significa que aplica el precio base.</p>`;
  };
  pintar();

  $("#q-pre", el).addEventListener("input", pintar);
  $("#f-tipo-serv", el).addEventListener("change", pintar);
  $("#f-cat-serv", el).addEventListener("change", pintar);
  if (esAdmin) {
    $("#nuevo-serv", el).addEventListener("click", () => formServicio(null, recargar));
    $("#t-pre", el).addEventListener("click", async (e) => {
      const b = e.target.closest("[data-acc]");
      if (!b) return;
      const [accion, id] = b.dataset.acc.split("|");
      const s = data.find((x) => String(x.id) === id);
      if (accion === "editar") formServicio(s, recargar);
      if (accion === "precios") modalPreciosVehiculo(s, tipos, precios.filter((x) => x.catalogo_id === s.id), recargar);
      if (accion === "borrar") {
        if (!confirm(`¿Eliminar "${s.nombre}" de la tabla de precios?`)) return;
        const { error } = await sb.from("catalogo").delete().eq("id", s.id);
        if (error) return toast(error.code === "23503" ? "Ya se usó en facturas o cotizaciones. Mejor desactívalo." : traducirError(error), "error");
        toast("Eliminado"); recargar();
      }
    });
  }
}

function formServicio(s, alGuardar) {
  const nuevo = !s;
  abrirModal({
    titulo: nuevo ? "Agregar servicio o producto" : "Editar",
    cuerpo: `<div class="rejilla">
        <div class="campo"><label>Nombre *</label><input name="nombre" required placeholder="Tapizado completo en cuero" value="${esc(s?.nombre ?? "")}"></div>
        <div class="campo"><label>Tipo</label><select name="tipo">
          <option ${s?.tipo !== "Producto" ? "selected" : ""}>Servicio</option>
          <option ${s?.tipo === "Producto" ? "selected" : ""}>Producto</option></select></div>
        <div class="campo"><label>Categoría</label>${selectOps("categoria", "servicio_categoria", s?.categoria)}</div>
        <div class="campo"><label>Precio base</label><input type="number" step="1" min="0" name="precio" value="${s?.precio ?? 0}"></div>
        <div class="campo"><label>Costo estimado</label><input type="number" step="1" min="0" name="costo_estimado" value="${s?.costo_estimado ?? 0}"></div>
        <div class="campo"><label>Estado</label><select name="activo">
          <option value="si" ${s?.activo !== false ? "selected" : ""}>Activo</option>
          <option value="no" ${s?.activo === false ? "selected" : ""}>Inactivo</option></select></div>
      </div>
      <div class="campo"><label>Descripción</label><input name="descripcion" value="${esc(s?.descripcion ?? "")}"></div>
      <p class="ayuda">El costo estimado es lo que les cuesta hacerlo (materiales y mano de obra). Sirve para ver la ganancia en la Fase 8.</p>`,
    alGuardar: async (d) => {
      const datos = {
        nombre: d.nombre.trim(), tipo: d.tipo, categoria: d.categoria || null,
        precio: Number(d.precio) || 0, costo_estimado: Number(d.costo_estimado) || 0,
        descripcion: d.descripcion.trim() || null, activo: d.activo === "si", updated_at: new Date().toISOString()
      };
      const { error } = nuevo ? await sb.from("catalogo").insert(datos) : await sb.from("catalogo").update(datos).eq("id", s.id);
      if (error) { toast(traducirError(error), "error"); return false; }
      toast(nuevo ? "Agregado a la tabla de precios" : "Actualizado");
      alGuardar();
      return true;
    }
  });
}

function modalPreciosVehiculo(s, tipos, actuales, alGuardar) {
  const valor = (t, campo) => actuales.find((x) => x.tipo_vehiculo === t)?.[campo] ?? "";
  abrirModal({
    titulo: `Precios por vehículo · ${s.nombre}`,
    botonTexto: "Guardar precios",
    cuerpo: `<p class="ayuda">Llena solo los tipos de vehículo que tengan un precio distinto al base (${pesos(s.precio)}). Los que dejes vacíos usan el precio base.</p>
      <div class="tabla-wrap"><table class="tabla-config">
        <thead><tr><th>Tipo de vehículo</th><th>Precio</th><th>Costo estimado</th></tr></thead>
        <tbody>${tipos.map((t) => `<tr data-tipo="${esc(t)}">
          <td><b>${esc(t)}</b></td>
          <td><input type="number" step="1" min="0" name="precio" value="${valor(t, "precio")}" placeholder="${s.precio}"></td>
          <td><input type="number" step="1" min="0" name="costo" value="${valor(t, "costo_estimado")}" placeholder="${s.costo_estimado}"></td>
        </tr>`).join("")}</tbody>
      </table></div>`,
    alGuardar: async (d, form) => {
      const filas = [...form.querySelectorAll("tr[data-tipo]")];
      const guardar = [], borrar = [];
      for (const tr of filas) {
        const tipo = tr.dataset.tipo;
        const precio = $("[name=precio]", tr).value, costo = $("[name=costo]", tr).value;
        if (precio === "" && costo === "") borrar.push(tipo);
        else guardar.push({ catalogo_id: s.id, tipo_vehiculo: tipo, precio: Number(precio) || 0, costo_estimado: Number(costo) || 0 });
      }
      if (borrar.length) {
        const { error } = await sb.from("precios_vehiculo").delete().eq("catalogo_id", s.id).in("tipo_vehiculo", borrar);
        if (error) { toast(traducirError(error), "error"); return false; }
      }
      if (guardar.length) {
        const { error } = await sb.from("precios_vehiculo").upsert(guardar, { onConflict: "catalogo_id,tipo_vehiculo" });
        if (error) { toast(traducirError(error), "error"); return false; }
      }
      toast("Precios guardados");
      alGuardar();
      return true;
    }
  });
}

// ---------- Arranque ----------
sb.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT" && perfil) { perfil = null; mostrarLogin(); } });
iniciar();
