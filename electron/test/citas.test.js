// Stream grabado a mano a partir de los ejemplos de
// docs.claude.com/en/docs/build-with-claude/citations (response structure
// y streaming) y de platform.claude.com search results (search_result_location).
// Los «...» de la doc se completaron con los campos que el mismo ejemplo lista.
import assert from "node:assert/strict";
import test from "node:test";
import { MARCA_SIN_FUENTE, MODELO_REVISOR, PEDIDO_REVISION, citasEnFragmento, leerFuente, leerPendientes, parrafosSinFuente, proyectarCitas, reconstruirCitas } from "../compartido/citas.js";
import { marcarCitasDocumento } from "../compartido/documentos.js";

const FLUJO = `event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"According to the document, "}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":"","citations":[{"type":"char_location","cited_text":"The grass is green.","document_index":0,"document_title":"Example Document","start_char_index":0,"end_char_index":20}]}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"the grass is green"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"text","text":" and "}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"the sky is blue"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"citations_delta","citation":{"type":"char_location","cited_text":"The sky is blue.","document_index":0,"document_title":"Example Document","start_char_index":20,"end_char_index":36}}}

event: content_block_stop
data: {"type":"content_block_stop","index":2}

event: content_block_start
data: {"type":"content_block_start","index":3,"content_block":{"type":"text","text":". Information from page 5 states that "}}

event: content_block_stop
data: {"type":"content_block_stop","index":3}

event: content_block_start
data: {"type":"content_block_start","index":4,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":4,"delta":{"type":"text_delta","text":"water is essential"}}

event: content_block_delta
data: {"type":"content_block_delta","index":4,"delta":{"type":"citations_delta","citation":{"type":"page_location","cited_text":"Water is essential for life.","document_index":1,"document_title":"PDF Document","start_page_number":5,"end_page_number":6}}}

event: content_block_stop
data: {"type":"content_block_stop","index":4}

event: content_block_start
data: {"type":"content_block_start","index":5,"content_block":{"type":"text","text":". The custom document mentions "}}

event: content_block_stop
data: {"type":"content_block_stop","index":5}

event: content_block_start
data: {"type":"content_block_start","index":6,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":6,"delta":{"type":"text_delta","text":"important findings"}}

event: content_block_delta
data: {"type":"content_block_delta","index":6,"delta":{"type":"citations_delta","citation":{"type":"content_block_location","cited_text":"These are important findings.","document_index":2,"document_title":"Custom Content Document","start_block_index":0,"end_block_index":1}}}

event: content_block_stop
data: {"type":"content_block_stop","index":6}

event: content_block_start
data: {"type":"content_block_start","index":7,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":7,"delta":{"type":"text_delta","text":"All API requests must include an API key"}}

event: content_block_delta
data: {"type":"content_block_delta","index":7,"delta":{"type":"citations_delta","citation":{"type":"search_result_location","cited_text":"All API requests must include an API key in the Authorization header. Keys can be generated from the dashboard. Rate limits: 1000 requests per hour for standard tier, 10000 for premium.","source":"pieza:9","title":"T-760 de 2008","search_result_index":0,"start_block_index":0,"end_block_index":1}}}

event: content_block_delta
data: {"type":"content_block_delta","index":7,"delta":{"type":"citations_delta","citation":{"type":"search_result_location","cited_text":"El demandado fue notificado.","source":"archivo:4:2","title":"demanda.pdf, página 2","search_result_index":1,"start_block_index":0,"end_block_index":1}}}

event: content_block_stop
data: {"type":"content_block_stop","index":7}

event: message_delta
data: {"type":"message_delta","usage":{"output_tokens":40}}

event: message_stop
data: {"type":"message_stop"}
`;

test("lee pieza y archivo desde el source", () => {
  assert.deepEqual(leerFuente("pieza:9"), { fuente_tipo: "pieza", fuente_id: "9", pagina: null });
  assert.deepEqual(leerFuente("archivo:4:2"), { fuente_tipo: "archivo", fuente_id: "4", pagina: 2 });
  assert.equal(leerFuente("https://docs.company.com/api-reference").fuente_tipo, "search_result");
});

