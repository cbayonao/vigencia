// Comparar: los dos PDF lado a lado con el visor de páginas (se mueven
// juntos) y abajo los cambios, con la diferencia por párrafo de Documentos
// (compartido/documentos.js) ubicada en su página (compartido/pdfvisual.js).
import { cambiosPorPagina, diferenciaPalabras } from "../compartido/pdfvisual.js";
import { avisar } from "./aviso.js";
import { boton, correr, crearEscena, ilustracion, soltable } from "./escena.js";
import { crearVisor, docUnico } from "./paginas.js";
import { estado, nodo, nombreCorto, ofrecerLlevar, pdf } from "./pdf.js";

const $ = (id) => document.getElementById(id);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const TIPO = { agregado: "Agregado", quitado: "Quitado", cambiado: "Cambiado" };

const lados = {
  a: { titulo: "Primera versión", info: null, archivo: docUnico(), vista: null },
  b: { titulo: "Segunda versión", info: null, archivo: docUnico(), vista: null },
};
const k = { resultado: null, juntas: true, moviendo: false };
let ek = null;

export async function ponerComparar(cual, ruta) {
  if (!ruta) return;
  const info = await window.vigencia.pdfInfo(ruta);
  if (!info?.ok) {
    estado("pdf-comparar-estado", info?.error || "No pude leer ese PDF.", true);
    avisar(info?.error || "No pude leer ese PDF.", "error");
    return;
  }
  ofrecerLlevar(ruta);
  pdf[cual === "a" ? "compararA" : "compararB"] = ruta;
  $(`pdf-comparar-nombre-${cual}`).textContent = `${cual === "a" ? "Primero" : "Segundo"}: ${nombreCorto(ruta)}.`;
  estado("pdf-comparar-estado", "");
  lados[cual].info = info;
  k.resultado = null;
  ek.mostrarPie();
  pintarComparar();
}

async function elegirComparar(cual) {
  const r = await window.vigencia.pdfElegir(false);
  if (r?.ok && r.rutas?.length) await ponerComparar(cual, r.rutas[0]);
}

function ranura(cual) {
  const lado = lados[cual];
  const caja = nodo("div", "pv-ranura");
  caja.tabIndex = 0;
  caja.setAttribute("role", "button");
  caja.setAttribute("aria-label", `${lado.titulo}: elegir o soltar el PDF`);
  caja.append(ilustracion("comparar"), nodo("p", "pv-vacia-titulo", lado.titulo), nodo("p", "ayuda", "Suéltelo aquí o toque para elegirlo."), nodo("span", "boton-cobre pv-vacia-boton", "Elegir PDF"));
  caja.addEventListener("click", () => elegirComparar(cual));
  caja.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      elegirComparar(cual);
    }
  });
  soltable(caja, (rutas) => ponerComparar(cual, rutas[0]));
  return caja;
}

function columna(cual) {
  const lado = lados[cual];
  const col = nodo("section", "pv-columna");
  col.setAttribute("aria-label", lado.titulo);
  if (!lado.info) {
    col.append(ranura(cual));
    lado.vista?.vaciar();
    lado.vista = null;
    return col;
  }
  const cabeza = nodo("div", "pv-columna-cabeza");
  const textos = nodo("div", "");
  textos.append(nodo("p", "pv-archivo-nombre", lado.info.nombre), nodo("p", "ayuda", `${lado.titulo}, ${plural(lado.info.paginas, "página", "páginas")}`));
  cabeza.append(textos, boton("Cambiar", "boton-texto", () => elegirComparar(cual)));
  const paginas = nodo("div", "pv-paginas pv-paginas-comparar");
  soltable(col, (rutas) => ponerComparar(cual, rutas[0]));
  col.append(cabeza, paginas);
  lado.vista = crearVisor({
    caja: paginas,
    clase: "pv-pagina",
    etiqueta: (n) => `${lado.titulo}, página ${n}`,
    envolver: (canvas, n) => {
      const env = nodo("div", "pv-pagina-envoltura");
      env.dataset.pagina = String(n);
      const marca = nodo("span", "pv-pagina-marca");
      marca.hidden = true;
      env.append(canvas, marca);
      return env;
    },
  });
  paginas.addEventListener("scroll", () => moverJuntas(cual), { passive: true });
  lado.archivo.abrir(pdf[cual === "a" ? "compararA" : "compararB"]).then((doc) => {
    if (!doc || !lado.vista) return;
    lado.vista.paginas = lado.info.detalle;
    lado.vista.zoom = lado.vista.zoomAncho(0.3, 1.4, 36);
    lado.vista.armar(doc, lado.info.detalle);
    pintarMarcas();
  }).catch((error) => estado("pdf-comparar-estado", error?.message || "No pude abrir el PDF.", true));
  return col;
}

