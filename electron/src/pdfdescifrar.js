// Desbloquear: quita la contraseña con la clave del usuario y devuelve el
// PDF limpio. Parser propio sobre bytes porque pdf-lib no abre cifrados.
// Entiende xref clásica y por flujo (con predictores PNG), y V5/V4/V2/V1.
// No se abren archivos sin su contraseña.
import zlib from "node:zlib";
import fs from "node:fs";
import { Aviso } from "./db.js";
import {
  aesCbcDescifrar, claveObjeto, claveV124, descifrarObjetoV24, entradaO,
  entradaU, hashR6, md5, rc4, rellenarClave, validarV5, xorLlave,
} from "./pdfcifrado.js";

// ---------- Tokenizador mínimo ----------

export function esEspacio(c) {
  return c === 0x00 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
}

function leerHex(buf, i) {
  let hex = "";
  let j = i + 1;
  while (j < buf.length && buf[j] !== 0x3e) {
    const c = buf[j];
    if (!esEspacio(c)) hex += String.fromCharCode(c);
    j += 1;
  }
  if (hex.length % 2) hex += "0";
  return { bytes: Buffer.from(hex, "hex"), fin: j + 1 };
}

function leerLiteral(buf, i) {
  const salida = [];
  let j = i + 1;
  let nivel = 1;
  while (j < buf.length && nivel > 0) {
    const c = buf[j];
    if (c === 0x5c) {
      const n = buf[j + 1];
      if (n >= 0x30 && n <= 0x37) {
        let oct = "";
        let k = j + 1;
        while (k < buf.length && oct.length < 3 && buf[k] >= 0x30 && buf[k] <= 0x37) {
          oct += String.fromCharCode(buf[k]);
          k += 1;
        }
        salida.push(parseInt(oct, 8));
        j = k;
        continue;
      }
      const mapa = { n: 0x0a, r: 0x0d, t: 0x09, b: 0x08, f: 0x0c, "(": 0x28, ")": 0x29, "\\": 0x5c };
      if (n === 0x0d && buf[j + 2] === 0x0a) {
        j += 3;
        continue;
      }
      if (n === 0x0d || n === 0x0a) {
        j += 2;
        continue;
      }
      salida.push(mapa[n] ?? n);
      j += 2;
      continue;
    }
    if (c === 0x28) nivel += 1;
    if (c === 0x29) {
      nivel -= 1;
      if (nivel === 0) {
        j += 1;
        break;
      }
    }
    salida.push(c);
    j += 1;
  }
  return { bytes: Buffer.from(salida), fin: j };
}

