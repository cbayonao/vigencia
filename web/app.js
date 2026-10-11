const estado = {
  procesos: [],
  activo: null,
  vacio: null,
  abierto: null,
  qAct: "",
  actosRecientes: true,
};

const $ = (id) => document.getElementById(id);

function texto(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor);
}

function esc(valor) {
  return texto(valor)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fechaCorta(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(valor));
  if (!m) return texto(valor);
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

function timeTag(valor) {
  const bruto = texto(valor);
  if (!bruto) return "Sin fecha";
  return `<time datetime="${esc(bruto)}">${esc(fechaCorta(bruto))}</time>`;
}

function tipoClave(valor) {
  return texto(valor)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function nombres(proceso, rol) {
  return texto(proceso[rol]).split(" · ").map((nombre) => nombre.trim()).filter(Boolean);
}

function tituloLista(proceso) {
  const dantes = nombres(proceso, "demandantes");
  const dados = nombres(proceso, "demandados");
  if (dantes.length || dados.length) {
    return `${dantes.join(", ") || "Sin demandante"} contra ${dados.join(", ") || "Sin demandado"}`;
  }
  if (proceso.sin_expediente) return "No está en esta consulta";
  return proceso.despacho || "Sin despacho";
}

function coincide(proceso, q) {
  const bolsa = [
    proceso.radicado,
    proceso.despacho,
    proceso.demandantes,
    proceso.demandados,
    proceso.ultima_actuacion,
    proceso.ubicacion,
    proceso.tipo_proceso,
    tipoClave(proceso.tipo_proceso),
    proceso.clase_proceso,
  ].map(texto).join(" ").toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((parte) => bolsa.includes(parte));
}

function fueraDeConsulta() {
  return estado.procesos.filter((proceso) => proceso.sin_expediente);
}

function visibles() {
  const q = $("q").value.trim().toLowerCase();
  const tipo = $("tipo").value;
  const despacho = $("despacho").value;
  const lista = estado.procesos.filter((proceso) => {
    if (tipo && tipoClave(proceso.tipo_proceso) !== tipo) return false;
    if (despacho && texto(proceso.despacho).trim() !== despacho) return false;
    if (q) return coincide(proceso, q);
    return !proceso.sin_expediente;
  });
  lista.sort((a, b) => texto(b.fecha_ultima_actuacion).localeCompare(texto(a.fecha_ultima_actuacion))
    || texto(a.radicado).localeCompare(texto(b.radicado)));
  return lista;
}

function hermanosDe(radicado, id) {
  return estado.procesos.filter((proceso) => proceso.radicado === radicado && proceso.id_proceso && proceso.id_proceso !== id);
}

function pintarTipos() {
  const actual = $("tipo").value;
  const cuentas = new Map();
  for (const proceso of estado.procesos) {
    const clave = tipoClave(proceso.tipo_proceso);
    if (!clave || proceso.sin_expediente) continue;
    cuentas.set(clave, (cuentas.get(clave) || 0) + 1);
  }
  const tipos = [...cuentas.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  $("tipo").innerHTML = `<option value="">Todos los tipos</option>${tipos.map(([clave, cantidad]) => `<option value="${esc(clave)}">${esc(clave)} (${cantidad})</option>`).join("")}`;
  if ([...$("tipo").options].some((opcion) => opcion.value === actual)) $("tipo").value = actual;
}

function pintarDespachos() {
  const actual = $("despacho").value;
  const cuentas = new Map();
  for (const proceso of estado.procesos) {
    if (proceso.sin_expediente) continue;
    const nombre = texto(proceso.despacho).trim();
    if (!nombre) continue;
    cuentas.set(nombre, (cuentas.get(nombre) || 0) + 1);
  }
  const despachos = [...cuentas.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  $("despacho").innerHTML = `<option value="">Todos los despachos</option>${despachos.map(([nombre, cantidad]) => `<option value="${esc(nombre)}">${esc(nombre)} (${cantidad})</option>`).join("")}`;
  if ([...$("despacho").options].some((opcion) => opcion.value === actual)) $("despacho").value = actual;
}

function pintarLista() {
  const lista = visibles();
  const enConsulta = estado.procesos.filter((proceso) => !proceso.sin_expediente).length;
  const fuera = fueraDeConsulta().length;
  $("resumen").textContent = `${enConsulta} expedientes`;
  const filtros = $("q").value.trim() || $("tipo").value || $("despacho").value;
  $("cuenta-lista").textContent = lista.length === enConsulta && !filtros
    ? `${lista.length} por última actuación`
    : `${lista.length} de ${enConsulta}`;
  const nota = !filtros && fuera
    ? `<p class="nota-fuera">${fuera} radicados del archivo no están en esta consulta.</p>`
    : "";
  if (!lista.length) {
    $("items").innerHTML = `<p class="aviso-vacio">Ningún expediente coincide.</p>${nota}`;
    return;
  }
  $("items").innerHTML = lista.map((proceso) => {
    const actual = proceso.id_proceso
      ? estado.activo === proceso.id_proceso
      : estado.vacio === proceso.radicado;
    const titulo = tituloLista(proceso);
    const tipo = tipoClave(proceso.tipo_proceso);
    const contexto = [tipo, proceso.despacho && proceso.despacho !== titulo ? proceso.despacho : ""].filter(Boolean).join(" · ");
    return `
      <div role="listitem">
        <button type="button" class="item" data-id="${proceso.id_proceso || ""}" data-radicado="${esc(proceso.radicado)}" data-vacio="${proceso.sin_expediente ? "1" : "0"}" aria-current="${actual ? "true" : "false"}">
          <span class="cuando">${proceso.fecha_ultima_actuacion ? esc(fechaCorta(proceso.fecha_ultima_actuacion)) : "Sin actuación"}</span>
          <span class="acto">${esc(proceso.ultima_actuacion || (proceso.sin_expediente ? "No está en esta consulta" : "Sin texto de actuación"))}</span>
          <span class="titulo">${esc(titulo)}</span>
          <span class="radicado">${esc(proceso.radicado)}</span>
          ${contexto ? `<span class="meta">${esc(contexto)}</span>` : ""}
          ${actual ? `<span class="sr">Seleccionado</span>` : ""}
        </button>
      </div>
    `;
  }).join("") + nota;
}

function personasDe(sujetos, rol) {
  return (sujetos || []).filter((sujeto) => sujeto.rol_base === rol);
}

function ponerHash(fragmento) {
  const siguiente = `#${fragmento}`;
  if (location.hash !== siguiente) history.replaceState(null, "", `${location.pathname}${location.search}${siguiente}`);
}

function leerHash() {
  const m = /^#([pr])\/(.+)$/.exec(location.hash);
  if (!m) return null;
  return { tipo: m[1], id: decodeURIComponent(m[2]) };
}

function syncMarco() {
  document.body.classList.toggle("con-expediente", Boolean(estado.activo || estado.vacio));
}

let pedido = 0;
let origenTeclado = false;

async function abrir(id, opciones = {}) {
  const mio = ++pedido;
  const desdeLista = opciones.desdeLista;
  estado.activo = id;
  estado.vacio = null;
  estado.qAct = "";
  estado.actosRecientes = true;
  if (opciones.actualizarHash !== false) ponerHash(`p/${id}`);
  pintarLista();
  syncMarco();
  if (desdeLista) $("items").querySelector('.item[aria-current="true"]')?.focus();
  $("detalle").setAttribute("aria-busy", "true");
  $("detalle").innerHTML = `<p class="vacio">Cargando expediente…</p>`;
  let respuesta;
  try {
    respuesta = await fetch(`/api/procesos/${id}`);
  } catch {
    if (mio !== pedido) return;
    $("detalle").innerHTML = `<p class="vacio">No pude abrir ese expediente.</p>`;
    $("detalle").setAttribute("aria-busy", "false");
    return;
  }
  if (mio !== pedido) return;
  if (!respuesta.ok) {
    $("detalle").innerHTML = `<p class="vacio">No pude abrir ese expediente.</p>`;
    $("detalle").setAttribute("aria-busy", "false");
    return;
  }
  estado.abierto = await respuesta.json();
  if (mio !== pedido) return;
  try {
    pintarExpediente();
  } catch (error) {
    $("detalle").innerHTML = `<p class="vacio">No pude mostrar este expediente.</p>`;
    console.error(error);
  }
  $("detalle").setAttribute("aria-busy", "false");
  if (!desdeLista) $("titulo-expediente")?.focus();
}

function abrirVacio(proceso, opciones = {}) {
  pedido += 1;
  estado.activo = null;
  estado.abierto = null;
  estado.vacio = proceso.radicado;
  if (opciones.actualizarHash !== false) ponerHash(`r/${proceso.radicado}`);
  pintarLista();
  syncMarco();
  $("detalle").innerHTML = `
    <article class="expediente">
      <div class="expediente-fijo">
        <button type="button" class="volver" id="volver">Volver a la lista</button>
        <p class="radicado-grande mono" id="num-radicado">${esc(proceso.radicado)}</p>
        <h2 id="titulo-expediente" tabindex="-1">No está en esta consulta</h2>
        <p>Este radicado no aparece en la Rama Judicial. La búsqueda en otro sistema queda para después.</p>
      </div>
    </article>
  `;
  $("volver").addEventListener("click", cerrarExpediente);
  if (!opciones.desdeLista) $("titulo-expediente").focus();
}

function cerrarExpediente() {
  estado.activo = null;
  estado.vacio = null;
  estado.abierto = null;
  history.replaceState(null, "", location.pathname + location.search);
  syncMarco();
  pintarLista();
  $("detalle").innerHTML = `<div class="vacio"><p>Selecciona un expediente de la lista.</p></div>`;
  $("q").focus();
}

function pintarExpediente() {
  const proceso = estado.abierto;
  const sujetos = proceso.sujetos || [];
  const dantes = personasDe(sujetos, "demandante");
  const dados = personasDe(sujetos, "demandado");
  const titulo = (dantes.length || dados.length)
    ? `${dantes.map((sujeto) => sujeto.nombre).join(", ") || "Sin demandante"} contra ${dados.map((sujeto) => sujeto.nombre).join(", ") || "Sin demandado"}`
    : (proceso.despacho || "Expediente privado");
  const tipo = tipoClave(proceso.tipo_proceso);
  const linea = [tipo, proceso.clase_proceso].filter(Boolean).join(" · ");
  const hermanos = hermanosDe(proceso.radicado, proceso.id_proceso);
  const hermanoHtml = hermanos.length
    ? `<div class="hermanos"><span>Este radicado tiene ${hermanos.length + 1} expedientes.</span>${hermanos.map((otro) => `<button type="button" data-hermano="${otro.id_proceso}">${esc(otro.despacho || otro.clase_proceso || "Otro expediente")}</button>`).join("")}</div>`
    : "";

  $("detalle").innerHTML = `
    <article class="expediente">
      <div class="expediente-fijo">
        <button type="button" class="volver" id="volver">Volver a la lista</button>
        <p class="kicker">${esc(linea || proceso.despacho || "Expediente")}</p>
        <h2 id="titulo-expediente" tabindex="-1">${esc(titulo)}</h2>
        <div class="radicado-fila">
          <p class="radicado-grande mono" id="num-radicado">${esc(proceso.radicado)}</p>
          <button type="button" class="copiar" id="copiar">Copiar radicado</button>
        </div>
        <p class="ids">${esc(proceso.despacho || "Sin despacho")}</p>
        ${hermanoHtml}
      </div>
      <div id="panel" class="panel">
        <h3>Actuaciones</h3>
        ${proceso.actuaciones_consultado_en ? htmlActuaciones(proceso) : `<p class="aviso-vacio">Las actuaciones todavía no se han consultado.</p>`}
      </div>
    </article>
  `;
  $("volver").addEventListener("click", cerrarExpediente);
  $("copiar").addEventListener("click", () => copiar(proceso.radicado));
  $("detalle").querySelectorAll("[data-hermano]").forEach((boton) => {
    boton.addEventListener("click", () => abrir(Number(boton.dataset.hermano)));
  });
  $("q-act")?.addEventListener("input", (evento) => {
    estado.qAct = evento.target.value;
    refrescarActuaciones(proceso);
  });
  $("orden-act")?.addEventListener("click", () => {
    estado.actosRecientes = !estado.actosRecientes;
    const boton = $("orden-act");
    if (boton) boton.textContent = estado.actosRecientes ? "Ver las más antiguas primero" : "Ver las más recientes primero";
    refrescarActuaciones(proceso);
  });
  if (proceso.actuaciones_consultado_en) refrescarActuaciones(proceso);
}

function filtraTexto(q, campos) {
  const partes = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!partes.length) return true;
  const bolsa = campos.map(texto).join(" ").toLowerCase();
  return partes.every((parte) => bolsa.includes(parte));
}

function actuacionesVisibles(proceso) {
  const filas = (proceso.actuaciones || []).filter((act) => filtraTexto(estado.qAct, [
    act.fecha_actuacion, act.actuacion, act.anotacion,
  ]));
  return estado.actosRecientes ? filas : [...filas].reverse();
}

function htmlActuaciones(proceso) {
  if (!proceso.actuaciones.length) return `<p class="aviso-vacio">Este expediente no tiene actuaciones registradas.</p>`;
  return `
    <div class="herramientas">
      <label>Buscar en las actuaciones
        <input id="q-act" type="search" value="${esc(estado.qAct)}" placeholder="Fecha, actuación o anotación">
      </label>
      <button type="button" class="herramienta" id="orden-act">Ver las más antiguas primero</button>
    </div>
    <p id="cuenta-act" class="cuenta-lista"></p>
    <ol id="linea-act" class="linea"></ol>
  `;
}

function refrescarActuaciones(proceso) {
  const linea = $("linea-act");
  const cuenta = $("cuenta-act");
  if (!linea) return;
  const filas = actuacionesVisibles(proceso);
  const total = proceso.actuaciones.length;
  if (cuenta) cuenta.textContent = filas.length === total ? `${total} actuaciones` : `${filas.length} de ${total} actuaciones`;
  linea.innerHTML = filas.length
    ? filas.map((act) => `
        <li>
          ${act.fecha_actuacion ? timeTag(act.fecha_actuacion) : "<span>Sin fecha</span>"}
          <strong>${esc(act.actuacion || "Sin descripción")}</strong>
          ${act.anotacion ? `<p>${esc(act.anotacion)}</p>` : ""}
        </li>
      `).join("")
    : `<li>Ninguna actuación coincide.</li>`;
}

async function copiar(valor) {
  const numero = texto(valor);
  let copiado = false;
  try {
    const escritura = navigator.clipboard?.writeText(numero);
    await Promise.race([
      escritura || Promise.reject(new Error("sin portapapeles")),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("tiempo")), 400)),
    ]);
    copiado = true;
  } catch {
    const area = document.createElement("textarea");
    area.value = numero;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    copiado = document.execCommand("copy");
    area.remove();
  }
  const boton = $("copiar");
  if (boton) boton.textContent = copiado ? "Copiado" : "No se pudo copiar";
  $("aviso-vivo").textContent = copiado
    ? `Radicado ${numero} copiado`
    : `No pude copiar el radicado ${numero}`;
  setTimeout(() => {
    if (boton?.isConnected) boton.textContent = "Copiar radicado";
  }, 1600);
}

