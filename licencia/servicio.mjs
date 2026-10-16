import crypto from "node:crypto";
import {
  MONEDA,
  PRECIO_CENTAVOS,
  PRECIO_PESOS,
  aprobada,
  firmarToken,
  siguienteHasta,
  textoPrecio,
  urlCheckout,
  verificarEvento,
} from "./comun.mjs";

const INSTALACION = /^[a-f0-9]{64}$/;

export function tiendaMemoria() {
  const porInstalacion = new Map();
  const porPendiente = new Map();
  const porPagada = new Map();
  return {
    async porInstalacion(instalacion) {
      return porInstalacion.get(instalacion) || null;
    },
    async porPendiente(referencia) {
      return porPendiente.get(referencia) || null;
    },
    async porPagada(referencia) {
      return porPagada.get(referencia) || null;
    },
    async guardar(item) {
      const previo = porInstalacion.get(item.instalacion);
      if (previo?.pendiente) porPendiente.delete(previo.pendiente);
      if (previo?.referenciaPagada) porPagada.delete(previo.referenciaPagada);
      porInstalacion.set(item.instalacion, item);
      if (item.pendiente) porPendiente.set(item.pendiente, item);
      if (item.referenciaPagada) porPagada.set(item.referenciaPagada, item);
    },
  };
}

function vista(item, ahora) {
  if (!item?.token || !item.hasta) return { estado: "sin_pago" };
  if (Date.parse(item.hasta) > ahora.getTime()) {
    return { estado: "vigente", token: item.token, hasta: item.hasta };
  }
  return { estado: "vencida", hasta: item.hasta };
}

function respuesta(status, body) {
  return { status, body };
}

const TIPOS_COMENTARIO = new Set(["sugerencia", "bug", "otro"]);

function tiendaComentariosMemoria() {
  const items = new Map();
  return {
    async guardar(item) {
      items.set(item.id, item);
    },
    async visibles() {
      return [...items.values()].filter((c) => c.visible)
        .sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    },
    async todos() {
      return [...items.values()]
        .sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    },
    async cambiarVisible(id, visible) {
      const previo = items.get(String(id || ""));
      if (previo) items.set(previo.id, { ...previo, visible: Boolean(visible) });
    },
  };
}

