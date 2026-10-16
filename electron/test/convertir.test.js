import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  calidadTexto, esConvertible, limpiarTexto, necesitaOcr, quitarRepetidos, tablaMarkdown, trocearMarkdown, encabezadoYaml, quitarEncabezado, citaDeTrozo,
} from "../compartido/convertir.js";
import { convertirRuta, pngDesdePixeles } from "../src/convertir/convertidores.js";
import { estadoOcr } from "../src/convertir/ocr.js";
import { textoDePdf } from "../src/pdftexto.js";

const corpus = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus");
const ocrDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".ocr");
const sinOcr = fs.mkdtempSync(path.join(os.tmpdir(), "vig-sin-ocr-"));

// Ninguna conversión puede usar la red.
function sinRed(fn) {
  return async (t) => {
    const original = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("La conversión intentó usar la red");
    };
    try {
      await fn(t);
    } finally {
      globalThis.fetch = original;
    }
  };
}

test("limpieza: títulos jurídicos, guiones y números de página", () => {
  const md = limpiarTexto("ANTECEDENTES\nEl accio-\nnante pidió\nla protección.\n\n12\nRESUELVE:\n1. Conceder");
  assert.match(md, /## ANTECEDENTES/);
  assert.match(md, /accionante pidió la protección\./);
  assert.match(md, /## RESUELVE/);
  assert.doesNotMatch(md, /^12$/m);
});

test("calidad baja pide OCR", () => {
  assert.ok(necesitaOcr(""));
  assert.ok(necesitaOcr("\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019"));
  assert.ok(!necesitaOcr("La Corte reitera que el derecho a la salud es fundamental."));
  assert.ok(calidadTexto("texto normal") > 0.9);
});

test("membretes repetidos se quitan", () => {
  const p = ["CORTE SUPREMA\nuno\nPágina 1", "CORTE SUPREMA\ndos\nPágina 2", "CORTE SUPREMA\ntres\nPágina 3"];
  const r = quitarRepetidos(p);
  assert.deepEqual(r.map((x) => x.trim()), ["uno", "dos", "tres"]);
});

test("tabla Markdown con límite de filas", () => {
  const t = tablaMarkdown([["a", "b"], ["1", "x|y"], ["2", "z"]], { maxFilas: 1 });
  assert.match(t, /\| a \| b \|/);
  assert.match(t, /x\\\|y/);
  assert.match(t, /Se omitieron 1 filas/);
});

test("troceo con página y título para citar", () => {
  const md = `${encabezadoYaml({ titulo: "T-1" })}<!-- pagina 1 -->\n\n## HECHOS\n\nUno.\n\n<!-- pagina 2 -->\n\n## RESUELVE\n\n${"Conceder. ".repeat(200)}`;
  const trozos = trocearMarkdown(md, { tamano: 500 });
  assert.equal(trozos[0].pagina, 1);
  assert.equal(trozos[0].titulo, "HECHOS");
  assert.ok(trozos.some((t) => t.pagina === 2 && t.titulo === "RESUELVE"));
  assert.ok(trozos.every((t) => t.texto.length <= 760));
  assert.equal(quitarEncabezado(md).startsWith("<!--"), true);
  assert.equal(citaDeTrozo({ nombre: "T-1.pdf", pagina: 2 }), "[T-1.pdf, página 2]");
});

test("extensiones aceptadas", () => {
  for (const n of ["a.pdf", "b.DOCX", "c.xlsx", "d.ods", "e.csv", "f.html", "g.txt", "h.md", "i.png", "j.jpg"]) assert.ok(esConvertible(n), n);
  assert.ok(!esConvertible("x.exe"));
});

test("PDF de texto: el lector nuevo lee lo que el viejo no", sinRed(async () => {
  const ruta = path.join(corpus, "texto.pdf");
  assert.equal(textoDePdf(fs.readFileSync(ruta)).ok, false);
  const r = await convertirRuta(ruta, { datosDir: sinOcr });
  assert.equal(r.motor, "pdfjs");
  assert.equal(r.paginas, 1);
  assert.match(r.markdown, /<!-- pagina 1 -->/);
  assert.match(r.markdown, /## ANTECEDENTES/);
  assert.match(r.markdown, /derecho fundamental a la salud/);
  assert.match(r.markdown, /Ñandú, acción, corazón/);
}));

test("PDF con fuente CID (Identity-H) da texto", sinRed(async () => {
  const r = await convertirRuta(path.join(corpus, "cid.pdf"), { datosDir: sinOcr });
  assert.match(r.markdown, /SALA DE CASACION LABORAL/);
  assert.match(r.markdown, /pension de vejez/);
  assert.equal(r.aviso, "");
}));

test("PDF escaneado sin OCR instalado dice cómo activarlo", sinRed(async () => {
  const r = await convertirRuta(path.join(corpus, "escaneado.pdf"), { datosDir: sinOcr });
  assert.match(r.aviso, /Modelos de IA/);
  await assert.rejects(convertirRuta(path.join(corpus, "escaneo.png"), { datosDir: sinOcr }), /Instalar OCR/);
}));

const hayOcr = fs.existsSync(path.join(ocrDir, "spa.traineddata.gz"));
test("PDF escaneado e imagen con OCR en español, sin red", { skip: hayOcr ? false : "falta test/.ocr/spa.traineddata.gz" }, sinRed(async () => {
  process.env.VIGENCIA_OCR_DIR = ocrDir;
  try {
    assert.ok(estadoOcr(sinOcr).listo);
    const r = await convertirRuta(path.join(corpus, "escaneado.pdf"), { datosDir: sinOcr });
    assert.equal(r.paginasOcr, 1);
    assert.match(r.markdown, /JUZGADO PRIMERO CIVIL/);
    assert.match(r.markdown, /admite la demanda/i);
    const img = await convertirRuta(path.join(corpus, "escaneo.png"), { datosDir: sinOcr });
    assert.match(img.markdown, /apoderado/);
  } finally {
    delete process.env.VIGENCIA_OCR_DIR;
  }
}));

test("Word, CSV, HTML, texto y Markdown", sinRed(async () => {
  const docx = await convertirRuta(path.join(corpus, "sentencia.docx"));
  assert.match(docx.markdown, /CONCEDER el amparo/);
  const csv = await convertirRuta(path.join(corpus, "procesos.csv"));
  assert.match(csv.markdown, /\| radicado \| despacho \| estado \|/);
  const html = await convertirRuta(path.join(corpus, "concepto.html"));
  assert.match(html.markdown, /^# Concepto/);
  assert.match(html.markdown, /\*\*plazo\*\*/);
  const txt = await convertirRuta(path.join(corpus, "sentencia.txt"));
  assert.match(txt.markdown, /## RESUELVE/);
}));

test("Excel con dos hojas", sinRed(async () => {
  const { createRequire } = await import("node:module");
  const XLSX = createRequire(import.meta.url)("xlsx");
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([["Radicado", "Valor"], ["1100", 2500]]), "Procesos");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([["Cliente"], ["Ana"]]), "Clientes");
  const ruta = path.join(sinOcr, "libro.xlsx");
  XLSX.writeFile(libro, ruta);
  const r = await convertirRuta(ruta);
  assert.match(r.markdown, /## Procesos/);
  assert.match(r.markdown, /\| 1100 \| 2500 \|/);
  assert.match(r.markdown, /## Clientes/);
}));

test("PNG mínimo válido", () => {
  const png = pngDesdePixeles({ width: 2, height: 1, data: new Uint8Array([0, 255]), canales: 1 });
  assert.equal(png.subarray(1, 4).toString(), "PNG");
});
