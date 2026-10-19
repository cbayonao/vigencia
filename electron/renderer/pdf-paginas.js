// Herramientas PDF de páginas: Unir, Separar y Girar. Las tres muestran las
// páginas como miniaturas (renderer/paginas.js, el mismo visor de Firmar)
// y se manejan con ratón o teclado. La lógica de rangos, cortes y giros es
// pura y está en compartido/pdfvisual.js.
import { parsearRangos } from "../compartido/pdftools.js";
import { alternarCorte, cortesAPartes, cortesCada, cuantasGiradas, girarPaginas, indicesARangos, parteDeCadaPagina, tamanoHumano } from "../compartido/pdfvisual.js";
import { avisar } from "./aviso.js";
import { boton, botonIcono, celdaMini, correr, crearEscena, icono, terminar, zonaVacia } from "./escena.js";
import { abrirDoc, cerrarDoc, crearVisor, docUnico, escalaMiniatura, pintarMiniatura } from "./paginas.js";
import { alAbrir, elegirUno, estado, nodo, nombreCorto, ofrecerLlevar, pdf, ponerUno } from "./pdf.js";

const $ = (id) => document.getElementById(id);
const LADO = 132;
const LADO_TIRA = 60;
const COLORES = 6;
const MAX_TIRA = 400;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const todas = (total) => Array.from({ length: total }, (_v, i) => i);

function rejilla(caja, envolver, lado = LADO) {
  return crearVisor({ caja, raiz: null, clase: "pv-lienzo", escala: escalaMiniatura(lado), envolver, maxMemoria: 4 });
}

// Elegir con clic; con Mayúscula, el tramo desde el último clic.
function alternarEleccion(conjunto, i, tramo, ultimo) {
  if (tramo && ultimo != null) {
    const [a, b] = ultimo < i ? [ultimo, i] : [i, ultimo];
    for (let k = a; k <= b; k++) conjunto.add(k);
  } else if (conjunto.has(i)) {
    conjunto.delete(i);
  } else {
    conjunto.add(i);
  }
}

function campoRangos(etiqueta, alCambiar) {
  const l = nodo("label", "pv-rangos");
  l.append(nodo("span", "etiqueta", etiqueta));
  const campo = document.createElement("input");
  campo.autocomplete = "off";
  campo.spellcheck = false;
  campo.placeholder = "Ej. 1-3, 5";
  campo.addEventListener("input", () => alCambiar(campo.value));
  l.append(campo);
  return { l, campo };
}

// ---------- Unir ----------

const u = { archivos: [], abierto: null, arrastre: -1, sig: 1 };
let eu = null;
let tira = null;
let visorAbierto = null;

const elegidasDe = (a) => a.indices ?? todas(a.info.paginas);
const totalUnir = () => u.archivos.reduce((s, a) => s + elegidasDe(a).length, 0);

export async function agregarUnir(rutas) {
  let nuevos = 0;
  for (const ruta of rutas || []) {
    if (!ruta || u.archivos.some((a) => a.ruta === ruta)) continue;
    if (u.archivos.length >= 50) {
      avisar("Máximo 50 PDF por unión.", "error");
      break;
    }
    const info = await window.vigencia.pdfInfo(ruta);
    if (!info?.ok) {
      avisar(`${nombreCorto(ruta)}: ${info?.error || "no pude leerlo."}`, "error");
      continue;
    }
    const mini = document.createElement("canvas");
    mini.className = "pv-lienzo pv-cargando";
    const a = { id: u.sig++, ruta, info, indices: null, doc: null, mini };
    u.archivos.push(a);
    nuevos += 1;
    abrirDoc(ruta).then(async (doc) => {
      if (!u.archivos.includes(a)) return cerrarDoc(doc);
      a.doc = doc;
      await pintarMiniatura(doc, 1, mini, info.detalle[0], LADO);
      mini.classList.remove("pv-cargando");
      pintarTira();
      if (u.abierto === a.id) pintarAbierto();
    }).catch(() => mini.classList.add("pv-error"));
  }
  if (nuevos === 1 && rutas.length === 1) ofrecerLlevar(rutas[0]);
  if (nuevos) eu.mostrarPie();
  pintarUnir();
}

