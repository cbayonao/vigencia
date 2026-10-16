// Publicaciones procesales: red con sesión propia y carga en segundo plano.
// El portlet exige JSESSIONID: se visita el inicio, se guardan las cookies
// a mano (fetch no tiene jarra) y se reenvían. Pausa de 1 a 3 s al azar
// entre peticiones y reintentos como el resto de la consulta.
import { pausaAleatoriaMs } from "../compartido/logica.js";
import {
  PP_INICIO,
  PP_NS,
  PP_PORTLET,
  PP_PORTLET_ID,
  PP_POR_PAGINA,
  extraerDocumentos,
  extraerFilas,
  totalDe,
} from "../compartido/pp.js";
import { run, transaccion, uno } from "./db.js";

const CABECERAS = {
  accept: "*/*",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
};

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const pausa = () => dormir(pausaAleatoriaMs());

export function crearSesion() {
  return { cookies: "" };
}

function guardarCookies(sesion, respuesta) {
  const hechas = typeof respuesta.headers?.getSetCookie === "function" ? respuesta.headers.getSetCookie() : [];
  const mapa = new Map();
  for (const par of String(sesion.cookies || "").split(/;\s*/).filter(Boolean)) {
    const i = par.indexOf("=");
    if (i > 0) mapa.set(par.slice(0, i), par.slice(i + 1));
  }
  for (const cruda of hechas) {
    const par = String(cruda).split(";")[0];
    const i = par.indexOf("=");
    if (i > 0) mapa.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
  sesion.cookies = [...mapa].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function pedir(sesion, params, veces = 3) {
  let ultimo = "sin respuesta";
  for (let intento = 1; intento <= veces; intento++) {
    let respuesta = null;
    try {
      const destino = new URL(PP_INICIO);
      for (const [clave, valor] of Object.entries(params || {})) destino.searchParams.set(clave, String(valor));
      const cabeceras = { ...CABECERAS };
      if (sesion.cookies) cabeceras.cookie = sesion.cookies;
      respuesta = await fetch(destino, { headers: cabeceras, signal: AbortSignal.timeout(120000) });
    } catch (error) {
      ultimo = String(error?.message || error);
      await dormir(intento * 2000);
      continue;
    }
    guardarCookies(sesion, respuesta);
    if ([429, 500, 502, 503, 504].includes(respuesta.status)) {
      ultimo = `HTTP ${respuesta.status}`;
      await dormir(intento * 2000);
      continue;
    }
    if (respuesta.status === 403) {
      ultimo = "HTTP 403";
      await dormir(20000 * intento);
      continue;
    }
    if (!respuesta.ok) {
      ultimo = `HTTP ${respuesta.status}`;
      await dormir(intento * 2000);
      continue;
    }
    return await respuesta.text();
  }
  throw new Error(ultimo);
}

export async function abrirSesion() {
  const sesion = crearSesion();
  await pedir(sesion, {});
  return sesion;
}

function paramsBusqueda(depto, despacho, pagina) {
  const params = {
    p_p_id: PP_PORTLET,
    p_p_lifecycle: "0",
    p_p_state: "normal",
    p_p_mode: "view",
    [`${PP_NS}action`]: "busqueda",
    [`${PP_NS}idDepto`]: depto,
    [`${PP_NS}idDespacho`]: despacho,
    [`${PP_NS}verTotales`]: "true",
    [`${PP_NS}idDeptoIdCategory`]: PP_PORTLET_ID,
  };
  if (pagina > 1) {
    params[`${PP_NS}resetCur`] = "false";
    params[`${PP_NS}cur`] = String(pagina);
  }
  return params;
}

export async function buscarPagina(sesion, depto, despacho, pagina) {
  const html = await pedir(sesion, paramsBusqueda(depto, despacho, pagina));
  return { filas: extraerFilas(html), total: totalDe(html) };
}

export async function traerDocumentos(sesion, detalleUrl) {
  const destino = new URL(detalleUrl, PP_INICIO);
  let ultimo = "sin respuesta";
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const cabeceras = { ...CABECERAS, accept: "text/html" };
      if (sesion.cookies) cabeceras.cookie = sesion.cookies;
      const respuesta = await fetch(destino, { headers: cabeceras, signal: AbortSignal.timeout(120000) });
      guardarCookies(sesion, respuesta);
      if (!respuesta.ok) {
        ultimo = `HTTP ${respuesta.status}`;
        await dormir(intento * 2000);
        continue;
      }
      return extraerDocumentos(await respuesta.text());
    } catch (error) {
      ultimo = String(error?.message || error);
      await dormir(intento * 2000);
    }
  }
  throw new Error(ultimo);
}