async function cargar() {
  const respuesta = await fetch("/api/procesos");
  if (!respuesta.ok) {
    $("resumen").textContent = "No pude leer la base.";
    $("cuenta-lista").textContent = "Sin datos";
    return;
  }
  const dato = await respuesta.json();
  estado.procesos = dato.procesos;
  pintarTipos();
  pintarDespachos();
  pintarLista();
}

function campoDeTexto(nodo) {
  const etiqueta = nodo?.tagName;
  return etiqueta === "INPUT" || etiqueta === "TEXTAREA" || etiqueta === "SELECT" || nodo?.isContentEditable;
}

$("form-buscar").addEventListener("submit", (evento) => evento.preventDefault());
$("q").addEventListener("input", pintarLista);
$("tipo").addEventListener("change", pintarLista);
$("despacho").addEventListener("change", pintarLista);
$("nuevo").addEventListener("input", () => {
  const digitos = $("nuevo").value.replace(/\D/g, "").slice(0, 23);
  if ($("nuevo").value !== digitos) $("nuevo").value = digitos;
});

$("items").addEventListener("click", (evento) => {
  const boton = evento.target.closest(".item");
  if (!boton) return;
  const desdeLista = origenTeclado;
  origenTeclado = false;
  if (boton.dataset.vacio === "1") {
    const proceso = estado.procesos.find((item) => item.sin_expediente && item.radicado === boton.dataset.radicado);
    if (proceso) abrirVacio(proceso, { desdeLista });
    return;
  }
  abrir(Number(boton.dataset.id), { desdeLista });
});

