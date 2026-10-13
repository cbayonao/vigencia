import { ahora, instanteLocal } from "./logica.js";

export const HORARIOS_PREDETERMINADOS = Object.freeze(["07:00", "13:00"]);
export const MAXIMO_HORARIOS = 2;
export const SEPARACION_MINIMA_MIN = 60;
export const ESPERA_AL_ARRANCAR_MS = 60 * 1000;
export const REINTENTO_OCUPADO_MS = 5 * 60 * 1000;
export const REVISAR_CADA_MS = 15 * 60 * 1000;

const FORMATO = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DIA_MIN = 24 * 60;

export function minutosDe(hora) {
  if (typeof hora !== "string") return null;
  const partes = FORMATO.exec(hora.trim());
  return partes ? Number(partes[1]) * 60 + Number(partes[2]) : null;
}

function formatear(minutos) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(minutos / 60))}:${p(minutos % 60)}`;
}

export function validarHorarios(entrada) {
  if (!Array.isArray(entrada)) return { ok: false, error: "Las horas no son válidas." };
  const limpias = entrada
    .map((hora) => (typeof hora === "string" ? hora.trim() : hora))
    .filter((hora) => hora !== "" && hora != null);
  if (!limpias.length) return { ok: false, error: "Elige al menos una hora." };
  if (limpias.length > MAXIMO_HORARIOS) return { ok: false, error: "Máximo dos horas al día." };
  const minutos = [];
  for (const hora of limpias) {
    const valor = minutosDe(hora);
    if (valor == null) return { ok: false, error: `«${String(hora)}» no es una hora válida. Usa HH:MM, de 00:00 a 23:59.` };
    minutos.push(valor);
  }
  if (minutos.length === 2) {
    if (minutos[0] === minutos[1]) return { ok: false, error: "Las dos horas son iguales. Elige horas distintas o deja una sola." };
    const diferencia = Math.abs(minutos[0] - minutos[1]);
    if (Math.min(diferencia, DIA_MIN - diferencia) < SEPARACION_MINIMA_MIN) {
      return { ok: false, error: "Entre las dos horas debe haber al menos una hora." };
    }
  }
  return { ok: true, horas: minutos.sort((a, b) => a - b).map(formatear) };
}

export function horariosOPredeterminados(entrada) {
  const validos = validarHorarios(entrada);
  return validos.ok ? validos.horas : [...HORARIOS_PREDETERMINADOS];
}

function enDia(base, minutos, dias = 0) {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dias, Math.floor(minutos / 60), minutos % 60, 0, 0);
}

function minutosOrdenados(horas) {
  return horariosOPredeterminados(horas).map(minutosDe);
}

export function turnoAnterior(horas, fecha = new Date()) {
  const lista = minutosOrdenados(horas);
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    const turno = enDia(fecha, lista[i]);
    if (turno.getTime() <= fecha.getTime()) return turno;
  }
  return enDia(fecha, lista.at(-1), -1);
}

export function proximoTurno(horas, fecha = new Date()) {
  const lista = minutosOrdenados(horas);
  for (const minutos of lista) {
    const turno = enDia(fecha, minutos);
    if (turno.getTime() > fecha.getTime()) return turno;
  }
  return enDia(fecha, lista[0], 1);
}

export function claveTurno(fecha) {
  return ahora(fecha);
}

export function turnoCubierto(horas, ultimoTurno, fecha = new Date()) {
  const clave = claveTurno(turnoAnterior(horas, fecha));
  return !ultimoTurno || clave > ultimoTurno ? clave : ultimoTurno;
}

export function decidirAutomatica({ horas, ultimoTurno = null, pausaHasta = null, ocupado = false, fecha = new Date() }) {
  const clave = claveTurno(turnoAnterior(horas, fecha));
  const siguiente = proximoTurno(horas, fecha);
  const proximo = claveTurno(siguiente);
  if (ultimoTurno && clave <= ultimoTurno) {
    return { accion: "esperar", turno: null, en: siguiente.getTime() - fecha.getTime(), proximo };
  }
  if (ocupado) {
    return { accion: "posponer", turno: clave, en: REINTENTO_OCUPADO_MS, motivo: "Ya hay una consulta en curso.", proximo };
  }
  const fin = instanteLocal(pausaHasta);
  if (fin != null && fin > fecha.getTime()) {
    return {
      accion: "posponer",
      turno: clave,
      en: fin - fecha.getTime() + 1000,
      motivo: `Actualizar todo está en pausa hasta las ${String(pausaHasta).slice(11, 16)}.`,
      proximo,
    };
  }
  return { accion: "correr", turno: clave, en: 0, proximo };
}

const ETIQUETAS = {
  actuacion_nueva: ["actuación nueva", "actuaciones nuevas"],
  actuacion_actualizada: ["actuación modificada", "actuaciones modificadas"],
  actuacion_retirada: ["actuación retirada", "actuaciones retiradas"],
  sujeto_nuevo: ["sujeto nuevo", "sujetos nuevos"],
  sujeto_actualizado: ["sujeto modificado", "sujetos modificados"],
  sujeto_retirado: ["sujeto retirado", "sujetos retirados"],
  documento_nuevo: ["documento nuevo", "documentos nuevos"],
  documento_actualizado: ["documento modificado", "documentos modificados"],
  documento_retirado: ["documento retirado", "documentos retirados"],
};

function nombreDe(fila) {
  return [fila?.cliente_nombre, fila?.cliente_apellidos]
    .map((parte) => String(parte ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function resumenCambios(avisos, maximoLineas = 4) {
  const porProceso = new Map();
  for (const aviso of avisos || []) {
    const clave = aviso?.id_proceso ?? aviso?.radicado;
    if (clave == null) continue;
    if (!porProceso.has(clave)) {
      porProceso.set(clave, {
        id_proceso: aviso.id_proceso ?? null,
        radicado: aviso.radicado || "",
        cliente: nombreDe(aviso) || "Sin abogado",
        total: 0,
        tipos: new Map(),
      });
    }
    const item = porProceso.get(clave);
    item.total += 1;
    item.tipos.set(aviso.tipo, (item.tipos.get(aviso.tipo) || 0) + 1);
  }
  if (!porProceso.size) return null;
  const procesos = [...porProceso.values()].map((item) => {
    const partes = [...item.tipos].map(([tipo, cantidad]) => {
      const [uno, varios] = ETIQUETAS[tipo] || ["cambio", "cambios"];
      return `${cantidad} ${cantidad === 1 ? uno : varios}`;
    });
    return { id_proceso: item.id_proceso, radicado: item.radicado, cliente: item.cliente, total: item.total, detalle: partes.join(", ") };
  });
  const n = procesos.length;
  const lineas = procesos.slice(0, maximoLineas).map((p) => `${p.radicado} · ${p.cliente}: ${p.detalle}`);
  if (n > maximoLineas) lineas.push(`y ${n - maximoLineas} expediente${n - maximoLineas === 1 ? "" : "s"} más`);
  return {
    titulo: n === 1 ? "1 expediente con cambios" : `${n} expedientes con cambios`,
    cuerpo: lineas.join("\n"),
    procesos,
    ids: procesos.map((p) => p.id_proceso).filter((id) => id != null),
    total: procesos.reduce((suma, p) => suma + p.total, 0),
  };
}
