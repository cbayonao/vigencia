// Pantalla Jurisprudencia: una sola búsqueda contra las tres relatorías,
// ficha de lectura y guardado como fuente de la biblioteca para la IA.
// Todo pasa por window.vigencia (juris-*); abrir enlaces usa ppAbrir.
const $ = (id) => document.getElementById(id);

const ju = {
  listo: false,
  fuentes: [],
  salas: [],
  tipos: [],
  corporaciones: [],
  fuente: "csj",
  resultados: [],
  total: 0,
  buscando: false,
  abierta: null,
  texto: "",
  leyendo: false,
  guardando: false,
};

function nodo(tag, clase, contenido) {
  const el = document.createElement(tag);
  if (clase) el.className = clase;
  if (contenido != null) el.textContent = contenido;
  return el;
}

function opcion(valor, etiqueta) {
  const o = document.createElement("option");
  o.value = valor;
  o.textContent = etiqueta;
  return o;
}

function fuenteActual() {
  return ju.fuentes.find((f) => f.id === ju.fuente) || ju.fuentes[0] || null;
}

function estadoBuscar(mensaje, error = false) {
  const el = $("juris-estado");
  el.textContent = mensaje || "";
  el.classList.toggle("error", error);
}

function campo(nombre, etiqueta, { tipo = "text", placeholder = "", opciones = null, valor = "" } = {}) {
  const l = nodo("label", "juris-campo");
  l.append(nodo("span", "etiqueta", etiqueta));
  let control;
  if (opciones) {
    control = document.createElement("select");
    control.replaceChildren(...opciones.map((o) => opcion(o.id ?? o.codigo ?? "", o.nombre)));
    control.value = valor;
  } else {
    control = document.createElement("input");
    control.type = tipo;
    control.placeholder = placeholder;
    control.autocomplete = "off";
    control.spellcheck = false;
    control.value = valor;
  }
  control.id = `juris-f-${nombre}`;
  control.setAttribute("aria-label", etiqueta);
  l.append(control);
  return l;
}

function filtrosElegidos() {
  const leer = (nombre) => String($( `juris-f-${nombre}`)?.value || "").trim();
  if (ju.fuente === "csj") {
    return {
      sala: leer("sala"), ponente: leer("ponente"), radicado: leer("radicado"),
      providencia: leer("providencia"), fechaIni: leer("fechaIni"), fechaFin: leer("fechaFin"),
      tipo: leer("tipo"), clase: leer("clase"),
    };
  }
  if (ju.fuente === "ccc") return { tipo: leer("tipo"), fechaIni: leer("fechaIni"), fechaFin: leer("fechaFin") };
  return { corporacion: leer("corporacion") };
}

function pintarPestanas() {
  const caja = $("juris-fuentes");
  caja.replaceChildren();
  for (const f of ju.fuentes) {
    const b = nodo("button", `juris-fuente${f.id === ju.fuente ? " elegida" : ""}`);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(f.id === ju.fuente));
    b.append(nodo("span", "juris-fuente-nombre", f.nombre));
    if (f.origen) b.append(nodo("span", "juris-fuente-origen", f.origen));
    b.addEventListener("click", () => {
      if (ju.fuente === f.id) return;
      ju.fuente = f.id;
      ju.resultados = [];
      ju.total = 0;
      ju.abierta = null;
      ju.texto = "";
      pintarPestanas();
      pintarFiltros();
      pintarResultados();
      pintarLector();
      estadoBuscar("");
    });
    caja.append(b);
  }
  const actual = fuenteActual();
  $("juris-ayuda-fuente").textContent = actual ? `${actual.origen}. ${actual.ayuda || ""}` : "";
}

function pintarFiltros() {
  const caja = $("juris-filtros-extra");
  caja.replaceChildren();
  if (ju.fuente === "csj") {
    caja.append(
      campo("sala", "Sala", { opciones: ju.salas }),
      campo("ponente", "Ponente", { placeholder: "Apellido del magistrado" }),
      campo("radicado", "Radicado", { placeholder: "Número de proceso" }),
      campo("providencia", "Providencia", { placeholder: "Ej. STC18383-2026" }),
      campo("fechaIni", "Desde", { placeholder: "dd/mm/aaaa" }),
      campo("fechaFin", "Hasta", { placeholder: "dd/mm/aaaa" }),
      campo("tipo", "Tipo de providencia", { placeholder: "Ej. SENTENCIA" }),
      campo("clase", "Clase de actuación", { placeholder: "Ej. TUTELA" }),
    );
  } else if (ju.fuente === "ccc") {
    caja.append(
      campo("tipo", "Tipo", { opciones: ju.tipos }),
      campo("fechaIni", "Desde", { tipo: "date", valor: "1992-01-01" }),
      campo("fechaFin", "Hasta", { tipo: "date" }),
    );
  } else {
    caja.append(campo("corporacion", "Corporación", { opciones: ju.corporaciones, valor: ju.corporaciones[0]?.codigo || "" }));
  }
  $("juris-mas-filtros").open = false;
}