$("items").addEventListener("keydown", (evento) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(evento.key)) return;
  const botones = [...$("items").querySelectorAll(".item")];
  if (!botones.length) return;
  evento.preventDefault();
  let indice = botones.indexOf(document.activeElement);
  if (evento.key === "ArrowDown") indice = Math.min(botones.length - 1, Math.max(0, indice) + (indice < 0 ? 0 : 1));
  if (evento.key === "ArrowUp") indice = Math.max(0, indice < 0 ? 0 : indice - 1);
  if (evento.key === "Home") indice = 0;
  if (evento.key === "End") indice = botones.length - 1;
  origenTeclado = true;
  botones[indice].focus();
  botones[indice].click();
});

document.addEventListener("keydown", (evento) => {
  if (evento.key === "/" && !campoDeTexto(evento.target)) {
    evento.preventDefault();
    $("q").focus();
  }
});

const bitacora = $("bitacora");
const cajaBitacora = $("bitacora-caja");
const botonActualizar = $("actualizar");
let vigilar = false;
let estabaCorriendo = false;

function lineaDeCarga(linea) {
  return texto(linea)
    .replace(/idProceso=\[[^\]]*\]/g, "")
    .replace(/idProceso=\d+/g, "")
    .replace(/\[detalle (\d+\/\d+)\] \d+/g, "[detalle $1]")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function mostrarLoader(dato) {
  $("loader").hidden = false;
  $("loader-titulo").textContent = "Buscando el radicado en la Rama…";
  $("loader-numero").textContent = dato.radicado || "";
  const lineas = (dato.lineas || []).map(lineaDeCarga).filter(Boolean).slice(-12);
  $("loader-log").hidden = lineas.length === 0;
  $("loader-log").textContent = lineas.join("\n");
  $("loader-log").scrollTop = $("loader-log").scrollHeight;
}

