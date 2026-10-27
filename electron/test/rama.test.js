import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { abrirBase, asignarCliente, guardarCliente, uno } from "../src/db.js";
import { lanzar, estadoCorrida, cancelarCorrida } from "../src/jobs.js";
import { ACTUACIONES_URL, CONSULTA_URL, ejecutarTrabajo, idsDeFallas, obtenerJson, textoErrorRespuesta } from "../src/rama.js";

const NUMERO = "11001418901820190162700";

function temporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-rama-"));
  const db = abrirBase(path.join(dir, "grokvig.sqlite"));
  return {
    dir,
    db,
    borrar() {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function ctxDe(pedir) {
  return {
    pedir,
    dormir: async () => {},
    log() {},
    aviso() {},
    notificar() {
      throw new Error("no debe avisar en esta prueba");
    },
  };
}

test("la consulta pública no lleva datos de la aplicación", async () => {
  const llamadas = [];
  const data = await obtenerJson(CONSULTA_URL, { numero: NUMERO, SoloActivos: "false", pagina: "1" }, ctxDe(async (url, params) => {
    llamadas.push({ url, params });
    return { status: 200, text: JSON.stringify({ procesos: [], paginacion: { cantidadPaginas: 1 } }) };
  }));
  assert.deepEqual(data.procesos, []);
  assert.equal(llamadas.length, 1);
  assert.deepEqual(Object.keys(llamadas[0].params).sort(), ["SoloActivos", "numero", "pagina"]);
  const vacio = await obtenerJson(`${ACTUACIONES_URL}/1`, { pagina: "1" }, ctxDe(async () => ({ status: 404, text: "no" })), true);
  assert.deepEqual(vacio, {});
});

test("agregar guarda el expediente y la revisión siguiente solo compara actuaciones", async () => {
  for (const archivo of ["rama.js", "guardar.js"]) {
    const fuente = fs.readFileSync(new URL(`../src/${archivo}`, import.meta.url), "utf8");
    assert.equal(/cliente|telefonos|apellidos|direccion/i.test(fuente), false);
  }
  const tmp = temporal();
  const llamadas = [];
  let actuaciones = [{
    idRegActuacion: 8,
    consActuacion: 1,
    fechaActuacion: "2026-02-02",
    actuacion: "Auto",
    anotacion: "",
    conDocumentos: false,
    llaveProceso: NUMERO,
  }];
  const pedir = async (url) => {
    llamadas.push(url);
    if (url.includes("NumeroRadicacion")) {
      return {
        status: 200,
        text: JSON.stringify({
          procesos: [{ idProceso: 15, despacho: "JUZGADO 001", sujetosProcesales: "Demandante: ANA | Demandado: LUIS" }],
          paginacion: { cantidadPaginas: 1, cantidadRegistros: 1 },
        }),
      };
    }
    if (url.includes("/Detalle/")) {
      return { status: 200, text: JSON.stringify({ llaveProceso: NUMERO, despacho: "JUZGADO 001", tipoProceso: "De Ejecución" }) };
    }
    if (url.includes("/Sujetos/")) {
      return {
        status: 200,
        text: JSON.stringify({
          sujetos: [{ idRegSujeto: 4, tipoSujeto: "Demandante", nombreRazonSocial: "ANA" }],
          paginacion: { cantidadPaginas: 1, cantidadRegistros: 1 },
        }),
      };
    }
    if (url.includes("/Documentos/")) return { status: 404, text: "no hay" };
    if (url.includes("/Actuaciones/")) {
      return {
        status: 200,
        text: JSON.stringify({
          actuaciones,
          paginacion: { cantidadPaginas: 1, cantidadRegistros: actuaciones.length },
        }),
      };
    }
    throw new Error(url);
  };
  const csv = `RADICADOS\n${NUMERO}\n`;
  const primero = await ejecutarTrabajo({
    db: tmp.db,
    csvTexto: csv,
    modo: "agregar",
    radicado: NUMERO,
    ctx: ctxDe(pedir),
    pedir,
    dormir: async () => {},
  });
  assert.equal(primero.codigo, 0);
  assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM aviso").n), 0);
  assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM actuacion").n), 1);
  const cliente = guardarCliente(tmp.db, { nombre: "Marta", apellidos: "Rojas" });
  asignarCliente(tmp.db, 15, cliente);
  actuaciones = [...actuaciones, { ...actuaciones[0], idRegActuacion: 9, consActuacion: 2, actuacion: "Traslado" }];
  const avisos = [];
  const segundo = await ejecutarTrabajo({
    db: tmp.db,
    csvTexto: csv,
    modo: "todo",
    ctx: { ...ctxDe(pedir), aviso(linea) { avisos.push(linea); }, notificar() {} },
    pedir,
    dormir: async () => {},
  });
  assert.equal(segundo.codigo, 0);
  assert.equal(segundo.cambios, 1);
  assert.equal(avisos.some((linea) => linea.includes("actuacion_nueva")), true);
  assert.equal(uno(tmp.db, "SELECT cliente_id AS id FROM proceso_cliente WHERE id_proceso = 15").id, cliente);
  assert.equal(llamadas.some((url) => /marta|rojas|cliente/i.test(url)), false);
  tmp.borrar();
});

test("la carga de un csv pide toda la información y espera entre peticiones", async () => {
  const tmp = temporal();
  const esperas = [];
  const llamadas = [];
  try {
    const resultado = await ejecutarTrabajo({
      db: tmp.db,
      modo: "carga",
      numeros: [NUMERO, `nota ${NUMERO}`],
      azar: () => 0,
      ctx: { log() {}, aviso() {}, notificar() {} },
      pedir: async (url) => {
        llamadas.push(url);
        if (url.includes("NumeroRadicacion")) {
          return {
            status: 200,
            text: JSON.stringify({
              procesos: [{ idProceso: 21, despacho: "JUZGADO 001", sujetosProcesales: "Demandante: ANA" }],
              paginacion: { cantidadPaginas: 1, cantidadRegistros: 1 },
            }),
          };
        }
        if (url.includes("/Detalle/")) return { status: 200, text: JSON.stringify({ llaveProceso: NUMERO, despacho: "JUZGADO 001" }) };
        if (url.includes("/Sujetos/")) {
          return { status: 200, text: JSON.stringify({ sujetos: [], paginacion: { cantidadPaginas: 1, cantidadRegistros: 0 } }) };
        }
        if (url.includes("/Documentos/")) return { status: 404, text: "no hay" };
        if (url.includes("/Actuaciones/")) {
          return { status: 200, text: JSON.stringify({ actuaciones: [], paginacion: { cantidadPaginas: 1, cantidadRegistros: 0 } }) };
        }
        throw new Error(url);
      },
      dormir: async (ms) => { esperas.push(ms); },
    });
    assert.equal(resultado.codigo, 0);
    assert.equal(llamadas.filter((url) => url.includes("NumeroRadicacion")).length, 1);
    assert.ok(llamadas.some((url) => url.includes("/Detalle/21")));
    assert.ok(llamadas.some((url) => url.includes("/Sujetos/21")));
    assert.ok(llamadas.some((url) => url.includes("/Documentos/21")));
    assert.ok(llamadas.some((url) => url.includes("/Actuaciones/21")));
    assert.ok(esperas.length >= 4);
    assert.ok(esperas.every((ms) => ms === 1000));
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM proceso").n), 1);
  } finally {
    tmp.borrar();
  }
});

test("actualizar todo espera entre 1 y 3 segundos entre peticiones", async () => {
  const tmp = temporal();
  const esperas = [];
  try {
    tmp.db.prepare("INSERT INTO radicado (numero) VALUES (?)").run(NUMERO);
    tmp.db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado, actuaciones_consultado_en) VALUES (4, ?, 0, '2026-01-01')").run(NUMERO);
    const resultado = await ejecutarTrabajo({
      db: tmp.db,
      csvTexto: `RADICADOS\n${NUMERO}\n`,
      modo: "todo",
      azar: () => 0.5,
      ctx: { log() {}, aviso() {}, notificar() {} },
      pedir: async () => ({
        status: 200,
        text: JSON.stringify({ actuaciones: [], paginacion: { cantidadPaginas: 1, cantidadRegistros: 0 } }),
      }),
      dormir: async (ms) => { esperas.push(ms); },
    });
    assert.equal(resultado.codigo, 0);
    assert.deepEqual(esperas, [2000]);
  } finally {
    tmp.borrar();
  }
});

test("el error del gateway se lee sin HTML y se reintenta con paciencia", async () => {
  const html502 = "<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>Microsoft-Azure-Application-Gateway/v2</center></body></html>";
  assert.equal(textoErrorRespuesta(html502), "502 Bad Gateway 502 Bad Gateway Microsoft-Azure-Application-Gateway/v2");
  assert.equal(textoErrorRespuesta(""), "");
  let llamadas = 0;
  const esperas = [];
  const ctx = {
    ...ctxDe(async () => {
      llamadas += 1;
      return { status: 502, text: html502 };
    }),
    dormir: async (ms) => { esperas.push(ms); },
  };
  await assert.rejects(obtenerJson(CONSULTA_URL, { numero: NUMERO }, ctx), /HTTP 502: 502 Bad Gateway/);
  assert.equal(llamadas, 4);
  assert.deepEqual(esperas, [2000, 5000, 15000, 15000]);
});

test("si el gateway se recupera, el reintento trae los datos", async () => {
  let llamadas = 0;
  const data = await obtenerJson(CONSULTA_URL, { numero: NUMERO }, ctxDe(async () => {
    llamadas += 1;
    if (llamadas < 3) return { status: 502, text: "<html><h1>502 Bad Gateway</h1></html>" };
    return { status: 200, text: JSON.stringify({ procesos: [] }) };
  }));
  assert.deepEqual(data.procesos, []);
  assert.equal(llamadas, 3);
});

test("si la consulta del radicado falla, el trabajo termina con error y no abre la red sola", async () => {
  const tmp = temporal();
  const resultado = await ejecutarTrabajo({
    db: tmp.db,
    csvTexto: `RADICADOS\n${NUMERO}\n`,
    modo: "agregar",
    radicado: NUMERO,
    ctx: ctxDe(async () => ({ status: 500, text: "falla" })),
    dormir: async () => {},
  });
  assert.equal(resultado.codigo, 1);
  let usoRed = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    usoRed = true;
    throw new Error("red");
  };
  try {
    tmp.db.prepare("INSERT OR IGNORE INTO radicado (numero) VALUES (?)").run(NUMERO);
    tmp.db.prepare("INSERT OR IGNORE INTO proceso (id_proceso, radicado, es_privado) VALUES (1, ?, 0)").run(NUMERO);
    const cerrado = await ejecutarTrabajo({
      db: tmp.db,
      csvTexto: "RADICADOS\n",
      modo: "todo",
      ctx: { log() {}, aviso() {} },
      dormir: async () => {},
    });
    assert.equal(usoRed, false);
    assert.equal(cerrado.codigo, 0);
    assert.ok(cerrado.errores >= 1);
  } finally {
    globalThis.fetch = original;
    tmp.borrar();
  }
});

