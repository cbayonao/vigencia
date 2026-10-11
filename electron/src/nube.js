export const PROVEEDORES = {
  openai: {
    nombre: "OpenAI",
    formato: "openai",
    base: "https://api.openai.com/v1",
    modeloSugerido: "gpt-4o-mini",
    modelos: ["gpt-4o-mini", "gpt-4o", "o3-mini"],
  },
  xai: {
    nombre: "Grok (xAI)",
    formato: "openai",
    base: "https://api.x.ai/v1",
    modeloSugerido: "grok-3-mini",
    modelos: ["grok-3-mini", "grok-3"],
  },
  anthropic: {
    nombre: "Claude (Anthropic)",
    formato: "anthropic",
    base: "https://api.anthropic.com",
    modeloSugerido: "claude-sonnet-4-20250514",
    modelos: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-7-sonnet-20250219"],
  },
  meta: {
    nombre: "Meta (Muse Spark)",
    formato: "openai",
    base: "https://api.meta.ai/v1",
    modeloSugerido: "muse-spark-1.3",
    modelos: ["muse-spark-1.3", "muse-spark-1.1"],
  },
  custom: {
    nombre: "Otro (compatible OpenAI)",
    formato: "openai",
    base: "",
    modeloSugerido: "",
    modelos: [],
  },
};

function errorNube(codigo, cuerpo) {
  const detalle = String(cuerpo || "").slice(0, 200).trim();
  if (codigo === 401 || codigo === 403) {
    return new Error(detalle
      ? `La clave no fue aceptada. El proveedor dice: ${detalle}`
      : "La clave no fue aceptada. Revísela y guárdela de nuevo.");
  }
  if (codigo === 404) {
    return new Error("El modelo no existe en ese proveedor. Revise el nombre.");
  }
  if (codigo === 429) {
    return new Error("El proveedor pidió esperar. Intente en un momento.");
  }
  return new Error(detalle ? `El proveedor falló (código ${codigo}): ${detalle}` : `El proveedor falló (código ${codigo}).`);
}

async function leerSSE(respuesta, onEvento) {
  const lector = respuesta.body.getReader();
  const decodificador = new TextDecoder();
  let resto = "";
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    resto += decodificador.decode(value, { stream: true });
    const partes = resto.split("\n");
    resto = partes.pop() || "";
    let evento = "";
    for (const linea of partes) {
      const limpia = linea.trim();
      if (!limpia) {
        evento = "";
        continue;
      }
      if (limpia.startsWith("event:")) {
        evento = limpia.slice(6).trim();
        continue;
      }
      if (!limpia.startsWith("data:")) continue;
      const dato = limpia.slice(5).trim();
      if (dato === "[DONE]") return;
      try {
        onEvento(evento, JSON.parse(dato));
      } catch {
        /* trozo incompleto */
      }
      evento = "";
    }
  }
}

async function chatOpenAI({ base, key, modelo, texto, maxTokens = 1024, onToken, fetchFn = fetch }) {
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), 5 * 60 * 1000);
  try {
    const respuesta = await fetchFn(`${base.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: controlador.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelo,
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: true,
        messages: [{ role: "user", content: texto }],
      }),
    });
    if (!respuesta.ok) {
      throw errorNube(respuesta.status, await respuesta.text().catch(() => ""));
    }
    let salida = "";
    await leerSSE(respuesta, (_evento, dato) => {
      const trozo = dato?.choices?.[0]?.delta?.content || "";
      if (trozo) {
        salida += trozo;
        try {
          onToken?.(trozo);
        } catch {
          /* la ventana ya no escucha */
        }
      }
    });
    return salida;
  } finally {
    clearTimeout(reloj);
  }
}

async function chatAnthropic({ key, modelo, texto, maxTokens = 1024, onToken, fetchFn = fetch }) {
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), 5 * 60 * 1000);
  try {
    const respuesta = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controlador.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: maxTokens,
        temperature: 0.2,
        stream: true,
        messages: [{ role: "user", content: texto }],
      }),
    });
    if (!respuesta.ok) {
      throw errorNube(respuesta.status, await respuesta.text().catch(() => ""));
    }
    let salida = "";
    await leerSSE(respuesta, (evento, dato) => {
      if (evento !== "content_block_delta") return;
      const trozo = dato?.delta?.text || "";
      if (trozo) {
        salida += trozo;
        try {
          onToken?.(trozo);
        } catch {
          /* la ventana ya no escucha */
        }
      }
    });
    return salida;
  } finally {
    clearTimeout(reloj);
  }
}

function limpiar(valor) {
  return String(valor || "").trim().replace(/^["'](.+)["']$/, "$1").trim();
}

export async function chatNube({ proveedor, key, modelo, base, texto, maxTokens = 2048, onToken, fetchFn }) {
  const definicion = PROVEEDORES[proveedor];
  if (!definicion) throw new Error("Ese proveedor no está soportado.");
  key = limpiar(key);
  modelo = limpiar(modelo);
  base = limpiar(base);
  if (!key) throw new Error("Guarde su clave de ese proveedor primero.");
  if (!modelo) throw new Error("Escriba el nombre del modelo que quiere usar.");
  const destino = proveedor === "custom" ? (base || "").trim() : definicion.base;
  if (!destino && definicion.formato === "openai") {
    throw new Error("Escriba la dirección base del proveedor.");
  }
  if (definicion.formato === "anthropic") {
    return chatAnthropic({ key, modelo, texto, maxTokens, onToken, fetchFn });
  }
  return chatOpenAI({ base: destino, key, modelo, texto, maxTokens, onToken, fetchFn });
}
