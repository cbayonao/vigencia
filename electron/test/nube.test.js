import test from "node:test";
import assert from "node:assert/strict";
import { PROVEEDORES, avisoClaveMeta, chatNube, mensajePrueba } from "../src/nube.js";

function respuestaSSE(trozos) {
  const codificado = trozos.map((trozo) => new TextEncoder().encode(trozo));
  return {
    ok: true,
    body: {
      getReader() {
        let i = 0;
        return {
          async read() {
            if (i >= codificado.length) return { done: true, value: undefined };
            const value = codificado[i];
            i += 1;
            return { done: false, value };
          },
        };
      },
    },
  };
}

test("el chat OpenAI junta los fragmentos del stream", async () => {
  const fetchFn = async () => respuestaSSE([
    'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" mundo"}}]}\n\ndata: [DONE]\n\n',
  ]);
  const vistos = [];
  const texto = await chatNube({
    proveedor: "openai",
    key: "k",
    modelo: "gpt-4o-mini",
    texto: "hola",
    onToken: (trozo) => vistos.push(trozo),
    fetchFn,
  });
  assert.equal(texto, "Hola mundo");
  assert.deepEqual(vistos, ["Hola", " mundo"]);
});

test("el chat Anthropic solo toma los deltas de texto", async () => {
  const fetchFn = async () => respuestaSSE([
    'event: message_start\ndata: {"type":"message_start"}\n\n',
    'event: content_block_delta\ndata: {"delta":{"text":"Respetuosamente"}}\n\n',
    'event: content_block_delta\ndata: {"delta":{"text":", solicito"}}\n\n',
  ]);
  const texto = await chatNube({
    proveedor: "anthropic",
    key: "k",
    modelo: "claude-x",
    texto: "hola",
    fetchFn,
  });
  assert.equal(texto, "Respetuosamente, solicito");
});

test("la clave rechazada avisa en claro", async () => {
  const fetchFn = async () => ({ ok: false, status: 401, text: async () => "bad key" });
  await assert.rejects(
    () => chatNube({ proveedor: "xai", key: "mala", modelo: "grok-3-mini", texto: "h", fetchFn }),
    /clave no fue aceptada/,
  );
});

test("un 400 de clave inválida también se dice en claro", async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ code: "invalid-argument", error: "Incorrect API key provided." }),
  });
  const error = await chatNube({
    proveedor: "xai", key: "xai-mala", modelo: "grok-3-mini", texto: "h", fetchFn,
  }).catch((fallo) => fallo);
  assert.match(error.message, /clave no fue aceptada/);
  assert.match(error.message, /Incorrect API key/);
  assert.match(mensajePrueba(error), /clave no fue aceptada/);
});

test("Meta acepta la clave larga y la corta", () => {
  assert.equal(avisoClaveMeta("LLM|123|secreto"), "");
  assert.equal(avisoClaveMeta("LLM_14619_qwerty-1234"), "");
  assert.match(avisoClaveMeta("sk-otra"), /empieza por LLM/);
});

test("Meta apunta a la Model API con Muse Spark", () => {
  assert.equal(PROVEEDORES.meta.base, "https://api.meta.ai/v1");
  assert.ok(PROVEEDORES.meta.modelos.includes("muse-spark-1.3"));
});

test("sin clave o sin modelo no llama al proveedor", async () => {
  let llamadas = 0;
  const fetchFn = async () => {
    llamadas += 1;
    return respuestaSSE([]);
  };
  await assert.rejects(() => chatNube({ proveedor: "openai", key: "", modelo: "m", texto: "h", fetchFn }), /clave/);
  await assert.rejects(() => chatNube({ proveedor: "openai", key: "k", modelo: "", texto: "h", fetchFn }), /modelo/);
  assert.equal(llamadas, 0);
});

test("los cinco proveedores están definidos y traen modelos sugeridos", () => {
  assert.deepEqual(Object.keys(PROVEEDORES).sort(), ["anthropic", "custom", "meta", "openai", "xai"]);
  for (const [id, definicion] of Object.entries(PROVEEDORES)) {
    assert.ok(Array.isArray(definicion.modelos), id);
    if (id !== "custom") assert.ok(definicion.modelos.length > 0, id);
  }
});

