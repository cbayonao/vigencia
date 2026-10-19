// Estados de la Rama a tabla. El PDF de prueba se arma aquí con pdf-lib,
// con la forma del listado Siglo XXI y nombres inventados: el estado real
// tiene datos personales y no va al repositorio.
import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { itemsDePdf, tablasDeDatos } from "../src/convertir/convertidores.js";
import {
  columnaDeTitulo, csvDeFilas, estadoAMarkdown, fechaLarga, filasParaExportar, filtrarFilas, iniciaRadicado, leerEstado, leerPorLineas, leerTabla,
  marcarSeguidos, metaDeTexto, normalizarRadicadoEstado, ordenarFilas, tablasDeHtml,
} from "../compartido/estados.js";

// Columnas como el listado real: título centrado, datos a la izquierda.
const SIGLO = [
  { titulo: ["No Proceso"], x: 49, dato: 34 },
  { titulo: ["Clase de Proceso"], x: 119, dato: 106 },
  { titulo: ["Demandante"], x: 235, dato: 196 },
  { titulo: ["Demandado"], x: 392, dato: 346 },
  { titulo: ["Descripción Actuación"], x: 583, dato: 502 },
  { titulo: ["Fecha", "Auto"], x: 777, dato: 770 },
  { titulo: ["Cuad."], x: 825, dato: 828 },
];

// registro: { rad: ["11001 31 10 022", "2022 00839"], clase: [..], demandante: [..], demandado: [..], actuacion, anotacion: [..], fecha, cuad }
// Una página puede empezar con `sigue`: líneas de anotación del registro anterior.
async function armarEstado(paginas, { columnas = SIGLO, numero = "074", fecha = "12/06/2024", juzgado = ["JUZGADO", "022", "FAMILIA DEL CIRCUITO"] } = {}) {
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const b = await pdf.embedFont(StandardFonts.HelveticaBold);
  paginas.forEach((pag, i) => {
    const p = pdf.addPage([936, 612]);
    const dx = pag.dx || 0;
    const t = (texto, x, y, size = 7, font = f) => p.drawText(texto, { x: x + dx, y, size, font });
    t("REPUBLICA", 394, 575, 9, b);
    t("DE COLOMBIA", 450, 575, 9, b);
    t("RAMA JUDICIAL", 421, 561, 8, b);
    t(juzgado[0], 375, 547, 9, b);
    t(juzgado[1], 438, 545, 10, b);
    t(juzgado[2], 472, 547, 9, b);
    t("LISTADO DE ESTADO", 407, 535, 10, b);
    t("ESTADO No.", 28, 512, 10, b);
    t(numero, 124, 511, 11, b);
    t("Fecha:", 545, 512, 8);
    t(fecha, 580, 511, 9);
    t("Página:", 778, 512, 8);
    t(String(i + 1), 836, 511, 9);
    for (const c of columnas) {
      if (c.titulo.length === 2) {
        t(c.titulo[0], c.x, 488, 7, b);
        t(c.titulo[1], c.x + 2, 477, 7, b);
      } else t(c.titulo[0], c.x, 480, 7, b);
    }
    const col = Object.fromEntries(columnas.map((c) => [c.id || idDe(c.titulo.join(" ")), c.dato]));
    let y = 464;
    for (const linea of pag.sigue || []) {
      t(linea, col.actuacion ?? col.anotacion, y, 8);
      y -= 11;
    }
    if (pag.sigue) y -= 8;
    for (const r of pag.registros || []) {
      if (col.radicado !== undefined) {
        const [a, c] = r.rad;
        // El radicado partido en pedazos, como lo pinta el listado.
        const g = a.split(" ");
        if (g.length === 4) {
          t(g[0], col.radicado, y, 8);
          t(g[1], col.radicado + 27, y, 8);
          t(g[2], col.radicado + 40, y, 8);
          t(g[3], col.radicado + 53, y, 8);
        } else t(a, col.radicado, y, 8);
        if (c) {
          const [anio, cons] = c.split(" ");
          t(anio, col.radicado + 5, y - 10, 9);
          t(cons, col.radicado + 36, y - 10, 9);
        }
      }
      (r.clase || []).forEach((l, k) => col.clase !== undefined && t(l, col.clase, y - 1 - 10 * k, 8));
      (r.demandante || []).forEach((l, k) => t(l, col.demandante, y - 1 - 9 * k, 7));
      (r.demandado || []).forEach((l, k) => t(l, col.demandado, y - 1 - 9 * k, 7));
      if (col.actuacion !== undefined) t(r.actuacion, col.actuacion, y - 7, 9);
      const anot = col.anotacion !== undefined && col.actuacion !== undefined && col.anotacion !== col.actuacion ? col.anotacion : col.actuacion;
      (r.anotacion || []).forEach((l, k) => t(l, anot, y - 18 - 11 * k, 8));
      if (col.fecha !== undefined) t(r.fecha, col.fecha, y - 10, 8);
      if (r.cuad && col.cuaderno !== undefined) t(r.cuad, col.cuaderno, y - 10, 8);
      y -= 31 + 11 * Math.max(0, (r.anotacion || []).length - 1);
    }
    if (pag.pie) {
      t("DE CONFORMIDAD CON LO PREVISTO EN EL ART. 295 DEL CODIGO GENERAL DEL PROCESO Y PARA NOTIFICAR A LAS PARTES", 64, y - 30, 8);
      t("PEDRO PRUEBA SECRETARIO FALSO", 373, y - 90, 11, b);
      t("SECRETARIO", 435, y - 106, 8);
    }
  });
  return Buffer.from(await pdf.save());
}

