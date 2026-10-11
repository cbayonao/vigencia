import path from "node:path";

export const ARG_OCULTA = "--oculta";
export const NOMBRE_AUTOSTART = "vigencia.desktop";

export function rutaAutostart({ env = {}, home }) {
  const base = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(base, "autostart", NOMBRE_AUTOSTART);
}

export function ejecutableLinux({ env = {}, execPath }) {
  return env.APPIMAGE || execPath;
}

function citar(valor) {
  const escapado = String(valor)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$")
    .replaceAll("%", "%%");
  return `"${escapado}"`;
}

export function textoAutostart({ ejecutable }) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Vigencia",
    "Comment=Revisa los procesos guardados dos veces al día",
    `Exec=${citar(ejecutable)} ${ARG_OCULTA}`,
    "Icon=vigencia",
    "Terminal=false",
    "Categories=Office;",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export function abiertaAlIniciarSesion({ argv = [], plataforma, app }) {
  if (argv.includes(ARG_OCULTA)) return true;
  if (plataforma === "darwin") {
    try {
      return Boolean(app?.getLoginItemSettings?.().wasOpenedAtLogin);
    } catch {
      return false;
    }
  }
  return false;
}

export function configurarInicio({ activo, empaquetada, plataforma, app, env = {}, home, execPath, fs }) {
  if (!empaquetada) return { ok: true, hecho: false, motivo: "En desarrollo no se registra el inicio de sesión." };
  if (plataforma === "win32") {
    app.setLoginItemSettings({ openAtLogin: Boolean(activo), args: [ARG_OCULTA] });
    return { ok: true, hecho: true };
  }
  if (plataforma === "darwin") {
    app.setLoginItemSettings({ openAtLogin: Boolean(activo), openAsHidden: true });
    return { ok: true, hecho: true };
  }
  if (plataforma === "linux") {
    const ruta = rutaAutostart({ env, home });
    if (!activo) {
      fs.rmSync(ruta, { force: true });
      return { ok: true, hecho: true, ruta };
    }
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    const texto = textoAutostart({ ejecutable: ejecutableLinux({ env, execPath }) });
    let previo = null;
    try {
      previo = fs.readFileSync(ruta, "utf8");
    } catch {
      previo = null;
    }
    if (previo !== texto) fs.writeFileSync(ruta, texto, "utf8");
    return { ok: true, hecho: true, ruta };
  }
  return { ok: true, hecho: false, motivo: `Sistema ${plataforma} sin inicio automático.` };
}
