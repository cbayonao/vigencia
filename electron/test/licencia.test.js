import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { DIAS_PRUEBA, planAbierto } from "../compartido/plan.js";
import { LLAVE_PUBLICA, PRECIO_CENTAVOS, PRECIO_PESOS, estadoLicencia, textoPrecio } from "../compartido/licencia.js";
import { confirmarPlan, fotoLicencia, iniciarPlan, activarCodigo } from "../src/licencia.js";
import {
  PRECIO_CENTAVOS as CENTAVOS_SERVICIO,
  PRECIO_PESOS as PESOS_SERVICIO,
  firmaIntegridad,
  firmarToken,
  siguienteHasta,
  verificarEvento,
} from "../../licencia/comun.mjs";
import { crearServicio, tiendaMemoria } from "../../licencia/servicio.mjs";

const AHORA = new Date("2026-10-11T12:00:00.000Z");

function parDeLlaves() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publica: publicKey.export({ type: "spki", format: "pem" }),
    privada: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

test("el precio del plan es 599.900 pesos en la aplicación y en el servicio", () => {
  assert.equal(PRECIO_PESOS, 599900);
  assert.equal(PRECIO_PESOS, PESOS_SERVICIO);
  assert.equal(PRECIO_CENTAVOS, CENTAVOS_SERVICIO);
  assert.equal(textoPrecio(), "$599.900");
});

test("sin comprobante y sin inicio el plan no empezó", () => {
  const foto = estadoLicencia({ token: "", instalacion: "a".repeat(64), ahora: AHORA });
  assert.equal(foto.estado, "sin_pago");
  assert.equal(planAbierto("vigente"), true);
  assert.equal(planAbierto("prueba"), true);
  assert.equal(planAbierto("sin_pago"), false);
  assert.equal(planAbierto("vencida"), false);
  assert.equal(DIAS_PRUEBA, 20);
});

test("la prueba gratis dura 20 días desde el primer arranque", () => {
  const inicio = "2026-10-01T12:00:00.000Z";
  const dia1 = estadoLicencia({ token: "", instalacion: "a".repeat(64), ahora: new Date(inicio), inicio });
  assert.equal(dia1.estado, "prueba");
  assert.equal(dia1.diasRestantes, 20);
  const dia19 = estadoLicencia({ token: "", instalacion: "a".repeat(64), ahora: new Date("2026-10-21T11:00:00.000Z"), inicio });
  assert.equal(dia19.estado, "prueba");
  assert.equal(dia19.diasRestantes, 1);
  const dia21 = estadoLicencia({ token: "", instalacion: "a".repeat(64), ahora: new Date("2026-10-21T12:00:01.000Z"), inicio });
  assert.equal(dia21.estado, "sin_pago");
  const relojAtras = estadoLicencia({ token: "", instalacion: "a".repeat(64), ahora: new Date("2026-09-01T00:00:00.000Z"), inicio });
  assert.equal(relojAtras.estado, "sin_pago");
  const vistoAtras = estadoLicencia({
    token: "", instalacion: "a".repeat(64),
    ahora: new Date("2026-10-10T00:00:00.000Z"), inicio, visto: "2026-10-15T00:00:00.000Z",
  });
  assert.equal(vistoAtras.estado, "sin_pago");
  // El pago manda sobre la prueba.
  const { publica, privada } = parDeLlaves();
  const token = firmarToken({ inst: "a".repeat(64), hasta: "2027-10-11T12:00:00.000Z", iat: 1 }, privada);
  assert.equal(estadoLicencia({ token, instalacion: "a".repeat(64), ahora: AHORA, inicio, publica }).estado, "vigente");
});

test("una cuenta activada no la toca la prueba aunque el inicio esté vencido", () => {
  const { publica, privada } = parDeLlaves();
  const instalacion = "b".repeat(64);
  const token = firmarToken({ inst: instalacion, hasta: "2027-10-11T12:00:00.000Z", iat: 1 }, privada);
  const vieja = estadoLicencia({
    token, instalacion, ahora: AHORA, inicio: "2020-01-01T00:00:00.000Z", publica,
  });
  assert.equal(vieja.estado, "vigente");
  assert.equal(vieja.diasRestantes, undefined);
});

test("un comprobante de otro computador no abre el plan", () => {
  const { publica, privada } = parDeLlaves();
  const token = firmarToken({ inst: "a".repeat(64), hasta: "2027-10-11T12:00:00.000Z", iat: 1 }, privada);
  const foto = estadoLicencia({ token, instalacion: "b".repeat(64), ahora: AHORA, publica });
  assert.equal(foto.estado, "sin_pago");
});