function quitarUnir(a) {
  u.archivos = u.archivos.filter((x) => x !== a);
  if (u.abierto === a.id) u.abierto = null;
  cerrarDoc(a.doc);
  pintarUnir();
}

function moverUnir(desde, hasta, foco = null) {
  if (hasta < 0 || hasta >= u.archivos.length || desde === hasta) return;
  const [a] = u.archivos.splice(desde, 1);
  u.archivos.splice(hasta, 0, a);
  pintarUnir(foco);
}

function textoArchivo(a) {
  if (!a.indices) return `${plural(a.info.paginas, "página", "páginas")}, ${tamanoHumano(a.info.bytes)}`;
  const n = a.indices.length;
  return n ? `${plural(n, "página", "páginas")} de ${a.info.paginas}: ${indicesARangos(a.indices)}` : `Ninguna página de ${a.info.paginas}`;
}

function tarjetaArchivo(a, i) {
  const t = nodo("div", `pv-tarjeta pv-color-${i % COLORES}`);
  t.dataset.id = String(a.id);
  t.draggable = true;
  t.tabIndex = 0;
  t.setAttribute("role", "listitem");
  t.setAttribute("aria-label", `${i + 1} de ${u.archivos.length}: ${a.info.nombre}, ${textoArchivo(a)}. Supr quita, Alt y flechas mueven.`);
  const marco = nodo("div", "pv-tarjeta-mini");
  marco.append(a.mini, nodo("span", "pv-orden", String(i + 1)));
  const nombre = nodo("p", "pv-tarjeta-nombre", a.info.nombre);
  nombre.title = a.ruta;
  const meta = nodo("p", "ayuda pv-tarjeta-meta", textoArchivo(a));
  const acciones = nodo("div", "pv-tarjeta-acciones");
  const antes = botonIcono("izquierda", "Mover antes", () => moverUnir(i, i - 1, { id: a.id, accion: "antes" }));
  antes.dataset.accion = "antes";
  antes.disabled = i === 0;
  const despues = botonIcono("derecha", "Mover después", () => moverUnir(i, i + 1, { id: a.id, accion: "despues" }));
  despues.dataset.accion = "despues";
  despues.disabled = i === u.archivos.length - 1;
  const paginas = botonIcono("paginas", "Elegir páginas", () => {
    u.abierto = u.abierto === a.id ? null : a.id;
    pintarUnir({ id: a.id, accion: "paginas" });
  });
  paginas.dataset.accion = "paginas";
  paginas.setAttribute("aria-expanded", String(u.abierto === a.id));
  const quitar = botonIcono("quitar", "Quitar de la unión", () => quitarUnir(a));
  acciones.append(antes, despues, paginas, quitar);
  t.append(marco, nombre, meta, acciones);
  if (u.abierto === a.id) t.classList.add("abierta");
  t.addEventListener("keydown", (e) => {
    if (e.target !== t) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      quitarUnir(a);
    } else if (e.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      moverUnir(i, e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : i + 1, { id: a.id });
    } else if (e.key === "Enter") {
      e.preventDefault();
      paginas.click();
    }
  });
  t.addEventListener("dragstart", (e) => {
    u.arrastre = i;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i));
    t.classList.add("arrastrando");
  });
  t.addEventListener("dragend", () => {
    u.arrastre = -1;
    pintarUnir();
  });
  t.addEventListener("dragover", (e) => {
    if (u.arrastre < 0 || u.arrastre === i) return;
    e.preventDefault();
    const r = t.getBoundingClientRect();
    const antesDe = e.clientX - r.left < r.width / 2;
    t.classList.toggle("destino-antes", antesDe);
    t.classList.toggle("destino-despues", !antesDe);
    t.dataset.lado = antesDe ? "antes" : "despues";
  });
  t.addEventListener("dragleave", () => t.classList.remove("destino-antes", "destino-despues"));
  t.addEventListener("drop", (e) => {
    if (u.arrastre < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const desde = u.arrastre;
    const lado = t.dataset.lado === "antes" ? 0 : 1;
    const destino = desde < i ? i - 1 + lado : i + lado;
    u.arrastre = -1;
    moverUnir(desde, Math.max(0, Math.min(u.archivos.length - 1, destino)), { id: u.archivos[desde].id });
  });
  return t;
}

