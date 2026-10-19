import assert from "node:assert/strict";
import test from "node:test";
import { cajaAPdf, parsearRangos, pdfACaja, pdfAPunto, puntoAPdf, tamanoVista } from "../compartido/pdftools.js";
import {
  PERMISOS, alternarCorte, cambiosPorPagina, cortesAPartes, cortesCada, cuantasGiradas, fuerzaClave, girarPaginas,
  diferenciaPalabras, indicesARangos, paginasDeTexto, parteDeCadaPagina, permisosP, porcentajeAhorro, resumenPermisos, sinMarcas, tamanoHumano,
} from "../compartido/pdfvisual.js";

test("los índices vuelven a rangos que parsearRangos entiende", () => {
  assert.equal(indicesARangos([0, 1, 2, 4]), "1-3, 5");
  assert.equal(indicesARangos([4, 0, 2, 1, 1]), "1-3, 5");
  assert.equal(indicesARangos([7]), "8");
  assert.equal(indicesARangos([]), "");
  assert.equal(indicesARangos([-1, 1.5, 3]), "4");
  const indices = [0, 2, 3, 4, 8, 9];
  assert.deepEqual(parsearRangos(indicesARangos(indices), 10).indices, indices);
});

test("los cortes parten el documento en partes seguidas", () => {
  assert.deepEqual(cortesAPartes(5, []), [{ desde: 1, hasta: 5, indices: [0, 1, 2, 3, 4] }]);
  assert.deepEqual(cortesAPartes(5, [3, 1]).map((p) => [p.desde, p.hasta]), [[1, 1], [2, 3], [4, 5]]);
  // Cortes fuera del documento o repetidos no cuentan.
  assert.deepEqual(cortesAPartes(4, [0, 4, 9, 2, 2]).map((p) => p.indices), [[0, 1], [2, 3]]);
  assert.deepEqual(cortesAPartes(0, [1]), []);
  assert.deepEqual(alternarCorte([2], 3, 6), [2, 3]);
  assert.deepEqual(alternarCorte([2, 3], 2, 6), [3]);
  assert.deepEqual(alternarCorte([2], 6, 6), [2]);
  assert.deepEqual(cortesCada(10, 3), [3, 6, 9]);
  assert.deepEqual(cortesCada(6, 3), [3]);
  assert.deepEqual(cortesCada(6, 0), []);
  assert.deepEqual(parteDeCadaPagina(cortesAPartes(5, [2])), [0, 0, 1, 1, 1]);
});

test("el giro de cada página se acumula y vuelve a cero", () => {
  let g = girarPaginas({}, [0, 2], 90);
  assert.deepEqual(g, { 0: 90, 2: 90 });
  g = girarPaginas(g, [0], -90);
  assert.deepEqual(g, { 2: 90 });
  g = girarPaginas(g, [2], 90);
  g = girarPaginas(g, [2], 90);
  assert.deepEqual(g, { 2: 270 });
  g = girarPaginas(g, [1], -90);
  assert.deepEqual(g, { 1: 270, 2: 270 });
  assert.equal(cuantasGiradas(g), 2);
  // No muta lo de antes: así deshacer es guardar el objeto viejo.
  const antes = { 0: 90 };
  girarPaginas(antes, [0], 90);
  assert.deepEqual(antes, { 0: 90 });
});

test("el ahorro de comprimir sale en porcentaje y el tamaño con coma", () => {
  assert.equal(porcentajeAhorro(1000, 400), 60);
  assert.equal(porcentajeAhorro(1000, 1000), 0);
  assert.equal(porcentajeAhorro(1000, 1100), -10);
  assert.equal(porcentajeAhorro(0, 10), 0);
  assert.equal(tamanoHumano(1572864), "1,5 MB");
  assert.equal(tamanoHumano(2048), "2 KB");
  assert.equal(tamanoHumano(10), "1 KB");
});

test("la fuerza de la contraseña castiga lo obvio", () => {
  assert.equal(fuerzaClave("").nivel, 0);
  assert.equal(fuerzaClave("abc").nivel, 1);
  assert.equal(fuerzaClave("12345678").nivel, 1);
  assert.equal(fuerzaClave("aaaaaaaaaaaa").nivel, 1);
  assert.equal(fuerzaClave("MiContraseña2026!").nivel, 1);
  assert.equal(fuerzaClave("tortuga").nivel, 1);
  assert.equal(fuerzaClave("tortugaverde").nivel, 2);
  assert.equal(fuerzaClave("Tortuga7verde").nivel, 4);
  assert.equal(fuerzaClave("Tortuga7").nivel, 3);
  assert.match(fuerzaClave("abc").consejo, /8 letras/);
  for (const c of ["", "x", "Tortuga7verde"]) assert.ok(fuerzaClave(c).texto);
});

