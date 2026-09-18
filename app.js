// =====================================================
//  THE GARAGE HUB · Fase 2
//  Login · Roles · Empleados · Novedades · Cuentas · Asistencia
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
      { id: "asistencia", label: "Asistencia", listo: true },
      { id: "jornada", label: "Mi jornada", listo: true },
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
      { id: "jornada", label: "Mi jornada", listo: true },
      { id: "mis-tareas", label: "Mis tareas", fase: 3 } ] },
    { grupo: "Consultas", items: [
      { id: "inventario", label: "Inventario", fase: 4 },
      { id: "moldes", label: "Moldes", fase: 4 },
      { id: "precios", label: "Precios", fase: 5 } ] }
  ]
};

const VISTAS = { inicio: vistaInicio, empleados: vistaEmpleados, cuentas: vistaCuentas, jornada: vistaJornada, asistencia: vistaAsistencia };

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

// ---------- Arranque ----------
sb.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT" && perfil) { perfil = null; mostrarLogin(); } });
iniciar();