async function elegirUnir() {
  const r = await window.vigencia.pdfElegir(true);
  if (r?.ok && r.rutas?.length) await agregarUnir(r.rutas);
}

function pintarUnir(foco = null) {
  const n = u.archivos.length;
  const total = totalUnir();
  $("pdf-unir-boton").disabled = n < 2 || !total;
  estado("pdf-unir-estado", n ? `${plural(n, "archivo", "archivos")}, ${plural(total, "página", "páginas")} en total.` : "");
  eu.barra.hidden = !n;
  if (!n) {
    tira?.vaciar();
    visorAbierto?.vaciar();
    eu.cuerpo.replaceChildren(zonaVacia({
      ilustracion: "unir",
      titulo: "Suelte aquí los PDF que va a unir",
      texto: "Verá cada archivo con su primera página. Ordénelos arrastrando y elija páginas si no las quiere todas.",
      boton: "Elegir PDF",
      alElegir: elegirUnir,
      alSoltar: agregarUnir,
    }));
    return;
  }
  eu.barra.replaceChildren(
    boton("Agregar PDF", "boton-linea", elegirUnir),
    boton("Quitar todos", "boton-texto", () => {
      for (const a of u.archivos) cerrarDoc(a.doc);
      u.archivos = [];
      u.abierto = null;
      eu.mostrarPie();
      pintarUnir();
    }),
    nodo("span", "ayuda pv-barra-resumen", n < 2 ? "Agregue al menos otro PDF." : `Quedan ${plural(total, "página", "páginas")} en un solo PDF.`),
  );
  const grid = nodo("div", "pv-tarjetas");
  grid.setAttribute("role", "list");
  grid.setAttribute("aria-label", "Archivos en el orden en que se unen");
  u.archivos.forEach((a, i) => grid.append(tarjetaArchivo(a, i)));
  const mas = nodo("button", "pv-tarjeta-agregar");
  mas.type = "button";
  mas.append(icono("mas"), nodo("span", "", "Agregar o soltar PDF"));
  mas.addEventListener("click", elegirUnir);
  grid.append(mas);
  const partes = [grid];
  const abierto = u.archivos.find((a) => a.id === u.abierto);
  if (abierto) partes.push(seccionAbierta(abierto));
  const tiraSec = nodo("section", "pv-tira-seccion");
  tiraSec.append(nodo("h3", "pv-subtitulo", "Así queda"));
  u.cajaTira = nodo("div", "pv-tira");
  u.cajaTira.setAttribute("aria-label", "Vista previa del orden final");
  tiraSec.append(u.cajaTira);
  partes.push(tiraSec);
  eu.cuerpo.replaceChildren(...partes);
  tira = crearVisor({
    caja: u.cajaTira, raiz: u.cajaTira, clase: "pv-lienzo", escala: escalaMiniatura(LADO_TIRA), maxMemoria: 4,
    etiqueta: (k, p) => `Página ${k} del resultado: ${p.archivo.info.nombre}, página ${p.numero}`,
    envolver: (c, k, p) => {
      const d = nodo("div", `pv-tira-celda pv-color-${u.archivos.indexOf(p.archivo) % COLORES}`);
      d.title = `${p.archivo.info.nombre}, página ${p.numero}`;
      const marco = nodo("span", "pv-tira-marco");
      marco.append(c);
      d.append(marco, nodo("span", "pv-tira-num", String(k)));
      return d;
    },
  });
  pintarTira();
  if (abierto) pintarAbierto();
  if (foco) {
    const t = eu.cuerpo.querySelector(`[data-id="${foco.id}"]`);
    const b = foco.accion ? t?.querySelector(`[data-accion="${foco.accion}"]`) : null;
    (b && !b.disabled ? b : t)?.focus();
  }
}

