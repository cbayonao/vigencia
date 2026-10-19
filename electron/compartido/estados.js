// Estados electrónicos de la Rama Judicial ("LISTADO DE ESTADO") a tabla.
// Puro: recibe los textos de cada página con su posición (x, y en puntos
// del PDF, y hacia arriba, como los da pdfjs) o una tabla ya armada (Excel,
// Word, HTML) y devuelve filas. Nada se bota: lo que no cae en una fila va a
// notas y cada fila trae su confianza y sus avisos.
//
// Cómo lee un PDF:
// 1. En cada página busca la fila de títulos ("No Proceso", "Demandante",
//    "Fecha Auto"...) y le pone a cada título su columna (SINONIMOS).
// 2. Los títulos van centrados y los datos a la izquierda, así que el corte
//    entre dos columnas no sale del título: es el hueco vertical que dejan
//    los datos entre los centros de dos títulos seguidos.
// 3. Cada registro empieza donde la columna del radicado arranca con cinco
//    dígitos (el código del municipio) y llega hasta el siguiente.
// 4. Las celdas partidas en varias líneas se juntan; la descripción se parte
//    en actuación (primera línea) y anotación (el resto).

export const COLUMNAS = [
  { id: "radicado", nombre: "Radicado" },
  { id: "clase", nombre: "Clase de proceso" },
  { id: "demandante", nombre: "Demandante" },
  { id: "demandado", nombre: "Demandado" },
  { id: "actuacion", nombre: "Actuación" },
  { id: "anotacion", nombre: "Anotación" },
  { id: "fecha", nombre: "Fecha auto" },
  { id: "cuaderno", nombre: "Cuaderno" },
  { id: "folios", nombre: "Folios" },
];

// Títulos que usan los juzgados, ya sin tildes ni puntos y en minúscula.
// El orden importa: gana la primera columna cuyo sinónimo calza.
const SINONIMOS = [
  ["radicado", ["no proceso", "numero de proceso", "num proceso", "no de proceso", "proceso", "radicacion", "radicado", "no radicacion", "numero de radicacion", "no radicado", "expediente", "no expediente"]],
  ["clase", ["clase de proceso", "clase proceso", "clase", "tipo de proceso", "tipo proceso", "tipo"]],
  ["demandante", ["demandante", "demandantes", "accionante", "accionantes", "demandante accionante", "demandante/accionante", "solicitante"]],
  ["demandado", ["demandado", "demandados", "accionado", "accionados", "demandado accionado", "demandado/accionado", "causante"]],
  ["actuacion", ["descripcion actuacion", "actuacion", "descripcion", "decision", "providencia"]],
  ["anotacion", ["anotacion", "anotaciones", "observacion", "observaciones"]],
  ["fecha", ["fecha auto", "fecha providencia", "fecha del auto", "fecha de auto", "fecha de la providencia", "fecha actuacion", "fecha"]],
  ["cuaderno", ["cuad", "cuaderno", "cuad no", "c"]],
  ["folios", ["folios", "folio", "fls", "fl"]],
];