function idDe(titulo) {
  return columnaDeTitulo(titulo);
}

const R = (cons, extra = {}) => ({
  rad: ["11001 31 10 022", `2023 ${cons}`],
  clase: ["Ordinario"],
  demandante: ["ANA PRUEBA UNO"],
  demandado: ["BETO EJEMPLO DOS"],
  actuacion: "Admite",
  anotacion: ["(correspondencia, término 10d)"],
  fecha: "11/06/2024",
  ...extra,
});

async function leer(buffer) {
  const { paginas } = await itemsDePdf(buffer, {});
  return leerEstado(paginas);
}

test("estado Siglo XXI: celdas de varias líneas, radicado partido y metadatos", async () => {
  const pdf = await armarEstado([{
    registros: [
      R("00839", { rad: ["11001 31 10 022", "2022 00839"], clase: ["Verbal de Mayor y", "Menor Cuantia"], demandante: ["LUISA FERNANDA FALSA", "INVENTADA"], demandado: ["MARCO DE PRUEBA"], actuacion: "Señala fechas para Audiencias", anotacion: ["(audiencia PRESENCIAL ag.05/24 2pm )"], cuad: "1" }),
      R("00021", { actuacion: "Auto que ordena correr traslado", anotacion: ["por secretaría, para fijar en lista excepciones de mérito", "(términos)"] }),
    ],
  }]);
  const r = await leer(pdf);
  assert.equal(r.filas.length, 2);
  assert.deepEqual(r.meta, { paginas: 1, juzgado: "JUZGADO 022 FAMILIA DEL CIRCUITO", estado: "074", fecha: "12/06/2024", tipo: "estado" });
  const [a, b] = r.filas;
  assert.equal(a.radicadoTexto, "11001 31 10 022 2022 00839");
  assert.equal(a.radicado, "11001311002220220083900");
  assert.equal(a.radicado.length, 23);
  assert.equal(a.clase, "Verbal de Mayor y Menor Cuantia");
  assert.equal(a.demandante, "LUISA FERNANDA FALSA INVENTADA");
  assert.equal(a.demandado, "MARCO DE PRUEBA");
  assert.equal(a.actuacion, "Señala fechas para Audiencias");
  assert.equal(a.anotacion, "(audiencia PRESENCIAL ag.05/24 2pm )");
  assert.equal(a.fecha, "11/06/2024");
  assert.equal(a.cuaderno, "1");
  assert.equal(a.confianza, "alta");
  assert.deepEqual(a.avisos, []);
  assert.equal(b.anotacion, "por secretaría, para fijar en lista excepciones de mérito (términos)");
  assert.ok(a.caja && a.caja.pagina === 1 && a.caja.w > 400, "la caja cubre la fila para resaltarla");
});

