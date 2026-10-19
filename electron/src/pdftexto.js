// Texto de un PDF sin dependencias nativas: abre los flujos (FlateDecode
// con zlib de Node) y lee los operadores de texto Tj, TJ, ' y ".
// Alcance: PDF con texto y fuentes de codificación simple (lo normal en
// leyes y sentencias descargadas). Un PDF escaneado o con fuentes CID sin
// tabla de caracteres no da texto legible: se avisa y se pide pegarlo.
import zlib from "node:zlib";

function flujos(buffer) {
  const crudo = buffer.toString("latin1");
  const salida = [];
  const marca = /stream\r?\n/g;
  let m;
  while ((m = marca.exec(crudo))) {
    const inicio = m.index + m[0].length;
    const fin = crudo.indexOf("endstream", inicio);
    if (fin < 0) break;
    const dicc = crudo.slice(Math.max(0, m.index - 400), m.index);
    const ultimo = dicc.lastIndexOf("<<");
    const cabeza = ultimo >= 0 ? dicc.slice(ultimo) : dicc;
    let datos = buffer.subarray(inicio, fin);
    if (/\/FlateDecode/.test(cabeza)) {
      try {
        datos = zlib.inflateSync(datos);
      } catch {
        try {
          datos = zlib.inflateSync(datos, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
        } catch {
          datos = null;
        }
      }
    } else if (/\/Filter/.test(cabeza)) {
      datos = null;
    }
    if (datos && !/\/Subtype\s*\/Image/.test(cabeza)) salida.push(datos.toString("latin1"));
    marca.lastIndex = fin;
  }
  return salida;
}

function literal(fuente, i) {
  let nivel = 1;
  let salida = "";
  i += 1;
  while (i < fuente.length && nivel > 0) {
    const c = fuente[i];
    if (c === "\\") {
      const s = fuente[i + 1];
      const mapa = { n: "\n", r: "", t: " ", b: "", f: "", "(": "(", ")": ")", "\\": "\\" };
      if (s in mapa) {
        salida += mapa[s];
        i += 2;
      } else if (/[0-7]/.test(s)) {
        const oct = fuente.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0];
        salida += String.fromCharCode(parseInt(oct, 8));
        i += 1 + oct.length;
      } else {
        i += 2;
      }
      continue;
    }
    if (c === "(") nivel += 1;
    if (c === ")") nivel -= 1;
    if (nivel > 0) salida += c;
    i += 1;
  }
  return { valor: salida, fin: i };
}

function hex(fuente, i) {
  const fin = fuente.indexOf(">", i);
  const cuerpo = fuente.slice(i + 1, fin).replace(/\s+/g, "");
  let salida = "";
  if (cuerpo.length % 4 === 0 && /^(00[0-9a-f]{2})+$/i.test(cuerpo)) {
    for (let k = 0; k < cuerpo.length; k += 4) salida += String.fromCharCode(parseInt(cuerpo.slice(k, k + 4), 16));
  } else {
    for (let k = 0; k < cuerpo.length; k += 2) salida += String.fromCharCode(parseInt(cuerpo.slice(k, k + 2).padEnd(2, "0"), 16));
  }
  return { valor: salida, fin: fin + 1 };
}

const WIN = { 0x80: "€", 0x91: "'", 0x92: "'", 0x93: '"', 0x94: '"', 0x96: "-", 0x97: "-", 0x85: "..." };

function decodificar(cadena) {
  let salida = "";
  for (const c of cadena) {
    const n = c.charCodeAt(0);
    salida += WIN[n] || c;
  }
  return salida;
}