export function normal(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.:#°º]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Columna de un título, o "" si no es título.
export function columnaDeTitulo(texto) {
  const t = normal(texto);
  if (!t) return "";
  const partes = [t, ...t.split(/\s*\/\s*/)];
  for (const parte of partes) {
    for (const [id, lista] of SINONIMOS) if (lista.includes(parte)) return id;
  }
  return "";
}

// ---------- Radicado ----------

const RE_FECHA = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;

// Inicio de un registro: cinco dígitos del municipio, o el número entero.
export function iniciaRadicado(texto) {
  const t = String(texto || "").trim();
  return /^\d{5}(?!\d)/.test(t) || /^\d{20,23}$/.test(t.replace(/[\s.-]/g, ""));
}

// 23 dígitos: municipio 5, corporación 2, especialidad 2, despacho 3, año 4,
// consecutivo 5 y recurso 2. Si el estado no trae el recurso (lo usual en
// primera instancia) se completa con 00. Si no se puede armar con seguridad,
// queda vacío y el texto original sigue en `texto`.
export function normalizarRadicadoEstado(crudo) {
  const texto = String(crudo || "").replace(/\s+/g, " ").trim();
  const digitos = texto.replace(/\D/g, "");
  const r = { numero: "", texto, nota: "", aviso: "" };
  if (!digitos) {
    r.aviso = "Sin número de radicado.";
    return r;
  }
  const anioValido = (a) => Number(a) >= 1950 && Number(a) <= 2100;
  if (digitos.length === 23 && anioValido(digitos.slice(12, 16))) {
    r.numero = digitos;
    return r;
  }
  if (digitos.length === 21 && anioValido(digitos.slice(12, 16))) {
    r.numero = `${digitos}00`;
    r.nota = "Completado con 00 al final (recurso).";
    return r;
  }
  // Grupos separados: se puede rellenar con ceros el despacho y el consecutivo.
  const g = texto.split(/[\s.-]+/).filter(Boolean);
  if (g.length >= 6 && g.every((x) => /^\d+$/.test(x)) && g[0].length === 5 && g[1].length === 2 && g[2].length === 2 && g[3].length <= 3 && g[4].length === 4 && anioValido(g[4]) && g[5].length <= 5 && (g.length === 6 || (g.length === 7 && g[6].length <= 2))) {
    const recurso = g.length === 7 ? g[6].padStart(2, "0") : "00";
    r.numero = `${g[0]}${g[1]}${g[2]}${g[3].padStart(3, "0")}${g[4]}${g[5].padStart(5, "0")}${recurso}`;
    const relleno = g[3].length < 3 || g[5].length < 5;
    if (relleno) r.aviso = "Radicado completado con ceros: revíselo.";
    if (g.length === 6) r.nota = "Completado con 00 al final (recurso).";
    return r;
  }
  r.aviso = digitos.length < 21 ? "El radicado está incompleto; quedó como viene." : "El radicado no tiene la forma de 23 dígitos; quedó como viene.";
  return r;
}

// ---------- Encabezado del estado ----------

export function metaDeTexto(texto) {
  const t = String(texto || "").replace(/\s+/g, " ");
  const meta = {};
  const juz = /\b(JUZGADO|TRIBUNAL|SALA|CORTE|COMISI[OÓ]N)\b.*?(?=\s+(?:LISTADO|ESTADO|FECHA|P[AÁ]GINA|TRASLADO)\b|$)/i.exec(t);
  if (juz) meta.juzgado = juz[0].replace(/[\s,;.:-]+$/, "").trim();
  const est = /\bESTADO\s*(?:No\.?|N[°º]|N[UÚ]MERO|#)?\s*(\d{1,4})\b/i.exec(t);
  if (est) meta.estado = est[1];
  const fecha = /\bFECHA\s*(?:DEL ESTADO|DE FIJACI[OÓ]N)?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(t);
  if (fecha) meta.fecha = fechaCorta(fecha[1]);
  const pag = /\bP[AÁ]GINA\s*:?\s*(\d+)/i.exec(t);
  if (pag) meta.pagina = Number(pag[1]);
  if (/LISTADO DE ESTADO|ESTADOS? ELECTR[OÓ]NICOS?/i.test(t)) meta.tipo = "estado";
  else if (/TRASLADO/i.test(t)) meta.tipo = "traslado";
  return meta;
}

function fechaCorta(texto) {
  const m = RE_FECHA.exec(String(texto || ""));
  if (!m) return "";
  return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
}

// ---------- Líneas y columnas ----------

function limpios(items) {
  return (items || [])
    .map((it) => ({ x: Number(it.x) || 0, y: Number(it.y) || 0, w: Math.max(0, Number(it.w) || 0), h: Math.max(1, Number(it.h) || 8), str: String(it.str ?? "").replace(/\s+/g, " ").trim() }))
    .filter((it) => it.str);
}

// Agrupa en líneas por altura (y de arriba hacia abajo) y ordena por x.
export function lineas(items, tolerancia = null) {
  const orden = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const salida = [];
  for (const it of orden) {
    const tol = tolerancia ?? Math.max(2, it.h * 0.4);
    const ultima = salida[salida.length - 1];
    if (ultima && Math.abs(ultima.y - it.y) <= tol) ultima.items.push(it);
    else salida.push({ y: it.y, items: [it] });
  }
  for (const l of salida) {
    l.items.sort((a, b) => a.x - b.x);
    l.texto = l.items.map((i) => i.str).join(" ");
  }
  return salida;
}

// La fila de títulos: el grupo de títulos a una misma altura que nombra más
// columnas distintas. Los títulos en dos renglones ("Fecha" sobre "Auto") se
// juntan cuando se tocan en x.
export function encontrarTitulos(items) {
  const candidatos = items.filter((it) => columnaDeTitulo(it.str) || /^(no|auto|de|proceso|providencia|actuacion|actuación)$/i.test(it.str));
  let mejor = null;
  for (const base of candidatos) {
    if (!columnaDeTitulo(base.str)) continue;
    const tol = Math.max(8, base.h * 1.4);
    const banda = items.filter((it) => Math.abs(it.y - base.y) <= tol);
    const titulos = juntarTitulos(banda);
    const ids = new Set(titulos.map((t) => t.columna).filter(Boolean));
    const puntos = ids.size + (ids.has("radicado") ? 0.5 : 0);
    if (ids.size >= 2 && (!mejor || puntos > mejor.puntos)) mejor = { puntos, titulos, abajo: Math.min(...banda.map((i) => i.y)), arriba: Math.max(...banda.map((i) => i.y + i.h)) };
  }
  if (!mejor) return null;
  // Una columna, una vez: si se repite, la segunda queda como columna extra.
  const vistos = new Set();
  for (const t of mejor.titulos) {
    if (t.columna && vistos.has(t.columna)) t.columna = "";
    if (t.columna) vistos.add(t.columna);
  }
  return mejor;
}

function juntarTitulos(banda) {
  const orden = [...banda].sort((a, b) => a.x - b.x);
  const grupos = [];
  for (const it of orden) {
    const g = grupos.find((x) => it.x < x.x1 + 2 && it.x + it.w > x.x0 - 2);
    if (g) {
      g.items.push(it);
      g.x0 = Math.min(g.x0, it.x);
      g.x1 = Math.max(g.x1, it.x + it.w);
    } else grupos.push({ x0: it.x, x1: it.x + it.w, items: [it] });
  }
  return grupos.map((g) => {
    const texto = g.items.sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.str).join(" ");
    return { texto, columna: columnaDeTitulo(texto), x0: g.x0, x1: g.x1, centro: (g.x0 + g.x1) / 2 };
  }).filter((t) => t.columna || t.texto.length > 1);
}

// Cortes entre columnas: entre los centros de dos títulos seguidos, el tramo
// con menos datos encima (ojalá ninguno), y de ese tramo el más largo.
export function cortesDeColumnas(titulos, datos) {
  const cortes = [];
  for (let k = 0; k < titulos.length - 1; k++) {
    const a = Math.floor(titulos[k].centro);
    const b = Math.ceil(titulos[k + 1].centro);
    const encima = (x) => datos.reduce((n, it) => n + (it.x <= x && it.x + it.w >= x ? 1 : 0), 0);
    let minimo = Infinity;
    let mejor = null;
    let inicio = null;
    for (let x = a; x <= b + 1; x++) {
      const n = x <= b ? encima(x) : Infinity;
      if (n < minimo) {
        minimo = n;
        mejor = { desde: x, hasta: x };
        inicio = x;
      } else if (n === minimo) {
        if (inicio === null) inicio = x;
        if (x - inicio > mejor.hasta - mejor.desde) mejor = { desde: inicio, hasta: x };
      } else inicio = null;
    }
    const corte = mejor ? (mejor.desde + mejor.hasta) / 2 : (titulos[k].x1 + titulos[k + 1].x0) / 2;
    cortes.push(Math.max(titulos[k].x0, Math.min(corte, titulos[k + 1].x1)));
  }
  return cortes;
}

function columnaDe(it, cortes) {
  const centro = it.x + it.w / 2;
  let k = 0;
  while (k < cortes.length && centro > cortes[k]) k++;
  return k;
}

// Un texto que cruza más de un tercio dentro de otra columna no es de celda.
function cruza(it, cortes) {
  const k = columnaDe(it, cortes);
  const izq = k > 0 ? cortes[k - 1] : -Infinity;
  const der = k < cortes.length ? cortes[k] : Infinity;
  const fuera = Math.max(0, izq - it.x) + Math.max(0, it.x + it.w - der);
  return it.w > 0 && fuera / it.w > 0.34;
}

// ---------- PDF con posiciones ----------

// paginas: [{ numero, ancho, alto, items: [{ x, y, w, h, str }], ocr }]
export function leerEstado(paginas, { origen = "pdf" } = {}) {
  const meta = { paginas: (paginas || []).length };
  const filas = [];
  const notas = [];
  const avisos = [];
  let ultimoTitulo = null;
  for (const pagina of paginas || []) {
    const n = pagina.numero;
    const items = limpios(pagina.items);
    if (!items.length) {
      notas.push({ pagina: n, texto: "", aviso: "Página sin texto." });
      continue;
    }
    const titulos = encontrarTitulos(items) || ultimoTitulo;
    const halladoAqui = titulos && titulos !== ultimoTitulo;
    if (!titulos) {
      const r = leerPorLineas(lineas(items).map((l) => l.texto).join("\n"), { pagina: n });
      filas.push(...r.filas);
      notas.push(...r.notas);
      avisos.push(`Página ${n}: no encontré los títulos de las columnas; se leyó línea por línea.`);
      continue;
    }
    if (halladoAqui) ultimoTitulo = { ...titulos, abajo: Infinity, arriba: Infinity };
    const arriba = halladoAqui ? items.filter((it) => it.y > titulos.arriba) : [];
    const banda = halladoAqui ? items.filter((it) => it.y >= titulos.abajo && it.y <= titulos.arriba) : [];
    const datos = halladoAqui ? items.filter((it) => it.y < titulos.abajo) : items;
    Object.assign(meta, Object.fromEntries(Object.entries(metaDeTexto(lineas(arriba).map((l) => l.texto).join(" "))).filter(([k, v]) => v && k !== "pagina" && !meta[k])));
    const sueltos = banda.filter((it) => !titulos.titulos.some((t) => it.x >= t.x0 - 1 && it.x + it.w <= t.x1 + 1));
    if (sueltos.length) notas.push({ pagina: n, texto: lineas(sueltos).map((l) => l.texto).join(" "), aviso: "Texto junto a los títulos." });
    const cortes = cortesDeColumnas(titulos.titulos, datos.filter((it) => it.w < 300));
    const tipos = titulos.titulos.map((t) => t.columna);
    const kRad = tipos.indexOf("radicado");
    // Inicios de registro.
    const enRad = kRad >= 0 ? datos.filter((it) => columnaDe(it, cortes) === kRad && !cruza(it, cortes)) : [];
    let inicios = lineas(enRad, 3).filter((l) => iniciaRadicado(l.texto));
    let sinColumna = false;
    if (!inicios.length && kRad < 0) {
      inicios = lineas(datos, 3).filter((l) => l.items.some((it) => iniciaRadicado(it.str)));
      sinColumna = inicios.length > 0;
    }
    const topes = inicios.map((l) => l.y + Math.max(...l.items.map((i) => i.h)) * 0.6);
    const grupos = topes.map(() => []);
    const antes = [];
    for (const it of datos) {
      let k = -1;
      for (let j = 0; j < topes.length; j++) if (it.y <= topes[j]) k = j;
      if (k < 0) antes.push(it);
      else grupos[k].push(it);
    }
    // Lo que queda entre los títulos y el primer registro: o sigue del último
    // registro de la página anterior, o es texto del estado (pie, firma).
    if (antes.length) {
      const previa = filas[filas.length - 1];
      const deDescripcion = antes.every((it) => ["actuacion", "anotacion"].includes(tipos[columnaDe(it, cortes)]) && !cruza(it, cortes));
      if (previa && deDescripcion && previa.pagina === n - 1) {
        const texto = lineas(antes).map((l) => l.texto).join(" ");
        previa.anotacion = [previa.anotacion, texto].filter(Boolean).join(" ");
        previa.avisos.push(`La anotación sigue en la página ${n}.`);
        if (previa.confianza === "alta") previa.confianza = "media";
      } else notas.push({ pagina: n, texto: lineas(antes).map((l) => l.texto).join("\n"), aviso: "" });
    }
    grupos.forEach((grupo, j) => {
      const { fila, cola } = filaDeGrupo(grupo, { cortes, tipos, pagina: n, ultima: j === grupos.length - 1, origen: pagina.ocr ? "ocr" : origen });
      if (sinColumna) {
        fila.avisos.push("Este estado no tiene columna de radicado; el número se buscó en toda la línea.");
        fila.confianza = "baja";
      }
      filas.push(fila);
      if (cola.length) notas.push({ pagina: n, texto: lineas(cola).map((l) => l.texto).join("\n"), aviso: "" });
    });
    if (!titulos.titulos.some((t) => t.columna === "radicado")) avisos.push(`Página ${n}: no hay columna de radicado.`);
  }
  // Pie del estado: secretario y constancia de fijación.
  for (const nota of notas) {
    const m = /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{5,})\n\s*SECRETARI[OA]\b/.exec(nota.texto);
    if (m && !meta.secretario) meta.secretario = m[1].trim();
  }
  filas.forEach((f, i) => {
    f.id = i + 1;
  });
  return { meta, filas, notas: notas.filter((x) => x.texto || x.aviso), avisos, columnas: columnasUsadas(filas) };
}