test("estado: el mismo radicado dos veces, salto de página con títulos repetidos, columnas corridas y pie", async () => {
  const pdf = await armarEstado([
    { registros: [R("00206", { actuacion: "Auto que ordena requerir" }), R("00206", { actuacion: "Auto que decreta medida", anotacion: ["(oficios, TÉRMINO 30 días", "vence jl.25/24)"] })] },
    { dx: 9, sigue: ["continúa la anotación"], registros: [R("00547"), R("00595", { demandante: ["CARLA", "PRUEBA"] })] },
    { dx: -6, registros: [], pie: true },
  ]);
  const r = await leer(pdf);
  assert.equal(r.filas.length, 4);
  assert.deepEqual(r.filas.map((f) => f.pagina), [1, 1, 2, 2]);
  assert.equal(r.filas[0].radicado, r.filas[1].radicado);
  assert.notEqual(r.filas[0].actuacion, r.filas[1].actuacion);
  assert.equal(r.filas[1].anotacion, "(oficios, TÉRMINO 30 días vence jl.25/24) continúa la anotación");
  assert.match(r.filas[1].avisos.join(" "), /sigue en la página 2/);
  assert.equal(r.filas[1].confianza, "media");
  // Página corrida 9 puntos: las celdas siguen en su columna.
  assert.equal(r.filas[3].demandante, "CARLA PRUEBA");
  assert.equal(r.filas[3].demandado, "BETO EJEMPLO DOS");
  assert.equal(r.filas[3].fecha, "11/06/2024");
  // El pie no es una fila: queda en notas, con el secretario.
  assert.equal(r.meta.secretario, "PEDRO PRUEBA SECRETARIO FALSO");
  assert.match(r.notas.map((n) => n.texto).join(" "), /ART\. 295/);
});

test("estado con otros títulos y sin columna de clase ni cuaderno", async () => {
  const columnas = [
    { titulo: ["Radicación"], x: 60, dato: 34 },
    { titulo: ["Accionante"], x: 190, dato: 160 },
    { titulo: ["Accionado"], x: 330, dato: 300 },
    { titulo: ["Actuación"], x: 470, dato: 440, id: "actuacion" },
    { titulo: ["Anotación"], x: 640, dato: 600, id: "anotacion" },
    { titulo: ["Fecha Providencia"], x: 790, dato: 790 },
  ];
  const pdf = await armarEstado([{ registros: [R("00011", { actuacion: "Admite tutela", anotacion: ["notifíquese"] }), R("00012", { actuacion: "Fallo", anotacion: ["niega"] })] }], { columnas, numero: "12" });
  const r = await leer(pdf);
  assert.equal(r.filas.length, 2);
  const [a] = r.filas;
  assert.equal(a.clase, "");
  assert.equal(a.demandante, "ANA PRUEBA UNO");
  assert.equal(a.demandado, "BETO EJEMPLO DOS");
  assert.equal(a.actuacion, "Admite tutela");
  assert.equal(a.anotacion, "notifíquese");
  assert.equal(a.fecha, "11/06/2024");
  assert.equal(a.radicado, "11001311002220230001100");
  assert.ok(!r.columnas.includes("clase") && !r.columnas.includes("cuaderno"));
  assert.equal(r.meta.estado, "12");
});

