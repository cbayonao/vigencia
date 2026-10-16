// Leer una fuente de la biblioteca desde un archivo: .txt, .md, .docx o .pdf.
import fs from "node:fs";
import path from "node:path";
import { textoDeDocx } from "./docx.js";
import { textoDePdf } from "./pdftexto.js";

export function leerArchivoFuente(ruta) {
  const extension = path.extname(ruta).toLowerCase();
  if (![".txt", ".md", ".docx", ".pdf"].includes(extension)) return { ok: false, error: "Use un archivo .txt, .docx o .pdf." };
  const datos = fs.readFileSync(ruta);
  const nombre = path.basename(ruta, extension);
  if (extension === ".txt" || extension === ".md") return { ok: true, nombre, texto: datos.toString("utf8").replace(/^\uFEFF/, "") };
  if (extension === ".docx") {
    const leido = textoDeDocx(datos);
    return leido.ok ? { ok: true, nombre, texto: leido.texto } : { ok: false, error: leido.error };
  }
  if (extension === ".pdf") {
    const leido = textoDePdf(datos);
    return leido.ok ? { ok: true, nombre, texto: leido.texto } : { ok: false, error: leido.error };
  }
  return { ok: false, error: "Use un archivo .txt, .docx o .pdf." };
}
