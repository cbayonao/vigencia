// Cuenta citas de Documentos en una base local. No envía nada: solo imprime
// totales. Uso: node script/metricas-citas.mjs <base.sqlite>
import path from "node:path";
import { metricasDeCitas } from "../compartido/citas.js";
import { abrirBase, filas } from "../src/db.js";

const ruta = process.argv[2];
if (!ruta) {
  console.error("Uso: node script/metricas-citas.mjs <base.sqlite>");
  process.exit(1);
}

const db = abrirBase(path.resolve(ruta));
try {
  const versiones = filas(db, "SELECT id, cuerpo FROM doc_version").map((v) => ({
    cuerpo: v.cuerpo || "",
    citas: filas(db, "SELECT inicio, fin, texto_citado, pagina FROM doc_cita WHERE version_id = ?", [v.id]),
    pendientes: filas(db, "SELECT parrafo, afirmacion FROM doc_pendiente WHERE version_id = ?", [v.id]),
  }));
  const gastos = filas(db, "SELECT motivo, costo_usd AS costo FROM gasto_nube");
  const m = metricasDeCitas({ versiones, gastos });
  console.log(`Afirmaciones con cita: ${m.conCita}`);
  console.log(`Marcas sin fuente: ${m.sinFuente}`);
  console.log(`Hallazgos del revisor: ${m.hallazgos}`);
  console.log(`Costo del revisor (USD, según usage): ${m.costoRevisor}`);
  console.log(`Costo de nube en total (USD, según usage): ${m.costo}`);
} finally {
  db.close();
}
