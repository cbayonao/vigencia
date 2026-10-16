// Proceso aparte (utilityProcess de Electron) que convierte a Markdown sin
// congelar la ventana. Recibe { tipo: "convertir", id, ruta, nombre,
// datosDir, opciones } y { tipo: "cancelar", id }; responde progreso,
// listo o error. No abre conexiones de red.
import { convertirRuta } from "./convertidores.js";

const puerto = process.parentPort;
const senales = new Map();

function enviar(m) {
  try {
    puerto.postMessage(m);
  } catch {
    /* el proceso principal ya no escucha */
  }
}

puerto.on("message", async (evento) => {
  const m = evento?.data || {};
  if (m.tipo === "cancelar") {
    const s = senales.get(m.id);
    if (s) s.cancelado = true;
    return;
  }
  if (m.tipo !== "convertir") return;
  const senal = { cancelado: false };
  senales.set(m.id, senal);
  const inicio = Date.now();
  try {
    const r = await convertirRuta(m.ruta, {
      ...(m.opciones || {}),
      datosDir: m.datosDir,
      senal,
      onProgreso: (p) => enviar({ tipo: "progreso", id: m.id, ...p }),
    });
    enviar({ tipo: "listo", id: m.id, resultado: { ...r, duracionMs: Date.now() - inicio } });
  } catch (error) {
    enviar({ tipo: "error", id: m.id, codigo: error?.codigo || "", mensaje: error?.message || "No pude convertir ese archivo." });
  } finally {
    senales.delete(m.id);
  }
});
