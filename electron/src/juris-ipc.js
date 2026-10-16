// Canales IPC del módulo Jurisprudencia. main.js los registra con su base
// y su forma de responder. La búsqueda es en vivo contra cada relatoría;
// solo se guarda lo que el usuario elige, como fuente de la biblioteca.
import { CORPORACIONES_CE_BASE, FUENTES_JURIS, SALAS_CSJ, TIPOS_CCC } from "../compartido/juris.js";
import { buscarJuris, guardarJuris, leerJuris } from "./juris.js";

export function registrarJuris({ ipcMain, db, responder, mensajeHumano }) {
  const base = () => db();
  ipcMain.handle("juris-fuentes", () => responder(() => ({
    fuentes: FUENTES_JURIS,
    salasCsj: SALAS_CSJ,
    tiposCcc: TIPOS_CCC,
    corporacionesCe: CORPORACIONES_CE_BASE,
  })));
  ipcMain.handle("juris-buscar", async (_e, dato) => {
    try {
      const r = await buscarJuris({ fuente: dato?.fuente, texto: dato?.texto, filtros: dato?.filtros || {} });
      return { ok: true, ...r };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
  ipcMain.handle("juris-leer", async (_e, dato) => {
    try {
      return { ok: true, texto: await leerJuris(dato?.sentencia || {}) };
    } catch (error) {
      return { ok: false, error: mensajeHumano(error) };
    }
  });
  ipcMain.handle("juris-guardar", (_e, dato) => responder(() => ({
    fuente: guardarJuris(base(), dato?.sentencia || {}, dato?.texto || ""),
  })));
}
