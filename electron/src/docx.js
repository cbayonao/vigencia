import { deflateRawSync, inflateRawSync } from "node:zlib";

const TABLA = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(datos) {
  let c = 0xffffffff;
  for (const byte of datos) c = TABLA[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function xml(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function zip(archivos) {
  const locales = [];
  const centrales = [];
  let offset = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const name = Buffer.from(nombre);
    const raw = Buffer.from(contenido);
    const comp = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locales.push(local, comp);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrales.push(central);
    offset += local.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrales);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrales.length, 8);
  end.writeUInt16LE(centrales.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, centralBuf, end]);
}

function parrafo(texto, estilo) {
  const marca = estilo ? `<w:pPr><w:pStyle w:val="${estilo}"/></w:pPr>` : "";
  return `<w:p>${marca}<w:r><w:t xml:space="preserve">${xml(texto)}</w:t></w:r></w:p>`;
}

const TITULOS_DE_CARTA = new Set([
  "Destinatario", "Referencia", "Presentación", "Antecedentes", "Hechos",
  "Fundamentos", "Peticiones", "Pruebas", "Anexos", "Notificaciones",
  "Cuerpo", "Cierre", "Escrito",
]);

function documentoXml(escrito) {
  const bloques = [];
  for (const seccion of escrito.secciones || []) {
    if (seccion.titulo && !TITULOS_DE_CARTA.has(seccion.titulo)) bloques.push(parrafo(seccion.titulo, "Seccion"));
    for (const linea of seccion.parrafos || []) bloques.push(parrafo(linea));
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bloques.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418" w:header="720" w:footer="720"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

const TIPOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Titulo">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="200"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Seccion">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="280" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
</w:styles>`;

export function textoDeDocx(datos) {
  const buffer = Buffer.isBuffer(datos) ? datos : Buffer.from(datos || []);
  if (buffer.length > 2_000_000) return { ok: false, error: "El Word es demasiado grande. Use uno de menos de 2 MB." };
  if (buffer.length < 30 || buffer.readUInt32LE(0) !== 0x04034b50) {
    return { ok: false, error: "Ese archivo no es un Word .docx." };
  }
  let xml = "";
  try {
    xml = unzip(buffer)["word/document.xml"] || "";
  } catch {
    return { ok: false, error: "No pude leer ese Word." };
  }
  if (!xml) return { ok: false, error: "Ese Word no trae el texto del memorial." };
  const plano = String(xml)
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, numero) => String.fromCodePoint(Number(numero)))
    .replace(/&amp;/g, "&");
  const limpio = plano.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!limpio) return { ok: false, error: "Ese Word no tiene texto." };
  return { ok: true, texto: limpio.slice(0, 30000) };
}

function finDirectorio(buffer) {
  const minimo = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= minimo; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function leerParte(buffer, metodo, inicio, comp) {
  if (inicio < 0 || comp < 0 || inicio + comp > buffer.length) return "";
  const crudo = buffer.subarray(inicio, inicio + comp);
  const datos = metodo === 0 ? crudo : inflateRawSync(crudo);
  return datos.toString("utf8");
}

// Word deja el tamaño en cero en cada archivo y lo escribe en el directorio central.
function unzip(buffer) {
  const fin = finDirectorio(buffer);
  if (fin < 0) return unzipLocal(buffer);
  const total = buffer.readUInt16LE(fin + 10);
  let cursor = buffer.readUInt32LE(fin + 16);
  const archivos = {};
  for (let n = 0; n < total && cursor + 46 <= buffer.length; n += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const metodo = buffer.readUInt16LE(cursor + 10);
    const comp = buffer.readUInt32LE(cursor + 20);
    const nombreLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const comentario = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    const nombre = buffer.subarray(cursor + 46, cursor + 46 + nombreLen).toString("utf8");
    if (local + 30 <= buffer.length) {
      const localNombre = buffer.readUInt16LE(local + 26);
      const localExtra = buffer.readUInt16LE(local + 28);
      const datosInicio = local + 30 + localNombre + localExtra;
      try {
        archivos[nombre] = leerParte(buffer, metodo, datosInicio, comp);
      } catch {
        /* una parte dañada no impide leer el memorial */
      }
    }
    cursor += 46 + nombreLen + extraLen + comentario;
  }
  return archivos;
}

function unzipLocal(buffer) {
  const archivos = {};
  let cursor = 0;
  while (cursor + 30 <= buffer.length && buffer.readUInt32LE(cursor) === 0x04034b50) {
    const metodo = buffer.readUInt16LE(cursor + 8);
    const comp = buffer.readUInt32LE(cursor + 18);
    const nombreLen = buffer.readUInt16LE(cursor + 26);
    const extra = buffer.readUInt16LE(cursor + 28);
    const inicio = cursor + 30 + nombreLen + extra;
    if (!comp || inicio + comp > buffer.length) break;
    const nombre = buffer.subarray(cursor + 30, cursor + 30 + nombreLen).toString("utf8");
    try {
      archivos[nombre] = leerParte(buffer, metodo, inicio, comp);
    } catch {
      break;
    }
    cursor = inicio + comp;
  }
  return archivos;
}

export function docxDeEscrito(escrito) {
  return zip({
    "[Content_Types].xml": TIPOS,
    "_rels/.rels": RELS,
    "word/_rels/document.xml.rels": DOC_RELS,
    "word/styles.xml": ESTILOS,
    "word/document.xml": documentoXml(escrito),
  });
}
