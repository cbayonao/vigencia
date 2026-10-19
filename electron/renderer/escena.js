// Piezas comunes de la vista de cada herramienta PDF (lado derecho): la
// escena con su ayuda de una línea, el vacío con zona para soltar e
// ilustración, el progreso y la tarjeta de resultado con Abrir, Mostrar en
// carpeta y Usar con la IA. Las ilustraciones son SVG fijos de este archivo
// (sin estilos en línea: los colores salen de clases y del tema).
import { avisar } from "./aviso.js";
import { estado, nodo, ocupado, ofrecerLlevar } from "./pdf.js";

const $ = (id) => document.getElementById(id);

const HOJA = '<rect class="pv-papel" x="50" y="14" width="60" height="80" rx="6"/><path class="pv-renglon" d="M60 32h40M60 42h40M60 52h28M60 62h36"/>';
const SVG = {
  unir: '<rect class="pv-papel" x="14" y="22" width="44" height="58" rx="5"/><path class="pv-renglon" d="M22 36h28M22 45h28M22 54h18"/><rect class="pv-papel" x="102" y="22" width="44" height="58" rx="5"/><path class="pv-renglon" d="M110 36h28M110 45h28M110 54h18"/><path class="pv-acento-linea" d="M62 51h12M98 51H86"/><rect class="pv-papel pv-destacada" x="66" y="58" width="28" height="40" rx="4"/><circle class="pv-acento" cx="80" cy="50" r="9"/><path class="pv-sobre-acento" d="M80 45v10M75 50h10"/>',
  separar: '<rect class="pv-papel" x="44" y="10" width="72" height="44" rx="5"/><path class="pv-renglon" d="M54 24h52M54 34h40"/><rect class="pv-papel pv-destacada" x="44" y="66" width="72" height="44" rx="5"/><path class="pv-renglon" d="M54 80h52M54 90h34"/><path class="pv-corte-linea" d="M24 60h112"/><g class="pv-tijera"><circle class="pv-acento-linea" cx="18" cy="54" r="5"/><circle class="pv-acento-linea" cx="18" cy="66" r="5"/><path class="pv-acento-linea" d="M22 57l14 6M22 63l14-6"/></g>',
  rotar: '<g class="pv-inclinada">' + HOJA + '</g><path class="pv-acento-linea pv-flecha" d="M126 60a46 46 0 0 1-46 46"/><path class="pv-acento pv-punta" d="M80 99l-9 7 9 7z"/><path class="pv-acento-linea pv-flecha" d="M34 60a46 46 0 0 1 46-46"/><path class="pv-acento pv-punta" d="M80 7l9 7-9 7z"/>',
  comprimir: HOJA + '<path class="pv-acento-linea" d="M18 54h20M32 46l8 8-8 8M142 54h-20M128 46l-8 8 8 8"/><rect class="pv-acento" x="64" y="76" width="32" height="10" rx="5"/>',
  proteger: HOJA + '<g class="pv-candado"><path class="pv-arco" d="M100 70v-10a12 12 0 0 1 24 0v10"/><rect class="pv-acento" x="94" y="68" width="36" height="30" rx="6"/><circle class="pv-sobre-acento-relleno" cx="112" cy="81" r="4"/><path class="pv-sobre-acento" d="M112 84v6"/></g>',
  desbloquear: HOJA + '<g class="pv-candado"><path class="pv-arco" d="M100 70v-10a12 12 0 0 1 24 0v10"/><rect class="pv-acento" x="94" y="68" width="36" height="30" rx="6"/><circle class="pv-sobre-acento-relleno" cx="112" cy="81" r="4"/><path class="pv-sobre-acento" d="M112 84v6"/></g>',
  rellenar: '<rect class="pv-papel" x="40" y="12" width="72" height="92" rx="6"/><rect class="pv-campo-ilu" x="50" y="26" width="52" height="11" rx="2"/><rect class="pv-campo-ilu" x="50" y="46" width="52" height="11" rx="2"/><rect class="pv-campo-ilu pv-campo-activo" x="50" y="66" width="34" height="11" rx="2"/><rect class="pv-campo-ilu" x="50" y="86" width="9" height="9" rx="2"/><path class="pv-acento-linea" d="M52 90l3 3 5-6"/><g class="pv-lapiz"><path class="pv-acento" d="M118 54l10 10-28 28-12 2 2-12z"/></g>',
  comparar: '<rect class="pv-papel" x="16" y="16" width="58" height="80" rx="5"/><rect class="pv-papel" x="86" y="16" width="58" height="80" rx="5"/><path class="pv-renglon" d="M26 32h38M26 62h38M96 32h38M96 62h38"/><rect class="pv-quitado-ilu" x="24" y="42" width="42" height="9" rx="2"/><rect class="pv-agregado-ilu" x="94" y="42" width="42" height="9" rx="2"/><rect class="pv-agregado-ilu" x="94" y="72" width="30" height="9" rx="2"/>',
  listo: '<circle class="pv-acento" cx="12" cy="12" r="11"/><path class="pv-sobre-acento" d="M7 12.5l3.2 3.2L17 9"/>',
};

