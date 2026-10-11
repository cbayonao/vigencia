import test from "node:test";
import assert from "node:assert/strict";
import { TIPOS_INICIALES, redactarInicial, requisitosDe, reglaDe } from "../compartido/iniciales.js";

const DATOS = {
  ciudad: "Bogotá",
  presentante: "Ana Pérez",
  identificacion: "123",
  domicilio: "Calle 1",
  contraparte: "Luis Parte",
  autoridad: "Juez Civil Municipal",
  hechos: "Le presté dinero.\nNo me pagó.",
  pretensiones: "Que pague lo debido.",
  pruebas: "El contrato.",
  cuantia: "10 millones",
  derecho: "debido proceso",
  juramento: true,
  instruccion: "",
};

test("la demanda trae las secciones del artículo 82", () => {
  const { asunto, secciones } = redactarInicial({ tipo: "demanda", datos: DATOS, hoy: "1 de octubre de 2026" });
  assert.equal(asunto, "Demanda");
  const titulos = secciones.map((s) => s.titulo);
  for (const esperado of ["Destinatario", "Referencia", "Hechos", "Pretensiones", "Fundamentos", "Pruebas", "Cuantía", "Notificaciones", "Cierre"]) {
    assert.ok(titulos.includes(esperado), esperado);
  }
  const hechos = secciones.find((s) => s.titulo === "Hechos");
  assert.deepEqual(hechos.parrafos, ["1. Le presté dinero.", "2. No me pagó."]);
});

test("lo que falta sale como dato pendiente, no inventado", () => {
  const { secciones } = redactarInicial({ tipo: "demanda", datos: { hechos: "Algo pasó." }, hoy: "hoy" });
  const cuantia = secciones.find((s) => s.titulo === "Cuantía");
  assert.ok(cuantia.parrafos[0].includes("[Dato pendiente"));
  const ref = secciones.find((s) => s.titulo === "Referencia");
  assert.ok(ref.parrafos.join(" ").includes("[Dato pendiente"));
});

test("la tutela trae juramento y la petición sus términos", () => {
  const tutela = redactarInicial({ tipo: "tutela", datos: DATOS, hoy: "hoy" });
  const juramento = tutela.secciones.find((s) => s.titulo === "Juramento");
  assert.ok(juramento.parrafos[0].includes("Bajo juramento"));
  const peticion = redactarInicial({ tipo: "peticion", datos: DATOS, hoy: "hoy" });
  const fundamentos = peticion.secciones.find((s) => s.titulo === "Fundamentos");
  assert.ok(fundamentos.parrafos[0].includes("Ley 1755 de 2015"));
});

test("sin tipo o sin hechos ni instrucción no se redacta", () => {
  assert.throws(() => redactarInicial({ tipo: "nada", datos: {}, hoy: "" }), /demanda, tutela/);
  assert.throws(() => redactarInicial({ tipo: "tutela", datos: {}, hoy: "" }), /hechos/);
});

test("cada tipo publica sus requisitos y su regla para la IA", () => {
  assert.deepEqual(Object.keys(TIPOS_INICIALES).sort(), ["demanda", "peticion", "tutela"]);
  assert.ok(requisitosDe("demanda").length >= 9);
  assert.ok(requisitosDe("tutela").join(" ").includes("Juramento"));
  assert.ok(reglaDe("peticion").includes("1755"));
});
