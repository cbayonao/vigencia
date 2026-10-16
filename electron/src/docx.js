import { deflateRawSync, inflateRawSync } from "node:zlib";
import { leerParrafo, tramos } from "../compartido/formato.js";

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
    // ODT exige el archivo mimetype primero y sin comprimir.
    const guardado = nombre === "mimetype";
    const comp = guardado ? raw : deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(guardado ? 0 : 8, 8);
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
    central.writeUInt16LE(guardado ? 0 : 8, 10);
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


export const PIE_IA = "Generado con IA. Favor revisar.";

// Párrafos con formato (ver compartido/formato.js): negrita, itálica,
// subrayado, alineación, subtítulo, cita, viñeta, numeral y tabla.
export { tramos };

const JC = { centro: "center", derecha: "right", izquierda: "left", justificado: "both" };

function runs(texto) {
  return tramos(texto).map((r) => {
    const marcas = `${r.negrita ? "<w:b/>" : ""}${r.italica ? "<w:i/>" : ""}${r.subrayado ? '<w:u w:val="single"/>' : ""}`;
    return `<w:r>${marcas ? `<w:rPr>${marcas}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(r.texto)}</w:t></w:r>`;
  }).join("");
}

function tablaDocx(filas) {
  const ancho = Math.max(1, ...filas.map((f) => f.length));
  const borde = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="8FA5BA"/><w:left w:val="single" w:sz="4" w:color="8FA5BA"/><w:bottom w:val="single" w:sz="4" w:color="8FA5BA"/><w:right w:val="single" w:sz="4" w:color="8FA5BA"/><w:insideH w:val="single" w:sz="4" w:color="8FA5BA"/><w:insideV w:val="single" w:sz="4" w:color="8FA5BA"/></w:tblBorders>';
  const grid = `<w:tblGrid>${Array(ancho).fill(`<w:gridCol w:w="${Math.floor(9600 / ancho)}"/>`).join("")}</w:tblGrid>`;
  const cuerpo = filas.map((f, i) => `<w:tr>${Array.from({ length: ancho }, (_, k) => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9600 / ancho)}" w:type="dxa"/>${i === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF2F6"/>' : ""}</w:tcPr><w:p><w:pPr><w:pStyle w:val="Celda"/></w:pPr>${runs(i === 0 ? `**${f[k] ?? ""}**` : f[k] ?? "")}</w:p></w:tc>`).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borde}</w:tblPr>${grid}${cuerpo}</w:tbl><w:p/>`;
}

function parrafo(texto, estilo) {
  if (estilo) return `<w:p><w:pPr><w:pStyle w:val="${estilo}"/></w:pPr>${runs(texto)}</w:p>`;
  const p = leerParrafo(texto);
  if (p.tipo === "tabla") return tablaDocx(p.filas);
  const est = { subtitulo: "Subtitulo", cita: "Cita", vineta: "Lista", numeral: "Lista", firma: "Firma" }[p.tipo] || "";
  const pre = p.tipo === "vineta" ? "\u2022\t" : p.tipo === "numeral" ? `${p.numero}.\t` : "";
  const jc = JC[p.alineacion] ? `<w:jc w:val="${JC[p.alineacion]}"/>` : "";
  const ppr = est || jc ? `<w:pPr>${est ? `<w:pStyle w:val="${est}"/>` : ""}${jc}</w:pPr>` : "";
  return `<w:p>${ppr}${pre ? `<w:r><w:t xml:space="preserve">${pre}</w:t></w:r>` : ""}${runs(p.texto)}</w:p>`;
}

const TITULOS_DE_CARTA = new Set([
  "Destinatario", "Referencia", "Presentación", "Antecedentes", "Hechos",
  "Fundamentos", "Peticiones", "Pruebas", "Anexos", "Notificaciones",
  "Cuerpo", "Cierre", "Escrito",
]);

function documentoXml(escrito, { pie = true } = {}) {
  const bloques = [];
  for (const seccion of escrito.secciones || []) {
    if (seccion.titulo && !TITULOS_DE_CARTA.has(seccion.titulo)) bloques.push(parrafo(seccion.titulo, "Seccion"));
    for (const linea of seccion.parrafos || []) bloques.push(parrafo(linea));
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bloques.join("\n    ")}
    <w:sectPr>
      ${pie ? '<w:footerReference w:type="default" r:id="rId2"/>' : ""}
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
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`;

// Pie normal de Word: se borra con doble clic en el pie de página.
const PIE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:pStyle w:val="Pie"/><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">${PIE_IA}</w:t></w:r></w:p>
</w:ftr>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

const DOC_RELS_SIN_PIE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:jc w:val="both"/><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
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
  <w:style w:type="paragraph" w:styleId="Lista">
    <w:name w:val="List Paragraph"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitulo">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/></w:pPr>
    <w:rPr><w:b/><w:i/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Cita">
    <w:name w:val="Quote"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="1134" w:right="567"/><w:jc w:val="both"/><w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:i/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Firma">
    <w:name w:val="Signature"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:jc w:val="center"/><w:spacing w:before="480"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Celda">
    <w:name w:val="Table Contents"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="40" w:after="40"/><w:jc w:val="left"/></w:pPr>
    <w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Pie">
    <w:name w:val="footer"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:i/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
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

export function docxDeEscrito(escrito, { pie = true } = {}) {
  const partes = {
    "[Content_Types].xml": pie ? TIPOS : TIPOS.replace(/\n  <Override PartName="\/word\/footer1.xml"[^\n]*/, ""),
    "_rels/.rels": RELS,
    "word/_rels/document.xml.rels": pie ? DOC_RELS : DOC_RELS_SIN_PIE,
    "word/styles.xml": ESTILOS,
    "word/document.xml": documentoXml(escrito, { pie }),
  };
  if (pie) partes["word/footer1.xml"] = PIE_XML;
  return zip(partes);
}

// ---------- OpenDocument (.odt) para LibreOffice ----------

function spansOdt(texto) {
  return tramos(texto).map((r) => {
    const n = `${r.negrita ? "N" : ""}${r.italica ? "I" : ""}${r.subrayado ? "U" : ""}`;
    return n ? `<text:span text:style-name="T${n}">${xml(r.texto)}</text:span>` : xml(r.texto);
  }).join("");
}

const AL_ODT = { centro: "Centro", derecha: "Derecha", izquierda: "Izquierda", justificado: "" };

function parrafoOdt(texto, estilo) {
  if (estilo) {
    const spans = spansOdt(texto);
    return estilo === "Seccion" ? `<text:h text:style-name="Seccion" text:outline-level="1">${spans}</text:h>` : `<text:p text:style-name="${estilo}">${spans}</text:p>`;
  }
  const p = leerParrafo(texto);
  if (p.tipo === "tabla") {
    const ancho = Math.max(1, ...p.filas.map((f) => f.length));
    const filas = p.filas.map((f, i) => `<table:table-row>${Array.from({ length: ancho }, (_, k) => `<table:table-cell table:style-name="Celda" office:value-type="string"><text:p text:style-name="${i === 0 ? "CeldaCab" : "CeldaTexto"}">${spansOdt(f[k] ?? "")}</text:p></table:table-cell>`).join("")}</table:table-row>`).join("");
    return `<table:table table:style-name="Tabla"><table:table-column table:number-columns-repeated="${ancho}"/>${filas}</table:table>`;
  }
  const spans = spansOdt(p.texto);
  if (p.tipo === "subtitulo") return `<text:h text:style-name="Subtitulo" text:outline-level="2">${spans}</text:h>`;
  const base = { cita: "Cita", vineta: "Lista", numeral: "Lista", firma: "Firma" }[p.tipo] || "Cuerpo";
  const est = AL_ODT[p.alineacion] && p.tipo !== "firma" ? `${base}${AL_ODT[p.alineacion]}` : base;
  const pre = p.tipo === "vineta" ? "\u2022 " : p.tipo === "numeral" ? `${p.numero}. ` : "";
  return `<text:p text:style-name="${est}">${xml(pre)}${spans}</text:p>`;
}

function estilosAlineadosOdt() {
  const lados = { Centro: "center", Derecha: "end", Izquierda: "start" };
  return ["Cuerpo", "Cita", "Lista"].flatMap((b) => Object.entries(lados).map(([n, v]) => `<style:style style:name="${b}${n}" style:family="paragraph" style:parent-style-name="${b}"><style:paragraph-properties fo:text-align="${v}"/></style:style>`)).join("\n    ");
}

export function odtDeEscrito(escrito, { pie = true } = {}) {
  const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.3"';
  const cuerpo = [];
  if (escrito.asunto) cuerpo.push(`<text:p text:style-name="Titulo">${xml(escrito.asunto)}</text:p>`);
  for (const seccion of escrito.secciones || []) {
    if (seccion.titulo && !TITULOS_DE_CARTA.has(seccion.titulo)) cuerpo.push(parrafoOdt(seccion.titulo, "Seccion"));
    for (const linea of seccion.parrafos || []) cuerpo.push(parrafoOdt(linea));
  }
  const contenido = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${ns}>
  <office:automatic-styles>
    ${["N", "I", "U", "NI", "NU", "IU", "NIU"].map((n) => `<style:style style:name="T${n}" style:family="text"><style:text-properties${n.includes("N") ? ' fo:font-weight="bold"' : ""}${n.includes("I") ? ' fo:font-style="italic"' : ""}${n.includes("U") ? ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"' : ""}/></style:style>`).join("\n    ")}
    <style:style style:name="Tabla" style:family="table"><style:table-properties style:width="16.5cm" table:align="margins"/></style:style>
    <style:style style:name="Celda" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #8fa5ba"/></style:style>
  </office:automatic-styles>
  <office:body><office:text>
    ${cuerpo.join("\n    ")}
  </office:text></office:body>
</office:document-content>`;
  const estilos = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${ns}>
  <office:styles>
    <style:style style:name="Cuerpo" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.2cm" fo:text-align="justify"/><style:text-properties fo:font-size="11pt"/></style:style>
    <style:style style:name="Titulo" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.35cm"/><style:text-properties fo:font-size="16pt" fo:font-weight="bold"/></style:style>
    <style:style style:name="Seccion" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.5cm" fo:margin-bottom="0.15cm"/><style:text-properties fo:font-size="12pt" fo:font-weight="bold"/></style:style>
    <style:style style:name="Lista" style:family="paragraph" style:parent-style-name="Cuerpo"><style:paragraph-properties fo:margin-left="1cm" fo:text-indent="-0.5cm"/></style:style>
    <style:style style:name="Subtitulo" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.35cm" fo:margin-bottom="0.1cm"/><style:text-properties fo:font-size="11pt" fo:font-weight="bold" fo:font-style="italic"/></style:style>
    <style:style style:name="Cita" style:family="paragraph" style:parent-style-name="Cuerpo"><style:paragraph-properties fo:margin-left="2cm" fo:margin-right="1cm"/><style:text-properties fo:font-size="10pt" fo:font-style="italic"/></style:style>
    <style:style style:name="Firma" style:family="paragraph" style:parent-style-name="Cuerpo"><style:paragraph-properties fo:text-align="center" fo:margin-top="0.8cm"/></style:style>
    <style:style style:name="CeldaTexto" style:family="paragraph"><style:text-properties fo:font-size="10pt"/></style:style>
    <style:style style:name="CeldaCab" style:family="paragraph"><style:text-properties fo:font-size="10pt" fo:font-weight="bold"/></style:style>
    ${estilosAlineadosOdt()}
    <style:style style:name="Pie" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="9pt" fo:font-style="italic"/></style:style>
  </office:styles>
  <office:automatic-styles>
    <style:page-layout style:name="Hoja"><style:page-layout-properties fo:page-width="21.59cm" fo:page-height="27.94cm" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2.5cm" fo:margin-right="2cm"/>${pie ? '<style:footer-style><style:header-footer-properties fo:min-height="0.6cm" fo:margin-top="0.3cm"/></style:footer-style>' : ""}</style:page-layout>
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="Standard" style:page-layout-name="Hoja">${pie ? `<style:footer><text:p text:style-name="Pie">${PIE_IA}</text:p></style:footer>` : ""}</style:master-page>
  </office:master-styles>
</office:document-styles>`;
  const manifiesto = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
  return zip({
    mimetype: "application/vnd.oasis.opendocument.text",
    "content.xml": contenido,
    "styles.xml": estilos,
    "META-INF/manifest.xml": manifiesto,
  });
}