test("se puede agregar un radicado mientras se actualizan las actuaciones", async () => {
  const tmp = temporal();
  let soltar;
  const espera = new Promise((resolver) => {
    soltar = resolver;
  });
  const pedir = async (url) => {
    if (url.includes("Actuaciones")) {
      await espera;
      return { status: 200, text: JSON.stringify({ actuaciones: [], paginacion: { cantidadPaginas: 1, cantidadRegistros: 0 } }) };
    }
    return { status: 404, text: "no" };
  };
  try {
    tmp.db.prepare("INSERT INTO radicado (numero) VALUES (?)").run(NUMERO);
    tmp.db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado, actuaciones_consultado_en) VALUES (3, ?, 0, '2026-01-01')").run(NUMERO);
    const dormir = async () => {};
    assert.equal(lanzar({ db: tmp.db, datosDir: tmp.dir, modo: "todo", pedir, dormir }), true);
    assert.equal(lanzar({ db: tmp.db, datosDir: tmp.dir, modo: "agregar", radicado: NUMERO, pedir, dormir }), true);
    assert.equal(lanzar({ db: tmp.db, datosDir: tmp.dir, modo: "agregar", radicado: NUMERO, pedir, dormir }), false);
    assert.equal(lanzar({ db: tmp.db, datosDir: tmp.dir, modo: "todo", pedir, dormir }), false);
    assert.equal(lanzar({ db: tmp.db, datosDir: tmp.dir, modo: "carga", numeros: [NUMERO], pedir, dormir }), false);
    assert.equal(estadoCorrida().revisando, true);
    assert.equal(estadoCorrida().agregando, true);
    soltar();
    for (let i = 0; i < 50 && estadoCorrida().corriendo; i += 1) {
      await new Promise((resolver) => setTimeout(resolver, 10));
    }
    assert.equal(estadoCorrida().corriendo, false);
  } finally {
    soltar();
    for (let i = 0; i < 50 && estadoCorrida().corriendo; i += 1) {
      await new Promise((resolver) => setTimeout(resolver, 10));
    }
    tmp.borrar();
  }
});

