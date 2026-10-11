#!/usr/bin/env python3
"""Vigencia en NiceGUI. Lista, filtros y acciones de la consulta local."""

import html
import locale
import os
import re
import sys
import unicodedata
from pathlib import Path


def _preparar_entorno() -> None:
    datos = Path(os.environ.get("VIGENCIA_DATOS") or Path(__file__).resolve().parent)
    almacen = datos / ".nicegui"
    almacen.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("NICEGUI_STORAGE_PATH", str(almacen))


def _asegurar_nicegui() -> None:
    try:
        import nicegui  # noqa: F401
        return
    except ImportError:
        pass
    if os.environ.get("VIGENCIA_NICEGUI") == "1":
        raise SystemExit(
            "No pude cargar NiceGUI. En esta carpeta: "
            "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
        )
    candidato = Path(__file__).resolve().parent / ".venv" / "bin" / "python"
    if not candidato.is_file():
        raise SystemExit(
            "Falta NiceGUI. En esta carpeta: "
            "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
        )
    os.environ["VIGENCIA_NICEGUI"] = "1"
    os.execv(str(candidato), [str(candidato), *sys.argv])


_preparar_entorno()
_asegurar_nicegui()

import web  # noqa: E402
from nicegui import app, ui  # noqa: E402

for _nombre in ("es_CO.UTF-8", "es_ES.UTF-8", "es.UTF-8"):
    try:
        locale.setlocale(locale.LC_COLLATE, _nombre)
        break
    except locale.Error:
        continue

MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
TIPO_TODOS = "todos"
DESPACHO_TODOS = "todos"
PUERTO = int(os.environ.get("VIGENCIA_PUERTO", "4200"))

