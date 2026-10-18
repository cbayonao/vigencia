// Fuentes que vienen de archivos: un solo camino por el conversor, la
// fuente ligada al archivo (pieza.archivo_id) y Documentos usando sus
// trozos con página. También Herramientas PDF llevando un PDF al contexto.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { abrirBase, uno } from "../src/db.js";
import { archivosDelProyecto, convertirConCache, limpiarCache } from "../src/conversiones.js";
import { convertirPdf, convertirRuta } from "../src/convertir/convertidores.js";
import { guardarPieza, leerPieza } from "../src/biblioteca.js";
import { importarABiblioteca, mismoTextoQueArchivo, piezaDeArchivo, revisarRuta } from "../src/fuentes.js";
import { crearProyecto, elegirFuentes, prepararVuelta } from "../src/documentos.js";
import { guardarTemporal, limpiarTemporales, registrarPdftools, textoParaComparar } from "../src/pdftools-ipc.js";
import { protegerPdf } from "../src/pdfproteger.js";
import { textoDePdf } from "../src/pdftexto.js";
import { avisoTopeOcr, detalleArchivo, textoLegible } from "../compartido/convertir.js";
import { bloqueDeFragmentos, claseDeNombre, fragmentosRelevantes } from "../compartido/documentos.js";

const corpus = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus");
const nube = () => ({ id: "nube:openai", nombre: "Nube", usa: true, origen: "nube" });

function temporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-fuentes-"));
  return { dir, db: abrirBase(path.join(dir, "grokvig.sqlite")) };
}

// convertirDatos de prueba: el mismo convertirConCache de la app, pero la
// conversión corre aquí mismo en vez de en el utilityProcess.
function convertidor(tmp, contador = { n: 0 }) {
  return (dato) => convertirConCache(tmp.db, tmp.dir, dato, {
    ejecutar: async ({ ruta, opciones }) => {
      contador.n++;
      try {
        return { tipo: "listo", resultado: await convertirRuta(ruta, { ...opciones, datosDir: tmp.dir }) };
      } catch (error) {
        return { tipo: "error", mensaje: error.message, codigo: error.codigo || "" };
      }
    },
  });
}

// Markdown de tres páginas, largo para que se trocee.
function markdownPaginado() {
  const relleno = (tema) => Array.from({ length: 12 }, (_, i) => `Párrafo ${i + 1} sobre ${tema}: el juzgado revisa la prueba y la norma aplicable con cuidado y detalle suficiente para decidir.`).join("\n\n");
  return [
    "<!-- pagina 1 -->", "## HECHOS", relleno("los hechos del caso"),
    "<!-- pagina 2 -->", "## PRUEBAS", relleno("la historia clínica y el medicamento negado por la EPS"),
    "<!-- pagina 3 -->", "## PRETENSIONES", relleno("lo que se pide al juez"),
  ].join("\n\n");
}

test("importar a la biblioteca pasa por el conversor y liga la fuente al archivo", async () => {
  const tmp = temporal();
  const contador = { n: 0 };
  const convertirDatos = convertidor(tmp, contador);
  const md = path.join(tmp.dir, "historia clinica.md");
  fs.writeFileSync(md, markdownPaginado());
  const r = await importarABiblioteca({ db: tmp.db, datosDir: tmp.dir, rutas: [md, path.join(corpus, "texto.pdf"), path.join(tmp.dir, "x.odt")], convertirDatos });
  assert.equal(r.fuentes.length, 2);
  assert.equal(r.errores.length, 1);
  assert.match(r.errores[0].error, /no se puede leer/);
  const pieza = leerPieza(tmp.db, r.fuentes[0].id);
  assert.ok(pieza.archivo_id);
  assert.doesNotMatch(pieza.texto, /<!-- pagina/);
  const archivo = uno(tmp.db, "SELECT meta FROM archivo WHERE id = ?", [pieza.archivo_id]);
  assert.equal(JSON.parse(archivo.meta).herramienta, "biblioteca");
  // La segunda vez sale de la caché y no duplica la fuente.
  const otra = await importarABiblioteca({ db: tmp.db, datosDir: tmp.dir, rutas: [md], convertirDatos });
  assert.equal(contador.n, 2);
  assert.equal(otra.fuentes[0].id, pieza.id);
  assert.equal(otra.fuentes[0].repetida, true);
  assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) n FROM pieza WHERE archivo_id = ?", [pieza.archivo_id]).n), 1);
});

