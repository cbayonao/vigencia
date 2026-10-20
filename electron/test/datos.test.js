import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { BASE_SQL, COLUMNAS_PROCESO } from "../src/schema.js";
import { asegurarEnCsv, columnasDeRadicado } from "../src/csv.js";
import {
  abrirBase,
  asignarCliente,
  borrarCliente,
  borrarProceso,
  datosParaExcel,
  detalleProceso,
  filas,
  guardarCliente,
  guardarRepresentado,
  guardarInformeRevision,
  guardarPausaActualizar,
  leerInformeRevision,
  leerPausaActualizar,
  listarClientes,
  listarProcesos,
  uno,
} from "../src/db.js";
import { libroExcel } from "../src/excel.js";
import { bitacoraEn, guardarActuaciones } from "../src/guardar.js";
import { directorioDatos } from "../src/rutas.js";

function temporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-datos-"));
  return {
    dir,
    ruta: path.join(dir, "grokvig.sqlite"),
    borrar() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const NUMERO = "11001311001220220008900";

function sembrar(db) {
  db.prepare("INSERT INTO radicado (numero) VALUES (?)").run(NUMERO);
  db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado, fecha_ultima_actuacion) VALUES (7, ?, 0, '2026-10-09')").run(NUMERO);
}

test("la primera base queda en blanco y una que ya existe conserva sus expedientes", () => {
  const tmp = temporal();
  const nueva = abrirBase(tmp.ruta);
  assert.equal(Number(uno(nueva, "SELECT COUNT(*) AS n FROM proceso").n), 0);
  assert.equal(fs.existsSync(tmp.ruta), true);
  nueva.close();

  const conDatos = path.join(tmp.dir, "usuario.sqlite");
  const previa = abrirBase(conDatos);
  previa.prepare("INSERT INTO radicado (numero) VALUES (?)").run(NUMERO);
  previa.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado, despacho) VALUES (7, ?, 0, 'JUZGADO DEL USUARIO')").run(NUMERO);
  previa.close();

  const otra = abrirBase(conDatos);
  assert.equal(uno(otra, "SELECT despacho FROM proceso WHERE id_proceso = 7").despacho, "JUZGADO DEL USUARIO");
  assert.equal(Number(uno(otra, "SELECT COUNT(*) AS n FROM proceso").n), 1);
  otra.close();

  assert.equal(directorioDatos({ empaquetada: true, userData: "/datos", repo: "/repo", env: {} }), "/datos");
  assert.equal(directorioDatos({ empaquetada: false, userData: "/datos", repo: "/repo", env: {} }), "/repo");
  assert.equal(directorioDatos({ empaquetada: true, userData: "/datos", repo: "/repo", env: { VIGENCIA_DATOS: "/marcado" } }), "/marcado");
  tmp.borrar();
});

