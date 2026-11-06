import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import {
  CLAVE_CODIGO,
  MENSAJE_CODIGO,
  MENSAJE_NO_COMPARTIDO,
  MENSAJE_PLAN,
  MENSAJE_PRIVADO,
  MENSAJE_SOLO_LOCAL,
  armarEstado,
  directorioDatosInstalado,
  lineaEmparejar,
  puedeCompartir,
  rutaSocket,
  textoEstado,
} from "../compartido/mcp.js";
import { planAbierto } from "../compartido/plan.js";
import {
  MENSAJE_CERRADO,
  errorDeSolicitud,
  lineaEmparejar as lineaDelRelevo,
  rutaRelevo,
} from "../mcpb/server/relevo.js";
import { abrirBase, iniciarRevision, leerAjuste, run, terminarRevision, uno } from "../src/db.js";
import { fotoLicencia, guardarCaja } from "../src/licencia.js";
import {
  codigoCoincide,
  compartirCaso,
  conectorActivo,
  escucharConector,
  filtrarCaso,
  guardarInterruptor,
  huellaCodigo,
  opcionesDeEscucha,
  regenerarCodigo,
  registrarMcp,
} from "../src/mcp.js";

const RELEVO = new URL("../mcpb/server/relevo.js", import.meta.url);
const CODIGO = "a".repeat(24);
const OTRO = "b".repeat(24);

function temporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-mcp-"));
  return {
    dir,
    ruta: path.join(dir, "mcp.sock"),
    borrar() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function fotoPrueba() {
  return { estado: "prueba", diasRestantes: 12 };
}

async function conCliente(ruta, fn, { codigo = CODIGO } = {}) {
  const cliente = new Client({ name: "prueba-vigencia", version: "0.0.0" });
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: [RELEVO.pathname],
    env: { ...getDefaultEnvironment(), VIGENCIA_SOCK: ruta, VIGENCIA_CODIGO: codigo },
    stderr: "pipe",
  });
  let errorRelevo = "";
  transporte.stderr?.on("data", (chunk) => {
    errorRelevo += chunk.toString("utf8");
  });
  try {
    await cliente.connect(transporte);
    return await fn(cliente);
  } catch (error) {
    const detalle = errorRelevo.trim();
    if (detalle && !String(error.message || "").includes(detalle)) error.message = `${error.message}\n${detalle}`;
    throw error;
  } finally {
    await cliente.close().catch(() => {});
  }
}

function ipcFalso() {
  const handlers = new Map();
  return {
    handlers,
    handle(nombre, fn) {
      handlers.set(nombre, fn);
    },
  };
}

test("la ruta del socket coincide en la app y en el relevo", () => {
  assert.equal(rutaSocket({ plataforma: "linux", datosDir: "/datos", usuario: "ana" }), "/datos/mcp.sock");
  assert.equal(
    rutaSocket({ plataforma: "win32", datosDir: "C:\\datos", usuario: "Ana Pérez" }),
    "\\\\.\\pipe\\vigencia-mcp-Ana Pérez",
  );
  assert.equal(rutaRelevo({ VIGENCIA_SOCK: "/tmp/mio.sock" }, "linux"), "/tmp/mio.sock");
  assert.equal(
    rutaRelevo({ HOME: "/home/ana", VIGENCIA_DATOS: "/home/ana/.config/Vigencia" }, "linux"),
    "/home/ana/.config/Vigencia/mcp.sock",
  );
  assert.equal(
    directorioDatosInstalado({ plataforma: "darwin", env: { HOME: "/Users/ana" } }),
    "/Users/ana/Library/Application Support/Vigencia",
  );
  assert.equal(rutaRelevo({ USERNAME: "ana" }, "win32"), "\\\\.\\pipe\\vigencia-mcp-ana");
  assert.equal(lineaDelRelevo("codigo"), lineaEmparejar("codigo"));
  assert.deepEqual(opcionesDeEscucha("\\\\.\\pipe\\vigencia-mcp-ana", "win32"), {
    path: "\\\\.\\pipe\\vigencia-mcp-ana",
    readableAll: false,
    writableAll: false,
  });
});

test("el estado se arma con el plan y los conteos", () => {
  const estado = armarEstado({ version: "3.10.1", plan: "prueba", diasRestantes: 12 });
  assert.equal(estado.plan, "prueba");
  assert.equal(estado.dias_restantes, 12);
  assert.equal(estado.procesos_compartidos, 0);
  assert.match(textoEstado(estado), /Vigencia 3\.10\.1/);
  assert.equal(armarEstado({ version: "1", plan: "vigente", diasRestantes: 4 }).dias_restantes, null);
});

