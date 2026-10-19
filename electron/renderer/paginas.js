// Páginas de un PDF en la ventana con pdfjs (vendor/visor.js). Es la única
// pieza que dibuja PDF: Firmar, Rellenar y Comparar la usan con páginas
// grandes; Unir, Separar, Girar, Comprimir y Desbloquear, como miniaturas.
// Cada página es un canvas que se dibuja solo cuando se acerca a la vista
// (IntersectionObserver), con una memoria corta de dibujos ya hechos.
// Sin estilos en línea (CSP): el tamaño es el del canvas y el resto, clases.
import { tamanoVista } from "../compartido/pdftools.js";

let visorMod = null;
export async function visor() {
  visorMod ||= await import("./vendor/visor.js");
  return visorMod;
}

export function aBytes(base64) {
  const bin = atob(String(base64 || "").replace(/^data:[\w/+.-]+;base64,/, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const limitar = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));

// El PDF de esa ruta, abierto en pdfjs. Lanza un Error con mensaje claro.
export async function abrirDoc(ruta) {
  const r = await window.vigencia.pdfArchivo(ruta);
  if (!r?.ok) throw new Error(r?.error || "No pude leer el PDF.");
  return abrirBytes(r.base64);
}

export async function abrirBytes(base64) {
  return (await (await visor()).cargarPdf(aBytes(base64))).doc;
}

export async function cerrarDoc(doc) {
  if (!doc) return;
  try {
    await (await visor()).cerrarPdf(doc);
  } catch {
    /* ya cerrado */
  }
}

// Escala para que la página quepa en un cuadro de lado píxeles, nítida en
// pantallas densas (el CSS la muestra al tamaño del cuadro).
export function escalaMiniatura(lado) {
  const densidad = Math.min(2, window.devicePixelRatio || 1);
  return (pagina) => {
    const t = tamanoVista(pagina);
    return (lado * densidad) / Math.max(1, t.ancho, t.alto);
  };
}

// Una página suelta (la primera de un archivo en Unir, la vista previa de
// Desbloquear). pagina: geometría de pdf-info, para el tamaño.
export async function pintarMiniatura(doc, numero, canvas, pagina, lado) {
  await (await visor()).pintarPagina(doc, numero, canvas, escalaMiniatura(lado)(pagina));
}

// caja: donde van las páginas. raiz: lo que hace scroll (por omisión la
// caja; null es la ventana). paginas: geometrías de pdf-info; cada una puede
// traer su doc y su numero (Unir mezcla archivos). escala(pagina, i) fija el
// zoom de cada página (miniaturas); sin ella todas van a v.zoom. envolver
// (canvas, n, pagina) devuelve lo que se pone en la caja; encima(n, ctx, z)
// dibuja sobre la página (las marcas de Firmar).
export function crearVisor({ caja, raiz = caja, clase = "", etiqueta = (n) => `Página ${n}`, escala = null, encima = null, envolver = null, alCrear = null, maxMemoria = 12, margen = 300, alCambiarPagina = null }) {
  const v = { doc: null, paginas: [], zoom: 1, lienzos: [], actual: 1 };
  const memoria = new Map();
  const pendientes = new Set();
  let observador = null;
  let turno = 0;
  const zoomDe = (i) => (escala ? escala(v.paginas[i], i) : v.zoom);
  const claveDe = (i) => `${turno}:${i}@${zoomDe(i)}`;

  function medir() {
    v.lienzos.forEach((c, i) => {
      const t = tamanoVista(v.paginas[i]);
      c.width = Math.max(1, Math.round(t.ancho * zoomDe(i)));
      c.height = Math.max(1, Math.round(t.alto * zoomDe(i)));
      delete c.dataset.pintada;
    });
  }

  async function dibujarFondo(i) {
    const clave = claveDe(i);
    const doc = v.paginas[i]?.doc || v.doc;
    if (!doc || pendientes.has(clave)) return;
    pendientes.add(clave);
    try {
      const copia = document.createElement("canvas");
      await (await visor()).pintarPagina(doc, v.paginas[i]?.numero || i + 1, copia, zoomDe(i));
      if (clave !== claveDe(i)) return;
      memoria.set(clave, copia);
      while (memoria.size > maxMemoria) memoria.delete(memoria.keys().next().value);
    } catch {
      return;
    } finally {
      pendientes.delete(clave);
    }
    v.componer(i + 1);
  }

  v.armar = (doc, paginas) => {
    observador?.disconnect();
    memoria.clear();
    turno += 1;
    v.doc = doc;
    v.paginas = paginas || [];
    v.actual = 1;
    observador = new IntersectionObserver((entradas) => {
      for (const e of entradas) if (e.isIntersecting) v.componer(Number(e.target.dataset.pagina));
    }, { root: raiz, rootMargin: `${margen}px` });
    v.lienzos = v.paginas.map((p, i) => {
      const c = document.createElement("canvas");
      if (clase) c.className = clase;
      c.dataset.pagina = String(i + 1);
      c.setAttribute("aria-label", etiqueta(i + 1, p));
      alCrear?.(c, i + 1);
      return c;
    });
    medir();
    caja.replaceChildren(...v.lienzos.map((c, i) => (envolver ? envolver(c, i + 1, v.paginas[i]) : c)));
    for (const c of v.lienzos) observador.observe(c);
  };

  v.vaciar = () => {
    observador?.disconnect();
    observador = null;
    memoria.clear();
    turno += 1;
    Object.assign(v, { doc: null, paginas: [], lienzos: [], actual: 1 });
    caja.replaceChildren();
  };

  // La página: el dibujo de pdfjs y encima lo que ponga la herramienta.
  v.componer = (n) => {
    const i = n - 1;
    const c = v.lienzos[i];
    if (!c) return;
    const clave = claveDe(i);
    if (!encima && c.dataset.pintada === clave) return;
    const fondo = memoria.get(clave);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    if (fondo) {
      ctx.drawImage(fondo, 0, 0, c.width, c.height);
      c.dataset.pintada = clave;
      c.classList.remove("pv-cargando");
    } else {
      c.classList.add("pv-cargando");
      dibujarFondo(i);
    }
    encima?.(n, ctx, zoomDe(i));
  };

  v.componerTodas = () => {
    for (let n = 1; n <= v.lienzos.length; n++) if (memoria.has(claveDe(n - 1))) v.componer(n);
  };

  const cajaRaiz = () => (raiz || document.documentElement).getBoundingClientRect();

  v.componerVisibles = () => {
    const r0 = cajaRaiz();
    v.lienzos.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      if (r.bottom >= r0.top - margen && r.top <= r0.bottom + margen) v.componer(i + 1);
    });
  };

  v.cambiarZoom = (z, min = 0.25, max = 4) => {
    if (!v.lienzos.length) return;
    const pagina = v.actual;
    v.zoom = limitar(z, min, max);
    memoria.clear();
    medir();
    v.irA(pagina);
    v.componerVisibles();
  };

  // Zoom para que la página más ancha llene el ancho de la caja.
  v.zoomAncho = (min = 0.25, max = 4, holgura = 40) => {
    const ancho = Math.max(1, ...v.paginas.map((p) => tamanoVista(p).ancho));
    return limitar(((raiz || caja).clientWidth - holgura) / ancho, min, max);
  };

  v.irA = (n, suave = false) => {
    const c = v.lienzos[limitar(n, 1, v.lienzos.length) - 1];
    if (!c || !raiz) return c?.scrollIntoView({ block: "start", behavior: suave ? "smooth" : "auto" });
    const arriba = raiz.scrollTop + c.getBoundingClientRect().top - raiz.getBoundingClientRect().top - 12;
    raiz.scrollTo({ top: arriba, behavior: suave ? "smooth" : "auto" });
  };

  // La página que se está leyendo: la que cruza el primer tercio de la vista.
  v.paginaActual = () => {
    const r0 = cajaRaiz();
    const linea = r0.top + (raiz ? raiz.clientHeight : window.innerHeight) / 3;
    let n = 1;
    v.lienzos.forEach((c, i) => {
      if (c.getBoundingClientRect().top <= linea) n = i + 1;
    });
    if (n !== v.actual) {
      v.actual = n;
      alCambiarPagina?.(n);
    }
    return n;
  };

  return v;
}

// El PDF abierto de una herramienta: al cambiar de archivo cierra el
// anterior y, si se piden dos seguidos, solo queda el último.
export function docUnico() {
  let turno = 0;
  let doc = null;
  return {
    get doc() {
      return doc;
    },
    async abrir(ruta) {
      const t = ++turno;
      const viejo = doc;
      doc = null;
      cerrarDoc(viejo);
      if (!ruta) return null;
      const nuevo = await abrirDoc(ruta);
      if (t !== turno) {
        cerrarDoc(nuevo);
        return null;
      }
      doc = nuevo;
      return doc;
    },
  };
}