test("títulos: sinónimos de los juzgados", () => {
  const casos = {
    "No Proceso": "radicado", "Radicación": "radicado", "No. Radicado": "radicado", "Proceso": "radicado", "Clase de Proceso": "clase",
    "Demandante/Accionante": "demandante", "ACCIONADO": "demandado", "Descripción Actuación": "actuacion", "Anotación": "anotacion",
    "Fecha Auto": "fecha", "Fecha Providencia": "fecha", "Cuad.": "cuaderno", "Folios": "folios", "Juan Pérez": "",
  };
  for (const [t, id] of Object.entries(casos)) assert.equal(columnaDeTitulo(t), id, t);
});

test("radicado: normalizar a 23 dígitos solo cuando es seguro", () => {
  assert.deepEqual(normalizarRadicadoEstado("11001 31 10 022 2022 00839"), { numero: "11001311002220220083900", texto: "11001 31 10 022 2022 00839", nota: "Completado con 00 al final (recurso).", aviso: "" });
  assert.equal(normalizarRadicadoEstado("11001310302220220083901").numero, "11001310302220220083901");
  assert.equal(normalizarRadicadoEstado("11001-31-10-022-2022-00839-01").numero, "11001311002220220083901");
  const corto = normalizarRadicadoEstado("11001 31 10 22 2022 839");
  assert.equal(corto.numero, "11001311002220220083900");
  assert.match(corto.aviso, /ceros/);
  const malo = normalizarRadicadoEstado("2022 00839");
  assert.equal(malo.numero, "");
  assert.equal(malo.texto, "2022 00839");
  assert.match(malo.aviso, /incompleto/);
  assert.equal(normalizarRadicadoEstado("").aviso, "Sin número de radicado.");
  assert.ok(iniciaRadicado("11001 31 10 022"));
  assert.ok(!iniciaRadicado("2022 00839"));
});

test("metadatos del encabezado", () => {
  assert.deepEqual(metaDeTexto("REPUBLICA DE COLOMBIA RAMA JUDICIAL JUZGADO 022 FAMILIA DEL CIRCUITO LISTADO DE ESTADO ESTADO No. 074 Fecha: 12/6/2024 Página: 3"), {
    juzgado: "JUZGADO 022 FAMILIA DEL CIRCUITO", estado: "074", fecha: "12/06/2024", pagina: 3, tipo: "estado",
  });
});

test("tablas: Excel, CSV, Word y HTML con los mismos títulos", async () => {
  const XLSX = (await import("xlsx")).default;
  const hoja = XLSX.utils.aoa_to_sheet([
    ["JUZGADO 001 CIVIL MUNICIPAL - ESTADO No. 5"],
    [],
    ["Radicación", "Demandante", "Demandado", "Actuación", "Fecha Auto", "Observación extra"],
    ["11001400300120240012300", "ANA PRUEBA", "BETO EJEMPLO", "Admite\n(notifíquese)", "3/7/2024", "x"],
    ["11001 40 03 001 2024 00124", "CARLA", "DANIEL", "Rechaza", "", ""],
  ]);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Estado");
  const [tabla] = await tablasDeDatos(XLSX.write(libro, { type: "buffer", bookType: "xlsx" }), "estado.xlsx");
  const r = leerTabla(tabla);
  assert.equal(r.meta.estado, "5");
  assert.equal(r.filas.length, 2);
  assert.equal(r.filas[0].actuacion, "Admite");
  assert.equal(r.filas[0].anotacion, "(notifíquese)");
  assert.equal(r.filas[0].fecha, "03/07/2024");
  assert.equal(r.filas[0].extra, "x");
  assert.equal(r.filas[1].radicado, "11001400300120240012400");
  assert.match(r.filas[1].avisos.join(" "), /Sin fecha/);

  const html = "<p>ESTADO No. 9</p><table><tr><th>No Proceso</th><th>Demandante</th><th>Demandado</th><th>Descripción Actuación</th><th>Fecha</th></tr><tr><td>11001 31 10 022 2024 00001</td><td>ANA &amp; CÍA</td><td>BETO</td><td>Admite<br>término 10d</td><td>01/02/2024</td></tr></table>";
  const [t] = tablasDeHtml(html);
  const h = leerTabla(t);
  assert.equal(h.filas[0].demandante, "ANA & CÍA");
  assert.equal(h.filas[0].anotacion, "término 10d");
  const [csv] = await tablasDeDatos(Buffer.from("Radicado;Demandante;Demandado;Actuación\n11001311002220240000100;ANA;BETO;Admite\n"), "e.csv");
  assert.equal(leerTabla(csv).filas[0].radicado, "11001311002220240000100");
  assert.equal(leerTabla([["nada", "que ver"], ["1", "2"]]), null);
});