test("Meta va sin temperature, con esfuerzo medio y mensaje developer", async () => {
  let cuerpo = null;
  const fetchFn = async (_url, pedido) => {
    cuerpo = JSON.parse(pedido.body);
    return respuestaSSE(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']);
  };
  const texto = await chatNube({
    proveedor: "meta",
    key: "LLM|1|abc",
    modelo: "muse-spark-1.3",
    texto: "hola",
    instrucciones: "Instrucción fija.",
    fetchFn,
  });
  assert.equal(texto, "ok");
  assert.equal("temperature" in cuerpo, false);
  assert.equal(cuerpo.reasoning_effort, "medium");
  assert.deepEqual(cuerpo.messages, [
    { role: "developer", content: "Instrucción fija." },
    { role: "user", content: "hola" },
  ]);
});

test("Anthropic manda dos cortes de caché y el esfuerzo, sin temperature", async () => {
  let cuerpo = null;
  const fetchFn = async (_url, pedido) => {
    cuerpo = JSON.parse(pedido.body);
    return respuestaSSE(['event: content_block_delta\ndata: {"delta":{"text":"ok"}}\n\n']);
  };
  const partes = [
    { clave: "instrucciones", cache: true, texto: "Lineamientos y perfil." },
    { clave: "caso", cache: true, texto: "Expediente y archivos." },
    { clave: "vuelta", cache: false, texto: "Fuentes y pedido." },
  ];
  const { unirPartes } = await import("../compartido/encargo.js");
  await chatNube({
    proveedor: "anthropic",
    key: "k",
    modelo: "claude-sonnet-5-5",
    texto: unirPartes(partes),
    partes,
    esfuerzo: "high",
    maxTokens: 16000,
    fetchFn,
  });
  assert.equal("temperature" in cuerpo, false);
  assert.equal(cuerpo.max_tokens, 16000);
  assert.deepEqual(cuerpo.output_config, { effort: "high" });
  assert.equal(cuerpo.messages[0].content.length, 3);
  assert.deepEqual(cuerpo.messages[0].content[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(cuerpo.messages[0].content[1].cache_control, { type: "ephemeral" });
  assert.equal(cuerpo.messages[0].content[2].cache_control, undefined);
  assert.equal(cuerpo.messages[0].content.map((b) => b.text).join(""), unirPartes(partes));
});

test("OpenAI, Grok y custom ignoran caché y esfuerzo de Anthropic", async () => {
  for (const proveedor of ["openai", "xai", "custom"]) {
    let cuerpo = null;
    const fetchFn = async (_url, pedido) => {
      cuerpo = JSON.parse(pedido.body);
      return respuestaSSE(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']);
    };
    await chatNube({
      proveedor,
      key: "k",
      modelo: "m",
      base: proveedor === "custom" ? "https://ejemplo.test/v1" : "",
      texto: "hola",
      partes: [{ clave: "instrucciones", cache: true, texto: "hola" }],
      esfuerzo: "high",
      fetchFn,
    });
    assert.equal(cuerpo.temperature, 0.2, proveedor);
    assert.equal("output_config" in cuerpo, false, proveedor);
    assert.equal("reasoning_effort" in cuerpo, false, proveedor);
    assert.deepEqual(cuerpo.messages, [{ role: "user", content: "hola" }], proveedor);
  }
});

test("Meta no cambia aunque lleguen partes y esfuerzo de Anthropic", async () => {
  let cuerpo = null;
  const fetchFn = async (_url, pedido) => {
    cuerpo = JSON.parse(pedido.body);
    return respuestaSSE(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']);
  };
  await chatNube({
    proveedor: "meta",
    key: "LLM|1|abc",
    modelo: "muse-spark-1.3",
    texto: "hola",
    instrucciones: "Instrucción fija.",
    partes: [{ clave: "instrucciones", cache: true, texto: "hola" }],
    fetchFn,
  });
  assert.equal("temperature" in cuerpo, false);
  assert.equal("output_config" in cuerpo, false);
  assert.equal(cuerpo.reasoning_effort, "medium");
  assert.deepEqual(cuerpo.messages, [
    { role: "developer", content: "Instrucción fija." },
    { role: "user", content: "hola" },
  ]);
});

test("OpenAI conserva temperature y no manda esfuerzo", async () => {
  let cuerpo = null;
  const fetchFn = async (_url, pedido) => {
    cuerpo = JSON.parse(pedido.body);
    return respuestaSSE(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']);
  };
  await chatNube({ proveedor: "openai", key: "k", modelo: "gpt-4o-mini", texto: "hola", fetchFn });
  assert.equal(cuerpo.temperature, 0.2);
  assert.equal("reasoning_effort" in cuerpo, false);
  assert.deepEqual(cuerpo.messages, [{ role: "user", content: "hola" }]);
});

test("la clave de Meta se limpia de espacios y Bearer pegados", async () => {
  let auth = "";
  const fetchFn = async (_url, pedido) => {
    auth = pedido.headers.Authorization;
    return respuestaSSE(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']);
  };
  await chatNube({ proveedor: "meta", key: "Bearer LLM|1|a b c ", modelo: "muse-spark-1.3", texto: "h", fetchFn });
  assert.equal(auth, "Bearer LLM|1|abc");
});

test("cada proveedor declara su ayuda y prefijos de clave", async () => {
  const { formaClaveValida } = await import("../src/nube.js");
  assert.equal(formaClaveValida("meta", "LLM|1|abc"), true);
  assert.equal(formaClaveValida("meta", "LLM_abc-123"), true);
  assert.equal(formaClaveValida("meta", "otra"), false);
  assert.equal(formaClaveValida("openai", "sk-abc"), true);
  assert.equal(formaClaveValida("xai", "xai-abc"), true);
  assert.equal(formaClaveValida("anthropic", "sk-ant-abc"), true);
  assert.equal(formaClaveValida("custom", "loquesea"), true);
  assert.equal(formaClaveValida("meta", ""), true);
});

test("el uso del proveedor se reporta sin romper el texto", async () => {
  let uso = null;
  const fetchFn = async () => respuestaSSE([
    'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50}}\n\n',
    'data: [DONE]\n\n',
  ]);
  const texto = await chatNube({
    proveedor: "openai", key: "k", modelo: "gpt-6.1-sol", texto: "h",
    onUso: (u) => { uso = u; }, fetchFn,
  });
  assert.equal(texto, "ok");
  assert.deepEqual(uso, { entrada: 100, salida: 50 });
});

test("Anthropic va sin temperature, con system y el resto del pedido", async () => {
  let cuerpo = null;
  let headers = null;
  let url = "";
  const fetchFn = async (direccion, pedido) => {
    url = direccion;
    headers = pedido.headers;
    cuerpo = JSON.parse(pedido.body);
    return respuestaSSE([
      'event: content_block_delta\ndata: {"delta":{"text":"ok"}}\n\n',
    ]);
  };
  const texto = await chatNube({
    proveedor: "anthropic",
    key: "sk-ant-prueba",
    modelo: "claude-sonnet-5-5",
    texto: "Redacta el memorial.",
    instrucciones: "Eres un abogado.",
    maxTokens: 800,
    fetchFn,
  });
  assert.equal(texto, "ok");
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal("temperature" in cuerpo, false);
  assert.equal("top_p" in cuerpo, false);
  assert.equal("top_k" in cuerpo, false);
  assert.equal(cuerpo.system, "Eres un abogado.");
  assert.equal(cuerpo.model, "claude-sonnet-5-5");
  assert.equal(cuerpo.max_tokens, 800);
  assert.equal(cuerpo.stream, true);
  assert.deepEqual(cuerpo.messages, [{ role: "user", content: "Redacta el memorial." }]);
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(headers["x-api-key"], "sk-ant-prueba");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal("anthropic-dangerous-direct-browser-access" in headers, false);
});

test("Anthropic sin instrucciones no manda system vacío", async () => {
  let cuerpo = null;
  const fetchFn = async (_url, pedido) => {
    cuerpo = JSON.parse(pedido.body);
    return respuestaSSE(['event: content_block_delta\ndata: {"delta":{"text":"ok"}}\n\n']);
  };
  await chatNube({ proveedor: "anthropic", key: "k", modelo: "claude-sonnet-5-5", texto: "hola", fetchFn });
  assert.equal("system" in cuerpo, false);
  assert.equal("temperature" in cuerpo, false);
});

test("un 400 de Anthropic llega con el motivo que da la API", async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: "temperature is deprecated for this model." },
    }),
  });
  const error = await chatNube({
    proveedor: "anthropic", key: "k", modelo: "claude-sonnet-5-5", texto: "h", fetchFn,
  }).catch((fallo) => fallo);
  assert.match(error.message, /código 400/);
  assert.match(error.message, /temperature is deprecated for this model/);
  assert.match(mensajePrueba(error), /temperature is deprecated for this model/);
});

test("Anthropic junta entrada del inicio y salida del delta", async () => {
  let uso = null;
  const fetchFn = async () => respuestaSSE([
    'event: message_start\ndata: {"message":{"usage":{"input_tokens":30}}}\n\n',
    'event: content_block_delta\ndata: {"delta":{"text":"hola"}}\n\n',
    'event: message_delta\ndata: {"usage":{"output_tokens":7}}\n\n',
  ]);
  const texto = await chatNube({
    proveedor: "anthropic", key: "k", modelo: "claude-sonnet-5-5", texto: "h",
    onUso: (u) => { uso = u; }, fetchFn,
  });
  assert.equal(texto, "hola");
  assert.deepEqual(uso, { entrada: 30, salida: 7 });
});

test("el costo sale de la tabla oficial por modelo", async () => {
  const { costoAprox } = await import("../src/nube.js");
  assert.equal(costoAprox("muse-spark-1.3", 1000000, 0), 1.25);
  assert.equal(costoAprox("muse-spark-1.3", 0, 1000000), 4.25);
  assert.equal(costoAprox("otro-modelo", 10, 10), null);
});

test("la ventana de contexto sale de la tabla oficial", async () => {
  const { contextoDe } = await import("../src/nube.js");
  assert.equal(contextoDe("muse-spark-1.3"), 1048576);
  assert.equal(contextoDe("claude-sonnet-5-5"), 1000000);
  assert.equal(contextoDe("otro-modelo"), null);
  assert.equal(contextoDe(""), null);
});
