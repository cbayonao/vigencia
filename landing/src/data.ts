export const VERSION = "3.4.0";
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
