// Avisos flotantes: confirman lo que pasó sin importar en qué pantalla se
// está (guardado, copiado, enviado, errores). Se suman al mensaje en sitio,
// no lo reemplazan.
let caja = null;

function asegurar() {
  if (caja || typeof document === "undefined") return caja;
  caja = document.createElement("div");
  caja.id = "avisos";
  caja.setAttribute("aria-live", "polite");
  document.body.append(caja);
  return caja;
}

export function avisar(texto, tipo = "ok") {
  const contenedor = asegurar();
  if (!contenedor) return;
  const el = document.createElement("p");
  el.className = `aviso-aviso aviso-${tipo === "error" ? "error" : "ok"}`;
  el.textContent = String(texto || "");
  contenedor.append(el);
  while (contenedor.children.length > 3) contenedor.firstChild.remove();
  window.setTimeout(() => {
    el.classList.add("fuera");
    window.setTimeout(() => el.remove(), 350);
  }, 3600);
}