function pintarTira() {
  if (!tira || !u.cajaTira?.isConnected) return;
  const paginas = [];
  for (const a of u.archivos) {
    for (const i of elegidasDe(a)) {
      if (paginas.length >= MAX_TIRA) break;
      paginas.push({ ...a.info.detalle[i], doc: a.doc, numero: i + 1, archivo: a });
    }
  }
  tira.armar(null, paginas);
  if (totalUnir() > MAX_TIRA) u.cajaTira.append(nodo("p", "ayuda pv-tira-mas", `y ${totalUnir() - MAX_TIRA} más`));
}

function seccionAbierta(a) {
  const sec = nodo("section", "pv-abierto");
  sec.setAttribute("aria-label", `Páginas de ${a.info.nombre}`);
  const cabeza = nodo("div", "pv-abierto-cabeza");
  cabeza.append(nodo("h3", "pv-subtitulo", `Páginas de ${a.info.nombre}`));
  const { l, campo } = campoRangos("Páginas", (texto) => {
    if (!texto.trim()) return;
    const r = parsearRangos(texto, a.info.paginas);
    campo.classList.toggle("error", Boolean(r.error));
    if (r.error) return;
    a.indices = r.indices.length === a.info.paginas ? null : r.indices;
    refrescarUnir(a);
  });
  campo.value = indicesARangos(elegidasDe(a));
  u.campoAbierto = campo;
  cabeza.append(l,
    boton("Todas", "boton-texto", () => {
      a.indices = null;
      refrescarUnir(a);
    }),
    boton("Ninguna", "boton-texto", () => {
      a.indices = [];
      refrescarUnir(a);
    }),
    boton("Listo", "boton-linea", () => {
      u.abierto = null;
      pintarUnir({ id: a.id, accion: "paginas" });
    }));
  sec.append(cabeza, nodo("p", "ayuda", "Toque una página para dejarla o sacarla; con Mayúscula elige un tramo."));
  u.cajaAbierto = nodo("div", "pv-rejilla");
  sec.append(u.cajaAbierto);
  return sec;
}

function pintarAbierto() {
  const a = u.archivos.find((x) => x.id === u.abierto);
  if (!a || !u.cajaAbierto?.isConnected) return;
  if (!a.doc) {
    u.cajaAbierto.replaceChildren(nodo("p", "ayuda", "Abriendo el PDF."));
    return;
  }
  let ultimo = null;
  visorAbierto = rejilla(u.cajaAbierto, (c, n) => celdaMini(c, n, {
    pulsada: elegidasDe(a).includes(n - 1),
    etiqueta: `Página ${n}`,
    alPulsar: (e) => {
      const set = new Set(elegidasDe(a));
      alternarEleccion(set, n - 1, e.shiftKey, ultimo);
      ultimo = n - 1;
      const lista = [...set].sort((x, y) => x - y);
      a.indices = lista.length === a.info.paginas ? null : lista;
      refrescarUnir(a);
    },
  }), 104);
  visorAbierto.armar(a.doc, a.info.detalle);
  refrescarUnir(a);
}

// Tras elegir páginas: sin rehacer las tarjetas (las miniaturas quedan).
function refrescarUnir(a) {
  const elegidas = new Set(elegidasDe(a));
  u.cajaAbierto?.querySelectorAll(".pv-mini").forEach((m, i) => {
    m.setAttribute("aria-pressed", String(elegidas.has(i)));
  });
  if (u.campoAbierto && document.activeElement !== u.campoAbierto) u.campoAbierto.value = indicesARangos([...elegidas]);
  const meta = eu.cuerpo.querySelector(`[data-id="${a.id}"] .pv-tarjeta-meta`);
  if (meta) meta.textContent = textoArchivo(a);
  const total = totalUnir();
  $("pdf-unir-boton").disabled = u.archivos.length < 2 || !total;
  estado("pdf-unir-estado", `${plural(u.archivos.length, "archivo", "archivos")}, ${plural(total, "página", "páginas")} en total.`);
  const resumen = eu.barra.querySelector(".pv-barra-resumen");
  if (resumen && u.archivos.length > 1) resumen.textContent = `Quedan ${plural(total, "página", "páginas")} en un solo PDF.`;
  pintarTira();
}

