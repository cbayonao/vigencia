import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { armarEstado, directorioDatosInstalado, rutaSocket, textoEstado } from "../compartido/mcp.js";
import { escucharConector } from "../src/mcp.js";
import { MENSAJE_CERRADO, errorDeSolicitud, rutaRelevo } from "../mcpb/server/relevo.js";

const RELEVO = new URL("../mcpb/server/relevo.js", import.meta.url);

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

function consultarFijo() {
  return {
    version: "3.10.1",
    plan: "prueba",
    diasRestantes: 12,
    procesos: 0,
    proyectos: 0,
    ultimaRevision: null,
  };
}

async function conCliente(ruta, fn) {
  const cliente = new Client({ name: "prueba-vigencia", version: "0.0.0" });
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: [RELEVO.pathname],
    env: { ...getDefaultEnvironment(), VIGENCIA_SOCK: ruta },
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
    if (detalle) error.message = `${error.message}\n${detalle}`;
    throw error;
  } finally {
    await cliente.close().catch(() => {});
  }
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
});

test("el estado se arma con el plan y los conteos", () => {
  const estado = armarEstado(consultarFijo());
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

test("un cliente del SDK recibe estado_vigencia por el relevo", { timeout: 20000 }, async () => {
  const tmp = temporal();
  const conector = await escucharConector({ ruta: tmp.ruta, consultar: consultarFijo });
  try {
    assert.equal(fs.existsSync(tmp.ruta), true);
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
    assert.equal(resultado.structuredContent.ultima_revision, null);
    assert.match(resultado.content[0].text, /Vigencia 3\.10\.1/);
  } finally {
    await conector.cerrar();
    tmp.borrar();
  }
});

test("el relevo lanzado sin servidor contesta la solicitud", { timeout: 15000 }, async () => {
  const tmp = temporal();
  try {
    await assert.rejects(
      () => conCliente(tmp.ruta, async (cliente) => cliente.listTools()),
      (error) => {
        assert.match(String(error?.message || error), /Abra Vigencia para usar el conector/);
        return true;
      },
    );
  } finally {
    tmp.borrar();
  }
});
