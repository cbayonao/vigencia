import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { aplicarPresentante, fichaDeDetalle, redactarEscrito, referenciaCorta } from "../compartido/redactor.js";
import { redactarInicial, TIPOS_INICIALES } from "../compartido/iniciales.js";
import { armarEncargo, clasificarRespuesta, fuentesDelEncargo, marcarCitas } from "../compartido/encargo.js";
import { texto } from "../compartido/logica.js";
import { fechaInforme } from "./informe.js";
import { vistaMemorial } from "./memorial.js";
import { Aviso } from "./db.js";
import { AVISO_MOTOR, entradaDelMotor, esFalloDeMotor, gpuParaPlataforma, prepararReleaseMotor, repararCopiaMotor } from "./motor.js";
import { PROVEEDORES, chatNube } from "./nube.js";

export const MODELO_SENCILLO = "sencillo";

// Instrucción fija para Muse en documentos: rol y formato; los hechos y
// las citas los mandan los lineamientos del encargo, no esto.
export const INSTRUCCION_DOCUMENTO_META = "Eres un abogado litigante en Colombia que redacta memoriales. Sigue los lineamientos del encargo al pie de la letra: no inventes hechos, partes, actuaciones ni citas, y marca lo pendiente en lugar de rellenarlo.";

// Modelos verificados en Hugging Face (oct 2026): repositorio y archivo
// exactos, licencia permisiva o de comunidad y tamaño apto para CPU local.
export const RECOMENDADOS = [
  {
    id: "smolm-360m",
    nombre: "SmolLM2 360M (mínimo)",
    detalle: "~390 MB · 1 GB de RAM · el más liviano, solo para probar. Licencia Apache 2.0.",
    repo: "HuggingFaceTB/SmolLM2-360M-Instruct-GGUF",
    archivo: "smollm2-360m-instruct-q8_0.gguf",
  },
  {
    id: "qwen-05b",
    nombre: "Qwen 0.5B (liviano)",
    detalle: "~400 MB · 2 GB de RAM · rápido, ideal para probar. Licencia Apache 2.0.",
    repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    archivo: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
  },
  {
    id: "qwen3-06b",
    nombre: "Qwen3 0.6B (moderno)",
    detalle: "~650 MB · 2 GB de RAM · generación nueva, bueno con instrucciones. Licencia Apache 2.0.",
    repo: "Qwen/Qwen3-0.6B-GGUF",
    archivo: "Qwen3-0.6B-Q8_0.gguf",
  },
  {
    id: "llama-1b",
    nombre: "Llama 3.2 1B (equilibrado)",
    detalle: "~800 MB · 3 GB de RAM · mejor redacción en español. Licencia Llama 3.2.",
    repo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
    archivo: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
  },
  {
    id: "qwen-15b",
    nombre: "Qwen 1.5B (calidad)",
    detalle: "~1.1 GB · 4 GB de RAM · sigue mejor las instrucciones. Licencia Apache 2.0.",
    repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
    archivo: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
  },
  {
    id: "llama-3b",
    nombre: "Llama 3.2 3B (avanzado)",
    detalle: "~2 GB · 6 GB de RAM · redacción más sólida, más lento en CPU. Licencia Llama 3.2.",
    repo: "bartowski/Llama-3.2-3B-Instruct-GGUF",
    archivo: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
  },
  {
    id: "qwen-3b",
    nombre: "Qwen 3B (avanzado)",
    detalle: "~2 GB · 6 GB de RAM · el más capaz de la lista. Licencia de investigación Qwen.",
    repo: "Qwen/Qwen2.5-3B-Instruct-GGUF",
    archivo: "qwen2.5-3b-instruct-q4_k_m.gguf",
  },
];

export function urlDeModelo(item) {
  return `https://huggingface.co/${item.repo}/resolve/main/${item.archivo}`;
}

export function esGgufValido(ruta) {
  try {
    const fd = fs.openSync(ruta, "r");
    const cabeza = Buffer.alloc(4);
    const leidos = fs.readSync(fd, cabeza, 0, 4, 0);
    fs.closeSync(fd);
    return leidos === 4 && cabeza.toString("ascii") === "GGUF";
  } catch {
    return false;
  }
}