test("sin Vigencia el relevo responde que hay que abrirla", () => {
  const linea = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize", params: {} });
  const respuesta = JSON.parse(errorDeSolicitud(linea, MENSAJE_CERRADO));
  assert.equal(respuesta.id, 7);
  assert.equal(respuesta.error.message, "Abra Vigencia para usar el conector");
  assert.equal(errorDeSolicitud('{"jsonrpc":"2.0","method":"notifications/initialized"}', MENSAJE_CERRADO), null);
});

test("el código se guarda solo como huella y el interruptor nace apagado", () => {
  const tmp = temporal();
  const db = abrirBase(path.join(tmp.dir, "grokvig.sqlite"));
  try {
    assert.equal(conectorActivo(db), false);
    const codigo = regenerarCodigo(db);
    assert.equal(/^[A-Za-z0-9_-]{24}$/.test(codigo), true);
    const huella = leerAjuste(db, CLAVE_CODIGO);
    assert.equal(huella, huellaCodigo(codigo));
    assert.equal(codigoCoincide(codigo, huella), true);
    assert.equal(codigoCoincide(OTRO, huella), false);
    assert.equal(fs.readFileSync(path.join(tmp.dir, "grokvig.sqlite")).includes(codigo), false);
    const nuevo = regenerarCodigo(db);
    assert.notEqual(leerAjuste(db, CLAVE_CODIGO), huella);
    assert.equal(codigoCoincide(codigo, leerAjuste(db, CLAVE_CODIGO)), false);
    assert.equal(/^[A-Za-z0-9_-]{24}$/.test(nuevo), true);
  } finally {
    db.close();
    tmp.borrar();
  }
});

