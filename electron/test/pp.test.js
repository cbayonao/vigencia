import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  coincideBusqueda,
  deptoDe,
  especialidadDe,
  extraerDocumentos,
  extraerFilas,
  muniDe,
  nombreArchivoPdf,
  rangoPaginas,
  tipoDe,
  totalDe,
} from "../compartido/pp.js";

test("el rango trae solo las últimas 5 páginas", () => {
  assert.deepEqual(rangoPaginas(1147), { inicio: 111, fin: 115, total: 115 });
  assert.deepEqual(rangoPaginas(30), { inicio: 1, fin: 3, total: 3 });
  assert.deepEqual(rangoPaginas(0), { inicio: 1, fin: 1, total: 1 });
});

test("el nombre para guardar es seguro y termina en pdf", () => {
  assert.equal(nombreArchivoPdf("Estado 182.pdf"), "Estado 182.pdf");
  assert.equal(nombreArchivoPdf("Aviso: 01/02"), "Aviso 0102.pdf");
  assert.equal(nombreArchivoPdf(""), "documento.pdf");
});

test("la búsqueda avanzada no depende del orden ni de las tildes", () => {
  const base = "110013103001 - JUZGADO 001 CIVIL DEL CIRCUITO DE BOGOTÁ";
  assert.equal(coincideBusqueda(base, "civil bogota 001"), true);
  assert.equal(coincideBusqueda(base, "bogotá circuito juzgado"), true);
  assert.equal(coincideBusqueda(base, "civil penal"), false);
  assert.equal(coincideBusqueda(base, "  "), true);
  assert.equal(coincideBusqueda(base, "110013103001"), true);
});

test("tipo y especialidad salen del nombre para segmentar", () => {
  assert.equal(tipoDe("050002204000 - SALA PENAL DEL TRIBUNAL SUPERIOR DE ANTIOQUIA"), "Tribunales");
  assert.equal(tipoDe("050014003001 - JUZGADO 001 CIVIL MUNICIPAL DE MEDELLÍN"), "Juzgados");
  assert.equal(tipoDe("080011398001 - CONSEJO SECCIONAL DE LA JUDICATURA DE ATLÁNTICO"), "Cortes y consejos");
  assert.equal(tipoDe("080011200000 - DIRECCIÓN SECCIONAL DE ADMINISTRACIÓN JUDICIAL"), "Otros");
  assert.equal(especialidadDe("050014003001 - JUZGADO 001 CIVIL MUNICIPAL DE MEDELLÍN"), "Civil");
  assert.equal(especialidadDe("050003107001 - JUZGADO 001 PENAL DE CIRCUITO ESPECIALIZADO"), "Penal");
  assert.equal(especialidadDe("080012502000 - SECRETARÍA DE LA COMISIÓN SECCIONAL DE DISCIPLINA"), "Disciplinario");
  assert.equal(especialidadDe("080011200000 - DIRECCIÓN SECCIONAL DE ADMINISTRACIÓN JUDICIAL"), "Otra");
});

test("el municipio y el departamento salen del código", () => {
  assert.equal(muniDe("050002204000"), "05000");
  assert.equal(muniDe("110012203015"), "11001");
  assert.equal(deptoDe("110012203015"), "11");
  assert.equal(muniDe("corto"), "");
});

const FILA = `<tr class=" col-xs-12 tramites " > <td><div class="titulo-publicacion"><a href="https://x/inicio?a=1&amp;b=2" title="Ver Aviso 1"> Aviso 1 </a></div><div class="categorias-resumen"><span class="categoria-ep">Tipo de publicación:Notificaciones por Estados</span><span class="categoria-ep">Despacho:050002204000 - SALA PENAL</span></div><div class="fecha-pub"><p class="publish-date"><i>Fecha:</i> 2026-10-15</p></div><div class="boton-detalle"><a href="https://x/det?articleId=99">Ver detalle</a></div></td></tr>`;

