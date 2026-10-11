import {
  ESPERA_AL_ARRANCAR_MS,
  REINTENTO_OCUPADO_MS,
  REVISAR_CADA_MS,
  decidirAutomatica,
} from "../compartido/horario.js";

const MINIMO_MS = 1000;

export function crearProgramador({
  leerEstado,
  correr,
  alPlanear = () => {},
  log = () => {},
  reloj = () => new Date(),
  poner = setTimeout,
  quitar = clearTimeout,
}) {
  let temporizador = null;
  let detenido = true;
  let evaluando = false;

  function planear(ms) {
    if (temporizador) quitar(temporizador);
    temporizador = null;
    if (detenido) return;
    const espera = Math.min(Math.max(Number(ms) || 0, MINIMO_MS), REVISAR_CADA_MS);
    temporizador = poner(evaluar, espera);
    temporizador?.unref?.();
  }

  function evaluar() {
    if (detenido || evaluando) return null;
    evaluando = true;
    try {
      const estado = leerEstado();
      const decision = decidirAutomatica({ ...estado, fecha: reloj() });
      if (decision.accion === "correr") {
        let lanzado = false;
        try {
          lanzado = Boolean(correr(decision.turno));
        } catch (error) {
          log(`revisión automática: no pude empezar (${error?.message || error})`);
        }
        if (!lanzado) {
          decision.accion = "posponer";
          decision.motivo = decision.motivo || "No se pudo empezar la revisión.";
          decision.en = REINTENTO_OCUPADO_MS;
        }
      } else if (decision.accion === "posponer") {
        log(`revisión automática del turno ${decision.turno} pospuesta: ${decision.motivo}`);
      }
      planear(decision.accion === "correr" ? REVISAR_CADA_MS : decision.en);
      try {
        alPlanear(decision);
      } catch {
        /* la ventana puede no estar lista */
      }
      return decision;
    } catch (error) {
      log(`revisión automática: error al programar (${error?.message || error})`);
      planear(REINTENTO_OCUPADO_MS);
      return null;
    } finally {
      evaluando = false;
    }
  }

  return {
    iniciar(demora = ESPERA_AL_ARRANCAR_MS) {
      detenido = false;
      planear(demora);
    },
    reprogramar(demora = MINIMO_MS) {
      if (detenido) return;
      planear(demora);
    },
    evaluar,
    detener() {
      detenido = true;
      if (temporizador) quitar(temporizador);
      temporizador = null;
    },
    get activo() {
      return !detenido;
    },
  };
}