describe("conector en marcha", { concurrency: 1 }, () => {
  test("un cliente del SDK recibe estado_vigencia por el relevo", { timeout: 20000 }, async () => {
    const tmp = temporal();
    const db = abrirBase(path.join(tmp.dir, "grokvig.sqlite"));
    const id = iniciarRevision(db, { origen: "automatica", inicio: "2026-11-06T12:00:00.000Z" });
    terminarRevision(db, id, { fin: "2026-11-06T12:05:00.000Z", revisados: 3 });
    const conector = await escucharConector({
      ruta: tmp.ruta,
      version: "3.10.1",
      foto: fotoPrueba,
      ultima: () => "2026-11-06T12:05:00.000Z",
      aceptarCodigo: (valor) => valor === CODIGO,
    });
    try {
      assert.equal(fs.statSync(tmp.ruta).mode & 0o777, 0o600);
      const resultado = await conCliente(tmp.ruta, async (cliente) => {
        const lista = await cliente.listTools();
        assert.ok(lista.tools.some((herramienta) => herramienta.name === "estado_vigencia"));
        return cliente.callTool({ name: "estado_vigencia", arguments: {} });
      });
      assert.notEqual(resultado.isError, true);
      assert.equal(resultado.structuredContent.version, "3.10.1");
      assert.equal(resultado.structuredContent.plan, "prueba");
      assert.equal(resultado.structuredContent.dias_restantes, 12);
      assert.equal(resultado.structuredContent.procesos_compartidos, 0);
      assert.equal(resultado.structuredContent.proyectos_compartidos, 0);
      assert.equal(resultado.structuredContent.ultima_revision, "2026-11-06T12:05:00.000Z");
      assert.match(resultado.content[0].text, /Vigencia 3\.10\.1/);
    } finally {
      conector.cerrar();
      db.close();
      tmp.borrar();
    }
  });

  test("un código distinto no entra", { timeout: 15000 }, async () => {
    const tmp = temporal();
    const conector = await escucharConector({
      ruta: tmp.ruta,
      aceptarCodigo: (valor) => valor === CODIGO,
    });
    try {
      await assert.rejects(
        () => conCliente(tmp.ruta, async (cliente) => cliente.listTools(), { codigo: OTRO }),
        (error) => {
          assert.match(String(error?.message || error), /código de emparejamiento no coincide/);
          assert.equal(String(error?.message || "").includes(OTRO), false);
          return true;
        },
      );
    } finally {
      conector.cerrar();
      tmp.borrar();
    }
  });

  test("con el interruptor apagado el relevo pide abrir Vigencia", { timeout: 15000 }, async () => {
    const tmp = temporal();
    const db = abrirBase(path.join(tmp.dir, "grokvig.sqlite"));
    try {
      assert.equal(conectorActivo(db), false);
      guardarInterruptor(db, true);
      regenerarCodigo(db);
      let conector = await escucharConector({
        ruta: tmp.ruta,
        foto: fotoPrueba,
        aceptarCodigo: (valor) => codigoCoincide(valor, leerAjuste(db, CLAVE_CODIGO)),
      });
      assert.equal(fs.existsSync(tmp.ruta), true);
      guardarInterruptor(db, false);
      conector.cerrar();
      conector = null;
      assert.equal(fs.existsSync(tmp.ruta), false);
      await assert.rejects(
        () => conCliente(tmp.ruta, async (cliente) => cliente.listTools()),
        (error) => {
          assert.match(String(error?.message || error), /Abra Vigencia para usar el conector/);
          return true;
        },
      );
    } finally {
      db.close();
      tmp.borrar();
    }
  });

  test("con el plan cerrado la herramienta pide renovar", { timeout: 20000 }, async () => {
    const tmp = temporal();
    guardarCaja(tmp.dir, {
      id: "ab".repeat(32),
      token: "",
      visto: "2026-11-06T00:00:00.000Z",
      inicio: "2020-01-01T00:00:00.000Z",
    });
    const cerrado = fotoLicencia(tmp.dir);
    assert.equal(planAbierto(cerrado.estado), false);
    const conector = await escucharConector({
      ruta: tmp.ruta,
      version: "3.10.1",
      foto: () => fotoLicencia(tmp.dir),
      aceptarCodigo: (valor) => valor === CODIGO,
    });
    try {
      const resultado = await conCliente(tmp.ruta, (cliente) => cliente.callTool({
        name: "estado_vigencia",
        arguments: {},
      }));
      assert.equal(resultado.isError, true);
      assert.equal(resultado.content[0].text, MENSAJE_PLAN);
    } finally {
      conector.cerrar();
      tmp.borrar();
    }
  });

  test("al encender se muestra el código una vez y el estado no lo repite", { timeout: 15000 }, async () => {
    const tmp = temporal();
    const db = abrirBase(path.join(tmp.dir, "grokvig.sqlite"));
    const ipc = ipcFalso();
    const registrado = registrarMcp({
      ipcMain: ipc,
      db: () => db,
      datosDir: () => tmp.dir,
      version: "3.10.1",
      mensajeHumano: (error) => error.message,
    });
    try {
      const apagado = await ipc.handlers.get("mcp-estado")();
      assert.equal(apagado.activo, false);
      assert.equal(apagado.tieneCodigo, false);
      assert.equal(Object.hasOwn(apagado, "codigo"), false);
      const encendido = await ipc.handlers.get("mcp-interruptor")({}, { activo: true });
      assert.equal(encendido.ok, true);
      assert.equal(encendido.activo, true);
      assert.equal(/^[A-Za-z0-9_-]{24}$/.test(encendido.codigo), true);
      assert.equal(fs.statSync(path.join(tmp.dir, "mcp.sock")).mode & 0o777, 0o600);
      assert.equal(fs.readFileSync(path.join(tmp.dir, "grokvig.sqlite")).includes(encendido.codigo), false);
      const otraVez = await ipc.handlers.get("mcp-estado")();
      assert.equal(otraVez.activo, true);
      assert.equal(Object.hasOwn(otraVez, "codigo"), false);
      const regenerado = await ipc.handlers.get("mcp-regenerar")();
      assert.equal(/^[A-Za-z0-9_-]{24}$/.test(regenerado.codigo), true);
      assert.notEqual(regenerado.codigo, encendido.codigo);
      assert.equal(codigoCoincide(encendido.codigo, leerAjuste(db, CLAVE_CODIGO)), false);
      const apagar = await ipc.handlers.get("mcp-interruptor")({}, { activo: false });
      assert.equal(apagar.activo, false);
      assert.equal(Object.hasOwn(apagar, "codigo"), false);
      assert.equal(fs.existsSync(path.join(tmp.dir, "mcp.sock")), false);
    } finally {
      await registrado.cerrar();
      db.close();
      tmp.borrar();
    }
  });

  test("un caso no compartido, privado o en solo local no sale", { timeout: 20000 }, async () => {
    const tmp = temporal();
    const db = abrirBase(path.join(tmp.dir, "grokvig.sqlite"));
    const ahora = "2026-11-06T12:00:00.000Z";
    run(db, "INSERT INTO radicado (numero) VALUES ('11001000000020260000001')");
    run(db, "INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (10, '11001000000020260000001', 0)");
    run(db, "INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (11, '11001000000020260000001', 1)");
    run(db, "INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (12, '11001000000020260000001', 0)");
    run(db, "INSERT INTO doc_proyecto (nombre, creado_en, actualizado_en, solo_local) VALUES ('Abierto', ?, ?, 0)", [ahora, ahora]);
    run(db, "INSERT INTO doc_proyecto (nombre, creado_en, actualizado_en, solo_local) VALUES ('Local', ?, ?, 1)", [ahora, ahora]);
    const abierto = uno(db, "SELECT id FROM doc_proyecto WHERE nombre = 'Abierto'");
    const local = uno(db, "SELECT id FROM doc_proyecto WHERE nombre = 'Local'");
    assert.equal(puedeCompartir({ tipo: "proyecto", soloLocal: true }).ok, false);
    assert.equal(puedeCompartir({ tipo: "proceso", esPrivado: true }).error, MENSAJE_PRIVADO);
    assert.throws(() => compartirCaso(db, { tipo: "proceso", clave: "cn:11" }), (error) => error.message === MENSAJE_PRIVADO);
    assert.throws(() => compartirCaso(db, { tipo: "proyecto", clave: String(local.id) }), (error) => error.message === MENSAJE_SOLO_LOCAL);
    run(db, "INSERT INTO mcp_permiso (tipo, clave_o_id, nivel, creado_en) VALUES ('proceso', 'cn:11', 'lectura', ?)", [ahora]);
    run(db, "INSERT INTO mcp_permiso (tipo, clave_o_id, nivel, creado_en, vence) VALUES ('proceso', 'cn:12', 'lectura', ?, '2020-01-01T00:00:00.000Z')", [ahora]);
    run(db, "INSERT INTO mcp_permiso (tipo, clave_o_id, nivel, creado_en) VALUES ('proyecto', ?, 'proponer', ?)", [String(local.id), ahora]);
    assert.equal(filtrarCaso(db, { tipo: "proceso", clave: "cn:10" }, ahora).ok, false);
    assert.equal(filtrarCaso(db, { tipo: "proceso", clave: "cn:10" }, ahora).error, MENSAJE_NO_COMPARTIDO);
    assert.equal(filtrarCaso(db, { tipo: "proceso", clave: "cn:11" }, ahora).ok, false);
    assert.equal(filtrarCaso(db, { tipo: "proceso", clave: "cn:12" }, ahora).ok, false);
    assert.equal(filtrarCaso(db, { tipo: "proyecto", clave: String(local.id) }, ahora).ok, false);
    const ipc = ipcFalso();
    const registrado = registrarMcp({
      ipcMain: ipc,
      db: () => db,
      datosDir: () => tmp.dir,
      version: "3.10.1",
      mensajeHumano: (error) => error.message,
    });
    try {
      assert.equal(Number(uno(db, "SELECT COUNT(*) AS n FROM schema_migracion").n), 23);
      const privado = await ipc.handlers.get("mcp-compartir")({}, { tipo: "proceso", clave: "cn:11", nivel: "lectura" });
      assert.equal(privado.ok, false);
      assert.equal(privado.error, MENSAJE_PRIVADO);
      const solo = await ipc.handlers.get("mcp-compartir")({}, { tipo: "proyecto", clave: String(local.id) });
      assert.equal(solo.ok, false);
      assert.equal(solo.error, MENSAJE_SOLO_LOCAL);
      const encendido = await ipc.handlers.get("mcp-interruptor")({}, { activo: true });
      const proceso = await ipc.handlers.get("mcp-compartir")({}, { tipo: "proceso", clave: "cn:10", nivel: "lectura" });
      const proyecto = await ipc.handlers.get("mcp-compartir")({}, { tipo: "proyecto", clave: String(abierto.id), nivel: "proponer" });
      assert.equal(proceso.ok, true);
      assert.equal(proyecto.ok, true);
      const ver = (codigo) => conCliente(path.join(tmp.dir, "mcp.sock"), (cliente) => cliente.callTool({
        name: "estado_vigencia",
        arguments: {},
      }), { codigo });
      const primero = await ver(encendido.codigo);
      assert.equal(primero.structuredContent.procesos_compartidos, 1);
      assert.equal(primero.structuredContent.proyectos_compartidos, 1);
      const dejar = await ipc.handlers.get("mcp-dejar")({}, { tipo: "proyecto", clave: String(abierto.id) });
      assert.equal(dejar.quitado, true);
      const segundo = await ver(encendido.codigo);
      assert.equal(segundo.structuredContent.proyectos_compartidos, 0);
      assert.equal(segundo.structuredContent.procesos_compartidos, 1);
      assert.equal(filtrarCaso(db, { tipo: "proyecto", clave: String(abierto.id) }, ahora).ok, false);
    } finally {
      await registrado.cerrar();
      db.close();
      tmp.borrar();
    }
  });
});

test("el mensaje del código queda fijo", () => {
  assert.equal(MENSAJE_CODIGO, "El código de emparejamiento no coincide. Genérelo de nuevo en Vigencia.");
  assert.equal(MENSAJE_PLAN, "Tu plan de Vigencia no está vigente. Renueva en Vigencia, Ajustes, Plan.");
});