test("el año vencido deja solo la renovación y el reloj atrasado también", () => {
  const { publica, privada } = parDeLlaves();
  const instalacion = "c".repeat(64);
  const token = firmarToken({
    inst: instalacion,
    hasta: "2026-10-11T12:00:00.000Z",
    iat: Math.floor(AHORA.getTime() / 1000),
  }, privada);
  assert.equal(estadoLicencia({ token, instalacion, ahora: AHORA, publica }).estado, "vencida");
  const vigente = firmarToken({
    inst: instalacion,
    hasta: "2027-10-11T12:00:00.000Z",
    iat: Math.floor(Date.parse("2026-10-11T12:00:00.000Z") / 1000),
  }, privada);
  const atrasado = new Date("2026-10-11T10:00:00.000Z");
  assert.equal(estadoLicencia({ token: vigente, instalacion, ahora: atrasado, publica }).estado, "vencida");
  assert.equal(estadoLicencia({
    token: vigente,
    instalacion,
    ahora: new Date("2026-10-11T13:00:00.000Z"),
    publica,
  }).estado, "vigente");
});

test("renovar antes de vencer suma el año al vencimiento, no a hoy", () => {
  const futuro = "2027-01-01T00:00:00.000Z";
  assert.equal(siguienteHasta(futuro, AHORA), "2028-01-01T00:00:00.000Z");
  assert.equal(siguienteHasta("2020-01-01T00:00:00.000Z", AHORA), "2027-10-11T12:00:00.000Z");
});

test("la llave pública empaquetada corresponde a la llave privada del servicio", () => {
  const privada = fs.readFileSync(new URL("../../licencia/claves/licencia-privada.pem", import.meta.url), "utf8");
  const token = firmarToken({ inst: "d".repeat(64), hasta: "2027-10-11T12:00:00.000Z", iat: 1 }, privada);
  assert.equal(estadoLicencia({
    token,
    instalacion: "d".repeat(64),
    ahora: AHORA,
    publica: LLAVE_PUBLICA,
  }).estado, "vigente");
});