async function unir() {
  const total = totalUnir();
  const n = u.archivos.length;
  await correr(eu, "pdf-unir-estado", "Uniendo los PDF en este computador.", async () => {
    const r = await window.vigencia.pdfUnir(null, u.archivos.map((a) => ({ ruta: a.ruta, indices: a.indices ?? undefined })));
    terminar(eu, "pdf-unir-estado", r, { titulo: "PDF unido", detalle: `${plural(total, "página", "páginas")} de ${plural(n, "archivo", "archivos")}.`, aviso: "PDF unido y guardado.", error: "No pude unirlos." });
  });
}

// ---------- Separar ----------

const s = { info: null, archivo: docUnico(), modo: "cortar", cortes: [], elegidas: new Set(), ultimo: null };
let es = null;
let visorS = null;

async function abrirSeparar(info) {
  Object.assign(s, { info, cortes: [], elegidas: new Set(), ultimo: null });
  es.mostrarPie();
  pintarSeparar();
  if (!info) return;
  try {
    const doc = await s.archivo.abrir(pdf.separar);
    if (doc && s.info === info) visorS.armar(doc, info.detalle);
    actualizarSeparar();
  } catch (error) {
    estado("pdf-separar-estado", error?.message || "No pude abrir el PDF.", true);
  }
}

function pintarSeparar() {
  es.barra.hidden = !s.info;
  if (!s.info) {
    visorS?.vaciar();
    es.cuerpo.replaceChildren(zonaVacia({
      ilustracion: "separar",
      titulo: "Elija el PDF que va a separar",
      texto: "Verá todas sus páginas: córtelo en partes con las tijeras o saque solo las que necesite.",
      alElegir: () => elegirUno("separar"),
      alSoltar: (rutas) => ponerUno("separar", rutas[0]),
    }));
    return;
  }
  const total = s.info.paginas;
  const modo = nodo("div", "pv-segmentos");
  modo.setAttribute("role", "group");
  modo.setAttribute("aria-label", "Cómo separar");
  for (const [id, texto] of [["cortar", "Cortar en partes"], ["sacar", "Sacar páginas"]]) {
    const b = boton(texto, "pv-segmento", () => {
      s.modo = id;
      es.mostrarPie();
      pintarBarraSeparar();
      actualizarSeparar();
    });
    b.dataset.modo = id;
    modo.append(b);
  }
  s.barraModo = modo;
  s.barraExtra = nodo("div", "pv-barra-grupo");
  es.barra.replaceChildren(modo, s.barraExtra);
  s.resumen = nodo("div", "pv-resumen");
  s.resumen.setAttribute("aria-live", "polite");
  const caja = nodo("div", "pv-rejilla pv-rejilla-separar");
  es.cuerpo.replaceChildren(s.resumen, caja);
  visorS = rejilla(caja, (c, n) => {
    const celda = celdaMini(c, n, {
      etiqueta: `Página ${n}`,
      alPulsar: (e) => {
        if (s.modo !== "sacar") return;
        alternarEleccion(s.elegidas, n - 1, e.shiftKey, s.ultimo);
        s.ultimo = n - 1;
        actualizarSeparar();
      },
    });
    if (n < total) {
      const corte = botonIcono("tijera", `Cortar después de la página ${n}`, () => {
        s.cortes = alternarCorte(s.cortes, n, total);
        actualizarSeparar();
      }, "pv-corte");
      corte.dataset.despues = String(n);
      celda.append(corte);
    }
    return celda;
  });
  pintarBarraSeparar();
}