function filaDeGrupo(grupo, { cortes, tipos, pagina, ultima, origen }) {
  const avisos = [];
  // Una línea muy por debajo del resto, al final de la página, es el pie.
  const orden = [...grupo].sort((a, b) => b.y - a.y);
  let cola = [];
  if (ultima) {
    for (let i = 1; i < orden.length; i++) {
      const salto = orden[i - 1].y - orden[i].y;
      if (salto > Math.max(28, orden[i].h * 3.2)) {
        cola = orden.slice(i);
        break;
      }
    }
  }
  const dentro = orden.filter((it) => !cola.includes(it));
  const celdas = {};
  const extra = [];
  for (const it of dentro) {
    const k = columnaDe(it, cortes);
    const id = tipos[k] || `extra${k}`;
    (celdas[id] ||= []).push(it);
    if (cruza(it, cortes)) avisos.push(`"${it.str.slice(0, 40)}" cruza dos columnas; quedó en ${COLUMNAS.find((c) => c.id === id)?.nombre || "una columna sin título"}.`);
  }
  const texto = (id) => lineas(celdas[id] || [], 3).map((l) => l.texto);
  const desc = texto("actuacion");
  const tieneAnotacion = tipos.includes("anotacion");
  const fila = {
    pagina,
    origen,
    radicado: "",
    radicadoTexto: texto("radicado").join(" "),
    clase: texto("clase").join(" "),
    demandante: texto("demandante").join(" "),
    demandado: texto("demandado").join(" "),
    actuacion: tieneAnotacion ? desc.join(" ") : desc[0] || "",
    anotacion: tieneAnotacion ? texto("anotacion").join(" ") : desc.slice(1).join(" "),
    fecha: "",
    cuaderno: texto("cuaderno").join(" "),
    folios: texto("folios").join(" "),
    extra: "",
    confianza: "alta",
    avisos,
    caja: cajaDe(dentro, pagina),
  };
  for (const id of Object.keys(celdas)) if (id.startsWith("extra")) extra.push(texto(id).join(" "));
  fila.extra = extra.filter(Boolean).join(" | ");
  if (!fila.radicadoTexto) {
    const suelto = dentro.find((it) => iniciaRadicado(it.str));
    if (suelto) fila.radicadoTexto = lineas(dentro.filter((it) => Math.abs(it.x - suelto.x) < 60), 3).filter((l) => /^\d/.test(l.texto)).map((l) => l.texto.match(/^[\d\s.-]+/)?.[0] || "").join(" ").trim();
  }
  const rad = normalizarRadicadoEstado(fila.radicadoTexto);
  fila.radicado = rad.numero;
  fila.radicadoNota = rad.nota;
  if (rad.aviso) avisos.push(rad.aviso);
  const fechaTexto = texto("fecha").join(" ");
  fila.fecha = fechaCorta(fechaTexto);
  if (!fila.fecha && tipos.includes("fecha")) avisos.push(fechaTexto ? `La fecha "${fechaTexto}" no tiene la forma dd/mm/aaaa.` : "Sin fecha del auto.");
  if (!fila.actuacion) avisos.push("Sin actuación.");
  if (origen === "ocr") avisos.push("Leído con OCR: revise nombres y números.");
  fila.confianza = confianza(fila, rad);
  return { fila, cola };
}

