#!/usr/bin/env python3
"""Documentos PDF del detalle de una publicación procesal.

Cada despacho pinta distinto, así que no se ata a una tabla fija:
1. Tabla `tabla-docs-*` con filas: enlace + celda de fecha.
2. Enlace dentro de `div.resumen-publicacion` (la tabla viene vacía con
   "No hay documentos asociados"): fecha del bloque de metadatos.
Solo valen enlaces de documentos (`get_file`, `/documents/` o `.pdf`).

Uso:
    python3 pp_detalle.py --article 272558280 --depto ANTIOQUIA
"""

import argparse
import json
import re
from html import unescape
from urllib.parse import urljoin

import requests

BASE = "https://publicacionesprocesales.ramajudicial.gov.co"
INICIO = f"{BASE}/web/publicaciones-procesales/inicio"
PORTLET = "co_com_avanti_efectosProcesales_PublicacionesEfectosProcesalesPortletV2_INSTANCE_BIyXQFHVaYaq"
NS = f"_{PORTLET}_"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}

FECHA = r"(?:\d{4}-\d{2}-\d{2}|\d{1,2}-[a-z]{3}-\d{4}(?: \d{2}:\d{2}(?::\d{2})?)?|\d{1,2} [a-z]{3} \d{4})"


def limpiar(html: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", "", html))).strip()


def es_documento(href: str) -> bool:
    h = href.lower()
    return "get_file" in h or "/documents/" in h or ".pdf" in h


def enlaces(bloque: str) -> list[tuple[str, str]]:
    docs = []
    for href, texto in re.findall(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', bloque, re.DOTALL):
        if es_documento(href):
            docs.append((urljoin(BASE, unescape(href)), limpiar(texto)))
    return docs


def extraer_detalle(html: str) -> list[dict]:
    docs = []
    vistos = set()
    # 1. Tablas tabla-docs-*: fila = enlace + celda de fecha.
    for tabla in re.findall(r'<table[^>]*id="tabla-docs-[^"]*"[^>]*>.*?</table>', html, re.DOTALL):
        for fila in re.findall(r"<tr.*?</tr>", tabla, re.DOTALL):
            fecha = re.search(FECHA, limpiar(fila))
            for url, nombre in enlaces(fila):
                if url not in vistos:
                    vistos.add(url)
                    docs.append({
                        "nombre": nombre,
                        "url": url,
                        "fecha": fecha.group(0) if fecha else "",
                        "origen": "tabla",
                    })
    # 2. Resumen: fecha del bloque de metadatos.
    for resumen in re.findall(r'<div class="[^"]*resumen-publicacion[^"]*".*?</div>\s*</div>', html, re.DOTALL):
        meta = re.search(r"Fecha de publicación</b>.*?<p>(.*?)</p>", html, re.DOTALL)
        fecha = limpiar(meta.group(1)) if meta else ""
        for url, nombre in enlaces(resumen):
            if url not in vistos:
                vistos.add(url)
                docs.append({"nombre": nombre, "url": url, "fecha": fecha, "origen": "resumen"})
    return docs


def traer_detalle(session: requests.Session, article_id: str, **extra) -> str:
    params = {
        "p_p_id": PORTLET,
        "p_p_lifecycle": "0",
        "p_p_state": "normal",
        "p_p_mode": "view",
        NS + "jspPage": "/META-INF/resources/detail.jsp",
        NS + "articleId": article_id,
    }
    params.update({NS + k: v for k, v in extra.items()})
    resp = session.get(INICIO, params=params, timeout=120)
    resp.raise_for_status()
    return resp.text


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--article", required=True)
    parser.add_argument("--pausa", type=float, default=2.0)
    args, resto = parser.parse_known_args()
    extra = {}
    for par in resto:
        if "=" in par:
            clave, valor = par.split("=", 1)
            extra[clave] = valor

    import time

    session = requests.Session()
    session.headers.update(HEADERS)
    session.get(INICIO, timeout=120)
    html = traer_detalle(session, args.article, **extra)
    time.sleep(args.pausa)
    print(json.dumps(extraer_detalle(html), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