function pintarBarraSeparar() {
  for (const b of s.barraModo.children) b.setAttribute("aria-pressed", String(b.dataset.modo === s.modo));
  const total = s.info.paginas;
  if (s.modo === "cortar") {
    const l = nodo("label", "pv-cada");
    l.append(nodo("span", "", "Cortar cada"));
    const cada = document.createElement("input");
    cada.type = "number";
    cada.min = "1";
    cada.max = String(Math.max(1, total - 1));
    cada.value = "1";
    cada.setAttribute("aria-label", "Cada cuántas páginas cortar");
    l.append(cada, nodo("span", "", "páginas"));
    s.barraExtra.replaceChildren(l,
      boton("Cortar", "boton-linea", () => {
        s.cortes = cortesCada(total, cada.value);
        actualizarSeparar();
      }),
      boton("Quitar cortes", "boton-texto", () => {
        s.cortes = [];
        actualizarSeparar();
      }));
  } else {
    const { l, campo } = campoRangos("Páginas", (texto) => {
      if (!texto.trim()) {
        s.elegidas = new Set();
        actualizarSeparar();
        return;
      }
      const r = parsearRangos(texto, total);
      campo.classList.toggle("error", Boolean(r.error));
      estado("pdf-separar-estado", r.error || "", Boolean(r.error));
      if (r.error) return;
      s.elegidas = new Set(r.indices);
      actualizarSeparar();
    });
    s.campo = campo;
    s.barraExtra.replaceChildren(l,
      boton("Todas", "boton-texto", () => {
        s.elegidas = new Set(todas(total));
        actualizarSeparar();
      }),
      boton("Ninguna", "boton-texto", () => {
        s.elegidas = new Set();
        actualizarSeparar();
      }));
  }
}

function actualizarSeparar() {
  if (!s.info || !visorS) return;
  const total = s.info.paginas;
  const cortar = s.modo === "cortar";
  const partes = cortesAPartes(total, s.cortes);
  const parteDe = parteDeCadaPagina(partes);
  es.cuerpo.querySelector(".pv-rejilla")?.classList.toggle("modo-sacar", !cortar);
  visorS.lienzos.forEach((c, i) => {
    const celda = c.closest(".pv-celda");
    const mini = celda.querySelector(".pv-mini");
    for (let k = 0; k < COLORES; k++) mini.classList.remove(`pv-color-${k}`);
    if (cortar) {
      mini.classList.add(`pv-color-${parteDe[i] % COLORES}`);
      mini.removeAttribute("aria-pressed");
      mini.setAttribute("aria-label", `Página ${i + 1}, parte ${parteDe[i] + 1}`);
    } else {
      mini.setAttribute("aria-pressed", String(s.elegidas.has(i)));
      mini.setAttribute("aria-label", `Página ${i + 1}`);
    }
    const corte = celda.querySelector(".pv-corte");
    if (corte) {
      corte.hidden = !cortar;
      corte.setAttribute("aria-pressed", String(s.cortes.includes(i + 1)));
    }
  });
  const elegidas = [...s.elegidas].sort((a, b) => a - b);
  if (!cortar && s.campo && document.activeElement !== s.campo) s.campo.value = indicesARangos(elegidas);
  s.resumen.replaceChildren();
  if (cortar) {
    if (partes.length < 2) {
      s.resumen.append(nodo("p", "ayuda", "Toque las tijeras entre dos páginas para cortar ahí. Cada parte sale en un PDF aparte."));
    } else {
      s.resumen.append(nodo("p", "pv-resumen-titulo", `Salen ${partes.length} PDF:`));
      const lista = nodo("ul", "pv-partes");
      partes.forEach((p, k) => {
        const li = nodo("li", `pv-parte pv-color-${k % COLORES}`);
        li.append(nodo("span", "pv-parte-punto"), nodo("span", "", `Parte ${k + 1}: ${p.desde === p.hasta ? `página ${p.desde}` : `páginas ${p.desde} a ${p.hasta}`} (${plural(p.indices.length, "página", "páginas")})`));
        lista.append(li);
      });
      s.resumen.append(lista);
    }
    $("pdf-separar-boton").disabled = partes.length < 2;
  } else {
    s.resumen.append(nodo("p", elegidas.length ? "pv-resumen-titulo" : "ayuda", elegidas.length
      ? `Sale un PDF nuevo con ${plural(elegidas.length, "página", "páginas")}: ${indicesARangos(elegidas)}.`
      : "Toque las páginas que quiere sacar a un PDF nuevo, o escríbalas arriba."));
    $("pdf-separar-boton").disabled = !elegidas.length;
  }
}