test("la fila trae título, urls, etiquetas y fecha", () => {
  const filas = extraerFilas(`<table>${FILA}${FILA.replace("Aviso 1", "Aviso 2")}</table>`);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].titulo, "Aviso 1");
  assert.equal(filas[0].url, "https://x/inicio?a=1&b=2");
  assert.equal(filas[0].detalle_url, "https://x/det?articleId=99");
  assert.equal(filas[0].article_id, "99");
  assert.equal(filas[0].categorias["Tipo de publicación"], "Notificaciones por Estados");
  assert.equal(filas[0].fecha, "2026-10-15");
});

test("el total sale del intervalo", () => {
  assert.equal(totalDe("Mostrando el intervalo 1 - 10 de 1.147 resultados."), 1147);
  assert.equal(totalDe("sin nada"), 0);
});

const TABLA = `<table id="tabla-docs-1-0"><thead><tr><th>Nombre del Documento</th><th>Fecha Incorporación</th></tr></thead><tbody><tr><td><a href="/c/document_library/get_file?uuid=abc&groupId=1"> Estado 182.pdf </a></td><td>15-oct-2026 16:33:41</td></tr></tbody></table>`;
const RESUMEN = `<div class="datosDescription"><div class="datosTitle"><b>Fecha de publicación</b></div><div class="datosDescription"><p>06 jun 2025</p></div></div><div class="my-3 resumen-publicacion col-md-12"><p><a href="/documents/1/2/AVISO.pdf/x?t=1"><strong>AVISO</strong></a></p></div><table id="tabla-docs-1-0"><thead><tr><th>Nombre del Documento</th></tr></thead></table><p><a href="https://x/infografia">Ver Instructivo</a></p>`;

test("los documentos salen de la tabla o del resumen, sin el chrome", () => {
  const tabla = extraerDocumentos(TABLA);
  assert.equal(tabla.length, 1);
  assert.equal(tabla[0].nombre, "Estado 182.pdf");
  assert.equal(tabla[0].fecha, "15-oct-2026 16:33:41");
  assert.equal(tabla[0].origen, "tabla");
  const resumen = extraerDocumentos(RESUMEN);
  assert.equal(resumen.length, 1);
  assert.equal(resumen[0].fecha, "06 jun 2025");
  assert.equal(resumen[0].origen, "resumen");
});

import http from "node:http";
import { crearSesion, traerPdf } from "../src/pp.js";

test("trae el pdf a memoria con la sesión y rechaza html", async () => {
  const pdf = Buffer.from("%PDF-1.4 falso");
  const servidor = http.createServer((req, res) => {
    if (req.url === "/doc.pdf") {
      res.writeHead(200, { "content-type": "application/pdf", "set-cookie": "JSESSIONID=abc; Path=/" });
      res.end(pdf);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>login</html>");
    }
  });
  await new Promise((resolver) => servidor.listen(0, resolver));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const sesion = crearSesion();
    const ok = await traerPdf(sesion, `${base}/doc.pdf`);
    assert.deepEqual(ok.bytes, pdf);
    assert.equal(sesion.cookies.includes("JSESSIONID=abc"), true);
    await assert.rejects(() => traerPdf(sesion, `${base}/login`), /sesión no abrió/);
  } finally {
    servidor.close();
  }
});

import { FRECUENCIAS_SISTEMAS, abrirBase as abrirBaseDb, guardarFrecuenciaSistemas, leerFrecuenciaSistemas } from "../src/db.js";

test("la frecuencia transversal trae valor y rechaza otros", () => {
  assert.deepEqual(FRECUENCIAS_SISTEMAS, [0, 12, 24, 48]);
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vigencia-frec-")), "base.sqlite");
  const db = abrirBaseDb(ruta);
  assert.equal(leerFrecuenciaSistemas(db), 24);
  assert.equal(guardarFrecuenciaSistemas(db, 12), 12);
  assert.equal(leerFrecuenciaSistemas(db), 12);
  assert.throws(() => guardarFrecuenciaSistemas(db, 7), /Frecuencia/);
  db.close();
});
