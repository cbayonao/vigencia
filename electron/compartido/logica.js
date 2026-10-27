const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function texto(valor) {
  if (valor == null) return null;
  const limpio = String(valor).replaceAll("\u00a0", " ").split(/\s+/).filter(Boolean).join(" ");
  return limpio || null;
}

export function fecha(valor) {
  const limpio = texto(valor);
  return limpio ? limpio.slice(0, 10) : null;
}

export function ahora(fechaActual = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${fechaActual.getFullYear()}-${p(fechaActual.getMonth() + 1)}-${p(fechaActual.getDate())} ${p(fechaActual.getHours())}:${p(fechaActual.getMinutes())}:${p(fechaActual.getSeconds())}`;
}

export function pausaAleatoriaMs(azar = Math.random) {
  const n = Number(azar());
  const unidad = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  return 1000 + Math.round(unidad * 2000);
}

export function instanteLocal(marca) {
  const partes = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(marca || ""));
  if (!partes) return null;
  const fecha = new Date(
    Number(partes[1]),
    Number(partes[2]) - 1,
    Number(partes[3]),
    Number(partes[4]),
    Number(partes[5]),
    Number(partes[6]),
  );
  return Number.isNaN(fecha.getTime()) ? null : fecha.getTime();
}

export function decidirActualizar(ocupado) {
  if (ocupado) return { ok: false, error: "Ya hay una consulta en curso." };
  return { ok: true };
}

export function tipoClave(valor) {
  const marca = texto(valor) || "";
  const sin = marca.normalize("NFD").replace(/\p{Mn}/gu, "");
  return [...sin.toUpperCase()].filter((c) => /[0-9A-Z]/.test(c)).join("");
}

export function fechaCorta(valor) {
  const bruto = texto(valor) || "";
  if (bruto.length < 10 || bruto[4] !== "-" || bruto[7] !== "-") return bruto || "Sin fecha";
  const mes = Number(bruto.slice(5, 7));
  const dia = Number(bruto.slice(8, 10));
  if (!Number.isInteger(mes) || !Number.isInteger(dia) || mes < 1 || mes > 12) return bruto;
  return `${dia} ${MESES[mes - 1]} ${bruto.slice(0, 4)}`;
}

export function normalizarRadicado(valor) {
  return String(valor ?? "").replace(/\D/g, "").slice(0, 23);
}

export function nombreCliente(cliente) {
  if (!cliente) return "";
  const nombre = texto(cliente.nombre) || texto(cliente.cliente_nombre);
  const apellidos = texto(cliente.apellidos) || texto(cliente.cliente_apellidos);
  return [nombre, apellidos].filter(Boolean).join(" ");
}

export function etiquetaCliente(cliente, todos = []) {
  const base = nombreCliente(cliente);
  const choca = todos.filter((otro) => nombreCliente(otro) === base).length > 1;
  if (!choca) return base;
  if (texto(cliente.telefonos)) return `${base} · ${texto(cliente.telefonos)}`;
  if (texto(cliente.email)) return `${base} · ${texto(cliente.email)}`;
  return base;
}

export function tituloLista(proceso) {
  const dantes = nombres(proceso, "demandantes");
  const dados = nombres(proceso, "demandados");
  if (dantes.length || dados.length) {
    return `${dantes.join(", ") || "Sin demandante"} contra ${dados.join(", ") || "Sin demandado"}`;
  }
  if (proceso?.sin_expediente) return "No está en esta consulta";
  return texto(proceso?.despacho) || "Sin despacho";
}

export function nombres(proceso, rol) {
  return String(texto(proceso?.[rol]) || "").split(" · ").map((n) => n.trim()).filter(Boolean);
}

export function coincide(proceso, consulta) {
  const bolsa = [
    "radicado",
    "despacho",
    "demandantes",
    "demandados",
    "ultima_actuacion",
    "ubicacion",
    "tipo_proceso",
    "clase_proceso",
    "cliente_nombre",
    "cliente_apellidos",
    "representado",
  ].map((campo) => texto(proceso?.[campo]) || "").join(" ");
  const todo = `${bolsa} ${tipoClave(proceso?.tipo_proceso)}`.toLowerCase();
  return consulta.split(/\s+/).filter(Boolean).every((parte) => todo.includes(parte));
}

export function tramosDeActuaciones(filas) {
  const tramos = [];
  for (const act of filas || []) {
    const clave = texto(act?.fecha_actuacion) || "";
    const ultimo = tramos.at(-1);
    if (ultimo && ultimo.clave === clave) ultimo.actos.push(act);
    else tramos.push({ clave, actos: [act] });
  }
  return tramos;
}

export function visibles(procesos, consulta, tipo, despacho, cliente = "") {
  const busqueda = String(consulta || "").trim().toLowerCase();
  const lista = [];
  for (const proceso of procesos) {
    if (tipo && tipoClave(proceso?.tipo_proceso) !== tipo) continue;
    if (despacho && (texto(proceso?.despacho) || "") !== despacho) continue;
    if (cliente === "sin") {
      if (proceso?.cliente_id) continue;
    } else if (cliente && String(proceso?.cliente_id ?? "") !== String(cliente)) {
      continue;
    }
    if (busqueda) {
      if (coincide(proceso, busqueda)) lista.push(proceso);
      continue;
    }
    if (!proceso?.sin_expediente) lista.push(proceso);
  }
  const porRadicado = [...lista].sort((a, b) => (texto(a.radicado) || "").localeCompare(texto(b.radicado) || ""));
  return porRadicado.sort((a, b) => (texto(b.fecha_ultima_actuacion) || "").localeCompare(texto(a.fecha_ultima_actuacion) || ""));
}

export function lineaDeCarga(linea) {
  let limpia = texto(linea) || "";
  limpia = limpia.replace(/idProceso=\[[^\]]*\]/g, "");
  limpia = limpia.replace(/idProceso=\d+/g, "");
  limpia = limpia.replace(/\[detalle (\d+\/\d+)\] \d+/g, "[detalle $1]");
  limpia = limpia.replace(/[ \t]{2,}/g, " ");
  return limpia.trim();
}

export function lineasDeCorrida(dato) {
  return (dato?.lineas || []).map(lineaDeCarga).filter(Boolean);
}

export function causaDePeticion(mensaje) {
  const bruto = String(mensaje || "");
  if (bruto.includes("403")) return "La Rama bloqueó la petición.";
  if (bruto.includes("404")) return "La Rama no tiene actuaciones de este expediente.";
  if (bruto.includes("429")) return "La Rama pidió esperar.";
  if (/HTTP 5\d\d/.test(bruto)) return "La Rama no respondió.";
  if (/timeout|timed out|abort/i.test(bruto)) return "La petición se demoró demasiado.";
  if (bruto.includes("no es JSON") || bruto.includes("no es un objeto")) return "La Rama contestó algo que no se pudo leer.";
  if (bruto.includes("incompletas")) return "Las actuaciones llegaron incompletas.";
  return "La petición falló.";
}

export function causaDelFallo(lineas, codigo) {
  let culpa = "";
  for (let i = lineas.length - 1; i >= 0; i -= 1) {
    const limpia = String(lineas[i] || "").trim();
    if (!limpia || limpia.startsWith("File ") || limpia.startsWith("Traceback") || limpia.startsWith("During handling") || limpia.startsWith("The above exception")) {
      continue;
    }
    culpa = limpia;
    break;
  }
  if (!culpa) culpa = "No dejó ningún mensaje.";
  return `Código ${codigo}. ${culpa}`;
}

export function ordenEs(a, b) {
  return String(a).localeCompare(String(b), "es", { sensitivity: "base" });
}
