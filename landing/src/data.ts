export const VERSION = "3.5.0";
export const PRECIO = "$599.900";
export const DIAS_PRUEBA = 20;
export const WHATSAPP = "573046408977";
export const MENSAJE_WHATSAPP = "Hola Vigencia, quiero saber más del plan.";
// API del servicio de licencias (misma URL que usa la app en
// electron/compartido/licencia.js): comentarios + administración.
export const API_COMENTARIOS = "https://7j8bqraswk.execute-api.us-east-1.amazonaws.com";
// Descargas: nombres estables servidos por el CDN. El pipeline arma los
// instaladores, los publica como release de GitHub y los espeja a S3;
// si el repo algún día es público, esta base puede apuntar a
// https://github.com/cbayonao/vigencia/releases/latest/download
export const BASE_DESCARGAS = "https://vigencia.askleia.co";
export const ARCHIVOS = {
  win: "Vigencia-Setup.exe",
  appimage: "Vigencia.AppImage",
  deb: "Vigencia.deb",
  mac: "Vigencia.dmg",
};

// Tabla de precios (modelo de negocio, sección 5.1). Precios en pesos
// colombianos; no se dice si incluyen IVA hasta confirmarlo con el contador.
export const NOTA_PRECIOS = "Precios en pesos colombianos.";
export const PLANES = [
  {
    nombre: "Gratis",
    precio: "$0",
    periodo: "",
    nota: "Próximamente",
    procesos: "Hasta 10 procesos",
    incluye: ["Revisión automática 1 vez al día", "Mis procesos con audiencias y tareas", "Herramientas PDF y convertir a Markdown", "Jurisprudencia", "Documentos con IA con tu clave o modelo local, hasta 3 proyectos"],
  },
  {
    nombre: "Profesional",
    precio: "$299.900",
    periodo: "al año, o $29.900 al mes",
    nota: "Lanzamiento: $249.900 el primer año si compras antes del 31 de marzo de 2027",
    procesos: "Hasta 150 procesos",
    incluye: ["Todo lo de Gratis", "2 revisiones al día", "Publicaciones procesales", "Informe del día por cliente y Excel", "Proyectos ilimitados, citas con revisor y guías de escrito"],
  },
  {
    nombre: "Premium",
    precio: "$599.900",
    periodo: "al año, o $59.900 al mes",
    nota: "",
    procesos: "Procesos ilimitados",
    incluye: ["Todo lo de Profesional", "Conector MCP para Claude", "Modo expediente completo", "Soporte prioritario por WhatsApp", "Acceso anticipado a lo nuevo"],
  },
  {
    nombre: "Estudiante",
    precio: "$149.900",
    periodo: "al año, con correo .edu.co",
    nota: "",
    procesos: "Hasta 50 procesos",
    incluye: ["Igual que Profesional"],
  },
];
export const NOTA_DESPACHO = "Despachos: 20 por ciento de descuento desde 3 licencias Premium. Cada licencia es un computador.";
