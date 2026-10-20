import { bloquesConCache } from "../compartido/encargo.js";

export const PROVEEDORES = {
  openai: {
    nombre: "OpenAI",
    formato: "openai",
    base: "https://api.openai.com/v1",
    modeloSugerido: "gpt-6.1-sol",
    modelos: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"],
    claveAyuda: "Empieza por sk-.",
    clavePrefijos: ["sk-"],
  },
  xai: {
    nombre: "Grok (xAI)",
    formato: "openai",
    base: "https://api.x.ai/v1",
    modeloSugerido: "grok-4.7",
    modelos: ["grok-4.7", "grok-4.6", "grok-4.5"],
    claveAyuda: "Empieza por xai-.",
    clavePrefijos: ["xai-"],
  },
  anthropic: {
    nombre: "Claude (Anthropic)",
    formato: "anthropic",
    base: "https://api.anthropic.com",
    modeloSugerido: "claude-sonnet-5-5",
    modelos: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
    claveAyuda: "Empieza por sk-ant-.",
    clavePrefijos: ["sk-ant-"],
  },
  meta: {
    nombre: "Meta (Muse Spark)",
    formato: "openai",
    base: "https://api.meta.ai/v1",
    modeloSugerido: "muse-spark-1.3",
    modelos: ["muse-spark-1.3", "muse-spark-1.1"],
    claveAyuda: "Empieza por LLM: la larga con barras o la corta.",
    clavePrefijos: ["LLM|", "LLM_"],
  },
  custom: {
    nombre: "Otro (compatible OpenAI)",
    formato: "openai",
    base: "",
    modeloSugerido: "",
    modelos: [],
    claveAyuda: "",
    clavePrefijos: [],
  },
};

// ¿La clave tiene la forma esperada? Solo orienta, nunca bloquea: la que
// manda es la respuesta del proveedor al probar.
export function formaClaveValida(proveedor, key) {
  const prefijos = PROVEEDORES[proveedor]?.clavePrefijos || [];
  if (!prefijos.length) return true;
  const limpia = String(key || "").trim();
  if (!limpia) return true;
  return prefijos.some((p) => limpia.startsWith(p));
}

function detalleCuerpo(cuerpo) {
  const texto = String(cuerpo || "").trim();
  try {
    const dato = JSON.parse(texto);
    const error = dato?.error;
    const mensaje = (error && typeof error === "object" ? error.message || error.error : error) || dato?.message;
    if (mensaje) return String(mensaje).trim().slice(0, 200);
  } catch {
    /* el proveedor respondió texto plano */
  }
  return texto.slice(0, 200);
}