function fuenteNombre(id) {
  return ju.fuentes.find((f) => f.id === id)?.nombre || "Jurisprudencia";
}

function lineaResultado(r) {
  if (r.fuente === "csj") {
    return [r.sala, r.providencia, r.fecha && `Fecha: ${r.fecha}`, r.ponente && `Ponente: ${r.ponente}`].filter(Boolean).join(" · ");
  }
  if (r.fuente === "ccc") {
    return [r.tipo, r.fecha && `Fecha: ${r.fecha}`, r.magistrado && `Ponente: ${r.magistrado}`].filter(Boolean).join(" · ");
  }
  return [r.clase, r.fecha && `Fecha: ${r.fecha}`, r.ponente && `Ponente: ${r.ponente}`, r.proceso && `Proceso: ${r.proceso}`].filter(Boolean).join(" · ");
}

function pintarResultados() {
  const lista = $("juris-lista");
  lista.replaceChildren();
  $("juris-cuenta").textContent = ju.resultados.length
    ? `${ju.resultados.length} de ${ju.total || ju.resultados.length}`
    : "";
  if (!ju.resultados.length) {
    lista.append(nodo("p", "ayuda", ju.buscando ? "Buscando…" : "Sin resultados. Escriba el tema y pulse Buscar."));
    return;
  }
  for (const r of ju.resultados) {
    const tarjeta = nodo("article", `tarjeta juris-tarjeta${ju.abierta?.ref === r.ref ? " activa" : ""}`);
    tarjeta.tabIndex = 0;
    tarjeta.setAttribute("role", "button");
    tarjeta.append(nodo("p", "juris-origen", fuenteNombre(r.fuente)));
    tarjeta.append(nodo("p", "titulo-lista", r.titulo || "Sin título"));
    const meta = lineaResultado(r);
    if (meta) tarjeta.append(nodo("p", "meta", meta));
    const resumen = r.sintesis || r.tema || "";
    if (resumen) tarjeta.append(nodo("p", "juris-resumen", resumen.length > 220 ? `${resumen.slice(0, 220)} […]` : resumen));
    const abrir = () => abrirFicha(r);
    tarjeta.addEventListener("click", abrir);
    tarjeta.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      abrir();
    });
    lista.append(tarjeta);
  }
}

function fichaFilas(r) {
  const pares = [];
  if (r.fuente === "csj") {
    pares.push(["Sala", r.sala], ["Providencia", r.providencia], ["Proceso", r.proceso],
      ["Clase", r.clase], ["Tipo", [r.subtipo, r.tipo].filter(Boolean).join(" · ")],
      ["Fecha", r.fecha], ["Ponente", r.ponente]);
  } else if (r.fuente === "ccc") {
    pares.push(["Sentencia", r.numero], ["Tipo", r.tipo], ["Fecha", r.fecha],
      ["Expediente", r.expediente], ["Ponente", r.magistrado]);
  } else {
    pares.push(["Proceso", r.proceso], ["Interno", r.interno], ["Clase", r.clase],
      ["Fecha", r.fecha], ["Ponente", r.ponente], ["Sala", r.sala],
      ["Actor", r.actor], ["Demandado", r.demandado]);
  }
  return pares.filter(([, v]) => v);
}

function abrirFicha(r) {
  ju.abierta = r;
  ju.texto = "";
  ju.convertido = null;
  pintarResultados();
  pintarLector();
  $("juris-detalle").scrollTop = 0;
}