test("Documentos usa los trozos con página de la fuente ligada y la vieja sigue igual", async () => {
  const tmp = temporal();
  const convertirDatos = convertidor(tmp);
  const md = path.join(tmp.dir, "expediente.md");
  fs.writeFileSync(md, markdownPaginado());
  const { fuentes } = await importarABiblioteca({ db: tmp.db, datosDir: tmp.dir, rutas: [md], convertirDatos });
  const vieja = guardarPieza(tmp.db, { nombre: "Nota vieja", clase: "nota", texto: markdownPaginado().replace(/<!-- pagina \d -->/g, "").replace(/EPS/g, "entidad") });
  const p = crearProyecto(tmp.db, { nombre: "Tutela salud", tipo: "tutela" });
  elegirFuentes(tmp.db, p.id, [fuentes[0].id, vieja.id]);
  const previa = prepararVuelta({ db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "medicamento negado por la EPS e historia clínica", resolverModelo: nube });
  const ligados = previa.fragmentos.filter((f) => f.fuente.id === fuentes[0].id);
  const viejos = previa.fragmentos.filter((f) => f.fuente.id === vieja.id);
  assert.ok(ligados.length > 0);
  assert.ok(ligados.every((f) => f.pagina > 0));
  assert.ok(ligados.some((f) => f.pagina === 2));
  assert.ok(viejos.every((f) => !f.pagina));
  assert.match(previa.encargo, /\[Fragmento \d+, página 2\]/);
  const detalle = previa.informe.fuentesDetalle.find((f) => f.id === fuentes[0].id);
  assert.ok(detalle.paginas.includes(2));
  assert.match(detalle.detalle, /desde Biblioteca de fuentes/);
});

test("si el archivo también está en el proyecto, entra una sola vez", async () => {
  const tmp = temporal();
  const convertirDatos = convertidor(tmp);
  const md = path.join(tmp.dir, "expediente.md");
  fs.writeFileSync(md, markdownPaginado());
  const p = crearProyecto(tmp.db, { nombre: "P", tipo: "tutela" });
  const r = await convertirDatos({ datos: fs.readFileSync(md), nombre: "expediente.md", proyectoId: p.id, meta: { herramienta: "pdf" } });
  const { pieza } = piezaDeArchivo(tmp.db, tmp.dir, r.archivo.id);
  elegirFuentes(tmp.db, p.id, [pieza.id]);
  const previa = prepararVuelta({ db: tmp.db, datosDir: tmp.dir, proyectoId: p.id, mensaje: "medicamento EPS", resolverModelo: nube });
  assert.equal(previa.fragmentos.length, 0);
  assert.ok(previa.archivosFrag.length > 0);
  assert.match(previa.informe.archivos[0].detalle, /desde Herramientas PDF/);
});

