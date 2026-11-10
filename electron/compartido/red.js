// Red: proxy opcional para salir a internet. Puro y sin dependencias:
// lo usan el motor (src/rama.js), la ventana (validación del diálogo de
// ajustes) y las pruebas.
//
// El motor va como un spider educado: una petición a la vez, con pausa
// fija entre peticiones y reintentos con espera. Sin concurrencia ni
// ritmo adaptativo: lo simple es lo que no tumba ni a la Rama ni a la app.

export function normalizarProxyUrl(valor) {
  const crudo = String(valor ?? "").trim();
  if (!crudo) return "";
  let texto = crudo;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(texto)) texto = `http://${texto}`;
  let url = null;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url.toString();
}

// Valida lo del diálogo de ajustes: devuelve los valores listos para guardar.
export function validarRed({ proxy } = {}) {
  const proxyLimpio = normalizarProxyUrl(proxy);
  if (proxyLimpio == null) {
    return { ok: false, error: "Ese proxy no es válido. Use http://servidor:puerto (con usuario y clave si lo pide)." };
  }
  return { ok: true, valores: { proxy: proxyLimpio } };
}