function comentarioLimpio(body) {
  if (body && typeof body === "object" && Object.keys(body).some((k) => /honeypot|trampa|website|url/i.test(k) && String(body[k] || "").trim())) {
    return { error: "No pasó la revisión." };
  }
  const trampa = String(body?.trampa || "").trim();
  if (trampa) return { error: "No pasó la revisión." };
  const nombre = String(body?.nombre || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const tipo = TIPOS_COMENTARIO.has(body?.tipo) ? body.tipo : "otro";
  const texto = String(body?.texto || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (texto.length < 3) return { error: "El comentario es muy corto." };
  return { nombre, tipo, texto };
}

export function crearServicio({
  tienda = tiendaMemoria(),
  comentarios = tiendaComentariosMemoria(),
  claveAdmin = "",
  wompi,
  privada,
  publicaBase = "",
  ahora = () => new Date(),
  consultar = async () => [],
  azar = () => crypto.randomBytes(12).toString("hex"),
  precioCentavos = PRECIO_CENTAVOS,
} = {}) {
  async function cerrarPago(item, referencia) {
    if (item.referenciaPagada === referencia && item.token) return item;
    const marca = ahora();
    const hasta = siguienteHasta(item.hasta, marca);
    const token = firmarToken({
      inst: item.instalacion,
      hasta,
      iat: Math.floor(marca.getTime() / 1000),
    }, privada);
    const siguiente = {
      ...item,
      hasta,
      token,
      pendiente: "",
      referenciaPagada: referencia,
    };
    await tienda.guardar(siguiente);
    return siguiente;
  }

  async function activarSiPago(item) {
    if (!item?.pendiente) return item;
    const filas = await consultar(item.pendiente);
    if (!aprobada(filas, item.pendiente, precioCentavos)) return item;
    return cerrarPago(item, item.pendiente);
  }

  async function atender({ method, path, query = {}, headers = {}, body = null }) {
    const ruta = String(path || "/").replace(/\/$/, "") || "/";
    const verbo = String(method || "GET").toUpperCase();

    if (verbo === "GET" && ruta === "/retorno") {
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: "<!doctype html><meta charset=utf-8><title>Vigencia</title><p>El pago quedó en Wompi. Vuelve a Vigencia y pulsa Ya pagué.</p>",
        texto: true,
      };
    }

    if (verbo === "GET" && ruta === "/estado") {
      const instalacion = String(query.instalacion || "");
      if (!INSTALACION.test(instalacion)) return respuesta(400, { error: "La instalación no es válida." });
      let item = await tienda.porInstalacion(instalacion);
      try {
        item = await activarSiPago(item);
      } catch {
        return respuesta(502, { error: "No pude confirmar el pago con Wompi." });
      }
      const foto = vista(item, ahora());
      return respuesta(200, {
        ...foto,
        precioPesos: PRECIO_PESOS,
        precioTexto: textoPrecio(),
        ahora: ahora().toISOString(),
        pendiente: Boolean(item?.pendiente),
      });
    }

    if (verbo === "POST" && ruta === "/iniciar") {
      const instalacion = String(body?.instalacion || "");
      if (!INSTALACION.test(instalacion)) return respuesta(400, { error: "La instalación no es válida." });
      if (!wompi?.lista) return respuesta(503, { error: "El cobro todavía no está conectado." });
      if (!privada) return respuesta(503, { error: "El cobro todavía no está conectado." });
      let item = (await tienda.porInstalacion(instalacion)) || { instalacion, hasta: "", token: "", pendiente: "", referenciaPagada: "" };
      const foto = vista(item, ahora());
      if (foto.estado === "vigente") {
        return respuesta(200, {
          estado: "vigente",
          token: item.token,
          hasta: item.hasta,
          precioTexto: textoPrecio(),
          ahora: ahora().toISOString(),
        });
      }
      const referencia = `vg_${azar()}`;
      item = { ...item, instalacion, pendiente: referencia };
      await tienda.guardar(item);
      const redirect = String(publicaBase || "").startsWith("https://") ? `${publicaBase.replace(/\/$/, "")}/retorno` : "";
      const url = urlCheckout({
        publica: wompi.publica,
        referencia,
        centavos: precioCentavos,
        moneda: MONEDA,
        integridad: wompi.integridad,
        redirect,
      });
      return respuesta(200, { estado: foto.estado, url, referencia, precioTexto: textoPrecio() });
    }

    // Comentarios de la app: se guardan pendientes y el equipo los aprueba.
    if (verbo === "POST" && ruta === "/comentarios") {
      const limpio = comentarioLimpio(body);
      if (limpio.error) return respuesta(400, { error: limpio.error });
      const item = {
        id: `${ahora().toISOString()}_${azar()}`,
        nombre: limpio.nombre,
        tipo: limpio.tipo,
        texto: limpio.texto,
        creado: ahora().toISOString(),
        visible: false,
      };
      await comentarios.guardar(item);
      return respuesta(200, { ok: true, id: item.id });
    }

    if (verbo === "GET" && ruta === "/comentarios") {
      const lista = await comentarios.visibles(50);
      return respuesta(200, {
        comentarios: lista.map((c) => ({
          id: c.id, nombre: c.nombre, tipo: c.tipo, texto: c.texto, creado: c.creado,
        })),
      });
    }

    const cabeceras = Object.fromEntries(
      Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase(), v]),
    );
    const esAdmin = Boolean(claveAdmin) && (
      String(query.clave || "") === claveAdmin
      || String(body?.clave || "") === claveAdmin
      || String(cabeceras["x-clave"] || "") === claveAdmin
    );
    if (ruta === "/admin/comentarios") {
      if (!esAdmin) return respuesta(401, { error: "Sin permiso." });
      if (verbo === "GET") return respuesta(200, { comentarios: await comentarios.todos(100) });
      if (verbo === "POST") {
        await comentarios.cambiarVisible(body?.id, body?.visible);
        return respuesta(200, { ok: true });
      }
    }

    if (verbo === "POST" && ruta === "/evento") {
      const aviso = verificarEvento(body, wompi?.eventos || "");
      if (!aviso.ok) return respuesta(401, { error: "No reconocí el aviso de Wompi." });
      if (aviso.status !== "APPROVED" || !aviso.referencia) return respuesta(200, { ok: true });
      const item = (await tienda.porPendiente(aviso.referencia)) || (await tienda.porPagada(aviso.referencia));
      if (!item) return respuesta(200, { ok: true, ignorado: true });
      if (item.referenciaPagada === aviso.referencia) return respuesta(200, { ok: true });
      let filas;
      try {
        filas = await consultar(aviso.referencia);
      } catch {
        return respuesta(502, { error: "No pude confirmar el pago con Wompi." });
      }
      if (!aprobada(filas, aviso.referencia, precioCentavos)) return respuesta(200, { ok: true, ignorado: true });
      await cerrarPago(item, aviso.referencia);
      return respuesta(200, { ok: true });
    }

    return respuesta(404, { error: "No está." });
  }

  return { atender, cerrarPago };
}
