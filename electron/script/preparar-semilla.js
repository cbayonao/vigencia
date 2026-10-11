import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const repo = path.resolve(import.meta.dirname, "..", "..");
const origen = path.join(repo, "grokvig.sqlite");
const destino = path.resolve(import.meta.dirname, "..", "semilla", "grokvig.sqlite");

if (!fs.existsSync(origen)) {
  console.error("No está grokvig.sqlite. No armo la semilla.");
  process.exit(1);
}

const db = new DatabaseSync(origen);
db.exec("PRAGMA busy_timeout = 30000");
db.exec("PRAGMA wal_checkpoint(PASSIVE)");
const cuenta = db.prepare("SELECT COUNT(*) AS n FROM proceso").get();
const expedientes = Number(cuenta.n);
if (!expedientes) {
  db.close();
  console.error("La base no tiene expedientes. No armo la semilla.");
  process.exit(1);
}
const buf = db.serialize();
db.close();
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, Buffer.from(buf));
console.log(`Semilla lista: ${expedientes} expedientes, ${buf.length} bytes. No reemplaza una base que el usuario ya tenga.`);