test("borrar el expediente durante la revisión no tumba la corrida", async () => {
  const tmp = temporal();
  try {
    tmp.db.prepare("INSERT INTO radicado (numero) VALUES (?)").run(NUMERO);
    tmp.db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado, actuaciones_consultado_en) VALUES (4, ?, 0, '2026-01-01')").run(NUMERO);
    const resultado = await ejecutarTrabajo({
      db: tmp.db,
      modo: "todo",
      ctx: { log() {}, aviso() {}, notificar() {} },
      pedir: async () => {
        tmp.db.prepare("DELETE FROM proceso WHERE id_proceso = 4").run();
        return { status: 200, text: JSON.stringify({ actuaciones: [{ idRegActuacion: 9, fechaActuacion: "2026-10-10", actuacion: "Auto" }], paginacion: { cantidadPaginas: 1, cantidadRegistros: 1 } }) };
      },
      dormir: async () => {},
    });
    assert.equal(resultado.codigo, 0);
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM proceso").n), 0);
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM actuacion").n), 0);
    assert.equal(resultado.informe.total, 0);
  } finally {
    tmp.borrar();
  }
});

test("el informe de actualizar todo cuenta exitosos y la causa de cada falla", async () => {
  const tmp = temporal();
  const otro = "11001311001220220008900";
  try {
    tmp.db.prepare("INSERT INTO radicado (numero) VALUES (?), (?)").run(NUMERO, otro);
    tmp.db.prepare("INSERT INTO proceso (id_proceso, radicado, despacho, es_privado) VALUES (1, ?, 'Juzgado Uno', 0), (2, ?, 'Juzgado Dos', 0)").run(NUMERO, otro);
    const resultado = await ejecutarTrabajo({
      db: tmp.db,
      modo: "todo",
      ctx: { log() {}, aviso() {}, notificar() {} },
      pedir: async (url) => {
        if (String(url).includes("/Actuaciones/2")) return { status: 500, text: "caida" };
        return { status: 200, text: JSON.stringify({ actuaciones: [], paginacion: { cantidadPaginas: 1, cantidadRegistros: 0 } }) };
      },
      dormir: async () => {},
    });
    assert.equal(resultado.informe.total, 2);
    assert.equal(resultado.informe.exitosos, 1);
    assert.equal(resultado.informe.fallidos, 1);
    assert.equal(resultado.informe.fallas[0].radicado, otro);
    assert.equal(resultado.informe.fallas[0].despacho, "Juzgado Dos");
    assert.equal(resultado.informe.fallas[0].causa, "La Rama no respondió.");
    assert.equal(JSON.stringify(resultado.informe).includes("idProceso"), false);
    assert.equal("id_proceso" in resultado.informe.fallas[0], false);
  } finally {
    tmp.borrar();
  }
});

