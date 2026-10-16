const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vigencia", {
  listar: () => ipcRenderer.invoke("listar"),
  detalle: (id) => ipcRenderer.invoke("detalle", id),
  guardarCliente: (datos) => ipcRenderer.invoke("guardar-cliente", datos),
  borrarCliente: (id) => ipcRenderer.invoke("borrar-cliente", id),
  borrarProceso: (id) => ipcRenderer.invoke("borrar-proceso", id),
  exportarExcel: (ids) => ipcRenderer.invoke("exportar-excel", ids),
  informeDiario: () => ipcRenderer.invoke("informe-diario"),
  prepararEscrito: (id, prompt) => ipcRenderer.invoke("preparar-escrito", { id, prompt }),
  modelosListar: () => ipcRenderer.invoke("modelos-listar"),
  modelosRecomendados: () => ipcRenderer.invoke("modelos-recomendados"),
  motorEstado: () => ipcRenderer.invoke("motor-estado"),
  motorInstalar: () => ipcRenderer.invoke("motor-instalar"),
  motorDiagnostico: () => ipcRenderer.invoke("motor-diagnostico"),
  alMotor: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("motor-progreso", canal);
    return () => ipcRenderer.removeListener("motor-progreso", canal);
  },
  modelosDescargar: (id) => ipcRenderer.invoke("modelos-descargar", { id }),
  alModelo: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("modelo-progreso", canal);
    return () => ipcRenderer.removeListener("modelo-progreso", canal);
  },
  modelosUsar: (id) => ipcRenderer.invoke("modelos-usar", { id }),
  modelosModo: (modo) => ipcRenderer.invoke("modelos-modo", { modo }),
  modelosNube: () => ipcRenderer.invoke("modelos-nube"),
  modelosGuardarNube: (datos) => ipcRenderer.invoke("modelos-guardar-nube", datos),
  modelosProbar: (datos) => ipcRenderer.invoke("modelos-probar", datos),
  iniciarGenerar: (tipo, datos, modelo, excluir, aclaracion) => ipcRenderer.invoke("iniciar-generar", { tipo, datos, modelo, excluir, aclaracion }),
  piezasListar: () => ipcRenderer.invoke("piezas-listar"),
  piezaGuardar: (datos) => ipcRenderer.invoke("pieza-guardar", datos),
  piezaActivar: (id, activa) => ipcRenderer.invoke("pieza-activar", { id, activa }),
  piezaBorrar: (id) => ipcRenderer.invoke("pieza-borrar", { id }),
  iniciarGuardar: (inicial) => ipcRenderer.invoke("iniciar-guardar", inicial),
  modelosImportar: () => ipcRenderer.invoke("modelos-importar"),
  generarBorrador: (id, prompt, modelo, excluir, aclaracion, extra) => ipcRenderer.invoke("escrito-generar", {
    id, prompt, modelo, excluir, aclaracion, ...(extra || {}),
  }),
  guardarBorradorWord: (id, borrador) => ipcRenderer.invoke("escrito-guardar-borrador", { id, borrador }),
  guardarBorradorPdf: (id, borrador) => ipcRenderer.invoke("escrito-guardar-pdf", { id, borrador }),
  alBorrador: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("borrador-progreso", canal);
    return () => ipcRenderer.removeListener("borrador-progreso", canal);
  },
  guardarEscrito: (id, prompt) => ipcRenderer.invoke("guardar-escrito", { id, prompt }),
  asignarCliente: (idProceso, clienteId) => ipcRenderer.invoke("asignar-cliente", { idProceso, clienteId }),
  guardarRepresentado: (idProceso, representado) => ipcRenderer.invoke("guardar-representado", { idProceso, representado }),
  estado: () => ipcRenderer.invoke("estado"),
  actualizar: () => ipcRenderer.invoke("actualizar"),
  actualizarUno: (id) => ipcRenderer.invoke("actualizar-uno", id),
  agregar: (numero) => ipcRenderer.invoke("agregar", numero),
  elegirCsv: () => ipcRenderer.invoke("elegir-csv"),
  cargarCsv: (indice) => ipcRenderer.invoke("cargar-csv", indice),
  copiar: (numero) => ipcRenderer.invoke("copiar", numero),
  tema: (tema) => ipcRenderer.invoke("tema", tema),
  ajustes: () => ipcRenderer.invoke("ajustes"),
  guardarAjustes: (datos) => ipcRenderer.invoke("guardar-ajustes", datos),
  salir: () => ipcRenderer.invoke("salir"),
  ppDeptos: () => ipcRenderer.invoke("pp-deptos"),
  ppMunicipios: (depto) => ipcRenderer.invoke("pp-municipios", { depto }),
  ppDespachos: (depto, muni, texto) => ipcRenderer.invoke("pp-despachos", { depto, muni, texto }),
  ppCargados: () => ipcRenderer.invoke("pp-cargados"),
  ppPublicaciones: (despacho) => ipcRenderer.invoke("pp-publicaciones", { despacho }),
  ppDocumentos: (publicacion) => ipcRenderer.invoke("pp-documentos", { publicacion }),
  ppCargar: (depto, despacho) => ipcRenderer.invoke("pp-cargar", { depto, despacho }),
  ppCancelar: () => ipcRenderer.invoke("pp-cancelar"),
  ppOlvidar: (despacho) => ipcRenderer.invoke("pp-olvidar", { despacho }),
  ppAbrir: (url) => ipcRenderer.invoke("pp-abrir", { url }),
  alPp: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("pp-progreso", canal);
    return () => ipcRenderer.removeListener("pp-progreso", canal);
  },
  actualizacionComprobar: () => ipcRenderer.invoke("actualizacion-comprobar"),
  actualizacionOmitir: (version) => ipcRenderer.invoke("actualizacion-omitir", { version }),
  actualizacionDescargar: (archivo) => ipcRenderer.invoke("actualizacion-descargar", { archivo }),
  alActualizacion: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("actualizacion-disponible", canal);
    return () => ipcRenderer.removeListener("actualizacion-disponible", canal);
  },
  alDescargaApp: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("actualizacion-progreso", canal);
    return () => ipcRenderer.removeListener("actualizacion-progreso", canal);
  },
  licencia: () => ipcRenderer.invoke("licencia"),
  iniciarPlan: () => ipcRenderer.invoke("licencia-iniciar"),
  confirmarPlan: () => ipcRenderer.invoke("licencia-confirmar"),
  activarCodigo: (codigo) => ipcRenderer.invoke("licencia-activar", codigo),
  abrirPagoNavegador: () => ipcRenderer.invoke("licencia-navegador"),
  alPago: (fn) => {
    const canal = () => fn();
    ipcRenderer.on("licencia-retorno", canal);
    return () => ipcRenderer.removeListener("licencia-retorno", canal);
  },
  alCorrida: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("corrida", canal);
    return () => ipcRenderer.removeListener("corrida", canal);
  },
  alRevisionAutomatica: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("revision-automatica", canal);
    return () => ipcRenderer.removeListener("revision-automatica", canal);
  },
  alAbrirCambios: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("abrir-cambios", canal);
    return () => ipcRenderer.removeListener("abrir-cambios", canal);
  },
});
