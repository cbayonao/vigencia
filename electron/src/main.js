import { estadoMotor, instalarMotor, usarDatosMotor, diagnosticoMotor } from "./motor.js";
import { abrirSesion, crearCargaPp, deptoDeDespacho, traerPdf } from "./pp.js";
import { buscarSp } from "./spoa.js";
import { abrirSesionSam, actuacionesSam, buscarSam, corporacionesSam } from "./samai.js";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  protocol,
  shell,
  Tray,
  utilityProcess,
} from "electron";
import {
  ESPERA_AL_ARRANCAR_MS,
  SEPARACION_MINIMA_MIN,
  claveTurno,
  proximoTurno,
  resumenCambios,
  turnoCubierto,
} from "../compartido/horario.js";
import { ahora, decidirActualizar, nombreCliente, normalizarRadicado } from "../compartido/logica.js";
import { nombreArchivoPdf } from "../compartido/pp.js";
import { columnasDeRadicado } from "./csv.js";
import { activarCodigo, confirmarPlan, fotoLicencia, iniciarPlan, leerPlan } from "./licencia.js";
import { enviarComentario, listarComentarios } from "./comentarios.js";
import { urlServicio } from "../compartido/licencia.js";
import { planAbierto } from "../compartido/plan.js";
import {
  Aviso,
  abrirBase,
  asignarCliente,
  guardarRepresentado,
  borrarCliente,
  borrarProceso,
  datosParaExcel,
  detalleProceso,
  informesDelDia,
  guardarCliente,
  guardarInformeRevision,
  guardarPausaActualizar,
  leerInformeRevision,
  leerPausaActualizar,
  listarClientes,
  listarProcesos,
  ppCatalogoVacio,
  ppCargados,
  ppDeptos,
  ppDespachos,
  ppDocumentos,
  ppMunicipios,
  ppOlvidar,
  ppPublicaciones,
  sembrarPpCatalogo,
  avisosDesde,
  cerrarRevisionesColgadas,
  guardarHorarios,
  guardarInicioSesion,
  guardarUltimoTurno,
  guardarSamaiCaso,
  guardarSpCaso,
  guardarUso,
  resumenGastos,
  ultimoGasto,
  samaiCaso,
  samaiCasos,
  samaiOlvidar,
  spoaCaso,
  spoaCasos,
  spoaOlvidar,
  iniciarRevision,
  leerFrecuenciaSistemas,
  guardarFrecuenciaSistemas,
  leerHorarios,
  leerInicioSesion,
  leerUltimoTurno,
  terminarRevision,
  ultimaRevision,
  ultimoAvisoId,
} from "./db.js";
import { bitacoraEn } from "./guardar.js";
import { abiertaAlIniciarSesion, configurarInicio } from "./inicio.js";
import { crearProgramador } from "./programador.js";
import { libroExcel } from "./excel.js";
import { docxDeEscrito, textoDeDocx } from "./docx.js";
import { htmlInforme, fechaInforme, nombreArchivoInforme } from "./informe.js";
import { pdfDesdeHtml } from "./pdf.js";
import { alCambiar, estadoCorrida, lanzar } from "./jobs.js";
import { fichaDeDetalle, redactarEscrito } from "../compartido/redactor.js";
import { activarPieza, borrarPieza, guardarPieza, listarPiezas } from "./biblioteca.js";
import { generarBorrador, generarInicial, guardarActivo, guardarModo, importarModelo, listarModelos, descargarModelo, modelosRecomendados, leerNubes, guardarNube, borrarModelo, quitarNube } from "./ia.js";
import { htmlMemorial } from "./memorial.js";
import { registrarDocumentos } from "./documentos-ipc.js";
import { registrarJuris } from "./juris-ipc.js";
import { registrarConvertir } from "./convertir-ipc.js";
import { limpiarTemporales, registrarPdftools } from "./pdftools-ipc.js";
import { registrarEstados } from "./estados-ipc.js";
import { consultarVersion, descargarActualizacion } from "./actualizar.js";
import { directorioDatos } from "./rutas.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const bloqueo = app.requestSingleInstanceLock();
if (!bloqueo) app.quit();

const RAIZ = path.resolve(import.meta.dirname, "..");
const ICONO = path.join(RAIZ, "renderer", "icon.png");
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", // worker de pdfjs (renderer/vendor)
  ".ttf": "font/ttf", // letra de la firma escrita (renderer/fuentes)
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

let ventana = null;
let db = null;
let datosDir = "";
let conversor = null;
let cargaPendiente = null;
let cargaPp = null;
let catalogoPp = null;
const pdfsPp = new Map();
let servidorPdf = null;
let pdfPuerto = 0;

function guardarPdfPp(nombre, bytes) {
  const token = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  pdfsPp.set(token, { nombre, bytes });
  while (pdfsPp.size > 3) {
    const primero = pdfsPp.keys().next().value;
    pdfsPp.delete(primero);
  }
  return token;
}
let bandeja = null;
let saliendo = false;
let avisoBandejaMostrado = false;
let cambiosPendientes = null;
let programador = null;
let proximaRevision = null;
let ventanaPago = null;
let ultimaUrlPago = "";
const notificaciones = new Set();
let imagenIcono = null;

function icono() {
  if (!imagenIcono) imagenIcono = nativeImage.createFromPath(ICONO);
  return imagenIcono;
}

function registrar(msg) {
  try {
    bitacoraEn(datosDir).log(msg);
  } catch (error) {
    console.error(msg, error);
  }
}


