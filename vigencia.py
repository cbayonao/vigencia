#!python3.12
import os
import site
import sys

scriptdir, _script = os.path.split(os.path.abspath(__file__))
pkgdir = os.path.join(scriptdir, "pkgs")
site.addsitedir(pkgdir)
sys.path.insert(0, pkgdir)
sys.path.insert(0, scriptdir)

import shutil
from pathlib import Path


def directorio_datos(instalacion: Path) -> Path:
    """Usa la carpeta del programa si se puede escribir. Si no, copia la base a LOCALAPPDATA."""
    prueba = instalacion / ".vigencia-escritura"
    try:
        prueba.write_text("ok", encoding="utf-8")
        prueba.unlink()
        return instalacion
    except OSError:
        base = os.environ.get("LOCALAPPDATA")
        destino = Path(base) / "Vigencia" if base else Path.home() / "AppData" / "Local" / "Vigencia"
        destino.mkdir(parents=True, exist_ok=True)
        for nombre in ("grokvig.sqlite", "procesos.csv"):
            origen = instalacion / nombre
            copia = destino / nombre
            if origen.is_file() and not copia.exists():
                shutil.copy2(origen, copia)
        return destino


def main() -> None:
    instalacion = Path(scriptdir)
    datos = directorio_datos(instalacion)
    os.environ["VIGENCIA_DATOS"] = str(datos)
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.chdir(datos)
    import escritorio

    escritorio.main()


if __name__ == "__main__":
    main()
