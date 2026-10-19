// Mis procesos: el tablero que junta los procesos de todas las fuentes
// (consulta nacional, SAMAI, SPOA, estados del juzgado y manuales), las
// actuaciones propias del despacho, las audiencias y sus recordatorios.
// Todo puro: sin base, sin red y sin DOM. Las actuaciones propias nunca se
// mezclan con las del juzgado que compara el monitor (ver guardar.js).
import { sistemaDe } from "./sistemas.js";

const DIA_MS = 24 * 60 * 60 * 1000;
export const DIAS_QUIETO = 60;
export const DIAS_RECIENTE = 7;

function sistema(id, sigla, nombre) {
  const s = sistemaDe(id);
  return { id, sigla: s?.sigla || sigla, nombre: s ? (s.fuente ? `${s.nombre}, ${s.fuente}` : s.nombre) : nombre, corto: s?.nombre || nombre };
}

// Fuentes: las de compartido/sistemas.js que guardan procesos, más los
// procesos que llegan de un estado y los que no están en ningún sistema.
export const FUENTES = [
  { ...sistema("consulta", "CN", "Consulta nacional unificada"), corto: "Rama Judicial" },
  sistema("samai", "SA", "SAMAI"),
  sistema("spoa", "SP", "SPOA"),
  { id: "estados", sigla: "ES", nombre: "Estados del juzgado, Publicaciones procesales", corto: "Estados" },
  { id: "manual", sigla: "MA", nombre: "Manual, en ningún sistema", corto: "Manual" },
];

export function fuenteDe(id) {
  return FUENTES.find((f) => f.id === id) || FUENTES[FUENTES.length - 1];
}

export const TIPOS_PROPIA = [
  { id: "nota", nombre: "Nota" },
  { id: "reunion", nombre: "Reunión con el cliente" },
  { id: "memorial", nombre: "Memorial elaborado" },
  { id: "radicar", nombre: "Pendiente de radicar" },
  { id: "llamada", nombre: "Llamada" },
  { id: "tarea", nombre: "Tarea" },
];

export function tipoPropia(id) {
  return TIPOS_PROPIA.find((t) => t.id === id) || TIPOS_PROPIA[0];
}

export const MODALIDADES = ["virtual", "presencial"];