// Lee un valor simple (para diccionarios de trailer/Encrypt): devuelve
// { valor, fin } donde valor es { t, ... }.
export function leerValor(buf, i) {
  while (i < buf.length && esEspacio(buf[i])) i += 1;
  const c = buf[i];
  if (c === 0x3c && buf[i + 1] === 0x3c) {
    const dict = {};
    let j = i + 2;
    for (;;) {
      while (j < buf.length && esEspacio(buf[j])) j += 1;
      if (buf[j] === 0x3e && buf[j + 1] === 0x3e) {
        j += 2;
        break;
      }
      if (buf[j] !== 0x2f) throw new Error("dict sin clave");
      let k = j + 1;
      while (k < buf.length && !esEspacio(buf[k]) && !"/<>()[]{}\n".includes(String.fromCharCode(buf[k]))) k += 1;
      const clave = buf.subarray(j + 1, k).toString("latin1");
      const r = leerValor(buf, k);
      dict[clave] = r.valor;
      j = r.fin;
    }
    return { valor: { t: "dict", dict }, fin: j };
  }
  if (c === 0x3c) {
    const r = leerHex(buf, i);
    return { valor: { t: "hex", bytes: r.bytes }, fin: r.fin };
  }
  if (c === 0x28) {
    const r = leerLiteral(buf, i);
    return { valor: { t: "str", bytes: r.bytes }, fin: r.fin };
  }
  if (c === 0x5b) {
    const items = [];
    let j = i + 1;
    for (;;) {
      while (j < buf.length && esEspacio(buf[j])) j += 1;
      if (buf[j] === 0x5d) {
        j += 1;
        break;
      }
      const r = leerValor(buf, j);
      items.push(r.valor);
      j = r.fin;
    }
    return { valor: { t: "array", items }, fin: j };
  }
  if (c === 0x2f) {
    let k = i + 1;
    while (k < buf.length && !esEspacio(buf[k]) && !"/<>()[]{}%".includes(String.fromCharCode(buf[k]))) k += 1;
    return { valor: { t: "nombre", nombre: buf.subarray(i + 1, k).toString("latin1") }, fin: k };
  }
  let k = i;
  while (k < buf.length && !esEspacio(buf[k]) && !"<>()[]/".includes(String.fromCharCode(buf[k]))) k += 1;
  const palabra = buf.subarray(i, k).toString("latin1");
  if (/^[+-]?\d+$/.test(palabra)) {
    // ¿Referencia "n g R"?
    let j = k;
    while (j < buf.length && esEspacio(buf[j])) j += 1;
    let m = j;
    while (m < buf.length && /[0-9]/.test(String.fromCharCode(buf[m]))) m += 1;
    const gen = buf.subarray(j, m).toString("latin1");
    let p = m;
    while (p < buf.length && esEspacio(buf[p])) p += 1;
    if (/^\d+$/.test(gen) && buf[p] === 0x52) {
      return { valor: { t: "ref", num: Number(palabra), gen: Number(gen) }, fin: p + 1 };
    }
    return { valor: { t: "numero", texto: palabra }, fin: k };
  }
  if (/^[+-]?[\d.]+$/.test(palabra)) return { valor: { t: "numero", texto: palabra }, fin: k };
  if (palabra === "true" || palabra === "false") return { valor: { t: "bool", valor: palabra === "true" }, fin: k };
  if (palabra === "null") return { valor: { t: "null" }, fin: k };
  if (palabra === "stream") return { valor: { t: "stream" }, fin: k };
  throw new Error(`token raro: ${palabra.slice(0, 20)}`);
}

export function textoDe(valor) {
  if (!valor) return "";
  if (valor.t === "hex" || valor.t === "str") return valor.bytes.toString("latin1");
  if (valor.t === "nombre") return valor.nombre;
  if (valor.t === "numero") return valor.texto;
  return "";
}

// ---------- Lectura de xref ----------

function leerTablaXref(buf, offset, mapa) {
  let i = offset;
  const palabra = (w) => {
    while (i < buf.length && esEspacio(buf[i])) i += 1;
    const ok = buf.subarray(i, i + w.length).toString("latin1") === w;
    i += w.length;
    return ok;
  };
  if (!palabra("xref")) throw new Error("sin xref");
  for (;;) {
    while (i < buf.length && esEspacio(buf[i])) i += 1;
    if (buf.subarray(i, i + 7).toString("latin1") === "trailer") break;
    let k = i;
    while (buf[k] !== 0x0a && buf[k] !== 0x0d) k += 1;
    const [primero, cuenta] = buf.subarray(i, k).toString("latin1").trim().split(/\s+/).map(Number);
    i = k;
    while (i < buf.length && (buf[i] === 0x0a || buf[i] === 0x0d)) i += 1;
    for (let n = 0; n < cuenta; n += 1) {
      const linea = buf.subarray(i, i + 20).toString("latin1");
      const off = Number(linea.slice(0, 10));
      const gen = Number(linea.slice(11, 16));
      const libre = linea[17] === "f";
      if (!libre && !mapa.has(primero + n)) mapa.set(primero + n, { offset: off, gen });
      i += 20;
      while (i < buf.length && (buf[i] === 0x0a || buf[i] === 0x0d || buf[i] === 0x20)) i += 1;
    }
  }
  while (i < buf.length && esEspacio(buf[i])) i += 1;
  i += 7; // trailer
  const r = leerValor(buf, i);
  return { trailer: r.valor.dict, fin: r.fin };
}