CSS = """
:root {
  --papel: #efeae1;
  --papel-2: #f6f1e8;
  --blanco: #fffcf8;
  --tinta: #221c16;
  --suave: #5e574e;
  --linea: #e0d6c8;
  --cobre: #7a3e22;
  --cobre-suave: #f4e6da;
  --error: #8d3a32;
  color-scheme: light;
}
html, body, #app, .q-layout, .q-page, .nicegui-content {
  background: var(--papel) !important;
  color: var(--tinta) !important;
  height: 100%;
  overflow: hidden;
}
body, button, input, textarea, .q-field__native, .q-field__input, .q-item, .q-btn {
  font-family: "Liberation Sans", "Segoe UI", "Noto Sans", sans-serif;
}
.nicegui-content { padding: 0 !important; height: 100vh; }
.serif { font-family: Palatino, "Palatino Linotype", Georgia, serif; }
.mono { font-family: "Liberation Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.marco {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--papel);
  color: var(--tinta);
}
.barra {
  align-items: flex-end;
  gap: 18px;
  padding: 16px 22px 14px;
  background: var(--blanco);
  border-bottom: 1px solid var(--linea);
}
.marca {
  margin: 0;
  color: var(--cobre);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.nombre {
  margin: 0;
  font-size: 28px;
  line-height: 1;
  font-weight: 600;
  color: var(--tinta);
}
.resumen { color: var(--suave); font-size: 13px; margin: 0 0 6px; text-align: right; }
.campo .q-field__control {
  background: var(--blanco);
  border-radius: 10px;
}
.q-field--outlined .q-field__control:before { border-color: var(--linea); }
.q-field__native, .q-field__input, .q-placeholder, .q-field__label {
  color: var(--tinta) !important;
}
.q-menu, .q-virtual-scroll {
  background: var(--blanco) !important;
  color: var(--tinta) !important;
}
.menu-vigencia {
  width: min(640px, 94vw) !important;
  max-width: min(640px, 94vw) !important;
  background: var(--blanco) !important;
  color: var(--tinta) !important;
  border: 1px solid var(--linea);
  border-radius: 12px;
  box-shadow: 0 18px 40px rgba(34, 28, 22, 0.14);
}
.q-item {
  color: var(--tinta) !important;
}
.q-item__label { color: var(--tinta) !important; white-space: normal; line-height: 1.35; }
.menu-vigencia .q-item:hover,
.menu-vigencia .q-item--active,
.menu-vigencia .q-manual-focusable--focused {
  background: var(--cobre-suave) !important;
  color: var(--tinta) !important;
}
.q-field__native::selection, .q-field__input::selection, input::selection {
  background: var(--cobre-suave);
  color: var(--tinta);
}
.filtro-activo {
  color: var(--cobre);
  font-size: 12.5px;
  line-height: 1.35;
  margin: 6px 0 0;
  white-space: normal;
}
.boton-cobre { background: var(--cobre) !important; color: #fffaf6 !important; border-radius: 10px; }
.boton-linea { color: var(--cobre) !important; border-radius: 10px; }
.boton-texto { color: var(--suave) !important; }
.cuerpo { flex: 1; min-height: 0; width: 100%; align-items: stretch; }
.izquierda {
  width: 420px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--papel-2);
  border-right: 1px solid var(--linea);
  padding: 16px 16px 0;
}
.derecha {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--blanco);
}
.etiqueta {
  margin: 12px 0 4px;
  color: var(--suave);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.ayuda { color: var(--suave); font-size: 13px; min-height: 1.2em; margin: 6px 0 0; white-space: normal; line-height: 1.4; }
.ayuda.error { color: var(--error); }
.cuenta { color: var(--suave); font-size: 13px; margin: 12px 0 0; }
.nota-fuera { color: var(--suave); font-size: 13px; line-height: 1.4; margin: 4px 0 8px; }
.lista { display: flex; flex-direction: column; gap: 8px; padding: 0 2px 16px; }
.tarjeta {
  text-align: left;
  width: 100%;
  border: 1px solid var(--linea);
  background: var(--blanco);
  border-radius: 14px;
  padding: 12px 14px 11px;
  color: var(--tinta);
  cursor: pointer;
}
.tarjeta:hover { border-color: #c9b8a4; background: #fffaf4; }
.tarjeta:focus-visible { outline: 2px solid var(--cobre); outline-offset: 2px; }
.tarjeta.activa {
  background: var(--cobre-suave);
  border-color: var(--cobre);
  box-shadow: inset 3px 0 0 var(--cobre);
}
.tarjeta p, .tarjeta h2 { margin: 0; white-space: normal; }
.cuando { color: var(--cobre); font-size: 12px; font-weight: 700; }
.acto {
  margin-top: 2px !important;
  color: var(--suave);
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.titulo-lista {
  margin-top: 6px !important;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.radicado-lista { margin-top: 4px !important; color: var(--suave); font-size: 13px; letter-spacing: 0.02em; }
.meta { margin-top: 3px !important; color: var(--suave); font-size: 12.5px; line-height: 1.35; }
.vacio-lista, .nota { color: var(--suave); font-size: 14px; line-height: 1.45; }
.cabecera { padding: 26px 32px 8px; gap: 6px; }
.kicker { color: var(--cobre); font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.expediente-titulo {
  font-size: 30px;
  line-height: 1.2;
  font-weight: 600;
  white-space: normal;
  color: var(--tinta);
}
.radicado-grande { font-size: 16px; color: var(--tinta); letter-spacing: 0.03em; }
.despacho { color: var(--suave); font-size: 14px; white-space: normal; line-height: 1.4; }
.seccion { font-size: 22px; font-weight: 600; margin: 8px 32px 0; }
.herramientas { padding: 8px 32px 0; gap: 8px; width: 100%; max-width: 52rem; }
.lectura { max-width: 52rem; width: 100%; }
.actos-scroll { padding: 4px 32px 28px; }
.linea { list-style: none; margin: 8px 0 0; padding: 0; max-width: 46rem; }
.linea li {
  position: relative;
  margin: 0;
  padding: 0 0 18px 18px;
  border-left: 2px solid #e6dccf;
}
.linea li:last-child { border-left-color: transparent; padding-bottom: 0; }
.linea time { display: block; color: var(--cobre); font-size: 12px; font-weight: 700; }
.linea strong { display: block; margin-top: 2px; font-size: 15.5px; font-weight: 650; color: var(--tinta); }
.linea .anotacion { margin: 4px 0 0; color: var(--suave); font-size: 14.5px; line-height: 1.45; white-space: pre-wrap; }
.vacio-detalle {
  margin: auto;
  max-width: 28rem;
  text-align: left;
  padding: 48px 32px;
}
.vacio-detalle h2 { font-size: 32px; font-weight: 600; margin: 0 0 8px; }
.vacio-detalle p { color: var(--suave); font-size: 16px; line-height: 1.45; margin: 0; }
.registro-caja { padding: 0 22px 12px; background: var(--blanco); border-bottom: 1px solid var(--linea); }
.registro-titulo { color: var(--suave); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin: 8px 0; }
.registro {
  background: var(--papel-2);
  color: var(--tinta);
  border: 1px solid var(--linea);
  border-radius: 12px;
  padding: 10px 12px;
  max-height: 132px;
  overflow: auto;
  white-space: pre-wrap;
  font-family: "Liberation Mono", ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.45;
}
.registro-error { max-height: 320px; border-color: #e3c8c2; }
.causa-error { color: var(--error); font-size: 14.5px; line-height: 1.45; white-space: pre-wrap; margin: 0 0 10px; }
.dialogo { width: min(640px, 94vw); background: var(--blanco); color: var(--tinta); border-radius: 16px; padding: 22px; }
.dialogo .numero { font-size: 18px; margin: 4px 0 12px; }
.hermano { max-width: 100%; }
.q-btn { text-transform: none !important; }
@media (max-width: 900px) {
  .cuerpo { flex-direction: column; }
  .izquierda { width: 100%; height: 46vh; border-right: 0; border-bottom: 1px solid var(--linea); }
  .expediente-titulo { font-size: 24px; }
  .cabecera, .seccion, .actos-scroll { padding-left: 16px; padding-right: 16px; }
  .herramientas { padding-left: 16px; padding-right: 16px; }
}
"""

JS_ELEGIR = """
(e) => {
  const tarjeta = e.target.closest(".tarjeta");
  if (!tarjeta) return;
  emit({
    id: tarjeta.dataset.id || "",
    radicado: tarjeta.dataset.radicado || "",
    vacio: tarjeta.dataset.vacio || "0",
  });
}
"""

JS_ENTRAR = """
(e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const tarjeta = e.target.closest(".tarjeta");
  if (!tarjeta) return;
  e.preventDefault();
  emit({
    id: tarjeta.dataset.id || "",
    radicado: tarjeta.dataset.radicado || "",
    vacio: tarjeta.dataset.vacio || "0",
  });
}
"""


def texto(valor) -> str:
    if valor is None:
        return ""
    return str(valor)


def esc(valor) -> str:
    return html.escape(texto(valor), quote=True)


def tipo_clave(valor) -> str:
    marca = unicodedata.normalize("NFD", texto(valor))
    sin_tilde = "".join(caracter for caracter in marca if unicodedata.category(caracter) != "Mn")
    return "".join(caracter for caracter in sin_tilde.upper() if caracter.isalnum())


def orden_es(valor: str) -> str:
    return locale.strxfrm(valor.casefold())


