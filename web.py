#!/usr/bin/env python3
"""Lectura de grokvig.sqlite y lanzamiento de main.py.

La interfaz es escritorio.py (NiceGUI). Este módulo lee la base y lanza main.py.
También puede servir la página anterior:

    python3 web.py
    python3 web.py --puerto 4200
"""

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


def directorio_codigo() -> Path:
    return Path(__file__).resolve().parent


def directorio_datos() -> Path:
    marcada = os.environ.get("VIGENCIA_DATOS")
    if marcada:
        return Path(marcada)
    return directorio_codigo()


CODIGO = directorio_codigo()
DATOS = directorio_datos()
DB_PATH = DATOS / "grokvig.sqlite"
WEB_ROOT = CODIGO / "web"
ARCHIVOS = {
    "/": "index.html",
    "/app.js": "app.js",
    "/style.css": "style.css",
}
TIPOS = {
    "index.html": "text/html; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "style.css": "text/css; charset=utf-8",
}


def conectar() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    return con


CANDADO = threading.Lock()
CORRIDA = {
    "corriendo": False,
    "exit_code": None,
    "lineas": deque(maxlen=80),
    "inicio": None,
    "fin": None,
    "proceso": None,
    "modo": None,
    "radicado": None,
}


def estado_corrida() -> dict:
    with CANDADO:
        return {
            "corriendo": CORRIDA["corriendo"],
            "exit_code": CORRIDA["exit_code"],
            "lineas": list(CORRIDA["lineas"]),
            "inicio": CORRIDA["inicio"],
            "fin": CORRIDA["fin"],
            "modo": CORRIDA["modo"],
            "radicado": CORRIDA["radicado"],
        }


def _leer_salida(proceso: subprocess.Popen) -> None:
    assert proceso.stdout is not None
    for linea in proceso.stdout:
        with CANDADO:
            CORRIDA["lineas"].append(linea.rstrip())
    codigo = proceso.wait()
    with CANDADO:
        CORRIDA["corriendo"] = False
        CORRIDA["exit_code"] = codigo
        CORRIDA["fin"] = time.strftime("%Y-%m-%d %H:%M:%S")
        CORRIDA["proceso"] = None


