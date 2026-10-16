// SPOA (Fiscalía): el backend devuelve SOAP con un XML escapado adentro.
// RegistroNumero trae la ficha del caso y ACTUACIONES trae movimientos
// `FECHA#DESCRIPCIÓN` separados por `|`. Todo texto plano; los bytes viajan
// en UTF-8 aunque el interior declare otra cosa.

export function normalizarRadicadoSp(nombres) {
  return String(nombres || "").replace(/\D/g, "");
}

function textoDe(bloque, etiqueta) {
  const m = String(bloque || "").match(new RegExp(`<${etiqueta}>([\\s\\S]*?)</${etiqueta}>`));
  return m ? m[1].trim() : "";
}

function dividirLista(valor, separador) {
  return String(valor || "")
    .split(separador)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function parsearActuacionesSp(valor) {
  return dividirLista(valor, "|").map((item) => {
    const corte = item.indexOf("#");
    if (corte < 0) return { fecha: "", descripcion: item };
    return { fecha: item.slice(0, corte).trim(), descripcion: item.slice(corte + 1).trim() };
  });
}

// Saca el XML interior del sobre SOAP y lo devuelve decodificado.
export function interiorSoap(sobre) {
  const m = String(sobre || "").match(/<return[^>]*>([\s\S]*?)<\/return>/);
  if (!m) return "";
  return m[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parsearRegistroSp(bloque) {
  const campo = (etiqueta) => textoDe(bloque, etiqueta);
  return {
    caso_id: campo("CASO_ID"),
    noticia: campo("CASO_NOTICIA"),
    despacho: campo("DESPACHO"),
    unidad: {
      descripcion: campo("UNID_DESCRIPCION"),
      seccional: campo("UNID_SECCIONAL"),
      direccion: campo("UNID_DIRECCION"),
      telefono: campo("UNID_TELEFONO"),
      depto: campo("CASO_DEPA_UNID"),
      muni: campo("CASO_MUNI_UNID"),
    },
    fecha_asignacion: campo("FECHA_ASIGNACION"),
    estado: campo("CASO_ESTADO"),
    etapa: campo("CASO_ETAPA"),
    ley: campo("CASO_LEY"),
    correo: campo("DESP_CORREO"),
    hechos: {
      depto: campo("CASO_DEPA_HECHO"),
      muni: campo("CASO_MUNI_HECHO"),
      fecha: campo("CASO_FECHA_HECHOS"),
    },
    delitos: dividirLista(campo("DELITOS"), "#"),
    reservado: campo("CASO_RESERVADO"),
    conexado: campo("ESTA_CONEXADO"),
    actuaciones: parsearActuacionesSp(campo("ACTUACIONES")),
  };
}

export function parsearRespuestaSp(sobre) {
  const interior = interiorSoap(sobre);
  if (!interior) return { registros: [] };
  const bloques = interior.match(/<RegistroNumero[^>]*>[\s\S]*?<\/RegistroNumero>/g) || [];
  return { registros: bloques.map(parsearRegistroSp) };
}