function texto(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

export function normal(v) {
  return texto(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function dos(n) {
  return String(n).padStart(2, "0");
}

export function isoDia(fecha) {
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

function diaDe(iso) {
  const [a, m, d] = String(iso).split("-").map(Number);
  return new Date(a, m - 1, d);
}

function valida(a, m, d) {
  if (!(a >= 1990 && a <= 2100 && m >= 1 && m <= 12 && d >= 1)) return false;
  return d <= new Date(a, m, 0).getDate();
}

// Fecha de cualquier fuente a aaaa-mm-dd: "2026-02-02T00:00:00",
// "12/06/2024", "2024-06-12". Lo que no se entiende queda vacío.
export function fechaIso(valor) {
  const t = texto(valor);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m && valida(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m && valida(+m[3], +m[2], +m[1])) return `${m[3]}-${dos(m[2])}-${dos(m[1])}`;
  return "";
}

export function diasEntre(desde, hasta) {
  if (!desde || !hasta) return null;
  return Math.round((diaDe(hasta) - diaDe(desde)) / DIA_MS);
}

// ---------- Procesos de todas las fuentes ----------

function partes(v) {
  return texto(String(v ?? "").replace(/\s*·\s*/g, ", "));
}

// Une las filas de cada fuente en una sola forma. Un proceso que llegó de
// un estado y ya está en la consulta nacional se puede vincular; una vez
// vinculado no sale dos veces.
export function unificarProcesos({ consulta = [], samai = [], spoa = [], manuales = [], marcas = [], recientes = [], hoy = isoDia(new Date()) } = {}) {
  const archivados = new Set(marcas.filter((m) => Number(m.archivado)).map((m) => m.clave));
  const cambiados = new Set(recientes);
  const porRadicado = new Map();
  const salida = [];
  const sumar = (p) => {
    const ultimaFecha = fechaIso(p.ultimaFecha);
    const quieto = ultimaFecha ? diasEntre(ultimaFecha, hoy) : null;
    const item = {
      ...p,
      radicado: String(p.radicado || "").replace(/\D/g, "") || texto(p.radicado),
      despacho: texto(p.despacho),
      clase: texto(p.clase),
      demandante: partes(p.demandante),
      demandado: partes(p.demandado),
      ultimaActuacion: texto(p.ultimaActuacion),
      ultimaFecha,
      diasSinMovimiento: quieto,
      archivado: archivados.has(p.clave),
      reciente: cambiados.has(p.clave) || (quieto !== null && quieto >= 0 && quieto <= DIAS_RECIENTE),
    };
    salida.push(item);
    return item;
  };
  for (const p of consulta) {
    const item = sumar({
      clave: `cn:${p.id_proceso}`, fuente: "consulta", ref: String(p.id_proceso), radicado: p.radicado, despacho: p.despacho,
      clase: p.clase_proceso || p.tipo_proceso, demandante: p.demandantes, demandado: p.demandados,
      abogadoId: p.cliente_id ?? null, abogado: [p.cliente_nombre, p.cliente_apellidos].filter(Boolean).join(" "),
      ultimaFecha: p.fecha_ultima_actuacion, ultimaActuacion: p.ultima_actuacion,
    });
    if (item.radicado) porRadicado.set(item.radicado, item.clave);
  }
  for (const p of samai) {
    const item = sumar({
      clave: `sa:${p.guid}`, fuente: "samai", ref: p.guid, radicado: p.radicado, despacho: p.despacho,
      clase: p.clase, demandante: p.demandante, demandado: p.demandado, ultimaFecha: p.ultima_fecha, ultimaActuacion: p.ultima_actuacion,
    });
    if (item.radicado && !porRadicado.has(item.radicado)) porRadicado.set(item.radicado, item.clave);
  }
  for (const p of spoa) {
    sumar({
      clave: `sp:${p.noticia}`, fuente: "spoa", ref: p.noticia, radicado: p.noticia, despacho: p.despacho,
      clase: [p.etapa, p.estado].filter(Boolean).join(", "), ultimaFecha: p.ultima_fecha, ultimaActuacion: p.ultima_actuacion,
    });
  }
  for (const p of manuales) {
    if (p.vinculo) continue;
    const item = sumar({
      clave: `ma:${p.id}`, fuente: p.origen === "estados" ? "estados" : "manual", ref: String(p.id), radicado: p.radicado,
      despacho: p.despacho, clase: p.clase, demandante: p.demandante, demandado: p.demandado, cliente: texto(p.cliente),
      abogadoId: p.cliente_id ?? null, abogado: texto(p.abogado), ultimaFecha: p.ultima_fecha || p.creado_en, ultimaActuacion: p.ultima_actuacion,
    });
    const otro = item.radicado && porRadicado.get(item.radicado);
    if (otro) item.vinculable = otro;
  }
  return salida.sort((a, b) => (b.ultimaFecha || "").localeCompare(a.ultimaFecha || "") || a.radicado.localeCompare(b.radicado));
}

export const ESTADOS_LISTA = [
  { id: "activos", nombre: "Activos" },
  { id: "recientes", nombre: "Con movimiento reciente" },
  { id: "quietos", nombre: "Quietos" },
  { id: "archivados", nombre: "Archivados" },
  { id: "todos", nombre: "Todos" },
];

export function esQuieto(p, dias = DIAS_QUIETO) {
  return !p.archivado && (p.diasSinMovimiento === null || p.diasSinMovimiento > dias);
}

export function filtrarProcesos(lista, { fuente = "", abogado = "", despacho = "", estado = "activos", texto: buscado = "", dias = DIAS_QUIETO } = {}) {
  const t = normal(buscado);
  const digitos = String(buscado || "").replace(/\D/g, "");
  return lista.filter((p) => {
    if (estado === "archivados" ? !p.archivado : estado !== "todos" && p.archivado) return false;
    if (estado === "recientes" && !p.reciente) return false;
    if (estado === "quietos" && !esQuieto(p, dias)) return false;
    if (fuente && p.fuente !== fuente) return false;
    if (abogado && String(p.abogadoId ?? "") !== String(abogado)) return false;
    if (despacho && p.despacho !== despacho) return false;
    if (!t) return true;
    if (digitos.length >= 4 && p.radicado.includes(digitos)) return true;
    return normal([p.radicado, p.despacho, p.clase, p.demandante, p.demandado, p.cliente, p.abogado, p.ultimaActuacion].join(" ")).includes(t);
  });
}

// ---------- Tablero ----------

export function semanaDe(hoy) {
  const d = diaDe(hoy);
  const lunes = new Date(d);
  lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return { desde: isoDia(lunes), hasta: isoDia(domingo) };
}

export function contarTablero({ procesos = [], audiencias = [], propias = [], hoy = isoDia(new Date()), dias = DIAS_QUIETO } = {}) {
  const activos = procesos.filter((p) => !p.archivado);
  const porFuente = Object.fromEntries(FUENTES.map((f) => [f.id, 0]));
  for (const p of activos) porFuente[p.fuente] = (porFuente[p.fuente] || 0) + 1;
  const { hasta } = semanaDe(hoy);
  const pendientes = propias.filter((n) => n.estado !== "hecho" && (n.vence || ["tarea", "radicar"].includes(n.tipo)));
  return {
    activos: activos.length,
    porFuente,
    recientes: activos.filter((p) => p.reciente).length,
    quietos: activos.filter((p) => esQuieto(p, dias)).length,
    audienciasSemana: audiencias.filter((a) => a.estado !== "descartada" && a.fecha >= hoy && a.fecha <= hasta).length,
    pendientes: pendientes.length,
    vencidas: pendientes.filter((n) => n.vence && n.vence < hoy).length,
  };
}

// ---------- Línea de tiempo: juzgado y despacho propio ----------

// Junta las actuaciones del juzgado (las que compara el monitor, más las de
// estados) con las propias, por fecha, sin tocar ninguna de las dos listas.
export function lineaDeTiempo({ juzgado = [], propias = [] } = {}, filtro = "todo") {
  const a = filtro === "propio" ? [] : juzgado.map((x, i) => ({
    lado: "juzgado", orden: i, fecha: fechaIso(x.fecha), titulo: texto(x.actuacion), detalle: texto(x.anotacion), origen: x.origen || "", dato: x,
  }));
  const b = filtro === "juzgado" ? [] : propias.map((x, i) => ({
    lado: "propio", orden: i, fecha: fechaIso(x.fecha), titulo: tipoPropia(x.tipo).nombre, detalle: texto(x.texto), dato: x,
  }));
  return [...a, ...b].sort((x, y) => (y.fecha || "").localeCompare(x.fecha || "") || (x.lado === y.lado ? x.orden - y.orden : x.lado === "propio" ? -1 : 1));
}

// ---------- Estados del juzgado como historia del proceso ----------

export function firmaEstado({ radicado = "", fechaAuto = "", actuacion = "" } = {}) {
  return `e|${String(radicado).replace(/\D/g, "")}|${fechaIso(fechaAuto) || texto(fechaAuto)}|${normal(actuacion)}`;
}

// Filas de una tabla de Estados a registros para guardar, sin repetir
// radicado, fecha del auto y actuación.
export function registrosDeEstado(filas = [], meta = {}) {
  const vistos = new Set();
  const salida = [];
  for (const f of filas) {
    const radicado = String(f.radicado || "").replace(/\D/g, "");
    if (radicado.length !== 23) continue;
    const r = {
      radicado,
      actuacion: texto(f.actuacion),
      anotacion: texto(f.anotacion),
      fechaAuto: fechaIso(f.fecha) || texto(f.fecha),
      estadoNo: texto(meta.estado),
      fechaEstado: fechaIso(meta.fecha) || texto(meta.fecha),
      juzgado: texto(meta.juzgado),
      despacho: texto(meta.juzgado),
      demandante: texto(f.demandante),
      demandado: texto(f.demandado),
      clase: texto(f.clase),
    };
    r.firma = firmaEstado(r);
    if (vistos.has(r.firma)) continue;
    vistos.add(r.firma);
    salida.push(r);
  }
  return salida;
}

// ---------- Fechas de audiencia en el texto de una actuación ----------

const MESES = [
  ["enero", "en", "ene"], ["febrero", "fb", "feb"], ["marzo", "mz", "mar"], ["abril", "ab", "abr"],
  ["mayo", "my", "may"], ["junio", "jn", "jun"], ["julio", "jl", "jul"], ["agosto", "ag", "ago"],
  ["septiembre", "sp", "sep", "sept", "setiembre"], ["octubre", "oc", "oct"], ["noviembre", "nv", "nov"], ["diciembre", "dc", "dic"],
];
const MES = new Map(MESES.flatMap((nombres, i) => nombres.map((n) => [n, i + 1])));
const CORTOS = [...MES.keys()].filter((k) => k.length <= 4).sort((a, b) => b.length - a.length).join("|");
const CORTOS3 = [...MES.keys()].filter((k) => k.length === 3 || k === "sept").join("|");
const LARGOS = MESES.map((m) => m[0]).concat("setiembre").join("|");

function anioDe(valor, mes, dia, base) {
  if (valor) {
    const n = Number(valor);
    return n < 100 ? 2000 + n : n;
  }
  // Sin año: la próxima vez que cae esa fecha desde la base.
  const b = diaDe(base);
  let a = b.getFullYear();
  if (new Date(a, mes - 1, dia) < b) a += 1;
  return a;
}

function horaDe(t) {
  const m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|am|pm)(?![a-z])/i)
    || t.match(/\b(\d{1,2})[:](\d{2})\s*(?:horas|hrs|h)?\b/i);
  if (!m) return "";
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const sufijo = String(m[3] || "").replace(/[.\s]/g, "").toLowerCase();
  if (sufijo === "pm" && h < 12) h += 12;
  if (sufijo === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return "";
  return `${dos(h)}:${dos(min)}`;
}

// Todas las fechas (con hora si la trae al lado) en un texto como
// "(audiencia VIRTUAL sp.30/24 08:30am )", "ag.05/24 2pm",
// "el 15 de marzo de 2025 a las 9:00 a.m." o "15/03/2025 a las 3 pm".
export function fechasEnTexto(valor, { base = isoDia(new Date()) } = {}) {
  const t = String(valor ?? "");
  const salida = [];
  const patrones = [
    [new RegExp(`(?<!\\d)(\\d{1,2})\\s+(?:(?:de\\s+)?(${LARGOS})|de\\s+(${CORTOS3})\\.?)(?![a-z])(?:\\s+(?:de|del)?\\s*(\\d{4}))?`, "gi"),
      (m) => ({ mes: MES.get(String(m[2] || m[3]).toLowerCase()), dia: Number(m[1]), anio: m[4] })],
    [new RegExp(`(?<![a-z])(${LARGOS})\\s+(\\d{1,2})(?!\\d)(?:\\s*(?:de|del|,)\\s*(\\d{4}))?`, "gi"),
      (m) => ({ mes: MES.get(m[1].toLowerCase()), dia: Number(m[2]), anio: m[3] })],
    [/(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/g, (m) => ({ mes: Number(m[2]), dia: Number(m[1]), anio: m[3] })],
    [new RegExp(`(?<![a-z])(${CORTOS})(?:\\.\\s?(\\d{1,2})(?:\\s?/\\s?(\\d{2,4}))?|(\\d{1,2})/(\\d{2,4}))(?!\\d)`, "gi"),
      (m) => ({ mes: MES.get(m[1].toLowerCase()), dia: Number(m[2] || m[4]), anio: m[3] || m[5] })],
  ];
  const ocupado = [];
  for (const [re, leer] of patrones) {
    for (const m of t.matchAll(re)) {
      const ini = m.index;
      const fin = ini + m[0].length;
      if (ocupado.some(([a, b]) => ini < b && fin > a)) continue;
      const { mes, dia, anio } = leer(m);
      if (!mes || !dia) continue;
      const a = anioDe(anio, mes, dia, base);
      if (!valida(a, mes, dia)) continue;
      ocupado.push([ini, fin]);
      const hora = horaDe(t.slice(fin, fin + 24).replace(/^[\s.,]*(?:a\s+las|a\s+la|hora)?\s*/i, ""));
      salida.push({ fecha: `${a}-${dos(mes)}-${dos(dia)}`, hora, inicio: ini });
    }
  }
  return salida.sort((x, y) => x.inicio - y.inicio).map(({ fecha, hora }) => ({ fecha, hora }));
}

export function modalidadEn(valor) {
  const t = normal(valor);
  if (/virtual|teams|lifesize|meet|zoom|remot/.test(t)) return "virtual";
  if (/presencial|sala /.test(t)) return "presencial";
  return "";
}

const ES_AUDIENCIA = /audiencia|diligencia|inspeccion judicial/;

export function refAudiencia(clave, fecha, hora) {
  return `${clave}|${fecha}|${hora || ""}`;
}

// Audiencias que sugiere el texto de las actuaciones (de cualquier fuente):
// solo las futuras y las que el usuario no ha guardado ni descartado. Nunca
// se crean solas: el usuario las confirma.
export function sugerirAudiencias(actuaciones = [], { hoy = isoDia(new Date()), conocidas = [] } = {}) {
  const ya = new Set(conocidas);
  const salida = [];
  for (const a of actuaciones) {
    const todo = `${a.actuacion || ""} ${a.anotacion || ""}`;
    if (!ES_AUDIENCIA.test(normal(todo))) continue;
    const base = fechaIso(a.fecha) || hoy;
    for (const f of fechasEnTexto(a.anotacion || "", { base }).concat(fechasEnTexto(a.actuacion || "", { base }))) {
      if (f.fecha < hoy || f.fecha === base && !f.hora) continue;
      const ref = refAudiencia(a.clave, f.fecha, f.hora);
      if (ya.has(ref)) continue;
      ya.add(ref);
      salida.push({ clave: a.clave, fecha: f.fecha, hora: f.hora, modalidad: modalidadEn(todo), ref, origen: texto(todo), radicado: a.radicado || "" });
    }
  }
  return salida.sort((x, y) => `${x.fecha} ${x.hora}`.localeCompare(`${y.fecha} ${y.hora}`));
}

// ---------- Calendario ----------

export function mesCalendario(anio, mes) {
  const primero = new Date(anio, mes - 1, 1);
  const inicio = new Date(primero);
  inicio.setDate(1 - ((primero.getDay() + 6) % 7));
  const semanas = [];
  const d = new Date(inicio);
  do {
    const semana = [];
    for (let i = 0; i < 7; i++) {
      semana.push({ fecha: isoDia(d), dia: d.getDate(), delMes: d.getMonth() === mes - 1 });
      d.setDate(d.getDate() + 1);
    }
    semanas.push(semana);
  } while (d.getMonth() === mes - 1);
  return semanas;
}

export function diasDeSemana(hoy) {
  const { desde } = semanaDe(hoy);
  const d = diaDe(desde);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return isoDia(x);
  });
}

export function proximasAudiencias(audiencias = [], hoy = isoDia(new Date()), limite = 20) {
  return audiencias
    .filter((a) => a.estado !== "descartada" && a.fecha >= hoy)
    .sort((x, y) => `${x.fecha} ${x.hora || ""}`.localeCompare(`${y.fecha} ${y.hora || ""}`))
    .slice(0, limite);
}

// ---------- Recordatorios ----------

// Hora de Colombia (UTC-5, sin horario de verano) a instante.
export function instanteAudiencia(a) {
  const [y, m, d] = a.fecha.split("-").map(Number);
  const [h, min] = (a.hora || "08:00").split(":").map(Number);
  return Date.UTC(y, m - 1, d, h + 5, min);
}

// Recordatorio un día antes y una hora antes. Si la aplicación estuvo
// cerrada, solo sale el más cercano.
export function recordatoriosDebidos(audiencias = [], ahoraMs = Date.now()) {
  const salida = [];
  for (const a of audiencias) {
    if (a.estado === "descartada") continue;
    const ya = new Set(String(a.avisos || "").split(",").filter(Boolean));
    const t = instanteAudiencia(a);
    if (ahoraMs >= t) continue;
    if (!ya.has("hora") && ahoraMs >= t - 60 * 60 * 1000) salida.push({ id: a.id, cual: "hora", marcar: "dia,hora", audiencia: a });
    else if (!ya.has("dia") && !ya.has("hora") && ahoraMs >= t - DIA_MS) salida.push({ id: a.id, cual: "dia", marcar: "dia", audiencia: a });
  }
  return salida;
}

// ---------- iCalendar (.ics) ----------

function escIcs(v) {
  return texto(v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

function plegar(linea) {
  const partes = [];
  let resto = linea;
  while (resto.length > 74) {
    partes.push(resto.slice(0, 74));
    resto = ` ${resto.slice(74)}`;
  }
  partes.push(resto);
  return partes.join("\r\n");
}

function utc(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function icsDeAudiencias(audiencias = [], { ahoraMs = Date.now() } = {}) {
  const l = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vigencia//Audiencias//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const a of audiencias) {
    const titulo = ["Audiencia", a.modalidad, a.radicado || a.titulo].filter(Boolean).join(" ");
    l.push("BEGIN:VEVENT", `UID:audiencia-${a.id}@vigencia`, `DTSTAMP:${utc(ahoraMs)}`);
    if (a.hora) {
      const ini = instanteAudiencia(a);
      l.push(`DTSTART:${utc(ini)}`, `DTEND:${utc(ini + 60 * 60 * 1000)}`);
    } else {
      const fin = new Date(Date.UTC(...a.fecha.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0))) + DIA_MS).toISOString().slice(0, 10);
      l.push(`DTSTART;VALUE=DATE:${a.fecha.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${fin.replace(/-/g, "")}`);
    }
    l.push(`SUMMARY:${escIcs(titulo)}`);
    if (a.lugar) l.push(`LOCATION:${escIcs(a.lugar)}`);
    const desc = [a.despacho, a.partes, a.notas, a.lugar && /^https?:/i.test(a.lugar) ? `Enlace: ${a.lugar}` : ""].filter(Boolean).map(escIcs).join("\\n");
    if (desc) l.push(`DESCRIPTION:${desc}`);
    l.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Audiencia", "TRIGGER:-PT1H", "END:VALARM", "END:VEVENT");
  }
  l.push("END:VCALENDAR");
  return `${l.map(plegar).join("\r\n")}\r\n`;
}