function pintarLector() {
  const detalle = $("juris-ficha");
  detalle.replaceChildren();
  $("juris-vacio").hidden = Boolean(ju.abierta);
  if (!ju.abierta) return;
  const r = ju.abierta;
  const ficha = nodo("div", "cabecera lectura ficha");
  ficha.append(nodo("p", "kicker", fuenteActual()?.nombre || "Jurisprudencia"));
  ficha.append(nodo("h2", "expediente-titulo serif", r.titulo || "Sentencia"));
  const datos = nodo("div", "datos");
  for (const [clave, valor] of fichaFilas(r)) {
    const dato = nodo("div", "dato");
    dato.append(nodo("p", "dato-clave", clave), nodo("p", "dato-valor", valor));
    datos.append(dato);
  }
  ficha.append(datos);
  detalle.append(ficha);
  if ((r.fuente === "ccc" && (r.tema || r.sintesis)) || (r.fuente === "csj" && r.tema)) {
    const sec = nodo("section", "juris-card juris-sintesis");
    sec.append(nodo("h2", "seccion serif", r.fuente === "ccc" ? "Tema y síntesis" : "Tesauro"));
    if (r.tema) sec.append(nodo("p", "", r.tema));
    if (r.sintesis && r.sintesis !== r.tema) sec.append(nodo("p", "", r.sintesis));
    detalle.append(sec);
  }
  const tarjetaAcciones = nodo("div", "juris-card");
  const acciones = nodo("div", "fila-fin juris-acciones");
  const leer = nodo("button", "boton-linea", ju.texto ? "Volver a leer" : "Leer el texto");
  leer.type = "button";
  leer.disabled = ju.leyendo || !(r.fuente === "ccc" || r.fuente === "ce");
  if (r.fuente === "csj") leer.title = "La Corte Suprema aún no entrega el texto directo: use el navegador.";
  leer.addEventListener("click", leerTexto);
  const guardar = nodo("button", "boton-cobre", "Guardar en la biblioteca");
  guardar.type = "button";
  guardar.disabled = ju.guardando;
  guardar.title = "Guarda la sentencia como fuente de jurisprudencia para usarla con la IA al redactar.";
  guardar.addEventListener("click", guardarFuente);
  const web = nodo("button", "boton-texto", "Abrir en el navegador");
  web.type = "button";
  web.addEventListener("click", abrirNavegador);
  const convertir = nodo("button", "boton-linea", ju.convirtiendo ? "Convirtiendo..." : "Convertir a Markdown");
  convertir.type = "button";
  convertir.disabled = ju.convirtiendo || !(r.fuente === "ccc" || r.fuente === "ce");
  convertir.title = "Baja la sentencia, la convierte a Markdown en este computador y la deja lista para cualquier modelo.";
  convertir.addEventListener("click", convertirSentencia);
  acciones.append(leer, convertir, guardar, web);
  const nota = nodo("p", "ayuda", "");
  nota.id = "juris-lector-estado";
  tarjetaAcciones.append(acciones, nota);
  detalle.append(tarjetaAcciones);
  if (ju.convertido) detalle.append(tarjetaConvertido());
  const caja = nodo("div", "juris-texto");
  caja.id = "juris-texto";
  if (ju.texto) caja.textContent = ju.texto;
  else {
    const ayuda = r.fuente === "csj"
      ? "La Corte Suprema muestra la ficha y el tesauro; el texto completo se abre en su buscador oficial."
      : "Pulse Leer el texto para traer la sentencia completa a este computador.";
    caja.append(nodo("p", "ayuda", ayuda));
  }
  detalle.append(caja);
}

function lectorEstado(mensaje, error = false) {
  const el = $("juris-lector-estado");
  if (el) {
    el.textContent = mensaje || "";
    el.classList.toggle("error", error);
  }
}

function urlNavegador() {
  const r = ju.abierta;
  if (!r) return "";
  if (r.fuente === "ccc" && r.url) return r.url;
  if (r.fuente === "ce" && r.token) return `https://samai.consejodeestado.gov.co/PaginasTransversales/VerProvidencia.aspx?tokenDocumento=${encodeURIComponent(r.token)}`;
  return "https://consultajurisprudencial.ramajudicial.gov.co/WebRelatoria/csj/index.xhtml";
}

async function abrirNavegador() {
  const url = urlNavegador();
  if (!url) return;
  await window.vigencia.ppAbrir(url);
}

async function leerTexto() {
  if (ju.leyendo || !ju.abierta) return;
  ju.leyendo = true;
  pintarLector();
  lectorEstado("Trayendo el texto de la sentencia…");
  const r = await window.vigencia.jurisLeer(ju.abierta);
  ju.leyendo = false;
  if (!r?.ok) {
    pintarLector();
    lectorEstado(r?.error || "No pude traer el texto.", true);
    return;
  }
  ju.texto = r.texto || "";
  pintarLector();
  lectorEstado(ju.texto ? `${ju.texto.length.toLocaleString("es-CO")} caracteres listos para guardar.` : "Llegó vacío. Intente de nuevo.");
}