test("el pago aprobado abre un año y un monto distinto no cuenta", async () => {
  const { privada } = parDeLlaves();
  const tienda = tiendaMemoria();
  const pagos = new Map();
  const servicio = crearServicio({
    tienda,
    privada,
    wompi: { lista: true, publica: "pub_test_x", integridad: "test_integrity_x", eventos: "test_events_x" },
    publicaBase: "https://licencia.example",
    ahora: () => AHORA,
    azar: () => "abc123",
    consultar: async (referencia) => pagos.get(referencia) || [],
  });
  const instalacion = "e".repeat(64);
  const inicio = await servicio.atender({ method: "POST", path: "/iniciar", body: { instalacion } });
  assert.equal(inicio.status, 200);
  assert.match(inicio.body.url, /^https:\/\/checkout\.wompi\.co\/p\//);
  const firma = firmaIntegridad("vg_abc123", PRECIO_CENTAVOS, "COP", "test_integrity_x");
  assert.ok(inicio.body.url.includes(`signature:integrity=${firma}`));
  assert.ok(inicio.body.url.includes("redirect-url="));

  pagos.set("vg_abc123", [{ reference: "vg_abc123", status: "APPROVED", currency: "COP", amount_in_cents: 100 }]);
  const falso = await servicio.atender({ method: "GET", path: "/estado", query: { instalacion } });
  assert.equal(falso.body.estado, "sin_pago");

  pagos.set("vg_abc123", [{ reference: "vg_abc123", status: "APPROVED", currency: "COP", amount_in_cents: PRECIO_CENTAVOS }]);
  const bueno = await servicio.atender({ method: "GET", path: "/estado", query: { instalacion } });
  assert.equal(bueno.body.estado, "vigente");
  assert.equal(bueno.body.hasta, "2027-10-11T12:00:00.000Z");

  const otra = await servicio.atender({ method: "POST", path: "/iniciar", body: { instalacion } });
  assert.equal(otra.body.estado, "vigente");
  assert.equal(otra.body.url, undefined);
});

test("un aviso de Wompi sin firma no renueva y el mismo pago no suma dos años", async () => {
  const { privada } = parDeLlaves();
  const tienda = tiendaMemoria();
  const servicio = crearServicio({
    tienda,
    privada,
    wompi: { lista: true, publica: "pub_test_x", integridad: "test_integrity_x", eventos: "test_events_secreto" },
    ahora: () => AHORA,
    azar: () => "aviso1",
    consultar: async () => [{ reference: "vg_aviso1", status: "APPROVED", currency: "COP", amount_in_cents: PRECIO_CENTAVOS }],
  });
  const instalacion = "f".repeat(64);
  await servicio.atender({ method: "POST", path: "/iniciar", body: { instalacion } });
  const malo = await servicio.atender({
    method: "POST",
    path: "/evento",
    body: { event: "transaction.updated", data: { transaction: { reference: "vg_aviso1", status: "APPROVED" } }, signature: { properties: [], checksum: "00" }, timestamp: 1 },
  });
  assert.equal(malo.status, 401);

  const aviso = {
    event: "transaction.updated",
    data: { transaction: { id: "tx1", status: "APPROVED", amount_in_cents: PRECIO_CENTAVOS, reference: "vg_aviso1" } },
    signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"] },
    timestamp: 1530291411,
  };
  const cadena = `tx1APPROVED${PRECIO_CENTAVOS}1530291411test_events_secreto`;
  aviso.signature.checksum = crypto.createHash("sha256").update(cadena).digest("hex");
  const primero = await servicio.atender({ method: "POST", path: "/evento", body: aviso });
  assert.equal(primero.status, 200);
  const segundo = await servicio.atender({ method: "POST", path: "/evento", body: aviso });
  assert.equal(segundo.status, 200);
  const estado = await servicio.atender({ method: "GET", path: "/estado", query: { instalacion } });
  assert.equal(estado.body.hasta, "2027-10-11T12:00:00.000Z");
  assert.equal(verificarEvento(aviso, "test_events_secreto").ok, true);
});

test("los comentarios se guardan pendientes y el equipo los aprueba", async () => {
  const servicio = crearServicio({ claveAdmin: "secreto", ahora: () => AHORA, azar: () => "c1" });
  const corto = await servicio.atender({ method: "POST", path: "/comentarios", body: { texto: "ok" } });
  assert.equal(corto.status, 400);
  const trampa = await servicio.atender({ method: "POST", path: "/comentarios", body: { texto: "spam bueno", trampa: "x" } });
  assert.equal(trampa.status, 400);
  const bueno = await servicio.atender({
    method: "POST", path: "/comentarios",
    body: { nombre: "  Ana  ", tipo: "bug", texto: "  No abre el PDF  " },
  });
  assert.equal(bueno.status, 200);
  assert.equal(bueno.body.ok, true);
  const publicos = await servicio.atender({ method: "GET", path: "/comentarios" });
  assert.deepEqual(publicos.body.comentarios, []);
  const sinClave = await servicio.atender({ method: "GET", path: "/admin/comentarios" });
  assert.equal(sinClave.status, 401);
  const todos = await servicio.atender({ method: "GET", path: "/admin/comentarios", query: { clave: "secreto" } });
  assert.equal(todos.body.comentarios.length, 1);
  assert.equal(todos.body.comentarios[0].nombre, "Ana");
  assert.equal(todos.body.comentarios[0].tipo, "bug");
  assert.equal(todos.body.comentarios[0].visible, false);
  const aprobar = await servicio.atender({
    method: "POST", path: "/admin/comentarios", body: { clave: "secreto", id: todos.body.comentarios[0].id, visible: true },
  });
  assert.equal(aprobar.body.ok, true);
  const ya = await servicio.atender({ method: "GET", path: "/comentarios" });
  assert.equal(ya.body.comentarios.length, 1);
  assert.equal(ya.body.comentarios[0].texto, "No abre el PDF");
});

test("sin servicio configurado la aplicación abre en prueba", async () => {
  const dir = fs.mkdtempSync("/tmp/vigencia-licencia-");
  const apagado = { VIGENCIA_LICENCIA_URL: "" };
  const foto = fotoLicencia(dir, AHORA, apagado);
  assert.equal(foto.estado, "prueba");
  assert.equal(foto.diasRestantes, 20);
  assert.equal(foto.conectado, false);
  const caja = JSON.parse(fs.readFileSync(`${dir}/licencia.json`, "utf8"));
  assert.equal(caja.inicio, AHORA.toISOString());
  const inicio = await iniciarPlan({ dir, env: apagado, ahora: AHORA });
  assert.equal(inicio.ok, false);
  const confirmado = await confirmarPlan({ dir, env: apagado, ahora: AHORA });
  assert.equal(confirmado.estado, "prueba");
});

test("el código firmado abre solo esta instalación", () => {
  const dir = fs.mkdtempSync("/tmp/vigencia-licencia-codigo-");
  fotoLicencia(dir, AHORA, {});
  const guardada = JSON.parse(fs.readFileSync(`${dir}/licencia.json`, "utf8"));
  const privada = fs.readFileSync(new URL("../../licencia/claves/licencia-privada.pem", import.meta.url), "utf8");
  const iat = Math.floor(AHORA.getTime() / 1000);
  const ajeno = firmarToken({ inst: "a".repeat(64), hasta: "2036-10-11T12:00:00.000Z", iat }, privada);
  assert.equal(activarCodigo({ dir, codigo: ajeno, ahora: AHORA, env: {} }).ok, false);
  assert.equal(activarCodigo({ dir, codigo: "no-es-un-codigo", ahora: AHORA, env: {} }).error, "Ese código no abre esta instalación.");
  const vencido = firmarToken({ inst: guardada.id, hasta: "2020-01-01T00:00:00.000Z", iat: 1577836800 }, privada);
  assert.equal(activarCodigo({ dir, codigo: vencido, ahora: AHORA, env: {} }).error, "Ese código ya se venció.");
  const propio = firmarToken({ inst: guardada.id, hasta: "2036-10-11T12:00:00.000Z", iat }, privada);
  const abierto = activarCodigo({ dir, codigo: `  ${propio}  `, ahora: AHORA, env: {} });
  assert.equal(abierto.estado, "vigente");
});
