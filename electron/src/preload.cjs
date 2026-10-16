const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vigencia", {
  listar: () => ipcRenderer.invoke("listar"),
  documentosInicio: () => ipcRenderer.invoke("documentos-inicio"),
  documentosProyecto: (id, modelo) => ipcRenderer.invoke("documentos-proyecto", { id, modelo }),
  documentosCrear: (datos) => ipcRenderer.invoke("documentos-crear", datos),
  documentosActualizar: (id, cambios) => ipcRenderer.invoke("documentos-actualizar", { id, cambios }),
  documentosDuplicar: (id) => ipcRenderer.invoke("documentos-duplicar", { id }),
  documentosBorrar: (id) => ipcRenderer.invoke("documentos-borrar", { id }),
  documentosFuentes: (id, fuentes) => ipcRenderer.invoke("documentos-fuentes", { id, fuentes }),
  documentosVersion: (id) => ipcRenderer.invoke("documentos-version", { id }),
  documentosDiferencias: (antes, despues) => ipcRenderer.invoke("documentos-diferencias", { antes, despues }),
  documentosRestaurar: (id) => ipcRenderer.invoke("documentos-restaurar", { id }),
  documentosGuardarTexto: (id, cuerpo) => ipcRenderer.invoke("documentos-guardar-texto", { id, cuerpo }),
  documentosConversar: (datos) => ipcRenderer.invoke("documentos-conversar", datos),
  alDocumento: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("documentos-progreso", canal);
    return () => ipcRenderer.removeListener("documentos-progreso", canal);
  },
  documentosPerfilGuardar: (datos) => ipcRenderer.invoke("documentos-perfil-guardar", datos),
  documentosPerfilBorrar: (id) => ipcRenderer.invoke("documentos-perfil-borrar", { id }),
  documentosFuentesBuscar: (filtro) => ipcRenderer.invoke("documentos-fuentes-buscar", filtro),
  documentosFuenteLeer: (id) => ipcRenderer.invoke("documentos-fuente-leer", { id }),
  documentosFuenteGuardar: (datos) => ipcRenderer.invoke("documentos-fuente-guardar", datos),
  documentosFuenteBorrar: (id) => ipcRenderer.invoke("documentos-fuente-borrar", { id }),
  documentosFuenteImportar: () => ipcRenderer.invoke("documentos-fuente-importar"),
  documentosExportar: (version, formato) => ipcRenderer.invoke("documentos-exportar", { version, formato }),
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
  ppFrecuencia: () => ipcRenderer.invoke("pp-frecuencia"),
  ppGuardarFrecuencia: (horas) => ipcRenderer.invoke("pp-guardar-frecuencia", { horas }),
  ppAbrir: (url) => ipcRenderer.invoke("pp-abrir", { url }),
  spoaConsultar: (radicado) => ipcRenderer.invoke("spoa-consultar", { radicado }),
  spoaCasos: () => ipcRenderer.invoke("spoa-casos"),
  spoaCaso: (noticia) => ipcRenderer.invoke("spoa-caso", { noticia }),
  spoaOlvidar: (noticia) => ipcRenderer.invoke("spoa-olvidar", { noticia }),
  samaiCorporaciones: () => ipcRenderer.invoke("samai-corporaciones"),
  samaiBuscar: (criterio, corporacion) => ipcRenderer.invoke("samai-buscar", { criterio, corporacion }),
  samaiVer: (guid) => ipcRenderer.invoke("samai-ver", { guid }),
  samaiCasos: () => ipcRenderer.invoke("samai-casos"),
  samaiCaso: (guid) => ipcRenderer.invoke("samai-caso", { guid }),
  samaiOlvidar: (guid) => ipcRenderer.invoke("samai-olvidar", { guid }),
  ppVista: (url, nombre) => ipcRenderer.invoke("pp-vista", { url, nombre }),
  ppDescargarDoc: (url, nombre, token) => ipcRenderer.invoke("pp-descargar", { url, nombre, token }),
  alPp: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("pp-progreso", canal);
    return () => ipcRenderer.removeListener("pp-progreso", canal);
  },
  alPpNovedades: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("pp-novedades", canal);
    return () => ipcRenderer.removeListener("pp-novedades", canal);
  },
  alSpoaNovedades: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("spoa-novedades", canal);
    return () => ipcRenderer.removeListener("spoa-novedades", canal);
  },
  alSamaiNovedades: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("samai-novedades", canal);
    return () => ipcRenderer.removeListener("samai-novedades", canal);
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
