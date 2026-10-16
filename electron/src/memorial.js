import { parrafoHtml } from "../compartido/formato.js";
import { fechaInforme } from "./informe.js";
import { texto } from "../compartido/logica.js";

function html(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pieHtml(origen) {
  const texto = origen === "nube"
    ? "Borrador armado con apoyo de IA en la nube usando su clave. Verifique los hechos y las citas normativas antes de presentarlo."
    : "Borrador armado en este computador con apoyo de IA local. Verifique los hechos y las citas normativas antes de presentarlo.";
  return `<p class="pie">${texto}</p>`;
}

const EXCLUIDOS_CUERPO = new Set(["Destinatario", "Referencia"]);
const SIN_TITULO = new Set([
  "Presentación", "Antecedentes", "Hechos", "Fundamentos", "Peticiones",
  "Pruebas", "Anexos", "Notificaciones", "Cuerpo", "Cierre", "Escrito",
]);

function referenciaHtml(ficha, asunto) {
  const filas = [
    ["Referencia", texto(ficha?.referencia) || asunto || "Memorial", false],
    ["Radicado", texto(ficha?.radicado) || "sin número", true],
    ["Demandante", texto(ficha?.demandantes) || "no figura en el expediente", false],
    ["Demandado", texto(ficha?.demandados) || "no figura en el expediente", false],
  ];
  return `<table class="ref">${filas.map(([clave, valor, mono]) => `
    <tr><th>${html(clave)}</th><td${mono ? ' class="mono"' : ""}>${html(valor)}</td></tr>`).join("")}
  </table>`;
}

function cuerpoHtml(secciones) {
  return (secciones || [])
    .filter((seccion) => !EXCLUIDOS_CUERPO.has(seccion.titulo))
    .map((seccion) => {
      const cierre = seccion.titulo === "Cierre";
      const parrafos = (seccion.parrafos || []).map((parrafo) => {
        if (cierre && /___/.test(parrafo)) return `<p class="firma">${html(parrafo)}</p>`;
        return `<p>${html(parrafo)}</p>`;
      }).join("");
      const titulo = SIN_TITULO.has(seccion.titulo) ? "" : `<h2>${html(seccion.titulo)}</h2>`;
      return `<section>${titulo}${parrafos}</section>`;
    }).join("");
}

function destinoHtml(ficha, fecha) {
  return `<p class="lugar">${html(fecha ? fechaInforme(fecha.slice(0, 10)) : "")}</p>
  <p>Señor Juez</p>
  <p class="despacho">${html(texto(ficha?.despacho) || "Despacho de conocimiento")}</p>
  <p>E. S. D.</p>`;
}

const ESTILOS = `
  @page { size: A4; margin: 18mm 16mm; }
  body { margin: 0; color: #1b2735; font-family: Georgia, "Times New Roman", serif; font-size: 12.5pt; line-height: 1.55; }
  .hoja { max-width: 170mm; margin: 0 auto; }
  .marca { margin: 0; color: #17456e; font-family: "Liberation Sans", sans-serif; font-size: 10pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
  h1 { font-size: 20pt; margin: 2mm 0 0; }
  .lugar { margin: 6mm 0 0; }
  p { margin: 2mm 0 0; }
  .despacho { font-weight: 700; }
  .ref { width: 100%; border-collapse: collapse; margin-top: 5mm; font-size: 11pt; }
  .ref th, .ref td { border: 1px solid #b7c9da; padding: 2mm 3mm; text-align: left; vertical-align: top; }
  .ref th { width: 32mm; background: #f4f7fa; font-family: "Liberation Sans", sans-serif; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.04em; }
  .mono { font-family: "Liberation Mono", ui-monospace, monospace; }
  h2 { font-size: 13pt; margin: 6mm 0 0; border-bottom: 1px solid #b7c9da; padding-bottom: 1mm; }
  section { break-inside: avoid; }
  .firma { letter-spacing: 0.1em; }
  .hoja p { text-align: justify; }
  .al-centro, .firma { text-align: center !important; }
  .al-derecha { text-align: right !important; }
  .al-izquierda { text-align: left !important; }
  h3 { font-size: 12pt; font-style: italic; margin: 4mm 0 0; }
  blockquote { margin: 3mm 12mm 3mm 20mm; font-size: 11pt; font-style: italic; }
  ul, ol { margin: 2mm 0 0; padding-left: 10mm; }
  .doc-tabla { width: 100%; border-collapse: collapse; margin-top: 3mm; font-size: 10.5pt; }
  .doc-tabla th, .doc-tabla td { border: 1px solid #8fa5ba; padding: 1.5mm 2.5mm; text-align: left; vertical-align: top; }
  .doc-tabla th { background: #eef2f6; }
  mark { background: none; color: #a33; }
  .pie { margin-top: 8mm; font-family: "Liberation Sans", sans-serif; font-size: 9.5pt; color: #5b6b7c; border-top: 1px solid #b7c9da; padding-top: 2mm; }
`;

export function vistaMemorial({ asunto, secciones, ficha, fecha, origen }) {
  return `<div class="doc-hoja">
    <p class="marca">Vista previa</p>
    ${destinoHtml(ficha, fecha)}
    ${referenciaHtml(ficha, asunto)}
    ${cuerpoHtml(secciones)}
    ${pieHtml(origen)}
  </div>`;
}

export function htmlMemorial({ asunto, secciones, ficha, fecha, origen }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${html(asunto || "Memorial")} ${html(texto(ficha?.radicado) || "")}</title>
  <style>${ESTILOS}</style>
</head>
<body>
  <div class="hoja">
    ${destinoHtml(ficha, fecha)}
    ${referenciaHtml(ficha, asunto)}
    ${cuerpoHtml(secciones)}
    ${pieHtml(origen)}
  </div>
</body>
</html>`;
}

// Documentos: la misma hoja y el mismo pie, sin el encabezado del juzgado,
// porque el documento (contrato, concepto, tutela) ya trae el suyo.
function cuerpoDocumentoHtml(secciones) {
  return (secciones || []).map((seccion) => {
    const parrafos = (seccion.parrafos || []).map((parrafo) => parrafoHtml(parrafo)).join("");
    const titulo = SIN_TITULO.has(seccion.titulo) || EXCLUIDOS_CUERPO.has(seccion.titulo) ? "" : `<h2>${html(seccion.titulo)}</h2>`;
    return `<section>${titulo}${parrafos}</section>`;
  }).join("");
}

export function htmlDocumento({ asunto, secciones, origen }, { pie = true } = {}) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${html(asunto || "Documento")}</title>
  <style>${ESTILOS}</style>
</head>
<body>
  <div class="hoja">
    <h1>${html(asunto || "Documento")}</h1>
    ${cuerpoDocumentoHtml(secciones)}
    ${pieHtml(origen)}
    ${pie ? '<p class="pie">Generado con IA. Favor revisar.</p>' : ""}
  </div>
</body>
</html>`;
}