export function descargarArchivo(url, destino, onProgreso, redirecciones = 0) {
  return new Promise((resolve, reject) => {
    if (redirecciones > 5) {
      reject(new Error("Demasiadas redirecciones."));
      return;
    }
    const cliente = url.startsWith("https:") ? https : http;
    const pedido = cliente.get(url, { headers: { "User-Agent": "Vigencia" } }, (respuesta) => {
      const codigo = respuesta.statusCode || 0;
      if (codigo >= 300 && codigo < 400 && respuesta.headers.location) {
        respuesta.resume();
        const siguiente = new URL(respuesta.headers.location, url).toString();
        descargarArchivo(siguiente, destino, onProgreso, redirecciones + 1).then(resolve, reject);
        return;
      }
      if (codigo !== 200) {
        respuesta.resume();
        reject(new Error(`No pude descargar el modelo (código ${codigo}).`));
        return;
      }
      const total = Number(respuesta.headers["content-length"]) || 0;
      let recibidos = 0;
      const archivo = fs.createWriteStream(destino);
      respuesta.on("data", (trozo) => {
        recibidos += trozo.length;
        try {
          onProgreso?.({ recibidos, total });
        } catch {
          /* la ventana ya no escucha */
        }
      });
      respuesta.on("error", (error) => {
        archivo.destroy();
        reject(error);
      });
      archivo.on("error", reject);
      archivo.on("finish", () => resolve({ recibidos, total }));
      respuesta.pipe(archivo);
    });
    pedido.on("error", reject);
  });
}

export async function descargarModelo(datosDir, id, onProgreso) {
  const item = RECOMENDADOS.find((modelo) => modelo.id === id);
  if (!item) throw new Aviso("Ese modelo no está en el catálogo.");
  const carpeta = carpetaModelos(datosDir);
  fs.mkdirSync(carpeta, { recursive: true });
  const destino = path.join(carpeta, item.archivo);
  if (fs.existsSync(destino) && esGgufValido(destino)) {
    return { id: `gguf:${item.archivo}`, yaEstaba: true };
  }
  const temporal = `${destino}.descarga`;
  try {
    await descargarArchivo(urlDeModelo(item), temporal, (avance) => {
      try {
        onProgreso?.({ id, ...avance });
      } catch {
        /* la ventana ya no escucha */
      }
    });
  } catch (error) {
    fs.rmSync(temporal, { force: true });
    throw new Aviso(error?.message || "No pude descargar el modelo. Revise la conexión.");
  }
  if (!esGgufValido(temporal)) {
    fs.rmSync(temporal, { force: true });
    throw new Aviso("Lo descargado no es un modelo GGUF válido.");
  }
  fs.renameSync(temporal, destino);
  return { id: `gguf:${item.archivo}`, yaEstaba: false };
}

export function modelosRecomendados(datosDir) {
  const instalados = new Set(ggufInstalados(datosDir).map((modelo) => modelo.archivo));
  return RECOMENDADOS.map((item) => ({
    id: item.id,
    nombre: item.nombre,
    detalle: item.detalle,
    instalado: instalados.has(item.archivo),
  }));
}

function tienda(datosDir) {
  return path.join(datosDir, "ia-modelos.json");
}

function carpetaModelos(datosDir) {
  return path.join(datosDir, "modelos");
}

function leerTienda(datosDir) {
  try {
    const bruto = fs.readFileSync(tienda(datosDir), "utf8");
    const dato = JSON.parse(bruto);
    return {
      activo: typeof dato?.activo === "string" && dato.activo ? dato.activo : MODELO_SENCILLO,
      modo: dato?.modo === "libre" ? "libre" : "fiel",
      nubes: dato?.nubes && typeof dato.nubes === "object" ? dato.nubes : {},
    };
  } catch {
    /* primera vez: sencillo y fiel */
  }
  return { activo: MODELO_SENCILLO, modo: "fiel", nubes: {} };
}

function escribirTienda(datosDir, dato) {
  fs.mkdirSync(datosDir, { recursive: true });
  fs.writeFileSync(tienda(datosDir), JSON.stringify(dato, null, 2), "utf8");
  try {
    fs.chmodSync(tienda(datosDir), 0o600);
  } catch {
    /* las claves quedan igual de guardadas */
  }
}