function textoAGuardar() {
  if (ju.texto.trim()) return ju.texto;
  const r = ju.abierta;
  if (r?.fuente === "csj") {
    return [
      `Ficha de ${r.titulo || "providencia"} (Corte Suprema de Justicia).`,
      [r.sala, r.subtipo, r.clase, r.tipo].filter(Boolean).join(" · "),
      r.proceso ? `Proceso: ${r.proceso}.` : "",
      r.providencia ? `Providencia: ${r.providencia}.` : "",
      r.fecha ? `Fecha: ${r.fecha}.` : "",
      r.ponente ? `Ponente: ${r.ponente}.` : "",
      r.tema ? `Tesauro:\n${r.tema}` : "",
      "(Ficha sin texto completo: la Corte Suprema aún no lo entrega directo.)",
    ].filter(Boolean).join("\n");
  }
  return "";
}

async function guardarFuente() {
  if (ju.guardando || !ju.abierta) return;
  ju.guardando = true;
  pintarLector();
  lectorEstado("Guardando en la biblioteca…");
  let aviso = "";
  let error = false;
  try {
    let cuerpo = textoAGuardar();
    if (!cuerpo.trim()) {
      const r = await window.vigencia.jurisLeer(ju.abierta);
      if (!r?.ok) {
        aviso = r?.error || "No pude traer el texto.";
        error = true;
      } else {
        ju.texto = r.texto || "";
        cuerpo = ju.texto;
      }
    }
    if (!error) {
      const g = await window.vigencia.jurisGuardar(ju.abierta, cuerpo);
      if (!g?.ok) {
        aviso = g?.error || "No pude guardarla.";
        error = true;
      } else {
        aviso = `Guardada en la biblioteca como “${g.fuente.nombre}”. Ya sirve de insumo para la IA en Documentos.`;
      }
    }
  } finally {
    ju.guardando = false;
    pintarLector();
    if (aviso) lectorEstado(aviso, error);
  }
}

async function buscar(evento) {
  evento?.preventDefault();
  if (ju.buscando) return;
  const texto = String($("juris-texto-buscar").value || "").trim();
  const filtros = filtrosElegidos();
  ju.buscando = true;
  ju.abierta = null;
  ju.texto = "";
  estadoBuscar(`Buscando en ${fuenteActual()?.nombre || "la fuente"}…`);
  pintarResultados();
  pintarLector();
  try {
    const r = await window.vigencia.jurisBuscar({ fuente: ju.fuente, texto, filtros });
    if (!r?.ok) {
      estadoBuscar(r?.error || "No pude buscar.", true);
      return;
    }
    ju.resultados = r.filas || [];
    ju.total = r.total || ju.resultados.length;
    if (r.corporaciones?.length) {
      ju.corporaciones = r.corporaciones;
      if ($("juris-f-corporacion")) {
        const actual = filtros.corporacion;
        $("juris-f-corporacion").replaceChildren(...r.corporaciones.map((c) => opcion(c.codigo, c.nombre)));
        $("juris-f-corporacion").value = r.corporaciones.some((c) => c.codigo === actual) ? actual : r.corporaciones[0].codigo;
      }
    }
    estadoBuscar(ju.resultados.length
      ? `${ju.resultados.length} ${ju.resultados.length === 1 ? "resultado" : "resultados"}${ju.total > ju.resultados.length ? ` de ${ju.total}: afine con Más filtros para ver más` : ""}. Pulse uno para leerlo.`
      : "Sin resultados. Pruebe con otras palabras.");
  } finally {
    ju.buscando = false;
    pintarResultados();
    pintarLector();
  }
}

async function cargarFuentes() {
  const r = await window.vigencia.jurisFuentes();
  if (!r?.ok) {
    estadoBuscar(r?.error || "No pude abrir Jurisprudencia.", true);
    return;
  }
  ju.fuentes = r.fuentes || [];
  ju.salas = r.salasCsj || [];
  ju.tipos = r.tiposCcc || [];
  ju.corporaciones = r.corporacionesCe || [];
  if (!ju.fuentes.some((f) => f.id === ju.fuente)) ju.fuente = ju.fuentes[0]?.id || "csj";
  pintarPestanas();
  pintarFiltros();
}

export async function abrirJuris() {
  if (!ju.fuentes.length) await cargarFuentes();
}