function guardarFila(db, despacho, fila) {
  return transaccion(db, () => {
    run(db, `INSERT OR IGNORE INTO pp_publicacion
      (despacho, article_id, titulo, fecha, url, detalle_url, tipo, entidad, especialidad)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      despacho,
      fila.article_id || "",
      fila.titulo || "",
      fila.fecha || "",
      fila.url || "",
      fila.detalle_url || "",
      fila.categorias?.["Tipo de publicación"] || "",
      fila.categorias?.Entidad || "",
      fila.categorias?.Especialidad || "",
    ]);
    return uno(db, "SELECT id FROM pp_publicacion WHERE article_id = ?", [fila.article_id || ""]).id;
  });
}

function guardarDocs(db, pubId, docs) {
  transaccion(db, () => {
    for (const doc of docs) {
      run(db, `INSERT OR IGNORE INTO pp_documento (publicacion, nombre, url, fecha, origen)
        VALUES (?, ?, ?, ?, ?)`, [pubId, doc.nombre || "", doc.url || "", doc.fecha || "", doc.origen || ""]);
    }
  });
}

// Carga un despacho en segundo plano: avisa progreso, acepta cancelación,
// guarda por página para no perder lo andado. Los PDF no se descargan.
export function crearCargaPp(db, { depto, despacho }) {
  const estado = {
    corriendo: false,
    cancelada: false,
    depto,
    despacho,
    pagina: 0,
    paginas: 0,
    avisos: 0,
    docs: 0,
    errores: 0,
    error: "",
  };
  return {
    estado,
    cancelar() {
      estado.cancelada = true;
    },
    async correr(onProgreso) {
      estado.corriendo = true;
      estado.cancelada = false;
      const avisar = () => {
        try {
          onProgreso?.({ ...estado });
        } catch {
          /* la ventana ya no escucha */
        }
      };
      try {
        const sesion = await abrirSesion();
        await pausa();
        const primera = await buscarPagina(sesion, depto, despacho, 1);
        estado.paginas = Math.max(1, Math.ceil(primera.total / PP_POR_PAGINA));
        const guardar = async (filas) => {
          for (const fila of filas) {
            if (estado.cancelada) return;
            if (!fila.article_id || !fila.detalle_url) continue;
            try {
              const pubId = guardarFila(db, despacho, fila);
              await pausa();
              if (estado.cancelada) return;
              const docs = await traerDocumentos(sesion, fila.detalle_url);
              guardarDocs(db, pubId, docs);
              estado.avisos += 1;
              estado.docs += docs.length;
            } catch (error) {
              estado.errores += 1;
              estado.error = String(error?.message || error).slice(0, 200);
            }
            avisar();
          }
        };
        estado.pagina = 1;
        avisar();
        await guardar(primera.filas);
        for (let pagina = 2; pagina <= estado.paginas && !estado.cancelada; pagina++) {
          await pausa();
          if (estado.cancelada) break;
          try {
            const { filas } = await buscarPagina(sesion, depto, despacho, pagina);
            estado.pagina = pagina;
            await guardar(filas);
          } catch (error) {
            estado.errores += 1;
            estado.error = String(error?.message || error).slice(0, 200);
            avisar();
          }
        }
        run(db, `INSERT INTO pp_carga (despacho, total, paginas, avisos, actualizada, estado)
          VALUES (?, ?, ?, ?, datetime('now', 'localtime'), ?)
          ON CONFLICT(despacho) DO UPDATE SET total = excluded.total, paginas = excluded.paginas,
            avisos = excluded.avisos, actualizada = excluded.actualizada, estado = excluded.estado`, [
          despacho, primera.total, estado.pagina, estado.avisos,
          estado.cancelada ? "cancelada" : "lista",
        ]);
      } catch (error) {
        estado.errores += 1;
        estado.error = String(error?.message || error).slice(0, 200);
      }
      estado.corriendo = false;
      avisar();
      return { ...estado };
    },
  };
}
