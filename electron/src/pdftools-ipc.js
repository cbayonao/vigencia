// Canales IPC de Herramientas PDF. Los diálogos de abrir/guardar son del
// sistema; los bytes nunca salen del computador.
import fs from "node:fs";
import path from "node:path";
import { NIVELES_COMPRIMIR, camposPdf, comprimirPdf, rellenarPdf } from "./pdftools.js";
import { protegerPdf } from "./pdfproteger.js";
import { desbloquearPdf } from "./pdfdescifrar.js";
import { textoDePdf } from "./pdftexto.js";
import { parsearRangos } from "../compartido/pdftools.js";
import { firmarPdf, infoPdf, rotarPdf, separarPdf, unirPdfs } from "./pdftools.js";

const FILTRO_PDF = [{ name: "PDF", extensions: ["pdf"] }];

function aRutas(valor) {
  return (Array.isArray(valor) ? valor : []).map(String).filter(Boolean).slice(0, 50);
}

export function registrarPdftools({ ipcMain, dialog, ventana, mensajeHumano }) {
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
      return { ok: true, nombre: path.basename(ruta), ...(await infoPdf(ruta)) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  async function guardarComo(titulo, sugerido, bytes) {
    const r = await dialog.showSaveDialog(ventana(), {
      title: titulo,
      defaultPath: sugerido,
      filters: FILTRO_PDF,
    });
    if (r.canceled || !r.filePath) return { ok: false, cancelado: true };
    let ruta = r.filePath;
    if (!ruta.toLowerCase().endsWith(".pdf")) ruta += ".pdf";
    fs.writeFileSync(ruta, bytes);
    return { ok: true, ruta };
  }

  ipcMain.handle("pdf-unir", async (_e, dato) => {
    try {
      const rutas = aRutas(dato?.rutas);
      if (rutas.length < 2) return { ok: false, error: "Elija al menos 2 PDF para unir." };
      const bytes = await unirPdfs(rutas);
      return await guardarComo("Guardar el PDF unido", "unidos.pdf", bytes);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-separar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const total = (await infoPdf(ruta)).paginas;
      const { indices, error } = parsearRangos(dato?.rangos, total);
      if (error) return { ok: false, error };
      const bytes = await separarPdf(ruta, indices);
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      return await guardarComo("Guardar las páginas elegidas", `${base}-paginas.pdf`, bytes);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-rotar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const total = (await infoPdf(ruta)).paginas;
      const texto = String(dato?.rangos || "").trim();
      let indices = null;
      if (texto) {
        const r = parsearRangos(texto, total);
        if (r.error) return { ok: false, error: r.error };
        indices = r.indices;
      }
      const bytes = await rotarPdf(ruta, indices, dato?.angulo);
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      return await guardarComo("Guardar el PDF girado", `${base}-girado.pdf`, bytes);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-firmar", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const total = (await infoPdf(ruta)).paginas;
      const texto = String(dato?.paginas || "").trim().toLowerCase();
      let paginas = null;
      if (texto && texto !== "todas") {
        const r = parsearRangos(texto, total);
        if (r.error) return { ok: false, error: r.error };
        paginas = r.indices;
      }
      const bytes = await firmarPdf(ruta, dato?.firma, {
        paginas,
        posicion: dato?.posicion,
        ancho: Number(dato?.ancho) || 150,
      });
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      return await guardarComo("Guardar el PDF firmado", `${base}-firmado.pdf`, bytes);
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });

  ipcMain.handle("pdf-comprimir", async (_e, dato) => {
    try {
      const ruta = String(dato?.ruta || "");
      if (!ruta) return { ok: false, error: "Elija primero el PDF." };
      const antes = fs.statSync(ruta).size;
      const r = await comprimirPdf(ruta, dato?.nivel);
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      const g = await guardarComo("Guardar el PDF comprimido", `${base}-comprimido.pdf`, r.bytes);
      if (!g.ok) return g;
      return { ...g, tocadas: r.tocadas, intactas: r.intactas, nivel: r.nivel, antes, despues: r.bytes.length };
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
      const bytes = await protegerPdf(ruta, { usuario: clave, duenio: String(dato?.duenio || "") });
      const base = path.basename(ruta, ".pdf").slice(0, 60);
      return await guardarComo("Guardar el PDF protegido", `${base}-protegido.pdf`, bytes);
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
      return await guardarComo("Guardar el PDF sin contraseña", `${base}-abierto.pdf`, bytes);
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
      return await guardarComo("Guardar el PDF diligenciado", `${base}-diligenciado.pdf`, bytes);
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
        let datos;
        try {
          datos = fs.readFileSync(ruta);
        } catch {
          return { ok: false, error: "No pude leer un PDF." };
        }
        const t = textoDePdf(datos);
        if (!t.ok) return { ok: false, error: /contraseña/i.test(t.error || "") ? "Uno tiene contraseña: desbloquéelo primero." : t.error };
        leidos.push(t.texto || "");
      }
      return { ok: true, textoA: leidos[0].slice(0, 300000), textoB: leidos[1].slice(0, 300000) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
}
