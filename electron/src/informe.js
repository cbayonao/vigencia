import { nombreCliente, texto } from "../compartido/logica.js";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function fechaInforme(dia) {
  const bruto = String(dia || "");
  if (bruto.length < 10 || bruto[4] !== "-" || bruto[7] !== "-") return bruto;
  const mes = Number(bruto.slice(5, 7));
  const numero = Number(bruto.slice(8, 10));
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return bruto;
  return `${numero} de ${MESES[mes - 1]} de ${bruto.slice(0, 4)}`;
}

export function nombreArchivoInforme(cliente, dia, usados = new Set()) {
  const limpio = (nombreCliente(cliente) || "Abogado")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Abogado";
  let nombre = `Informe ${dia} ${limpio}.pdf`;
  let n = 2;
  while (usados.has(nombre.toLocaleLowerCase("es"))) {
    nombre = `Informe ${dia} ${limpio} ${n}.pdf`;
    n += 1;
  }
  usados.add(nombre.toLocaleLowerCase("es"));
  return nombre;
}

function html(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fechaVisible(valor) {
  const bruto = texto(valor) || "";
  if (bruto.length < 10) return bruto || "Sin fecha";
  return fechaInforme(bruto.slice(0, 10));
}

function tituloProceso(proceso) {
  const dantes = texto(proceso.demandantes);
  const dados = texto(proceso.demandados);
  if (dantes || dados) return `${dantes || "Sin demandante"} contra ${dados || "Sin demandado"}`;
  return texto(proceso.despacho) || "Expediente";
}

function bloqueActuacion(acto) {
  const nota = texto(acto.anotacion);
  return `<article class="acto">
    <p class="cuando">${html(fechaVisible(acto.fecha))}</p>
    <p class="que">${html(texto(acto.actuacion) || "Sin descripción")}</p>
    ${nota ? `<p class="nota">${html(nota)}</p>` : ""}
  </article>`;
}

function bloqueProceso(proceso) {
  const linea = [texto(proceso.tipo), texto(proceso.clase)].filter(Boolean).join(" · ");
  const hoy = proceso.deHoy || [];
  let cuerpo = "";
  if (hoy.length) {
    cuerpo = `<h3>Actuaciones de hoy</h3>${hoy.map(bloqueActuacion).join("")}`;
  } else if (proceso.ultima) {
    cuerpo = `<h3>Última actuación</h3><p class="aviso">Hoy no hay actuación nueva.</p>${bloqueActuacion(proceso.ultima)}`;
  } else {
    cuerpo = `<p class="aviso">Este expediente no tiene actuaciones.</p>`;
  }
  return `<section class="expediente">
    <p class="kicker">${html(linea || "Expediente")}</p>
    <h2>${html(tituloProceso(proceso))}</h2>
    <p class="radicado">${html(proceso.radicado || "")}</p>
    <p class="despacho">${html(texto(proceso.despacho) || "Sin despacho")}</p>
    ${cuerpo}
  </section>`;
}

export function htmlInforme(informe, dia) {
  const cliente = informe.cliente || {};
  const procesos = informe.procesos || [];
  const contacto = [
    texto(cliente.cedula) ? `C.C. ${texto(cliente.cedula)}` : "",
    texto(cliente.tarjeta) ? `T.P. ${texto(cliente.tarjeta)}` : "",
    texto(cliente.telefonos),
    texto(cliente.email),
    texto(cliente.direccion),
  ].filter(Boolean).join(" · ");
  const cuenta = procesos.length === 1 ? "1 expediente" : `${procesos.length} expedientes`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Informe ${html(dia)} ${html(nombreCliente(cliente) || "Abogado")}</title>
  <style>
    @page { size: A4; margin: 16mm 14mm; }
    body { margin: 0; color: #1b2735; font-family: "Liberation Sans", "Segoe UI", sans-serif; font-size: 12px; line-height: 1.45; }
    h1, h2 { font-family: Palatino, Georgia, serif; font-weight: 600; }
    h1 { font-size: 26px; margin: 0; }
    h2 { font-size: 16px; margin: 4px 0; }
    h3 { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; margin: 12px 0 4px; }
    .marca { margin: 0; color: #17456e; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
    .fecha { margin: 2px 0 0; color: #5b6b7c; }
    .cliente { margin: 16px 0 0; font-size: 18px; }
    .contacto, .cuenta, .despacho, .aviso, .nota { color: #5b6b7c; }
    .contacto, .cuenta { margin: 2px 0 0; }
    .expediente { margin-top: 18px; padding-top: 12px; border-top: 1px solid #d3dce4; break-inside: avoid; }
    .kicker { margin: 0; color: #17456e; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .radicado { margin: 0; font-family: "Liberation Mono", ui-monospace, monospace; letter-spacing: 0.02em; }
    .despacho, .aviso, .nota, .cuando, .que { margin: 2px 0 0; }
    .cuando { color: #17456e; font-weight: 700; }
    .acto { margin-top: 8px; }
    .pie { margin-top: 22px; color: #5b6b7c; font-size: 11px; }
  </style>
</head>
<body>
  <p class="marca">Vigencia</p>
  <h1>Informe diario</h1>
  <p class="fecha">${html(fechaInforme(dia))}</p>
  <p class="cliente">${html(nombreCliente(cliente) || "Abogado")}</p>
  ${contacto ? `<p class="contacto">${html(contacto)}</p>` : ""}
  <p class="cuenta">${cuenta}</p>
  ${procesos.map(bloqueProceso).join("")}
  <p class="pie">Informe armado en este computador con las actuaciones ya guardadas.</p>
</body>
</html>`;
}