async function separar() {
  const partes = s.modo === "cortar"
    ? cortesAPartes(s.info.paginas, s.cortes).map((p) => p.indices)
    : [[...s.elegidas].sort((a, b) => a - b)];
  await correr(es, "pdf-separar-estado", "Separando las páginas.", async () => {
    const r = await window.vigencia.pdfSeparar(pdf.separar, "", partes);
    terminar(es, "pdf-separar-estado", r, {
      titulo: partes.length > 1 ? `${partes.length} PDF guardados` : "PDF guardado",
      detalle: (x) => (x.carpeta ? `En ${x.carpeta}.` : `${plural(partes[0].length, "página", "páginas")}: ${indicesARangos(partes[0])}.`),
      aviso: partes.length > 1 ? "Partes guardadas." : "Páginas separadas y guardadas.",
      error: "No pude separar.",
    });
  });
}

// ---------- Girar ----------

const g = { info: null, archivo: docUnico(), giros: {}, elegidas: new Set(), historia: [], ultimo: null };
let eg = null;
let visorG = null;

async function abrirGirar(info) {
  Object.assign(g, { info, giros: {}, elegidas: new Set(), historia: [], ultimo: null });
  eg.mostrarPie();
  pintarGirar();
  if (!info) return;
  try {
    const doc = await g.archivo.abrir(pdf.rotar);
    if (doc && g.info === info) visorG.armar(doc, info.detalle);
    actualizarGirar();
  } catch (error) {
    estado("pdf-rotar-estado", error?.message || "No pude abrir el PDF.", true);
  }
}

function girar(indices, delta) {
  if (!indices.length) return;
  g.historia.push(g.giros);
  if (g.historia.length > 50) g.historia.shift();
  g.giros = girarPaginas(g.giros, indices, delta);
  actualizarGirar();
}

const GIRO_TEXTO = { 90: "90 a la derecha", 180: "180 grados", 270: "90 a la izquierda" };

const objetivo = () => (g.elegidas.size ? [...g.elegidas] : todas(g.info.paginas));

function pintarGirar() {
  eg.barra.hidden = !g.info;
  if (!g.info) {
    visorG?.vaciar();
    eg.cuerpo.replaceChildren(zonaVacia({
      ilustracion: "rotar",
      titulo: "Elija el PDF que va a enderezar",
      texto: "Gire cada página con sus botones, o elija varias y gírelas juntas. Se ve al instante.",
      alElegir: () => elegirUno("rotar"),
      alSoltar: (rutas) => ponerUno("rotar", rutas[0]),
    }));
    return;
  }
  g.botonIzq = nodo("button", "boton-linea pv-con-icono");
  g.botonIzq.type = "button";
  g.botonIzq.addEventListener("click", () => girar(objetivo(), -90));
  g.botonDer = nodo("button", "boton-linea pv-con-icono");
  g.botonDer.type = "button";
  g.botonDer.addEventListener("click", () => girar(objetivo(), 90));
  g.deshacer = boton("Deshacer", "boton-texto", () => {
    if (!g.historia.length) return;
    g.giros = g.historia.pop();
    actualizarGirar();
  });
  g.limpiar = boton("Quitar giros", "boton-texto", () => {
    g.historia.push(g.giros);
    g.giros = {};
    actualizarGirar();
  });
  g.resumen = nodo("span", "ayuda pv-barra-resumen");
  eg.barra.replaceChildren(
    boton("Elegir todas", "boton-texto", () => {
      g.elegidas = new Set(todas(g.info.paginas));
      actualizarGirar();
    }),
    boton("Ninguna", "boton-texto", () => {
      g.elegidas = new Set();
      actualizarGirar();
    }),
    g.botonIzq, g.botonDer, g.deshacer, g.limpiar, g.resumen,
  );
  const caja = nodo("div", "pv-rejilla pv-rejilla-girar");
  eg.cuerpo.replaceChildren(caja);
  visorG = rejilla(caja, (c, n) => {
    const celda = celdaMini(c, n, {
      pulsada: false,
      alPulsar: (e) => {
        alternarEleccion(g.elegidas, n - 1, e.shiftKey, g.ultimo);
        g.ultimo = n - 1;
        actualizarGirar();
      },
    });
    const mini = celda.querySelector(".pv-mini");
    mini.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() !== "r" || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      girar([n - 1], e.shiftKey ? -90 : 90);
    });
    mini.append(nodo("span", "pv-giro-badge"));
    const fila = nodo("div", "pv-celda-acciones");
    fila.append(
      botonIcono("girar-izq", `Girar la página ${n} a la izquierda`, () => girar([n - 1], -90)),
      botonIcono("girar-der", `Girar la página ${n} a la derecha`, () => girar([n - 1], 90)),
    );
    celda.append(fila);
    return celda;
  });
}

