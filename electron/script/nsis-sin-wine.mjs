import fs from "node:fs";
import path from "node:path";

const archivo = path.resolve(
  import.meta.dirname,
  "..",
  "node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js",
);
const marca = "Sin wine: el desinstalador va embebido";
const original = `        else {
            const wineVm = new WineVm_1.WineVmManager((_a = packager.config.toolsets) === null || _a === void 0 ? void 0 : _a.wine);
            await wineVm.exec(installerPath, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });
        }`;
const reemplazo = `        else {
            // Sin wine: el desinstalador va embebido en el primer exe.
            try {
                await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);
            }
            catch (error) {
                const wineVm = new WineVm_1.WineVmManager((_a = packager.config.toolsets) === null || _a === void 0 ? void 0 : _a.wine);
                await wineVm.exec(installerPath, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });
            }
        }`;

const texto = fs.readFileSync(archivo, "utf8");
if (texto.includes(marca)) {
  console.log("El instalador de Windows ya puede armarse sin wine.");
  process.exit(0);
}
if (!texto.includes(original)) {
  console.error("No encontré el paso que llama a wine. No cambio el empaquetador.");
  process.exit(1);
}
fs.writeFileSync(archivo, texto.replace(original, reemplazo));
console.log("El desinstalador se lee del instalador, sin ejecutar wine.");