function ocultarLoader() {
  $("loader").hidden = true;
}

function pintarCorrida(dato) {
  const corriendo = Boolean(dato.corriendo);
  botonActualizar.disabled = corriendo;
  botonActualizar.textContent = corriendo && dato.modo !== "agregar" ? "Actualizando…" : "Actualizar todo";
  if ($("agregar")) $("agregar").disabled = corriendo;
  if (dato.modo === "agregar") {
    cajaBitacora.hidden = true;
    if (corriendo) mostrarLoader(dato);
    else ocultarLoader();
    return;
  }
  if (!corriendo) ocultarLoader();
  const lineas = dato.lineas || [];
  if (!lineas.length && !dato.fin) {
    cajaBitacora.hidden = true;
    return;
  }
  cajaBitacora.hidden = false;
  if (corriendo) cajaBitacora.open = true;
  let cierre = "";
  if (!corriendo && dato.fin) {
    cierre = dato.exit_code === 0
      ? `\nTerminó ${dato.fin}.`
      : `\nTerminó con error (código ${dato.exit_code}) a las ${dato.fin}.`;
  }
  bitacora.textContent = lineas.join("\n") + cierre;
  bitacora.scrollTop = bitacora.scrollHeight;
}

async function seguirActualizacion() {
  if (vigilar) return;
  vigilar = true;
  try {
    while (true) {
      const respuesta = await fetch("/api/actualizacion");
      if (!respuesta.ok) break;
      const dato = await respuesta.json();
      pintarCorrida(dato);
      if (estabaCorriendo && !dato.corriendo) {
        const eraAgregar = dato.modo === "agregar";
        const numero = dato.radicado;
        await cargar();
        if (eraAgregar) {
          ocultarLoader();
          $("agregar").disabled = false;
          await mostrarAgregado(numero, dato.exit_code);
        } else if (estado.activo) {
          await abrir(estado.activo, { actualizarHash: false });
        }
      }
      estabaCorriendo = Boolean(dato.corriendo);
      if (!dato.corriendo) break;
      await new Promise((resolver) => setTimeout(resolver, 1500));
    }
  } finally {
    vigilar = false;
  }
}