function confianza(fila, rad) {
  if (fila.origen === "texto" || !fila.radicado) return "baja";
  if (fila.origen === "ocr" || rad.aviso || fila.avisos.length) return "media";
  return "alta";
}

function cajaDe(items, pagina) {
  if (!items.length) return null;
  const x0 = Math.min(...items.map((i) => i.x));
  const y0 = Math.min(...items.map((i) => i.y - i.h * 0.25));
  const x1 = Math.max(...items.map((i) => i.x + i.w));
  const y1 = Math.max(...items.map((i) => i.y + i.h));
  return { pagina, x: x0 - 2, y: y0 - 2, w: x1 - x0 + 4, h: y1 - y0 + 4 };
}

function columnasUsadas(filas) {
  return COLUMNAS.filter((c) => filas.some((f) => String(f[c.id] || "").trim())).map((c) => c.id);
}

// ---------- Sin posiciones: OCR sin cajas o texto suelto ----------

// Cada línea que empieza con un radicado abre un registro; lo demás se pega
// al registro abierto. Confianza baja: las columnas no se pueden separar.
export function leerPorLineas(texto, { pagina = 1 } = {}) {
  const filas = [];
  const notas = [];
  let actual = null;
  for (const linea of String(texto || "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    const m = /^(\d{5}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{3}(?:[\s.-]?\d{4}[\s.-]?\d{5}(?:[\s.-]?\d{2})?)?)\s*(.*)$/.exec(linea);
    if (m) {
      actual = { pagina, origen: "texto", radicadoTexto: m[1], resto: [m[2]].filter(Boolean) };
      filas.push(actual);
    } else if (actual) actual.resto.push(linea);
    else notas.push({ pagina, texto: linea, aviso: "" });
  }
  return {
    filas: filas.map((f) => {
      const todo = f.resto.join(" ");
      let radicadoTexto = f.radicadoTexto;
      let cuerpo = todo;
      const anio = /^(\d{4}[\s.-]?\d{5}(?:[\s.-]?\d{2})?)\b\s*/.exec(todo);
      if (radicadoTexto.replace(/\D/g, "").length === 12 && anio) {
        radicadoTexto = `${radicadoTexto} ${anio[1]}`;
        cuerpo = todo.slice(anio[0].length);
      }
      const rad = normalizarRadicadoEstado(radicadoTexto);
      const fecha = fechaCorta(cuerpo);
      return {
        pagina: f.pagina,
        origen: "texto",
        radicado: rad.numero,
        radicadoTexto,
        radicadoNota: rad.nota,
        clase: "",
        demandante: "",
        demandado: "",
        actuacion: cuerpo,
        anotacion: "",
        fecha,
        cuaderno: "",
        folios: "",
        extra: "",
        confianza: "baja",
        avisos: ["Leído sin columnas: el texto del registro quedó junto en Actuación.", rad.aviso].filter(Boolean),
        caja: null,
      };
    }),
    notas,
  };
}

// ---------- Tablas ya armadas (Excel, CSV, Word, HTML) ----------

// tabla: filas de celdas (texto). Busca la fila de títulos en las primeras 15.
export function leerTabla(tabla, { origen = "tabla", pagina = 1 } = {}) {
  const filasCrudas = (tabla || []).map((f) => (f || []).map((c) => String(c ?? "").replace(/\s*\n\s*/g, "\n").trim()));
  let cabeza = -1;
  let tipos = [];
  for (let i = 0; i < Math.min(15, filasCrudas.length); i++) {
    const t = filasCrudas[i].map(columnaDeTitulo);
    const ids = new Set(t.filter(Boolean));
    if (ids.size >= 2 && ids.size > new Set(tipos.filter(Boolean)).size) {
      cabeza = i;
      tipos = t;
    }
  }
  if (cabeza < 0) return null;
  const meta = metaDeTexto(filasCrudas.slice(0, cabeza).flat().join(" "));
  const tieneAnotacion = tipos.includes("anotacion");
  const filas = [];
  const notas = [];
  for (const celdas of filasCrudas.slice(cabeza + 1)) {
    if (!celdas.some(Boolean)) continue;
    const de = (id) => celdas[tipos.indexOf(id)] ?? "";
    if (columnaDeTitulo(de("radicado")) === "radicado") continue;
    const radicadoTexto = de("radicado").replace(/\n/g, " ");
    if (!radicadoTexto && !iniciaRadicado(celdas.join(" ")) && celdas.filter(Boolean).length <= 1) {
      notas.push({ pagina, texto: celdas.filter(Boolean).join(" "), aviso: "" });
      continue;
    }
    const rad = normalizarRadicadoEstado(radicadoTexto);
    const desc = de("actuacion").split("\n").filter(Boolean);
    const extra = celdas.filter((c, k) => c && !tipos[k]).join(" | ");
    const fecha = fechaCorta(de("fecha"));
    const avisos = [rad.aviso, !fecha && tipos.includes("fecha") ? "Sin fecha del auto." : ""].filter(Boolean);
    const fila = {
      pagina,
      origen,
      radicado: rad.numero,
      radicadoTexto,
      radicadoNota: rad.nota,
      clase: de("clase").replace(/\n/g, " "),
      demandante: de("demandante").replace(/\n/g, " "),
      demandado: de("demandado").replace(/\n/g, " "),
      actuacion: tieneAnotacion ? desc.join(" ") : desc[0] || "",
      anotacion: tieneAnotacion ? de("anotacion").replace(/\n/g, " ") : desc.slice(1).join(" "),
      fecha,
      cuaderno: de("cuaderno"),
      folios: de("folios"),
      extra,
      confianza: "alta",
      avisos,
      caja: null,
    };
    fila.confianza = confianza(fila, rad);
    filas.push(fila);
  }
  filas.forEach((f, i) => {
    f.id = i + 1;
  });
  return { meta, filas, notas, avisos: [], columnas: columnasUsadas(filas) };
}

// Tablas de un HTML (también el que sale de un Word). Sin DOM: el proceso
// principal no lo tiene.
export function tablasDeHtml(html) {
  const tablas = [];
  const deco = (s) => s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .trim();
  for (const t of String(html || "").match(/<table[\s\S]*?<\/table>/gi) || []) {
    const filas = [];
    for (const tr of t.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      filas.push((tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(deco));
    }
    if (filas.length) tablas.push(filas);
  }
  return tablas;
}

// ---------- Para la ventana y la exportación ----------

// El radicado que se compara con los expedientes que el usuario sigue.
export function marcarSeguidos(filas, radicadosSeguidos) {
  const set = new Set([...(radicadosSeguidos || [])].map((r) => String(r).replace(/\D/g, "")));
  return filas.map((f) => ({ ...f, seguido: Boolean(f.radicado) && set.has(f.radicado) }));
}

// Las columnas que traen algo, para no pintar columnas vacías.
export function columnasConDatos(filas) {
  return columnasUsadas(filas);
}

export function filtrarFilas(filas, { texto = "", soloSeguidos = false, soloAvisos = false } = {}) {
  const t = normal(texto);
  return filas.filter((f) => {
    if (soloSeguidos && !f.seguido) return false;
    if (soloAvisos && !f.avisos.length) return false;
    if (!t) return true;
    return normal([f.radicado, f.radicadoTexto, f.clase, f.demandante, f.demandado, f.actuacion, f.anotacion, f.fecha].join(" ")).includes(t) || f.radicado.includes(t.replace(/\D/g, "") || "_");
  });
}

const fechaOrden = (f) => {
  const m = RE_FECHA.exec(f || "");
  return m ? `${m[3]}${m[2].padStart(2, "0")}${m[1].padStart(2, "0")}` : "";
};

export function ordenarFilas(filas, campo, sentido = 1) {
  const clave = (f) => (campo === "fecha" ? fechaOrden(f.fecha) : campo === "id" ? String(f.id).padStart(6, "0") : normal(f[campo] || f.radicadoTexto || ""));
  return [...filas].sort((a, b) => {
    const x = clave(a);
    const y = clave(b);
    return (x < y ? -1 : x > y ? 1 : a.id - b.id) * sentido;
  });
}

export const COLUMNAS_EXPORTAR = ["Estado", "Fecha del estado", "Juzgado", "Página", "Radicado", "Radicado como viene", "Clase de proceso", "Demandante", "Demandado", "Actuación", "Anotación", "Fecha auto", "Cuaderno", "Folios", "Otras columnas", "Lo sigo", "Confianza", "Avisos", "Archivo"];

export function filasParaExportar(lotes) {
  const salida = [];
  for (const lote of lotes || []) {
    const m = lote.meta || {};
    for (const f of lote.filas || []) {
      salida.push([m.estado || "", m.fecha || "", m.juzgado || "", f.pagina || "", f.radicado, f.radicadoTexto, f.clase, f.demandante, f.demandado, f.actuacion, f.anotacion, f.fecha, f.cuaderno, f.folios, f.extra, f.seguido ? "Sí" : "No", f.confianza, (f.avisos || []).join(" "), lote.nombre || ""]);
    }
  }
  return salida;
}

// CSV con punto y coma (el Excel en español lo abre así) y BOM.
export function csvDeFilas(columnas, filas) {
  const celda = (v) => {
    const s = String(v ?? "");
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
  };
  return `\uFEFF${[columnas, ...filas].map((f) => f.map(celda).join(";")).join("\r\n")}\r\n`;
}

// Texto para llevar el estado a la IA (Markdown).
export function estadoAMarkdown(lote) {
  const m = lote.meta || {};
  const cabeza = [m.juzgado, m.estado ? `Estado No. ${m.estado}` : "", m.fecha ? `del ${m.fecha}` : ""].filter(Boolean).join(", ");
  const filas = (lote.filas || []).map((f) => `| ${[f.radicado || f.radicadoTexto, f.clase, f.demandante, f.demandado, f.actuacion, f.anotacion, f.fecha].map((c) => String(c || "").replace(/\|/g, "/")).join(" | ")} |`);
  return [`# ${cabeza || lote.nombre || "Estado"}`, "", "| Radicado | Clase | Demandante | Demandado | Actuación | Anotación | Fecha auto |", "| --- | --- | --- | --- | --- | --- | --- |", ...filas, ""].join("\n");
}