test("los permisos dan el número P del PDF", () => {
  assert.equal(permisosP({}), -4);
  assert.equal(permisosP({ imprimir: true, copiar: true, modificar: true, comentar: true }), -4);
  const sinImprimir = permisosP({ imprimir: false });
  assert.equal(sinImprimir & 4, 0);
  assert.equal(sinImprimir & 2048, 0);
  assert.notEqual(sinImprimir & 16, 0);
  const nada = permisosP({ imprimir: false, copiar: false, modificar: false, comentar: false });
  for (const p of PERMISOS) for (const b of p.bits) assert.equal(nada & (1 << (b - 1)), 0);
  // Accesibilidad (bit 10) queda siempre.
  assert.notEqual(nada & 512, 0);
  assert.match(resumenPermisos({}), /hacer todo/);
  assert.match(resumenPermisos({ copiar: false }), /No puede copiar texto/);
  assert.equal(resumenPermisos({ copiar: false, modificar: false }).split(".").slice(0, 2).join("."), "Quien la abra puede imprimir y comentar o llenar formularios. No puede copiar texto ni cambiar páginas");
  assert.match(resumenPermisos({ imprimir: false, copiar: false, modificar: false, comentar: false }), /solo puede leerlo/);
});

test("la caja de un campo cae donde la dibuja pdfjs, con cualquier giro", () => {
  const base = { x0: 10, y0: 20, ancho: 600, alto: 800 };
  for (const rotacion of [0, 90, 180, 270]) {
    const pagina = { ...base, rotacion };
    for (const [u, v] of [[0, 0], [100, 50], [37, 412]]) {
      const p = puntoAPdf(u, v, pagina);
      const q = pdfAPunto(p.x, p.y, pagina);
      assert.ok(Math.abs(q.u - u) < 1e-9 && Math.abs(q.v - v) < 1e-9, `giro ${rotacion}`);
    }
    // Ida y vuelta: el /Rect que deja Firmar (cajaAPdf) vuelve a la misma caja.
    const caja = { x: 50, y: 70, w: 120, h: 30 };
    const esquina = cajaAPdf(caja, pagina);
    const otra = puntoAPdf(caja.x + caja.w, caja.y, pagina);
    const rect = { x: Math.min(esquina.x, otra.x), y: Math.min(esquina.y, otra.y), w: Math.abs(otra.x - esquina.x), h: Math.abs(otra.y - esquina.y) };
    const vuelta = pdfACaja(rect, pagina);
    for (const k of ["x", "y", "w", "h"]) assert.ok(Math.abs(vuelta[k] - caja[k]) < 1e-9, `giro ${rotacion} ${k}`);
    const t = tamanoVista(pagina);
    assert.ok(vuelta.x + vuelta.w <= t.ancho && vuelta.y + vuelta.h <= t.alto);
  }
  // Sin giro: el /Rect abajo a la izquierda queda arriba a la izquierda en pantalla.
  assert.deepEqual(pdfACaja({ x: 110, y: 720, w: 200, h: 20 }, { ...base, rotacion: 0 }), { x: 100, y: 80, w: 200, h: 20 });
});

test("comparar ubica cada cambio en su página", () => {
  const a = "<!-- pagina 1 -->\nPrimer párrafo igual.\n\nEste se quita.\n\n<!-- pagina 2 -->\nSegundo igual.\n\nEl plazo es de diez días.";
  const b = "<!-- pagina 1 -->\nPrimer párrafo igual.\n\n<!-- pagina 2 -->\nSegundo igual.\n\nEl plazo es de cinco días.\n\n<!-- pagina 3 -->\nUno nuevo al final.";
  assert.deepEqual(paginasDeTexto(a).map((p) => p.numero), [1, 2]);
  assert.equal(sinMarcas(a).includes("<!--"), false);
  const r = cambiosPorPagina(a, b);
  const quitado = r.cambios.find((c) => c.tipo === "quitado");
  const cambiado = r.cambios.find((c) => c.tipo === "cambiado");
  const agregado = r.cambios.find((c) => c.tipo === "agregado");
  assert.equal(quitado.paginaA, 1);
  assert.equal(quitado.paginaB, null);
  assert.equal(cambiado.paginaA, 2);
  assert.equal(cambiado.paginaB, 2);
  assert.equal(agregado.paginaB, 3);
  assert.deepEqual(r.porB, { 2: 1, 3: 1 });
  assert.deepEqual(r.porA, { 1: 1, 2: 1 });
  // Sin marcas (lector viejo) todo queda en la página 1.
  assert.equal(cambiosPorPagina("Hola.", "Chao.").cambios[0].paginaB, 1);
});

test("en un párrafo cambiado se marcan solo las palabras distintas", () => {
  const t = diferenciaPalabras("El plazo es de diez días hábiles.", "El plazo es de cinco días hábiles.");
  assert.deepEqual(t.filter((x) => x.tipo !== "igual"), [{ tipo: "quitado", texto: "diez" }, { tipo: "agregado", texto: "cinco" }]);
  assert.equal(t.filter((x) => x.tipo !== "agregado").map((x) => x.texto).join(""), "El plazo es de diez días hábiles.");
  assert.equal(t.filter((x) => x.tipo !== "quitado").map((x) => x.texto).join(""), "El plazo es de cinco días hábiles.");
  const largo = diferenciaPalabras("a ".repeat(700), "b ".repeat(700));
  assert.deepEqual(largo.map((x) => x.tipo), ["quitado", "agregado"]);
  assert.deepEqual(diferenciaPalabras("", "nuevo"), [{ tipo: "agregado", texto: "nuevo" }]);
});