// Se mueven juntas por página: la otra columna va a la misma página y al
// mismo punto dentro de ella, aunque tengan tamaños distintos.
function moverJuntas(desde) {
  if (!k.juntas || k.moviendo) return;
  const origen = lados[desde].vista;
  const destino = lados[desde === "a" ? "b" : "a"].vista;
  if (!origen?.lienzos.length || !destino?.lienzos.length) return;
  const caja = origen.lienzos[0].closest(".pv-paginas");
  const otra = destino.lienzos[0].closest(".pv-paginas");
  const arriba = caja.getBoundingClientRect().top;
  let i = 0;
  origen.lienzos.forEach((c, j) => {
    if (c.getBoundingClientRect().top - arriba <= 1) i = j;
  });
  const c = origen.lienzos[i];
  const r = c.getBoundingClientRect();
  const fraccion = Math.min(1, Math.max(0, (arriba - r.top) / Math.max(1, r.height)));
  const d = destino.lienzos[Math.min(i, destino.lienzos.length - 1)];
  const rd = d.getBoundingClientRect();
  k.moviendo = true;
  otra.scrollTop += rd.top - otra.getBoundingClientRect().top + fraccion * rd.height;
  requestAnimationFrame(() => {
    k.moviendo = false;
  });
}

function irAPaginas(paginaA, paginaB) {
  const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;
  k.moviendo = true;
  if (paginaA) lados.a.vista?.irA(paginaA, !quieto);
  if (paginaB) lados.b.vista?.irA(paginaB, !quieto);
  setTimeout(() => {
    k.moviendo = false;
  }, quieto ? 50 : 600);
}

function pintarMarcas() {
  for (const [cual, por] of [["a", k.resultado?.porA], ["b", k.resultado?.porB]]) {
    const v = lados[cual].vista;
    if (!v) continue;
    v.lienzos.forEach((c, i) => {
      const env = c.parentElement;
      const n = por?.[i + 1] || 0;
      env.classList.toggle("con-cambios", n > 0);
      const marca = env.querySelector(".pv-pagina-marca");
      marca.textContent = n ? plural(n, "cambio", "cambios") : "";
      marca.hidden = !n;
    });
  }
}

function pintarComparar() {
  const listos = lados.a.info && lados.b.info;
  $("pdf-comparar-boton").disabled = !listos;
  ek.barra.hidden = !listos;
  if (listos) {
    const juntas = document.createElement("input");
    juntas.type = "checkbox";
    juntas.checked = k.juntas;
    juntas.addEventListener("change", () => {
      k.juntas = juntas.checked;
    });
    const l = nodo("label", "casilla");
    l.append(juntas, nodo("span", "", "Mover las dos juntas"));
    ek.barra.replaceChildren(boton("Comparar", "boton-cobre", comparar), l,
      boton("Cambiar el orden", "boton-texto", () => {
        [pdf.compararA, pdf.compararB] = [pdf.compararB, pdf.compararA];
        [lados.a.info, lados.b.info] = [lados.b.info, lados.a.info];
        $("pdf-comparar-nombre-a").textContent = `Primero: ${nombreCorto(pdf.compararA)}.`;
        $("pdf-comparar-nombre-b").textContent = `Segundo: ${nombreCorto(pdf.compararB)}.`;
        k.resultado = null;
        pintarComparar();
      }));
  }
  const dos = nodo("div", "pv-comparar-dos");
  dos.append(columna("a"), columna("b"));
  const partes = [dos];
  if (k.resultado) partes.push(panelCambios());
  else if (listos) partes.push(nodo("p", "ayuda pv-comparar-pista", "Pulse Comparar para ver qué se agregó, cambió o quitó."));
  ek.cuerpo.replaceChildren(...partes);
}