botonActualizar.addEventListener("click", async () => {
  botonActualizar.disabled = true;
  const respuesta = await fetch("/api/actualizar", { method: "POST" });
  if (respuesta.status === 409) {
    estabaCorriendo = true;
  } else if (!respuesta.ok) {
    botonActualizar.disabled = false;
    cajaBitacora.hidden = false;
    cajaBitacora.open = true;
    bitacora.textContent = "No pude iniciar la actualización.";
    return;
  }
  seguirActualizacion();
});

async function mostrarAgregado(numero, codigo) {
  if (!numero) return;
  if (codigo) {
    $("detalle").innerHTML = `<p class="vacio">La búsqueda del radicado ${esc(numero)} terminó con error. Revisa el registro y vuelve a intentar.</p>`;
    syncMarco();
    return;
  }
  const encontrados = estado.procesos.filter((proceso) => proceso.radicado === numero && proceso.id_proceso);
  $("nuevo").value = "";
  if (encontrados[0]) {
    await abrir(encontrados[0].id_proceso);
    return;
  }
  const vacio = estado.procesos.find((proceso) => proceso.sin_expediente && proceso.radicado === numero);
  if (vacio) abrirVacio(vacio);
  else {
    $("detalle").innerHTML = `<p class="vacio">La Rama no devolvió procesos para ${esc(numero)}.</p>`;
    syncMarco();
  }
}

