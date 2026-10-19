// Radicado de 23 dígitos armado a partir del juzgado y el número corto.
// Puro: el catálogo de despachos, los municipios y lo aprendido llegan como
// datos. Forma: municipio DANE (5) + corporación (2) + especialidad (2) +
// despacho (3) + año (4) + consecutivo (5) + recurso (2).
//
// Confianza del resultado:
// - leido: el número ya traía los 23 dígitos.
// - armado: el prefijo del juzgado sale de radicados que usted ya tiene o de
//   un despacho que está en el catálogo de la Rama.
// - supuesto: se armó con reglas y algo se supuso (el despacho 001, o un
//   despacho que no está en el catálogo). Hay que revisarlo.
import { normalizarRadicado } from "./logica.js";

export function normal(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.:#°º]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const anioValido = (a, hoy) => a >= 1950 && a <= hoy.getFullYear() + 1;

export function esRadicadoCompleto(texto) {
  const d = normalizarRadicado(texto);
  return d.length === 23 && String(texto).replace(/\D/g, "").length === 23 && anioValido(Number(d.slice(12, 16)), new Date());
}

// ---------- Número corto ----------

// "2023-00073", "2023-73", "26-489", "No 2024-00210", "2024 00210",
// "202400210" y con recurso "2023-00073-01". Lo que trae letras o no tiene
// año (despachos comisorios: "No 052", "0923DG-134") da null.
export function parsearNumeroCorto(texto, { hoy = new Date() } = {}) {
  const t = String(texto || "").trim().replace(/^(?:rad(?:icado)?|n(?:o|ro|um|umero|°|º)?)[\s.:°º#]*(?=\d)/i, "");
  if (!t || /[a-z]/i.test(t)) return null;
  const g = t.split(/[\s.\-/_]+/).filter(Boolean);
  if (!g.every((x) => /^\d+$/.test(x))) return null;
  let [anio, cons, recurso = "00"] = g;
  if (g.length === 1) {
    if (![9, 11].includes(anio.length)) return null;
    [anio, cons, recurso] = [anio.slice(0, 4), anio.slice(4, 9), anio.slice(9) || "00"];
  } else if (g.length > 3) return null;
  if (anio.length === 2) anio = String(2000 + Number(anio));
  if (anio.length !== 4 || !anioValido(Number(anio), hoy)) return null;
  if (cons.length > 5 || Number(cons) === 0 || recurso.length > 2) return null;
  return { anio, consecutivo: cons.padStart(5, "0"), recurso: recurso.padStart(2, "0") };
}

// ---------- Juzgado ----------

// Corporación y especialidad, contrastadas con el catálogo de despachos de
// la Rama (pp_catalogo.json). El orden importa: gana la primera que calza.
const ESPECIALIDADES = [
  [/promiscuo (de )?familia/, "84", "31"],
  [/pequenas causas|competencia multiple/, "89", "41"],
  [/promiscuo/, "89"],
  [/civil.*familia.*laboral/, "14"],
  [/civil.*familia/, "13"],
  [/civil.*laboral|asuntos laborales/, "12"],
  [/familia/, "10", "31"],
  [/laboral/, "05"],
  [/ejecucion de penas/, "87"],
  [/penal.*(garantias)/, "88"],
  [/penal.*conocimiento/, "09"],
  [/penal/, "04"],
  [/civil/, "03"],
  // Juzgados administrativos: 33, salvo donde van por sección (Bogotá:
  // primera 34, segunda 35, tercera 36, cuarta 37). Sin sección en el nombre
  // se prueban todas contra el catálogo.
  ...["primera", "segunda", "tercera", "cuarta"].map((sec, k) => [new RegExp(`administrativ.*\\bsec(cion)? ${sec}\\b|\\bsec(cion)? ${sec}\\b.*administrativ`), String(34 + k)]),
  [/administrativ/, "33", "", ["34", "35", "36", "37"]],
];
const ORDINALES = ["primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "septimo", "octavo", "noveno", "decimo"];

function corporacionDe(n, porEspecialidad) {
  if (/tribunal/.test(n)) return /administrativ/.test(n) ? "23" : "22";
  if (porEspecialidad) return porEspecialidad;
  if (/administrativ/.test(n)) return "33";
  if (/municipal/.test(n)) return "40";
  if (/circuito/.test(n)) return "31";
  return "";
}

const nombreMuni = (m) => normal(m.nombre).replace(/\(.*\)|, d c$|,.*$/g, "").trim();

// { municipio, corporacion, especialidad, despacho, motivo }
export function analizarJuzgado(nombre, { munis = [], despachos = [] } = {}) {
  const n = normal(nombre).replace(/[-,]/g, " ").replace(/\s+/g, " ");
  const esp = ESPECIALIDADES.find(([re]) => re.test(n));
  const r = { municipio: "", corporacion: corporacionDe(n, esp?.[2]), especialidad: esp?.[1] || "", otras: esp?.[3] || [], despacho: "", motivo: "" };
  const num = /\b(?:juzgado|despacho)\s+(\d{1,3})\b/.exec(n) || /\b(\d{1,3})\s+(?:civil|penal|laboral|de familia|familia|promiscuo|administrativo)\b/.exec(n)
    || /\b(?:civil|penal|laboral|familia|promiscuo|administrativo|municipal|circuito)\s+(\d{1,3})\b/.exec(n);
  const ord = new RegExp(`\\b(${ORDINALES.join("|")})\\b`).exec(n);
  if (num) r.despacho = num[1].padStart(3, "0");
  else if (ord) r.despacho = String(ORDINALES.indexOf(ord[1]) + 1).padStart(3, "0");
  // Municipio: el nombre más largo que aparece completo.
  let cands = [];
  for (const m of munis) {
    if (String(m.codigo).endsWith("000")) continue;
    // Nombres largos oficiales: "SANTIAGO DE CALI" también es "CALI".
    const mn = nombreMuni(m);
    const corto = mn.replace(/^(?:santiago|san jose) de /, "").replace(/ de indias$/, "");
    // Después de "de" o al final del nombre ("... 001 Andes").
    const esta = (x) => x && new RegExp(`(?:\\b(?:de|del|en)\\s+${x.replace(/[^a-z0-9 ]/g, ".")}\\b|\\s${x.replace(/[^a-z0-9 ]/g, ".")}$)`).test(n);
    if (esta(mn) || esta(corto)) cands.push({ ...m, largo: (esta(mn) ? mn : corto).length });
  }
  const largo = Math.max(0, ...cands.map((c) => c.largo));
  cands = cands.filter((c) => c.largo === largo);
  if (cands.length > 1) {
    const conDespacho = cands.filter((c) => despachos.some((d) => d.codigo.startsWith(`${c.codigo}${r.corporacion}${r.especialidad}`)));
    if (conDespacho.length) cands = conDespacho;
  }
  if (cands.length === 1) r.municipio = String(cands[0].codigo);
  else r.motivo = cands.length ? "Hay varios municipios con ese nombre." : "No reconocí el municipio en el nombre del juzgado.";
  if (!r.corporacion || !r.especialidad) r.motivo ||= "No reconocí la clase de juzgado (municipal, circuito o tribunal, y su especialidad).";
  return r;
}

// Para comparar nombres de juzgado: sin tildes, sin palabras de relleno y
// con los números sin ceros a la izquierda.
export function claveJuzgado(nombre) {
  return normal(nombre).replace(/[-,]/g, " ").split(" ")
    .filter((p) => p && !["de", "del", "la", "el", "los", "d", "c", "dc"].includes(p))
    .map((p) => (/^\d+$/.test(p) ? String(Number(p)) : p)).join(" ");
}

// Prefijo de 12 dígitos del juzgado. aprendidos: [{ juzgado, prefijo }]
// tomados de radicados completos que la app ya conoce.
export function resolverPrefijo(nombre, { aprendidos = [], despachos = [], munis = [] } = {}) {
  const clave = claveJuzgado(nombre);
  if (!clave) return { prefijo: "", confianza: "", motivo: "El estado no dice el juzgado." };
  const visto = aprendidos.filter((a) => /^\d{12}$/.test(a.prefijo) && claveJuzgado(a.juzgado) === clave);
  const unicos = [...new Set(visto.map((a) => a.prefijo))];
  if (unicos.length === 1) return { prefijo: unicos[0], confianza: "armado", motivo: "Juzgado tomado de radicados completos que usted ya tiene." };
  const a = analizarJuzgado(nombre, { munis, despachos });
  if (a.motivo) return { prefijo: "", confianza: "", motivo: a.motivo };
  const base = `${a.municipio}${a.corporacion}${a.especialidad}`;
  const enCatalogo = (p) => despachos.find((d) => d.codigo === p);
  if (a.despacho) {
    const prefijo = `${base}${a.despacho}`;
    if (enCatalogo(prefijo)) return { prefijo, confianza: "armado", motivo: `Juzgado del catálogo de la Rama: ${prefijo}.` };
    // Otra especialidad posible (la sección de un administrativo): solo si una calza.
    const otros = a.otras.map((e) => `${a.municipio}${a.corporacion}${e}${a.despacho}`).filter(enCatalogo);
    if (otros.length === 1) return { prefijo: otros[0], confianza: "armado", motivo: `Juzgado del catálogo de la Rama: ${otros[0]}.` };
    return { prefijo, confianza: "supuesto", motivo: `El juzgado ${prefijo} no está en el catálogo de la Rama: revíselo.` };
  }
  const posibles = despachos.filter((d) => d.codigo.startsWith(base));
  if (posibles.length === 1) return { prefijo: posibles[0].codigo, confianza: "armado", motivo: `Es el único juzgado de esa clase en el municipio (catálogo de la Rama): ${posibles[0].codigo}.` };
  const motivo = posibles.length ? `Hay ${posibles.length} juzgados de esa clase en el municipio y el estado no dice el número: se supuso el 001.` : "El estado no dice el número del juzgado: se supuso el 001.";
  return { prefijo: `${base}001`, confianza: "supuesto", motivo };
}

// { radicado, confianza: leido | armado | supuesto | "", motivo }
export function armarRadicado(juzgado, numeroCorto, contexto = {}) {
  if (esRadicadoCompleto(numeroCorto)) return { radicado: normalizarRadicado(numeroCorto), confianza: "leido", motivo: "" };
  const n = parsearNumeroCorto(numeroCorto, contexto);
  if (!n) return { radicado: "", confianza: "", motivo: "El número no trae año y consecutivo (por ejemplo, un despacho comisorio)." };
  const p = resolverPrefijo(juzgado, contexto);
  if (!p.prefijo) return { radicado: "", confianza: "", motivo: p.motivo };
  return { radicado: `${p.prefijo}${n.anio}${n.consecutivo}${n.recurso}`, confianza: p.confianza, motivo: p.motivo };
}

// Lo que se aprende de un estado con radicados completos: el prefijo que
// comparte la mayoría de sus filas, si es más de la mitad.
export function prefijoMayoritario(radicados) {
  const completos = radicados.filter(esRadicadoCompleto).map((r) => normalizarRadicado(r).slice(0, 12));
  if (!completos.length) return "";
  const cuenta = new Map();
  for (const p of completos) cuenta.set(p, (cuenta.get(p) || 0) + 1);
  const [prefijo, veces] = [...cuenta].sort((x, y) => y[1] - x[1])[0];
  return veces * 2 > completos.length ? prefijo : "";
}
