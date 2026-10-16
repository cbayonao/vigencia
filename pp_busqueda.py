#!/usr/bin/env python3
"""Búsqueda de publicaciones procesales por despacho, con paginación.

La búsqueda (`action=busqueda`) devuelve HTML. Cada aviso es una fila
`<tr class=" col-xs-12 tramites ">` (los espacios son literales) con el
título y su URL, las etiquetas (`span.categoria-ep`), la fecha y el botón
de detalle. Hay 10 por página (`<NS>_cur`, desde 1) y el total sale en
"Mostrando el intervalo X - Y de N resultados".

Uso:
    python3 pp_busqueda.py --depto 05 --despacho 050002204000 --paginas 2
"""

import argparse
import json
import re
import time
from html import unescape

import requests

BASE = "https://publicacionesprocesales.ramajudicial.gov.co"
INICIO = f"{BASE}/web/publicaciones-procesales/inicio"
PORTLET = "co_com_avanti_efectosProcesales_PublicacionesEfectosProcesalesPortletV2_INSTANCE_BIyXQFHVaYaq"
NS = f"_{PORTLET}_"
PORTLET_ID = 178845807
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}

FILA = r'<tr class=" col-xs-12 tramites ".*?</tr>'


def limpiar(html: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", "", html))).strip()


def extraer_fila(row: str) -> dict:
    titulo, url, detalle = "", "", ""
    for href, texto in re.findall(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', row, re.DOTALL):
        texto = limpiar(texto)
        if texto == "Ver detalle":
            detalle = unescape(href)
        elif texto and not titulo:
            titulo, url = texto, unescape(href)
    tit_attr = re.search(r'title="([^"]+)"[^>]*>\s*Notificación', row)
    categorias = {}
    for etiqueta in re.findall(r'<span class="categoria-ep">(.*?)</span>', row, re.DOTALL):
        etiqueta = limpiar(etiqueta)
        if ":" in etiqueta:
            clave, valor = etiqueta.split(":", 1)
            categorias[clave.strip()] = valor.strip()
    fecha = re.search(r'<p class="publish-date">.*?(\d{4}-\d{2}-\d{2})', row, re.DOTALL)
    return {
        "titulo": titulo,
        "titulo_attr": unescape(tit_attr.group(1)) if tit_attr else "",
        "url": url,
        "detalle_url": detalle,
        "categorias": categorias,
        "fecha": fecha.group(1) if fecha else "",
    }


def buscar(session: requests.Session, id_depto: str, id_despacho: str, pagina: int = 1) -> tuple[list[dict], int]:
    params = {
        "p_p_id": PORTLET,
        "p_p_lifecycle": "0",
        "p_p_state": "normal",
        "p_p_mode": "view",
        NS + "action": "busqueda",
        NS + "idDepto": id_depto,
        NS + "idDespacho": id_despacho,
        NS + "verTotales": "true",
        NS + "idDeptoIdCategory": PORTLET_ID,
    }
    if pagina > 1:
        params[NS + "resetCur"] = "false"
        params[NS + "cur"] = str(pagina)
    resp = session.get(INICIO, params=params, timeout=90)
    resp.raise_for_status()
    filas = [extraer_fila(r) for r in re.findall(FILA, resp.text, re.DOTALL)]
    total = 0
    m = re.search(r"Mostrando el intervalo [0-9 -]+ de ([0-9.]+)", resp.text)
    if m:
        total = int(m.group(1).replace(".", ""))
    return filas, total


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--depto", required=True)
    parser.add_argument("--despacho", required=True)
    parser.add_argument("--paginas", type=int, default=1)
    parser.add_argument("--pausa", type=float, default=2.0)
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update(HEADERS)
    session.get(INICIO, timeout=60)

    todas = []
    for pagina in range(1, args.paginas + 1):
        filas, total = buscar(session, args.depto, args.despacho, pagina)
        print(f"página {pagina}: {len(filas)} filas (total {total})", flush=True)
        todas.extend(filas)
        time.sleep(args.pausa)

    print(json.dumps(todas, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