def fecha_corta(valor) -> str:
    bruto = texto(valor)
    if len(bruto) < 10 or bruto[4] != "-" or bruto[7] != "-":
        return bruto or "Sin fecha"
    try:
        mes = int(bruto[5:7])
        dia = int(bruto[8:10])
    except ValueError:
        return bruto
    if not 1 <= mes <= 12:
        return bruto
    return f"{dia} {MESES[mes - 1]} {bruto[:4]}"


def nombres(proceso: dict, rol: str) -> list[str]:
    return [nombre.strip() for nombre in texto(proceso.get(rol)).split(" · ") if nombre.strip()]


def titulo_lista(proceso: dict) -> str:
    dantes = nombres(proceso, "demandantes")
    dados = nombres(proceso, "demandados")
    if dantes or dados:
        return f"{', '.join(dantes) or 'Sin demandante'} contra {', '.join(dados) or 'Sin demandado'}"
    if proceso.get("sin_expediente"):
        return "No está en esta consulta"
    return texto(proceso.get("despacho")) or "Sin despacho"


def coincide(proceso: dict, consulta: str) -> bool:
    bolsa = " ".join(
        texto(proceso.get(campo))
        for campo in (
            "radicado",
            "despacho",
            "demandantes",
            "demandados",
            "ultima_actuacion",
            "ubicacion",
            "tipo_proceso",
            "clase_proceso",
        )
    )
    bolsa = f"{bolsa} {tipo_clave(proceso.get('tipo_proceso'))}".lower()
    return all(parte in bolsa for parte in consulta.split() if parte)


def visibles(procesos: list[dict], consulta: str, tipo: str, despacho: str) -> list[dict]:
    consulta = consulta.strip().lower()
    lista = []
    for proceso in procesos:
        if tipo and tipo_clave(proceso.get("tipo_proceso")) != tipo:
            continue
        if despacho and texto(proceso.get("despacho")).strip() != despacho:
            continue
        if consulta:
            if coincide(proceso, consulta):
                lista.append(proceso)
            continue
        if not proceso.get("sin_expediente"):
            lista.append(proceso)
    por_radicado = sorted(lista, key=lambda proceso: texto(proceso.get("radicado")))
    return sorted(por_radicado, key=lambda proceso: texto(proceso.get("fecha_ultima_actuacion")), reverse=True)


def linea_de_carga(linea: str) -> str:
    limpia = texto(linea)
    limpia = re.sub(r"idProceso=\[[^\]]*\]", "", limpia)
    limpia = re.sub(r"idProceso=\d+", "", limpia)
    limpia = re.sub(r"\[detalle (\d+/\d+)\] \d+", r"[detalle \1]", limpia)
    limpia = re.sub(r"[ \t]{2,}", " ", limpia)
    return limpia.strip()


def lineas_de_corrida(dato: dict) -> list[str]:
    return [linea for linea in (linea_de_carga(linea) for linea in dato.get("lineas") or []) if linea]


def causa_del_fallo(lineas: list[str], codigo) -> str:
    """La última frase útil del proceso, sin el marco del traceback."""
    culpa = ""
    for linea in reversed(lineas):
        limpia = linea.strip()
        if not limpia or limpia.startswith(("File ", "Traceback", "During handling", "The above exception")):
            continue
        culpa = limpia
        break
    if not culpa:
        culpa = "No dejó ningún mensaje."
    return f"Código {codigo}. {culpa}"


def normalizar_radicado(valor: str) -> str:
    return "".join(caracter for caracter in texto(valor) if caracter.isdigit())[:23]


def clave_de(proceso: dict) -> str:
    if proceso.get("sin_expediente"):
        return "r-" + texto(proceso.get("radicado"))
    return "p-" + texto(proceso.get("id_proceso"))