test("la migración agrega clientes y no borra expedientes", () => {
  const tmp = temporal();
  const previo = new DatabaseSync(tmp.ruta);
  previo.exec(BASE_SQL);
  for (const columna of COLUMNAS_PROCESO) previo.exec(`ALTER TABLE proceso ADD COLUMN ${columna} TEXT`);
  previo.prepare("INSERT INTO radicado (numero) VALUES (?)").run(NUMERO);
  previo.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (7, ?, 0)").run(NUMERO);
  previo.close();

  const db = abrirBase(tmp.ruta);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM proceso").n), 1);
  assert.ok(uno(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cliente'"));
  assert.ok(uno(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pausa_boton'"));
  assert.ok(uno(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'informe_revision'"));
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM schema_migracion").n), 20);
  guardarPausaActualizar(db, "2026-10-10 13:00:00");
  db.close();
  const otra = abrirBase(tmp.ruta);
  assert.equal(leerPausaActualizar(otra), "2026-10-10 13:00:00");
  guardarInformeRevision(otra, {
    total: 2,
    exitosos: 1,
    fallidos: 1,
    fallas: [{ radicado: NUMERO, despacho: "Juzgado", causa: "La Rama no respondió." }],
  });
  const informe = leerInformeRevision(otra);
  assert.equal(informe.total, 2);
  assert.equal(informe.exitosos, 1);
  assert.equal(informe.fallidos, 1);
  assert.equal(informe.fallas[0].causa, "La Rama no respondió.");
  assert.equal("id_proceso" in informe.fallas[0], false);
  assert.equal(Number(uno(otra, "SELECT COUNT(*) AS n FROM schema_migracion").n), 20);
  assert.equal(Number(uno(otra, "SELECT COUNT(*) AS n FROM proceso").n), 1);
  otra.close();
  tmp.borrar();
});

test("asignar, filtrar y borrar un cliente no borra el expediente", () => {
  const tmp = temporal();
  const db = abrirBase(tmp.ruta);
  sembrar(db);
  const id = guardarCliente(db, {
    nombre: "Ana",
    apellidos: "Pérez",
    telefonos: "300 111",
    direccion: "Calle 1",
    email: "ana@ejemplo.com",
    cedula: "123",
    tarjeta: "456",
  });
  asignarCliente(db, 7, id);
  assert.equal(listarClientes(db).find((c) => c.id === id).cedula, "123");
  assert.equal(listarClientes(db).find((c) => c.id === id).tarjeta, "456");
  assert.throws(() => guardarRepresentado(db, 8, { texto: "Nadie" }), /Asigne un abogado/);
  guardarRepresentado(db, 7, {
    texto: "Luis Parte",
    rol: "demandado",
    cedula: "999",
    direccion: "Calle 9",
    telefono: "300",
  });
  const lista = listarProcesos(db);
  assert.equal(lista.find((p) => p.id_proceso === 7).cliente_nombre, "Ana");
  assert.equal(lista.find((p) => p.id_proceso === 7).representado, "Luis Parte");
  assert.equal(detalleProceso(db, 7).cliente.representado_rol, "demandado");
  assert.equal(detalleProceso(db, 7).cliente.cedula, "123");
  assert.equal(detalleProceso(db, 7).cliente.representado_cedula, "999");
  assert.equal(detalleProceso(db, 7).cliente.representado_direccion, "Calle 9");
  assert.equal(detalleProceso(db, 7).cliente.representado_telefono, "300");
  const otro = guardarCliente(db, { nombre: "Luis" });
  asignarCliente(db, 7, otro);
  assert.equal(detalleProceso(db, 7).cliente.representado, "Luis Parte");
  assert.equal(detalleProceso(db, 7).cliente.representado_cedula, "999");
  guardarRepresentado(db, 7, { texto: "Un tercero", rol: "inventado" });
  assert.equal(detalleProceso(db, 7).cliente.representado, "Un tercero");
  assert.equal(detalleProceso(db, 7).cliente.representado_rol, null);
  borrarCliente(db, otro);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM proceso").n), 1);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM proceso_cliente").n), 0);
  assert.equal(listarProcesos(db).find((p) => p.id_proceso === 7).cliente_id, null);
  assert.throws(() => guardarCliente(db, { nombre: " ", email: "mal" }), /obligatorio/);
  db.close();
  tmp.borrar();
});

test("las actuaciones nuevas se comparan por id y la fecha no retrocede", () => {
  const tmp = temporal();
  const db = abrirBase(tmp.ruta);
  sembrar(db);
  const ctx = bitacoraEn(tmp.dir);
  const vieja = {
    idRegActuacion: 3,
    consActuacion: 1,
    fechaActuacion: "2020-01-01",
    actuacion: "Auto",
    anotacion: null,
    conDocumentos: false,
  };
  const reciente = { ...vieja, idRegActuacion: 4, consActuacion: 2, fechaActuacion: "2026-10-09", actuacion: "Agregar Memorial" };
  assert.equal(guardarActuaciones(db, 7, NUMERO, [vieja, reciente], true, false, ctx), 0);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM aviso").n), 0);
  assert.equal(uno(db, "SELECT fecha_ultima_actuacion AS fecha FROM proceso WHERE id_proceso = 7").fecha, "2026-10-09");
  assert.equal(guardarActuaciones(db, 7, NUMERO, [vieja], false, true, ctx), 0);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM actuacion").n), 2);
  const cambiada = { ...vieja, anotacion: "Llega un memorial" };
  assert.equal(guardarActuaciones(db, 7, NUMERO, [cambiada, reciente], true, true, ctx), 1);
  assert.equal(filas(db, "SELECT tipo FROM aviso").map((f) => f.tipo).includes("actuacion_actualizada"), true);
  assert.equal(guardarActuaciones(db, 7, NUMERO, [reciente], true, true, ctx), 1);
  assert.equal(filas(db, "SELECT tipo FROM aviso WHERE tipo = 'actuacion_retirada'").length, 1);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM actuacion").n), 1);
  db.close();
  tmp.borrar();
});

test("la lista no cuenta un radicado que no tiene expediente", () => {
  const tmp = temporal();
  const db = abrirBase(tmp.ruta);
  sembrar(db);
  db.prepare("INSERT INTO radicado (numero) VALUES ('25000418900120200012300')").run();
  const lista = listarProcesos(db);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].radicado, NUMERO);
  db.close();
  tmp.borrar();
});

test("la columna elegida reúne los radicados de 23 dígitos", () => {
  const contenido = [
    "CIUDAD,RADICADOS,NOTA",
    "Bogotá,11001311001220220008900,uno",
    "Cali,\"11001418901820190162700\n11001311001220220008900\",dos",
    "Medellín,123,corto",
    "Otra,proceso 11001400304720220003800 listo,tres",
  ].join("\n");
  const columnas = columnasDeRadicado(contenido);
  assert.equal(columnas[0].cantidad, 0);
  assert.equal(columnas[1].nombre, "RADICADOS");
  assert.deepEqual(columnas[1].numeros, [
    "11001311001220220008900",
    "11001418901820190162700",
    "11001400304720220003800",
  ]);
  assert.deepEqual(columnas[2].numeros, []);
});

test("borrar un expediente quita sus datos y deja los demás", () => {
  const tmp = temporal();
  const db = abrirBase(tmp.ruta);
  sembrar(db);
  const otro = "11001418901820190162700";
  db.prepare("INSERT INTO radicado (numero) VALUES (?)").run(otro);
  db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (8, ?, 0)").run(NUMERO);
  db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (9, ?, 0)").run(otro);
  db.prepare("INSERT INTO actuacion (id_reg_actuacion, id_proceso, radicado, fecha_actuacion, actuacion, con_documentos) VALUES (1, 7, ?, '2026-10-10', 'Auto', 0)").run(NUMERO);
  db.prepare("INSERT INTO sujeto (id_proceso, id_reg_sujeto, rol_base, nombre) VALUES (7, 1, 'demandante', 'Ana')").run();
  db.prepare("INSERT INTO aviso (creado_en, id_proceso, radicado, tipo, resumen) VALUES ('2026-10-10', 7, ?, 'actuacion_nueva', 'Auto')").run(NUMERO);
  const cliente = guardarCliente(db, { nombre: "Ana" });
  asignarCliente(db, 7, cliente);
  borrarProceso(db, 7);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM proceso WHERE id_proceso = 7").n), 0);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM actuacion WHERE id_proceso = 7").n), 0);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM sujeto WHERE id_proceso = 7").n), 0);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM proceso_cliente WHERE id_proceso = 7").n), 0);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM aviso WHERE id_proceso = 7").n), 0);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM proceso WHERE id_proceso = 8").n), 1);
  assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM proceso WHERE radicado = ?", [otro]).n), 1);
  assert.equal(uno(db, "SELECT nombre FROM cliente WHERE id = ?", [cliente]).nombre, "Ana");
  db.close();
  tmp.borrar();
});