export function iniciarJuris() {
  if (ju.listo) return;
  ju.listo = true;
  $("form-juris").addEventListener("submit", buscar);
  $("juris-mas-filtros").addEventListener("toggle", () => {
    $("juris-mas-filtros-resumen").textContent = $("juris-mas-filtros").open ? "Menos filtros" : "Más filtros";
  });
}


// ---------- Convertir a Markdown ----------

async function convertirSentencia() {
  if (ju.convirtiendo || !ju.abierta) return;
  ju.convirtiendo = true;
  ju.convertido = null;
  pintarLector();
  lectorEstado("Bajando la sentencia y convirtiéndola en este computador. Puede tardar si es escaneada.");
  const r = await window.vigencia.jurisConvertir(ju.abierta);
  ju.convirtiendo = false;
  if (!r?.ok) {
    pintarLector();
    lectorEstado(r?.error || "No pude convertir la sentencia.", true);
    return;
  }
  const bueno = (r.resultados || []).find((x) => x.archivo?.estado === "listo");
  if (!bueno) {
    pintarLector();
    lectorEstado((r.resultados || []).map((x) => x.error).filter(Boolean)[0] || "No pude convertir la sentencia.", true);
    return;
  }
  const leido = await window.vigencia.convertirLeer(bueno.archivo.id);
  const proyectos = await window.vigencia.documentosInicio();
  ju.convertido = {
    archivos: (r.resultados || []).filter((x) => x.archivo?.estado === "listo").map((x) => x.archivo),
    markdown: leido?.ok ? leido.markdown : "",
    proyectos: proyectos?.ok ? proyectos.proyectos || [] : [],
    cache: Boolean(bueno.cache),
  };
  pintarLector();
  const a = bueno.archivo;
  const partes = [`Lista en Markdown${bueno.cache ? " (ya estaba convertida)" : ""}`];
  if (a.paginas) partes.push(`${a.paginas} páginas`);
  if (a.paginas_ocr) partes.push(`${a.paginas_ocr} leídas con OCR`);
  partes.push(`cerca de ${Number(a.tokens_aprox || 0).toLocaleString("es-CO")} tokens`);
  lectorEstado(`${partes.join(", ")}.${a.aviso ? ` ${a.aviso}` : ""}`);
}

function tarjetaConvertido() {
  const c = ju.convertido;
  const tarjeta = nodo("section", "juris-card juris-convertido");
  tarjeta.append(nodo("h2", "seccion serif", "Sentencia en Markdown"));
  const fila = nodo("div", "fila-fin juris-acciones");
  const select = document.createElement("select");
  select.className = "campo";
  select.append(new Option(c.proyectos.length ? "Elegir proyecto de Documentos" : "No hay proyectos en Documentos", ""));
  for (const p of c.proyectos) select.append(new Option(p.nombre, String(p.id)));
  const agregar = nodo("button", "boton-cobre", "Agregar al proyecto");
  agregar.type = "button";
  agregar.disabled = !c.proyectos.length;
  agregar.addEventListener("click", async () => {
    const id = Number(select.value);
    if (!id) return lectorEstado("Elija un proyecto.", true);
    for (const a of c.archivos) {
      const r = await window.vigencia.proyectoArchivoAgregar(id, a.id);
      if (!r?.ok) return lectorEstado(r?.error || "No pude agregarla al proyecto.", true);
    }
    lectorEstado("Quedó en los archivos del proyecto. El modelo la usará por fragmentos con su página.");
  });
  const biblioteca = nodo("button", "boton-linea", "Guardar en la biblioteca");
  biblioteca.type = "button";
  biblioteca.addEventListener("click", async () => {
    const r = await window.vigencia.convertirABiblioteca(c.archivos[0].id);
    lectorEstado(r?.ok ? "Guardada en la biblioteca como jurisprudencia." : r?.error || "No pude guardarla.", !r?.ok);
  });
  const md = nodo("button", "boton-texto", "Guardar .md");
  md.type = "button";
  md.addEventListener("click", async () => {
    const r = await window.vigencia.convertirGuardarComo(c.archivos[0].id);
    if (r?.ok) lectorEstado(`Guardado en ${r.ruta}`);
    else if (!r?.cancelado) lectorEstado(r?.error || "No pude guardarlo.", true);
  });
  fila.append(select, agregar, biblioteca, md);
  const vista = nodo("pre", "juris-texto juris-md");
  vista.textContent = c.markdown.slice(0, 200000);
  tarjeta.append(fila, vista);
  return tarjeta;
}