test("reconstruye texto y citas desde el stream de la documentación", () => {
  const documentos = [
    { id: 11, paginas: [1] },
    { id: 12, paginas: [5] },
    { id: 4, paginas: [2, 8] },
  ];
  const { texto, citas } = reconstruirCitas(FLUJO, { documentos });
  const esperado = [
    "According to the document, ",
    "the grass is green",
    " and the sky is blue",
    ". Information from page 5 states that ",
    "water is essential",
    ". The custom document mentions ",
    "important findings",
    "All API requests must include an API key",
  ].join("");
  assert.equal(texto, esperado);

  const en = (fragmento) => {
    const inicio = texto.indexOf(fragmento);
    return { inicio, fin: inicio + fragmento.length };
  };
  assert.equal(citas.length, 6);

  const hierba = citas[0];
  assert.deepEqual({ inicio: hierba.inicio, fin: hierba.fin }, en("the grass is green"));
  assert.equal(hierba.fuente_tipo, "archivo");
  assert.equal(hierba.fuente_id, "11");
  assert.equal(hierba.pagina, null);
  assert.equal(hierba.texto_citado, "The grass is green.");

  const cielo = citas[1];
  assert.deepEqual({ inicio: cielo.inicio, fin: cielo.fin }, en(" and the sky is blue"));
  assert.equal(cielo.texto_citado, "The sky is blue.");
  assert.equal(cielo.fuente_id, "11");

  const agua = citas[2];
  assert.deepEqual({ inicio: agua.inicio, fin: agua.fin }, en("water is essential"));
  assert.equal(agua.fuente_tipo, "archivo");
  assert.equal(agua.fuente_id, "12");
  assert.equal(agua.pagina, 5);
  assert.equal(agua.texto_citado, "Water is essential for life.");

  const hallazgos = citas[3];
  assert.deepEqual({ inicio: hallazgos.inicio, fin: hallazgos.fin }, en("important findings"));
  assert.equal(hallazgos.fuente_tipo, "archivo");
  assert.equal(hallazgos.fuente_id, "4");
  assert.equal(hallazgos.pagina, 2);
  assert.equal(hallazgos.texto_citado, "These are important findings.");

  const clave = citas[4];
  const archivo = citas[5];
  assert.deepEqual({ inicio: clave.inicio, fin: clave.fin }, en("All API requests must include an API key"));
  assert.equal(clave.inicio, archivo.inicio);
  assert.equal(clave.fin, archivo.fin);
  assert.equal(clave.fuente_tipo, "pieza");
  assert.equal(clave.fuente_id, "9");
  assert.equal(clave.pagina, null);
  assert.match(clave.texto_citado, /Authorization header/);
  assert.equal(archivo.fuente_tipo, "archivo");
  assert.equal(archivo.fuente_id, "4");
  assert.equal(archivo.pagina, 2);
  assert.equal(archivo.texto_citado, "El demandado fue notificado.");

  assert.ok(citas.every((c, i) => i === 0 || c.inicio >= citas[i - 1].inicio));
  assert.equal(reconstruirCitas("").texto, "");
  assert.deepEqual(reconstruirCitas("").citas, []);
});

test("marca norma o sentencia sin cita nativa y deja [Cita no aportada]", () => {
  const marcada = marcarCitasDocumento([{ titulo: "H", parrafos: ["La Ley 9999 de 2099 obliga al juez."] }], "")[0].parrafos[0];
  assert.match(marcada, /\[Cita no aportada\]/);
  const parrafos = [
    { texto: "La Ley 1751 de 2015 reconoce la salud.", inicio: 0 },
    { texto: "El artículo 86 de la Constitución permite la tutela.", inicio: 80 },
    { texto: "El Decreto 2591 de 1991 reglamenta el trámite.", inicio: 160 },
    { texto: "La sentencia T-760 de 2008 protege el acceso.", inicio: 240 },
    { texto: "La sentencia SU-123 de 2020 reiteró esa línea.", inicio: 320 },
    { texto: "Según la sentencia de casación SL1234-2020, el despido fue nulo.", inicio: 400 },
    { texto: marcada, inicio: 480 },
    { texto: "La EPS negó la cirugía el 3 de marzo.", inicio: 560 },
    { texto: "En el artículo de prensa no hay una norma.", inicio: 640 },
    { texto: "La Ley 100 de 1993 creó el sistema de salud.", inicio: 720 },
  ];
  assert.equal(parrafos.length, 10);
  const citas = [{ inicio: 720, fin: 770, fuente_tipo: "pieza", fuente_id: "1", pagina: null, texto_citado: "sistema" }];
  const marcas = parrafosSinFuente(parrafos, citas);
  assert.deepEqual(marcas.map((m) => m.indice), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(marcas.every((m) => m.marca === MARCA_SIN_FUENTE));
  assert.match(marcas.find((m) => m.indice === 6).texto, /\[Cita no aportada\]/);
  assert.equal(parrafos[6].texto, marcada);
  const locales = citasEnFragmento(parrafos[9].texto, citas, 720);
  assert.equal(locales.length, 1);
  assert.equal(locales[0].inicio, 0);
  const vistos = proyectarCitas("La Ley 100 de 1993 creó el sistema.", "La Ley 100 de 1993 creó el sistema.", locales);
  assert.equal(vistos[0].fin > vistos[0].inicio, true);
  assert.equal(parrafosSinFuente([{ texto: "La sentencia C-355 de 2006.", inicio: 0 }], [{ inicio: 0, fin: 20 }]).length, 0);
});

test("el revisor pide texto y no JSON", () => {
  assert.equal(MODELO_REVISOR, "claude-haiku-5-5");
  assert.match(PEDIDO_REVISION, /No uses JSON/);
  assert.doesNotMatch(PEDIDO_REVISION, /output_config|json_schema/i);
  assert.deepEqual(leerPendientes("Ninguna"), []);
  assert.deepEqual(leerPendientes(""), []);
  const lista = leerPendientes([
    "Pendientes:",
    "- [Hechos] La EPS está obligada a entregar el medicamento.",
    "2. Párrafo Pretensiones: Hay condena en costas.",
    "- El término de diez días no está en las fuentes.",
    "Ninguna",
  ].join("\n"));
  assert.equal(lista.length, 3);
  assert.equal(lista[0].parrafo, "Hechos");
  assert.match(lista[0].afirmacion, /medicamento/);
  assert.equal(lista[1].parrafo, "Pretensiones");
  assert.equal(lista[2].parrafo, "");
  assert.match(lista[2].afirmacion, /diez días/);
});
