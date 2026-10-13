import { nombreCliente, texto } from "../compartido/logica.js";

function xml(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function celda(valor) {
  return `<Cell><Data ss:Type="String">${xml(texto(valor) || "")}</Data></Cell>`;
}

function hoja(nombre, columnas, filas) {
  const cabeza = `<Row>${columnas.map(celda).join("")}</Row>`;
  const cuerpo = filas.map((fila) => `<Row>${fila.map(celda).join("")}</Row>`).join("");
  return `<Worksheet ss:Name="${xml(nombre)}"><Table>${cabeza}${cuerpo}</Table></Worksheet>`;
}

export function libroExcel({ procesos = [], actuaciones = [] }) {
  const expedientes = procesos.map((proceso) => [
    proceso.radicado,
    proceso.despacho,
    proceso.tipo_proceso,
    proceso.clase_proceso,
    proceso.demandantes,
    proceso.demandados,
    nombreCliente(proceso),
    proceso.ultima_actuacion,
    proceso.fecha_ultima_actuacion,
  ]);
  const delDia = actuaciones.map((act) => [
    act.radicado,
    act.despacho,
    act.fecha_actuacion,
    act.actuacion,
    act.anotacion,
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${hoja("Expedientes", ["Radicado", "Despacho", "Tipo", "Clase", "Demandantes", "Demandados", "Abogado", "Última actuación", "Fecha última actuación"], expedientes)}
${hoja("Del día", ["Radicado", "Despacho", "Fecha", "Actuación", "Anotación"], delDia)}
</Workbook>
`;
}
