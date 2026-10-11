#!/usr/bin/env python3
"""Copia la base actual y construye Vigencia-Setup.exe para Windows."""

import os
import shutil
import sqlite3
import stat
import subprocess
import sys
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
SEMILLA = RAIZ / "build" / "semilla"
HERRAMIENTAS = RAIZ / "build" / "tools"
DESTINO = RAIZ / "Vigencia-Setup.exe"
NSIS_DEB = "https://deb.debian.org/debian/pool/main/n/nsis/nsis_3.12-1_amd64.deb"
NSIS_COMMON_DEB = "https://deb.debian.org/debian/pool/main/n/nsis/nsis-common_3.12-1_all.deb"


def copiar_base() -> int:
    SEMILLA.mkdir(parents=True, exist_ok=True)
    archivo = SEMILLA / "grokvig.sqlite"
    if archivo.exists():
        archivo.unlink()
    origen = sqlite3.connect(f"file:{RAIZ / 'grokvig.sqlite'}?mode=ro", uri=True)
    destino = sqlite3.connect(archivo)
    try:
        origen.backup(destino)
        destino.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        procesos = destino.execute("SELECT COUNT(*) FROM proceso").fetchone()[0]
        sujetos = destino.execute("SELECT COUNT(*) FROM sujeto").fetchone()[0]
        actuaciones = destino.execute("SELECT COUNT(*) FROM actuacion").fetchone()[0]
    finally:
        destino.close()
        origen.close()
    print(f"Base lista: {procesos} expedientes, {sujetos} sujetos, {actuaciones} actuaciones")
    return procesos


def descargar(url: str, destino: Path) -> None:
    if destino.is_file() and destino.stat().st_size > 0:
        return
    destino.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, destino)


def asegurar_makensis() -> Path:
    if shutil.which("makensis"):
        return Path(shutil.which("makensis"))
    raiz_nsis = HERRAMIENTAS / "nsis-root"
    binario = raiz_nsis / "usr" / "bin" / "makensis"
    if not binario.is_file():
        for url in (NSIS_DEB, NSIS_COMMON_DEB):
            paquete = HERRAMIENTAS / Path(url).name
            descargar(url, paquete)
            subprocess.check_call(["ar", "x", paquete.name], cwd=paquete.parent)
            datos = next(paquete.parent.glob("data.tar.*"))
            raiz_nsis.mkdir(parents=True, exist_ok=True)
            subprocess.check_call(["tar", "-xf", str(datos), "-C", str(raiz_nsis)])
            datos.unlink()
            for extra in paquete.parent.glob("control.tar.*"):
                extra.unlink()
            debian_binary = paquete.parent / "debian-binary"
            if debian_binary.exists():
                debian_binary.unlink()
    datos_nsis = Path("/tmp/share/nsis")
    datos_nsis.parent.mkdir(parents=True, exist_ok=True)
    if datos_nsis.is_symlink() or datos_nsis.exists():
        datos_nsis.unlink()
    datos_nsis.symlink_to(raiz_nsis / "usr" / "share" / "nsis")
    parche = HERRAMIENTAS / "bin" / "makensis"
    parche.parent.mkdir(parents=True, exist_ok=True)
    original = binario.read_bytes()
    viejo = "/usr/share/nsis".encode("utf-32le")
    nuevo = "/tmp/share/nsis".encode("utf-32le")
    if viejo not in original:
        raise SystemExit("No pude reubicar los datos de makensis")
    parche.write_bytes(original.replace(viejo, nuevo))
    parche.chmod(parche.stat().st_mode | stat.S_IEXEC)
    return parche


def python_de_nsist() -> Path:
    candidato = RAIZ / "build" / ".venv" / "bin" / "python"
    if candidato.is_file():
        return candidato
    candidato.parent.parent.mkdir(parents=True, exist_ok=True)
    subprocess.check_call([sys.executable, "-m", "venv", str(RAIZ / "build" / ".venv")])
    subprocess.check_call([str(candidato), "-m", "pip", "install", "pynsist"])
    return candidato


def construir() -> None:
    python = python_de_nsist()
    makensis = asegurar_makensis()
    entorno = os.environ.copy()
    entorno["PATH"] = str(makensis.parent) + os.pathsep + entorno.get("PATH", "")
    subprocess.check_call([str(python), "-m", "nsist", str(RAIZ / "installer.cfg")], cwd=RAIZ, env=entorno)
    generado = RAIZ / "build" / "nsis" / "Vigencia-Setup.exe"
    if not generado.is_file():
        raise SystemExit(f"No quedó el instalador en {generado}")
    shutil.copy2(generado, DESTINO)
    print(f"Instalador: {DESTINO} ({DESTINO.stat().st_size} bytes)")


if __name__ == "__main__":
    if copiar_base() <= 0:
        raise SystemExit("La base no tiene expedientes. No empaqueto una base vacía.")
    construir()