test("se puede detener la búsqueda de un radicado y queda lo guardado", async () => {
  const tmp = temporal();
  try {
    let soltar = null;
    const puerta = new Promise((resolver) => { soltar = resolver; });
    let llamadas = 0;
    const pedir = async () => {
      llamadas += 1;
      await puerta;
      return { status: 200, text: JSON.stringify({ procesos: [], paginacion: { cantidadPaginas: 1 } }) };
    };
    assert.equal(lanzar({ db: tmp.db, datosDir: tmp.dir, modo: "agregar", radicado: NUMERO, pedir, dormir: async () => {} }), true);
    for (let i = 0; i < 50 && llamadas === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal(llamadas >= 1, true);
    assert.equal(cancelarCorrida("agregar"), true);
    assert.equal(cancelarCorrida("agregar"), true, "se puede volver a pedir mientras para");
    soltar();
    for (let i = 0; i < 100 && estadoCorrida().corriendo; i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal(estadoCorrida().corriendo, false);
    const foto = estadoCorrida().trabajos.agregar;
    assert.equal(foto.cancelada, true);
    assert.equal(foto.exit_code, 0);
    assert.equal(llamadas, 1, "no pide más a la Rama después de detener");
    assert.equal(cancelarCorrida("agregar"), false, "sin trabajo en curso no hay nada que detener");
  } finally {
    tmp.borrar();
  }
});

test("la revisión va en lotes de 50 con hasta 5 a la vez y orden del informe", async () => {
  const tmp = temporal();
  try {
    const N = 55;
    for (let i = 1; i <= N; i += 1) {
      const rad = `11001${String(30000000000000000 + i)}`;
      tmp.db.prepare("INSERT OR IGNORE INTO radicado (numero) VALUES (?)").run(rad);
      tmp.db.prepare("INSERT INTO proceso (id_proceso, radicado, despacho, es_privado) VALUES (?, ?, ?, 0)").run(i, rad, `Juzgado ${i}`);
    }
    let vivas = 0;
    let maxVivas = 0;
    let llamadas = 0;
    const resultado = await ejecutarTrabajo({
      db: tmp.db,
      modo: "todo",
      ctx: { log() {}, aviso() {}, notificar() {} },
      pedir: async (url) => {
        llamadas += 1;
        vivas += 1;
        maxVivas = Math.max(maxVivas, vivas);
        await new Promise((r) => setTimeout(r, 5));
        vivas -= 1;
        const m = String(url).match(/\/Actuaciones\/(\d+)/);
        const id = m ? Number(m[1]) : 0;
        if (id % 7 === 0) return { status: 500, text: "caida" };
        return { status: 200, text: JSON.stringify({ actuaciones: [{ idRegActuacion: id * 1000 + 1, fechaActuacion: "2026-10-10", actuacion: "Auto", consActuacion: 1, llaveProceso: "x" }], paginacion: { cantidadPaginas: 1, cantidadRegistros: 1 } }) };
      },
      dormir: async () => {},
    });
    assert.equal(resultado.codigo, 0);
    assert.equal(resultado.informe.total, N);
    assert.equal(resultado.informe.exitosos + resultado.informe.fallidos, N);
    assert.ok(maxVivas > 1 && maxVivas <= 5, `concurrencia acotada, fue ${maxVivas}`);
    const orden = resultado.informe.fallas.map((f) => f.radicado);
    assert.deepEqual(orden, [...orden].sort(), "las fallas salen en orden de radicado");
  } finally {
    tmp.borrar();
  }
});

test("reintentar fallidos solo consulta esos expedientes", async () => {
  const tmp = temporal();
  try {
    for (const [id, despacho] of [[1, "Juzgado Uno"], [2, "Juzgado Dos"], [3, "Juzgado Tres"]]) {
      const rad = `11001${String(30000000000000000 + id)}`;
      tmp.db.prepare("INSERT OR IGNORE INTO radicado (numero) VALUES (?)").run(rad);
      tmp.db.prepare("INSERT INTO proceso (id_proceso, radicado, despacho, es_privado) VALUES (?, ?, ?, 0)").run(id, rad, despacho);
    }
    const fallas = [
      { radicado: `11001${String(30000000000000000 + 2)}`, despacho: "Juzgado Dos", causa: "x" },
      { radicado: `11001${String(30000000000000000 + 3)}`, despacho: "Otro despacho", causa: "x" },
      { radicado: `11001${String(30000000000000000 + 3)}`, despacho: "Otro despacho", causa: "x" },
      { radicado: "11001999999999999999999", despacho: "Nadie", causa: "x" },
    ];
    assert.deepEqual(idsDeFallas(tmp.db, fallas), [2, 3]);
    assert.deepEqual(idsDeFallas(tmp.db, []), []);
    const tocados = [];
    const resultado = await ejecutarTrabajo({
      db: tmp.db,
      modo: "todo",
      ids: [2],
      ctx: { log() {}, aviso() {}, notificar() {} },
      pedir: async (url) => {
        tocados.push(url);
        return { status: 200, text: JSON.stringify({ actuaciones: [], paginacion: { cantidadPaginas: 1, cantidadRegistros: 0 } }) };
      },
      dormir: async () => {},
    });
    assert.equal(resultado.codigo, 0);
    assert.equal(resultado.informe.total, 1);
    assert.ok(tocados.some((u) => String(u).includes("/Actuaciones/2")));
    assert.ok(!tocados.some((u) => String(u).includes("/Actuaciones/1")));
    assert.ok(!tocados.some((u) => String(u).includes("/Actuaciones/3")));
  } finally {
    tmp.borrar();
  }
});

test("si la Rama bloquea, el informe marca lo que no se intentó", async () => {
  const tmp = temporal();
  const otro = "11001311001220220008900";
  let llamadas = 0;
  try {
    tmp.db.prepare("INSERT INTO radicado (numero) VALUES (?), (?)").run(NUMERO, otro);
    tmp.db.prepare("INSERT INTO proceso (id_proceso, radicado, despacho, es_privado) VALUES (1, ?, 'Juzgado Uno', 0), (2, ?, 'Juzgado Dos', 0)").run(NUMERO, otro);
    const resultado = await ejecutarTrabajo({
      db: tmp.db,
      modo: "todo",
      ctx: { log() {}, aviso() {}, notificar() {} },
      pedir: async (url) => {
        llamadas += 1;
        assert.equal(String(url).includes("/Actuaciones/2"), false);
        return { status: 403, text: "no" };
      },
      dormir: async () => {},
    });
    assert.equal(resultado.informe.total, 2);
    assert.equal(resultado.informe.exitosos, 0);
    assert.equal(resultado.informe.fallidos, 2);
    assert.equal(resultado.informe.fallas[0].causa, "La Rama bloqueó la petición.");
    assert.equal(resultado.informe.fallas[1].causa, "No se intentó: la Rama bloqueó las peticiones.");
    assert.equal(llamadas, 3);
  } finally {
    tmp.borrar();
  }
});

test("actualizar un expediente espera a que termine la revisión de todos", async () => {
  const tmp = temporal();
  let soltar;
  const espera = new Promise((resolver) => {
    soltar = resolver;
  });
  const pedir = async () => {
    await espera;
    return { status: 200, text: JSON.stringify({ actuaciones: [], paginacion: { cantidadPaginas: 1, cantidadRegistros: 0 } }) };
  };
  const dormir = async () => {};
  try {
    tmp.db.prepare("INSERT INTO radicado (numero) VALUES (?)").run(NUMERO);
    tmp.db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (3, ?, 0)").run(NUMERO);
    assert.equal(lanzar({ db: tmp.db, datosDir: tmp.dir, modo: "todo", pedir, dormir }), true);
    assert.equal(lanzar({ db: tmp.db, datosDir: tmp.dir, modo: "uno", idProceso: 3, pedir, dormir }), false);
    soltar();
    for (let i = 0; i < 50 && estadoCorrida().corriendo; i += 1) {
      await new Promise((resolver) => setTimeout(resolver, 10));
    }
    assert.equal(lanzar({ db: tmp.db, datosDir: tmp.dir, modo: "uno", idProceso: 3, pedir, dormir }), true);
    for (let i = 0; i < 50 && estadoCorrida().corriendo; i += 1) {
      await new Promise((resolver) => setTimeout(resolver, 10));
    }
    assert.equal(estadoCorrida().corriendo, false);
    assert.equal(estadoCorrida().trabajos.uno.informe.total, 1);
    assert.equal(estadoCorrida().trabajos.uno.informe.exitosos, 1);
  } finally {
    soltar();
    for (let i = 0; i < 50 && estadoCorrida().corriendo; i += 1) {
      await new Promise((resolver) => setTimeout(resolver, 10));
    }
    tmp.borrar();
  }
});
