// Memoria del documento y bloques con id estable. Lógica pura.
// La memoria sobrevive a reinicios y a cambios de modelo: vive en SQLite y
// entra al encargo de cualquier modelo, local o de nube.
import { escribirParrafo, leerParrafo } from "./formato.js";
import { escritoDeTexto, normalizar, terminos, textoDeEscrito } from "./documentos.js";

export function memoriaVacia() {
  return { resumen: "", instrucciones: [], decisiones: [], fuentes: [], esquema: [], modelos: [], vueltas: 0 };
}

const DECISION = /\b(no\s|nunca|siempre|usa|use|incluye|incluya|quita|quite|cambia|cambie|mant[eé]n|mantenga|agrega|agregue|elimina|elimine|pide|pida|cita|cite)\b/i;

function corto(t, max = 200) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function unir(lista, nuevos, max) {
  const salida = [...(lista || [])];
  for (const n of nuevos) {
    const v = corto(n);
    if (!v) continue;
    const i = salida.findIndex((x) => normalizar(x) === normalizar(v));
    if (i >= 0) salida.splice(i, 1);
    salida.push(v);
  }
  return salida.slice(-max);
}

export function esquemaDe(cuerpo) {
  const e = escritoDeTexto(cuerpo || "");
  return (e.secciones || []).map((s) => s.titulo).filter(Boolean).slice(0, 30);
}

// Actualiza la memoria después de una vuelta, sin llamar a ningún modelo.
export function actualizarMemoria(previa, { pedido = "", cuerpo = "", fuentes = [], modelo = "", decision = "" } = {}) {
  const m = { ...memoriaVacia(), ...(previa || {}) };
  const p = corto(pedido);
  m.vueltas = (m.vueltas || 0) + (p ? 1 : 0);
  if (p) m.instrucciones = unir(m.instrucciones, [p], 15);
  const decisiones = [decision, DECISION.test(p) ? p : ""].filter(Boolean);
  if (decisiones.length) m.decisiones = unir(m.decisiones, decisiones, 20);
  m.fuentes = unir(m.fuentes, fuentes, 30);
  if (modelo) m.modelos = unir(m.modelos, [modelo], 5);
  if (cuerpo) m.esquema = esquemaDe(cuerpo);
  const primero = m.instrucciones[0] || "";
  const ultimas = m.instrucciones.slice(-3).filter((x) => x !== primero);
  m.resumen = corto([
    primero ? `Pedido inicial: ${primero}.` : "",
    m.vueltas > 1 ? `${m.vueltas} vueltas de trabajo.` : "",
    ultimas.length ? `Últimos pedidos: ${ultimas.join("; ")}.` : "",
  ].filter(Boolean).join(" "), 900);
  return m;
}

export function bloqueMemoria(m, origen) {
  if (!m || (!m.resumen && !m.decisiones?.length && !m.esquema?.length)) return "";
  const tope = origen === "nube" ? 4000 : 1200;
  const partes = [];
  if (m.resumen) partes.push(`Resumen: ${m.resumen}`);
  if (m.decisiones?.length) partes.push(`Decisiones que se mantienen:\n${m.decisiones.map((d) => `- ${d}`).join("\n")}`);
  if (m.esquema?.length) partes.push(`Secciones del documento: ${m.esquema.join(", ")}`);
  if (m.fuentes?.length) partes.push(`Fuentes ya usadas: ${m.fuentes.join(", ")}`);
  const t = partes.join("\n");
  return t.length > tope ? `${t.slice(0, tope)}\n[...]` : t;
}

// ---------- Bloques ----------

// Párrafos direccionables del documento: sección y posición.
export function bloquesDeCuerpo(cuerpo) {
  const e = escritoDeTexto(cuerpo || "");
  const lista = [];
  (e.secciones || []).forEach((s, i) => {
    (s.parrafos || []).forEach((p, j) => lista.push({ seccion: s.titulo, s: i, p: j, texto: p }));
  });
  return lista;
}

function parecido(a, b) {
  const x = new Set(terminos(a));
  const y = new Set(terminos(b));
  if (!x.size && !y.size) return a === b ? 1 : 0;
  let comun = 0;
  for (const t of x) if (y.has(t)) comun++;
  return comun / Math.max(1, x.size + y.size - comun);
}

// Asigna ids estables: el mismo texto conserva su id; uno parecido en la
// misma sección también (fue editado); lo demás recibe id nuevo.
export function sincronizarBloques(previos, cuerpo, nuevoId, preferidos = []) {
  const libres = [...(previos || [])];
  const salida = [];
  for (const [orden, b] of bloquesDeCuerpo(cuerpo).entries()) {
    // El editor sabe qué párrafo es cuál aunque se haya reescrito entero.
    let i = preferidos[orden] ? libres.findIndex((x) => x.id === preferidos[orden]) : -1;
    if (i < 0) i = libres.findIndex((x) => x.texto === b.texto);
    if (i < 0) {
      let mejor = -1;
      let puntaje = 0.45;
      libres.forEach((x, k) => {
        const v = parecido(x.texto, b.texto) + (x.seccion === b.seccion ? 0.1 : 0);
        if (v > puntaje) {
          puntaje = v;
          mejor = k;
        }
      });
      i = mejor;
    }
    const id = i >= 0 ? libres.splice(i, 1)[0].id : nuevoId();
    salida.push({ ...b, id, orden });
  }
  return salida;
}

// Cambia solo el párrafo del bloque y devuelve el cuerpo nuevo.
export function aplicarBloque(cuerpo, bloque, nuevo) {
  const e = escritoDeTexto(cuerpo || "");
  const s = e.secciones?.[bloque.s];
  if (!s || s.parrafos?.[bloque.p] == null) return null;
  const limpio = String(nuevo || "").replace(/^```[a-z]*\n?|```$/g, "").trim().replace(/^["«]|["»]$/g, "").replace(/\n\s*\n/g, " ");
  if (!limpio) return null;
  // Si el modelo devolvió solo el texto, el párrafo conserva su forma (viñeta, cita, alineación).
  const antes = leerParrafo(s.parrafos[bloque.p]);
  const nuevoP = leerParrafo(limpio);
  s.parrafos[bloque.p] = nuevoP.tipo === "parrafo" && !nuevoP.alineacion && antes.tipo !== "tabla" && antes.tipo !== "firma"
    ? escribirParrafo({ ...antes, texto: nuevoP.texto }) : limpio;
  return textoDeEscrito(e);
}

// Diferencia por palabras para mostrar antes y después.
export function diffPalabras(antes, despues) {
  const a = String(antes || "").split(/(\s+)/);
  const b = String(despues || "").split(/(\s+)/);
  const n = a.length;
  const m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  const empujar = (op, txt) => {
    const u = ops[ops.length - 1];
    if (u && u.op === op) u.texto += txt;
    else ops.push({ op, texto: txt });
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      empujar("igual", a[i]);
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) empujar("quitado", a[i++]);
    else empujar("agregado", b[j++]);
  }
  while (i < n) empujar("quitado", a[i++]);
  while (j < m) empujar("agregado", b[j++]);
  return ops;
}
