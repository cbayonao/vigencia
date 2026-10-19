// Visor de páginas PDF en la ventana: pdfjs corre aquí (Chromium con
// canvas), los bytes llegan por IPC. Se empaqueta con `npm run visor` a
// renderer/vendor/visor.js (ese archivo va en el repo y en el asar).
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", import.meta.url).toString();

export async function cargarPdf(datos) {
  const tarea = getDocument({ data: datos, isEvalSupported: false, useSystemFonts: true });
  const doc = await tarea.promise;
  return { doc, paginas: doc.numPages };
}

export async function pintarPagina(doc, numero, canvas, escala = 1.5) {
  const pagina = await doc.getPage(numero);
  try {
    const vista = pagina.getViewport({ scale: escala });
    canvas.width = Math.floor(vista.width);
    canvas.height = Math.floor(vista.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pagina.render({ canvasContext: ctx, viewport: vista }).promise;
    return { ancho: vista.width, alto: vista.height };
  } finally {
    pagina.cleanup();
  }
}

export async function cerrarPdf(doc) {
  try {
    await doc?.destroy();
  } catch {
    /* ya cerrado */
  }
}
