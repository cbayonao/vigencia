// Formato del documento en Markdown, un párrafo por bloque.
// Es lo único que se guarda: el editor, la vista, Word, ODT y PDF leen esto.
//
//   **negrita**  *itálica*  ++subrayado++
//   {centro} {derecha} {izquierda} {justificado}  al inicio: alineación
//   #### Subtítulo        > Cita textual
//   - Viñeta              1. Numeral
//   | a | b |  (tabla; la primera fila es encabezado)
// Las secciones siguen siendo "## Título" y la primera línea "Asunto: ...".

export const ALINEACIONES = { centro: "center", derecha: "right", izquierda: "left", justificado: "justify" };
const DE_ALINEACION = Object.fromEntries(Object.entries(ALINEACIONES).map(([k, v]) => [v, k]));

export function escaparHtml(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Tramos con negrita, itálica y subrayado. Una marca sin cierre queda como texto.
export function tramos(texto) {
  const t = String(texto ?? "");
  const partes = t.split(/(\*\*|\+\+|\*)/);
  const estado = { "**": false, "*": false, "++": false };
  const salida = [];
  let actual = "";
  const empujar = () => {
    if (!actual) return;
    salida.push({ texto: actual, negrita: estado["**"], italica: estado["*"], subrayado: estado["++"] });
    actual = "";
  };
  partes.forEach((p, i) => {
    if (p in estado) {
      const resto = partes.slice(i + 1);
      if (estado[p] || resto.includes(p)) {
        empujar();
        estado[p] = !estado[p];
        return;
      }
    }
    actual += p;
  });
  empujar();
  return salida.length ? salida : [{ texto: "", negrita: false, italica: false, subrayado: false }];
}

export function marcarTramo(r) {
  let t = r.texto;
  if (!t) return "";
  if (r.italica) t = `*${t}*`;
  if (r.negrita) t = `**${t}**`;
  if (r.subrayado) t = `++${t}++`;
  return t;
}

function celdas(linea) {
  return linea.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

// Un párrafo del cuerpo a su forma: tipo, alineación y texto o filas.
export function leerParrafo(parrafo) {
  let t = String(parrafo ?? "").trim();
  if (/^\|/.test(t)) {
    const filas = t.split("\n").filter((l) => l.trim() && !/^\|?\s*:?-{2,}/.test(l.trim())).map(celdas);
    return { tipo: "tabla", filas };
  }
  let alineacion = "";
  const a = t.match(/^\{(centro|derecha|izquierda|justificado)\}\s*/);
  if (a) {
    alineacion = a[1];
    t = t.slice(a[0].length);
  }
  let m;
  if ((m = t.match(/^####\s+/))) return { tipo: "subtitulo", alineacion, texto: t.slice(m[0].length) };
  if ((m = t.match(/^>\s?/))) return { tipo: "cita", alineacion, texto: t.slice(m[0].length) };
  if ((m = t.match(/^[-•]\s+/)) || (m = t.match(/^\*\s+/))) return { tipo: "vineta", alineacion, texto: t.slice(m[0].length) };
  if ((m = t.match(/^(\d{1,3})[.)]\s+/))) return { tipo: "numeral", alineacion, numero: Number(m[1]), texto: t.slice(m[0].length) };
  if (!alineacion && /_{3,}/.test(t)) return { tipo: "firma", alineacion: "centro", texto: t };
  return { tipo: "parrafo", alineacion, texto: t };
}

export function escribirParrafo(p) {
  if (p.tipo === "tabla") {
    const filas = (p.filas || []).map((f) => `| ${f.map((c) => String(c).replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`);
    if (!filas.length) return "";
    const ancho = p.filas[0].length;
    filas.splice(1, 0, `| ${Array(ancho).fill("---").join(" | ")} |`);
    return filas.join("\n");
  }
  const al = p.alineacion && p.tipo !== "firma" ? `{${p.alineacion}} ` : "";
  const pref = { subtitulo: "#### ", cita: "> ", vineta: "- ", numeral: `${p.numero || 1}. ` }[p.tipo] || "";
  return `${al}${pref}${String(p.texto ?? "").replace(/\s*\n\s*/g, " ").trim()}`;
}

// Texto plano del párrafo: para buscar, contar y mandar al modelo sin marcas.
export function textoPlano(parrafo) {
  const p = leerParrafo(parrafo);
  if (p.tipo === "tabla") return p.filas.map((f) => f.join(" ")).join(" ");
  return tramos(p.texto).map((r) => r.texto).join("");
}

// ---------- HTML (vista y PDF) ----------

// Markdown completo a HTML bonito para el visor: "Asunto: ..." es el
// título, "## ..." abre sección, lo demás va por leerParrafo. Las viñetas
// y numerales seguidos se agrupan en una sola lista.
export function documentoHtml(markdown) {
  const lineas = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const crudos = [];
  let actual = [];
  const empujar = () => {
    const t = actual.join("\n").trim();
    if (t) crudos.push(t);
    actual = [];
  };
  for (const linea of lineas) {
    const tabla = /^\|/.test(linea.trim());
    const enTabla = actual.length && /^\|/.test(actual[actual.length - 1].trim());
    if (!linea.trim() && !enTabla) {
      empujar();
      continue;
    }
    if (tabla !== enTabla && actual.length) empujar();
    actual.push(linea);
  }
  empujar();
  // Viñetas o numerales seguidos (sin línea en blanco) son un bloque c/u.
  const bloques = [];
  for (const crudo of crudos) {
    const partidas = crudo.split("\n").filter((l) => l.trim());
    if (partidas.length > 1 && partidas.every((l) => /^([-*•]|\d{1,3}[.)])\s+/.test(l.trim()))) {
      bloques.push(...partidas.map((l) => l.trim()));
    } else {
      bloques.push(crudo);
    }
  }
  const salida = [];
  let lista = null;
  const cerrarLista = () => {
    if (lista) salida.push(lista.abre + lista.items.join("") + (lista.tipo === "ul" ? "</ul>" : "</ol>"));
    lista = null;
  };
  for (let bi = 0; bi < bloques.length; bi += 1) {
    const bloque = bloques[bi];
    // El encabezado de datos (--- ... ---) no se muestra; los avisos de
    // página se vuelven una línea discreta.
    if (/^---\s*\n[\s\S]*\n---\s*$/.test(bloque)) continue;
    const pagina = bloque.match(/^<!--\s*pagina\s+(\d+)\s*-->$/i);
    if (pagina) {
      cerrarLista();
      salida.push(`<p class="conv-pagina">página ${pagina[1]}</p>`);
      continue;
    }
    const primero = bloque.split("\n")[0];
    if (bi === 0 && /^Asunto:/.test(primero)) {
      cerrarLista();
      const [lineaAsunto, ...restoLineas] = bloque.split("\n");
      salida.push(`<h1 class="conv-titulo">${tramosHtml(lineaAsunto.replace(/^Asunto:\s*/, "").trim())}</h1>`);
      const resto = restoLineas.join("\n").trim();
      if (resto) bloques.splice(bi + 1, 0, resto);
      continue;
    }
    const seccion = primero.match(/^##\s+(.*)$/);
    if (seccion) {
      cerrarLista();
      salida.push(`<h2 class="conv-seccion">${tramosHtml(seccion[1].trim())}</h2>`);
      const resto = bloque.split("\n").slice(1).join("\n").trim();
      if (resto) bloques.splice(bi + 1, 0, resto);
      continue;
    }
    const p = leerParrafo(bloque);
    if (p.tipo === "vineta" || p.tipo === "numeral") {
      const tipo = p.tipo === "vineta" ? "ul" : "ol";
      const clase = p.alineacion ? ` class="al-${p.alineacion}"` : "";
      const item = `<li${clase}>${tramosHtml(p.texto)}</li>`;
      if (!lista || lista.tipo !== tipo) {
        cerrarLista();
        lista = { tipo, abre: tipo === "ul" ? "<ul>" : `<ol start="${p.numero || 1}">`, items: [] };
      }
      lista.items.push(item);
      continue;
    }
    cerrarLista();
    salida.push(parrafoHtml(bloque));
  }
  cerrarLista();
  return salida.join("\n");
}

export function tramosHtml(texto) {
  return tramos(texto).map((r) => {
    let h = escaparHtml(r.texto)
      .replace(/\[Cita no aportada\]/g, '<mark class="doc-marca-cita">[Cita no aportada]</mark>')
      .replace(/\[Dato pendiente[^\]]*\]/g, (x) => `<mark class="doc-marca-dato">${x}</mark>`);
    if (r.italica) h = `<em>${h}</em>`;
    if (r.negrita) h = `<strong>${h}</strong>`;
    if (r.subrayado) h = `<u>${h}</u>`;
    return h;
  }).join("");
}

export function parrafoHtml(parrafo) {
  const p = leerParrafo(parrafo);
  if (p.tipo === "tabla") {
    const [cab, ...resto] = p.filas;
    return `<table class="doc-tabla"><thead><tr>${(cab || []).map((c) => `<th>${tramosHtml(c)}</th>`).join("")}</tr></thead><tbody>${resto.map((f) => `<tr>${f.map((c) => `<td>${tramosHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  const clase = [p.alineacion ? `al-${p.alineacion}` : "", p.tipo === "firma" ? "firma" : ""].filter(Boolean).join(" ");
  const c = clase ? ` class="${clase}"` : "";
  const interior = tramosHtml(p.texto);
  if (p.tipo === "subtitulo") return `<h3${c}>${interior}</h3>`;
  if (p.tipo === "cita") return `<blockquote${c}><p>${interior}</p></blockquote>`;
  if (p.tipo === "vineta") return `<ul><li${c}>${interior}</li></ul>`;
  if (p.tipo === "numeral") return `<ol start="${p.numero}"><li${c}>${interior}</li></ol>`;
  return `<p${c}>${interior}</p>`;
}

// ---------- Editor (ProseMirror / TipTap JSON) ----------

function inlineJson(texto) {
  return tramos(texto).filter((r) => r.texto).map((r) => {
    const marks = [];
    if (r.negrita) marks.push({ type: "bold" });
    if (r.italica) marks.push({ type: "italic" });
    if (r.subrayado) marks.push({ type: "underline" });
    return marks.length ? { type: "text", text: r.texto, marks } : { type: "text", text: r.texto };
  });
}

function parrafoJson(texto, attrs) {
  const content = inlineJson(texto);
  return content.length ? { type: "paragraph", attrs, content } : { type: "paragraph", attrs };
}

// escrito = { asunto, secciones:[{titulo, parrafos}] }; ids = ids de bloque en orden.
export function escritoAJson(escrito, ids = []) {
  const content = [{ type: "heading", attrs: { level: 1, textAlign: null, bloque: null }, content: inlineJson(escrito.asunto || "Documento") }];
  let n = 0;
  for (const s of escrito.secciones || []) {
    content.push({ type: "heading", attrs: { level: 2, textAlign: null, bloque: null }, content: inlineJson(s.titulo || "Texto") });
    let lista = null;
    for (const crudo of s.parrafos || []) {
      const bloque = ids[n++] || null;
      const p = leerParrafo(crudo);
      const textAlign = ALINEACIONES[p.alineacion] || null;
      const tipoLista = p.tipo === "vineta" ? "bulletList" : p.tipo === "numeral" ? "orderedList" : p.tipo === "cita" ? "blockquote" : null;
      if (!tipoLista) lista = null;
      if (p.tipo === "tabla") {
        content.push({
          type: "table", attrs: { bloque },
          content: p.filas.map((f, i) => ({ type: "tableRow", content: f.map((c) => ({ type: i === 0 ? "tableHeader" : "tableCell", content: [parrafoJson(c, { textAlign: null, bloque: null })] })) })),
        });
      } else if (tipoLista) {
        const hijo = parrafoJson(p.texto, { textAlign, bloque });
        const item = tipoLista === "blockquote" ? hijo : { type: "listItem", content: [hijo] };
        if (!lista || lista.type !== tipoLista) {
          lista = { type: tipoLista, content: [] };
          if (tipoLista === "orderedList") lista.attrs = { start: p.numero || 1 };
          content.push(lista);
        }
        lista.content.push(item);
      } else if (p.tipo === "subtitulo") {
        content.push({ type: "heading", attrs: { level: 3, textAlign, bloque }, content: inlineJson(p.texto) });
      } else {
        content.push(parrafoJson(p.texto, { textAlign: p.tipo === "firma" ? "center" : textAlign, bloque }));
      }
    }
  }
  return { type: "doc", content };
}

function inlineMd(nodos = []) {
  return nodos.map((n) => {
    if (n.type === "hardBreak") return " ";
    if (n.type !== "text") return inlineMd(n.content);
    const tiene = (t) => (n.marks || []).some((m) => m.type === t);
    return marcarTramo({ texto: n.text, negrita: tiene("bold"), italica: tiene("italic"), subrayado: tiene("underline") });
  }).join("").replace(/\*\*\*\*|\+\+\+\+/g, "");
}

function alinear(attrs) {
  return DE_ALINEACION[attrs?.textAlign] || "";
}

// JSON del editor a escrito { asunto, secciones } y lista de ids por párrafo.
export function jsonAEscrito(json) {
  let asunto = "";
  const secciones = [];
  const ids = [];
  let actual = null;
  const sec = () => {
    if (!actual) {
      actual = { titulo: "Texto", parrafos: [] };
      secciones.push(actual);
    }
    return actual;
  };
  const poner = (texto, bloque) => {
    if (!texto.replace(/^\{\w+\}\s*/, "").trim()) return;
    sec().parrafos.push(texto);
    ids.push(bloque || null);
  };
  const tabla = (n) => {
    const filas = (n.content || []).map((fila) => (fila.content || []).map((celda) => (celda.content || []).map((p) => inlineMd(p.content)).join(" ").trim()));
    if (filas.length) poner(escribirParrafo({ tipo: "tabla", filas }), n.attrs?.bloque);
  };
  // Lo que va dentro de una lista o una cita que no es párrafo (una tabla,
  // otra lista, un título) se guarda como bloque propio, sin perderse.
  const lista = (n, tipo, cuenta) => {
    for (const item of n.content || []) {
      for (const h of item.content || []) {
        if (h.type === "paragraph") poner(escribirParrafo({ tipo, numero: cuenta.n++, alineacion: alinear(h.attrs), texto: inlineMd(h.content) }), h.attrs?.bloque);
        else if (h.type === "bulletList") lista(h, "vineta", { n: 1 });
        else if (h.type === "orderedList") lista(h, "numeral", { n: h.attrs?.start || 1 });
        else nodo(h);
      }
    }
  };
  const nodo = (n) => {
    const a = n.attrs || {};
    if (n.type === "heading" && a.level === 1 && !asunto) asunto = inlineMd(n.content).replace(/[*+]/g, "").trim();
    else if (n.type === "heading" && a.level <= 2) {
      actual = { titulo: inlineMd(n.content).replace(/[*+]/g, "").trim() || "Texto", parrafos: [] };
      secciones.push(actual);
    } else if (n.type === "heading") poner(escribirParrafo({ tipo: "subtitulo", alineacion: alinear(a), texto: inlineMd(n.content) }), a.bloque);
    else if (n.type === "paragraph") {
      const texto = inlineMd(n.content);
      const firma = /_{3,}/.test(texto) && a.textAlign === "center";
      poner(escribirParrafo({ tipo: "parrafo", alineacion: firma ? "" : alinear(a), texto }), a.bloque);
    } else if (n.type === "blockquote") {
      for (const h of n.content || []) {
        if (h.type === "paragraph") poner(escribirParrafo({ tipo: "cita", alineacion: alinear(h.attrs), texto: inlineMd(h.content) }), h.attrs?.bloque);
        else nodo(h);
      }
    } else if (n.type === "bulletList") lista(n, "vineta", { n: 1 });
    else if (n.type === "orderedList") lista(n, "numeral", { n: n.attrs?.start || 1 });
    else if (n.type === "table") tabla(n);
  };
  for (const n of json?.content || []) nodo(n);
  return { escrito: { asunto: asunto || secciones.find((s) => s.titulo !== "Texto")?.titulo || "Documento", secciones: secciones.filter((s) => s.parrafos.length) }, ids };
}