function tamanoAmable(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function ggufInstalados(datosDir) {
  const carpeta = carpetaModelos(datosDir);
  let archivos = [];
  try {
    archivos = fs.readdirSync(carpeta);
  } catch {
    return [];
  }
  const lista = [];
  for (const nombre of archivos) {
    if (!nombre.toLowerCase().endsWith(".gguf")) continue;
    let tamano = "";
    try {
      tamano = tamanoAmable(fs.statSync(path.join(carpeta, nombre)).size);
    } catch {
      tamano = "";
    }
    lista.push({
      id: `gguf:${nombre}`,
      nombre: nombre.replace(/\.gguf$/i, ""),
      detalle: `GGUF local · corre en este computador${tamano ? ` · ${tamano}` : ""}`,
      instalado: true,
      archivo: nombre,
    });
  }
  return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function listarModelos(datosDir) {
  const tiendaDato = leerTienda(datosDir);
  const modelos = [
    {
      id: MODELO_SENCILLO,
      nombre: "Sencillo (plantilla básica)",
      detalle: "Sin modelo. Arma el memorial con la plantilla de siempre y no usa la biblioteca.",
      instalado: true,
    },
    ...ggufInstalados(datosDir),
    // En la nube solo aparecen los proveedores con clave guardada: lo que
    // no está configurado no se ofrece al generar el documento.
    ...Object.entries(PROVEEDORES)
      .filter(([id]) => Boolean(tiendaDato.nubes[id]?.key))
      .map(([id, definicion]) => {
        const nube = tiendaDato.nubes[id] || {};
        return {
          id: `nube:${id}`,
          nombre: `${definicion.nombre} (nube)`,
          detalle: `Con su clave · modelo ${nube.modelo || definicion.modeloSugerido}`,
          instalado: true,
        };
      }),
  ];
  const activo = modelos.some((modelo) => modelo.id === tiendaDato.activo)
    ? tiendaDato.activo
    : MODELO_SENCILLO;
  return { modelos, activo, modo: tiendaDato.modo };
}

export function guardarActivo(datosDir, id) {
  const { modelos } = listarModelos(datosDir);
  if (!modelos.some((modelo) => modelo.id === id)) {
    throw new Aviso("Ese modelo no está disponible.");
  }
  const tiendaDato = leerTienda(datosDir);
  tiendaDato.activo = id;
  escribirTienda(datosDir, tiendaDato);
  return listarModelos(datosDir);
}

export function guardarModo(datosDir, modo) {
  const tiendaDato = leerTienda(datosDir);
  tiendaDato.modo = modo === "libre" ? "libre" : "fiel";
  escribirTienda(datosDir, tiendaDato);
  return listarModelos(datosDir);
}

export function leerNubes(datosDir) {
  const tiendaDato = leerTienda(datosDir);
  return Object.entries(PROVEEDORES).map(([id, definicion]) => {
    const nube = tiendaDato.nubes[id] || {};
    return {
      id,
      nombre: definicion.nombre,
      modelo: nube.modelo || definicion.modeloSugerido || "",
      modelos: definicion.modelos || [],
      base: id === "custom" ? (nube.base || "") : definicion.base,
      tieneClave: Boolean(nube.key),
      huellaClave: nube.key ? `${nube.key.slice(0, 8)}… (${nube.key.length} caracteres)` : "",
      claveAyuda: definicion.claveAyuda || "",
      clavePrefijos: definicion.clavePrefijos || [],
      editableBase: id === "custom",
    };
  });
}

export function guardarNube(datosDir, { proveedor, key, modelo, base }) {
  const definicion = PROVEEDORES[proveedor];
  if (!definicion) throw new Aviso("Ese proveedor no está soportado.");
  const tiendaDato = leerTienda(datosDir);
  const anterior = tiendaDato.nubes[proveedor] || {};
  const limpia = (valor) => String(valor || "").trim().replace(/^["'](.+)["']$/, "$1").trim();
  tiendaDato.nubes[proveedor] = {
    key: limpia(key) || anterior.key || "",
    modelo: limpia(modelo) || anterior.modelo || "",
    base: proveedor === "custom" ? (limpia(base) || anterior.base || "") : "",
  };
  if (!tiendaDato.nubes[proveedor].key) throw new Aviso("Escriba su clave del proveedor.");
  escribirTienda(datosDir, tiendaDato);
  return { nubes: leerNubes(datosDir), ...listarModelos(datosDir) };
}

function nombreSeguro(nombre) {
  const base = path.basename(String(nombre || "modelo.gguf"));
  const limpio = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "modelo.gguf";
  return limpio.toLowerCase().endsWith(".gguf") ? limpio : `${limpio}.gguf`;
}

export function importarModelo(datosDir, origen) {
  if (!origen || !String(origen).toLowerCase().endsWith(".gguf")) {
    throw new Aviso("El archivo debe ser un modelo .gguf.");
  }
  let stat = null;
  try {
    stat = fs.statSync(origen);
  } catch {
    throw new Aviso("No pude leer ese archivo.");
  }
  if (!stat.isFile()) throw new Aviso("No pude leer ese archivo.");
  const carpeta = carpetaModelos(datosDir);
  fs.mkdirSync(carpeta, { recursive: true });
  const destino = path.join(carpeta, nombreSeguro(origen));
  fs.copyFileSync(origen, destino);
  return { id: `gguf:${path.basename(destino)}` };
}

// El modelo sencillo no inventa nada: parte del redactor (hechos de la
// petición, última actuación y fundamentos conocidos) y solo pule la forma:
// conectores sobrios y peticiones en tono respetuoso. Los fundamentos quedan
// intactos para no citar normas nuevas.
// --- Motor GGUF (node-llama-cpp, 100% local) ---
// Electron usa su propio asignador. Un bloque alineado de cerca de 1 GB lo
// tumba con SIGILL. El contexto se queda por debajo de ese tamaño, y un
// modelo cuyo archivo ya pasa de 900 MB no se carga.
const TOPE_BLOQUE = 480 * 1024 * 1024;
const TOPE_MODELO = 900 * 1024 * 1024;
const CONTEXTO_MIN = 2048;
const CONTEXTO_MAX = 16384;
let motor = null; // { ruta, llama, modelo, cpp }

function enteroPositivo(valor) {
  if (Array.isArray(valor)) return enteroPositivo(valor[0]);
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return 0;
  return Math.floor(numero);
}

export function bytesPorToken(meta) {
  const capas = enteroPositivo(meta?.block_count);
  const atencion = meta?.attention || {};
  const cabezas = enteroPositivo(atencion.head_count);
  const cabezasKv = enteroPositivo(atencion.head_count_kv) || cabezas;
  const largo = enteroPositivo(atencion.key_length)
    || (cabezas ? Math.floor(enteroPositivo(meta?.embedding_length) / cabezas) : 0);
  if (!capas || !cabezasKv || !largo) return 0;
  return 2 * capas * cabezasKv * largo * 2;
}

export function cabeElModelo(bytes) {
  return Number(bytes) <= TOPE_MODELO;
}

export function tamanoDeContexto(meta) {
  const porToken = bytesPorToken(meta);
  if (!porToken) return CONTEXTO_MIN;
  const cabe = Math.floor(TOPE_BLOQUE / porToken);
  const ajustado = cabe - (cabe % 256);
  return Math.max(CONTEXTO_MIN, Math.min(CONTEXTO_MAX, ajustado));
}

async function intentarArrancar() {
  const entrada = entradaDelMotor();
  const llamaCpp = entrada ? await import(pathToFileURL(entrada).href) : await import("node-llama-cpp");
  const llama = await llamaCpp.getLlama({ gpu: gpuParaPlataforma() });
  return { llamaCpp, llama };
}

async function cargarMotor(ruta) {
  if (motor?.ruta === ruta && motor?.modelo) return motor;
  await soltarMotor();
  prepararReleaseMotor();
  let stat = null;
  try {
    stat = fs.statSync(ruta);
  } catch {
    throw new Aviso("No encontré el archivo del modelo en la carpeta de modelos.");
  }
  if (!stat.isFile()) throw new Aviso("No encontré el archivo del modelo en la carpeta de modelos.");
  if (!cabeElModelo(stat.size)) {
    throw new Aviso("Ese modelo no cabe en la ventana. Use uno más pequeño, como el de 1B, o el modelo Sencillo.");
  }
  let arranque = null;
  try {
    arranque = await intentarArrancar();
  } catch (error) {
    console.error(error);
    if (!esFalloDeMotor(error)) throw error;
    // La copia en datos pudo quedar incompleta: se repara una vez y se
    // reintenta (los binarios descargados se conservan).
    try {
      repararCopiaMotor();
    } catch (errorReparo) {
      console.error(errorReparo);
    }
    try {
      arranque = await intentarArrancar();
    } catch (error2) {
      console.error(error2);
      throw new Aviso(AVISO_MOTOR);
    }
  }
  const { llamaCpp, llama } = arranque;
  const modelo = await llama.loadModel({ modelPath: ruta });
  motor = { ruta, llama, modelo, cpp: llamaCpp };
  return motor;
}

async function soltarMotor() {
  if (!motor) return;
  const { llama, modelo } = motor;
  motor = null;
  try {
    await modelo.dispose();
  } catch {
    /* ya estaba liberado */
  }
  try {
    await llama.dispose();
  } catch {
    /* ya estaba liberado */
  }
}

function sinNumero(linea) {
  return String(linea).replace(/^\s*(?:\d+[).\-:]|[-*•])\s*/, "").trim();
}

// Contexto rico para el modelo: todo lo que la app sabe del expediente,
// para que el borrador salga completo sin inventar nada fuera de esto.
export function contextoExpediente(ficha, proceso, maxActuaciones = 10) {
  const lineas = [];
  lineas.push(`Juzgado: ${ficha.despacho || "no figura"}`);
  lineas.push(`Radicado: ${ficha.radicado || "sin número"}`);
  const procesoLinea = [ficha.tipo_proceso, ficha.clase_proceso].filter(Boolean).join(" · ");
  if (procesoLinea) lineas.push(`Proceso: ${procesoLinea}`);
  if (ficha.departamento) lineas.push(`Departamento: ${ficha.departamento}`);
  lineas.push(`Demandante: ${ficha.demandantes || "no figura"}`);
  lineas.push(`Demandado: ${ficha.demandados || "no figura"}`);
  if (ficha.cliente) lineas.push(`Abogado: ${ficha.cliente}`);
  if (ficha.cedula) lineas.push(`Cédula del abogado: ${ficha.cedula}`);
  if (ficha.tarjeta) lineas.push(`Tarjeta profesional: ${ficha.tarjeta}`);
  if (ficha.telefonos) lineas.push(`Teléfonos del abogado: ${ficha.telefonos}`);
  if (ficha.direccion) lineas.push(`Dirección del abogado: ${ficha.direccion}`);
  if (ficha.email) lineas.push(`Correo del abogado: ${ficha.email}`);
  if (ficha.representado) {
    const lado = ficha.representadoRol ? ` (${ficha.representadoRol})` : "";
    lineas.push(`Representa a: ${ficha.representado}${lado}`);
  }
  if (ficha.representadoCedula) lineas.push(`Cédula del representado: ${ficha.representadoCedula}`);
  if (ficha.representadoDireccion) lineas.push(`Dirección del representado: ${ficha.representadoDireccion}`);
  if (ficha.representadoTelefono) lineas.push(`Teléfono del representado: ${ficha.representadoTelefono}`);
  const actos = (proceso?.actuaciones || []).slice(0, maxActuaciones);
  if (actos.length) {
    lineas.push(`Últimas ${actos.length} actuaciones (de la más reciente a la más antigua):`);
    for (const acto of actos) {
      const fecha = String(acto.fecha_actuacion || "").slice(0, 10) || "sin fecha";
      const que = String(acto.actuacion || "sin descripción").slice(0, 280);
      const nota = String(acto.anotacion || "").slice(0, 280);
      lineas.push(`- ${fecha}: ${que}${nota ? ` Anotación: ${nota}` : ""}`);
    }
  } else {
    lineas.push("Sin actuaciones registradas.");
  }
  return lineas.join("\n");
}

const VACIAS = new Set("de,la,el,en,y,a,los,las,del,al,se,que,por,con,para,un,una,su,sus,este,esta,esto,como,más,pero,sin,sobre,entre,hasta,desde,donde,cuando,muy,tan,tanto".split(","));

function palabras(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((palabra) => palabra.length > 2 && !VACIAS.has(palabra));
}

// Mide si la reescritura conserva el sentido del punto base (traslape de
// palabras). Así el modo fiel descarta los inventos del modelo.
export function semejantes(original, reescrito, umbral = 0.3) {
  const base = new Set(palabras(original));
  const nuevo = new Set(palabras(reescrito));
  if (!base.size || !nuevo.size) return false;
  let comunes = 0;
  for (const palabra of nuevo) if (base.has(palabra)) comunes += 1;
  return comunes / new Set([...base, ...nuevo]).size >= umbral;
}

// En modo fiel solo entra la reescritura que conserva las palabras del
// punto base; en modo libre entra el texto del modelo tal cual (con la
// limpieza del extractor) aunque alucine. Sin puntos, siempre el redactor.
export function filtrarPorModo(items, puntos, modo) {
  if (modo === "libre") return puntos.length ? puntos : items;
  return items.map((original, i) => {
    const candidato = puntos[i];
    if (candidato && semejantes(original.replace(/^\d+\.\s*/, ""), candidato)) return candidato;
    return items[i];
  });
}

export function extraerPuntos(respuesta, maximo = 12) {
  const puntos = [];
  for (const cruda of String(respuesta || "").split(/\n+/)) {
    let linea = cruda.replaceAll("**", "").trim();
    linea = sinNumero(linea);
    if (!linea || /^[[#]/.test(linea)) continue;
    if (/^(enfoque|justificaci[oó]n|notas?|respuesta|hechos?|peticiones|fundamentos?)\b/i.test(linea)) continue;
    linea = linea.replace(/[.!?]+$/g, "").trim();
    if (linea.length > 3 && !/insertar|rellenar|ejemplo|lo siento|no puedo (cumplir|ayudar|redactar)/i.test(linea)) puntos.push(`${linea}.`);
    if (puntos.length >= maximo) break;
  }
  return puntos;
}

function emitirEscrito(onProgreso, texto) {
  try {
    onProgreso?.({ seccion: "Escrito", texto });
  } catch {
    /* la ventana ya no escucha */
  }
}

function respuestaInservible(valor) {
  const limpio = String(valor || "").trim();
  if (!limpio) return true;
  return limpio.length < 400 && /lo siento|no puedo (cumplir|ayudar|redactar)|como modelo de lenguaje/i.test(limpio);
}

async function textoDelModelo({ datosDir, elegido, encargo, onProgreso, maxTokens, onUso = null }) {
  if (elegido.id.startsWith("nube:")) {
    const proveedor = elegido.id.slice("nube:".length);
    const tiendaDato = leerTienda(datosDir);
    const nube = tiendaDato.nubes[proveedor] || {};
    const definicion = PROVEEDORES[proveedor];
    if (!definicion) throw new Aviso("Ese proveedor no está soportado.");
    if (!nube.key) throw new Aviso(`Guarde su clave de ${definicion.nombre} primero.`);
    const modelo = nube.modelo || definicion.modeloSugerido;
    if (!modelo) throw new Aviso(`Escriba el nombre del modelo de ${definicion.nombre}.`);
    let acumulado = "";
    const respuesta = await chatNube({
      proveedor,
      key: nube.key,
      modelo,
      base: nube.base,
      texto: encargo,
      maxTokens: maxTokens?.nube || 2048,
      instrucciones: proveedor === "meta" ? INSTRUCCION_DOCUMENTO_META : "",
      onUso: (uso) => {
        try {
          onUso?.({ ...uso, proveedor, modelo });
        } catch {
          /* medir no tumba la redacción */
        }
      },
      onToken: (fragmento) => {
        acumulado += fragmento;
        emitirEscrito(onProgreso, acumulado);
      },
    });
    return {
      texto: String(respuesta || acumulado || ""),
      nombre: `${definicion.nombre} · ${modelo}`,
      origen: "nube",
    };
  }
  if (elegido.id.startsWith("gguf:")) {
    const rutaModelo = path.join(carpetaModelos(datosDir), elegido.archivo);
    const cargado = await cargarMotor(rutaModelo);
    let meta = null;
    try {
      if (cargado.cpp.readGgufFileInfo) {
        const info = await cargado.cpp.readGgufFileInfo(rutaModelo);
        meta = info?.architectureMetadata || null;
      }
    } catch {
      meta = null;
    }
    const contexto = await cargado.modelo.createContext({
      contextSize: tamanoDeContexto(meta),
    });
    try {
      const sesion = new cargado.cpp.LlamaChatSession({
        contextSequence: contexto.getSequence(),
      });
      let acumulado = "";
      const respuesta = await sesion.prompt(encargo, {
        maxTokens: maxTokens?.local || 1536,
        temperature: 0.3,
        onTextChunk: (fragmento) => {
          acumulado += String(fragmento || "");
          emitirEscrito(onProgreso, acumulado);
        },
      });
      return {
        texto: String(respuesta || acumulado || ""),
        nombre: elegido.nombre,
        origen: "local",
      };
    } finally {
      try {
        await contexto.dispose();
      } catch {
        /* el contexto se libera con el modelo */
      }
    }
  }
  return null;
}

function aclaracionUtil(aclaracion) {
  const respuesta = String(aclaracion?.respuesta ?? "").replace(/\r\n/g, "\n").trim();
  if (!respuesta) return null;
  const preguntas = (Array.isArray(aclaracion?.preguntas) ? aclaracion.preguntas : [])
    .map((pregunta) => texto(pregunta))
    .filter(Boolean)
    .slice(0, 4);
  return { preguntas, respuesta };
}

function documentoDeModelo(pedido, fuentes, cerrar) {
  if (!pedido || respuestaInservible(pedido.texto)) {
    throw new Error("El modelo no devolvió el memorial.");
  }
  const clasificado = clasificarRespuesta(pedido.texto, { cerrar });
  if (clasificado.tipo === "dudas") return { dudas: clasificado.preguntas };
  const secciones = marcarCitas(clasificado.secciones, fuentes);
  if (!secciones.length) throw new Error("El modelo no devolvió el memorial.");
  return { asunto: clasificado.asunto, secciones };
}

export function pulirConSencillo(base) {  const secciones = (base.secciones || []).map((seccion) => ({
    titulo: seccion.titulo,
    parrafos: [...(seccion.parrafos || [])],
  }));
  const buscar = (titulo) => secciones.find((seccion) => seccion.titulo === titulo);
  const presentacion = buscar("Presentación");
  if (presentacion?.parrafos.length) {
    presentacion.parrafos[0] = presentacion.parrafos[0].replace(
      /ante su despacho\.$/,
      "ante su despacho, con apoyo en lo que ya consta en el expediente.",
    );
  }
  const peticiones = buscar("Peticiones");
  if (peticiones) {
    peticiones.parrafos = peticiones.parrafos.map((item) => {
      const limpio = String(item).replace(/^\d+\.\s*/, "").trim();
      if (/^(respetuosamente|solicito|se solicita)/i.test(limpio)) return item;
      return item.replace(limpio, `Respetuosamente, ${limpio.charAt(0).toLowerCase()}${limpio.slice(1)}`);
    });
  }
  return { asunto: base.asunto, secciones };
}

function elegirModelo(datosDir, modeloId) {
  const { modelos, activo } = listarModelos(datosDir);
  return modelos.find((modelo) => modelo.id === (modeloId || activo)) || modelos[0];
}

function usaModelo(elegido) {
  return Boolean(elegido?.id?.startsWith("nube:") || elegido?.id?.startsWith("gguf:"));
}

async function conEncargo({ datosDir, elegido, encargo, fuentes, onProgreso, plantilla, aclaracion, onUso = null }) {
  try {
    const pedido = await textoDelModelo({ datosDir, elegido, encargo, onProgreso, onUso });
    const escrito = documentoDeModelo(pedido, fuentes, Boolean(aclaracion));
    if (escrito.dudas) {
      return {
        dudas: escrito.dudas,
        modelo: { id: elegido.id, nombre: pedido.nombre },
        origen: pedido.origen,
        respaldo: false,
      };
    }
    return {
      asunto: escrito.asunto,
      secciones: escrito.secciones,
      modelo: { id: elegido.id, nombre: pedido.nombre },
      origen: pedido.origen,
      respaldo: false,
    };
  } catch (error) {
    if (error instanceof Aviso) throw error;
    if (elegido.id.startsWith("gguf:")) await soltarMotor();
    console.error(error);
    return {
      asunto: plantilla.asunto,
      secciones: plantilla.secciones,
      modelo: { id: MODELO_SENCILLO, nombre: "Plantilla básica" },
      origen: "local",
      respaldo: true,
    };
  }
}

function conVista(resultado, ficha, hoy) {
  if (resultado.dudas) {
    return {
      dudas: resultado.dudas,
      modelo: resultado.modelo,
      origen: resultado.origen,
      respaldo: false,
    };
  }
  return {
    ...resultado,
    vista: vistaMemorial({
      asunto: resultado.asunto,
      secciones: resultado.secciones,
      ficha,
      fecha: hoy,
      origen: resultado.origen,
    }),
  };
}

export async function generarBorrador({ datosDir, proceso, prompt, hoy, modeloId, onProgreso, piezas, excluir, aclaracion, referencia, presenta, ejemplo, onUso = null }) {
  const pedido = texto(prompt);
  if (!pedido) {
    const error = new Error("Escriba qué debe decir el escrito.");
    error.aviso = true;
    throw error;
  }
  const elegido = elegirModelo(datosDir, modeloId);
  const ficha = aplicarPresentante(fichaDeDetalle(proceso), proceso, presenta);
  ficha.referencia = referenciaCorta(referencia, pedido);
  const hoyLargo = fechaInforme(String(hoy || "").slice(0, 10));
  let base = null;
  try {
    base = redactarEscrito({ expediente: ficha, prompt: pedido, hoy: hoyLargo });
  } catch (error) {
    if (error?.aviso) throw new Aviso(error.message);
    throw error;
  }
  const plantilla = pulirConSencillo(base);
  let resultado = {
    asunto: plantilla.asunto,
    secciones: plantilla.secciones,
    modelo: { id: elegido.id, nombre: elegido.nombre },
    origen: "local",
    respaldo: false,
  };
  const vuelta = aclaracionUtil(aclaracion);
  if (usaModelo(elegido)) {
    const contexto = contextoExpediente(ficha, proceso);
    const encargo = armarEncargo({
      contexto,
      peticion: pedido,
      piezas,
      excluir,
      hoy: hoyLargo,
      aclaracion: vuelta,
      ejemplo,
      referencia: ficha.referencia,
    });
    resultado = await conEncargo({
      datosDir,
      elegido,
      encargo,
      fuentes: fuentesDelEncargo({ contexto, peticion: pedido, piezas, excluir, aclaracion: vuelta, ejemplo }),
      onProgreso,
      plantilla,
      aclaracion: vuelta,
      onUso,
    });
  }
  return conVista(resultado, ficha, hoy);
}

function materialInicial(tipo, datos) {
  const definicion = TIPOS_INICIALES[tipo] || {};
  const campos = [
    ["Documento", definicion.titulo],
    ["Ciudad", datos.ciudad],
    ["Quien presenta", datos.presentante],
    ["Identificación", datos.identificacion],
    ["Domicilio", datos.domicilio],
    ["Contraparte", datos.contraparte],
    ["Autoridad", datos.autoridad],
    ["Hechos", datos.hechos],
    ["Lo que pide", datos.pretensiones],
    ["Pruebas", datos.pruebas],
    ["Cuantía", datos.cuantia],
    ["Derecho", datos.derecho],
  ];
  const lineas = [];
  for (const [etiqueta, valor] of campos) {
    const limpio = texto(valor);
    if (limpio) lineas.push(`${etiqueta}: ${limpio}`);
  }
  if (datos.juramento) lineas.push("La persona jura no haber presentado otra tutela por estos hechos.");
  if (texto(datos.instruccion)) lineas.push(`Instrucción: ${texto(datos.instruccion)}`);
  return lineas.join("\n");
}

export async function generarInicial({ datosDir, tipo, datos = {}, hoy, modeloId, onProgreso, piezas, excluir, aclaracion, onUso = null }) {
  const definicion = TIPOS_INICIALES[tipo];
  if (!definicion) {
    throw new Aviso("Elija si inicia demanda, tutela o derecho de petición.");
  }
  const elegido = elegirModelo(datosDir, modeloId);
  const hoyLargo = fechaInforme(String(hoy || "").slice(0, 10));
  let base = null;
  try {
    base = redactarInicial({ tipo, datos, hoy: hoyLargo });
  } catch (error) {
    if (error?.aviso) throw new Aviso(error.message);
    throw error;
  }
  const ficha = {
    despacho: datos.autoridad,
    radicado: "sin radicar",
    tipo_proceso: `Documento inicial · ${definicion.titulo}`,
    demandantes: datos.presentante,
    demandados: datos.contraparte,
  };
  let resultado = {
    asunto: base.asunto,
    secciones: base.secciones,
    modelo: { id: elegido.id, nombre: elegido.nombre },
    origen: "local",
    respaldo: false,
  };
  const vuelta = aclaracionUtil(aclaracion);
  if (usaModelo(elegido)) {
    const material = materialInicial(tipo, datos);
    const peticion = texto(datos.instruccion) || `Redacte la ${definicion.titulo.toLowerCase()} con los datos del contexto.`;
    resultado = await conEncargo({
      datosDir,
      elegido,
      encargo: armarEncargo({
        contexto: material,
        peticion,
        piezas,
        excluir,
        hoy: hoyLargo,
        aclaracion: vuelta,
      }),
      fuentes: fuentesDelEncargo({ contexto: material, peticion, piezas, excluir, aclaracion: vuelta }),
      onProgreso,
      plantilla: base,
      aclaracion: vuelta,
      onUso,
    });
  }
  return conVista(resultado, ficha, hoy);
}

// Documentos usa el mismo camino que el escrito: GGUF local o nube con la
// clave del usuario. Devuelve null con el modelo Sencillo.
export function modeloParaDocumento(datosDir, modeloId) {
  const elegido = elegirModelo(datosDir, modeloId);
  return { id: elegido.id, nombre: elegido.nombre, usa: usaModelo(elegido), origen: elegido.id.startsWith("nube:") ? "nube" : "local" };
}

export async function textoParaDocumento({ datosDir, modeloId, encargo, onProgreso, onUso = null }) {
  const elegido = elegirModelo(datosDir, modeloId);
  if (!usaModelo(elegido)) return null;
  try {
    return await textoDelModelo({ datosDir, elegido, encargo, onProgreso, maxTokens: { nube: 4096, local: 2048 }, onUso });
  } catch (error) {
    if (elegido.id.startsWith("gguf:")) await soltarMotor();
    throw error;
  }
}