function sinPredictor(datos, columnas, colores, bits) {
  const porFila = Math.ceil((colores * bits * columnas + 7) / 8);
  const salida = [];
  let i = 0;
  for (let fila = 0; fila + porFila + 1 <= datos.length + 1 && i < datos.length; fila += 1) {
    const filtro = datos[i];
    const cruda = datos.subarray(i + 1, i + 1 + porFila);
    if (cruda.length < porFila) break;
    const anterior = fila === 0 ? Buffer.alloc(porFila) : salida[fila - 1];
    const actual = Buffer.alloc(porFila);
    for (let k = 0; k < porFila; k += 1) {
      const a = k >= colores ? actual[k - colores] : 0;
      const b = anterior[k];
      const c = k >= colores ? anterior[k - colores] : 0;
      const v = cruda[k];
      actual[k] = filtro === 0 ? v
        : filtro === 1 ? (v + a) & 0xff
        : filtro === 2 ? (v + b) & 0xff
        : filtro === 3 ? (v + ((a + b) >> 1)) & 0xff
        : filtro === 4 ? (v + (a + b - c + ((Math.abs(a - c) > Math.abs(b - c) ? 0 : 0) && 0) + paeth(a, b, c))) & 0xff
        : v;
    }
    salida.push(actual);
    i += 1 + porFila;
  }
  return Buffer.concat(salida);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodificarFlujo(datos, dict) {
  const filtros = [];
  const f = dict.Filter || dict.F;
  const lista = f?.t === "array" ? f.items : f ? [f] : [];
  for (const x of lista) {
    const nombre = x.t === "nombre" ? x.nombre : textoDe(x);
    if (nombre) filtros.push(nombre.replace(/^\//, ""));
  }
  let actual = Buffer.from(datos);
  const params = dict.DecodeParms || dict.DP;
  for (const filtro of filtros) {
    if (filtro === "FlateDecode") {
      actual = zlib.inflateSync(actual);
      const pr = params?.t === "dict" ? params.dict : params?.t === "array" ? params.items?.[0]?.dict : null;
      const predictor = Number(pr?.Predictor?.texto ?? pr?.Predictor ?? 1);
      if (predictor !== 1) {
        const columnas = Number(pr?.Columns?.texto ?? 1);
        const colores = Number(pr?.Colors?.texto ?? 1);
        const bits = Number(pr?.BitsPerComponent?.texto ?? 8);
        actual = sinPredictor(actual, columnas, colores, bits);
      }
    } else if (filtro === "ASCIIHexDecode") {
      actual = Buffer.from(actual.toString("latin1").replace(/[^0-9a-fA-F]/g, ""), "hex");
    } else if (filtro === "ASCII85Decode" || filtro === "LZWDecode") {
      throw new Error(`filtro no soportado: ${filtro}`);
    }
  }
  return { datos: actual, filtros };
}

function leerFlujoXref(buf, offset, mapa) {
  let i = offset;
  while (i < buf.length && esEspacio(buf[i])) i += 1;
  let k = i;
  while (buf[k] !== 0x0a && buf[k] !== 0x0d) k += 1;
  const cab = buf.subarray(i, i + 40).toString("latin1").match(/^(\d+)\s+(\d+)\s+obj\b/);
  if (!cab) throw new Error("xref sin cabecera");
  const num = Number(cab[1]);
  const gen = Number(cab[2]);
  const r = leerValor(buf, i + cab[0].length);
  if (r.valor.t !== "dict") throw new Error("xref sin dict");
  const dict = r.valor.dict;
  let j = r.fin;
  while (j < buf.length && esEspacio(buf[j])) j += 1;
  const esFlujo = buf.subarray(j, j + 6).toString("latin1") === "stream";
  if (!esFlujo) throw new Error("xref sin stream");
  j += 6;
  if (buf[j] === 0x0d && buf[j + 1] === 0x0a) j += 2;
  else if (buf[j] === 0x0a || buf[j] === 0x0d) j += 1;
  const fin = buf.indexOf("endstream", j);
  const { datos } = decodificarFlujo(buf.subarray(j, fin), dict);
  const anchos = dict.W.items.map((x) => Number(x.texto));
  const tam = Number(dict.Size.texto);
  let p = 0;
  const indice = [];
  if (dict.Index) {
    const items = dict.Index.items.map((x) => Number(x.texto));
    for (let q = 0; q < items.length; q += 2) {
      for (let n = 0; n < items[q + 1]; n += 1) indice.push(items[q] + n);
    }
  } else {
    for (let n = 0; n < tam; n += 1) indice.push(n);
  }
  for (const n of indice) {
    if (p + anchos[0] + anchos[1] + anchos[2] > datos.length) break;
    const tipo = anchos[0] ? datos.readUIntBE(p, anchos[0]) : 1;
    p += anchos[0];
    const c2 = anchos[1] ? datos.readUIntBE(p, anchos[1]) : 0;
    p += anchos[1];
    const c3 = anchos[2] ? datos.readUIntBE(p, anchos[2]) : 0;
    p += anchos[2];
    if (tipo === 0 || mapa.has(n)) continue;
    if (tipo === 1) mapa.set(n, { offset: c2, gen: c3 });
    else if (tipo === 2) mapa.set(n, { flujo: c2, indice: c3 });
  }
  const trailer = {};
  for (const clave of ["Root", "Encrypt", "Info", "ID", "Prev"]) {
    if (dict[clave]) trailer[clave] = dict[clave];
  }
  return { trailer, num, gen };
}

// ---------- Objetos y reescritura ----------

export function leerObjeto(buf, offset) {
  let i = offset;
  while (i < buf.length && esEspacio(buf[i])) i += 1;
  const resto = buf.subarray(i, i + 40).toString("latin1");
  const cab = resto.match(/^(\d+)\s+(\d+)\s+obj\b/);
  if (!cab) throw new Error("objeto sin cabecera");
  const num = Number(cab[1]);
  const gen = Number(cab[2]);
  const r = leerValor(buf, i + cab[0].length);
  if (r.valor.t !== "dict") return { num, gen, dict: null, flujo: null, fin: r.fin };
  let j = r.fin;
  while (j < buf.length && esEspacio(buf[j])) j += 1;
  if (buf.subarray(j, j + 6).toString("latin1") !== "stream") return { num, gen, dict: r.valor.dict, flujo: null, fin: j };
  j += 6;
  if (buf[j] === 0x0d && buf[j + 1] === 0x0a) j += 2;
  else if (buf[j] === 0x0a || buf[j] === 0x0d) j += 1;
  let fin;
  const lon = r.valor.dict?.Length;
  const cuantos = lon ? Number(textoDe(lon)) : NaN;
  if (Number.isFinite(cuantos) && cuantos >= 0) {
    fin = j + cuantos;
  } else {
    fin = buf.indexOf("endstream", j);
  }
  if (fin < 0) throw new Error("flujo sin fin");
  return { num, gen, dict: r.valor.dict, flujo: buf.subarray(j, fin), fin: fin + 9 };
}

function hexLimpio(bytes) {
  return `<${Buffer.from(bytes).toString("hex").toUpperCase()}>`;
}

export function emitirValor(valor, descifrar) {
  if (!valor) return "null";
  if (valor.t === "hex" || valor.t === "str") return hexLimpio(descifrar(valor.bytes));
  if (valor.t === "nombre") return `/${valor.nombre}`;
  if (valor.t === "numero") return valor.texto;
  if (valor.t === "bool") return valor.valor ? "true" : "false";
  if (valor.t === "null") return "null";
  if (valor.t === "ref") return `${valor.num} ${valor.gen} R`;
  if (valor.t === "array") return `[${valor.items.map((x) => emitirValor(x, descifrar)).join(" ")}]`;
  if (valor.t === "dict") {
    return `<<${Object.entries(valor.dict).map(([k, v]) => `/${k} ${emitirValor(v, descifrar)}`).join("")}>>`;
  }
  return "null";
}

// ---------- Abrir cifrado ----------

function bytesDe(valor) {
  if (!valor) return Buffer.alloc(0);
  if (valor.t === "hex" || valor.t === "str") return Buffer.from(valor.bytes);
  return Buffer.alloc(0);
}

function numeroDe(valor) {
  return Number(textoDe(valor));
}

export function leerCifrado(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Aviso("Ese archivo no es un PDF válido.");
  const cola = buf.subarray(Math.max(0, buf.length - 2048)).toString("latin1");
  const m = cola.match(/startxref\s+(\d+)/);
  if (!m) throw new Aviso("Ese PDF está dañado o no se pudo leer.");
  const mapa = new Map();
  let trailer = null;
  const previos = new Set();
  let actual = Number(m[1]);
  for (let vuelta = 0; vuelta < 20; vuelta += 1) {
    let i = actual;
    while (i < buf.length && esEspacio(buf[i])) i += 1;
    if (buf.subarray(i, i + 4).toString("latin1") === "xref") {
      const r = leerTablaXref(buf, i, mapa);
      trailer = { ...r.trailer, ...trailer };
      const p = r.trailer.Prev ? Number(textoDe(r.trailer.Prev)) : 0;
      if (!p || previos.has(p)) break;
      previos.add(p);
      actual = p;
    } else {
      const r = leerFlujoXref(buf, i, mapa);
      const combinado = { ...trailer };
      for (const [clave, valor] of Object.entries(r.trailer)) {
        if (combinado[clave] === undefined) combinado[clave] = valor;
      }
      trailer = combinado;
      const p = trailer.Prev ? Number(textoDe(trailer.Prev)) : 0;
      if (!p || previos.has(p)) break;
      previos.add(p);
      actual = p;
    }
  }
  if (!trailer?.Encrypt) throw new Aviso("Ese PDF no tiene contraseña.");
  return { buf, mapa, trailer };
}

function dictPlano(valor) {
  if (valor?.t === "dict") return valor.dict;
  return {};
}

export function datosCifrado(lectura) {
  const ref = lectura.trailer.Encrypt;
  if (!ref || ref.t !== "ref") throw new Aviso("Ese PDF está dañado o no se pudo leer.");
  const entrada = lectura.mapa.get(ref.num);
  if (entrada?.offset == null) throw new Aviso("Ese PDF está dañado o no se pudo leer.");
  const obj = leerObjeto(lectura.buf, entrada.offset);
  const dict = obj.dict || {};
  const norm = (v) => bytesDe(v);
  const cf = dictPlano(dict.CF && dict.CF.t === "dict" ? dict.CF.dict.StdCF : null);
  const cfm = textoDe(cf.CFM);
  const stmf = textoDe(dict.StmF) || (cfm ? "StdCF" : "");
  const strf = textoDe(dict.StrF) || (cfm ? "StdCF" : "");
  const V = numeroDe(dict.V);
  return {
    V,
    R: numeroDe(dict.R),
    longitud: dict.Length ? Math.max(5, Math.min(16, numeroDe(dict.Length) / 8)) : 16,
    O: norm(dict.O),
    U: norm(dict.U),
    OE: norm(dict.OE),
    UE: norm(dict.UE),
    P: numeroDe(dict.P),
    Perms: norm(dict.Perms),
    aesFlujos: V === 5 || ((stmf === "StdCF" || stmf === "AESV2") && (cfm === "AESV3" || cfm === "AESV2")),
    aesCadenas: V === 5 || ((strf === "StdCF" || strf === "AESV2") && (cfm === "AESV3" || cfm === "AESV2")),
    rc4Flujos: (V === 2 || V === 4) && stmf !== "Identity" && !((stmf === "StdCF" || stmf === "AESV2") && (cfm === "AESV3" || cfm === "AESV2")),
    rc4Cadenas: (V === 1 || V === 2 || V === 4) && strf !== "Identity" && !((strf === "StdCF" || strf === "AESV2") && (cfm === "AESV3" || cfm === "AESV2")),
    directo: V === 1,
    cifrarMetadatos: !dict.EncryptMetadata || textoDe(dict.EncryptMetadata) !== "false",
    id0: (() => {
      const id = lectura.trailer.ID;
      if (id?.t === "array" && id.items[0]) return bytesDe(id.items[0]);
      return Buffer.alloc(0);
    })(),
  };
}

function entradaOInversa(O, claveDuenio, longBytes) {
  let h = md5(rellenarClave(claveDuenio));
  for (let i = 0; i < 50; i += 1) h = md5(h);
  h = h.subarray(0, longBytes);
  let u = Buffer.from(O);
  for (let i = 19; i >= 0; i -= 1) u = rc4(xorLlave([...h], i), u);
  return u.subarray(0, 32);
}

export function autenticarCifrado(datos, clave) {
  const { V, R } = datos;
  if (V === 5 && R === 6) {
    const r = validarV5({ U: datos.U, UE: datos.UE, O: datos.O, OE: datos.OE, claveUsuario: clave, claveDuenio: clave });
    if (!r.ok) return null;
    return { llave: r.llave, v5: true, como: r.como };
  }
  if ((V === 1 || V === 2 || V === 4) && (R === 2 || R === 3 || R === 4)) {
    const n = V === 1 ? 5 : Math.min(16, Math.max(5, datos.longitud || 16));
    const id0 = datos.id0.length ? datos.id0 : Buffer.alloc(0);
    const meta = datos.cifrarMetadatos;
    const rondas = R >= 3;
    const probar = (usuario) => {
      const fileKey = claveV124(usuario, datos.O, datos.P, id0, n, meta, rondas);
      const uBien = R === 2
        ? entradaU(fileKey, id0, false).equals(datos.U)
        : entradaU(fileKey, id0, true).subarray(0, 16).equals(datos.U.subarray(0, 16));
      if (uBien) return { llave: fileKey, v5: false, rounds: R };
      return null;
    };
    const directo = probar(clave);
    if (directo) return directo;
    try {
      const dueno = entradaOInversa(datos.O, clave, n);
      const porDueno = probar(dueno);
      if (porDueno) return { ...porDueno, como: "duenio" };
    } catch {
      /* no abre */
    }
    return null;
  }
  throw new Aviso("Ese cifrado no se puede abrir (versión no soportada).");
}
// ---------- Desbloquear ----------

function esXRefDict(dict) {
  return textoDe(dict?.Type) === "XRef";
}

function esObjStmDict(dict) {
  return textoDe(dict?.Type) === "ObjStm";
}

function esMetadataDict(dict) {
  return textoDe(dict?.Type) === "Metadata" && textoDe(dict?.Subtype) === "XML";
}

function tieneCrypt(dict) {
  const filtros = [];
  const f = dict?.Filter;
  const lista = f?.t === "array" ? f.items : f ? [f] : [];
  for (const x of lista) filtros.push(textoDe(x));
  return filtros.includes("Crypt");
}

function descifrarEn(valor, fn) {
  if (!valor) return valor;
  if (valor.t === "hex" || valor.t === "str") {
    return { t: "hex", bytes: fn(valor.bytes) };
  }
  if (valor.t === "array") return { t: "array", items: valor.items.map((x) => descifrarEn(x, fn)) };
  if (valor.t === "dict") {
    const dict = {};
    for (const [k, v] of Object.entries(valor.dict)) dict[k] = descifrarEn(v, fn);
    return { t: "dict", dict };
  }
  return valor;
}

export async function desbloquearPdf(ruta, clave) {
  let bytes;
  try {
    bytes = fs.readFileSync(ruta);
  } catch {
    throw new Aviso("No pude leer ese PDF.");
  }
  const lectura = leerCifrado(bytes);
  const datos = datosCifrado(lectura);
  const sesion = autenticarCifrado(datos, String(clave || ""));
  if (!sesion) throw new Aviso("Esa contraseña no abre el PDF.");
  const numCifrado = lectura.trailer.Encrypt.num;
  const emitidos = [];
  const maxNum = Math.max(0, ...[...lectura.mapa.keys()]);

  const cadenaDe = (num, gen) => (contenido) => {
    if (datos.V === 5) return aesCbcDescifrar(sesion.llave, contenido.subarray(16), contenido.subarray(0, 16));
    if (datos.directo) return rc4(sesion.llave, contenido);
    if (!datos.rc4Cadenas && !datos.aesCadenas) return contenido;
    return descifrarObjetoV24(sesion.llave, num, gen, contenido, datos.aesCadenas);
  };

  const flujoDe = (num, gen) => (contenido) => {
    if (datos.V === 5) return aesCbcDescifrar(sesion.llave, contenido.subarray(16), contenido.subarray(0, 16));
    if (datos.directo) return rc4(sesion.llave, contenido);
    if (!datos.rc4Flujos && !datos.aesFlujos) return contenido;
    return descifrarObjetoV24(sesion.llave, num, gen, contenido, datos.aesFlujos);
  };

  const emitir = (num, gen, dict, flujo) => {
    if (flujo == null) {
      const cuerpo = dict
        ? `<<${Object.entries(dict).map(([k, v]) => `/${k} ${emitirValor(v, (b) => b)}`).join("")}>>`
        : "";
      emitidos.push([num, `${num} ${gen} obj\n${cuerpo}\nendobj\n`]);
      return;
    }
    const dictLimpio = { ...dict };
    dictLimpio.Length = { t: "numero", texto: String(flujo.length) };
    const cabecera = `<<${Object.entries(dictLimpio).map(([k, v]) => `/${k} ${emitirValor(v, (b) => b)}`).join("")}>>`;
    emitidos.push([num, `${num} ${gen} obj\n${cabecera}\nstream\n`, flujo, "\nendstream\nendobj\n"]);
  };

  const nums = [...lectura.mapa.keys()].sort((a, b) => a - b);
  for (const num of nums) {
    if (num === numCifrado || num === 0) continue;
    const entrada = lectura.mapa.get(num);
    if (entrada.offset == null) continue;
    const obj = leerObjeto(lectura.buf, entrada.offset);
    const dict = obj.dict || {};
    if (esXRefDict(dict)) continue;
    if (esObjStmDict(dict)) {
      // El flujo trae objetos lógicos: se descifra, se expande y cada uno
      // sale como indirecto normal.
      let crudo;
      try {
        crudo = flujoDe(num, obj.gen)(obj.flujo);
      } catch {
        throw new Aviso("Ese PDF está dañado o no se pudo leer.");
      }
      let decodificado;
      try {
        decodificado = decodificarFlujo(crudo, dict).datos;
      } catch {
        throw new Aviso("Ese PDF está dañado o no se pudo leer.");
      }
      const n = Number(textoDe(dict.N));
      const primero = Number(textoDe(dict.First));
      const cabecera = decodificado.subarray(0, primero).toString("latin1").trim().split(/\s+/).map(Number);
      for (let q = 0; q < n; q += 1) {
        const subNum = cabecera[q * 2];
        const subOff = primero + cabecera[q * 2 + 1];
        let j = subOff;
        while (j < decodificado.length && esEspacio(decodificado[j])) j += 1;
        let plano;
        try {
          plano = descifrarEn(leerValor(decodificado, j).valor, cadenaDe(subNum, 0));
        } catch {
          throw new Aviso("Ese PDF está dañado o no se pudo leer.");
        }
        if (plano.t === "dict") emitir(subNum, 0, plano.dict, null);
        else emitidos.push([subNum, `${subNum} 0 obj\n${emitirValor(plano, (b) => b)}\nendobj\n`]);
      }
      continue;
    }
    if (obj.flujo != null) {
      if (tieneCrypt(dict) || (esMetadataDict(dict) && !datos.cifrarMetadatos)) {
        emitir(num, obj.gen, dict, obj.flujo);
        continue;
      }
      let contenido;
      try {
        contenido = flujoDe(num, obj.gen)(obj.flujo);
      } catch {
        throw new Aviso("Ese PDF está dañado o no se pudo leer.");
      }
      const plano = {};
      for (const [k, v] of Object.entries(dict)) {
        plano[k] = k === "Length" ? v : descifrarEn(v, cadenaDe(num, obj.gen));
      }
      emitir(num, obj.gen, plano, contenido);
      continue;
    }
    if (!obj.dict) continue;
    const plano = {};
    for (const [k, v] of Object.entries(obj.dict)) plano[k] = descifrarEn(v, cadenaDe(num, obj.gen));
    emitir(num, obj.gen, plano, null);
  }

  emitidos.sort((a, b) => a[0] - b[0]);
  const salida = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = new Map();
  const tamano = () => salida.reduce((s, b) => s + b.length, 0);
  for (const [num, ...partes] of emitidos) {
    offsets.set(num, tamano());
    for (const p of partes) salida.push(Buffer.isBuffer(p) ? p : Buffer.from(p, "latin1"));
  }
  const inicioXref = tamano();
  const maximo = Math.max(maxNum, ...emitidos.map(([n]) => n));
  const tabla = [`xref\n0 ${maximo + 1}\n`, "0000000000 65535 f \n"];
  for (let n = 1; n <= maximo; n += 1) {
    if (offsets.has(n)) tabla.push(`${String(offsets.get(n)).padStart(10, "0")} 00000 n \n`);
    else tabla.push("0000000000 65535 f \n");
  }
  const raiz = lectura.trailer.Root;
  const info = lectura.trailer.Info;
  const idOriginal = lectura.trailer.ID?.t === "array" && lectura.trailer.ID.items[0]
    ? emitirValor(lectura.trailer.ID.items[0], (b) => b)
    : "<00000000000000000000000000000000>";
  salida.push(Buffer.from(tabla.join(""), "latin1"));
  salida.push(Buffer.from(
    `trailer\n<< /Size ${maximo + 1} /Root ${raiz.num} ${raiz.gen} R${info ? ` /Info ${info.num} ${info.gen} R` : ""} /ID [${idOriginal} ${idOriginal}] >>\nstartxref\n${inicioXref}\n%%EOF`,
    "latin1",
  ));
  return Buffer.concat(salida);
}
