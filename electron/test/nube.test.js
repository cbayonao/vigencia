import test from "node:test";
import assert from "node:assert/strict";
import { PROVEEDORES, chatNube } from "../src/nube.js";

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
