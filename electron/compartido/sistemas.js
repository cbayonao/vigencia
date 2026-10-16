// Sistemas de consulta de la barra lateral. La consulta nacional unificada
// y las publicaciones procesales tienen pantalla propia; los demás muestran
// la obra.
export const SISTEMA_INICIAL = "consulta";

export const SISTEMAS = [
  { id: "consulta", nombre: "Consulta nacional unificada", fuente: "Rama Judicial", sigla: "CN", listo: true, fijo: true },
  { id: "micrositio", nombre: "Publicaciones procesales", fuente: "Micrositio", sigla: "PP", listo: true },
  { id: "spoa", nombre: "SPOA", fuente: "Fiscalía General de la Nación", sigla: "SP", listo: true },
  { id: "samai", nombre: "SAMAI", fuente: "Consejo de Estado", sigla: "SA", listo: true },
  { id: "juris", nombre: "Jurisprudencia", fuente: "Relatorías y SAMAI", sigla: "JU", listo: true },
  { id: "externa", nombre: "Consulta externa", fuente: "", sigla: "CE", listo: false },
  { id: "supersociedades", nombre: "Supersociedades", fuente: "Superintendencia de Sociedades", sigla: "SS", listo: false },
  { id: "sic", nombre: "SIC", fuente: "Superintendencia de Industria y Comercio", sigla: "IC", listo: false },
];

export function sistemaDe(id) {
  return SISTEMAS.find((sistema) => sistema.id === id) || null;
}

// Se guarda lo que el abogado quitó, no lo que dejó: un sistema nuevo
// aparece solo. La consulta nacional no se puede quitar.
export function leerOcultos(valor) {
  let lista = [];
  try {
    lista = JSON.parse(String(valor ?? "[]"));
  } catch {
    lista = [];
  }
  if (!Array.isArray(lista)) return new Set();
  return new Set(lista.filter((id) => {
    const sistema = sistemaDe(id);
    return sistema && !sistema.fijo;
  }));
}

export function guardarOcultos(ocultos) {
  return JSON.stringify(SISTEMAS.filter((sistema) => !sistema.fijo && ocultos.has(sistema.id)).map((sistema) => sistema.id));
}

export function sistemasVisibles(ocultos = new Set()) {
  return SISTEMAS.filter((sistema) => sistema.fijo || !ocultos.has(sistema.id));
}

export function sistemaElegible(id, ocultos = new Set()) {
  const sistema = sistemaDe(id);
  if (!sistema || (!sistema.fijo && ocultos.has(id))) return SISTEMA_INICIAL;
  return sistema.id;
}