$("form-agregar").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const numero = $("nuevo").value.replace(/\D/g, "");
  if (numero.length !== 23) {
    $("aviso-vivo").textContent = "El radicado debe tener 23 dígitos";
    return;
  }
  $("aviso-vivo").textContent = "";
  $("agregar").disabled = true;
  mostrarLoader({ radicado: numero, lineas: [] });
  let respuesta;
  try {
    respuesta = await fetch("/api/agregar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ radicado: numero }),
    });
  } catch {
    ocultarLoader();
    $("agregar").disabled = false;
    $("aviso-vivo").textContent = "No pude agregar el radicado.";
    return;
  }
  if (respuesta.status === 409) {
    $("aviso-vivo").textContent = "Ya hay una consulta en curso.";
    seguirActualizacion();
    return;
  }
  if (!respuesta.ok) {
    ocultarLoader();
    $("agregar").disabled = false;
    const dato = await respuesta.json().catch(() => ({}));
    $("aviso-vivo").textContent = dato.error || "No pude agregar el radicado.";
    return;
  }
  estabaCorriendo = true;
  seguirActualizacion();
});

$("recargar").addEventListener("click", async () => {
  $("recargar").disabled = true;
  await cargar();
  if (estado.activo) await abrir(estado.activo, { actualizarHash: false, desdeLista: true });
  else if (estado.vacio) {
    const proceso = estado.procesos.find((item) => item.sin_expediente && item.radicado === estado.vacio);
    if (proceso) abrirVacio(proceso, { desdeLista: true });
  }
  $("recargar").disabled = false;
});

async function inicio() {
  await cargar();
  const destino = leerHash();
  if (destino?.tipo === "p" && /^\d+$/.test(destino.id)) await abrir(Number(destino.id), { actualizarHash: false });
  else if (destino?.tipo === "r") {
    const proceso = estado.procesos.find((item) => item.sin_expediente && item.radicado === destino.id);
    if (proceso) abrirVacio(proceso);
  }
  seguirActualizacion();
}

inicio();
