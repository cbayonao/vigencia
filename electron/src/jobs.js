import { execFile } from "node:child_process";
import { ahora, lineaDeCarga } from "../compartido/logica.js";
import { bitacoraEn } from "./guardar.js";
import { ejecutarTrabajo } from "./rama.js";

const oyentes = new Set();

function vacia(modo) {
  return {
    corriendo: false,
    exit_code: null,
    lineas: [],
    inicio: null,
    fin: null,
    modo,
    radicado: null,
    origen: "manual",
  };
}

const corridas = {
  todo: vacia("todo"),
  agregar: vacia("agregar"),
  carga: vacia("carga"),
  uno: vacia("uno"),
};

function marcas() {
  return {
    revisando: corridas.todo.corriendo,
    agregando: corridas.agregar.corriendo,
    cargando: corridas.carga.corriendo,
    puntual: corridas.uno.corriendo,
  };
}

function foto(corrida) {
  return {
    corriendo: corrida.corriendo,
    exit_code: corrida.exit_code,
    lineas: corrida.lineas.map((linea) => lineaDeCarga(linea)).filter(Boolean),
    inicio: corrida.inicio,
    fin: corrida.fin,
    modo: corrida.modo,
    radicado: corrida.radicado,
    informe: corrida.informe || null,
    expediente: corrida.expediente || null,
    origen: corrida.origen || "manual",
    ...marcas(),
  };
}

function cabe(modo) {
  if (modo === "agregar") return !corridas.agregar.corriendo && !corridas.carga.corriendo;
  if (modo === "todo") return !corridas.todo.corriendo && !corridas.carga.corriendo && !corridas.uno.corriendo;
  if (modo === "carga") return !corridas.todo.corriendo && !corridas.agregar.corriendo && !corridas.carga.corriendo && !corridas.uno.corriendo;
  if (modo === "uno") return !corridas.uno.corriendo && !corridas.todo.corriendo && !corridas.carga.corriendo;
  return false;
}

export function estadoCorrida() {
  const marcasActuales = marcas();
  const primaria = marcasActuales.cargando
    ? corridas.carga
    : marcasActuales.revisando
      ? corridas.todo
      : marcasActuales.puntual
        ? corridas.uno
        : corridas.agregar;
  return {
    ...foto(primaria),
    corriendo: marcasActuales.revisando || marcasActuales.agregando || marcasActuales.cargando || marcasActuales.puntual,
    trabajos: {
      todo: foto(corridas.todo),
      agregar: foto(corridas.agregar),
      carga: foto(corridas.carga),
      uno: foto(corridas.uno),
    },
  };
}

export function alCambiar(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

function publicar(modo) {
  const dato = foto(corridas[modo]);
  for (const fn of oyentes) fn(dato);
}

function notificarSistema(resumen) {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return;
  execFile("notify-send", ["vig-leg", resumen], () => {});
}

export function lanzar({
  db,
  datosDir,
  modo,
  radicado = null,
  numeros = null,
  idProceso = null,
  permitirRed = false,
  pedir = null,
  dormir = null,
  origen = "manual",
  avisarSistema = true,
  alTerminar = null,
}) {
  if (!cabe(modo)) return false;
  const corrida = corridas[modo];
  const archivo = bitacoraEn(datosDir);
  const crudas = [];
  corrida.corriendo = true;
  corrida.exit_code = null;
  corrida.lineas = [];
  corrida.informe = null;
  corrida.expediente = idProceso;
  corrida.inicio = ahora();
  corrida.fin = null;
  corrida.modo = modo;
  corrida.radicado = radicado;
  corrida.origen = origen;
  let final = null;
  publicar(modo);
  const log = (msg) => {
    const linea = archivo.log(msg);
    crudas.push(linea);
    corrida.lineas = crudas.slice();
    publicar(modo);
    return linea;
  };
  ejecutarTrabajo({
    db,
    modo,
    radicado,
    idProceso: modo === "uno" ? idProceso : null,
    numeros,
    permitirRed,
    pedir,
    dormir,
    ctx: { log, aviso: archivo.aviso, notificar: avisarSistema ? notificarSistema : undefined },
  }).then((resultado) => {
    corrida.exit_code = resultado.codigo;
    corrida.informe = resultado.informe || null;
    final = { ...resultado, error: null };
  }).catch((error) => {
    try {
      log(`error: ${error.message}`);
    } catch {
      /* el registro también puede fallar */
    }
    corrida.exit_code = 1;
    final = { codigo: 1, errores: 1, cambios: 0, informe: null, error: String(error?.message || error) };
  }).finally(() => {
    corrida.corriendo = false;
    corrida.fin = ahora();
    publicar(modo);
    if (alTerminar) {
      try {
        alTerminar({ ...final, inicio: corrida.inicio, fin: corrida.fin });
      } catch (error) {
        console.error(error);
      }
    }
  });
  return true;
}
