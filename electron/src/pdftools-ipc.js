// Canales IPC de Herramientas PDF. Los diálogos de abrir/guardar son del
// sistema; los bytes nunca salen del computador.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NIVELES_COMPRIMIR, borrarFirma, camposPdf, comprimirPdf, guardarActa, guardarFirma, listarFirmas, rellenarPdf, renombrarFirma, verificarPdf } from "./pdftools.js";
import { protegerPdf } from "./pdfproteger.js";
import { desbloquearPdf } from "./pdfdescifrar.js";
import { textoDePdfCompleto } from "./pdftexto.js";
import { revisarRuta } from "./fuentes.js";
import { parsearRangos } from "../compartido/pdftools.js";
import { firmarPdf, infoPdf, rotarPaginas, rotarPdf, separarPdf, unirPdfs } from "./pdftools.js";

const FILTRO_PDF = [{ name: "PDF", extensions: ["pdf"] }];

function aRutas(valor) {
  return (Array.isArray(valor) ? valor : []).map(String).filter(Boolean).slice(0, 50);
}

// Copias temporales (un PDF ya desbloqueado que el usuario no guardó pero
// quiere llevar al contexto). Viven en la carpeta temporal del sistema y se
// borran a las 24 horas o al cerrar la app.
export function carpetaTemporalPdf(base = os.tmpdir()) {
  return path.join(base, "vigencia-pdf");
}

