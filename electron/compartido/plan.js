// Plan y prueba: predicados puros, sin dependencias de Node, para usar
// desde el renderer y desde main. La verificación criptográfica vive en
// compartido/licencia.js (solo main: usa node:crypto y NO se importa
// desde la ventana, porque el navegador no resuelve node:* y tumba el
// arranque completo en silencio).
export const DIAS_PRUEBA = 20;

// La aplicación abre con plan pago o en prueba; solo se cierra sin pago.
export function planAbierto(estado) {
  return estado === "vigente" || estado === "prueba";
}
