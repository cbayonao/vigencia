#!/usr/bin/env python3
"""Consulta procesos de la Rama Judicial y los guarda en grokvig.sqlite.

El modelo separa tres cosas que no son lo mismo:

  ficha     Lo que dice el CSV: ciudad, juzgado, tipo, demandante y demandado.
            Una fila del archivo. Puede traer varios radicados y varios juzgados.
  radicado  El número de 23 dígitos. Es la llave de búsqueda.
  proceso   Un expediente real de la Rama (idProceso). Un radicado puede tener
            varios: juzgado de origen, tribunal, ejecución.
  parte     El texto de partes que viene en la búsqueda por radicado.
  sujeto    Cada parte que devuelve /Proceso/Sujetos, con identificación.
  actuacion Cada movimiento del expediente. Es lo que más cambia.
  documento Archivo publicado en /Proceso/Documentos. Muchos expedientes no tienen.
  aviso     Un cambio detectado después de la primera carga, para notificar.

La primera vez que un expediente se consulta, se guarda todo y no se avisa.
En las siguientes corridas se vuelve a pedir, se compara y solo se avisa
lo nuevo, lo modificado o lo que desapareció.

Uso:
    python3 main.py
    python3 main.py --paso 3
    python3 main.py --cada 6h
    python3 main.py --limite 1
    python3 main.py --actualizar
"""

import argparse
import csv
import json
import os
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path

import requests

def directorio_datos() -> Path:
    """Carpeta de la base. En Windows puede ser LOCALAPPDATA, no la del programa."""
    marcada = os.environ.get("VIGENCIA_DATOS")
    if marcada:
        return Path(marcada)
    return Path(__file__).resolve().parent


REPO_ROOT = directorio_datos()
CSV_PATH = REPO_ROOT / "procesos.csv"
DB_PATH = REPO_ROOT / "grokvig.sqlite"
LOG_PATH = REPO_ROOT / "ejecucion.log"
AVISOS_PATH = REPO_ROOT / "avisos.log"

CONSULTA_URL = (
    "https://consultaprocesos.ramajudicial.gov.co:448"
    "/api/v2/Procesos/Consulta/NumeroRadicacion"
)
DETALLE_URL = (
    "https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Proceso/Detalle"
)
SUJETOS_URL = (
    "https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Proceso/Sujetos"
)
DOCUMENTOS_URL = (
    "https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Proceso/Documentos"
)
ACTUACIONES_URL = (
    "https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Proceso/Actuaciones"
)

HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "es-US,es;q=0.9,en-US;q=0.8,en;q=0.7,es-419;q=0.6",
    "origin": "https://consultaprocesos.ramajudicial.gov.co",
    "priority": "u=1, i",
    "referer": "https://consultaprocesos.ramajudicial.gov.co/",
    "sec-ch-ua": '"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Linux"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36"
    ),
}

PAUSA_SEGUNDOS = 0.5
MAX_PAGINAS = 50


def log(msg: str) -> None:
    linea = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(linea, flush=True)
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(linea + "\n")


def texto(valor) -> str | None:
    if valor is None:
        return None
    limpio = " ".join(str(valor).replace("\xa0", " ").split())
    return limpio or None


def fecha(valor) -> str | None:
    limpio = texto(valor)
    if not limpio:
        return None
    return limpio[:10]


def ahora() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def rol_base(rol: str) -> str:
    nombre = rol.lower()
    if "demandante" in nombre or "accionante" in nombre:
        return "demandante"
    if "demandado" in nombre or "indiciado" in nombre or "causante" in nombre:
        return "demandado"
    if "defensor" in nombre:
        return "defensor"
    if "curador" in nombre:
        return "curador"
    return "otro"


def parsear_partes(sujetos: str | None) -> list[tuple[str, str, str]]:
    """Parte el texto 'Rol: Nombre | Rol: Nombre' de la consulta."""
    crudo = sujetos or ""
    crudo = crudo.replace("\r", " ").replace("\n", " ").replace("\t", " ")
    partes = []
    for trozo in crudo.split("|"):
        trozo = texto(trozo)
        if not trozo or ":" not in trozo:
            continue
        rol, nombre = trozo.split(":", 1)
        rol = texto(rol)
        nombre = texto(nombre)
        if rol and nombre:
            partes.append((rol, rol_base(rol), nombre))
    return partes


def parsear_juzgados(celda: str) -> list[tuple[str | None, str | None]]:
    """Una celda puede traer el juzgado y, debajo, la URL. A veces hay dos."""
    bloques: list[tuple[str | None, str | None]] = []
    nombres: list[str] = []

    def cerrar(url: str | None = None) -> None:
        nonlocal nombres
        nombre = texto(" ".join(nombres))
        if nombre or url:
            bloques.append((nombre, url))
        nombres = []

    for linea in (celda or "").replace("\r", "").split("\n"):
        linea = linea.strip()
        if not linea:
            continue
        if linea.startswith("http"):
            cerrar(linea)
        else:
            nombres.append(linea)
    cerrar()
    return bloques


def parsear_radicados(celda: str) -> list[str]:
    encontrados = []
    vistos: set[str] = set()
    for linea in (celda or "").replace("\r", "").split("\n"):
        token = linea.strip()
        if token.isdigit() and token not in vistos:
            vistos.add(token)
            encontrados.append(token)
    return encontrados


def columna(campos: list[str], nombre: str) -> str | None:
    buscado = nombre.upper()
    return next((campo for campo in campos if campo and campo.strip().upper() == buscado), None)