const ICONOS = {
  izquierda: '<path d="M15 6l-6 6 6 6"/>',
  derecha: '<path d="M9 6l6 6-6 6"/>',
  quitar: '<path d="M6 6l12 12M18 6L6 18"/>',
  "girar-izq": '<path d="M4 4v6h6"/><path d="M5 15a8 8 0 1 0 2-8.5L4 10"/>',
  "girar-der": '<path d="M20 4v6h-6"/><path d="M19 15a8 8 0 1 1-2-8.5l3 3.5"/>',
  tijera: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 7.5L20 18M8.5 16.5L20 6"/>',
  ojo: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  "ojo-no": '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.8-1.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  paginas: '<rect x="4" y="3" width="12" height="15" rx="2"/><path d="M8 21h10a2 2 0 0 0 2-2V7"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
};

function deSvg(marcado, clase, viewBox) {
  const t = document.createElement("template");
  t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" aria-hidden="true" focusable="false">${marcado}</svg>`;
  const svg = t.content.firstElementChild;
  svg.setAttribute("class", clase);
  return svg;
}

export function ilustracion(nombre, clase = "pv-ilu") {
  return deSvg(SVG[nombre] || HOJA, `${clase} pv-ilu-${nombre}`, nombre === "listo" ? "0 0 24 24" : "0 0 160 120");
}

export function icono(nombre) {
  return deSvg(ICONOS[nombre] || "", "pv-icono", "0 0 24 24");
}

// Botón pequeño con ícono y nombre para lectores de pantalla.
export function botonIcono(nombre, etiqueta, alPulsar, clase = "pv-boton-icono") {
  const b = nodo("button", clase);
  b.type = "button";
  b.title = etiqueta;
  b.setAttribute("aria-label", etiqueta);
  b.append(icono(nombre));
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    alPulsar(e);
  });
  return b;
}

export function boton(texto, clase, alPulsar) {
  const b = nodo("button", clase, texto);
  b.type = "button";
  b.addEventListener("click", alPulsar);
  return b;
}

// Las rutas PDF de lo que se soltó.
export function rutasPdf(e) {
  return [...(e.dataTransfer?.files || [])].map((f) => window.vigencia.rutaDeArchivo(f)).filter((r) => /\.pdf$/i.test(r || ""));
}

const traeArchivos = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

