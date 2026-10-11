import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserWindow } from "electron";

export async function pdfDesdeHtml(html, parent = null) {
  const ventana = new BrowserWindow({
    show: false,
    parent: parent || undefined,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const archivo = path.join(os.tmpdir(), `vigencia-informe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
  try {
    fs.writeFileSync(archivo, html, "utf8");
    await ventana.loadFile(archivo);
    return await ventana.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      preferCSSPageSize: true,
    });
  } finally {
    fs.rmSync(archivo, { force: true });
    if (!ventana.isDestroyed()) ventana.destroy();
  }
}