test("editar el texto de una fuente ligada la desliga; cambiar el nombre no", async () => {
  const tmp = temporal();
  const convertirDatos = convertidor(tmp);
  const { fuentes } = await importarABiblioteca({ db: tmp.db, datosDir: tmp.dir, rutas: [path.join(corpus, "sentencia.txt")], convertirDatos });
  const p = leerPieza(tmp.db, fuentes[0].id);
  assert.ok(mismoTextoQueArchivo(tmp.db, tmp.dir, p.archivo_id, p.texto));
  assert.equal(mismoTextoQueArchivo(tmp.db, tmp.dir, p.archivo_id, `${p.texto} más`), false);
  const renombrada = guardarPieza(tmp.db, { id: p.id, nombre: "Otro nombre", clase: p.clase, texto: p.texto });
  assert.equal(renombrada.archivo_id, p.archivo_id);
  const editada = guardarPieza(tmp.db, { id: p.id, nombre: "Otro nombre", clase: p.clase, texto: `${p.texto}\n\nNota mía.` });
  assert.equal(editada.archivo_id, null);
});

test("limpiar caché respeta los archivos ligados a una fuente", async () => {
  const tmp = temporal();
  const convertirDatos = convertidor(tmp);
  const { fuentes } = await importarABiblioteca({ db: tmp.db, datosDir: tmp.dir, rutas: [path.join(corpus, "sentencia.txt")], convertirDatos });
  await convertirDatos({ datos: fs.readFileSync(path.join(corpus, "concepto.html")), nombre: "concepto.html" });
  assert.equal(limpiarCache(tmp.db, tmp.dir).borrados, 1);
  const p = leerPieza(tmp.db, fuentes[0].id);
  assert.ok(uno(tmp.db, "SELECT id FROM archivo WHERE id = ?", [p.archivo_id]));
});

test("la migración 17 deja el índice de fuentes por archivo", () => {
  const tmp = temporal();
  assert.ok(uno(tmp.db, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'pieza_archivo'"));
  assert.equal(uno(tmp.db, "SELECT nombre FROM schema_migracion WHERE version = 17").nombre, "fuentes ligadas a archivos convertidos");
});

test("el OCR tiene tope de páginas y lo dice", async () => {
  const fuente = await PDFDocument.load(fs.readFileSync(path.join(corpus, "escaneado.pdf")));
  const doble = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const [pagina] = await doble.copyPages(fuente, [0]);
    doble.addPage(pagina);
  }
  const bytes = Buffer.from(await doble.save());
  let llamadas = 0;
  const lectorOcr = { reconocer: async () => { llamadas++; return { texto: "Texto reconocido de la página escaneada, legible y en español." }; }, cerrar: async () => {} };
  const r = await convertirPdf(bytes, { datosDir: os.tmpdir(), lectorOcr, maxPaginasOcr: 2 });
  assert.equal(llamadas, 2);
  assert.equal(r.paginasOcr, 2);
  assert.equal(r.paginasSinOcr, 1);
  assert.match(r.aviso, /primeras 2 páginas escaneadas/);
  assert.equal(avisoTopeOcr(5, 5), "");
});

test("un PDF con contraseña no se convierte y dice cómo abrirlo", async () => {
  const tmp = temporal();
  const ruta = path.join(tmp.dir, "clave.pdf");
  fs.writeFileSync(ruta, await protegerPdf(path.join(corpus, "texto.pdf"), { usuario: "secreta" }));
  await assert.rejects(convertirRuta(ruta, { datosDir: tmp.dir }), (e) => e.codigo === "clave" && /Desbloquear/.test(e.message));
  const r = await textoParaComparar(ruta, { datosDir: tmp.dir });
  assert.equal(r.ok, false);
  assert.match(r.error, /contraseña/);
});

test("Comparar lee con el lector completo lo que el simple no leía", async () => {
  const ruta = path.join(corpus, "texto.pdf");
  assert.equal(textoDePdf(fs.readFileSync(ruta)).ok, false);
  const r = await textoParaComparar(ruta, { datosDir: os.tmpdir() });
  assert.equal(r.ok, true);
  assert.match(r.texto, /derecho fundamental a la salud/);
});

// ipcMain de prueba: guarda los manejadores para llamarlos directo.
function ipcFalso() {
  const manejadores = new Map();
  return { manejadores, handle: (canal, fn) => manejadores.set(canal, fn) };
}

test("pdf-a-proyecto convierte el PDF y lo deja en el contexto del proyecto", async () => {
  const tmp = temporal();
  const ipcMain = ipcFalso();
  registrarPdftools({ ipcMain, dialog: {}, ventana: () => null, mensajeHumano: (e) => e.message, datosDir: () => tmp.dir, convertirDatos: convertidor(tmp) });
  const llevar = ipcMain.manejadores.get("pdf-a-proyecto");
  const p = crearProyecto(tmp.db, { nombre: "Demanda", tipo: "demanda" });
  const r = await llevar(null, { ruta: path.join(corpus, "texto.pdf"), proyectoId: p.id });
  assert.equal(r.ok, true);
  assert.equal(r.archivo.meta.herramienta, "pdf");
  assert.equal(archivosDelProyecto(tmp.db, p.id).length, 1);
  const solo = await llevar(null, { ruta: path.join(corpus, "cid.pdf") });
  assert.equal(solo.ok, true);
  assert.equal(archivosDelProyecto(tmp.db, p.id).length, 1);
  assert.equal((await llevar(null, { ruta: path.join(corpus, "sentencia.txt"), proyectoId: p.id })).ok, false);
  const clave = path.join(tmp.dir, "clave.pdf");
  fs.writeFileSync(clave, await protegerPdf(path.join(corpus, "texto.pdf"), { usuario: "x" }));
  const bloqueado = await llevar(null, { ruta: clave, proyectoId: p.id });
  assert.equal(bloqueado.ok, false);
  assert.match(bloqueado.error, /Desbloquear/);
  assert.equal((await llevar(null, { ruta: path.join(corpus, "texto.pdf"), proyectoId: 9999 })).ok, false);
});

test("las copias temporales de PDF se guardan aparte y se borran viejas", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "vig-tmp-"));
  const ruta = guardarTemporal(Buffer.from("%PDF-1.4"), "demanda/abierto", base);
  assert.ok(fs.existsSync(ruta));
  assert.ok(ruta.endsWith(".pdf"));
  assert.equal(limpiarTemporales({ base, edadMs: 60_000 }), 0);
  assert.equal(limpiarTemporales({ base, edadMs: 0 }), 1);
  assert.equal(fs.existsSync(ruta), false);
});