test("sin columnas: línea por línea con confianza baja", () => {
  const r = leerPorLineas("JUZGADO 3 CIVIL\n11001 31 03 003 2024 00010 Admite demanda 11/06/2024\nnotifíquese\n11001310300320240001100 Rechaza");
  assert.equal(r.filas.length, 2);
  assert.equal(r.filas[0].radicado, "11001310300320240001000");
  assert.equal(r.filas[0].actuacion, "Admite demanda 11/06/2024 notifíquese");
  assert.equal(r.filas[0].fecha, "11/06/2024");
  assert.equal(r.filas[0].confianza, "baja");
  assert.equal(r.notas[0].texto, "JUZGADO 3 CIVIL");
});

test("seguidos, filtro, orden, CSV, Excel y Markdown", () => {
  const filas = [
    { id: 1, radicado: "11001311002220220083900", radicadoTexto: "", demandante: "Zoila", actuacion: "Admite", fecha: "11/06/2024", avisos: [] },
    { id: 2, radicado: "11001311002220230002100", radicadoTexto: "", demandante: "Ana", actuacion: "Rechaza; archiva", fecha: "02/01/2023", avisos: ["x"] },
  ];
  const m = marcarSeguidos(filas, ["11001-31-10-022-2022-00839-00"]);
  assert.deepEqual(m.map((f) => f.seguido), [true, false]);
  assert.deepEqual(filtrarFilas(m, { soloSeguidos: true }).map((f) => f.id), [1]);
  assert.deepEqual(filtrarFilas(m, { texto: "rechaza" }).map((f) => f.id), [2]);
  assert.deepEqual(filtrarFilas(m, { texto: "2023 00021" }).map((f) => f.id), [2], "se busca como lo imprime el estado");
  assert.deepEqual(filtrarFilas(m, { texto: "0002100" }).map((f) => f.id), [2]);
  assert.deepEqual(filtrarFilas(m, { soloAvisos: true }).map((f) => f.id), [2]);
  assert.deepEqual(ordenarFilas(m, "demandante").map((f) => f.id), [2, 1]);
  assert.deepEqual(ordenarFilas(m, "fecha", -1).map((f) => f.id), [1, 2]);
  const exp = filasParaExportar([{ nombre: "e.pdf", meta: { estado: "74" }, filas: m }]);
  assert.equal(exp[0][0], "74");
  assert.equal(exp[0][15], "Sí");
  const csv = csvDeFilas(["A", "B"], [["uno; dos", "dijo \"no\""]]);
  assert.equal(csv, "\uFEFFA;B\r\n\"uno; dos\";\"dijo \"\"no\"\"\"\r\n");
  assert.match(estadoAMarkdown({ meta: { juzgado: "JUZGADO 1", estado: "7" }, filas: m }), /^# JUZGADO 1, Estado No\. 7\n[\s\S]*\| Rechaza; archiva \|/);
});

test("leer un archivo de estado: PDF con texto, PDF escaneado sin OCR y tipo que no sirve", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { leerArchivoEstado } = await import("../src/estados-ipc.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "estados-"));
  try {
    const ruta = path.join(dir, "estado.pdf");
    fs.writeFileSync(ruta, await armarEstado([{ registros: [R("00839"), R("00840")] }]));
    const r = await leerArchivoEstado(ruta, { datosDir: dir });
    assert.equal(r.ok, true);
    assert.equal(r.tipo, "pdf");
    assert.equal(r.filas.length, 2);
    assert.ok(r.columnas.includes("demandante"));
    const vacio = await PDFDocument.create();
    vacio.addPage([612, 792]);
    const escaneado = path.join(dir, "escaneado.pdf");
    fs.writeFileSync(escaneado, Buffer.from(await vacio.save()));
    const s = await leerArchivoEstado(escaneado, { datosDir: dir });
    assert.equal(s.ok, false);
    assert.match(s.error, /OCR/);
    const otro = path.join(dir, "foto.png");
    fs.writeFileSync(otro, "x");
    assert.match((await leerArchivoEstado(otro)).error, /PDF, Excel, CSV, Word o HTML/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Segundo formato: tabla de Word "NOTIFICACIÓN POR ESTADO DEL ...", un
// registro por línea, la clase junto al número corto y la fecha en letras.
// Word parte palabras en varios textos pegados: se arman igual aquí.
async function armarEstadoWord(registros) {
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.addPage([936, 612]);
  const t = (texto, x, y, size = 9) => p.drawText(texto, { x, y, size, font: f });
  // Pedazos seguidos sin hueco, como los deja Word.
  const pegados = (partes, x, y) => partes.forEach((s) => {
    t(s, x, y);
    x += f.widthOfTextAtSize(s, 9);
  });
  t("JUZGADO PROMISCUO MUNICIPAL DE PRUEBA", 325, 516, 11);
  pegados(["NOTIFICACIÓN POR ESTADO DEL 3 DE O", "CTU", "BRE DE 2024"], 289, 486);
  [["PROCESO", 90], ["DEMANDANTE", 255], ["DEMANDADO", 454], ["ACTUACIÓN", 638], ["FECHA AUTO", 777], ["CDNO", 876]].forEach(([s, x]) => t(s, x, 472));
  let y = 454;
  for (const r of registros) {
    pegados(r.proceso, 40, y);
    pegados(r.demandante, 199, y);
    t(r.demandado, 393, y);
    pegados(r.actuacion, 592, y);
    t(r.fecha, 755, y);
    t(r.cdno, 888, y);
    y -= 15;
  }
  t("De conformidad con lo previsto en el artículo 295 del Código General del Proceso, se NOTIFICA a las partes los autos proferidos", 40, y - 11);
  t("presente ESTADO, el cual se fija en la secretaría por el término legal de un (1) día.", 40, y - 23);
  return Buffer.from(await pdf.save());
}

test("estado de Word: clase junto al número corto, fecha en letras, palabras partidas y pie", async () => {
  const pdf = await armarEstadoWord([
    { proceso: ["Pertenencia No 20", "21", "-", "00060"], demandante: ["ANA PRUEBA JIMÉNE", "Z L."], demandado: "PERSONAS INDETERMINADAS", actuacion: ["Ordena desarchivar"], fecha: "2 de octubre de 2024", cdno: "1." },
    { proceso: ["S", "i", "mulación No 2023", "-", "00119"], demandante: ["BETO INVENTADO"], demandado: "CARLA FALSA DE PRUEBA", actuacion: ["S", "eñala nueva fecha"], fecha: "2 de octubre de 2024", cdno: "1 y 2." },
    { proceso: ["D. Comisorio No 0923DG", "-", "134"], demandante: ["BANCO DE PRUEBA S.A."], demandado: "DIANA EJEMPLO", actuacion: ["Señala fecha para remate"], fecha: "1 de septiembre de 2024", cdno: "1." },
  ]);
  const r = await leer(pdf);
  assert.equal(r.filas.length, 3);
  assert.deepEqual(r.meta, { paginas: 1, juzgado: "JUZGADO PROMISCUO MUNICIPAL DE PRUEBA", fecha: "03/10/2024", tipo: "estado" });
  const [a, b, c] = r.filas;
  assert.equal(a.clase, "Pertenencia");
  assert.equal(a.radicadoTexto, "2021-00060");
  assert.equal(a.radicado, "", "sin despacho no hay radicado de 23 dígitos");
  assert.equal(a.demandante, "ANA PRUEBA JIMÉNEZ L.");
  assert.equal(a.demandado, "PERSONAS INDETERMINADAS");
  assert.equal(a.actuacion, "Ordena desarchivar");
  assert.equal(a.anotacion, "");
  assert.equal(a.fecha, "02/10/2024");
  assert.equal(a.cuaderno, "1");
  assert.equal(a.confianza, "media");
  assert.equal(a.avisos.length, 1);
  assert.match(a.avisos[0], /número corto/);
  assert.equal(b.clase, "Simulación");
  assert.equal(b.actuacion, "Señala nueva fecha");
  assert.equal(b.cuaderno, "1 y 2");
  assert.equal(c.clase, "D. Comisorio");
  assert.equal(c.radicadoTexto, "0923DG-134");
  assert.equal(c.fecha, "01/09/2024");
  // El pie no se pega a la última fila.
  assert.equal(c.demandado, "DIANA EJEMPLO");
  assert.match(r.notas.map((n) => n.texto).join(" "), /artículo 295/);
  assert.deepEqual(marcarSeguidos(r.filas, ["11001311002220220083900"]).map((f) => f.seguido), [false, false, false]);
});

test("fecha en letras, cuaderno CDNO y fecha del estado en el título", () => {
  assert.equal(fechaLarga("2 de octubre de 2024"), "02/10/2024");
  assert.equal(fechaLarga("15 de Setiembre del 2023"), "15/09/2023");
  assert.equal(fechaLarga("2 de octubrx de 2024"), "");
  assert.equal(columnaDeTitulo("CDNO"), "cuaderno");
  assert.equal(metaDeTexto("NOTIFICACIÓN POR ESTADO DEL 3 DE OCTUBRE DE 2024").fecha, "03/10/2024");
});

// Tercera forma: reporte de Justicia XXI ("FIJACIÓN DE ESTADOS"). Radicado
// entero en una línea, celdas de varias líneas, una sola columna
// "Auto / Anotación" y al pie el número de registros y la secretaría.
async function armarEstadoXXI(registros, { total = registros.length } = {}) {
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.addPage([792, 612]);
  const t = (texto, x, y, size = 8) => p.drawText(texto, { x, y, size, font: f });
  t("REPUBLICA DE COLOMBIA - RAMA JUDICIAL DEL PODER PUBLICO", 228, 544, 10);
  t("Juzgado De Circuito - Civil Laboral 007 Pruebaville", 282, 516);
  t("Estado No.", 248, 495);
  t("88", 309, 495);
  t("De", 343, 495);
  t("Lunes, 3 De Junio De 2024", 363, 495);
  t("FIJACIÓN DE ESTADOS", 285, 475, 10);
  [["Radicación", 67], ["Clase", 194], ["Demandante", 276], ["Demandado", 391], ["Fecha Auto", 479], ["Auto / Anotación", 559]].forEach(([s, x]) => t(s, x, 458, 10));
  let y = 442;
  for (const r of registros) {
    t(r.rad, 35, y, 9);
    r.clase.forEach((l, k) => t(l, 167, y - 11 * k, 9));
    r.demandante.forEach((l, k) => t(l, 252, y - 11 * k, 9));
    r.demandado.forEach((l, k) => t(l, 365, y - 11 * k, 9));
    t(r.fecha, 481, y, 9);
    r.auto.forEach((l, k) => t(l, 537, y - 11 * k, 9));
    y -= 12 + 11 * Math.max(r.clase.length, r.demandante.length, r.demandado.length, r.auto.length);
  }
  t("Número de Registros:", 25, y - 20, 7);
  t(String(total), 109, y - 20, 7);
  t("En la fecha lunes, 3 de junio de 2024, se fija el presente estado por el término legal, al iniciar la jornada establecida para el despacho judicial", 25, y - 40, 8);
  t("PEDRO PRUEBA FALSO", 318, y - 80);
  t("Secretaría", 374, y - 96);
  return Buffer.from(await pdf.save());
}

test("estado de Justicia XXI: radicado entero, columna Auto / Anotación y total de registros", async () => {
  const regs = [
    { rad: "99001310500720230004300", clase: ["Ejecutivo"], demandante: ["Empresa Inventada", "S.A.S"], demandado: ["Beto De Prueba"], fecha: "31/05/2024", auto: ["Auto Pone En", "Conocimiento - Pone En", "Conocimiento Oficio"] },
    { rad: "99001310500720240001200", clase: ["Procesos", "Verbales"], demandante: ["Ana Falsa Uno Y Otros"], demandado: ["Cooperativa De", "Mentira Ltda."], fecha: "31/05/2024", auto: ["Auto Decide - Accede A", "Solicitud - Suspende", "Proceso"] },
    { rad: "99001310500720240001300", clase: ["Procesos", "Ejecutivos"], demandante: ["Carla Inventada"], demandado: ["Diana Ejemplo"], fecha: "31/05/2024", auto: ["Auto Admite Demanda"] },
  ];
  const r = await leer(await armarEstadoXXI(regs));
  assert.equal(r.filas.length, 3);
  assert.deepEqual(r.meta, { paginas: 1, juzgado: "Juzgado De Circuito - Civil Laboral 007 Pruebaville", estado: "88", fecha: "03/06/2024", tipo: "estado", secretario: "PEDRO PRUEBA FALSO", registros: 3 });
  const [a, b, c] = r.filas;
  assert.equal(a.radicado, "99001310500720230004300");
  assert.equal(a.demandante, "Empresa Inventada S.A.S");
  assert.equal(a.actuacion, "Auto Pone En Conocimiento");
  assert.equal(a.anotacion, "Pone En Conocimiento Oficio");
  assert.equal(a.fecha, "31/05/2024");
  assert.equal(a.confianza, "alta");
  assert.equal(b.clase, "Procesos Verbales");
  assert.equal(b.demandado, "Cooperativa De Mentira Ltda.");
  assert.equal(b.actuacion, "Auto Decide");
  assert.equal(b.anotacion, "Accede A Solicitud - Suspende Proceso");
  assert.deepEqual([c.actuacion, c.anotacion], ["Auto Admite Demanda", ""]);
  assert.deepEqual(r.avisos, []);
  assert.match(r.notas.map((n) => n.texto).join(" "), /Número de Registros/);
  // El pie dice más registros de los que se leyeron: se avisa.
  const corto = await leer(await armarEstadoXXI(regs.slice(0, 2), { total: 3 }));
  assert.match(corto.avisos.join(" "), /dice 3 registros y se leyeron 2/);
});

test("columna de solo números cortos y tabla con Auto / Anotación", async () => {
  assert.equal(columnaDeTitulo("Auto / Anotación"), "descripcion");
  const t = leerTabla([["Radicado", "Demandante", "Auto / Anotación", "Fecha"], ["2024-00012", "ANA FALSA", "Auto Decide - Fija fecha", "4 de marzo de 2024"]]);
  const f = t.filas[0];
  assert.deepEqual([f.actuacion, f.anotacion, f.fecha], ["Auto Decide", "Fija fecha", "04/03/2024"]);
});