async function urlPdfLocal(token) {
  if (!servidorPdf) {
    servidorPdf = http.createServer((solicitud, respuesta) => {
      let ruta = "";
      try {
        ruta = new URL(solicitud.url, "http://127.0.0.1").pathname;
      } catch {
        ruta = "";
      }
      const m = /^\/([a-z0-9-]+)$/.exec(ruta);
      const doc = m ? pdfsPp.get(m[1]) : null;
      if (!doc) {
        respuesta.writeHead(404, { "Content-Type": "text/plain" });
        respuesta.end("No está");
        return;
      }
      const total = doc.bytes.length;
      const rango = /^bytes=(\d*)-(\d*)$/.exec(String(solicitud.headers.range || ""));
      if (rango) {
        const inicio = rango[1] ? Number(rango[1]) : 0;
        const fin = rango[2] ? Number(rango[2]) : total - 1;
        if (inicio < total && fin < total && inicio <= fin) {
          respuesta.writeHead(206, {
            "Content-Type": "application/pdf",
            "Content-Length": fin - inicio + 1,
            "Content-Range": `bytes ${inicio}-${fin}/${total}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
          });
          respuesta.end(doc.bytes.subarray(inicio, fin + 1));
          return;
        }
      }
      respuesta.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": total,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      });
      respuesta.end(doc.bytes);
    });
    await new Promise((resolver) => servidorPdf.listen(0, "127.0.0.1", resolver));
    const dir = servidorPdf.address();
    pdfPuerto = dir && typeof dir === "object" ? dir.port : 0;
  }
  if (!pdfPuerto) return null;
  return `http://127.0.0.1:${pdfPuerto}/${token}`;
}

function resolverApp(solicitud) {
  const url = new URL(solicitud);
  const relativo = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (!relativo || relativo.includes("\0") || relativo.split("/").includes("..")) return null;
  const destino = path.resolve(RAIZ, relativo);
  if (!destino.startsWith(`${RAIZ}${path.sep}`)) return null;
  return destino;
}

function mensajeHumano(error) {
  if (error instanceof Aviso) return error.message;
  const texto = String(error?.message || error);
  if (texto.includes("SQLITE_BUSY") || texto.includes("database is locked")) {
    return "La base está ocupada con una consulta. Intenta en un momento.";
  }
  console.error(error);
  return "No pude completar la acción.";
}

function responder(fn) {
  try {
    return { ok: true, ...fn() };
  } catch (error) {
    return { ok: false, error: mensajeHumano(error) };
  }
}

function prepararDatos() {
  app.setName("Vigencia");
  if (process.platform === "win32") app.setAppUserModelId("co.vigencia.app");
  const repo = path.resolve(RAIZ, "..");
  datosDir = directorioDatos({
    empaquetada: app.isPackaged,
    userData: app.getPath("userData"),
    repo,
    env: process.env,
  });
  fs.mkdirSync(datosDir, { recursive: true });
  usarDatosMotor(datosDir);
  const base = path.join(datosDir, "grokvig.sqlite");
  db = abrirBase(base);
  cerrarRevisionesColgadas(db);
}

function enviar(canal, dato) {
  if (ventana && !ventana.isDestroyed()) ventana.webContents.send(canal, dato);
}

function mostrarVentana() {
  if (!ventana || ventana.isDestroyed()) crearVentana(true);
  if (ventana.isMinimized()) ventana.restore();
  ventana.show();
  ventana.focus();
}

function avisarQueSigue() {
  if (avisoBandejaMostrado || !Notification.isSupported()) return;
  avisoBandejaMostrado = true;
  notificar({
    title: "Vigencia sigue abierta",
    body: "La revisión automática sigue en la bandeja. Para cerrarla del todo usa Salir.",
  });
}

function crearVentana(mostrar = true) {
  ventana = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Procesos · Vigencia",
    backgroundColor: "#efeae1",
    icon: ICONO,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (mostrar) ventana.once("ready-to-show", () => ventana.show());
  ventana.on("close", (evento) => {
    if (saliendo || !bandeja) return;
    evento.preventDefault();
    ventana.hide();
    avisarQueSigue();
  });
  ventana.on("closed", () => {
    ventana = null;
  });
  ventana.loadURL("app://local/renderer/index.html");
}

function crearBandeja() {
  try {
    let imagen = icono();
    if (!imagen.isEmpty()) imagen = imagen.resize({ width: process.platform === "win32" ? 16 : 22, height: process.platform === "win32" ? 16 : 22 });
    bandeja = new Tray(imagen);
    bandeja.setToolTip("Vigencia");
    bandeja.setContextMenu(Menu.buildFromTemplate([
      { label: "Abrir VigencIA", click: () => mostrarVentana() },
      { label: "Revisar ahora", click: () => revisarDesdeBandeja() },
      { type: "separator" },
      { label: "Salir", click: () => salir() },
    ]));
    bandeja.on("click", () => mostrarVentana());
  } catch (error) {
    registrar(`no pude crear el icono de la bandeja: ${error?.message || error}`);
    bandeja = null;
  }
}

function salir() {
  saliendo = true;
  programador?.detener();
  app.quit();
}

function notificar({ title, body, alClic = null }) {
  if (!Notification.isSupported()) return false;
  try {
    const aviso = new Notification({ title, body, icon: icono(), silent: false });
    notificaciones.add(aviso);
    aviso.on("click", () => {
      notificaciones.delete(aviso);
      if (alClic) alClic();
      else mostrarVentana();
    });
    aviso.on("close", () => notificaciones.delete(aviso));
    aviso.show();
    return true;
  } catch (error) {
    registrar(`no pude mostrar la notificación: ${error?.message || error}`);
    return false;
  }
}

function abrirCambios(ids) {
  cambiosPendientes = ids;
  mostrarVentana();
  if (ventana && !ventana.webContents.isLoading()) {
    enviar("abrir-cambios", ids);
    cambiosPendientes = null;
  }
}

// Revisión de sistemas: cada tantas horas (lo elige el usuario, 0 = apagada)
// revisa publicaciones, SPOA y SAMAI guardados y avisa si algo se movió.
// Solo con plan vigente y sin carga manual en curso.
let ppTemporizador = null;
let ppIntervalo = null;

function programarPpDiario() {
  if (ppTemporizador) clearTimeout(ppTemporizador);
  if (ppIntervalo) clearInterval(ppIntervalo);
  ppTemporizador = null;
  ppIntervalo = null;
  const horas = leerFrecuenciaSistemas(db);
  if (!horas) return;
  const correr = () => {
    actualizarPpDiaria().catch((error) => console.error(error));
  };
  ppTemporizador = setTimeout(correr, 10 * 60 * 1000);
  ppTemporizador.unref?.();
  ppIntervalo = setInterval(correr, horas * 60 * 60 * 1000);
  ppIntervalo.unref?.();
}

async function actualizarSpoaDiaria() {
  const resumen = [];
  let lista = [];
  try {
    lista = spoaCasos(db);
  } catch {
    return resumen;
  }
  for (const c of lista) {
    try {
      const registros = await buscarSp(c.noticia);
      const nuevas = guardarSpCaso(db, registros[0]);
      if (nuevas > 0) resumen.push({ noticia: c.noticia, nuevas });
    } catch {
      /* sigue con el siguiente caso */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return resumen;
}

async function actualizarSamaiDiaria() {
  const resumen = [];
  let lista = [];
  try {
    lista = samaiCasos(db);
  } catch {
    return resumen;
  }
  if (!lista.length) return resumen;
  let sesion = null;
  try {
    sesion = await abrirSesionSam();
  } catch {
    return resumen;
  }
  for (const c of lista) {
    try {
      const actuaciones = await actuacionesSam(sesion, c.guid);
      const ficha = samaiCaso(db, c.guid) || {};
      const nuevas = guardarSamaiCaso(db, { ...ficha, guid: c.guid, actuaciones });
      if (nuevas > 0) resumen.push({ guid: c.guid, radicado: c.radicado, nuevas });
    } catch {
      /* sigue con el siguiente caso */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return resumen;
}

async function actualizarPpDiaria() {
  if (cargaPp?.estado.corriendo) return;
  if (!planVigente()) return;
  let lista = [];
  try {
    lista = ppCargados(db).filter((c) => c.estado === "lista");
  } catch {
    return;
  }
  const partes = [];
  if (lista.length) {
    const resumen = [];
    for (const c of lista) {
      const depto = deptoDeDespacho(db, c.codigo);
      if (!depto) continue;
      const trabajo = crearCargaPp(db, { depto, despacho: c.codigo });
      cargaPp = trabajo;
      try {
        const final = await trabajo.correr((estado) => enviar("pp-progreso", estado));
        if (final.nuevos > 0) resumen.push({ despacho: c.codigo, nuevos: final.nuevos, docs: final.docs });
      } catch {
        /* sigue con el siguiente despacho */
      }
    }
    cargaPp = null;
    const nuevos = resumen.reduce((n, r) => n + r.nuevos, 0);
    if (nuevos > 0) {
      partes.push(nuevos === 1 ? "1 documento nuevo en publicaciones" : `${nuevos} documentos nuevos en ${resumen.length} despachos`);
      enviar("pp-novedades", { resumen });
    }
  }
  for (const c of await actualizarSpoaDiaria()) {
    partes.push(`SPOA ${c.noticia}: ${c.nuevas} nuevas`);
  }
  if (partes.length) enviar("spoa-novedades", {});
  for (const c of await actualizarSamaiDiaria()) {
    partes.push(`SAMAI ${c.radicado}: ${c.nuevas} nuevas`);
  }
  if (partes.length) enviar("samai-novedades", {});
  if (!partes.length) return;
  const cuerpo = partes.join(" · ");
  const mostrar = () => {
    mostrarVentana();
  };
  if (ventana && !ventana.isDestroyed() && ventana.isVisible()) {
    /* ya se enviaron los eventos para refrescar */
  }
  notificar({ title: "Novedades en los sistemas", body: cuerpo, alClic: mostrar });
}

function rutaOmitida() {
  return path.join(datosDir, "actualizacion-omitida.txt");
}
function leerOmitida() {
  try {
    return fs.readFileSync(rutaOmitida(), "utf8").trim();
  } catch {
    return "";
  }
}

function sembrarPpSiFalta() {
  if (!ppCatalogoVacio(db)) return;
  if (!catalogoPp) {
    catalogoPp = JSON.parse(fs.readFileSync(path.join(RAIZ, "compartido", "pp_catalogo.json"), "utf8"));
  }
  sembrarPpCatalogo(db, catalogoPp);
}

function guardarOmitida(version) {
  try {
    fs.writeFileSync(rutaOmitida(), String(version || ""));
  } catch (error) {
    console.error(error);
  }
}

// Revisa una vez por arranque si hay versión nueva, sin bloquear nada.
// Solo interrumpe si hay novedad que el usuario no haya omitido.
function programarRevisionActualizacion() {
  setTimeout(async () => {
    if (!ventana || ventana.isDestroyed()) return;
    let info = null;
    try {
      info = await consultarVersion(app.getVersion());
    } catch {
      return;
    }
    if (!info?.novedad || !info.archivo) return;
    if (leerOmitida() === info.disponible) return;
    if (ventana.isVisible()) {
      enviar("actualizacion-disponible", info);
      return;
    }
    notificar({
      title: "Hay una actualización de Vigencia",
      body: `La versión ${info.disponible} ya está lista para descargar.`,
      alClic: () => {
        mostrarVentana();
        enviar("actualizacion-disponible", info);
      },
    });
  }, 45000).unref?.();
}

function infoAutomatica() {
  const horas = leerHorarios(db);
  return {
    horas,
    separacionMinima: SEPARACION_MINIMA_MIN,
    inicioSesion: leerInicioSesion(db),
    ultima: ultimaRevision(db),
    proxima: proximaRevision || claveTurno(proximoTurno(horas)),
    actualizarHasta: leerPausaActualizar(db),
  };
}

function publicarAutomatica() {
  try {
    const info = infoAutomatica();
    enviar("revision-automatica", info);
    if (bandeja) bandeja.setToolTip(`Vigencia · próxima revisión ${String(info.proxima || "").slice(11, 16)}`);
  } catch (error) {
    registrar(`no pude leer el estado de la revisión automática: ${error?.message || error}`);
  }
}


function planVigente() {
  return planAbierto(fotoLicencia(datosDir).estado);
}

function planCerrado() {
  if (planVigente()) return null;
  return { ok: false, error: "El plan no está vigente." };
}

function abrirPago(url) {
  ultimaUrlPago = url;
  if (ventanaPago && !ventanaPago.isDestroyed()) {
    ventanaPago.loadURL(url);
    ventanaPago.show();
    return;
  }
  ventanaPago = new BrowserWindow({
    parent: ventana || undefined,
    modal: Boolean(ventana),
    width: 480,
    height: 760,
    title: "Pagar el plan · Vigencia",
    autoHideMenuBar: true,
    backgroundColor: "#efeae1",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const base = urlServicio(process.env);
  ventanaPago.webContents.on("did-navigate", (_evento, destino) => {
    if (!base || !destino.startsWith(`${base}/retorno`)) return;
    if (ventana && !ventana.isDestroyed()) ventana.webContents.send("licencia-retorno");
    if (ventanaPago && !ventanaPago.isDestroyed()) ventanaPago.close();
  });
  ventanaPago.webContents.setWindowOpenHandler(({ url: destino }) => {
    if (String(destino).startsWith("https://")) shell.openExternal(destino);
    return { action: "deny" };
  });
  ventanaPago.on("closed", () => {
    ventanaPago = null;
  });
  ventanaPago.loadURL(url);
}

function trabajo(modo, radicado = null, numeros = null, idProceso = null) {
  return lanzar({
    db,
    datosDir,
    modo,
    radicado,
    numeros,
    idProceso,
    permitirRed: true,
  });
}

function terminarCorrida({ origen, revisionId, avisoBase, resultado }) {
  try {
    const avisos = avisosDesde(db, avisoBase).filter((fila) => fila.tipo && fila.id_proceso != null);
    const resumen = resumenCambios(avisos);
    terminarRevision(db, revisionId, {
      fin: resultado?.fin || ahora(),
      revisados: resultado?.informe?.exitosos ?? 0,
      cambiados: resumen ? resumen.procesos.length : 0,
      cambios: resumen ? resumen.total : 0,
      errores: resultado?.informe?.fallidos ?? (resultado?.errores || 0),
      error: resultado?.error || null,
    });
    guardarUltimoTurno(db, turnoCubierto(leerHorarios(db), leerUltimoTurno(db)));
    registrar(`revisión ${origen}: revisados=${resultado?.informe?.exitosos ?? 0} con cambios=${resumen ? resumen.procesos.length : 0} errores=${resultado?.informe?.fallidos ?? (resultado?.errores || 0)}`);
    if (origen !== "manual" && resumen) {
      notificar({
        title: `Vigencia · ${resumen.titulo}`,
        body: resumen.cuerpo,
        alClic: () => abrirCambios(resumen.ids),
      });
    }
  } catch (error) {
    registrar(`revisión ${origen}: no pude cerrar el registro (${error?.message || error})`);
  }
  publicarAutomatica();
  programador?.reprogramar();
}

function revisarTodo(origen, turno = null) {
  const cerrado = planCerrado();
  if (cerrado) return cerrado;
  const foto = estadoCorrida();
  const decision = decidirActualizar(leerPausaActualizar(db), foto.revisando || foto.cargando || foto.puntual);
  if (!decision.ok) return decision;
  const avisoBase = ultimoAvisoId(db);
  let revisionId = null;
  const lanzado = lanzar({
    db,
    datosDir,
    modo: "todo",
    permitirRed: true,
    origen,
    avisarSistema: origen === "manual",
    alTerminar: (resultado) => terminarCorrida({ origen, revisionId, avisoBase, resultado }),
  });
  if (!lanzado) return { ok: false, error: "Ya hay una consulta en curso." };
  guardarPausaActualizar(db, decision.hasta);
  revisionId = iniciarRevision(db, { origen, turno });
  guardarUltimoTurno(db, turnoCubierto(leerHorarios(db), leerUltimoTurno(db)));
  if (origen !== "manual") registrar(`revisión ${origen}${turno ? ` del turno ${turno}` : ""}: empieza`);
  publicarAutomatica();
  return { ok: true, hasta: decision.hasta };
}

function revisarDesdeBandeja() {
  let respuesta;
  try {
    respuesta = revisarTodo("bandeja");
  } catch (error) {
    respuesta = { ok: false, error: mensajeHumano(error) };
  }
  if (!respuesta.ok) {
    notificar({ title: "Vigencia", body: respuesta.error || "No pude empezar la revisión." });
    return;
  }
  notificar({ title: "Vigencia", body: "Revisando las actuaciones de los expedientes guardados." });
}

function iniciarProgramador() {
  programador = crearProgramador({
    leerEstado: () => {
      const foto = estadoCorrida();
      return {
        horas: leerHorarios(db),
        ultimoTurno: leerUltimoTurno(db),
        pausaHasta: leerPausaActualizar(db),
        ocupado: foto.revisando || foto.cargando || foto.puntual,
      };
    },
    correr: (turno) => {
      if (!planVigente()) return true;
      const respuesta = revisarTodo("automatica", turno);
      if (!respuesta.ok) registrar(`revisión automática del turno ${turno}: ${respuesta.error}`);
      return respuesta.ok;
    },
    alPlanear: (decision) => {
      proximaRevision = decision.proximo;
      publicarAutomatica();
    },
    log: registrar,
  });
  programador.iniciar(ESPERA_AL_ARRANCAR_MS);
  proximaRevision = claveTurno(proximoTurno(leerHorarios(db)));
  powerMonitor.on("resume", () => programador.reprogramar(ESPERA_AL_ARRANCAR_MS));
}

function aplicarInicioSesion() {
  try {
    const resultado = configurarInicio({
      activo: leerInicioSesion(db),
      empaquetada: app.isPackaged,
      plataforma: process.platform,
      app,
      env: process.env,
      home: os.homedir(),
      execPath: process.execPath,
      fs,
    });
    if (resultado.motivo) registrar(resultado.motivo);
  } catch (error) {
    registrar(`no pude registrar el inicio de sesión: ${error?.message || error}`);
  }
}

if (bloqueo) {
  app.on("second-instance", () => mostrarVentana());

  app.whenReady().then(() => {
    protocol.handle("app", (request) => {
      const destino = resolverApp(request.url);
      if (!destino || !fs.existsSync(destino) || !fs.statSync(destino).isFile()) {
        return new Response("No está", { status: 404 });
      }
      const tipo = TIPOS[path.extname(destino)] || "application/octet-stream";
      const cuerpo = fs.readFileSync(destino);
      return new Response(cuerpo, {
        headers: { "Content-Type": tipo, "Cache-Control": "no-store" },
      });
    });
    Menu.setApplicationMenu(null);
    try {
      prepararDatos();
    } catch (error) {
      dialog.showErrorBox("No pude abrir la base", String(error?.message || error));
      app.quit();
      return;
    }
    alCambiar((dato) => {
      if (dato.modo === "todo" && !dato.corriendo && dato.informe) {
        try {
          guardarInformeRevision(db, dato.informe);
        } catch (error) {
          console.error(error);
        }
      }
      enviar("corrida", dato);
    });
    // El conversor se registra después; Documentos y PDF lo usan cuando ya existe.
    const convertirDatos = (dato) => conversor.convertirDatos(dato);
    registrarDocumentos({
      ipcMain,
      dialog,
      db: () => db,
      datosDir: () => datosDir,
      ventana: () => ventana,
      responder,
      mensajeHumano,
      convertirDatos,
    });
    registrarJuris({
      ipcMain,
      db: () => db,
      responder,
      mensajeHumano,
    });
    conversor = registrarConvertir({
      ipcMain,
      dialog,
      utilityProcess,
      db: () => db,
      datosDir: () => datosDir,
      ventana: () => ventana,
      responder,
      mensajeHumano,
    });
    registrarPdftools({
      ipcMain,
      dialog,
      shell,
      ventana: () => ventana,
      mensajeHumano,
      datosDir: () => datosDir,
      convertirDatos,
      db: () => db,
    });
    registrarEstados({ ipcMain, dialog, ventana: () => ventana, mensajeHumano, datosDir: () => datosDir });
    ipcMain.handle("listar", () => responder(() => ({
      procesos: listarProcesos(db),
      clientes: listarClientes(db),
    })));
    ipcMain.handle("detalle", (_evento, id) => responder(() => ({ proceso: detalleProceso(db, id) })));
    ipcMain.handle("guardar-cliente", (_evento, datos) => responder(() => ({ id: guardarCliente(db, datos) })));
    ipcMain.handle("borrar-cliente", (_evento, id) => responder(() => {
      borrarCliente(db, id);
      return {};
    }));
    ipcMain.handle("borrar-proceso", (_evento, id) => responder(() => {
      borrarProceso(db, id);
      return {};
    }));
    ipcMain.handle("asignar-cliente", (_evento, dato) => responder(() => {
      asignarCliente(db, dato?.idProceso, dato?.clienteId);
      return {};
    }));
    ipcMain.handle("guardar-representado", (_evento, dato) => responder(() => {
      guardarRepresentado(db, dato?.idProceso, dato?.representado || {});
      return {};
    }));
    ipcMain.handle("estado", () => {
      const pendientes = cambiosPendientes;
      cambiosPendientes = null;
      let automatica = null;
      try {
        automatica = infoAutomatica();
      } catch {
        automatica = null;
      }
      return {
        ...estadoCorrida(),
        actualizarHasta: leerPausaActualizar(db),
        informe: leerInformeRevision(db),
        automatica,
        abrirCambios: pendientes,
      };
    });
    ipcMain.handle("actualizar", () => {
      try {
        return revisarTodo("manual");
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("ajustes", () => responder(() => infoAutomatica()));
    ipcMain.handle("guardar-ajustes", (_evento, datos) => responder(() => {
      const horas = guardarHorarios(db, datos?.horas);
      if (typeof datos?.inicioSesion === "boolean") {
        guardarInicioSesion(db, datos.inicioSesion);
        aplicarInicioSesion();
      }
      guardarUltimoTurno(db, turnoCubierto(horas, leerUltimoTurno(db)));
      proximaRevision = claveTurno(proximoTurno(horas));
      registrar(`revisión automática: horas ${horas.join(" y ")}`);
      programador?.reprogramar();
      const info = infoAutomatica();
      publicarAutomatica();
      return info;
    }));
    ipcMain.handle("actualizar-uno", (_evento, id) => {
      const cerrado = planCerrado();
      if (cerrado) return cerrado;
      const proceso = detalleProceso(db, id);
      if (!proceso) return { ok: false, error: "Ese expediente no está." };
      if (!trabajo("uno", null, null, proceso.id_proceso)) return { ok: false, error: "Ya hay una revisión en curso." };
      return { ok: true };
    });
    ipcMain.handle("agregar", (_evento, numero) => {
      const cerrado = planCerrado();
      if (cerrado) return cerrado;
      const limpio = normalizarRadicado(numero);
      if (limpio.length !== 23) return { ok: false, error: "El radicado debe tener 23 dígitos." };
      if (!trabajo("agregar", limpio)) return { ok: false, error: "Ya hay una consulta en curso." };
      return { ok: true };
    });
    ipcMain.handle("elegir-csv", async () => {
      const elegido = await dialog.showOpenDialog(ventana, {
        title: "Cargar radicados",
        properties: ["openFile"],
        filters: [{ name: "CSV", extensions: ["csv", "txt"] }],
      });
      if (elegido.canceled || !elegido.filePaths[0]) return { ok: false, cancelado: true };
      let contenido = "";
      try {
        contenido = fs.readFileSync(elegido.filePaths[0], "utf8");
      } catch {
        return { ok: false, error: "No pude leer el archivo." };
      }
      const columnas = columnasDeRadicado(contenido);
      if (!columnas.length) return { ok: false, error: "El archivo no tiene columnas." };
      cargaPendiente = {
        nombre: path.basename(elegido.filePaths[0]),
        columnas,
      };
      return {
        ok: true,
        nombre: cargaPendiente.nombre,
        columnas: columnas.map(({ indice, nombre, cantidad }) => ({ indice, nombre, cantidad })),
      };
    });
    ipcMain.handle("cargar-csv", (_evento, indice) => {
      const cerrado = planCerrado();
      if (cerrado) return cerrado;
      if (!cargaPendiente) return { ok: false, error: "Vuelve a elegir el archivo." };
      const columna = cargaPendiente.columnas.find((item) => item.indice === Number(indice));
      if (!columna) return { ok: false, error: "Elige la columna del radicado." };
      if (!columna.numeros.length) return { ok: false, error: "Esa columna no tiene radicados de 23 dígitos." };
      if (!trabajo("carga", null, columna.numeros)) return { ok: false, error: "Ya hay una consulta en curso." };
      const total = columna.numeros.length;
      cargaPendiente = null;
      return { ok: true, total };
    });
    ipcMain.handle("exportar-excel", async (_evento, ids) => {
      try {
        const dia = ahora().slice(0, 10);
        const datos = datosParaExcel(db, ids, dia);
        if (!datos.procesos.length) return { ok: false, error: "No hay expedientes con esos filtros." };
        const xml = libroExcel(datos);
        const elegido = await dialog.showSaveDialog(ventana, {
          title: "Descargar Excel",
          defaultPath: `vigencia-${dia}.xls`,
          filters: [{ name: "Excel", extensions: ["xls"] }],
        });
        if (elegido.canceled || !elegido.filePath) return { ok: false, cancelado: true };
        let ruta = elegido.filePath;
        if (!ruta.toLowerCase().endsWith(".xls")) ruta += ".xls";
        fs.writeFileSync(ruta, xml, "utf8");
        return { ok: true, actuaciones: datos.actuaciones.length, dia };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("informe-diario", async () => {
      try {
        const dia = ahora().slice(0, 10);
        const informes = informesDelDia(db, dia);
        if (!informes.length) return { ok: false, error: "Ningún abogado tiene expedientes." };
        const elegido = await dialog.showOpenDialog(ventana, {
          title: "Carpeta para los informes del día",
          buttonLabel: "Guardar aquí",
          properties: ["openDirectory", "createDirectory"],
        });
        if (elegido.canceled || !elegido.filePaths[0]) return { ok: false, cancelado: true };
        const carpeta = path.resolve(elegido.filePaths[0]);
        const usados = new Set();
        for (const informe of informes) {
          const nombre = nombreArchivoInforme(informe.cliente, dia, usados);
          const destino = path.resolve(carpeta, nombre);
          const relativo = path.relative(carpeta, destino);
          if (!relativo || relativo.startsWith("..") || path.isAbsolute(relativo)) {
            throw new Aviso("No pude guardar el informe en esa carpeta.");
          }
          try {
            const pdf = await pdfDesdeHtml(htmlInforme(informe, dia), ventana);
            fs.writeFileSync(destino, pdf);
          } catch (error) {
            console.error(error);
            const quien = nombreCliente(informe.cliente) || "un abogado";
            throw new Aviso(`No pude guardar el informe de ${quien}.`);
          }
        }
        return { ok: true, cantidad: informes.length, dia };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    function escritoDe(id, prompt) {
      const proceso = detalleProceso(db, id);
      if (!proceso) throw new Aviso("Ese expediente no está.");
      try {
        return redactarEscrito({
          expediente: fichaDeDetalle(proceso),
          prompt,
          hoy: fechaInforme(ahora().slice(0, 10)),
        });
      } catch (error) {
        if (error?.aviso) throw new Aviso(error.message);
        throw error;
      }
    }
    ipcMain.handle("preparar-escrito", (_evento, dato) => responder(() => {
      const escrito = escritoDe(dato?.id, dato?.prompt);
      return { asunto: escrito.asunto, secciones: escrito.secciones };
    }));
    ipcMain.handle("modelos-listar", () => responder(() => listarModelos(datosDir)));
    ipcMain.handle("piezas-listar", () => responder(() => ({ piezas: listarPiezas(db) })));
    ipcMain.handle("pieza-guardar", (_evento, dato) => responder(() => ({ pieza: guardarPieza(db, dato) })));
    ipcMain.handle("pieza-activar", (_evento, dato) => responder(() => ({
      pieza: activarPieza(db, dato?.id, Boolean(dato?.activa)),
    })));
    ipcMain.handle("pieza-borrar", (_evento, dato) => responder(() => {
      borrarPieza(db, dato?.id);
      return {};
    }));
    ipcMain.handle("modelos-modo", (_evento, dato) => responder(() => guardarModo(datosDir, dato?.modo)));
    ipcMain.handle("modelos-nube", () => responder(() => ({ nubes: leerNubes(datosDir) })));
    ipcMain.handle("modelos-guardar-nube", (_evento, dato) => responder(() => guardarNube(datosDir, dato || {})));
    ipcMain.handle("modelos-quitar-nube", (_evento, dato) => responder(() => quitarNube(datosDir, dato?.proveedor)));
    ipcMain.handle("modelos-probar", async (_evento, dato) => {
      let mensajePrueba = () => "";
      try {
        const nube = await import("./nube.js");
        const { chatNube, PROVEEDORES } = nube;
        mensajePrueba = nube.mensajePrueba;
        const definicion = PROVEEDORES[dato?.proveedor];
        if (!definicion) return { ok: false, error: "Ese proveedor no está soportado." };
        const key = String(dato?.key || "").trim();
        const modelo = String(dato?.modelo || "").trim() || definicion.modeloSugerido;
        if (!key) return { ok: false, error: "Escriba su clave primero." };
        if (!modelo) return { ok: false, error: "Escriba el nombre del modelo." };
        const texto = await chatNube({
          proveedor: dato.proveedor,
          key,
          modelo,
          base: dato?.base,
          texto: "Responde únicamente con la palabra: ok",
          maxTokens: 512,
          onUso: (uso) => guardarUso(db, { ...uso, proveedor: dato.proveedor, modelo, motivo: "prueba" }),
        });
        if (!texto.trim()) return { ok: false, error: "El proveedor respondió vacío." };
        return { ok: true, muestra: texto.trim().slice(0, 120) };
      } catch (error) {
        let mensaje = mensajePrueba(error) || mensajeHumano(error);
        if (dato?.proveedor === "meta" && /clave no fue aceptada/i.test(mensaje)) {
          mensaje += " Revise que la copió completa, sin espacios ni comillas.";
        }
        return { ok: false, error: mensaje };
      }
    });
    ipcMain.handle("modelos-recomendados", () => responder(() => ({ modelos: modelosRecomendados(datosDir) })));
    ipcMain.handle("gasto-resumen", () => responder(() => {
      const mes = new Date();
      const inicioMes = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, "0")}-01`;
      return {
        todo: resumenGastos(db, {}),
        mes: resumenGastos(db, { desde: inicioMes }),
      };
    }));
    ipcMain.handle("gasto-ultimo", async (_evento, dato) => {
      try {
        const nube = await import("./nube.js");
        const ultimo = ultimoGasto(db, Number(dato?.proyectoId) || 0);
        if (!ultimo) return { ok: true, hay: false };
        const ventana = nube.contextoDe(ultimo.modelo);
        const total = (Number(ultimo.entrada) || 0) + (Number(ultimo.salida) || 0);
        return {
          ok: true,
          hay: true,
          ...ultimo,
          ventana,
          porcentaje: ventana ? Math.min(100, Math.round((total / ventana) * 1000) / 10) : null,
        };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("pp-deptos", () => responder(() => {
      sembrarPpSiFalta();
      return { deptos: ppDeptos(db) };
    }));
    ipcMain.handle("pp-municipios", (_evento, dato) => responder(() => {
      sembrarPpSiFalta();
      return { municipios: ppMunicipios(db, String(dato?.depto || "")) };
    }));
    ipcMain.handle("pp-despachos", (_evento, dato) => responder(() => ({
      despachos: ppDespachos(db, String(dato?.depto || ""), String(dato?.muni || ""), String(dato?.texto || "")),
    })));
    ipcMain.handle("pp-cargados", () => responder(() => ({ cargados: ppCargados(db) })));
    ipcMain.handle("pp-publicaciones", (_evento, dato) => responder(() => ({
      publicaciones: ppPublicaciones(db, String(dato?.despacho || "")),
    })));
    ipcMain.handle("pp-documentos", (_evento, dato) => responder(() => ({
      documentos: ppDocumentos(db, Number(dato?.publicacion || 0)),
    })));
    ipcMain.handle("pp-cargar", (_evento, dato) => {
      if (cargaPp?.estado.corriendo) return { ok: false, error: "Ya hay una carga en curso." };
      const depto = String(dato?.depto || "");
      const despacho = String(dato?.despacho || "");
      if (!/^\d{2}$/.test(depto) || !/^\d{12}$/.test(despacho)) {
        return { ok: false, error: "Falta el despacho." };
      }
      cargaPp = crearCargaPp(db, { depto, despacho });
      cargaPp.correr((estado) => enviar("pp-progreso", estado)).then(
        (final) => enviar("pp-progreso", { ...final, terminado: true }),
        (error) => enviar("pp-progreso", { corriendo: false, terminado: true, error: mensajeHumano(error) }),
      );
      return { ok: true };
    });
    ipcMain.handle("pp-cancelar", () => {
      cargaPp?.cancelar();
      return { ok: true };
    });
    ipcMain.handle("pp-olvidar", (_evento, dato) => responder(() => {
      ppOlvidar(db, String(dato?.despacho || ""));
      return {};
    }));
    ipcMain.handle("spoa-consultar", async (_evento, dato) => {
      try {
        const registros = await buscarSp(String(dato?.radicado || ""));
        const registro = registros[0];
        const nuevas = guardarSpCaso(db, registro);
        return { ok: true, caso: spoaCaso(db, registro.noticia), nuevas };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("spoa-casos", () => responder(() => ({ casos: spoaCasos(db) })));
    ipcMain.handle("spoa-caso", (_evento, dato) => responder(() => ({
      caso: spoaCaso(db, String(dato?.noticia || "")),
    })));
    ipcMain.handle("spoa-olvidar", (_evento, dato) => responder(() => {
      spoaOlvidar(db, String(dato?.noticia || ""));
      return {};
    }));
    ipcMain.handle("samai-corporaciones", async () => {
      try {
        return { ok: true, corporaciones: await corporacionesSam(await abrirSesionSam()) };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("samai-buscar", async (_evento, dato) => {
      try {
        const sesion = await abrirSesionSam();
        const r = await buscarSam(sesion, String(dato?.criterio || ""), String(dato?.corporacion || ""), 1);
        return { ok: true, ...r };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("samai-ver", async (_evento, dato) => {
      try {
        const guid = String(dato?.guid || "");
        if (!guid) return { ok: false, error: "Falta el proceso." };
        const sesion = await abrirSesionSam();
        const actuaciones = await actuacionesSam(sesion, guid);
        const ficha = samaiCaso(db, guid) || {};
        const nuevas = guardarSamaiCaso(db, { ...ficha, guid, actuaciones });
        return { ok: true, caso: samaiCaso(db, guid), nuevas };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("samai-casos", () => responder(() => ({ casos: samaiCasos(db) })));
    ipcMain.handle("samai-caso", (_evento, dato) => responder(() => ({
      caso: samaiCaso(db, String(dato?.guid || "")),
    })));
    ipcMain.handle("samai-olvidar", (_evento, dato) => responder(() => {
      samaiOlvidar(db, String(dato?.guid || ""));
      return {};
    }));
    ipcMain.handle("pp-frecuencia", () => responder(() => ({ horas: leerFrecuenciaSistemas(db) })));
    ipcMain.handle("pp-guardar-frecuencia", (_evento, dato) => responder(() => {
      const horas = guardarFrecuenciaSistemas(db, dato?.horas);
      programarPpDiario();
      return { horas };
    }));
    ipcMain.handle("pp-abrir", (_evento, dato) => {
      try {
        const url = new URL(String(dato?.url || ""));
        if (url.protocol !== "https:" || url.hostname !== "publicacionesprocesales.ramajudicial.gov.co") {
          return { ok: false };
        }
        shell.openExternal(url.toString());
        return { ok: true };
      } catch {
        return { ok: false };
      }
    });
    ipcMain.handle("pp-vista", async (_evento, dato) => {
      try {
        const url = new URL(String(dato?.url || ""));
        if (url.protocol !== "https:" || url.hostname !== "publicacionesprocesales.ramajudicial.gov.co") {
          return { ok: false, error: "Ese enlace no es del micrositio." };
        }
        const sesion = await abrirSesion();
        const { bytes } = await traerPdf(sesion, url.toString());
        const nombre = String(dato?.nombre || "Documento");
        const token = guardarPdfPp(nombre, bytes);
        const urlLocal = await urlPdfLocal(token);
        if (!urlLocal) return { ok: false, error: "No pude abrir la vista previa." };
        return { ok: true, token, tamano: bytes.length, url: urlLocal };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("pp-descargar", async (_evento, dato) => {
      try {
        const url = new URL(String(dato?.url || ""));
        if (url.protocol !== "https:" || url.hostname !== "publicacionesprocesales.ramajudicial.gov.co") {
          return { ok: false, error: "Ese enlace no es del micrositio." };
        }
        let bytes = pdfsPp.get(String(dato?.token || ""))?.bytes || null;
        if (!bytes) {
          const sesion = await abrirSesion();
          bytes = (await traerPdf(sesion, url.toString())).bytes;
        }
        const elegido = await dialog.showSaveDialog(ventana, {
          title: "Guardar documento",
          defaultPath: nombreArchivoPdf(dato?.nombre),
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (elegido.canceled || !elegido.filePath) return { ok: false, cancelado: true };
        fs.writeFileSync(elegido.filePath, bytes);
        shell.showItemInFolder(elegido.filePath);
        return { ok: true, ruta: elegido.filePath };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("motor-estado", () => responder(() => estadoMotor(datosDir, {
      raiz: RAIZ,
      recursos: process.resourcesPath,
    })));
    ipcMain.handle("motor-diagnostico", async () => {
      try {
        return { ok: true, ...(await diagnosticoMotor(datosDir, {
          raiz: RAIZ,
          recursos: process.resourcesPath,
          version: app.getVersion(),
          probar: true,
        })) };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("motor-instalar", async (evento) => {
      try {
        const estado = await instalarMotor(datosDir, {
          raiz: RAIZ,
          recursos: process.resourcesPath,
          onProgreso: (avance) => {
            try {
              evento.sender.send("motor-progreso", avance);
            } catch {
              /* la ventana se cerró */
            }
          },
        });
        return { ok: true, ...estado };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("modelos-descargar", async (evento, dato) => {
      try {
        const { id } = await descargarModelo(datosDir, dato?.id, (avance) => {
          try {
            evento.sender.send("modelo-progreso", avance);
          } catch {
            /* la ventana se cerró */
          }
        });
        guardarActivo(datosDir, id);
        return { ok: true, ...listarModelos(datosDir) };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("modelos-usar", (_evento, dato) => responder(() => guardarActivo(datosDir, dato?.id)));
    ipcMain.handle("modelos-borrar", async (_evento, dato) => {
      try {
        return { ok: true, ...(await borrarModelo(datosDir, dato?.id)) };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("modelos-importar", async () => {
      const elegido = await dialog.showOpenDialog(ventana, {
        title: "Importar modelo GGUF",
        properties: ["openFile"],
        filters: [{ name: "Modelo GGUF", extensions: ["gguf"] }],
      });
      if (elegido.canceled || !elegido.filePaths[0]) return { ok: false, cancelado: true };
      try {
        const { id } = importarModelo(datosDir, elegido.filePaths[0]);
        guardarActivo(datosDir, id);
        return { ok: true, ...listarModelos(datosDir) };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("iniciar-generar", async (evento, dato) => {
      try {
        const borrador = await generarInicial({
          datosDir,
          tipo: dato?.tipo,
          datos: dato?.datos || {},
          hoy: ahora().slice(0, 10),
          modeloId: dato?.modelo,
          piezas: listarPiezas(db),
          excluir: dato?.excluir,
          aclaracion: dato?.aclaracion,
          onProgreso: (avance) => {
            try {
              evento.sender.send("borrador-progreso", avance);
            } catch {
              /* la ventana se cerró */
            }
          },
          onUso: (uso) => guardarUso(db, { ...uso, motivo: "inicial" }),
        });
        return { ok: true, ...borrador };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("iniciar-guardar", async (_evento, dato) => {
      try {
        const escrito = validarBorrador(dato?.borrador);
        const titulo = dato?.titulo || escrito.asunto || "Documento";
        if (dato?.formato === "pdf") {
          const pdf = await pdfDesdeHtml(htmlMemorial({
            ...escrito,
            ficha: {
              despacho: dato?.autoridad,
              radicado: "sin radicar",
              tipo_proceso: `Documento inicial · ${titulo}`,
              demandantes: dato?.presentante,
              demandados: dato?.contraparte,
            },
            fecha: ahora().slice(0, 10),
          }), ventana);
          const elegido = await dialog.showSaveDialog(ventana, {
            title: `Descargar ${titulo} en PDF`,
            defaultPath: `${titulo}.pdf`,
            filters: [{ name: "PDF", extensions: ["pdf"] }],
          });
          if (elegido.canceled || !elegido.filePath) return { ok: false, cancelado: true };
          let ruta = elegido.filePath;
          if (!ruta.toLowerCase().endsWith(".pdf")) ruta += ".pdf";
          fs.writeFileSync(ruta, pdf);
          return { ok: true };
        }
        const bytes = docxDeEscrito(escrito);
        const elegido = await dialog.showSaveDialog(ventana, {
          title: `Guardar ${titulo}`,
          defaultPath: `${titulo}.docx`,
          filters: [{ name: "Word", extensions: ["docx"] }],
        });
        if (elegido.canceled || !elegido.filePath) return { ok: false, cancelado: true };
        let ruta = elegido.filePath;
        if (!ruta.toLowerCase().endsWith(".docx")) ruta += ".docx";
        fs.writeFileSync(ruta, bytes);
        return { ok: true };
      } catch (error) {
        console.error(error);
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("escrito-generar", async (evento, dato) => {      try {
        const proceso = detalleProceso(db, dato?.id);
        if (!proceso) return { ok: false, error: "Ese expediente no está." };
        let ejemplo = "";
        if (dato?.ejemploDocx) {
          const leido = textoDeDocx(Buffer.from(String(dato.ejemploDocx), "base64"));
          if (!leido.ok) return { ok: false, error: leido.error };
          ejemplo = leido.texto;
        }
        const borrador = await generarBorrador({
          datosDir,
          proceso,
          prompt: dato?.prompt,
          hoy: ahora().slice(0, 10),
          modeloId: dato?.modelo,
          piezas: listarPiezas(db),
          excluir: dato?.excluir,
          aclaracion: dato?.aclaracion,
          referencia: dato?.referencia,
          presenta: dato?.presenta,
          ejemplo,
          onProgreso: (avance) => {
            try {
              evento.sender.send("borrador-progreso", avance);
            } catch {
              /* la ventana se cerró */
            }
          },
          onUso: (uso) => guardarUso(db, { ...uso, motivo: "escrito" }),
        });
        return { ok: true, ...borrador };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    function validarBorrador(borrador) {
      const secciones = borrador?.secciones;
      if (!borrador || typeof borrador.asunto !== "string" || !Array.isArray(secciones)) {
        throw new Aviso("Genere de nuevo el documento antes de guardarlo.");
      }
      for (const seccion of secciones) {
        if (typeof seccion?.titulo !== "string" || !Array.isArray(seccion?.parrafos)) {
          throw new Aviso("Genere de nuevo el documento antes de guardarlo.");
        }
      }
      return {
        asunto: borrador.asunto.slice(0, 120),
        secciones,
        origen: borrador.origen === "nube" ? "nube" : "local",
      };
    }
    ipcMain.handle("escrito-guardar-borrador", async (_evento, dato) => {
      try {
        const proceso = detalleProceso(db, dato?.id);
        if (!proceso) return { ok: false, error: "Ese expediente no está." };
        const escrito = validarBorrador(dato?.borrador);
        const bytes = docxDeEscrito(escrito);
        const elegido = await dialog.showSaveDialog(ventana, {
          title: "Guardar el escrito",
          defaultPath: `Escrito ${proceso?.radicado || "expediente"}.docx`,
          filters: [{ name: "Word", extensions: ["docx"] }],
        });
        if (elegido.canceled || !elegido.filePath) return { ok: false, cancelado: true };
        let ruta = elegido.filePath;
        if (!ruta.toLowerCase().endsWith(".docx")) ruta += ".docx";
        fs.writeFileSync(ruta, bytes);
        return { ok: true, asunto: escrito.asunto };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("escrito-guardar-pdf", async (_evento, dato) => {
      try {
        const proceso = detalleProceso(db, dato?.id);
        if (!proceso) return { ok: false, error: "Ese expediente no está." };
        const escrito = validarBorrador(dato?.borrador);
        const pdf = await pdfDesdeHtml(htmlMemorial({
          ...escrito,
          ficha: fichaDeDetalle(proceso),
          fecha: ahora().slice(0, 10),
        }), ventana);
        const elegido = await dialog.showSaveDialog(ventana, {
          title: "Descargar el memorial en PDF",
          defaultPath: `Memorial ${proceso?.radicado || "expediente"}.pdf`,
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (elegido.canceled || !elegido.filePath) return { ok: false, cancelado: true };
        let ruta = elegido.filePath;
        if (!ruta.toLowerCase().endsWith(".pdf")) ruta += ".pdf";
        fs.writeFileSync(ruta, pdf);
        return { ok: true, asunto: escrito.asunto };
      } catch (error) {
        console.error(error);
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("guardar-escrito", async (_evento, dato) => {
      try {
        const escrito = escritoDe(dato?.id, dato?.prompt);
        const proceso = detalleProceso(db, dato?.id);
        const bytes = docxDeEscrito(escrito);
        const elegido = await dialog.showSaveDialog(ventana, {
          title: "Guardar el escrito",
          defaultPath: `Escrito ${proceso?.radicado || "expediente"}.docx`,
          filters: [{ name: "Word", extensions: ["docx"] }],
        });
        if (elegido.canceled || !elegido.filePath) return { ok: false, cancelado: true };
        let ruta = elegido.filePath;
        if (!ruta.toLowerCase().endsWith(".docx")) ruta += ".docx";
        fs.writeFileSync(ruta, bytes);
        return { ok: true, asunto: escrito.asunto };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("tema", (_evento, tema) => {
      const color = tema === "oscuro" ? "#1c1814" : "#efeae1";
      if (ventana && !ventana.isDestroyed()) ventana.setBackgroundColor(color);
      return { ok: true };
    });
    ipcMain.handle("copiar", (_evento, numero) => {
      const limpio = normalizarRadicado(numero);
      if (limpio.length !== 23) return { ok: false };
      clipboard.writeText(limpio);
      return { ok: true };
    });
    ipcMain.handle("licencia", async () => {
      const info = await leerPlan({ dir: datosDir });
      if (info.estado === "vigente") programador?.reprogramar();
      return info;
    });
    ipcMain.handle("licencia-iniciar", async () => {
      const resultado = await iniciarPlan({ dir: datosDir });
      if (resultado.estado === "vigente") programador?.reprogramar();
      if (resultado.url) abrirPago(resultado.url);
      return resultado;
    });
    ipcMain.handle("licencia-navegador", () => {
      if (!ultimaUrlPago) return { ok: false, error: "Primero inicia el plan." };
      shell.openExternal(ultimaUrlPago);
      return { ok: true };
    });
    ipcMain.handle("licencia-confirmar", async () => {
      const resultado = await confirmarPlan({ dir: datosDir });
      if (resultado.estado === "vigente") programador?.reprogramar();
      return resultado;
    });
    ipcMain.handle("licencia-activar", (_evento, codigo) => {
      const resultado = activarCodigo({ dir: datosDir, codigo });
      if (resultado.estado === "vigente") programador?.reprogramar();
      return resultado;
    });
    ipcMain.handle("comentarios-listar", async () => {
      try {
        return { ok: true, comentarios: await listarComentarios() };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("comentarios-enviar", async (_evento, dato) => {
      try {
        await enviarComentario(dato || {});
        return { ok: true };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("salir", () => {
      salir();
      return { ok: true };
    });
    ipcMain.handle("actualizacion-comprobar", async () => {
      try {
        return { ok: true, ...(await consultarVersion(app.getVersion())) };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    ipcMain.handle("actualizacion-omitir", (_evento, dato) => responder(() => {
      guardarOmitida(String(dato?.version || ""));
      return {};
    }));
    ipcMain.handle("actualizacion-descargar", async (evento, dato) => {
      try {
        const archivo = String(dato?.archivo || "");
        if (!archivo || archivo.includes("/") || archivo.includes("\\") || archivo.includes("..")) {
          return { ok: false, error: "No hay instalador para este computador." };
        }
        const destino = path.join(os.tmpdir(), archivo);
        await descargarActualizacion(archivo, destino, (avance) => {
          try {
            evento.sender.send("actualizacion-progreso", avance);
          } catch {
            /* la ventana se cerró */
          }
        });
        if (process.platform === "linux") {
          shell.showItemInFolder(destino);
          return { ok: true, ruta: destino, accion: "carpeta" };
        }
        const errorAbrir = await shell.openPath(destino);
        if (errorAbrir) {
          shell.showItemInFolder(destino);
          return { ok: true, ruta: destino, accion: "carpeta" };
        }
        return { ok: true, ruta: destino, accion: process.platform === "darwin" ? "montar" : "instalar" };
      } catch (error) {
        return { ok: false, error: mensajeHumano(error) };
      }
    });
    crearBandeja();
    const oculta = Boolean(bandeja) && abiertaAlIniciarSesion({ argv: process.argv, plataforma: process.platform, app });
    crearVentana(!oculta);
    aplicarInicioSesion();
    iniciarProgramador();
    programarRevisionActualizacion();
    programarPpDiario();
  });

  app.on("before-quit", () => {
    saliendo = true;
  });
  app.on("window-all-closed", () => {
    if (!bandeja || saliendo) app.quit();
  });
  app.on("will-quit", () => {
    programador?.detener();
    conversor?.cola.cerrar();
    limpiarTemporales({ edadMs: 0 });
    try {
      servidorPdf?.close();
    } catch {
      /* ya estaba cerrado */
    }
    try {
      db?.close();
    } catch {
      /* la base ya estaba cerrada */
    }
  });
}

process.on("unhandledRejection", (error) => {
  registrar(`error sin atender: ${error?.message || error}`);
});
