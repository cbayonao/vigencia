export const VERSION = "3.2.1";
export const PRECIO = "$599.900";
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