test("lógica pura: texto legible, detalle del archivo, clase y fragmentos con página", () => {
  assert.equal(textoLegible("---\na: \"b\"\n---\n\n<!-- pagina 1 -->\n\nHola\n\n<!-- pagina 2 -->\n\nChao"), "Hola\n\nChao");
  assert.equal(detalleArchivo({ extension: "pdf", paginas: 12, paginas_ocr: 3, calidad: 0.92, meta: { herramienta: "pdf" } }), "PDF, 12 páginas, 3 leídas con OCR, calidad del texto 92 %, desde Herramientas PDF");
  assert.equal(detalleArchivo({ extension: "md" }), "Markdown");
  assert.equal(claseDeNombre("Sentencia T-760 de 2008.pdf"), "jurisprudencia");
  assert.equal(claseDeNombre("Ley 100 de 1993"), "ley");
  assert.equal(claseDeNombre("historia clinica"), "nota");
  const largo = "x ".repeat(2000);
  const fuente = { id: 1, nombre: "Exp", clase: "nota", texto: largo, trozos: [{ orden: 0, pagina: 4, titulo: "HECHOS", texto: "La EPS negó el medicamento." }, { orden: 1, pagina: 5, titulo: "", texto: "Otra cosa." }] };
  const frag = fragmentosRelevantes([fuente], "medicamento EPS");
  assert.equal(frag[0].pagina, 4);
  assert.match(bloqueDeFragmentos(frag), /\[Fragmento 1, página 4\]/);
  assert.equal(revisarRuta(path.join(corpus, "no-existe.pdf")), "No encuentro ese archivo.");
});
