// Ensamblador del contexto con archivos convertidos. Lógica pura: BM25
// sobre los trozos guardados (con archivo y página), tope por modelo y un
// informe de qué entró y qué se recortó, para el diálogo Revisar envío.
import { terminos } from "./documentos.js";

export function topeAgentes(origen) {
  return origen === "nube" ? 6000 : 1500;
}

// Reparto del presupuesto de fuentes cuando el proyecto tiene archivos y
// también fuentes de la biblioteca.
export function repartirFuentes(total, { hayArchivos, hayPiezas }) {
  if (hayArchivos && hayPiezas) {
    const archivos = Math.round(total * 0.6);
    return { archivos, piezas: total - archivos };
  }
  return { archivos: hayArchivos ? total : 0, piezas: hayPiezas ? total : 0 };
}

export function fragmentosDeTrozos(trozos, consulta, { presupuesto = 3500, k1 = 1.4, b = 0.75 } = {}) {
  const lista = (trozos || []).filter((t) => String(t?.texto || "").trim());
  if (!lista.length || presupuesto <= 0) return { fragmentos: [], recortados: lista.length };
  const pregunta = [...new Set(terminos(consulta))];
  const docs = lista.map((t) => {
    const ts = terminos(`${t.titulo || ""} ${t.texto}`);
    const tf = new Map();
    for (const x of ts) tf.set(x, (tf.get(x) || 0) + 1);
    return { t, tf, largo: ts.length || 1 };
  });
  const promedio = docs.reduce((s, d) => s + d.largo, 0) / docs.length;
  const df = new Map(pregunta.map((x) => [x, docs.filter((d) => d.tf.has(x)).length]));
  for (const d of docs) {
    let p = 0;
    for (const x of pregunta) {
      const f = d.tf.get(x) || 0;
      if (!f) continue;
      const n = df.get(x) || 0;
      p += Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)) * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.largo / promedio))));
    }
    d.puntaje = p;
  }
  const mejor = Math.max(0, ...docs.map((d) => d.puntaje));
  const ordenados = [...docs].sort((x, y) => y.puntaje - x.puntaje || x.t.archivo_id - y.t.archivo_id || x.t.orden - y.t.orden);
  const elegidos = [];
  let usado = 0;
  for (const d of ordenados) {
    if (mejor > 0 && d.puntaje < mejor * 0.25) continue;
    if (usado + d.t.texto.length > presupuesto) continue;
    elegidos.push({ ...d.t, puntaje: Number(d.puntaje.toFixed(4)) });
    usado += d.t.texto.length;
  }
  elegidos.sort((x, y) => x.archivo_id - y.archivo_id || x.orden - y.orden);
  return { fragmentos: elegidos, recortados: lista.length - elegidos.length };
}

export function citaDe(f) {
  return f.pagina ? `[${f.nombre}, página ${f.pagina}]` : `[${f.nombre}]`;
}

export function bloqueDeArchivos(fragmentos) {
  if (!fragmentos?.length) return "";
  return fragmentos.map((f) => `${citaDe(f)}${f.titulo ? ` ${f.titulo}` : ""}\n${f.texto}`).join("\n\n");
}

// Resumen por archivo de lo que entra: nombre y páginas.
export function informeArchivos(fragmentos) {
  const mapa = new Map();
  for (const f of fragmentos || []) {
    const clave = f.archivo_id;
    if (!mapa.has(clave)) mapa.set(clave, { id: clave, nombre: f.nombre, paginas: new Set(), fragmentos: 0, caracteres: 0 });
    const m = mapa.get(clave);
    if (f.pagina) m.paginas.add(f.pagina);
    m.fragmentos++;
    m.caracteres += f.texto.length;
  }
  return [...mapa.values()].map((m) => ({ ...m, paginas: [...m.paginas].sort((a, b) => a - b) }));
}

export function recortarAgentes(texto, origen) {
  const t = String(texto || "").trim();
  const tope = topeAgentes(origen);
  return t.length > tope ? { texto: `${t.slice(0, tope)}\n[...]`, recortado: true } : { texto: t, recortado: false };
}
