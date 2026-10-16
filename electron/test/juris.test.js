import test from "node:test";
import assert from "node:assert/strict";
import {
  FUENTES_JURIS, corporacionesDe, desentizar, etiquetasFuente, extraerAspx,
  extraerUpdate, extraerViewStateCSJ, filasCSJ, fuenteDe, itemsCE,
  nombreFuente, normalizarCCC, panelDe, textoDeHtml, totalCSJ, validarBusqueda,
} from "../compartido/juris.js";

const CSJ_XML = `<?xml version='1.0' encoding='UTF-8'?>
<partial-response><changes>
<update id="resultForm:pagText2"><![CDATA[<span id="resultForm:pagText2">Resultado: 1 /  12.858</span>]]></update>
<update id="resultForm:jurisTable"><![CDATA[<table><tbody>
<tr data-ri="0" data-rk="982146"><td>SALA DE CASACIÓN CIVIL, AGRARIA Y RURAL</td><td>TUTELA</td><td>ID: </td><td>982146</td><td>N&Uacute;MERO DE PROCESO: </td><td>T 11001-02-30-000-2026-01376-00</td><td>N&Uacute;MERO DE PROVIDENCIA: </td><td>STC18383-2026</td><td>CLASE DE ACTUACI&Oacute;N: </td><td>ACCIÓN DE TUTELA - PRIMERA INSTANCIA</td><td>TIPO DE PROVIDENCIA: </td><td>SENTENCIA</td><td>FECHA: </td><td>22/09/2026</td><td>PONENTE: </td><td>JUAN CARLOS SOSA LONDOÑO</td><td>TEMA: </td><td>ACCION DE TUTELA - Procedencia excepcional</td></tr>
<tr data-ri="1" data-rk="982100"><td>SALA DE CASACIÓN LABORAL</td><td></td><td>NÚMERO DE PROVIDENCIA: </td><td>SL123-2026</td><td>FECHA: </td><td>10/01/2026</td></tr>
</tbody></table>]]></update>
<update id="j_id1:javax.faces.ViewState:0">-1:-2</update>
</changes></partial-response>`;

test("el registro de fuentes trae las tres relatorías", () => {
  assert.deepEqual(FUENTES_JURIS.map((f) => f.id), ["csj", "ccc", "ce"]);
  assert.ok(fuenteDe("csj")?.filtros.includes("sala"));
  assert.equal(fuenteDe("otra"), null);
  assert.equal(validarBusqueda({ fuente: "csj", texto: "sa" }), "Escriba al menos 3 letras del tema.");
  assert.equal(validarBusqueda({ fuente: "ce", texto: "salud", corporacion: "" }), "Elija la corporación.");
  assert.equal(validarBusqueda({ fuente: "ce", texto: "salud", corporacion: "1100103" }), "");
});

test("la tabla de la Corte Suprema se vuelve filas", () => {
  assert.equal(totalCSJ(CSJ_XML), 12858);
  assert.equal(extraerViewStateCSJ(CSJ_XML), "-1:-2");
  const filas = filasCSJ(CSJ_XML);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].ref, "982146");
  assert.match(filas[0].sala, /CIVIL/);
  assert.equal(filas[0].providencia, "STC18383-2026");
  assert.equal(filas[0].proceso, "T 11001-02-30-000-2026-01376-00");
  assert.equal(filas[0].fecha, "22/09/2026");
  assert.equal(filas[0].ponente, "JUAN CARLOS SOSA LONDOÑO");
  assert.match(filas[0].tema, /Procedencia excepcional/);
  assert.equal(filas[1].sala, "SALA DE CASACIÓN LABORAL");
  assert.equal(extraerUpdate(CSJ_XML, "inexistente"), "");
});

test("el hit de la Constitucional se normaliza con su enlace", () => {
  const r = normalizarCCC({
    prov_id: 45815, prov_sentencia: "T-051/24", prov_tipo: "Sentencia",
    prov_f_sentencia: "2024-02-15", prov_magistrados: ["Diana Fajardo"],
    prov_expediente: "T-9.000.001", prov_tema: "Salud", prov_sintesis: "Síntesis.",
    rutahtml: "2024/T-051-24.htm",
  });
  assert.equal(r.numero, "T-051/24");
  assert.equal(r.magistrado, "Diana Fajardo");
  assert.equal(r.url, "https://www.corteconstitucional.gov.co/relatoria/2024/T-051-24.htm");
});

const CE_DELTA = [
  " longprefix ",
  "1|#||4|99|updatePanel|MainContent_PanelUpdate|",
  `<input id="MainContent_ResultadoBusqueda1_TitulacionesRepeater_OrdenButton_0" value="1" />
   <a id="MainContent_ResultadoBusqueda1_TitulacionesRepeater_HypRadicado_0" href="../vistas/casos/list_procesos.aspx?guid=ABC123" target="_blank">76001233300020160067301</a><br />
   <label class="fw-bold">Interno:&nbsp;</label><span class="fw-lighter">2535-2023</span><br />
   <label class="fw-bold">Fecha proceso:&nbsp;</label><span class="fw-lighter">26 de abril de 2023</span><br />
   <label class="fw-bold">Titular:&nbsp;</label><span class="fw-lighter">ELIZABETH BECERRA</span><br />
   <a href="HTTPS://SAMAI.CONSEJODEESTADO.GOV.CO/PaginasTransversales/VerProvidencia.aspx?tokenDocumento=TOKEN1,EXTRA" target="_self">Ver</a>`,
  "|8|hiddenField|",
].join("");

test("el delta del Consejo de Estado se vuelve ficha con token", () => {
  assert.ok(panelDe(CE_DELTA, "MainContent_PanelUpdate").includes("HypRadicado_0"));
  assert.equal(panelDe(CE_DELTA, "otro"), "");
  const items = itemsCE(CE_DELTA);
  assert.equal(items.length, 1);
  assert.equal(items[0].proceso, "76001233300020160067301");
  assert.equal(items[0].guid, "ABC123");
  assert.equal(items[0].interno, "2535-2023");
  assert.equal(items[0].ponente, "ELIZABETH BECERRA");
  assert.ok(items[0].token.startsWith("TOKEN1"));
});

test("asp x y corporaciones se leen del inicio", () => {
  const html = `<input type="hidden" name="__VIEWSTATE" value="VW" /><input type="hidden" name="__EVENTVALIDATION" value="EV" />
  <select id="CorporacionesTitulanDataList"><option value="1100103">Consejo de Estado</option><option value="2500023">Cundinamarca</option></select>`;
  assert.deepEqual(extraerAspx(html), { viewstate: "VW", eventvalidation: "EV", generator: "7261BA90" });
  assert.deepEqual(corporacionesDe(html), [
    { codigo: "1100103", nombre: "Consejo de Estado" },
    { codigo: "2500023", nombre: "Cundinamarca" },
  ]);
  assert.deepEqual(corporacionesDe("nada"), []);
});

test("limpieza de html y nombres de fuente", () => {
  assert.equal(desentizar("N&Uacute;MERO &#65;"), "NÚMERO A");
  assert.equal(textoDeHtml("<td>Hola<br>Mundo</td>"), "Hola\nMundo");
  assert.equal(nombreFuente({ fuente: "ccc", numero: "T-051/24" }), "T-051/24 · Corte Constitucional");
  assert.ok(etiquetasFuente({ fuente: "csj", tipo: "SENTENCIA" }).includes("jurisprudencia"));
});
