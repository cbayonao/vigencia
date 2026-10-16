#!/usr/bin/env python3
"""Catálogo de despachos de publicaciones procesales, por departamento.

La Rama expone los juzgados en un portlet Liferay que pide sesión: primero
se visita el inicio (así nace la JSESSIONID) y después se pide cada
departamento. La respuesta trae `filtros` (municipios, iguales siempre) y
`despachos` (el código de 12 dígitos y el nombre de cada juzgado).

Uso:
    python3 pp_crawler.py                  # los 33 departamentos
    python3 pp_crawler.py --solo 05,11     # solo Antioquia y Bogotá
    python3 pp_crawler.py --salida pp_datos # otra carpeta

Guarda un JSON crudo por departamento y uno consolidado con todos los
despachos. Entre peticiones espera de 1 a 3 segundos al azar.
"""

import argparse
import json
import random
import re
import time
from pathlib import Path

import requests

BASE = "https://publicacionesprocesales.ramajudicial.gov.co"
INICIO = f"{BASE}/web/publicaciones-procesales/inicio"
PORTLET = "co_com_avanti_efectosProcesales_PublicacionesEfectosProcesalesPortletV2_INSTANCE_BIyXQFHVaYaq"
NS = f"_{PORTLET}_"
PORTLET_ID = 178845807

HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}

# Si la página no trae la lista, estos son los 33 del DANE.
DEPTOS_RESPALDO = [
    "05", "08", "11", "13", "15", "17", "18", "19", "20", "23", "25",
    "27", "41", "44", "47", "50", "52", "54", "63", "66", "68", "70",
    "73", "76", "81", "85", "86", "88", "91", "94", "95", "97", "99",
]


def pausa():
    time.sleep(random.uniform(1, 3))


def abrir_sesion() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    for intento in range(1, 4):
        try:
            resp = session.get(INICIO, timeout=60)
            if resp.status_code == 200 and resp.content:
                return session
        except requests.RequestException:
            pass
        time.sleep(intento * 2)
    raise SystemExit("no pude abrir la página de publicaciones procesales")


def departamentos(session: requests.Session) -> list[tuple[str, str]]:
    """Códigos y nombres desde el combo de departamento de la página."""
    try:
        html = session.get(INICIO, timeout=60).text
    except requests.RequestException:
        return [(c, c) for c in DEPTOS_RESPALDO]
    bloque = re.search(r'<select id="departamento".*?</select>', html, re.DOTALL)
    if not bloque:
        return [(c, c) for c in DEPTOS_RESPALDO]
    vistos = []
    for codigo, nombre in re.findall(r'<option[^>]*value="(\d{2})"[^>]*>([^<]*)<', bloque.group(0)):
        nombre = nombre.strip()
        if (codigo, nombre) not in vistos:
            vistos.append((codigo, nombre))
    return vistos or [(c, c) for c in DEPTOS_RESPALDO]


def pedir_depto(session: requests.Session, codigo: str) -> dict:
    params = {
        "p_p_id": PORTLET,
        "p_p_lifecycle": "2",
        "p_p_state": "normal",
        "p_p_mode": "view",
        "p_p_cacheability": "cacheLevelPage",
        NS + "tipoFiltro": "departamento",
        NS + "idFiltro": codigo,
        NS + "id": PORTLET_ID,
    }
    ultimo = "sin respuesta"
    for intento in range(1, 4):
        try:
            resp = session.get(INICIO, params=params, timeout=60)
        except requests.RequestException as exc:
            ultimo = str(exc)
            time.sleep(intento * 2)
            continue
        if resp.status_code in (429, 500, 502, 503, 504):
            ultimo = f"HTTP {resp.status_code}"
            time.sleep(intento * 2)
            continue
        if resp.status_code == 403:
            ultimo = "HTTP 403"
            time.sleep(20 * intento)
            continue
        try:
            return resp.json()
        except ValueError:
            ultimo = f"HTTP {resp.status_code} sin JSON ({len(resp.content)} bytes)"
            time.sleep(intento * 2)
    raise SystemExit(f"departamento {codigo}: {ultimo}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--solo", default="", help="códigos separados por coma, ej. 05,11")
    parser.add_argument("--salida", default="pp_datos", help="carpeta de los JSON")
    args = parser.parse_args()

    salida = Path(args.salida)
    salida.mkdir(parents=True, exist_ok=True)

    session = abrir_sesion()
    deptos = departamentos(session)
    if args.solo:
        elegidos = {c.strip() for c in args.solo.split(",") if c.strip()}
        deptos = [(c, n) for c, n in deptos if c in elegidos]

    todos = []
    for codigo, nombre in deptos:
        print(f"{codigo} {nombre}...", flush=True)
        datos = pedir_depto(session, codigo)
        (salida / f"depto_{codigo}.json").write_text(
            json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        for d in datos.get("despachos", []):
            if str(d.get("id")) == "0":
                continue
            todos.append({
                "departamento": codigo,
                "depto_nombre": nombre,
                "codigo": str(d.get("id")),
                "nombre": str(d.get("nombre")),
            })
        print(f"  {len(datos.get('despachos', [])) - 1} despachos")
        pausa()

    (salida / "pp_despachos.json").write_text(
        json.dumps(todos, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"total: {len(todos)} despachos en {salida / 'pp_despachos.json'}")


if __name__ == "__main__":
    main()