function tramos(antes, despues) {
  const p = nodo("p", "pv-cambio-texto");
  for (const t of diferenciaPalabras(antes, despues)) {
    if (t.tipo === "igual") p.append(document.createTextNode(t.texto));
    else p.append(nodo(t.tipo === "agregado" ? "ins" : "del", t.tipo === "agregado" ? "doc-dif-agregado" : "doc-dif-quitado", t.texto));
  }
  return p;
}

function panelCambios() {
  const { cambios, cuenta, porA, porB } = k.resultado;
  const panel = nodo("section", "pv-cambios");
  panel.setAttribute("aria-label", "Cambios");
  const cabeza = nodo("div", "pv-cambios-cabeza");
  cabeza.append(nodo("h3", "pv-subtitulo", cambios.length ? `${plural(cambios.length, "cambio", "cambios")} del primero al segundo` : "Dicen lo mismo"));
  const cifras = nodo("div", "pv-cifras");
  cifras.append(
    nodo("span", "pv-cifra agregado", plural(cuenta.agregado, "agregado", "agregados")),
    nodo("span", "pv-cifra cambiado", plural(cuenta.cambiado, "cambiado", "cambiados")),
    nodo("span", "pv-cifra quitado", plural(cuenta.quitado, "quitado", "quitados")),
  );
  cabeza.append(cifras);
  panel.append(cabeza);
  const paginas = Object.keys(porB).map(Number).sort((x, y) => x - y);
  if (paginas.length) {
    const chips = nodo("div", "pv-chips");
    chips.setAttribute("aria-label", "Páginas del segundo con cambios");
    for (const n of paginas) chips.append(boton(`Página ${n}: ${porB[n]}`, "pv-chip", () => irAPaginas(null, n)));
    const soloA = Object.keys(porA).map(Number).filter((n) => !porB[n]);
    for (const n of soloA) chips.append(boton(`Página ${n} del primero: ${porA[n]}`, "pv-chip", () => irAPaginas(n, null)));
    panel.append(chips);
  }
  const lista = nodo("ol", "pv-lista-cambios");
  for (const c of cambios) {
    const li = nodo("li", `pv-cambio ${c.tipo}`);
    const b = nodo("button", "pv-cambio-boton");
    b.type = "button";
    const donde = [c.paginaA ? `página ${c.paginaA} del primero` : "", c.paginaB ? `página ${c.paginaB} del segundo` : ""].filter(Boolean).join(", ");
    const cab = nodo("span", "pv-cambio-cabeza");
    cab.append(nodo("span", `pv-cambio-tipo ${c.tipo}`, TIPO[c.tipo]), nodo("span", "ayuda", donde ? `En ${donde}` : ""));
    b.append(cab);
    if (c.tipo === "cambiado") b.append(tramos(c.antes, c.texto));
    else b.append(nodo("p", `pv-cambio-texto ${c.tipo === "agregado" ? "doc-dif-agregado" : "doc-dif-quitado"}`, c.texto));
    b.addEventListener("click", () => irAPaginas(c.paginaA, c.paginaB));
    li.append(b);
    lista.append(li);
  }
  if (cambios.length) panel.append(lista);
  return panel;
}

async function comparar() {
  await correr(ek, "pdf-comparar-estado", "Leyendo y comparando los dos PDF.", async () => {
    const r = await window.vigencia.pdfComparar(pdf.compararA, pdf.compararB);
    if (!r?.ok) {
      estado("pdf-comparar-estado", r?.error || "No pude comparar.", true);
      avisar(r?.error || "No pude comparar.", "error");
      return;
    }
    k.resultado = cambiosPorPagina(r.textoA || "", r.textoB || "");
    const viejo = ek.cuerpo.querySelector(".pv-cambios, .pv-comparar-pista");
    const panel = panelCambios();
    if (viejo) viejo.replaceWith(panel);
    else ek.cuerpo.append(panel);
    pintarMarcas();
    estado("pdf-comparar-estado", "");
    avisar("Comparación lista.");
  });
}

export function iniciarCompararPdf() {
  ek = crearEscena("comparar", { titulo: "Comparar", ayuda: "Dos versiones lado a lado: qué se agregó, cambió o quitó, y en qué página.", llena: true });
  $("pdf-elegir-comparar-a").addEventListener("click", () => elegirComparar("a"));
  $("pdf-elegir-comparar-b").addEventListener("click", () => elegirComparar("b"));
  $("pdf-comparar-boton").addEventListener("click", comparar);
  pintarComparar();
}