function actualizarGirar() {
  if (!g.info || !visorG) return;
  visorG.lienzos.forEach((c, i) => {
    const mini = c.closest(".pv-mini");
    const marco = c.parentElement;
    const giro = g.giros[i] || 0;
    for (const k of [0, 90, 180, 270]) marco.classList.toggle(`pv-giro-${k}`, k === giro);
    mini.setAttribute("aria-pressed", String(g.elegidas.has(i)));
    mini.setAttribute("aria-label", `Página ${i + 1}${giro ? `, girada ${GIRO_TEXTO[giro]}` : ""}. Tecla R: girar a la derecha; Mayúscula y R: al otro lado.`);
    const badge = mini.querySelector(".pv-giro-badge");
    badge.textContent = giro ? GIRO_TEXTO[giro] : "";
    badge.hidden = !giro;
  });
  const cuantas = g.elegidas.size;
  const sufijo = cuantas ? ` ${plural(cuantas, "elegida", "elegidas")}` : " todas";
  g.botonIzq.replaceChildren(icono("girar-izq"), nodo("span", "", `Izquierda,${sufijo}`));
  g.botonDer.replaceChildren(icono("girar-der"), nodo("span", "", `Derecha,${sufijo}`));
  g.deshacer.disabled = !g.historia.length;
  const giradas = cuantasGiradas(g.giros);
  g.limpiar.disabled = !giradas;
  g.resumen.textContent = giradas ? `${plural(giradas, "página girada", "páginas giradas")} de ${g.info.paginas}.` : "Ninguna página girada todavía.";
  $("pdf-rotar-boton").disabled = !giradas;
}

async function rotar() {
  const giradas = cuantasGiradas(g.giros);
  await correr(eg, "pdf-rotar-estado", "Girando las páginas.", async () => {
    const r = await window.vigencia.pdfRotar(pdf.rotar, "", 0, g.giros);
    terminar(eg, "pdf-rotar-estado", r, { titulo: "PDF girado", detalle: `${plural(giradas, "página girada", "páginas giradas")}.`, aviso: "PDF girado y guardado.", error: "No pude girar." });
  });
}

// ---------- Arranque ----------

export function iniciarPaginasPdf() {
  eu = crearEscena("unir", { titulo: "Unir", ayuda: "Junta varios PDF en uno, en el orden de las tarjetas.", alSoltar: agregarUnir });
  es = crearEscena("separar", { titulo: "Separar", ayuda: "Corta el PDF en partes o saca unas páginas a un PDF nuevo. El original no cambia.", alSoltar: (r) => ponerUno("separar", r[0]) });
  eg = crearEscena("rotar", { titulo: "Girar", ayuda: "Endereza páginas: cada una con sus botones o varias a la vez.", alSoltar: (r) => ponerUno("rotar", r[0]) });
  alAbrir.separar = abrirSeparar;
  alAbrir.rotar = abrirGirar;
  $("pdf-elegir-unir").addEventListener("click", elegirUnir);
  $("pdf-unir-limpiar").addEventListener("click", () => {
    for (const a of u.archivos) cerrarDoc(a.doc);
    u.archivos = [];
    u.abierto = null;
    eu.mostrarPie();
    pintarUnir();
  });
  $("pdf-unir-boton").addEventListener("click", unir);
  $("pdf-separar-boton").addEventListener("click", separar);
  $("pdf-rotar-boton").addEventListener("click", rotar);
  eg.raiz.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && g.historia.length && e.target.tagName !== "INPUT") {
      e.preventDefault();
      g.giros = g.historia.pop();
      actualizarGirar();
    }
  });
  pintarUnir();
  pintarSeparar();
  pintarGirar();
  $("pdf-separar-boton").disabled = true;
  $("pdf-rotar-boton").disabled = true;
}
