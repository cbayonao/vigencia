// Piezas compartidas entre pantallas: el selector de proyecto de Documentos
// (Convertir y Herramientas PDF lo usan para llevar archivos al contexto),
// el ir de una pantalla a otra y la barra de avance de una conversión.

// Llena un <select> con los proyectos activos de Documentos. Conserva la
// elección si el proyecto sigue ahí. Devuelve la lista.
export async function llenarProyectos(select, { vacio = "Sin proyecto", elegido = "" } = {}) {
  if (!select) return [];
  const previo = String(elegido || select.value || "");
  const r = await window.vigencia.documentosInicio();
  const proyectos = r?.ok ? r.proyectos || [] : [];
  select.replaceChildren(new Option(proyectos.length ? vacio : "No hay proyectos en Documentos", ""));
  for (const p of proyectos) select.append(new Option(p.nombre, String(p.id)));
  if (previo && proyectos.some((p) => String(p.id) === previo)) select.value = previo;
  return proyectos;
}

// Pide a app.js cambiar de pantalla: { a: "documentos", proyectoId } o
// { a: "convertir", archivoId }.
export function irA(destino) {
  window.dispatchEvent(new CustomEvent("vigencia:ir", { detail: destino || {} }));
}

// Texto de una fase del conversor, para cualquier pantalla.
export function textoAvance(p = {}) {
  const nombre = p.nombre ? `${p.nombre}: ` : "";
  if (p.fase === "en cola") return `${nombre}en cola`;
  if (p.fase === "leyendo") return p.total ? `${nombre}leyendo la página ${p.pagina} de ${p.total}` : `${nombre}leyendo`;
  if (p.fase === "ocr") return `${nombre}leyendo con OCR la página ${p.pagina} de ${p.total}`;
  if (p.fase === "listo") return p.cache ? `${nombre}listo, ya estaba convertido` : `${nombre}listo`;
  if (p.fase === "error") return p.codigo === "cancelado" ? `${nombre}cancelado` : `${nombre}${p.error || "no se pudo"}`;
  return `${nombre}${p.fase || ""}`;
}

// Mueve una barra <progress> según el avance (sin estilos en línea: la
// política de la ventana no los deja).
export function moverBarra(barra, p = {}) {
  if (!barra) return;
  barra.hidden = false;
  if (p.fase === "listo") {
    barra.max = 1;
    barra.value = 1;
  } else if (p.total) {
    barra.max = Number(p.total) || 1;
    barra.value = Math.min(Number(p.pagina) || 0, barra.max);
  } else {
    barra.removeAttribute("value");
  }
}

// Escucha el avance del conversor mientras corre `fn` y lo pinta en
// `estado` y `barra`. Devuelve lo que devuelva `fn`.
export async function conAvance({ estado, barra }, fn) {
  const quitar = window.vigencia.alConvertir((p) => {
    if (!p) return;
    if (estado) estado.textContent = textoAvance(p);
    moverBarra(barra, p);
  });
  estado?.classList.add("procesando");
  if (barra) {
    barra.hidden = false;
    barra.removeAttribute("value");
  }
  try {
    return await fn();
  } finally {
    quitar();
    estado?.classList.remove("procesando");
    if (barra) barra.hidden = true;
  }
}
