import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HORARIOS_PREDETERMINADOS,
  REINTENTO_OCUPADO_MS,
  REVISAR_CADA_MS,
  decidirAutomatica,
  proximoTurno,
  resumenCambios,
  turnoAnterior,
  turnoCubierto,
  validarHorarios,
} from "../compartido/horario.js";
import { ahora } from "../compartido/logica.js";
import {
  Aviso,
  abrirBase,
  asignarCliente,
  avisosDesde,
  cerrarRevisionesColgadas,
  guardarCliente,
  guardarHorarios,
  guardarAjuste,
  iniciarRevision,
  leerHorarios,
  leerInicioSesion,
  guardarInicioSesion,
  terminarRevision,
  ultimaRevision,
  ultimoAvisoId,
  uno,
} from "../src/db.js";
import { configurarInicio, ejecutableLinux, rutaAutostart, textoAutostart, abiertaAlIniciarSesion } from "../src/inicio.js";
import { estadoCorrida, lanzar } from "../src/jobs.js";
import { crearProgramador } from "../src/programador.js";
import { ejecutarTrabajo } from "../src/rama.js";

const NUMERO = "11001418901820190162700";
const HORAS = ["07:00", "13:00"];
const en = (dia, hora, minuto = 0) => new Date(2026, 9, dia, hora, minuto, 0);

function temporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-auto-"));
  const db = abrirBase(path.join(dir, "grokvig.sqlite"));
  return {
    dir,
    db,
    borrar() {
      try {
        db.close();
      } catch {
        /* ya cerrada */
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("las horas: una o dos, sin repetir, con formato HH:MM y al menos una hora entre ellas", () => {
  assert.deepEqual(validarHorarios([...HORARIOS_PREDETERMINADOS]), { ok: true, horas: ["07:00", "13:00"] });
  assert.deepEqual(validarHorarios(["13:00", "07:00"]).horas, ["07:00", "13:00"]);
  assert.deepEqual(validarHorarios(["09:30"]).horas, ["09:30"]);
  assert.deepEqual(validarHorarios(["09:30", ""]).horas, ["09:30"]);
  assert.deepEqual(validarHorarios([" 08:00 ", "09:00"]).horas, ["08:00", "09:00"]);
  assert.equal(validarHorarios(["07:00", "13:00", "18:00"]).ok, false);
  assert.match(validarHorarios(["07:00", "13:00", "18:00"]).error, /Máximo dos/);
  assert.match(validarHorarios(["07:00", "07:00"]).error, /iguales/);
  assert.match(validarHorarios(["07:00", " 07:00"]).error, /iguales/);
  for (const mala of ["7:00", "24:00", "07:60", "0700", "07:00:00", "aa:bb", "-1:00"]) {
    assert.equal(validarHorarios([mala]).ok, false, mala);
    assert.match(validarHorarios([mala]).error, /no es una hora válida/);
  }
  assert.equal(validarHorarios([700]).ok, false);
  assert.equal(validarHorarios(["07:00", { hora: "13:00" }]).ok, false);
  assert.equal(validarHorarios([]).ok, false);
  assert.equal(validarHorarios(["", " "]).ok, false);
  assert.equal(validarHorarios("07:00").ok, false);
  assert.equal(validarHorarios(null).ok, false);
  assert.match(validarHorarios(["07:00", "07:59"]).error, /al menos una hora/);
  assert.match(validarHorarios(["23:30", "00:10"]).error, /al menos una hora/);
  assert.equal(validarHorarios(["07:00", "08:00"]).ok, true);
  assert.equal(validarHorarios(["23:30", "00:30"]).ok, true);
});

test("la base guarda las horas validadas y rechaza más de dos o repetidas", () => {
  const tmp = temporal();
  try {
    assert.deepEqual(leerHorarios(tmp.db), ["07:00", "13:00"]);
    assert.equal(Number(uno(tmp.db, "SELECT COUNT(*) AS n FROM schema_migracion").n), 19);
    assert.deepEqual(guardarHorarios(tmp.db, ["18:00", "06:30"]), ["06:30", "18:00"]);
    assert.deepEqual(leerHorarios(tmp.db), ["06:30", "18:00"]);
    assert.throws(() => guardarHorarios(tmp.db, ["07:00", "12:00", "18:00"]), Aviso);
    assert.throws(() => guardarHorarios(tmp.db, ["07:00", "07:00"]), /iguales/);
    assert.throws(() => guardarHorarios(tmp.db, ["7"]), /no es una hora válida/);
    assert.throws(() => guardarHorarios(tmp.db, "07:00"), Aviso);
    assert.deepEqual(leerHorarios(tmp.db), ["06:30", "18:00"]);
    guardarAjuste(tmp.db, "horarios_revision", "[\"01:00\",\"02:00\",\"03:00\"]");
    assert.deepEqual(leerHorarios(tmp.db), ["07:00", "13:00"]);
    guardarAjuste(tmp.db, "horarios_revision", "no es json");
    assert.deepEqual(leerHorarios(tmp.db), ["07:00", "13:00"]);
    assert.equal(leerInicioSesion(tmp.db), true);
    guardarInicioSesion(tmp.db, false);
    assert.equal(leerInicioSesion(tmp.db), false);
  } finally {
    tmp.borrar();
  }
});

test("el turno anterior y el próximo", () => {
  assert.equal(ahora(turnoAnterior(HORAS, en(10, 6))), "2026-10-09 13:00:00");
  assert.equal(ahora(proximoTurno(HORAS, en(10, 6))), "2026-10-10 07:00:00");
  assert.equal(ahora(turnoAnterior(HORAS, en(10, 7))), "2026-10-10 07:00:00");
  assert.equal(ahora(proximoTurno(HORAS, en(10, 7))), "2026-10-10 13:00:00");
  assert.equal(ahora(turnoAnterior(HORAS, en(10, 13, 30))), "2026-10-10 13:00:00");
  assert.equal(ahora(proximoTurno(HORAS, en(10, 13, 30))), "2026-10-11 07:00:00");
  assert.equal(ahora(proximoTurno(HORAS, en(31, 20))), "2026-11-01 07:00:00");
  assert.equal(ahora(proximoTurno(["09:15"], en(10, 9, 15))), "2026-10-11 09:15:00");
  assert.equal(ahora(turnoAnterior(["09:15"], en(10, 9, 14))), "2026-10-09 09:15:00");
});

test("un turno perdido corre una sola vez y luego espera el siguiente", () => {
  const pendiente = decidirAutomatica({ horas: HORAS, ultimoTurno: "2026-10-09 13:00:00", fecha: en(10, 15) });
  assert.equal(pendiente.accion, "correr");
  assert.equal(pendiente.turno, "2026-10-10 13:00:00");
  const hecho = decidirAutomatica({ horas: HORAS, ultimoTurno: pendiente.turno, fecha: en(10, 15, 1) });
  assert.equal(hecho.accion, "esperar");
  assert.equal(hecho.proximo, "2026-10-11 07:00:00");
  assert.equal(hecho.en, en(11, 7).getTime() - en(10, 15, 1).getTime());
  const tresDias = decidirAutomatica({ horas: HORAS, ultimoTurno: "2026-10-07 07:00:00", fecha: en(10, 8) });
  assert.equal(tresDias.accion, "correr");
  assert.equal(tresDias.turno, "2026-10-10 07:00:00");
  assert.equal(decidirAutomatica({ horas: HORAS, ultimoTurno: tresDias.turno, fecha: en(10, 9) }).accion, "esperar");
  assert.equal(decidirAutomatica({ horas: HORAS, ultimoTurno: null, fecha: en(10, 8) }).accion, "correr");
  const temprano = decidirAutomatica({ horas: HORAS, ultimoTurno: "2026-10-09 13:00:00", fecha: en(10, 6, 59) });
  assert.equal(temprano.accion, "esperar");
  assert.equal(temprano.en, 60 * 1000);
});

test("no corre durante otra consulta ni durante la pausa de Actualizar todo", () => {
  const ocupado = decidirAutomatica({ horas: HORAS, ultimoTurno: "2026-10-09 13:00:00", ocupado: true, fecha: en(10, 7, 1) });
  assert.equal(ocupado.accion, "posponer");
  assert.equal(ocupado.en, REINTENTO_OCUPADO_MS);
  const pausa = decidirAutomatica({ horas: HORAS, ultimoTurno: "2026-10-09 13:00:00", pausaHasta: "2026-10-10 07:30:00", fecha: en(10, 7, 1) });
  assert.equal(pausa.accion, "posponer");
  assert.equal(pausa.en, 29 * 60 * 1000 + 1000);
  assert.match(pausa.motivo, /07:30/);
  assert.equal(decidirAutomatica({ horas: HORAS, ultimoTurno: "2026-10-09 13:00:00", pausaHasta: "2026-10-10 06:00:00", fecha: en(10, 7, 1) }).accion, "correr");
});

test("una corrida manual cuenta como el turno que ya pasó", () => {
  assert.equal(turnoCubierto(HORAS, "2026-10-09 13:00:00", en(10, 7, 10)), "2026-10-10 07:00:00");
  assert.equal(turnoCubierto(HORAS, "2026-10-10 07:00:00", en(10, 7, 10)), "2026-10-10 07:00:00");
  assert.equal(turnoCubierto(HORAS, null, en(10, 6)), "2026-10-09 13:00:00");
  assert.equal(turnoCubierto(HORAS, "2026-10-10 13:00:00", en(10, 8)), "2026-10-10 13:00:00");
});

function relojFalso() {
  const pendientes = [];
  return {
    pendientes,
    poner(fn, ms) {
      const item = { fn, ms, vivo: true };
      pendientes.push(item);
      return item;
    },
    quitar(item) {
      if (item) item.vivo = false;
    },
    ultimo() {
      return pendientes.filter((item) => item.vivo).at(-1);
    },
  };
}

test("el programador no corre dos veces el mismo turno", () => {
  const reloj = relojFalso();
  const estado = { horas: HORAS, ultimoTurno: "2026-10-09 13:00:00", pausaHasta: null, ocupado: false };
  const corridas = [];
  let ahoraFalso = en(10, 9);
  const programador = crearProgramador({
    leerEstado: () => ({ ...estado }),
    correr: (turno) => {
      corridas.push(turno);
      estado.ultimoTurno = turno;
      estado.ocupado = true;
      return true;
    },
    reloj: () => ahoraFalso,
    poner: reloj.poner,
    quitar: reloj.quitar,
  });
  programador.iniciar(60 * 1000);
  assert.equal(reloj.ultimo().ms, 60 * 1000);
  assert.equal(programador.evaluar().accion, "correr");
  assert.equal(reloj.ultimo().ms, REVISAR_CADA_MS);
  assert.equal(programador.evaluar().accion, "esperar");
  estado.ocupado = false;
  ahoraFalso = en(10, 12);
  assert.equal(programador.evaluar().accion, "esperar");
  assert.deepEqual(corridas, ["2026-10-10 07:00:00"]);
  assert.equal(reloj.ultimo().ms, REVISAR_CADA_MS);
  ahoraFalso = en(10, 13, 0);
  assert.equal(programador.evaluar().accion, "correr");
  assert.deepEqual(corridas, ["2026-10-10 07:00:00", "2026-10-10 13:00:00"]);
  programador.detener();
  assert.equal(programador.evaluar(), null);
  assert.equal(reloj.ultimo(), undefined);
});

test("el programador pospone si está ocupado, si no pudo lanzar o si algo falla", () => {
  const reloj = relojFalso();
  const estado = { horas: HORAS, ultimoTurno: "2026-10-09 13:00:00", pausaHasta: null, ocupado: true };
  let llamadas = 0;
  let falla = false;
  const registros = [];
  const programador = crearProgramador({
    leerEstado: () => {
      if (falla) throw new Error("base cerrada");
      return { ...estado };
    },
    correr: () => {
      llamadas += 1;
      return false;
    },
    reloj: () => en(10, 7, 5),
    poner: reloj.poner,
    quitar: reloj.quitar,
    log: (msg) => registros.push(msg),
  });
  programador.iniciar(1000);
  assert.equal(programador.evaluar().accion, "posponer");
  assert.equal(llamadas, 0);
  assert.equal(reloj.ultimo().ms, REINTENTO_OCUPADO_MS);
  estado.ocupado = false;
  const fallo = programador.evaluar();
  assert.equal(fallo.accion, "posponer");
  assert.equal(llamadas, 1);
  falla = true;
  assert.equal(programador.evaluar(), null);
  assert.equal(reloj.ultimo().ms, REINTENTO_OCUPADO_MS);
  assert.ok(registros.some((linea) => linea.includes("base cerrada")));
  programador.detener();
});

test("el resumen de cambios lleva radicado y cliente, y sin cambios no hay resumen", () => {
  assert.equal(resumenCambios([]), null);
  assert.equal(resumenCambios(null), null);
  const resumen = resumenCambios([
    { id_proceso: 1, radicado: "A1", tipo: "actuacion_nueva", cliente_nombre: "Ana", cliente_apellidos: "Pérez" },
    { id_proceso: 1, radicado: "A1", tipo: "actuacion_nueva", cliente_nombre: "Ana", cliente_apellidos: "Pérez" },
    { id_proceso: 1, radicado: "A1", tipo: "actuacion_actualizada", cliente_nombre: "Ana", cliente_apellidos: "Pérez" },
    { id_proceso: 2, radicado: "B2", tipo: "actuacion_retirada" },
  ]);
  assert.equal(resumen.titulo, "2 expedientes con cambios");
  assert.equal(resumen.total, 4);
  assert.deepEqual(resumen.ids, [1, 2]);
  assert.equal(resumen.cuerpo, "A1 · Ana Pérez: 2 actuaciones nuevas, 1 actuación modificada\nB2 · Sin abogado: 1 actuación retirada");
  const muchos = resumenCambios([1, 2, 3, 4, 5, 6].map((id) => ({ id_proceso: id, radicado: `R${id}`, tipo: "actuacion_nueva" })));
  assert.equal(muchos.cuerpo.split("\n").length, 5);
  assert.equal(muchos.cuerpo.split("\n").at(-1), "y 2 expedientes más");
  assert.equal(resumenCambios([{ id_proceso: 9, radicado: "R9", tipo: "actuacion_nueva" }]).titulo, "1 expediente con cambios");
});

function actuacionesRama(lista) {
  return { status: 200, text: JSON.stringify({ actuaciones: lista, paginacion: { cantidadPaginas: 1, cantidadRegistros: lista.length } }) };
}

test("la revisión automática usa Actualizar todo y el resumen sale de los avisos del periodo", async () => {
  const tmp = temporal();
  try {
    tmp.db.prepare("INSERT INTO radicado (numero) VALUES (?)").run(NUMERO);
    tmp.db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (15, ?, 0)").run(NUMERO);
    tmp.db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (16, ?, 0)").run(NUMERO);
    const cliente = guardarCliente(tmp.db, { nombre: "Marta", apellidos: "Rojas" });
    asignarCliente(tmp.db, 15, cliente);
    const base = { idRegActuacion: 8, consActuacion: 1, fechaActuacion: "2026-10-01", actuacion: "Auto", llaveProceso: NUMERO };
    let lista = [base];
    const pedir = async (url) => (url.endsWith("/15") || url.includes("/15?") ? actuacionesRama(lista) : actuacionesRama([]));
    const silencio = { log() {}, aviso() {}, notificar() {} };
    const primera = await ejecutarTrabajo({ db: tmp.db, modo: "todo", ctx: silencio, pedir, dormir: async () => {} });
    assert.equal(primera.informe.exitosos, 2);
    assert.equal(primera.cambios, 0);
    const idBase = ultimoAvisoId(tmp.db);
    assert.equal(resumenCambios(avisosDesde(tmp.db, idBase)), null);
    lista = [base, { ...base, idRegActuacion: 9, consActuacion: 2, actuacion: "Traslado" }];
    const terminado = new Promise((resolver) => {
      assert.equal(lanzar({
        db: tmp.db,
        datosDir: tmp.dir,
        modo: "todo",
        origen: "automatica",
        avisarSistema: false,
        pedir,
        dormir: async () => {},
        alTerminar: resolver,
      }), true);
    });
    assert.equal(estadoCorrida().trabajos.todo.origen, "automatica");
    assert.equal(lanzar({ db: tmp.db, datosDir: tmp.dir, modo: "todo", pedir, dormir: async () => {} }), false);
    const resultado = await terminado;
    assert.equal(resultado.informe.exitosos, 2);
    assert.equal(resultado.cambios, 1);
    assert.equal(resultado.error, null);
    assert.equal(estadoCorrida().revisando, false);
    const resumen = resumenCambios(avisosDesde(tmp.db, idBase));
    assert.equal(resumen.titulo, "1 expediente con cambios");
    assert.deepEqual(resumen.ids, [15]);
    assert.match(resumen.cuerpo, new RegExp(`${NUMERO} · Marta Rojas: 1 actuación nueva`));
  } finally {
    tmp.borrar();
  }
});

test("los errores de red no tumban la corrida y cinco seguidos la detienen", async () => {
  const tmp = temporal();
  try {
    tmp.db.prepare("INSERT INTO radicado (numero) VALUES (?)").run(NUMERO);
    for (let id = 1; id <= 8; id += 1) tmp.db.prepare("INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (?, ?, 0)").run(id, NUMERO);
    let llamadas = 0;
    const resultado = await new Promise((resolver) => {
      lanzar({
        db: tmp.db,
        datosDir: tmp.dir,
        modo: "todo",
        origen: "automatica",
        avisarSistema: false,
        pedir: async () => {
          llamadas += 1;
          throw new Error("getaddrinfo ENOTFOUND");
        },
        dormir: async () => {},
        alTerminar: resolver,
      });
    });
    assert.equal(llamadas, 15);
    assert.equal(resultado.informe.total, 8);
    assert.equal(resultado.informe.exitosos, 0);
    assert.equal(resultado.informe.fallidos, 8);
    assert.match(resultado.informe.fallas.at(-1).causa, /No se intentó/);
    assert.equal(estadoCorrida().corriendo, false);
  } finally {
    tmp.borrar();
  }
});

test("cada corrida queda registrada y una colgada se marca interrumpida", () => {
  const tmp = temporal();
  try {
    assert.equal(ultimaRevision(tmp.db), null);
    const id = iniciarRevision(tmp.db, { origen: "automatica", turno: "2026-10-10 07:00:00", inicio: "2026-10-10 07:01:00" });
    assert.equal(ultimaRevision(tmp.db), null);
    terminarRevision(tmp.db, id, { fin: "2026-10-10 07:06:00", revisados: 156, cambiados: 2, cambios: 3, errores: 1 });
    const ultima = ultimaRevision(tmp.db);
    assert.equal(ultima.revisados, 156);
    assert.equal(ultima.cambiados, 2);
    assert.equal(ultima.errores, 1);
    assert.equal(ultima.estado, "lista");
    iniciarRevision(tmp.db, { origen: "manual" });
    iniciarRevision(tmp.db, { origen: "automatica" });
    cerrarRevisionesColgadas(tmp.db);
    assert.equal(ultimaRevision(tmp.db).estado, "interrumpida");
    assert.equal(ultimaRevision(tmp.db, ["manual"]).estado, "interrumpida");
  } finally {
    tmp.borrar();
  }
});

test("el inicio de sesión: autostart en Linux, login item en Windows y Mac, nada en desarrollo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vig-inicio-"));
  try {
    const env = { XDG_CONFIG_HOME: path.join(dir, "config"), APPIMAGE: "/home/ana/Apps/Vigencia 2.0.0.AppImage" };
    assert.equal(rutaAutostart({ env, home: "/home/ana" }), path.join(dir, "config", "autostart", "vigencia.desktop"));
    assert.equal(rutaAutostart({ env: {}, home: "/home/ana" }), "/home/ana/.config/autostart/vigencia.desktop");
    assert.equal(ejecutableLinux({ env, execPath: "/tmp/.mount/vigencia" }), env.APPIMAGE);
    assert.equal(ejecutableLinux({ env: {}, execPath: "/opt/Vigencia/vigencia" }), "/opt/Vigencia/vigencia");
    assert.match(textoAutostart({ ejecutable: "/opt/Vigencia/vigencia" }), /^Exec="\/opt\/Vigencia\/vigencia" --oculta$/m);
    assert.match(textoAutostart({ ejecutable: "/a/100% $x" }), /Exec="\/a\/100%% \\\$x" --oculta/);
    const linux = configurarInicio({ activo: true, empaquetada: true, plataforma: "linux", env, home: dir, execPath: "/x", fs });
    assert.equal(linux.hecho, true);
    assert.match(fs.readFileSync(linux.ruta, "utf8"), /Vigencia 2\.0\.0\.AppImage" --oculta/);
    configurarInicio({ activo: false, empaquetada: true, plataforma: "linux", env, home: dir, execPath: "/x", fs });
    assert.equal(fs.existsSync(linux.ruta), false);
    const llamadas = [];
    const app = { setLoginItemSettings: (opciones) => llamadas.push(opciones) };
    configurarInicio({ activo: true, empaquetada: true, plataforma: "win32", app, fs });
    configurarInicio({ activo: true, empaquetada: true, plataforma: "darwin", app, fs });
    assert.deepEqual(llamadas[0], { openAtLogin: true, args: ["--oculta"] });
    assert.equal(llamadas[1].openAtLogin, true);
    const desarrollo = configurarInicio({ activo: true, empaquetada: false, plataforma: "linux", app, env, home: dir, execPath: "/x", fs });
    assert.equal(desarrollo.hecho, false);
    assert.equal(llamadas.length, 2);
    assert.equal(abiertaAlIniciarSesion({ argv: ["electron", ".", "--oculta"], plataforma: "linux" }), true);
    assert.equal(abiertaAlIniciarSesion({ argv: ["electron", "."], plataforma: "linux" }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