def init_db(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS ficha (
            id            INTEGER PRIMARY KEY,
            fila_csv      INTEGER NOT NULL UNIQUE,
            ciudad        TEXT,
            tipo_proceso  TEXT,
            demandante    TEXT,
            demandado     TEXT
        );

        CREATE TABLE IF NOT EXISTS ficha_juzgado (
            id        INTEGER PRIMARY KEY,
            ficha_id  INTEGER NOT NULL REFERENCES ficha(id),
            orden     INTEGER NOT NULL,
            nombre    TEXT,
            url       TEXT
        );

        CREATE TABLE IF NOT EXISTS radicado (
            numero              TEXT PRIMARY KEY,
            cantidad_registros  INTEGER,
            consultado_en       TEXT
        );

        CREATE TABLE IF NOT EXISTS ficha_radicado (
            ficha_id  INTEGER NOT NULL REFERENCES ficha(id),
            radicado  TEXT NOT NULL REFERENCES radicado(numero),
            orden     INTEGER NOT NULL,
            PRIMARY KEY (ficha_id, radicado)
        );

        CREATE TABLE IF NOT EXISTS proceso (
            id_proceso              INTEGER PRIMARY KEY,
            id_reg_proceso          INTEGER,
            radicado                TEXT NOT NULL REFERENCES radicado(numero),
            id_conexion             INTEGER,
            fecha_proceso           TEXT,
            fecha_ultima_actuacion  TEXT,
            despacho                TEXT,
            codigo_despacho         TEXT,
            departamento            TEXT,
            ponente                 TEXT,
            tipo_proceso            TEXT,
            clase_proceso           TEXT,
            subclase_proceso        TEXT,
            recurso                 TEXT,
            ubicacion               TEXT,
            contenido_radicacion    TEXT,
            es_privado              INTEGER NOT NULL DEFAULT 0,
            sujetos                 TEXT,
            ultima_actualizacion    TEXT,
            detalle_consultado_en   TEXT
        );

        CREATE TABLE IF NOT EXISTS parte (
            id          INTEGER PRIMARY KEY,
            id_proceso  INTEGER NOT NULL REFERENCES proceso(id_proceso),
            orden       INTEGER NOT NULL,
            rol         TEXT NOT NULL,
            rol_base    TEXT NOT NULL,
            nombre      TEXT NOT NULL,
            UNIQUE (id_proceso, orden)
        );

        CREATE TABLE IF NOT EXISTS sujeto (
            id              INTEGER PRIMARY KEY,
            id_proceso      INTEGER NOT NULL REFERENCES proceso(id_proceso),
            id_reg_sujeto   INTEGER NOT NULL,
            tipo_sujeto     TEXT,
            rol_base        TEXT,
            es_emplazado    INTEGER NOT NULL DEFAULT 0,
            identificacion  TEXT,
            nombre          TEXT,
            UNIQUE (id_proceso, id_reg_sujeto)
        );

        CREATE TABLE IF NOT EXISTS documento (
            id                INTEGER PRIMARY KEY,
            id_proceso        INTEGER NOT NULL REFERENCES proceso(id_proceso),
            clave             TEXT NOT NULL,
            id_reg_documento  INTEGER,
            nombre            TEXT,
            descripcion       TEXT,
            fecha_carga       TEXT,
            tipo              TEXT,
            enlace            TEXT,
            extra             TEXT,
            UNIQUE (id_proceso, clave)
        );

        CREATE TABLE IF NOT EXISTS actuacion (
            id_reg_actuacion  INTEGER PRIMARY KEY,
            id_proceso        INTEGER NOT NULL REFERENCES proceso(id_proceso),
            radicado          TEXT,
            consecutivo       INTEGER,
            fecha_actuacion   TEXT,
            actuacion         TEXT,
            anotacion         TEXT,
            fecha_inicial     TEXT,
            fecha_final       TEXT,
            fecha_registro    TEXT,
            cod_regla         TEXT,
            con_documentos    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS aviso (
            id          INTEGER PRIMARY KEY,
            creado_en   TEXT NOT NULL,
            id_proceso  INTEGER,
            radicado    TEXT,
            tipo        TEXT NOT NULL,
            resumen     TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_proceso_radicado ON proceso(radicado);
        CREATE INDEX IF NOT EXISTS idx_parte_proceso ON parte(id_proceso);
        CREATE INDEX IF NOT EXISTS idx_ficha_radicado_numero ON ficha_radicado(radicado);
        CREATE INDEX IF NOT EXISTS idx_sujeto_proceso ON sujeto(id_proceso);
        CREATE INDEX IF NOT EXISTS idx_documento_proceso ON documento(id_proceso);
        CREATE INDEX IF NOT EXISTS idx_actuacion_proceso ON actuacion(id_proceso);
        CREATE INDEX IF NOT EXISTS idx_actuacion_fecha ON actuacion(fecha_actuacion);
        CREATE INDEX IF NOT EXISTS idx_aviso_creado ON aviso(creado_en);

        DROP VIEW IF EXISTS caso;
        CREATE VIEW caso AS
        SELECT
            p.id_proceso,
            p.radicado,
            p.despacho,
            p.departamento,
            p.ponente,
            p.tipo_proceso,
            p.clase_proceso,
            p.subclase_proceso,
            p.recurso,
            p.ubicacion,
            p.fecha_proceso,
            p.fecha_ultima_actuacion,
            p.contenido_radicacion,
            p.es_privado,
            f.ciudad,
            f.tipo_proceso AS tipo_csv,
            f.demandante AS demandante_csv,
            f.demandado AS demandado_csv,
            f.fila_csv
        FROM proceso p
        LEFT JOIN ficha_radicado fr ON fr.radicado = p.radicado
        LEFT JOIN ficha f ON f.id = fr.ficha_id;
        """
    )
    existentes = {fila[1] for fila in con.execute("PRAGMA table_info(proceso)")}
    for columna_nueva in (
        "sujetos_consultado_en",
        "documentos_consultado_en",
        "actuaciones_consultado_en",
    ):
        if columna_nueva not in existentes:
            con.execute(f"ALTER TABLE proceso ADD COLUMN {columna_nueva} TEXT")


def tablas(con: sqlite3.Connection) -> set[str]:
    return {fila[0] for fila in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def asegurar_radicado(con: sqlite3.Connection, numero: str) -> None:
    con.execute("INSERT OR IGNORE INTO radicado (numero) VALUES (?)", (numero,))


def reemplazar_partes(con: sqlite3.Connection, id_proceso: int, sujetos: str | None) -> None:
    con.execute("DELETE FROM parte WHERE id_proceso = ?", (id_proceso,))
    for orden, (rol, base, nombre) in enumerate(parsear_partes(sujetos), start=1):
        con.execute(
            """
            INSERT INTO parte (id_proceso, orden, rol, rol_base, nombre)
            VALUES (?, ?, ?, ?, ?)
            """,
            (id_proceso, orden, rol, base, nombre),
        )


def guardar_proceso_consulta(con: sqlite3.Connection, numero: str, proc: dict) -> int | None:
    id_proceso = proc.get("idProceso")
    if id_proceso is None:
        return None
    id_proceso = int(id_proceso)
    sujetos = texto(proc.get("sujetosProcesales"))
    con.execute(
        """
        INSERT INTO proceso (
            id_proceso, radicado, id_conexion, fecha_proceso, fecha_ultima_actuacion,
            despacho, departamento, es_privado, sujetos
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id_proceso) DO UPDATE SET
            radicado = excluded.radicado,
            id_conexion = excluded.id_conexion,
            fecha_proceso = excluded.fecha_proceso,
            fecha_ultima_actuacion = excluded.fecha_ultima_actuacion,
            despacho = excluded.despacho,
            departamento = excluded.departamento,
            es_privado = excluded.es_privado,
            sujetos = excluded.sujetos
        """,
        (
            id_proceso,
            numero,
            proc.get("idConexion"),
            fecha(proc.get("fechaProceso")),
            fecha(proc.get("fechaUltimaActuacion")),
            texto(proc.get("despacho")),
            texto(proc.get("departamento")),
            int(bool(proc.get("esPrivado"))),
            sujetos,
        ),
    )
    reemplazar_partes(con, id_proceso, sujetos)
    return id_proceso


def guardar_consulta(con: sqlite3.Connection, numero: str, paginas: list[dict]) -> list[int]:
    procesos: list[dict] = []
    cantidad = 0
    for pagina in paginas:
        lista = pagina.get("procesos") or []
        if isinstance(lista, list):
            procesos.extend(item for item in lista if isinstance(item, dict))
        registros = (pagina.get("paginacion") or {}).get("cantidadRegistros")
        if registros is not None:
            cantidad = int(registros)

    con.execute(
        """
        INSERT INTO radicado (numero, cantidad_registros, consultado_en)
        VALUES (?, ?, ?)
        ON CONFLICT(numero) DO UPDATE SET
            cantidad_registros = excluded.cantidad_registros,
            consultado_en = excluded.consultado_en
        """,
        (numero, cantidad, ahora()),
    )
    ids = []
    for proc in procesos:
        id_proceso = guardar_proceso_consulta(con, numero, proc)
        if id_proceso is not None:
            ids.append(id_proceso)
    return ids


def guardar_detalle(con: sqlite3.Connection, id_proceso: int, data: dict) -> None:
    radicado = texto(data.get("llaveProceso"))
    if radicado:
        asegurar_radicado(con, radicado)
    existe = con.execute(
        "SELECT radicado FROM proceso WHERE id_proceso = ?",
        (id_proceso,),
    ).fetchone()
    if existe is None:
        if not radicado:
            raise RuntimeError(f"detalle {id_proceso} sin radicado y sin consulta previa")
        con.execute(
            "INSERT INTO proceso (id_proceso, radicado, es_privado) VALUES (?, ?, 0)",
            (id_proceso, radicado),
        )
    elif radicado is None:
        radicado = existe[0]

    con.execute(
        """
        UPDATE proceso SET
            id_reg_proceso = ?,
            radicado = ?,
            id_conexion = COALESCE(?, id_conexion),
            fecha_proceso = COALESCE(?, fecha_proceso),
            despacho = COALESCE(?, despacho),
            codigo_despacho = ?,
            ponente = ?,
            tipo_proceso = ?,
            clase_proceso = ?,
            subclase_proceso = ?,
            recurso = ?,
            ubicacion = ?,
            contenido_radicacion = ?,
            es_privado = ?,
            ultima_actualizacion = ?,
            detalle_consultado_en = ?
        WHERE id_proceso = ?
        """,
        (
            data.get("idRegProceso"),
            radicado,
            data.get("idConexion"),
            fecha(data.get("fechaProceso")),
            texto(data.get("despacho")),
            texto(data.get("codDespachoCompleto")),
            texto(data.get("ponente")),
            texto(data.get("tipoProceso")),
            texto(data.get("claseProceso")),
            texto(data.get("subclaseProceso")),
            texto(data.get("recurso")),
            texto(data.get("ubicacion")),
            texto(data.get("contenidoRadicacion")),
            int(bool(data.get("esPrivado"))),
            texto(data.get("ultimaActualizacion")),
            ahora(),
            id_proceso,
        ),
    )


def migrar_aplanado(con: sqlite3.Connection) -> None:
    """Pasa las tablas viejas consulta/detalle al modelo y las elimina."""
    if "consulta" not in tablas(con):
        return
    log("Pasando el aplanado anterior al modelo de ficha, radicado, proceso y parte")
    con.row_factory = sqlite3.Row
    consultas = list(con.execute("SELECT * FROM consulta"))
    detalles = []
    if "detalle" in tablas(con):
        detalles = list(con.execute("SELECT * FROM detalle"))

    for fila in consultas:
        numero = texto(fila["radicado_consultado"])
        if not numero:
            continue
        asegurar_radicado(con, numero)
        if fila["idProceso"] is None:
            con.execute(
                """
                UPDATE radicado
                SET cantidad_registros = ?, consultado_en = ?
                WHERE numero = ?
                """,
                (fila["paginacion_cantidadRegistros"], fila["consultado_en"], numero),
            )
            continue
        guardar_proceso_consulta(
            con,
            numero,
            {
                "idProceso": fila["idProceso"],
                "idConexion": fila["idConexion"],
                "fechaProceso": fila["fechaProceso"],
                "fechaUltimaActuacion": fila["fechaUltimaActuacion"],
                "despacho": fila["despacho"],
                "departamento": fila["departamento"],
                "esPrivado": fila["esPrivado"],
                "sujetosProcesales": fila["sujetosProcesales"],
            },
        )
        con.execute(
            """
            UPDATE radicado
            SET cantidad_registros = ?, consultado_en = ?
            WHERE numero = ?
            """,
            (fila["paginacion_cantidadRegistros"], fila["consultado_en"], numero),
        )

    for fila in detalles:
        guardar_detalle(
            con,
            int(fila["idProceso"]),
            {
                "idRegProceso": fila["idRegProceso"],
                "llaveProceso": fila["llaveProceso"],
                "idConexion": fila["idConexion"],
                "esPrivado": fila["esPrivado"],
                "fechaProceso": fila["fechaProceso"],
                "codDespachoCompleto": fila["codDespachoCompleto"],
                "despacho": fila["despacho"],
                "ponente": fila["ponente"],
                "tipoProceso": fila["tipoProceso"],
                "claseProceso": fila["claseProceso"],
                "subclaseProceso": fila["subclaseProceso"],
                "recurso": fila["recurso"],
                "ubicacion": fila["ubicacion"],
                "contenidoRadicacion": fila["contenidoRadicacion"],
                "ultimaActualizacion": fila["ultimaActualizacion"],
            },
        )
        if fila["consultado_en"]:
            con.execute(
                "UPDATE proceso SET detalle_consultado_en = ? WHERE id_proceso = ?",
                (fila["consultado_en"], int(fila["idProceso"])),
            )

    con.execute("DROP TABLE IF EXISTS consulta")
    con.execute("DROP TABLE IF EXISTS detalle")
    log("Tablas consulta y detalle eliminadas")


def cargar_fichas(con: sqlite3.Connection, csv_path: Path) -> list[str]:
    """Reemplaza las fichas con el CSV. Devuelve los radicados en orden."""
    with csv_path.open(newline="", encoding="utf-8", errors="replace") as fh:
        lector = csv.DictReader(fh)
        campos = list(lector.fieldnames or [])
        col_radicado = columna(campos, "RADICADO") or columna(campos, "RADICADOS")
        if col_radicado is None:
            raise SystemExit(f"No está la columna RADICADO. Columnas: {campos}")
        col_ciudad = columna(campos, "CIUDAD")
        col_juzgado = columna(campos, "JUZGADO")
        col_tipo = columna(campos, "TIPO DE PROCESO")
        col_demandante = columna(campos, "DEMANDANTE")
        col_demandado = columna(campos, "DEMANDADO")
        filas = list(lector)

    con.execute("DELETE FROM ficha_juzgado")
    con.execute("DELETE FROM ficha_radicado")
    con.execute("DELETE FROM ficha")

    radicados: list[str] = []
    vistos: set[str] = set()
    for indice, fila in enumerate(filas, start=1):
        cursor = con.execute(
            """
            INSERT INTO ficha (fila_csv, ciudad, tipo_proceso, demandante, demandado)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                indice,
                texto(fila.get(col_ciudad) if col_ciudad else None),
                texto(fila.get(col_tipo) if col_tipo else None),
                texto(fila.get(col_demandante) if col_demandante else None),
                texto(fila.get(col_demandado) if col_demandado else None),
            ),
        )
        ficha_id = cursor.lastrowid
        for orden, (nombre, url) in enumerate(
            parsear_juzgados(fila.get(col_juzgado) or "" if col_juzgado else ""),
            start=1,
        ):
            con.execute(
                """
                INSERT INTO ficha_juzgado (ficha_id, orden, nombre, url)
                VALUES (?, ?, ?, ?)
                """,
                (ficha_id, orden, nombre, url),
            )
        for orden, numero in enumerate(parsear_radicados(fila.get(col_radicado) or ""), start=1):
            asegurar_radicado(con, numero)
            con.execute(
                """
                INSERT INTO ficha_radicado (ficha_id, radicado, orden)
                VALUES (?, ?, ?)
                """,
                (ficha_id, numero, orden),
            )
            if numero not in vistos:
                vistos.add(numero)
                radicados.append(numero)
    return radicados


def obtener_json(
    session: requests.Session,
    url: str,
    params: dict | None = None,
    vacio_si_no_hay: bool = False,
) -> dict:
    ultimo_error = "sin respuesta"
    for intento in range(1, 4):
        try:
            resp = session.get(url, params=params, headers=HEADERS, timeout=40)
        except requests.RequestException as exc:
            ultimo_error = str(exc)
            time.sleep(intento * 2)
            continue

        if resp.status_code in (429, 500, 502, 503, 504):
            ultimo_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
            time.sleep(intento * 2)
            continue
        if resp.status_code == 403:
            espera = 20 * intento
            ultimo_error = "HTTP 403"
            log(f"  la Rama respondió 403, espero {espera}s")
            time.sleep(espera)
            continue
        if resp.status_code == 404 and vacio_si_no_hay:
            time.sleep(PAUSA_SEGUNDOS)
            return {}
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
        try:
            data = resp.json()
        except ValueError as exc:
            raise RuntimeError(f"Respuesta que no es JSON: {resp.text[:300]}") from exc
        if not isinstance(data, dict):
            raise RuntimeError("La respuesta JSON no es un objeto")
        time.sleep(PAUSA_SEGUNDOS)
        return data

    raise RuntimeError(ultimo_error)


def cantidad_paginas(data: dict) -> int:
    paginacion = data.get("paginacion") or {}
    try:
        return max(int(paginacion.get("cantidadPaginas") or 1), 1)
    except (TypeError, ValueError):
        return 1


def pedir_lista(
    session: requests.Session,
    url: str,
    clave: str,
    paginar: bool,
) -> tuple[list[dict], bool]:
    """Recorre las páginas. El segundo valor dice si la lista llegó completa."""
    items: list[dict] = []
    total_esperado = None
    pagina = 1
    usar_pagina = paginar
    while pagina <= MAX_PAGINAS:
        params = {"pagina": str(pagina)} if usar_pagina else None
        data = obtener_json(session, url, params=params, vacio_si_no_hay=True)
        if not data:
            return [], True
        bloque = data.get(clave) or []
        if not isinstance(bloque, list):
            bloque = []
        items.extend(item for item in bloque if isinstance(item, dict))
        paginacion = data.get("paginacion") or {}
        if paginacion.get("cantidadRegistros") is not None:
            try:
                total_esperado = int(paginacion["cantidadRegistros"])
            except (TypeError, ValueError):
                total_esperado = None
        if not usar_pagina:
            if cantidad_paginas(data) <= 1:
                break
            usar_pagina = True
            pagina = 2
            continue
        if pagina >= cantidad_paginas(data) or not bloque:
            break
        pagina += 1
    else:
        return items, False
    completo = total_esperado is None or len(items) == total_esperado
    return items, completo


def consultar_radicado(session: requests.Session, numero: str) -> list[dict]:
    paginas: list[dict] = []
    pagina = 1
    while pagina <= MAX_PAGINAS:
        data = obtener_json(
            session,
            CONSULTA_URL,
            params={"numero": numero, "SoloActivos": "false", "pagina": str(pagina)},
        )
        paginas.append(data)
        paginacion = data.get("paginacion") or {}
        try:
            cantidad = int(paginacion.get("cantidadPaginas") or 1)
        except (TypeError, ValueError):
            cantidad = 1
        if pagina >= cantidad or not data.get("procesos"):
            break
        pagina += 1
    return paginas


def ya_consultado(con: sqlite3.Connection, numero: str) -> bool:
    fila = con.execute(
        "SELECT consultado_en FROM radicado WHERE numero = ?",
        (numero,),
    ).fetchone()
    return fila is not None and fila[0] is not None


def paso_consulta(
    con: sqlite3.Connection,
    session: requests.Session,
    radicados: list[str],
    actualizar: bool,
) -> tuple[int, int]:
    nuevos = 0
    errores = 0
    for indice, numero in enumerate(radicados, start=1):
        log(f"[consulta {indice}/{len(radicados)}] {numero}")
        if not actualizar and ya_consultado(con, numero):
            log("  ya estaba en la base")
            continue
        try:
            paginas = consultar_radicado(session, numero)
        except RuntimeError as exc:
            errores += 1
            log(f"  error: {exc}")
            continue
        ids = guardar_consulta(con, numero, paginas)
        con.commit()
        nuevos += len(ids)
        if ids:
            log(f"  procesos={len(ids)} idProceso={ids}")
        else:
            log("  la Rama no devolvió procesos")
    return nuevos, errores


def paso_detalle(
    con: sqlite3.Connection,
    session: requests.Session,
    actualizar: bool,
    radicado: str | None = None,
) -> tuple[int, int]:
    condiciones = []
    params: list[str] = []
    if radicado:
        condiciones.append("radicado = ?")
        params.append(radicado)
    elif not actualizar:
        condiciones.append("detalle_consultado_en IS NULL")
    where = f"WHERE {' AND '.join(condiciones)}" if condiciones else ""
    pendientes = [
        fila[0]
        for fila in con.execute(
            f"SELECT id_proceso FROM proceso {where} ORDER BY id_proceso",
            params,
        )
    ]
    log(f"Detalles pendientes: {len(pendientes)}")
    nuevos = 0
    errores = 0
    for indice, id_proceso in enumerate(pendientes, start=1):
        log(f"[detalle {indice}/{len(pendientes)}] {id_proceso}")
        try:
            data = obtener_json(session, f"{DETALLE_URL}/{id_proceso}")
        except RuntimeError as exc:
            errores += 1
            log(f"  error: {exc}")
            continue
        guardar_detalle(con, id_proceso, data)
        con.commit()
        nuevos += 1
        log(f"  guardado {texto(data.get('despacho'))}")
    return nuevos, errores


def registrar_aviso(
    con: sqlite3.Connection,
    id_proceso: int,
    radicado: str | None,
    tipo: str,
    resumen: str,
) -> None:
    momento = ahora()
    con.execute(
        """
        INSERT INTO aviso (creado_en, id_proceso, radicado, tipo, resumen)
        VALUES (?, ?, ?, ?, ?)
        """,
        (momento, id_proceso, radicado, tipo, resumen),
    )
    linea = f"[{momento}] {tipo} | {radicado or id_proceso} | {resumen}"
    log(linea)
    with AVISOS_PATH.open("a", encoding="utf-8") as fh:
        fh.write(linea + "\n")


def notificar_sistema(resumen: str) -> None:
    if not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        return
    if shutil.which("notify-send") is None:
        return
    subprocess.run(["notify-send", "vig-leg", resumen], check=False)


def firma_sujeto(fila: dict) -> tuple:
    return (
        texto(fila.get("tipo_sujeto")),
        texto(fila.get("rol_base")),
        int(fila.get("es_emplazado") or 0),
        texto(fila.get("identificacion")),
        texto(fila.get("nombre")),
    )


def firma_actuacion(fila: dict) -> tuple:
    return (
        fila.get("consecutivo"),
        fila.get("fecha_actuacion"),
        texto(fila.get("actuacion")),
        texto(fila.get("anotacion")),
        fila.get("fecha_inicial"),
        fila.get("fecha_final"),
        fila.get("fecha_registro"),
        texto(fila.get("cod_regla")),
        int(fila.get("con_documentos") or 0),
    )


def preparar_sujeto(item: dict) -> dict | None:
    if item.get("idRegSujeto") is None:
        return None
    tipo = texto(item.get("tipoSujeto")) or "otro"
    return {
        "id_reg_sujeto": int(item["idRegSujeto"]),
        "tipo_sujeto": tipo,
        "rol_base": rol_base(tipo),
        "es_emplazado": int(bool(item.get("esEmplazado"))),
        "identificacion": texto(item.get("identificacion")),
        "nombre": texto(item.get("nombreRazonSocial")),
    }


def preparar_actuacion(item: dict, id_proceso: int) -> dict | None:
    if item.get("idRegActuacion") is None:
        return None
    return {
        "id_reg_actuacion": int(item["idRegActuacion"]),
        "id_proceso": id_proceso,
        "radicado": texto(item.get("llaveProceso")),
        "consecutivo": item.get("consActuacion"),
        "fecha_actuacion": fecha(item.get("fechaActuacion")),
        "actuacion": texto(item.get("actuacion")),
        "anotacion": texto(item.get("anotacion")),
        "fecha_inicial": fecha(item.get("fechaInicial")),
        "fecha_final": fecha(item.get("fechaFinal")),
        "fecha_registro": fecha(item.get("fechaRegistro")),
        "cod_regla": texto(item.get("codRegla")),
        "con_documentos": int(bool(item.get("conDocumentos"))),
    }


def preparar_documento(item: dict) -> dict:
    conocidos = {
        "idRegDocumento": "id_reg_documento",
        "idDocumento": "id_reg_documento",
        "nombre": "nombre",
        "nombreArchivo": "nombre",
        "descripcion": "descripcion",
        "description": "descripcion",
        "Description": "descripcion",
        "fechaCarga": "fecha_carga",
        "fecha": "fecha_carga",
        "tipo": "tipo",
        "href": "enlace",
        "url": "enlace",
    }
    salida = {
        "id_reg_documento": None,
        "nombre": None,
        "descripcion": None,
        "fecha_carga": None,
        "tipo": None,
        "enlace": None,
    }
    usados: set[str] = set()
    for origen, destino in conocidos.items():
        if origen not in item or item[origen] is None or salida[destino] is not None:
            continue
        valor = item[origen]
        if destino == "id_reg_documento":
            try:
                valor = int(valor)
            except (TypeError, ValueError):
                continue
        elif destino == "fecha_carga":
            valor = fecha(valor)
        else:
            valor = texto(valor)
        salida[destino] = valor
        usados.add(origen)
    extra = {
        clave: valor
        for clave, valor in item.items()
        if clave not in usados and clave not in conocidos and clave != "cant"
    }
    salida["extra"] = json.dumps(extra, ensure_ascii=False, sort_keys=True) if extra else None
    if salida["id_reg_documento"] is not None:
        salida["clave"] = f"id:{salida['id_reg_documento']}"
    else:
        salida["clave"] = "txt:" + "|".join(
            [
                salida["nombre"] or "",
                salida["descripcion"] or "",
                salida["fecha_carga"] or "",
                salida["extra"] or "",
            ]
        )
    return salida


def firma_documento(fila: dict) -> tuple:
    return (
        fila.get("id_reg_documento"),
        texto(fila.get("nombre")),
        texto(fila.get("descripcion")),
        fila.get("fecha_carga"),
        texto(fila.get("tipo")),
        texto(fila.get("enlace")),
        texto(fila.get("extra")),
    )


def guardar_sujetos(
    con: sqlite3.Connection,
    id_proceso: int,
    radicado: str | None,
    items: list[dict],
    completo: bool,
    notificar: bool,
) -> int:
    nuevos = {}
    for item in items:
        preparado = preparar_sujeto(item)
        if preparado:
            nuevos[preparado["id_reg_sujeto"]] = preparado
    anteriores = {
        fila[0]: {
            "tipo_sujeto": fila[1],
            "rol_base": fila[2],
            "es_emplazado": fila[3],
            "identificacion": fila[4],
            "nombre": fila[5],
        }
        for fila in con.execute(
            """
            SELECT id_reg_sujeto, tipo_sujeto, rol_base, es_emplazado, identificacion, nombre
            FROM sujeto WHERE id_proceso = ?
            """,
            (id_proceso,),
        )
    }
    cambios = 0
    for clave, fila in nuevos.items():
        firma = firma_sujeto(fila)
        if clave not in anteriores:
            con.execute(
                """
                INSERT INTO sujeto (
                    id_proceso, id_reg_sujeto, tipo_sujeto, rol_base,
                    es_emplazado, identificacion, nombre
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    id_proceso,
                    clave,
                    fila["tipo_sujeto"],
                    fila["rol_base"],
                    fila["es_emplazado"],
                    fila["identificacion"],
                    fila["nombre"],
                ),
            )
            if notificar:
                cambios += 1
                registrar_aviso(
                    con,
                    id_proceso,
                    radicado,
                    "sujeto_nuevo",
                    f"{fila['tipo_sujeto']}: {fila['nombre']}",
                )
        elif firma != firma_sujeto(anteriores[clave]):
            con.execute(
                """
                UPDATE sujeto SET
                    tipo_sujeto = ?, rol_base = ?, es_emplazado = ?,
                    identificacion = ?, nombre = ?
                WHERE id_proceso = ? AND id_reg_sujeto = ?
                """,
                (
                    fila["tipo_sujeto"],
                    fila["rol_base"],
                    fila["es_emplazado"],
                    fila["identificacion"],
                    fila["nombre"],
                    id_proceso,
                    clave,
                ),
            )
            if notificar:
                cambios += 1
                registrar_aviso(
                    con,
                    id_proceso,
                    radicado,
                    "sujeto_actualizado",
                    f"{fila['tipo_sujeto']}: {fila['nombre']}",
                )
    if completo:
        for clave, previo in anteriores.items():
            if clave not in nuevos:
                con.execute(
                    "DELETE FROM sujeto WHERE id_proceso = ? AND id_reg_sujeto = ?",
                    (id_proceso, clave),
                )
                if notificar:
                    cambios += 1
                    registrar_aviso(
                        con,
                        id_proceso,
                        radicado,
                        "sujeto_retirado",
                        f"{previo['tipo_sujeto']}: {previo['nombre']}",
                    )
    return cambios


def guardar_documentos(
    con: sqlite3.Connection,
    id_proceso: int,
    radicado: str | None,
    items: list[dict],
    completo: bool,
    notificar: bool,
) -> int:
    nuevos = {}
    for item in items:
        preparado = preparar_documento(item)
        nuevos[preparado["clave"]] = preparado
    anteriores = {
        fila[0]: {
            "id_reg_documento": fila[1],
            "nombre": fila[2],
            "descripcion": fila[3],
            "fecha_carga": fila[4],
            "tipo": fila[5],
            "enlace": fila[6],
            "extra": fila[7],
        }
        for fila in con.execute(
            """
            SELECT clave, id_reg_documento, nombre, descripcion, fecha_carga, tipo, enlace, extra
            FROM documento WHERE id_proceso = ?
            """,
            (id_proceso,),
        )
    }
    cambios = 0
    for clave, fila in nuevos.items():
        etiqueta = fila["nombre"] or fila["descripcion"] or clave
        if clave not in anteriores:
            con.execute(
                """
                INSERT INTO documento (
                    id_proceso, clave, id_reg_documento, nombre, descripcion,
                    fecha_carga, tipo, enlace, extra
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    id_proceso,
                    clave,
                    fila["id_reg_documento"],
                    fila["nombre"],
                    fila["descripcion"],
                    fila["fecha_carga"],
                    fila["tipo"],
                    fila["enlace"],
                    fila["extra"],
                ),
            )
            if notificar:
                cambios += 1
                registrar_aviso(con, id_proceso, radicado, "documento_nuevo", etiqueta)
        elif firma_documento(fila) != firma_documento(anteriores[clave]):
            con.execute(
                """
                UPDATE documento SET
                    id_reg_documento = ?, nombre = ?, descripcion = ?,
                    fecha_carga = ?, tipo = ?, enlace = ?, extra = ?
                WHERE id_proceso = ? AND clave = ?
                """,
                (
                    fila["id_reg_documento"],
                    fila["nombre"],
                    fila["descripcion"],
                    fila["fecha_carga"],
                    fila["tipo"],
                    fila["enlace"],
                    fila["extra"],
                    id_proceso,
                    clave,
                ),
            )
            if notificar:
                cambios += 1
                registrar_aviso(con, id_proceso, radicado, "documento_actualizado", etiqueta)
    if completo:
        for clave, previo in anteriores.items():
            if clave not in nuevos:
                con.execute(
                    "DELETE FROM documento WHERE id_proceso = ? AND clave = ?",
                    (id_proceso, clave),
                )
                if notificar:
                    cambios += 1
                    registrar_aviso(
                        con,
                        id_proceso,
                        radicado,
                        "documento_retirado",
                        previo["nombre"] or clave,
                    )
    return cambios


def guardar_actuaciones(
    con: sqlite3.Connection,
    id_proceso: int,
    radicado: str | None,
    items: list[dict],
    completo: bool,
    notificar: bool,
) -> int:
    nuevos = {}
    for item in items:
        preparado = preparar_actuacion(item, id_proceso)
        if preparado:
            nuevos[preparado["id_reg_actuacion"]] = preparado
    anteriores = {
        fila[0]: {
            "consecutivo": fila[1],
            "fecha_actuacion": fila[2],
            "actuacion": fila[3],
            "anotacion": fila[4],
            "fecha_inicial": fila[5],
            "fecha_final": fila[6],
            "fecha_registro": fila[7],
            "cod_regla": fila[8],
            "con_documentos": fila[9],
        }
        for fila in con.execute(
            """
            SELECT id_reg_actuacion, consecutivo, fecha_actuacion, actuacion, anotacion,
                   fecha_inicial, fecha_final, fecha_registro, cod_regla, con_documentos
            FROM actuacion WHERE id_proceso = ?
            """,
            (id_proceso,),
        )
    }
    cambios = 0
    for clave, fila in nuevos.items():
        resumen = f"{fila['fecha_actuacion'] or ''} {fila['actuacion'] or ''}".strip()
        if fila["anotacion"]:
            resumen = f"{resumen} — {fila['anotacion']}"
        if clave not in anteriores:
            con.execute(
                """
                INSERT INTO actuacion (
                    id_reg_actuacion, id_proceso, radicado, consecutivo, fecha_actuacion,
                    actuacion, anotacion, fecha_inicial, fecha_final, fecha_registro,
                    cod_regla, con_documentos
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    clave,
                    id_proceso,
                    fila["radicado"] or radicado,
                    fila["consecutivo"],
                    fila["fecha_actuacion"],
                    fila["actuacion"],
                    fila["anotacion"],
                    fila["fecha_inicial"],
                    fila["fecha_final"],
                    fila["fecha_registro"],
                    fila["cod_regla"],
                    fila["con_documentos"],
                ),
            )
            if notificar:
                cambios += 1
                registrar_aviso(con, id_proceso, radicado, "actuacion_nueva", resumen)
        elif firma_actuacion(fila) != firma_actuacion(anteriores[clave]):
            con.execute(
                """
                UPDATE actuacion SET
                    radicado = ?, consecutivo = ?, fecha_actuacion = ?, actuacion = ?,
                    anotacion = ?, fecha_inicial = ?, fecha_final = ?, fecha_registro = ?,
                    cod_regla = ?, con_documentos = ?
                WHERE id_reg_actuacion = ?
                """,
                (
                    fila["radicado"] or radicado,
                    fila["consecutivo"],
                    fila["fecha_actuacion"],
                    fila["actuacion"],
                    fila["anotacion"],
                    fila["fecha_inicial"],
                    fila["fecha_final"],
                    fila["fecha_registro"],
                    fila["cod_regla"],
                    fila["con_documentos"],
                    clave,
                ),
            )
            if notificar:
                cambios += 1
                registrar_aviso(con, id_proceso, radicado, "actuacion_actualizada", resumen)
    if completo:
        for clave, previo in anteriores.items():
            if clave not in nuevos:
                con.execute("DELETE FROM actuacion WHERE id_reg_actuacion = ?", (clave,))
                if notificar:
                    cambios += 1
                    resumen = f"{previo['fecha_actuacion'] or ''} {previo['actuacion'] or ''}".strip()
                    registrar_aviso(con, id_proceso, radicado, "actuacion_retirada", resumen)
    if completo and nuevos:
        con.execute(
            """
            UPDATE proceso SET fecha_ultima_actuacion = (
                SELECT MAX(fecha_actuacion) FROM actuacion WHERE id_proceso = ?
            )
            WHERE id_proceso = ?
              AND (
                fecha_ultima_actuacion IS NULL
                OR fecha_ultima_actuacion < (
                    SELECT MAX(fecha_actuacion) FROM actuacion WHERE id_proceso = ?
                )
              )
            """,
            (id_proceso, id_proceso, id_proceso),
        )
    return cambios


def paso_seguimiento(
    con: sqlite3.Connection,
    session: requests.Session,
    limite: int,
    solo_faltantes: bool = False,
    radicado: str | None = None,
    solo_actuaciones: bool = False,
) -> tuple[int, int]:
    """Pide sujetos, documentos y actuaciones. Solo avisa si ya había una carga previa.

    Con solo_actuaciones únicamente pide Proceso/Actuaciones, la última consulta de cada expediente.
    """
    consulta = """
        SELECT id_proceso, radicado, sujetos_consultado_en,
               documentos_consultado_en, actuaciones_consultado_en
        FROM proceso
    """
    params: list[str] = []
    if radicado:
        consulta += " WHERE radicado = ?"
        params.append(radicado)
    consulta += " ORDER BY id_proceso"
    procesos = list(con.execute(consulta, params))
    if solo_faltantes:
        if solo_actuaciones:
            procesos = [fila for fila in procesos if fila[4] is None]
        else:
            procesos = [
                fila for fila in procesos
                if fila[2] is None or fila[3] is None or fila[4] is None
            ]
    if limite > 0:
        procesos = procesos[:limite]
    if solo_actuaciones:
        log(f"Actuaciones de {len(procesos)} expediente(s)")
    else:
        log(f"Seguimiento de {len(procesos)} expediente(s)")
    cambios = 0
    errores = 0
    for indice, fila in enumerate(procesos, start=1):
        id_proceso, radicado, sujetos_en, documentos_en, actuaciones_en = fila
        log(f"[seguimiento {indice}/{len(procesos)}] {radicado} idProceso={id_proceso}")
        try:
            if solo_actuaciones:
                sujetos, sujetos_ok = [], False
                documentos, documentos_ok = [], False
                actuaciones, actuaciones_ok = pedir_lista(
                    session, f"{ACTUACIONES_URL}/{id_proceso}", "actuaciones", paginar=True
                )
            else:
                sujetos, sujetos_ok = pedir_lista(
                    session, f"{SUJETOS_URL}/{id_proceso}", "sujetos", paginar=True
                )
                documentos, documentos_ok = pedir_lista(
                    session, f"{DOCUMENTOS_URL}/{id_proceso}", "documentos", paginar=False
                )
                actuaciones, actuaciones_ok = pedir_lista(
                    session, f"{ACTUACIONES_URL}/{id_proceso}", "actuaciones", paginar=True
                )
        except RuntimeError as exc:
            errores += 1
            log(f"  error: {exc}")
            if "403" in str(exc):
                log("  paro el seguimiento: la Rama bloqueó las peticiones. Lo pendiente queda para la próxima corrida")
                break
            continue

        momento = ahora()
        if sujetos_ok:
            cambios += guardar_sujetos(
                con, id_proceso, radicado, sujetos, True, sujetos_en is not None
            )
            con.execute(
                "UPDATE proceso SET sujetos_consultado_en = ? WHERE id_proceso = ?",
                (momento, id_proceso),
            )
        elif not solo_actuaciones:
            log("  sujetos incompletos; no se marcan ni se borran")
        if documentos_ok:
            cambios += guardar_documentos(
                con, id_proceso, radicado, documentos, True, documentos_en is not None
            )
            con.execute(
                "UPDATE proceso SET documentos_consultado_en = ? WHERE id_proceso = ?",
                (momento, id_proceso),
            )
        elif not solo_actuaciones:
            log("  documentos incompletos; no se marcan ni se borran")
        if actuaciones_ok:
            cambios += guardar_actuaciones(
                con, id_proceso, radicado, actuaciones, True, actuaciones_en is not None
            )
            con.execute(
                "UPDATE proceso SET actuaciones_consultado_en = ? WHERE id_proceso = ?",
                (momento, id_proceso),
            )
        else:
            log("  actuaciones incompletas; no se marcan ni se borran")
        con.commit()
        if solo_actuaciones:
            log(f"  actuaciones={len(actuaciones)}")
        else:
            log(
                f"  sujetos={len(sujetos)} documentos={len(documentos)} "
                f"actuaciones={len(actuaciones)}"
            )
    return cambios, errores


def segundos_de(intervalo: str) -> int:
    texto_intervalo = intervalo.strip().lower()
    unidades = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    if texto_intervalo[-1:] in unidades and texto_intervalo[:-1].isdigit():
        valor = int(texto_intervalo[:-1]) * unidades[texto_intervalo[-1]]
    else:
        raise SystemExit("El intervalo debe ser como 30m, 6h o 1d")
    if valor < 15 * 60:
        raise SystemExit("El intervalo mínimo es 15m")
    return valor


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Consulta radicados y vigila sujetos, documentos y actuaciones"
    )
    parser.add_argument(
        "--paso",
        choices=("1", "2", "3", "ambos", "seguimiento", "todos"),
        default="ambos",
        help="1 radicado, 2 detalle, 3 sujetos/documentos/actuaciones, ambos = 1 y 2, todos = los tres",
    )
    parser.add_argument(
        "--cada",
        help="Repite el seguimiento. Ejemplo: 6h, 30m, 1d. Mínimo 15m",
    )
    parser.add_argument(
        "--solo-faltantes",
        action="store_true",
        help="En el seguimiento, solo pide expedientes que aún no tienen sujetos, documentos o actuaciones",
    )
    parser.add_argument(
        "--solo-actuaciones",
        action="store_true",
        help="En el seguimiento, solo pide las actuaciones de cada expediente",
    )
    parser.add_argument(
        "--limite",
        type=int,
        default=0,
        help="Máximo de radicados del CSV en el paso 1. 0 = todos",
    )
    parser.add_argument(
        "--actualizar",
        action="store_true",
        help="Vuelve a pedir y reemplaza lo que ya está en la base",
    )
    parser.add_argument(
        "--radicado",
        help="Consulta, detalle y seguimiento solo de este radicado de 23 dígitos",
    )
    parser.add_argument("--csv", type=Path, default=CSV_PATH)
    parser.add_argument("--db", type=Path, default=DB_PATH)
    args = parser.parse_args()

    if args.cada:
        pausa = segundos_de(args.cada)
        log(f"Vigilancia cada {args.cada}")
        while True:
            try:
                ejecutar(args, solo_seguimiento=True)
            except Exception as exc:
                log(f"error en la revisión: {exc}")
            log(f"Próxima revisión en {args.cada}")
            time.sleep(pausa)
        return

    ejecutar(args, solo_seguimiento=False)


def ejecutar(args, solo_seguimiento: bool) -> None:
    log("--- inicio ---")
    log(f"Base: {args.db}")

    with sqlite3.connect(args.db) as con:
        con.execute("PRAGMA foreign_keys = ON")
        init_db(con)
        migrar_aplanado(con)

        if args.csv.exists():
            radicados = cargar_fichas(con, args.csv)
            con.commit()
            log(f"Fichas del CSV: {len(radicados)} radicados")
        else:
            radicados = [
                fila[0]
                for fila in con.execute(
                    """
                    SELECT fr.radicado
                    FROM ficha_radicado fr
                    JOIN ficha f ON f.id = fr.ficha_id
                    ORDER BY f.fila_csv, fr.orden
                    """
                )
            ]

        session = requests.Session()
        hacer_consulta = not solo_seguimiento and args.paso in ("1", "ambos", "todos")
        hacer_detalle = not solo_seguimiento and args.paso in ("2", "ambos", "todos")
        hacer_seguimiento = solo_seguimiento or args.paso in ("3", "seguimiento", "todos")
        uno = "".join(caracter for caracter in (args.radicado or "") if caracter.isdigit())
        if args.radicado:
            if len(uno) != 23:
                raise SystemExit("El radicado debe tener 23 dígitos")
            asegurar_radicado(con, uno)
            con.commit()
            radicados = [uno]
            log(f"Solo el radicado {uno}")

        if hacer_consulta:
            if args.limite > 0 and not uno:
                radicados = radicados[: args.limite]
            log(f"Radicados a consultar: {len(radicados)}")
            nuevos, errores = paso_consulta(con, session, radicados, args.actualizar or bool(uno))
            log(f"Paso 1 listo. Procesos tocados: {nuevos}. Errores: {errores}")

        if hacer_detalle:
            nuevos, errores = paso_detalle(con, session, args.actualizar, radicado=uno or None)
            log(f"Paso 2 listo. Detalles nuevos: {nuevos}. Errores: {errores}")

        if hacer_seguimiento:
            cambios, errores = paso_seguimiento(
                con,
                session,
                0 if uno else args.limite,
                solo_faltantes=args.solo_faltantes,
                radicado=uno or None,
                solo_actuaciones=args.solo_actuaciones,
            )
            log(f"Seguimiento listo. Cambios: {cambios}. Errores: {errores}")
            if cambios:
                notificar_sistema(f"{cambios} cambio(s) en los expedientes. Ver avisos.log")

    log("--- fin ---")


if __name__ == "__main__":
    main()