export function guardarTemporal(bytes, nombre, base = os.tmpdir()) {
  const dir = path.join(carpetaTemporalPdf(base), crypto.randomBytes(8).toString("hex"));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const limpio = String(nombre || "documento.pdf").replace(/[\\/:*?"<>|]+/g, " ").trim() || "documento.pdf";
  const ruta = path.join(dir, /\.(pdf|md)$/i.test(limpio) ? limpio : `${limpio}.pdf`);
  fs.writeFileSync(ruta, bytes, { mode: 0o600 });
  return ruta;
}

export function limpiarTemporales({ base = os.tmpdir(), edadMs = 24 * 3600 * 1000, ahora = Date.now() } = {}) {
  const raiz = carpetaTemporalPdf(base);
  let borradas = 0;
  let entradas = [];
  try {
    entradas = fs.readdirSync(raiz);
  } catch {
    return 0;
  }
  for (const e of entradas) {
    const ruta = path.join(raiz, e);
    try {
      if (edadMs <= 0 || ahora - fs.statSync(ruta).mtimeMs >= edadMs) {
        fs.rmSync(ruta, { recursive: true, force: true });
        borradas++;
      }
    } catch {
      /* ya no está */
    }
  }
  return borradas;
}

// Texto para Comparar: el mismo lector de Convertir (pdfjs, fuentes CID y
// OCR si está instalado), con el lector simple de respaldo.
export async function textoParaComparar(ruta, { datosDir = "", conPaginas = false } = {}) {
  let datos;
  try {
    datos = fs.readFileSync(ruta);
  } catch {
    return { ok: false, error: "No pude leer un PDF." };
  }
  const t = await textoDePdfCompleto(datos, { datosDir, conPaginas });
  if (!t.ok) return { ok: false, error: t.codigo === "clave" || /contraseña/i.test(t.error || "") ? "Uno tiene contraseña: desbloquéelo primero." : t.error };
  return { ok: true, texto: t.texto || "" };
}

// Unir: cada entrada es una ruta o { ruta, indices } con las páginas elegidas.
function aEntradas(dato) {
  if (Array.isArray(dato?.partes)) {
    return dato.partes.slice(0, 50).map((p) => ({
      ruta: String(p?.ruta || ""),
      indices: Array.isArray(p?.indices) ? p.indices.slice(0, 5000).map(Number) : undefined,
    })).filter((p) => p.ruta);
  }
  return aRutas(dato?.rutas);
}

// Un nombre que no pisa nada en esa carpeta: base.pdf, base (2).pdf...
export function nombreLibre(carpeta, base) {
  let ruta = path.join(carpeta, `${base}.pdf`);
  for (let k = 2; fs.existsSync(ruta); k += 1) ruta = path.join(carpeta, `${base} (${k}).pdf`);
  return ruta;
}

// Abrir y mostrar solo PDF que existen: la ventana no abre cualquier cosa.
function pdfExistente(ruta) {
  const r = String(ruta || "");
  if (!r || !/\.pdf$/i.test(r) || !path.isAbsolute(r)) return "";
  try {
    return fs.statSync(r).isFile() ? r : "";
  } catch {
    return "";
  }
}

export function registrarPdftools({ ipcMain, dialog, shell = null, ventana, mensajeHumano, datosDir = () => "", convertirDatos = null, db = null }) {
  // Comprimir mide sin guardar; si luego guarda lo mismo, no lo repite.
  let medida = null;
  limpiarTemporales();
  const requireDb = () => {
    const base = typeof db === "function" ? db() : db;
    if (!base) throw new Error("La base no está lista.");
    return base;
  };
  // Canal que solo responde {ok, ...} o el error en palabras.
  const canal = (nombre, fn) => ipcMain.handle(nombre, async (_e, dato) => {
    try {
      return { ok: true, ...(await fn(dato || {})) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-elegir", async (_e, dato) => {
    try {
      const r = await dialog.showOpenDialog(ventana(), {
        title: "Elegir PDF",
        properties: dato?.varios ? ["openFile", "multiSelections"] : ["openFile"],
        filters: FILTRO_PDF,
      });
      return { ok: true, rutas: r.canceled ? [] : r.filePaths };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-info", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      return { ok: true, nombre: path.basename(ruta), bytes: fs.statSync(ruta).size, ...(await infoPdf(ruta)) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-abrir", async (_e, dato) => {
    const ruta = pdfExistente(dato?.ruta);
    if (!ruta || !shell) return { ok: false, error: "Ese PDF ya no está." };
    const error = await shell.openPath(ruta);
    return error ? { ok: false, error: "No hay un programa para abrir PDF en este computador." } : { ok: true };
  });

  ipcMain.handle("pdf-mostrar", (_e, dato) => {
    const ruta = pdfExistente(dato?.ruta);
    if (!ruta || !shell) return { ok: false, error: "Ese PDF ya no está." };
    shell.showItemInFolder(ruta);
    return { ok: true };
  });

  // original: el PDF de entrada; nunca se escribe encima de él.
  async function guardarComo(titulo, sugerido, bytes, original = "") {
    const r = await dialog.showSaveDialog(ventana(), {
      title: titulo,
      defaultPath: original ? path.join(path.dirname(original), sugerido) : sugerido,
      filters: FILTRO_PDF,
    });
    if (r.canceled || !r.filePath) return { ok: false, cancelado: true };
    let ruta = r.filePath;
    if (!ruta.toLowerCase().endsWith(".pdf")) ruta += ".pdf";
    if (original && path.resolve(ruta) === path.resolve(original)) {
      return { ok: false, error: "Ese es el PDF original. Guarde el resultado con otro nombre." };
    }
    fs.writeFileSync(ruta, bytes);
    return { ok: true, ruta };
  }

  ipcMain.handle("pdf-unir", async (_e, dato) => {
    try {
      const entradas = aEntradas(dato);
      if (entradas.length < 2) return { ok: false, error: "Elija al menos 2 PDF para unir." };
      const bytes = await unirPdfs(entradas);
      const primero = typeof entradas[0] === "string" ? entradas[0] : entradas[0].ruta;
      return await guardarComo("Guardar el PDF unido", "unidos.pdf", bytes, primero);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-separar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      // Varias partes (cortes): una carpeta y un PDF por parte.
      const partes = Array.isArray(dato?.partes) ? dato.partes.filter((p) => Array.isArray(p) && p.length).slice(0, 200) : [];
      if (partes.length > 1) {
        const bytes = [];
        for (const indices of partes) bytes.push(await separarPdf(ruta, indices.map(Number)));
        const r = await dialog.showOpenDialog(ventana(), {
          title: `Carpeta para las ${partes.length} partes`,
          defaultPath: path.dirname(ruta),
          properties: ["openDirectory", "createDirectory"],
        });
        if (r.canceled || !r.filePaths?.[0]) return { ok: false, cancelado: true };
        const rutas = bytes.map((b, k) => {
          const destino = nombreLibre(r.filePaths[0], `${base}-parte-${k + 1}`);
          fs.writeFileSync(destino, b);
          return destino;
        });
        return { ok: true, ruta: rutas[0], rutas, carpeta: r.filePaths[0] };
      }
      let indices = partes[0];
      if (!indices) {
        const total = (await infoPdf(ruta)).paginas;
        const r = parsearRangos(dato?.rangos, total);
        if (r.error) return { ok: false, error: r.error };
        indices = r.indices;
      }
      const bytes = await separarPdf(ruta, indices.map(Number));
      return await guardarComo("Guardar las páginas elegidas", `${base}-paginas.pdf`, bytes, ruta);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-rotar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      let bytes;
      if (dato?.giros && typeof dato.giros === "object") {
        bytes = await rotarPaginas(ruta, dato.giros);
      } else {
        const total = (await infoPdf(ruta)).paginas;
        const texto = String(dato?.rangos || "").trim();
        let indices = null;
        if (texto) {
          const r = parsearRangos(texto, total);
          if (r.error) return { ok: false, error: r.error };
          indices = r.indices;
        }
        bytes = await rotarPdf(ruta, indices, dato?.angulo);
      }
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      return await guardarComo("Guardar el PDF girado", `${base}-girado.pdf`, bytes, ruta);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-firmar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const firmante = { nombre: dato?.firmante, documento: dato?.documento };
      const r = await firmarPdf(ruta, { imagenes: dato?.imagenes, marcas: dato?.marcas, constancia: dato?.constancia !== false, firmante });
      const base = path.basename(ruta, path.extname(ruta)).slice(0, 60);
      const g = await guardarComo("Guardar el PDF firmado", `${base}-firmado.pdf`, r.bytes, ruta);
      if (!g.ok) return g;
      if (r.codigo) {
        try {
          guardarActa(requireDb(), {
            codigo: r.codigo, fecha: r.fecha, firmante: String(firmante.nombre || "").slice(0, 120),
            documento: String(firmante.documento || "").slice(0, 40), hashContenido: r.hashContenido,
            hashFinal: r.hashFinal, paginas: r.paginas, pdfNombre: path.basename(g.ruta),
          });
        } catch {
          /* el acta en la base es respaldo: el PDF ya trae la constancia */
        }
      }
      return { ...g, codigo: r.codigo, paginas: r.paginas };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  // Bytes del PDF para dibujar la página en la ventana (el visor pdfjs
  // corre en el renderer; aquí solo se leen del disco).
  ipcMain.handle("pdf-archivo", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      if (fs.statSync(ruta).size > 100 * 1024 * 1024) return { ok: false, error: "Ese PDF pesa más de 100 MB." };
      return { ok: true, base64: fs.readFileSync(ruta).toString("base64") };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-verificar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      let db = null;
      try {
        db = requireDb();
      } catch {
        db = null;
      }
      return { ok: true, ...(await verificarPdf(ruta, db)) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  canal("firmas-listar", () => ({ firmas: listarFirmas(requireDb()) }));
  canal("firma-guardar", (d) => guardarFirma(requireDb(), { nombre: d.nombre, png: d.png }));
  canal("firma-renombrar", (d) => renombrarFirma(requireDb(), d.id, d.nombre));
  canal("firma-borrar", (d) => borrarFirma(requireDb(), d.id));

  ipcMain.handle("pdf-comprimir", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const est = fs.statSync(ruta);
      const antes = est.size;
      const nivel = String(dato?.nivel || "media");
      const igual = medida && medida.ruta === ruta && medida.nivel === nivel && medida.mtime === est.mtimeMs;
      const r = igual ? medida.r : await comprimirPdf(ruta, nivel);
      medida = { ruta, nivel, mtime: est.mtimeMs, r };
      const cifras = { tocadas: r.tocadas, intactas: r.intactas, nivel: r.nivel, antes, despues: r.bytes.length };
      // Medir: cuánto quedaría y el PDF para verlo, sin guardar nada.
      if (dato?.medir) return { ok: true, ...cifras, base64: r.bytes.length <= 40 * 1024 * 1024 ? r.bytes.toString("base64") : "" };
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      const g = await guardarComo("Guardar el PDF comprimido", `${base}-comprimido.pdf`, r.bytes, ruta);
      if (!g.ok) return g;
      return { ...g, ...cifras };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-proteger", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const clave = String(dato?.clave || "");
      if (clave.length < 1) return { ok: false, error: "Escriba una contraseña." };
      const permisos = Number.isInteger(dato?.permisos) ? dato.permisos | 0 : -4;
      const bytes = await protegerPdf(ruta, { usuario: clave, duenio: String(dato?.duenio || ""), permisos });
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      return await guardarComo("Guardar el PDF protegido", `${base}-protegido.pdf`, bytes, ruta);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-desbloquear", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const bytes = await desbloquearPdf(ruta, String(dato?.clave || ""));
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      // La copia sin contraseña queda también en un temporal: así se puede
      // llevar al contexto aunque el usuario no guarde una copia.
      const nombre = `${base}-abierto.pdf`;
      const temporal = guardarTemporal(bytes, nombre);
      return { ...(await guardarComo("Guardar el PDF sin contraseña", nombre, bytes, ruta)), temporal, nombre };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-campos", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      return { ok: true, nombre: path.basename(ruta), ...(await camposPdf(ruta)) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-rellenar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const bytes = await rellenarPdf(ruta, dato?.valores || {}, { aplanar: dato?.aplanar !== false });
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      return await guardarComo("Guardar el PDF diligenciado", `${base}-diligenciado.pdf`, bytes, ruta);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-comparar", async (_e, dato) => {
    try {
      const a = String(dato?.rutaA || "");
      const b = String(dato?.rutaB || "");
      if (!a || !b) return { ok: false, error: "Elija los dos PDF." };
      if (a === b) return { ok: false, error: "Son el mismo archivo dos veces." };
      const leidos = [];
      for (const ruta of [a, b]) {
        const t = await textoParaComparar(ruta, { datosDir: datosDir(), conPaginas: true });
        if (!t.ok) return t;
        leidos.push(t.texto);
      }
      return { ok: true, textoA: leidos[0].slice(0, 300000), textoB: leidos[1].slice(0, 300000) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
  // Llevar un PDF (elegido, resultado de una herramienta o copia temporal
  // ya desbloqueada) al conversor: queda en Convertir con su Markdown y, si
  // hay proyecto, en el contexto del proyecto. Mismo camino que Convertir.
  ipcMain.handle("pdf-a-proyecto", async (_e, dato) => {
    try {
      if (!convertirDatos) return { ok: false, error: "El conversor todavía no está listo." };
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      // También la tabla en Markdown que deja Estados.
      const ext = path.extname(ruta).toLowerCase();
      if (ext !== ".pdf" && ext !== ".md") return { ok: false, error: "Eso no es un PDF." };
      const problema = revisarRuta(ruta);
      if (problema) return { ok: false, error: problema };
      const nombre = String(dato?.nombre || "").trim().slice(0, 120) || path.basename(ruta);
      const r = await convertirDatos({
        datos: fs.readFileSync(ruta),
        nombre: nombre.toLowerCase().endsWith(ext) ? nombre : `${nombre}${ext}`,
        meta: { herramienta: "pdf" },
        proyectoId: Number(dato?.proyectoId) || null,
        forzarOcr: Boolean(dato?.forzarOcr),
      });
      if (r.error || !r.archivo) return { ok: false, error: r.error || "No pude convertirlo.", codigo: r.codigo || "" };
      return { ok: true, archivo: r.archivo, cache: Boolean(r.cache), proyectoId: Number(dato?.proyectoId) || null };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
}