export function textoDeContenido(fuente) {
  let salida = "";
  let pila = [];
  let i = 0;
  while (i < fuente.length) {
    const c = fuente[i];
    if (c === "(") {
      const r = literal(fuente, i);
      pila.push(r.valor);
      i = r.fin;
      continue;
    }
    if (c === "<" && fuente[i + 1] !== "<") {
      const r = hex(fuente, i);
      pila.push(r.valor);
      i = r.fin;
      continue;
    }
    if (c === "[") {
      pila.push("[");
      i += 1;
      continue;
    }
    if (c === "]") {
      const partes = [];
      while (pila.length && pila[pila.length - 1] !== "[") partes.unshift(pila.pop());
      pila.pop();
      pila.push({ arreglo: partes });
      i += 1;
      continue;
    }
    if (c === "%") {
      while (i < fuente.length && fuente[i] !== "\n") i += 1;
      continue;
    }
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const m = fuente.slice(i, i + 40).match(/^([A-Za-z'"*]+|-?[0-9.]+|\/[^\s/[\]()<>]+|<<|>>|\S)/);
    const token = m ? m[1] : c;
    i += token.length;
    if (/^-?[0-9.]+$/.test(token)) {
      pila.push(Number(token));
      continue;
    }
    if (token.startsWith("/") || token === "<<" || token === ">>") {
      pila.push(token);
      continue;
    }
    const ultima = pila[pila.length - 1];
    if (token === "Tj" && typeof ultima === "string") salida += ultima;
    else if (token === "TJ" && ultima?.arreglo) {
      for (const parte of ultima.arreglo) {
        if (typeof parte === "string") salida += parte;
        else if (typeof parte === "number" && parte < -200) salida += " ";
      }
    } else if ((token === "'" || token === '"') && typeof ultima === "string") salida += `\n${ultima}`;
    else if (token === "T*") salida += "\n";
    else if (token === "Td" || token === "TD") {
      const ty = pila[pila.length - 1];
      if (typeof ty === "number" && ty !== 0) salida += "\n";
      else salida += " ";
    } else if (token === "ET") salida += "\n";
    if (/^[A-Za-z'"*]+$/.test(token)) pila = [];
  }
  return decodificar(salida);
}

export function textoDePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { ok: false, error: "Ese archivo no es un PDF." };
  }
  const partes = [];
  for (const flujo of flujos(buffer)) {
    if (!/\bBT\b/.test(flujo)) continue;
    const t = textoDeContenido(flujo);
    if (t.trim()) partes.push(t);
  }
  const textoFinal = partes.join("\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const legibles = (textoFinal.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ0-9 .,;:\n]/g) || []).length;
  if (!textoFinal || legibles / textoFinal.length < 0.7) {
    return { ok: false, error: "No pude leer texto de ese PDF. Si es escaneado o usa fuentes especiales, copie el texto y péguelo." };
  }
  return { ok: true, texto: textoFinal };
}

// Camino mejorado: pdfjs (fuentes CID y cmaps locales) y OCR si está
// instalado; si todo falla, el lector propio de arriba. Sin red.
// conPaginas deja las marcas <!-- pagina n --> (Comparar ubica así cada cambio).
export async function textoDePdfCompleto(buffer, { datosDir = "", conPaginas = false } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { ok: false, error: "Ese archivo no es un PDF." };
  }
  try {
    const { convertirPdf } = await import("./convertir/convertidores.js");
    const { quitarEncabezado } = await import("../compartido/convertir.js");
    const r = await convertirPdf(buffer, { datosDir });
    const limpio = quitarEncabezado(r.markdown);
    const texto = (conPaginas ? limpio : limpio.replace(/<!-- pagina \d+ -->\n*/g, "")).replace(/^#+ /gm, "").trim();
    if (texto && r.calidad >= 0.6) return { ok: true, texto, aviso: r.aviso || "" };
    const viejo = textoDePdf(buffer);
    if (viejo.ok) return viejo;
    return { ok: false, error: r.aviso || viejo.error };
  } catch (error) {
    // Con contraseña ningún lector sirve: se dice cómo abrirlo.
    if (error?.codigo === "clave") return { ok: false, error: error.message, codigo: "clave" };
    return textoDePdf(buffer);
  }
}
