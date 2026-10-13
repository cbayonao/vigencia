import { estadoMotor, instalarMotor, usarDatosMotor, diagnosticoMotor } from "./motor.js";
import fs from "node:fs";
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
import { columnasDeRadicado } from "./csv.js";
import { activarCodigo, confirmarPlan, fotoLicencia, iniciarPlan, leerPlan } from "./licencia.js";
import { urlServicio } from "../compartido/licencia.js";
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
  avisosDesde,
  cerrarRevisionesColgadas,
  guardarHorarios,
  guardarInicioSesion,
  guardarUltimoTurno,
  iniciarRevision,
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
import { generarBorrador, generarInicial, guardarActivo, guardarModo, importarModelo, listarModelos, descargarModelo, modelosRecomendados, leerNubes, guardarNube } from "./ia.js";
import { htmlMemorial } from "./memorial.js";
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
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

let ventana = null;
let db = null;
let datosDir = "";
let cargaPendiente = null;
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
  return fotoLicencia(datosDir).estado === "vigente";
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
    ipcMain.handle("modelos-probar", async (_evento, dato) => {
      try {
        const { chatNube, PROVEEDORES } = await import("./nube.js");
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
        });
        if (!texto.trim()) return { ok: false, error: "El proveedor respondió vacío." };
        return { ok: true, muestra: texto.trim().slice(0, 120) };
      } catch (error) {
        let mensaje = mensajeHumano(error);
        if (dato?.proveedor === "meta" && /clave no fue aceptada/i.test(mensaje)) {
          mensaje += " Las claves de Meta tienen la forma LLM|…|… : cópiela completa del panel, sin espacios ni comillas alrededor.";
        }
        return { ok: false, error: mensaje };
      }
    });
    ipcMain.handle("modelos-recomendados", () => responder(() => ({ modelos: modelosRecomendados(datosDir) })));
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
  });

  app.on("before-quit", () => {
    saliendo = true;
  });
  app.on("window-all-closed", () => {
    if (!bandeja || saliendo) app.quit();
  });
  app.on("will-quit", () => {
    programador?.detener();
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
