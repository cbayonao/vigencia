import { texto } from "../compartido/logica.js";

export function filasCsv(contenido) {
  const filas = [];
  let fila = [];
  let celda = "";
  let comillas = false;
  const fuente = String(contenido || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < fuente.length; i += 1) {
    const c = fuente[i];
    if (comillas) {
      if (c === '"') {
        if (fuente[i + 1] === '"') {
          celda += '"';
          i += 1;
        } else {
          comillas = false;
        }
      } else {
        celda += c;
      }
      continue;
    }
    if (c === '"') {
      comillas = true;
    } else if (c === ",") {
      fila.push(celda);
      celda = "";
    } else if (c === "\n") {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else if (c !== "\r") {
      celda += c;
    }
  }
  if (celda.length || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas.filter((campos, indice) => indice === 0 || campos.some((campo) => String(campo).trim()));
}

export function tablaCsv(contenido) {
  const filas = filasCsv(contenido);
  if (!filas.length) return { campos: [], filas: [] };
  const campos = filas[0].map((campo, indice) => {
    const limpio = String(campo || "").replace(/^\uFEFF/, "").trim();
    return indice === 0 ? limpio : limpio;
  });
  const registros = filas.slice(1).map((valores) => {
    const registro = {};
    campos.forEach((campo, indice) => {
      registro[campo] = valores[indice] ?? "";
    });
    return registro;
  });
  return { campos, filas: registros };
}

export function columna(campos, nombre) {
  const buscado = nombre.toUpperCase();
  return campos.find((campo) => campo && campo.trim().toUpperCase() === buscado) || null;
}

export function radicadosEnTexto(celda) {
  const vistos = new Set();
  const encontrados = [];
  for (const coincidencia of String(celda || "").matchAll(/(?:^|\D)(\d{23})(?!\d)/g)) {
    const numero = coincidencia[1];
    if (vistos.has(numero)) continue;
    vistos.add(numero);
    encontrados.push(numero);
  }
  return encontrados;
}

export function columnasDeRadicado(contenido) {
  const tabla = filasCsv(contenido);
  if (!tabla.length) return [];
  const encabezados = tabla[0].map((campo, indice) => {
    const limpio = String(campo || "").replace(/^\uFEFF/, "").trim();
    return limpio || `Columna ${indice + 1}`;
  });
  return encabezados.map((nombre, indice) => {
    const numeros = [];
    const vistos = new Set();
    for (const fila of tabla.slice(1)) {
      for (const numero of radicadosEnTexto(fila[indice] || "")) {
        if (vistos.has(numero)) continue;
        vistos.add(numero);
        numeros.push(numero);
      }
    }
    return { indice, nombre, cantidad: numeros.length, numeros };
  });
}

export function parsearRadicados(celda) {
  const vistos = new Set();
  const encontrados = [];
  for (const linea of String(celda || "").replaceAll("\r", "").split("\n")) {
    const token = linea.trim();
    if (/^\d+$/.test(token) && !vistos.has(token)) {
      vistos.add(token);
      encontrados.push(token);
    }
  }
  return encontrados;
}

export function parsearJuzgados(celda) {
  const bloques = [];
  let nombres = [];
  const cerrar = (url = null) => {
    const nombre = texto(nombres.join(" "));
    if (nombre || url) bloques.push({ nombre, url });
    nombres = [];
  };
  for (const cruda of String(celda || "").replaceAll("\r", "").split("\n")) {
    const linea = cruda.trim();
    if (!linea) continue;
    if (linea.startsWith("http")) cerrar(linea);
    else nombres.push(linea);
  }
  cerrar();
  return bloques;
}

export function asegurarEnCsv(contenido, numero) {
  let textoCsv = contenido == null ? "RADICADOS\n" : String(contenido);
  const ya = new Set(
    textoCsv.split(/\r?\n/).map((linea) => linea.trim()).filter((linea) => /^\d+$/.test(linea)),
  );
  if (ya.has(numero)) return { texto: textoCsv, agregado: false };
  if (textoCsv && !textoCsv.endsWith("\n")) textoCsv += "\n";
  return { texto: `${textoCsv}${numero}\n`, agregado: true };
}