function errorNube(codigo, cuerpo) {
  const detalle = detalleCuerpo(cuerpo);
  const claveRechazada = codigo === 401 || codigo === 403
    || /api[_ ]?key|unauthorized|authentication|incorrect api key/i.test(detalle);
  if (claveRechazada) {
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

async function chatOpenAI({ base, key, modelo, texto, maxTokens = 1024, onToken, fetchFn = fetch, instrucciones = "", esfuerzo = "", sinTemperatura = false, onUso = null }) {
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), 5 * 60 * 1000);
  try {
    const mensajes = instrucciones
      ? [{ role: "developer", content: instrucciones }, { role: "user", content: texto }]
      : [{ role: "user", content: texto }];
    const cuerpo = {
      model: modelo,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      messages: mensajes,
    };
    if (!sinTemperatura) cuerpo.temperature = 0.2;
    if (esfuerzo) cuerpo.reasoning_effort = esfuerzo;
    const respuesta = await fetchFn(`${base.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: controlador.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(cuerpo),
    });
    if (!respuesta.ok) {
      throw errorNube(respuesta.status, await respuesta.text().catch(() => ""));
    }
    let salida = "";
    await leerSSE(respuesta, (_evento, dato) => {
      const uso = dato?.usage;
      if (uso && (uso.prompt_tokens != null || uso.completion_tokens != null)) {
        try {
          onUso?.({ entrada: Number(uso.prompt_tokens) || 0, salida: Number(uso.completion_tokens) || 0 });
        } catch {
          /* medir no tumba la redacción */
        }
      }
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
  } catch (error) {
    throw errorDeConexion(error);
  } finally {
    clearTimeout(reloj);
  }
}

function errorDeConexion(error) {
  if (AVISO_PRUEBA.test(String(error?.message || ""))) throw error;
  if (error?.name === "AbortError") throw new Error("El proveedor no respondió a tiempo.");
  throw new Error("No pude conectar con el proveedor. Revise la conexión.");
}

const ESFUERZOS = new Set(["low", "medium", "high", "xhigh", "max"]);

// Si las partes no reconstruyen el texto revisado, se manda el texto tal cual.
function contenidoAnthropic(texto, partes) {
  const bloques = bloquesConCache(partes);
  if (!bloques.some((bloque) => bloque.cache_control)) return texto;
  if (bloques.map((bloque) => bloque.text).join("") !== String(texto ?? "")) return texto;
  return bloques;
}

async function chatAnthropic({ key, modelo, texto, maxTokens = 1024, onToken, fetchFn = fetch, instrucciones = "", esfuerzo = "", partes = null, onUso = null }) {
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), 5 * 60 * 1000);
  try {
    // Claude 5.5 rechaza temperature, top_p y top_k con un 400. No se envían.
    const cuerpo = {
      model: modelo,
      max_tokens: maxTokens,
      stream: true,
      messages: [{ role: "user", content: contenidoAnthropic(texto, partes) }],
    };
    const sistema = String(instrucciones || "").trim();
    if (sistema) cuerpo.system = sistema;
    if (ESFUERZOS.has(esfuerzo)) cuerpo.output_config = { effort: esfuerzo };
    const respuesta = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controlador.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(cuerpo),
    });
    if (!respuesta.ok) {
      throw errorNube(respuesta.status, await respuesta.text().catch(() => ""));
    }
    let salida = "";
    const uso = { entrada: 0, salida: 0, cacheCreacion: null, cache5m: null, cache1h: null, cacheLectura: null };
    await leerSSE(respuesta, (evento, dato) => {
      if (evento === "message_start" || evento === "message_delta") {
        anotarUsoAnthropic(dato?.message?.usage, uso);
        anotarUsoAnthropic(dato?.usage, uso);
      }
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
    const medido = usoMedido(uso);
    if (medido.entrada > 0 || medido.salida > 0 || medido.cacheEscritura5m > 0 || medido.cacheEscritura1h > 0 || medido.cacheLectura > 0) {
      try {
        onUso?.(medido);
      } catch {
        /* medir no tumba la redacción */
      }
    }
    return salida;
  } catch (error) {
    throw errorDeConexion(error);
  } finally {
    clearTimeout(reloj);
  }
}

function numeroUso(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function anotarUsoAnthropic(uso, destino) {
  if (!uso || typeof uso !== "object") return;
  if (uso.input_tokens != null) destino.entrada = numeroUso(uso.input_tokens);
  if (uso.output_tokens != null) destino.salida = numeroUso(uso.output_tokens);
  if (uso.cache_creation_input_tokens != null) destino.cacheCreacion = numeroUso(uso.cache_creation_input_tokens);
  if (uso.cache_read_input_tokens != null) destino.cacheLectura = numeroUso(uso.cache_read_input_tokens);
  const creacion = uso.cache_creation;
  if (creacion && typeof creacion === "object") {
    if (creacion.ephemeral_5m_input_tokens != null) destino.cache5m = numeroUso(creacion.ephemeral_5m_input_tokens);
    if (creacion.ephemeral_1h_input_tokens != null) destino.cache1h = numeroUso(creacion.ephemeral_1h_input_tokens);
  }
}

function usoMedido(uso) {
  const hayDesglose = uso.cache5m != null || uso.cache1h != null;
  return {
    entrada: uso.entrada || 0,
    salida: uso.salida || 0,
    cacheEscritura5m: hayDesglose ? (uso.cache5m || 0) : (uso.cacheCreacion || 0),
    cacheEscritura1h: hayDesglose ? (uso.cache1h || 0) : 0,
    cacheLectura: uso.cacheLectura || 0,
  };
}

function limpiar(valor) {
  return String(valor || "").trim().replace(/^["'](.+)["']$/, "$1").trim();
}

// USD por millón de tokens: [entrada, salida] y, si va, la fracción de la
// entrada que cobra una lectura de caché. Sonnet 5.5 y Opus 5.5 leen al
// 0,05; el resto, al 0,1. La escritura es 1,25 (5 min) o 2 (1 h) por la entrada.
export const PRECIOS = {
  "muse-spark-1.3": [1.25, 4.25],
  "muse-spark-1.2": [1.25, 4.25],
  "muse-spark-1.1": [1.25, 4.25],
  "muse-spark-1.3-contributor": [0.1, 0.2],
  "muse-spark-1.2-contributor": [0.1, 0.2],
  "gpt-6.1-sol": [2, 10],
  "gpt-6-astra": [10, 50],
  "gpt-6-luna": [0.1, 0.5],
  "grok-4.7": [2, 6],
  "grok-4.6": [2, 6],
  "grok-4.5": [2, 6],
  "claude-sonnet-5-5": [2, 10, 0.05],
  "claude-opus-5-5": [4, 20, 0.05],
  "claude-haiku-5-5": [0.1, 0.5, 0.1],
};

// Haiku 5.5 cobra más cuando el pedido pasa de 100.000 tokens de entrada,
// contando lecturas y escrituras de caché. El tramo alto reemplaza entrada y salida.
const TRAMO_LARGO = {
  "claude-haiku-5-5": { desde: 100000, entrada: 0.5, salida: 2.5 },
};

// Ventana de contexto en tokens, por modelo. De la doc oficial de cada uno;
// si un modelo no está, el medidor muestra guiones en vez de inventar.
export const CONTEXTO = {
  "muse-spark-1.3": 1048576,
  "muse-spark-1.2": 1048576,
  "muse-spark-1.1": 1048576,
  "muse-spark-1.3-contributor": 1048576,
  "muse-spark-1.2-contributor": 1048576,
  "gpt-6.1-sol": 1050000,
  "gpt-6-astra": 1050000,
  "gpt-6-luna": 1050000,
  "grok-4.7": 500000,
  "grok-4.6": 500000,
  "grok-4.5": 500000,
  "claude-sonnet-5-5": 1000000,
  "claude-opus-5-5": 1000000,
  "claude-haiku-5-5": 1000000,
};

export function contextoDe(modelo) {
  const n = CONTEXTO[String(modelo || "").trim()];
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function costoAprox(modelo, entrada, salida, extra = {}) {
  const id = String(modelo || "").trim();
  const precios = PRECIOS[id];
  if (!precios) return null;
  const baseEntrada = Number(entrada) || 0;
  const baseSalida = Number(salida) || 0;
  const escritura5m = Number(extra.cacheEscritura5m) || 0;
  const escritura1h = Number(extra.cacheEscritura1h) || 0;
  const lectura = Number(extra.cacheLectura) || 0;
  const totalEntrada = baseEntrada + escritura5m + escritura1h + lectura;
  let precioEntrada = precios[0];
  let precioSalida = precios[1];
  const tramo = TRAMO_LARGO[id];
  if (tramo && totalEntrada > tramo.desde) {
    precioEntrada = tramo.entrada;
    precioSalida = tramo.salida;
  }
  const fraccionLectura = precios[2] == null ? 0.1 : precios[2];
  const usd = (
    baseEntrada * precioEntrada
    + escritura5m * precioEntrada * 1.25
    + escritura1h * precioEntrada * 2
    + lectura * precioEntrada * fraccionLectura
    + baseSalida * precioSalida
  ) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
// Esto solo orienta cuando lo pegado no parece ninguna de las dos.
export function avisoClaveMeta(key) {
  const limpia = limpiar(key);
  if (/^LLM\|[^|\s]+\|[^|\s]+$/.test(limpia)) return "";
  if (/^LLM_[A-Za-z0-9_-]+$/.test(limpia)) return "";
  return "La clave de Meta empieza por LLM. La larga tiene la forma LLM|…|… con dos barras y la corta LLM_…; cópiela completa al crearla, sin espacios ni comillas.";
}

const AVISO_PRUEBA = /clave no fue aceptada|modelo no existe|proveedor pidió esperar|proveedor falló|conectar con el proveedor|no respondió a tiempo|Guarde su clave|Escriba |no está soportado/;

export function mensajePrueba(error) {
  const texto = String(error?.message || "");
  return AVISO_PRUEBA.test(texto) ? texto : "";
}

export async function chatNube({ proveedor, key, modelo, base, texto, maxTokens = 2048, onToken, fetchFn, instrucciones = "", esfuerzo = "", partes = null, onUso = null }) {
  const definicion = PROVEEDORES[proveedor];
  if (!definicion) throw new Error("Ese proveedor no está soportado.");
  key = limpiar(key);
  // Las claves nunca traen espacios: si se coló alguno al copiar (o un
  // "Bearer " de más), se quita en vez de fallar la conexión. El Bearer
  // se quita primero: si no, se vuelve parte de la clave (BearerLLM|…).
  if (proveedor === "meta") key = key.replace(/^bearer\s+/i, "");
  key = key.replace(/\s+/g, "");
  modelo = limpiar(modelo);
  base = limpiar(base);
  if (!key) throw new Error("Guarde su clave de ese proveedor primero.");
  if (!modelo) throw new Error("Escriba el nombre del modelo que quiere usar.");
  const destino = proveedor === "custom" ? (base || "").trim() : definicion.base;
  if (!destino && definicion.formato === "openai") {
    throw new Error("Escriba la dirección base del proveedor.");
  }
  if (definicion.formato === "anthropic") {
    return chatAnthropic({ key, modelo, texto, maxTokens, onToken, fetchFn, onUso, instrucciones, esfuerzo, partes });
  }
  // Meta rinde con sus valores de fábrica: sin temperature y con esfuerzo medio.
  const esMeta = proveedor === "meta";
  return chatOpenAI({
    base: destino,
    key,
    modelo,
    texto,
    maxTokens,
    onToken,
    fetchFn,
    onUso,
    instrucciones: esMeta ? instrucciones : "",
    esfuerzo: esMeta ? (esfuerzo || "medium") : "",
    sinTemperatura: esMeta,
  });
}