class Vista:
    def __init__(self) -> None:
        self.procesos: list[dict] = []
        self.id_abierto: int | None = None
        self.radicado_vacio: str | None = None
        self.abierto: dict | None = None
        self.q_act = ""
        self.recientes = True
        self._suspendido = False
        self._busqueda_pendiente = False
        self.boton_copiar = None
        self.q_act_input = None
        self.boton_orden = None
        self.cuenta_act = None
        self.actos = None
        self._copia = 0

    def montar(self) -> None:
        ui.add_css(CSS)
        ui.colors(primary="#7a3e22", secondary="#5e574e", accent="#7a3e22", negative="#8d3a32")
        ui.keyboard(on_key=self.al_tecla)
        with ui.column().classes("marco w-full no-wrap gap-0"):
            self._barra()
            self._registro()
            with ui.row().classes("cuerpo no-wrap gap-0"):
                self._columna()
                self.detalle = ui.column().classes("derecha gap-0")
        self._dialogo()
        self.reloj_agregar = ui.timer(0.4, self._tick_agregar, active=False)
        self.reloj_todo = ui.timer(0.7, self._tick_todo, active=False)
        ui.timer(0.15, self._vaciar_busqueda)
        self._vacio_inicial()
        self.cargar()

    def _barra(self) -> None:
        with ui.row().classes("barra w-full no-wrap"):
            with ui.column().classes("gap-0"):
                ui.label("Vigencia").classes("marca")
                ui.label("Procesos").classes("nombre serif")
            self.busqueda = ui.input(placeholder="Radicado, parte, despacho, tipo o actuación").props(
                "outlined dense clearable"
            ).classes("col campo")
            self.busqueda.on_value_change(self.al_buscar)
            with ui.column().classes("items-end gap-0"):
                self.resumen = ui.label("Cargando la base…").classes("resumen")
                with ui.row().classes("no-wrap gap-2"):
                    self.boton_recargar = ui.button("Recargar lista", on_click=self.al_recargar).props(
                        "outline no-caps"
                    ).classes("boton-linea")
                    self.boton_recargar.tooltip("Vuelve a leer la base, sin consultar la Rama")
                    self.boton_actualizar = ui.button("Actualizar todo", on_click=self.al_actualizar).props(
                        "unelevated no-caps"
                    ).classes("boton-cobre")
                    self.boton_actualizar.tooltip("Revisa solo las actuaciones de cada expediente")
                    ui.button("Salir", on_click=app.shutdown).props("flat no-caps").classes("boton-texto").tooltip(
                        "Cierra Vigencia"
                    )

    def _registro(self) -> None:
        self.caja_registro = ui.column().classes("registro-caja w-full gap-0")
        with self.caja_registro:
            with ui.row().classes("w-full items-center justify-between"):
                self.registro_titulo = ui.label("Registro").classes("registro-titulo")
                ui.button("Ocultar", on_click=lambda: self.caja_registro.set_visibility(False)).props(
                    "flat dense no-caps"
                ).classes("boton-texto")
            self.registro = ui.label("").classes("registro w-full")
        self.caja_registro.set_visibility(False)

    def _columna(self) -> None:
        with ui.column().classes("izquierda gap-0"):
            ui.label("Agregar radicado").classes("etiqueta").style("margin-top: 0")
            with ui.row().classes("w-full no-wrap items-center gap-2"):
                self.nuevo = ui.input(placeholder="23 dígitos").props("outlined dense").classes("col campo mono")
                self.nuevo.on_value_change(self.al_digitos)
                self.nuevo.on("keydown.enter", self.al_agregar)
                self.boton_agregar = ui.button("Agregar", on_click=self.al_agregar).props("unelevated no-caps").classes(
                    "boton-cobre"
                )
            self.ayuda = ui.label("Número de radicación, 23 dígitos.").classes("ayuda")
            ui.label("Tipo").classes("etiqueta")
            self.tipo = ui.select({TIPO_TODOS: "Todos los tipos"}, value=TIPO_TODOS, with_input=True).props(
                "outlined dense options-dense popup-content-class=menu-vigencia"
            ).classes("w-full campo")
            self.tipo.on_value_change(self.al_filtrar)
            ui.label("Despacho").classes("etiqueta")
            self.despacho = ui.select(
                {DESPACHO_TODOS: "Todos los despachos"}, value=DESPACHO_TODOS, with_input=True
            ).props("outlined dense options-dense popup-content-class=menu-vigencia").classes("w-full campo")
            self.despacho.on_value_change(self.al_filtrar)
            self.filtro_activo = ui.label("").classes("filtro-activo")
            self.filtro_activo.set_visibility(False)
            self.cuenta = ui.label("").classes("cuenta")
            self.nota = ui.label("").classes("nota-fuera")
            self.nota.set_visibility(False)
            with ui.scroll_area().classes("col w-full"):
                self.lista = ui.html("", sanitize=False).classes("lista")
            self.lista.on("click", self.al_elegir, js_handler=JS_ELEGIR)
            self.lista.on("keydown", self.al_elegir, js_handler=JS_ENTRAR)

    def _dialogo(self) -> None:
        with ui.dialog().props("persistent") as self.dialogo:
            with ui.card().classes("dialogo"):
                self.dialogo_titulo = ui.label("Buscando el radicado en la Rama").classes("serif").style(
                    "font-size: 22px; font-weight: 600; margin: 0"
                )
                self.dialogo_numero = ui.label("").classes("numero mono")
                self.dialogo_causa = ui.label("").classes("causa-error")
                self.dialogo_causa.set_visibility(False)
                self.dialogo_barra = ui.linear_progress().props("indeterminate rounded")
                self.dialogo_log = ui.label("").classes("registro w-full")
                with ui.row().classes("w-full justify-end"):
                    self.dialogo_cerrar = ui.button("Cerrar", on_click=self.dialogo.close).props(
                        "unelevated no-caps"
                    ).classes("boton-cobre")
                self.dialogo_cerrar.set_visibility(False)

    def _vacio_inicial(self) -> None:
        self.detalle.clear()
        with self.detalle:
            with ui.column().classes("vacio-detalle"):
                ui.label("Elige un expediente").classes("serif expediente-titulo")
                ui.label(
                    "La lista va por la última actuación. Puedes buscar por radicado, parte, despacho o tipo. La tecla / enfoca el buscador."
                )

    def al_digitos(self, evento) -> None:
        digitos = normalizar_radicado(evento.value or "")
        if (evento.value or "") != digitos:
            self.nuevo.set_value(digitos)
            return
        if not digitos:
            self._ayuda("Número de radicación, 23 dígitos.", error=False)
        elif len(digitos) < 23:
            self._ayuda(f"{len(digitos)} de 23 dígitos.", error=False)
        else:
            self._ayuda("Listo para buscar en la Rama.", error=False)

    def _ayuda(self, mensaje: str, error: bool) -> None:
        self.ayuda.set_text(mensaje)
        self.ayuda.classes(remove="error")
        if error:
            self.ayuda.classes(add="error")

    def valor_choice(self, choice, todos: str) -> str:
        valor = choice.value
        if not valor or valor == todos:
            return ""
        return texto(valor)

    def al_buscar(self, _evento) -> None:
        self._busqueda_pendiente = True

    def _vaciar_busqueda(self) -> None:
        if not self._busqueda_pendiente:
            return
        self._busqueda_pendiente = False
        self.pintar_lista()

    def al_filtrar(self, _evento) -> None:
        if self._suspendido:
            return
        self.pintar_lista()

    def cargar(self) -> None:
        try:
            with web.conectar() as con:
                self.procesos = web.listar_procesos(con)
        except Exception as exc:
            self.resumen.set_text("No pude leer la base.")
            self.cuenta.set_text("Sin datos")
            self._ayuda(str(exc), error=True)
            return
        self._llenar_tipos()
        self._llenar_despachos()
        self.pintar_lista()

    def _llenar_tipos(self) -> None:
        actual = self.valor_choice(self.tipo, TIPO_TODOS)
        cuentas: dict[str, int] = {}
        for proceso in self.procesos:
            clave = tipo_clave(proceso.get("tipo_proceso"))
            if not clave or proceso.get("sin_expediente"):
                continue
            cuentas[clave] = cuentas.get(clave, 0) + 1
        opciones = {TIPO_TODOS: "Todos los tipos"}
        for clave, cantidad in sorted(cuentas.items(), key=lambda par: orden_es(par[0])):
            opciones[clave] = f"{clave} ({cantidad})"
        self._suspendido = True
        self.tipo.set_options(opciones, value=actual if actual in opciones else TIPO_TODOS)
        self._suspendido = False

    def _llenar_despachos(self) -> None:
        actual = self.valor_choice(self.despacho, DESPACHO_TODOS)
        cuentas: dict[str, int] = {}
        for proceso in self.procesos:
            if proceso.get("sin_expediente"):
                continue
            nombre = texto(proceso.get("despacho")).strip()
            if nombre:
                cuentas[nombre] = cuentas.get(nombre, 0) + 1
        opciones = {DESPACHO_TODOS: "Todos los despachos"}
        for nombre, cantidad in sorted(cuentas.items(), key=lambda par: orden_es(par[0])):
            opciones[nombre] = f"{nombre} ({cantidad})"
        self._suspendido = True
        self.despacho.set_options(opciones, value=actual if actual in opciones else DESPACHO_TODOS)
        self._suspendido = False

    def lista_visible(self) -> list[dict]:
        return visibles(
            self.procesos,
            self.busqueda.value or "",
            self.valor_choice(self.tipo, TIPO_TODOS),
            self.valor_choice(self.despacho, DESPACHO_TODOS),
        )

    def pintar_lista(self) -> None:
        lista = self.lista_visible()
        en_consulta = sum(1 for proceso in self.procesos if not proceso.get("sin_expediente"))
        fuera = sum(1 for proceso in self.procesos if proceso.get("sin_expediente"))
        self.resumen.set_text(f"{en_consulta} expedientes")
        hay_filtro = bool(
            (self.busqueda.value or "").strip()
            or self.valor_choice(self.tipo, TIPO_TODOS)
            or self.valor_choice(self.despacho, DESPACHO_TODOS)
        )
        if len(lista) == en_consulta and not hay_filtro:
            self.cuenta.set_text(f"{len(lista)} por última actuación")
        else:
            self.cuenta.set_text(f"{len(lista)} de {en_consulta}")
        despacho_elegido = self.valor_choice(self.despacho, DESPACHO_TODOS)
        if despacho_elegido:
            self.filtro_activo.set_text(despacho_elegido)
            self.filtro_activo.set_visibility(True)
        else:
            self.filtro_activo.set_text("")
            self.filtro_activo.set_visibility(False)
        if not hay_filtro and fuera:
            self.nota.set_text(f"{fuera} radicados del archivo no están en esta consulta.")
            self.nota.set_visibility(True)
        else:
            self.nota.set_text("")
            self.nota.set_visibility(False)
        if not lista:
            self.lista.set_content('<p class="vacio-lista">Ningún expediente coincide.</p>')
            return
        partes = []
        for proceso in lista:
            tipo = tipo_clave(proceso.get("tipo_proceso"))
            titulo = titulo_lista(proceso)
            despacho = texto(proceso.get("despacho"))
            contexto = " · ".join(parte for parte in (tipo, despacho if despacho != titulo else "") if parte)
            acto = texto(proceso.get("ultima_actuacion")) or (
                "No está en esta consulta" if proceso.get("sin_expediente") else "Sin texto de actuación"
            )
            cuando = fecha_corta(proceso.get("fecha_ultima_actuacion")) if proceso.get("fecha_ultima_actuacion") else "Sin actuación"
            activa = " activa" if self._es_actual(proceso) else ""
            meta = f'<p class="meta">{esc(contexto)}</p>' if contexto else ""
            partes.append(
                f'''<article class="tarjeta{activa}" tabindex="0" role="button" data-clave="{esc(clave_de(proceso))}" data-id="{esc(proceso.get("id_proceso"))}" data-radicado="{esc(proceso.get("radicado"))}" data-vacio="{"1" if proceso.get("sin_expediente") else "0"}">
<p class="cuando">{esc(cuando)}</p>
<p class="acto">{esc(acto)}</p>
<p class="titulo-lista">{esc(titulo)}</p>
<p class="radicado-lista mono">{esc(proceso.get("radicado"))}</p>
{meta}
</article>'''
            )
        self.lista.set_content("".join(partes))

    def _es_actual(self, proceso: dict) -> bool:
        if proceso.get("id_proceso") and self.id_abierto:
            return int(proceso["id_proceso"]) == int(self.id_abierto)
        return bool(proceso.get("sin_expediente") and proceso.get("radicado") == self.radicado_vacio)

    def marcar(self) -> None:
        if self.id_abierto:
            clave = "p-" + str(self.id_abierto)
        elif self.radicado_vacio:
            clave = "r-" + self.radicado_vacio
        else:
            return
        ui.run_javascript(
            f"""
            document.querySelectorAll('.tarjeta.activa').forEach((nodo) => nodo.classList.remove('activa'));
            const nodo = document.querySelector('.tarjeta[data-clave="{esc(clave)}"]');
            if (nodo) {{
              nodo.classList.add('activa');
              nodo.scrollIntoView({{block: 'nearest'}});
            }}
            """
        )

    def al_elegir(self, evento) -> None:
        dato = evento.args
        if isinstance(dato, list):
            dato = dato[0] if dato else None
        if not isinstance(dato, dict):
            return
        if str(dato.get("vacio")) == "1":
            proceso = next(
                (
                    item
                    for item in self.procesos
                    if item.get("sin_expediente") and item.get("radicado") == dato.get("radicado")
                ),
                None,
            )
            if proceso:
                self.abrir_proceso(proceso)
            return
        if dato.get("id"):
            self.abrir_id(dato["id"])

    def abrir_id(self, id_proceso) -> None:
        elegido = next(
            (
                proceso
                for proceso in self.procesos
                if proceso.get("id_proceso") and int(proceso["id_proceso"]) == int(id_proceso)
            ),
            None,
        )
        if elegido:
            self.abrir_proceso(elegido)

    def abrir_proceso(self, proceso: dict) -> None:
        if proceso.get("sin_expediente"):
            self.id_abierto = None
            self.abierto = None
            self.radicado_vacio = proceso.get("radicado")
            self._pintar_vacio(proceso)
            self.marcar()
            return
        self.id_abierto = int(proceso["id_proceso"])
        self.radicado_vacio = None
        self.q_act = ""
        self.recientes = True
        try:
            with web.conectar() as con:
                detalle = web.detalle_proceso(con, self.id_abierto)
        except Exception:
            self._pintar_mensaje("No pude abrir ese expediente.")
            return
        if not detalle:
            self._pintar_mensaje("No pude abrir ese expediente.")
            return
        self.abierto = detalle
        self._pintar_expediente()
        self.marcar()

    def _pintar_vacio(self, proceso: dict) -> None:
        self.detalle.clear()
        self.actos = None
        self.boton_copiar = None
        with self.detalle:
            with ui.column().classes("cabecera lectura"):
                ui.label(texto(proceso.get("radicado"))).classes("radicado-grande mono")
                ui.label("No está en esta consulta").classes("expediente-titulo serif")
                ui.label(
                    "Este radicado no aparece en la Rama Judicial. La búsqueda en otro sistema queda para después."
                ).classes("despacho")

    def _pintar_mensaje(self, mensaje: str, detalle: str = "") -> None:
        self.detalle.clear()
        self.actos = None
        with self.detalle:
            with ui.column().classes("vacio-detalle"):
                ui.label(mensaje).classes("serif expediente-titulo")
                if detalle:
                    ui.label(detalle).classes("causa-error")

    def _pintar_expediente(self) -> None:
        proceso = self.abierto or {}
        sujetos = proceso.get("sujetos") or []
        dantes = [sujeto.get("nombre") for sujeto in sujetos if sujeto.get("rol_base") == "demandante" and sujeto.get("nombre")]
        dados = [sujeto.get("nombre") for sujeto in sujetos if sujeto.get("rol_base") == "demandado" and sujeto.get("nombre")]
        if dantes or dados:
            titulo = f"{', '.join(dantes) or 'Sin demandante'} contra {', '.join(dados) or 'Sin demandado'}"
        else:
            titulo = texto(proceso.get("despacho")) or "Expediente privado"
        linea = " · ".join(
            parte for parte in (tipo_clave(proceso.get("tipo_proceso")), texto(proceso.get("clase_proceso"))) if parte
        )
        hermanos = [
            otro
            for otro in self.procesos
            if otro.get("radicado") == proceso.get("radicado")
            and otro.get("id_proceso")
            and int(otro["id_proceso"]) != int(proceso.get("id_proceso") or 0)
        ]
        self.detalle.clear()
        with self.detalle:
            with ui.column().classes("cabecera lectura"):
                ui.label(linea or texto(proceso.get("despacho")) or "Expediente").classes("kicker")
                ui.label(titulo).classes("expediente-titulo serif")
                with ui.row().classes("items-center no-wrap"):
                    ui.label(texto(proceso.get("radicado"))).classes("radicado-grande mono")
                    self.boton_copiar = ui.button(
                        "Copiar radicado",
                        on_click=lambda numero=texto(proceso.get("radicado")): self.copiar(numero),
                    ).props("outline no-caps dense").classes("boton-linea")
                ui.label(texto(proceso.get("despacho")) or "Sin despacho").classes("despacho")
                if hermanos:
                    ui.label(f"Este radicado tiene {len(hermanos) + 1} expedientes.").classes("despacho")
                    with ui.row().classes("wrap"):
                        for otro in hermanos:
                            rotulo = texto(otro.get("despacho")) or texto(otro.get("clase_proceso")) or "Otro expediente"
                            ui.button(
                                rotulo, on_click=lambda idp=otro["id_proceso"]: self.abrir_id(idp)
                            ).props("outline no-caps dense").classes("boton-linea hermano")
            ui.label("Actuaciones").classes("seccion serif")
            if not proceso.get("actuaciones_consultado_en"):
                ui.label("Las actuaciones todavía no se han consultado.").classes("nota").style("margin-left: 32px")
                self.actos = None
            elif not (proceso.get("actuaciones") or []):
                ui.label("Este expediente no tiene actuaciones registradas.").classes("nota").style("margin-left: 32px")
                self.actos = None
            else:
                with ui.row().classes("herramientas no-wrap"):
                    self.q_act_input = ui.input(placeholder="Fecha, actuación o anotación").props(
                        "outlined dense clearable"
                    ).classes("col campo")
                    self.q_act_input.on_value_change(self.al_q_act)
                    self.boton_orden = ui.button("Ver las más antiguas primero", on_click=self.invertir).props(
                        "outline no-caps dense"
                    ).classes("boton-linea")
                self.cuenta_act = ui.label("").classes("cuenta").style("margin: 6px 32px 0")
                with ui.scroll_area().classes("col w-full actos-scroll"):
                    self.actos = ui.html("", sanitize=False).classes("w-full")
                self.llenar_actos()

    def al_q_act(self, evento) -> None:
        self.q_act = evento.value or ""
        self.llenar_actos()

    def invertir(self) -> None:
        self.recientes = not self.recientes
        if self.boton_orden:
            self.boton_orden.set_text(
                "Ver las más antiguas primero" if self.recientes else "Ver las más recientes primero"
            )
        self.llenar_actos()

    def llenar_actos(self) -> None:
        if self.actos is None or not self.abierto:
            return
        filas = list(self.abierto.get("actuaciones") or [])
        partes = [parte for parte in self.q_act.strip().lower().split() if parte]
        if partes:
            def entra(act: dict) -> bool:
                bolsa = " ".join(
                    texto(act.get(campo)) for campo in ("fecha_actuacion", "actuacion", "anotacion")
                ).lower()
                return all(parte in bolsa for parte in partes)
            filas = [act for act in filas if entra(act)]
        if not self.recientes:
            filas = list(reversed(filas))
        total = len(self.abierto.get("actuaciones") or [])
        if self.cuenta_act:
            self.cuenta_act.set_text(
                f"{total} actuaciones" if len(filas) == total else f"{len(filas)} de {total} actuaciones"
            )
        if not filas:
            self.actos.set_content('<p class="nota">Ninguna actuación coincide.</p>')
            return
        items = []
        for act in filas:
            cuando = fecha_corta(act.get("fecha_actuacion")) if act.get("fecha_actuacion") else "Sin fecha"
            bruto = texto(act.get("fecha_actuacion"))
            nota = texto(act.get("anotacion"))
            extra = f'<p class="anotacion">{esc(nota)}</p>' if nota else ""
            items.append(
                f'''<li><time datetime="{esc(bruto)}">{esc(cuando)}</time><strong>{esc(act.get("actuacion")) or "Sin descripción"}</strong>{extra}</li>'''
            )
        self.actos.set_content(f'<ol class="linea">{"".join(items)}</ol>')

    def copiar(self, numero: str) -> None:
        ui.clipboard.write(numero)
        self._copia += 1
        token = self._copia
        if self.boton_copiar:
            self.boton_copiar.set_text("Copiado")
            ui.timer(1.6, lambda token=token: self._restaurar_copiar(token), once=True)

    def _restaurar_copiar(self, token: int) -> None:
        if token != self._copia or not self.boton_copiar:
            return
        self.boton_copiar.set_text("Copiar radicado")

    def _ocupados(self, ocupado: bool, actualizando: bool = False) -> None:
        self.boton_agregar.set_enabled(not ocupado)
        self.boton_actualizar.set_enabled(not ocupado)
        self.boton_recargar.set_enabled(not ocupado)
        self.boton_actualizar.set_text("Revisando…" if ocupado and actualizando else "Actualizar todo")

    def al_agregar(self, _evento=None) -> None:
        numero = normalizar_radicado(self.nuevo.value or "")
        if len(numero) != 23:
            self._ayuda("El radicado debe tener 23 dígitos.", error=True)
            return
        self._ayuda("Buscando en la Rama…", error=False)
        web.asegurar_en_csv(numero)
        if not web.lanzar(["--paso", "todos", "--radicado", numero], "agregar", numero):
            self._ayuda("Ya hay una consulta en curso.", error=True)
            return
        self._ocupados(True)
        self._preparar_dialogo(numero)
        self.dialogo.open()
        self.reloj_agregar.activate()

    def _preparar_dialogo(self, numero: str) -> None:
        self.dialogo_titulo.set_text("Buscando el radicado en la Rama")
        self.dialogo_numero.set_text(numero)
        self.dialogo_causa.set_text("")
        self.dialogo_causa.set_visibility(False)
        self.dialogo_barra.set_visibility(True)
        self.dialogo_log.classes(remove="registro-error")
        self.dialogo_log.set_text("Esperando la respuesta de la Rama…")
        self.dialogo_cerrar.set_visibility(False)
        self.registro_titulo.set_text("Registro de la búsqueda")
        self.registro.classes(remove="registro-error")
        self.registro.set_text("Esperando la respuesta de la Rama…")
        self.caja_registro.set_visibility(True)

    def _tick_agregar(self) -> None:
        dato = web.estado_corrida()
        lineas = lineas_de_corrida(dato)
        if lineas:
            self.dialogo_log.set_text("\n".join(lineas[-20:]))
            self.registro.set_text("\n".join(lineas))
        if dato.get("corriendo"):
            return
        self.reloj_agregar.deactivate()
        self._ocupados(False)
        numero = texto(dato.get("radicado")) or normalizar_radicado(self.nuevo.value or "")
        codigo = dato.get("exit_code")
        if codigo:
            self._mostrar_fallo(numero, codigo, lineas, dato.get("fin"))
        else:
            self.dialogo.close()
            if lineas:
                self.registro.set_text("\n".join(lineas) + f"\nTerminó {dato.get('fin') or ''}.")
        self.cargar()
        self._mostrar_agregado(numero, codigo, lineas)

    def _mostrar_fallo(self, numero: str, codigo, lineas: list[str], fin) -> None:
        causa = causa_del_fallo(lineas, codigo)
        self.dialogo_titulo.set_text("La búsqueda falló")
        self.dialogo_causa.set_text(causa)
        self.dialogo_causa.set_visibility(True)
        self.dialogo_barra.set_visibility(False)
        self.dialogo_log.classes(add="registro-error")
        cuerpo = "\n".join(lineas) if lineas else "El proceso no escribió nada."
        self.dialogo_log.set_text(cuerpo)
        self.dialogo_cerrar.set_visibility(True)
        self.registro_titulo.set_text("Registro de la búsqueda")
        self.registro.classes(add="registro-error")
        cierre = f"\nTerminó con error a las {fin}." if fin else ""
        self.registro.set_text(f"{causa}\n\n{cuerpo}{cierre}")
        self.caja_registro.set_visibility(True)
        self._pintar_mensaje(
            f"La búsqueda de {numero} falló",
            f"{causa}\n\nEl registro completo está arriba. La ventana de la búsqueda sigue abierta hasta que la cierres.",
        )
        self._ayuda(causa, error=True)

    def _mostrar_agregado(self, numero: str, codigo, lineas: list[str] | None = None) -> None:
        if codigo:
            return
        self.nuevo.set_value("")
        self._ayuda("Número de radicación, 23 dígitos.", error=False)
        self._suspendido = True
        self.busqueda.set_value(numero)
        self.tipo.set_value(TIPO_TODOS)
        self.despacho.set_value(DESPACHO_TODOS)
        self._suspendido = False
        self.pintar_lista()
        encontrados = [proceso for proceso in self.procesos if proceso.get("radicado") == numero and proceso.get("id_proceso")]
        if encontrados:
            self.abrir_proceso(encontrados[0])
            return
        vacio = next(
            (proceso for proceso in self.procesos if proceso.get("sin_expediente") and proceso.get("radicado") == numero),
            None,
        )
        if vacio:
            self.abrir_proceso(vacio)
            return
        self._pintar_mensaje(f"La Rama no devolvió procesos para {numero}.")

    def al_recargar(self) -> None:
        self.boton_recargar.disable()
        self.cargar()
        if self.id_abierto:
            self.abrir_id(self.id_abierto)
        elif self.radicado_vacio:
            vacio = next(
                (
                    proceso
                    for proceso in self.procesos
                    if proceso.get("sin_expediente") and proceso.get("radicado") == self.radicado_vacio
                ),
                None,
            )
            if vacio:
                self.abrir_proceso(vacio)
        self.boton_recargar.enable()

    def al_actualizar(self) -> None:
        self.boton_actualizar.disable()
        if not web.lanzar(["--paso", "3", "--solo-actuaciones"], "todo"):
            self._ayuda("Ya hay una consulta en curso.", error=True)
            self.caja_registro.set_visibility(True)
            self.reloj_todo.activate()
            return
        self.registro.classes(remove="registro-error")
        self.registro.set_text("Revisando actuaciones…")
        self.caja_registro.set_visibility(True)
        self._ocupados(True, actualizando=True)
        self.reloj_todo.activate()

    def _tick_todo(self) -> None:
        dato = web.estado_corrida()
        if dato.get("modo") == "agregar":
            return
        corriendo = bool(dato.get("corriendo"))
        lineas = [linea_de_carga(linea) for linea in dato.get("lineas") or []]
        lineas = [linea for linea in lineas if linea]
        if lineas or dato.get("fin"):
            cierre = ""
            if not corriendo and dato.get("fin"):
                if dato.get("exit_code") == 0:
                    cierre = f"\nTerminó {dato['fin']}."
                    self.registro.classes(remove="registro-error")
                else:
                    causa = causa_del_fallo(lineas, dato.get("exit_code"))
                    cierre = f"\n{causa}\nTerminó con error a las {dato['fin']}."
                    self.registro.classes(add="registro-error")
            self.registro.set_text("\n".join(lineas) + cierre)
            self.caja_registro.set_visibility(True)
        if not corriendo:
            self.reloj_todo.deactivate()
            self._ocupados(False)
            self.cargar()
            if self.id_abierto:
                self.abrir_id(self.id_abierto)

    def al_tecla(self, evento) -> None:
        if not evento.action.keydown or evento.action.repeat:
            return
        if evento.key.name == "/":
            self.busqueda.run_method("focus")
            return
        if evento.key.arrow_down:
            self.mover(1)
        elif evento.key.arrow_up:
            self.mover(-1)

    def mover(self, delta: int) -> None:
        lista = self.lista_visible()
        if not lista:
            return
        indice = 0
        encontrado = False
        for posicion, proceso in enumerate(lista):
            if self._es_actual(proceso):
                indice = posicion
                encontrado = True
                break
        if encontrado:
            indice = max(0, min(len(lista) - 1, indice + delta))
        elif delta < 0:
            indice = len(lista) - 1
        self.abrir_proceso(lista[indice])


def main() -> None:
    @ui.page("/")
    def indice() -> None:
        Vista().montar()

    mostrar = os.environ.get("VIGENCIA_MOSTRAR", "1") != "0"
    nativo = mostrar and os.environ.get("VIGENCIA_NATIVO", "1") != "0"
    if nativo and sys.platform.startswith("linux"):
        os.environ.setdefault("PYWEBVIEW_GUI", "qt")
        app.native.start_args["gui"] = "qt"
        app.native.window_args["min_size"] = (960, 640)
    ui.run(
        host="127.0.0.1",
        port=PUERTO,
        title="Procesos · Vigencia",
        reload=False,
        show=mostrar and not nativo,
        native=nativo,
        window_size=(1400, 900) if nativo else None,
        dark=False,
        language="es",
        show_welcome_message=False,
        favicon=(
            "data:image/svg+xml,"
            "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
            "%3Crect width='32' height='32' rx='7' fill='%237a3e22'/%3E"
            "%3Cpath d='M9 23 V9 h5.2 a5.2 5.2 0 0 1 0 10.4 H9' fill='none' stroke='%23fffaf6' stroke-width='2.2'/%3E"
            "%3C/svg%3E"
        ),
    )


if __name__ == "__main__":
    main()