test("el excel trae los expedientes pedidos y solo las actuaciones de hoy", () => {
  const tmp = temporal();
  const db = abrirBase(tmp.ruta);
  sembrar(db);
  db.prepare("UPDATE proceso SET despacho = ?, tipo_proceso = 'Ejecutivo' WHERE id_proceso = 7").run("Juzgado 1 & 2");
  db.prepare("INSERT INTO actuacion (id_reg_actuacion, id_proceso, radicado, consecutivo, fecha_actuacion, actuacion, con_documentos) VALUES (1, 7, ?, 2, '2026-10-10', 'Auto de hoy', 0)").run(NUMERO);
  db.prepare("INSERT INTO actuacion (id_reg_actuacion, id_proceso, radicado, consecutivo, fecha_actuacion, actuacion, con_documentos) VALUES (2, 7, ?, 1, '2026-10-09', 'Auto de ayer', 0)").run(NUMERO);
  const otro = "11001418901820190162700";
  db.prepare("INSERT INTO radicado (numero) VALUES (?)").run(otro);
  db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado, despacho) VALUES (9, ?, 0, 'Otro juzgado')").run(otro);
  db.prepare("INSERT INTO actuacion (id_reg_actuacion, id_proceso, radicado, fecha_actuacion, actuacion, con_documentos) VALUES (3, 9, ?, '2026-10-10', 'No entra', 0)").run(otro);
  const datos = datosParaExcel(db, [7, 7, "no"], "2026-10-10");
  const xml = libroExcel(datos);
  assert.equal(datos.procesos.length, 1);
  assert.equal(datos.actuaciones.length, 1);
  assert.match(xml, new RegExp(NUMERO));
  assert.match(xml, /Juzgado 1 &amp; 2/);
  assert.match(xml, /Auto de hoy/);
  assert.match(xml, /Del día/);
  assert.doesNotMatch(xml, /Auto de ayer/);
  assert.doesNotMatch(xml, /No entra/);
  assert.doesNotMatch(xml, /Otro juzgado/);
  db.close();
  tmp.borrar();
});

test("el csv solo agrega un radicado nuevo", () => {
  const primero = asegurarEnCsv("RADICADOS\n11001311001220220008900\n", NUMERO);
  assert.equal(primero.agregado, false);
  const segundo = asegurarEnCsv(primero.texto, "11001418904720250230700");
  assert.equal(segundo.agregado, true);
  assert.equal(segundo.texto.endsWith("11001418904720250230700\n"), true);
});
