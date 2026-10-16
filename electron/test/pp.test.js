import assert from "node:assert/strict";
import test from "node:test";
import {
  deptoDe,
  extraerDocumentos,
  extraerFilas,
  muniDe,
  totalDe,
} from "../compartido/pp.js";

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