def lanzar(argv: list[str], modo: str, radicado: str | None = None) -> bool:
    """Arranca main.py. False si ya hay una corrida."""
    with CANDADO:
        if CORRIDA["corriendo"]:
            return False
        CORRIDA["lineas"].clear()
        CORRIDA["exit_code"] = None
        CORRIDA["fin"] = None
        CORRIDA["inicio"] = time.strftime("%Y-%m-%d %H:%M:%S")
        CORRIDA["modo"] = modo
        CORRIDA["radicado"] = radicado
        entorno = os.environ.copy()
        entorno["VIGENCIA_DATOS"] = str(DATOS)
        entorno["PYTHONIOENCODING"] = "utf-8"
        proceso = subprocess.Popen(
            [sys.executable, "-u", str(CODIGO / "main.py"), *argv],
            cwd=DATOS,
            env=entorno,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        CORRIDA["proceso"] = proceso
        CORRIDA["corriendo"] = True
    threading.Thread(target=_leer_salida, args=(proceso,), daemon=True).start()
    return True


def asegurar_en_csv(numero: str) -> None:
    ruta = DATOS / "procesos.csv"
    texto_csv = ruta.read_text(encoding="utf-8") if ruta.exists() else "RADICADOS\n"
    ya = {linea.strip() for linea in texto_csv.splitlines() if linea.strip().isdigit()}
    if numero in ya:
        return
    if texto_csv and not texto_csv.endswith("\n"):
        texto_csv += "\n"
    ruta.write_text(texto_csv + numero + "\n", encoding="utf-8")


def filas(con: sqlite3.Connection, sql: str, params=()) -> list[dict]:
    return [dict(fila) for fila in con.execute(sql, params)]


def listar_procesos(con: sqlite3.Connection) -> list[dict]:
    procesos = filas(
        con,
        """
        SELECT
            p.id_proceso,
            p.radicado,
            p.despacho,
            p.departamento,
            p.ponente,
            p.tipo_proceso,
            p.clase_proceso,
            p.subclase_proceso,
            p.ubicacion,
            p.fecha_proceso,
            p.fecha_ultima_actuacion,
            p.contenido_radicacion,
            (p.detalle_consultado_en IS NOT NULL) AS detalle_ok,
            (p.sujetos_consultado_en IS NOT NULL) AS sujetos_ok,
            (p.documentos_consultado_en IS NOT NULL) AS documentos_ok,
            (p.actuaciones_consultado_en IS NOT NULL) AS actuaciones_ok,
            0 AS consulta_pendiente,
            (SELECT COUNT(*) FROM actuacion a WHERE a.id_proceso = p.id_proceso) AS actuaciones,
            (SELECT COUNT(*) FROM documento d WHERE d.id_proceso = p.id_proceso) AS documentos,
            (SELECT COUNT(*) FROM sujeto s WHERE s.id_proceso = p.id_proceso) AS sujetos,
            (
                SELECT actuacion FROM actuacion a
                WHERE a.id_proceso = p.id_proceso
                ORDER BY fecha_actuacion DESC, consecutivo DESC
                LIMIT 1
            ) AS ultima_actuacion,
            (
                SELECT GROUP_CONCAT(nombre, ' · ')
                FROM sujeto s
                WHERE s.id_proceso = p.id_proceso AND s.rol_base = 'demandante'
            ) AS demandantes,
            (
                SELECT GROUP_CONCAT(nombre, ' · ')
                FROM sujeto s
                WHERE s.id_proceso = p.id_proceso AND s.rol_base = 'demandado'
            ) AS demandados,
            (
                SELECT f.ciudad FROM ficha f
                JOIN ficha_radicado fr ON fr.ficha_id = f.id
                WHERE fr.radicado = p.radicado
                ORDER BY f.fila_csv
                LIMIT 1
            ) AS ciudad,
            (
                SELECT f.tipo_proceso FROM ficha f
                JOIN ficha_radicado fr ON fr.ficha_id = f.id
                WHERE fr.radicado = p.radicado
                ORDER BY f.fila_csv
                LIMIT 1
            ) AS tipo_csv,
            (
                SELECT f.demandante FROM ficha f
                JOIN ficha_radicado fr ON fr.ficha_id = f.id
                WHERE fr.radicado = p.radicado
                ORDER BY f.fila_csv
                LIMIT 1
            ) AS demandante_csv,
            (
                SELECT f.demandado FROM ficha f
                JOIN ficha_radicado fr ON fr.ficha_id = f.id
                WHERE fr.radicado = p.radicado
                ORDER BY f.fila_csv
                LIMIT 1
            ) AS demandado_csv
        FROM proceso p
        ORDER BY p.fecha_ultima_actuacion DESC, p.radicado
        """,
    )
    vacios = filas(
        con,
        """
        SELECT
            NULL AS id_proceso,
            r.numero AS radicado,
            NULL AS despacho,
            NULL AS departamento,
            NULL AS ponente,
            NULL AS tipo_proceso,
            NULL AS clase_proceso,
            NULL AS subclase_proceso,
            NULL AS ubicacion,
            NULL AS fecha_proceso,
            NULL AS fecha_ultima_actuacion,
            NULL AS contenido_radicacion,
            0 AS detalle_ok,
            0 AS sujetos_ok,
            0 AS documentos_ok,
            0 AS actuaciones_ok,
            (r.consultado_en IS NULL) AS consulta_pendiente,
            0 AS actuaciones,
            0 AS documentos,
            0 AS sujetos,
            NULL AS ultima_actuacion,
            NULL AS demandantes,
            NULL AS demandados,
            f.ciudad,
            f.tipo_proceso AS tipo_csv,
            f.demandante AS demandante_csv,
            f.demandado AS demandado_csv,
            1 AS sin_expediente
        FROM radicado r
        LEFT JOIN ficha_radicado fr ON fr.radicado = r.numero
        LEFT JOIN ficha f ON f.id = fr.ficha_id
        WHERE NOT EXISTS (
            SELECT 1 FROM proceso p WHERE p.radicado = r.numero
        )
        ORDER BY r.numero
        """,
    )
    for proceso in procesos:
        proceso["sin_expediente"] = 0
    return procesos + vacios


def detalle_proceso(con: sqlite3.Connection, id_proceso: int) -> dict | None:
    fila = con.execute(
        """
        SELECT
            id_proceso, id_reg_proceso, radicado, despacho, codigo_despacho,
            departamento, ponente, tipo_proceso, clase_proceso, subclase_proceso,
            recurso, ubicacion, contenido_radicacion, es_privado,
            fecha_proceso, fecha_ultima_actuacion, ultima_actualizacion,
            detalle_consultado_en, sujetos_consultado_en,
            documentos_consultado_en, actuaciones_consultado_en
        FROM proceso
        WHERE id_proceso = ?
        """,
        (id_proceso,),
    ).fetchone()
    if fila is None:
        return None
    proceso = dict(fila)
    ficha = con.execute(
        """
        SELECT f.ciudad, f.tipo_proceso, f.demandante, f.demandado, j.nombre AS juzgado, j.url
        FROM ficha f
        JOIN ficha_radicado fr ON fr.ficha_id = f.id
        LEFT JOIN ficha_juzgado j ON j.ficha_id = f.id AND j.orden = (
            SELECT MIN(orden) FROM ficha_juzgado WHERE ficha_id = f.id
        )
        WHERE fr.radicado = ?
        ORDER BY f.fila_csv
        LIMIT 1
        """,
        (proceso["radicado"],),
    ).fetchone()
    proceso["ficha"] = dict(ficha) if ficha else None
    proceso["sujetos"] = filas(
        con,
        """
        SELECT tipo_sujeto, rol_base, nombre, identificacion, es_emplazado
        FROM sujeto
        WHERE id_proceso = ?
        ORDER BY rol_base, nombre
        """,
        (id_proceso,),
    )
    proceso["documentos"] = filas(
        con,
        """
        SELECT nombre, descripcion, fecha_carga, tipo, enlace
        FROM documento
        WHERE id_proceso = ?
        ORDER BY fecha_carga DESC, nombre
        """,
        (id_proceso,),
    )
    proceso["actuaciones"] = filas(
        con,
        """
        SELECT consecutivo, fecha_actuacion, actuacion, anotacion,
               fecha_inicial, fecha_final, fecha_registro, cod_regla, con_documentos
        FROM actuacion
        WHERE id_proceso = ?
        ORDER BY fecha_actuacion DESC, consecutivo DESC
        """,
        (id_proceso,),
    )
    return proceso


class App(BaseHTTPRequestHandler):
    def log_message(self, formato: str, *args) -> None:
        return

    def _enviar(self, status: int, cuerpo: bytes, tipo: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(cuerpo)

    def _json(self, status: int, dato) -> None:
        cuerpo = json.dumps(dato, ensure_ascii=False).encode("utf-8")
        self._enviar(status, cuerpo, "application/json; charset=utf-8")

    def do_POST(self) -> None:
        ruta = unquote(urlparse(self.path).path)
        largo = int(self.headers.get("Content-Length") or 0)
        cuerpo = self.rfile.read(largo) if largo else b""
        if ruta == "/api/actualizar":
            if not lanzar(["--paso", "3", "--solo-actuaciones"], "todo"):
                self._json(409, {"ok": False, "corriendo": True, "mensaje": "Ya hay una consulta en curso"})
                return
            self._json(202, {"ok": True, "corriendo": True})
            return
        if ruta == "/api/agregar":
            try:
                dato = json.loads(cuerpo.decode() or "{}")
            except json.JSONDecodeError:
                self._json(400, {"error": "El cuerpo no es JSON"})
                return
            numero = "".join(caracter for caracter in str(dato.get("radicado") or "") if caracter.isdigit())
            if len(numero) != 23:
                self._json(400, {"error": "El radicado debe tener 23 dígitos"})
                return
            asegurar_en_csv(numero)
            if not lanzar(["--paso", "todos", "--radicado", numero], "agregar", numero):
                self._json(409, {"ok": False, "corriendo": True, "mensaje": "Ya hay una consulta en curso"})
                return
            self._json(202, {"ok": True, "corriendo": True, "radicado": numero})
            return
        self._json(404, {"error": "No encontrado"})

    def do_GET(self) -> None:
        ruta = unquote(urlparse(self.path).path)
        if ruta == "/api/actualizacion":
            self._json(200, estado_corrida())
            return
        if ruta == "/api/procesos":
            with conectar() as con:
                procesos = listar_procesos(con)
            self._json(200, {"procesos": procesos})
            return
        if ruta.startswith("/api/procesos/"):
            bruto = ruta.removeprefix("/api/procesos/")
            if not bruto.isdigit():
                self._json(404, {"error": "Expediente no encontrado"})
                return
            with conectar() as con:
                proceso = detalle_proceso(con, int(bruto))
            if proceso is None:
                self._json(404, {"error": "Expediente no encontrado"})
                return
            self._json(200, proceso)
            return
        nombre = ARCHIVOS.get(ruta)
        if nombre is None:
            self._json(404, {"error": "No encontrado"})
            return
        archivo = WEB_ROOT / nombre
        if not archivo.is_file():
            self._json(500, {"error": f"Falta {nombre}"})
            return
        self._enviar(200, archivo.read_bytes(), TIPOS[nombre])


def crear_servidor(puerto: int) -> ThreadingHTTPServer:
    if not DB_PATH.exists():
        raise SystemExit(f"No está la base: {DB_PATH}")
    with conectar() as con:
        con.execute("PRAGMA journal_mode=WAL")
    return ThreadingHTTPServer(("127.0.0.1", puerto), App)


def servir(servidor: ThreadingHTTPServer) -> None:
    puerto = servidor.server_address[1]
    print(f"Procesos en http://127.0.0.1:{puerto}", flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrado", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Abre la consulta local de procesos")
    parser.add_argument("--puerto", type=int, default=4200)
    args = parser.parse_args()
    servir(crear_servidor(args.puerto))


if __name__ == "__main__":
    main()