export function soltable(el, alSoltar) {
  let dentro = 0;
  el.addEventListener("dragenter", (e) => {
    if (!traeArchivos(e)) return;
    dentro += 1;
    el.classList.add("sobre");
  });
  el.addEventListener("dragover", (e) => {
    if (!traeArchivos(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  el.addEventListener("dragleave", () => {
    dentro = Math.max(0, dentro - 1);
    if (!dentro) el.classList.remove("sobre");
  });
  el.addEventListener("drop", (e) => {
    if (!traeArchivos(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dentro = 0;
    el.classList.remove("sobre");
    const rutas = rutasPdf(e);
    if (rutas.length) alSoltar(rutas);
    else avisar("Suelte un archivo PDF.", "error");
  });
}

// La vista de una herramienta: cabeza con ayuda de una línea, barra de
// acciones, cuerpo y pie (progreso o resultado, anunciado a lectores).
export function crearEscena(id, { titulo, ayuda, llena = false, alSoltar = null }) {
  const raiz = nodo("section", `pv-escena${llena ? " llena" : ""}`);
  raiz.id = `pv-${id}`;
  raiz.hidden = true;
  raiz.setAttribute("aria-label", titulo);
  const cabeza = nodo("header", "pv-cabeza");
  const textos = nodo("div", "pv-cabeza-textos");
  textos.append(nodo("h2", "pv-titulo serif", titulo), nodo("p", "ayuda pv-ayuda", ayuda));
  cabeza.append(textos);
  const barra = nodo("div", "pv-barra");
  barra.setAttribute("role", "toolbar");
  barra.setAttribute("aria-label", `Acciones de ${titulo}`);
  barra.hidden = true;
  const cuerpo = nodo("div", "pv-cuerpo");
  const pie = nodo("div", "pv-pie");
  pie.setAttribute("aria-live", "polite");
  raiz.append(cabeza, barra, cuerpo, pie);
  if (alSoltar) soltable(raiz, alSoltar);
  $("pdf-escenas").append(raiz);
  return {
    raiz, cabeza, barra, cuerpo, pie,
    mostrarPie(...elementos) {
      pie.replaceChildren(...elementos.filter(Boolean));
    },
    // Muestra el progreso en el pie mientras corre fn.
    async trabajando(texto, fn) {
      pie.replaceChildren(progreso(texto));
      raiz.classList.add("trabajando");
      try {
        return await fn();
      } finally {
        raiz.classList.remove("trabajando");
        if (pie.querySelector(".pv-progreso")) pie.replaceChildren();
      }
    },
  };
}

export function zonaVacia({ ilustracion: nombre, titulo, texto, boton: textoBoton = "Elegir PDF", alElegir, alSoltar }) {
  const zona = nodo("div", "pv-vacia");
  zona.tabIndex = 0;
  zona.setAttribute("role", "button");
  zona.setAttribute("aria-label", `${titulo}. ${textoBoton} o suéltelo aquí.`);
  const b = nodo("span", "boton-cobre pv-vacia-boton", textoBoton);
  zona.append(ilustracion(nombre), nodo("p", "pv-vacia-titulo", titulo), nodo("p", "ayuda", texto), b, nodo("p", "ayuda pv-vacia-nota", "Todo pasa en este computador: ningún PDF sale a internet."));
  zona.addEventListener("click", () => alElegir());
  zona.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      alElegir();
    }
  });
  if (alSoltar) soltable(zona, alSoltar);
  return zona;
}

export function progreso(texto) {
  const el = nodo("div", "pv-progreso");
  el.setAttribute("role", "status");
  const barra = document.createElement("progress");
  barra.className = "avance pv-progreso-barra";
  barra.setAttribute("aria-label", texto);
  el.append(nodo("p", "pv-progreso-texto", texto), barra);
  return el;
}

async function abrirArchivo(ruta) {
  const r = await window.vigencia.pdfAbrir(ruta);
  if (!r?.ok) avisar(r?.error || "No pude abrirlo.", "error");
}

async function mostrarArchivo(ruta) {
  const r = await window.vigencia.pdfMostrar(ruta);
  if (!r?.ok) avisar(r?.error || "No pude mostrarlo.", "error");
}

// rutas: lo que se guardó. llevar: { ruta, como, nombre } si no es la
// primera ruta (la copia temporal de Desbloquear); false para no ofrecerla.
export function tarjetaResultado({ titulo, detalle = "", rutas = [], llevar = null, extra = null }) {
  const t = nodo("section", "pv-resultado");
  t.setAttribute("aria-label", titulo);
  const cabeza = nodo("div", "pv-resultado-cabeza");
  const textos = nodo("div", "");
  textos.append(nodo("h3", "pv-resultado-titulo", titulo));
  if (detalle) textos.append(nodo("p", "ayuda", detalle));
  cabeza.append(ilustracion("listo", "pv-resultado-icono"), textos);
  t.append(cabeza);
  if (extra) t.append(extra);
  if (rutas.length > 1) {
    const lista = nodo("ul", "pv-resultado-lista");
    for (const ruta of rutas) {
      const li = nodo("li", "");
      li.append(nodo("span", "pv-resultado-nombre", ruta.split(/[/\\]/).pop()), boton("Abrir", "boton-texto", () => abrirArchivo(ruta)));
      lista.append(li);
    }
    t.append(lista);
  } else if (rutas[0]) {
    t.append(nodo("p", "ayuda pv-resultado-ruta", rutas[0]));
  }
  const fila = nodo("div", "pv-resultado-botones");
  if (rutas.length === 1) fila.append(boton("Abrir", "boton-cobre", () => abrirArchivo(rutas[0])));
  if (rutas.length) fila.append(boton("Mostrar en carpeta", "boton-linea", () => mostrarArchivo(rutas[0])));
  const aLlevar = llevar === false ? null : (llevar || (rutas[0] ? { ruta: rutas[0], como: "resultado" } : null));
  if (aLlevar) {
    fila.append(boton("Usar con la IA", "boton-linea", async () => {
      await ofrecerLlevar(aLlevar.ruta, { como: aLlevar.como || "resultado", nombre: aLlevar.nombre || "" });
      const panel = $("pdf-llevar");
      panel.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      panel.classList.add("pv-resalta");
      setTimeout(() => panel.classList.remove("pv-resalta"), 1600);
      $("pdf-llevar-convertir").focus({ preventScroll: true });
    }));
  }
  t.append(fila);
  return t;
}

// Celda de miniatura para las rejillas de páginas: botón con el canvas en
// un marco cuadrado (así girar no mueve la rejilla) y el número.
export function celdaMini(canvas, n, { etiqueta = `Página ${n}`, alPulsar = null, pulsada = null } = {}) {
  const celda = nodo("div", "pv-celda");
  const mini = nodo(alPulsar ? "button" : "div", "pv-mini");
  if (alPulsar) {
    mini.type = "button";
    mini.addEventListener("click", (e) => alPulsar(e, n));
  }
  if (pulsada != null) mini.setAttribute("aria-pressed", String(pulsada));
  mini.setAttribute("aria-label", etiqueta);
  const marco = nodo("span", "pv-mini-marco");
  marco.append(canvas);
  mini.append(marco, nodo("span", "pv-mini-num", String(n)));
  celda.append(mini);
  return celda;
}

// Corre la acción con progreso en la escena y en el estado de la izquierda.
export function correr(escena, idEstado, texto, fn) {
  return ocupado(idEstado, texto, () => escena.trabajando(texto, fn));
}

// Lo que devolvió un canal que guarda: tarjeta de resultado, error o nada
// si el usuario canceló el diálogo.
export function terminar(escena, idEstado, r, { titulo, detalle = "", aviso, error, llevar = null, extra = null }) {
  if (r?.ok) {
    estado(idEstado, "");
    const rutas = r.rutas || (r.ruta ? [r.ruta] : []);
    const tarjeta = tarjetaResultado({ titulo, detalle: typeof detalle === "function" ? detalle(r) : detalle, rutas, llevar, extra });
    escena.mostrarPie(tarjeta);
    const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;
    tarjeta.scrollIntoView({ block: "nearest", behavior: quieto ? "auto" : "smooth" });
    avisar(aviso);
    const aLlevar = llevar === false ? null : (llevar || (rutas[0] ? { ruta: rutas[0], como: "resultado" } : null));
    if (aLlevar) ofrecerLlevar(aLlevar.ruta, { como: aLlevar.como || "resultado", nombre: aLlevar.nombre || "" });
    return true;
  }
  escena.mostrarPie();
  if (r?.cancelado) {
    estado(idEstado, "No guardó nada.");
    return false;
  }
  estado(idEstado, r?.error || error, true);
  avisar(r?.error || error, "error");
  return false;
}
