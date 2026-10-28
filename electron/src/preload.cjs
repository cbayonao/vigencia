const { contextBridge, ipcRenderer, webUtils } = require("electron");

const MIS = new Set([
  "listar", "detalle", "radicados", "propia-guardar", "propia-marcar", "propia-borrar", "manual-guardar",
  "actuacion-guardar", "actuacion-borrar", "archivar", "vincular", "estados-guardar", "audiencia-guardar",
  "audiencia-borrar", "sugerencia-descartar", "ics", "exportar", "archivos-agregar", "archivo-quitar",
  "archivo-abrir", "archivo-ia", "proyecto",
]);

contextBridge.exposeInMainWorld("vigencia", {
  listar: () => ipcRenderer.invoke("listar"),
  rutaDeArchivo: (archivo) => {
    try {
      return webUtils.getPathForFile(archivo) || "";
    } catch {
      return "";
    }
  },
  convertirInicio: () => ipcRenderer.invoke("convertir-inicio"),
  convertirElegir: () => ipcRenderer.invoke("convertir-elegir"),
  convertirRutas: (rutas, proyectoId, forzarOcr, herramienta) => ipcRenderer.invoke("convertir-rutas", { rutas, proyectoId, forzarOcr, herramienta }),
  convertirReconvertir: (id) => ipcRenderer.invoke("convertir-reconvertir", { id }),
  convertirCancelar: (id) => ipcRenderer.invoke("convertir-cancelar", { id }),
  convertirLeer: (id) => ipcRenderer.invoke("convertir-leer", { id }),
  convertirRenombrar: (id, nombre) => ipcRenderer.invoke("convertir-renombrar", { id, nombre }),
  convertirBorrar: (id) => ipcRenderer.invoke("convertir-borrar", { id }),
  convertirGuardarEdicion: (id, markdown) => ipcRenderer.invoke("convertir-guardar-edicion", { id, markdown }),
  convertirGuardarComo: (id) => ipcRenderer.invoke("convertir-guardar-como", { id }),
  convertirABiblioteca: (id) => ipcRenderer.invoke("convertir-a-biblioteca", { id }),
  convertirLimpiarCache: () => ipcRenderer.invoke("convertir-limpiar-cache"),
  convertirOcrEstado: () => ipcRenderer.invoke("convertir-ocr-estado"),
  convertirOcrInstalar: () => ipcRenderer.invoke("convertir-ocr-instalar"),
  convertirOcrQuitar: () => ipcRenderer.invoke("convertir-ocr-quitar"),
  alConvertir: (fn) => {
    const canal = (_e, dato) => fn(dato);
    ipcRenderer.on("convertir-progreso", canal);
    return () => ipcRenderer.removeListener("convertir-progreso", canal);
  },
  alOcrProgreso: (fn) => {
    const canal = (_e, dato) => fn(dato);
    ipcRenderer.on("convertir-ocr-progreso", canal);
    return () => ipcRenderer.removeListener("convertir-ocr-progreso", canal);
  },
  proyectoArchivos: (proyectoId) => ipcRenderer.invoke("proyecto-archivos", { proyectoId }),
  proyectoArchivoAgregar: (proyectoId, archivoId) => ipcRenderer.invoke("proyecto-archivo-agregar", { proyectoId, archivoId }),
  proyectoArchivoQuitar: (proyectoId, archivoId) => ipcRenderer.invoke("proyecto-archivo-quitar", { proyectoId, archivoId }),
  proyectoArchivoIncluir: (proyectoId, archivoId, incluido) => ipcRenderer.invoke("proyecto-archivo-incluir", { proyectoId, archivoId, incluido }),
  proyectoAgentesLeer: (proyectoId) => ipcRenderer.invoke("proyecto-agentes-leer", { proyectoId }),
  proyectoAgentesGuardar: (proyectoId, texto) => ipcRenderer.invoke("proyecto-agentes-guardar", { proyectoId, texto }),
  proyectoEnvios: (proyectoId) => ipcRenderer.invoke("proyecto-envios", { proyectoId }),
  bloqueRevisar: (datos) => ipcRenderer.invoke("bloque-revisar", datos),
  bloqueProponer: (datos) => ipcRenderer.invoke("bloque-proponer", datos),
  bloqueResolver: (datos) => ipcRenderer.invoke("bloque-resolver", datos),
  bloqueHistorial: (id) => ipcRenderer.invoke("bloque-historial", id),
  documentosRevisarEnvio: (datos) => ipcRenderer.invoke("documentos-revisar-envio", datos),
  jurisConvertir: (sentencia, proyectoId) => ipcRenderer.invoke("juris-convertir", { sentencia, proyectoId }),
  documentosInicio: () => ipcRenderer.invoke("documentos-inicio"),
  documentosProyecto: (id, modelo) => ipcRenderer.invoke("documentos-proyecto", { id, modelo }),
  documentosCrear: (datos) => ipcRenderer.invoke("documentos-crear", datos),
  documentosActualizar: (id, cambios) => ipcRenderer.invoke("documentos-actualizar", { id, cambios }),
  documentosDuplicar: (id) => ipcRenderer.invoke("documentos-duplicar", { id }),
  documentosBorrar: (id) => ipcRenderer.invoke("documentos-borrar", { id }),
  documentosFuentes: (id, fuentes) => ipcRenderer.invoke("documentos-fuentes", { id, fuentes }),
  documentosVersion: (id) => ipcRenderer.invoke("documentos-version", { id }),
  documentosCitas: (id) => ipcRenderer.invoke("documentos-citas", { id }),
  documentosDiferencias: (antes, despues) => ipcRenderer.invoke("documentos-diferencias", { antes, despues }),
  documentosRestaurar: (id) => ipcRenderer.invoke("documentos-restaurar", { id }),
  documentosVersionBorrar: (id) => ipcRenderer.invoke("documentos-version-borrar", { id }),
  documentosGuardarTexto: (id, cuerpo, ids) => ipcRenderer.invoke("documentos-guardar-texto", { id, cuerpo, ids }),
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
  documentosFuentesImportarRutas: (rutas) => ipcRenderer.invoke("documentos-fuentes-importar-rutas", { rutas }),
  comentariosListar: () => ipcRenderer.invoke("comentarios-listar"),
  comentariosEnviar: (datos) => ipcRenderer.invoke("comentarios-enviar", datos),
  jurisFuentes: () => ipcRenderer.invoke("juris-fuentes"),
  jurisBuscar: (datos) => ipcRenderer.invoke("juris-buscar", datos),
  jurisLeer: (sentencia) => ipcRenderer.invoke("juris-leer", { sentencia }),
  jurisGuardar: (sentencia, texto) => ipcRenderer.invoke("juris-guardar", { sentencia, texto }),
  pdfElegir: (varios) => ipcRenderer.invoke("pdf-elegir", { varios }),
  pdfInfo: (ruta) => ipcRenderer.invoke("pdf-info", { ruta }),
  // Mis procesos: un canal por acción, solo los de esta lista.
  mis: (accion, dato = {}) => (MIS.has(accion) ? ipcRenderer.invoke(`mis-${accion}`, dato) : Promise.resolve({ ok: false, error: "Acción desconocida." })),
  estadosElegir: () => ipcRenderer.invoke("estados-elegir"),
  estadosLeer: (ruta) => ipcRenderer.invoke("estados-leer", { ruta }),
  estadosExportar: (formato, lotes) => ipcRenderer.invoke("estados-exportar", { formato, lotes }),
  estadosMarkdown: (lote) => ipcRenderer.invoke("estados-markdown", { lote }),
  estadosVerificar: (radicado) => ipcRenderer.invoke("estados-verificar", { radicado }),
  // partes: [{ ruta, indices }] para unir solo esas páginas.
  pdfUnir: (rutas, partes) => ipcRenderer.invoke("pdf-unir", { rutas, partes }),
  // partes: [[índices], ...]; con más de una, un PDF por parte en una carpeta.
  pdfSeparar: (ruta, rangos, partes) => ipcRenderer.invoke("pdf-separar", { ruta, rangos, partes }),
  // giros: { índice: grados } para girar cada página distinto.
  pdfRotar: (ruta, rangos, angulo, giros) => ipcRenderer.invoke("pdf-rotar", { ruta, rangos, angulo, giros }),
  pdfAbrir: (ruta) => ipcRenderer.invoke("pdf-abrir", { ruta }),
  pdfMostrar: (ruta) => ipcRenderer.invoke("pdf-mostrar", { ruta }),
  pdfFirmar: (datos) => ipcRenderer.invoke("pdf-firmar", datos),
  pdfArchivo: (ruta) => ipcRenderer.invoke("pdf-archivo", { ruta }),
  pdfVerificar: (ruta) => ipcRenderer.invoke("pdf-verificar", { ruta }),
  firmasListar: () => ipcRenderer.invoke("firmas-listar"),
  firmaGuardar: (datos) => ipcRenderer.invoke("firma-guardar", datos),
  firmaRenombrar: (id, nombre) => ipcRenderer.invoke("firma-renombrar", { id, nombre }),
  firmaBorrar: (id) => ipcRenderer.invoke("firma-borrar", { id }),
  pdfComprimir: (ruta, nivel, medir = false) => ipcRenderer.invoke("pdf-comprimir", { ruta, nivel, medir }),
  pdfProteger: (ruta, clave, duenio, permisos) => ipcRenderer.invoke("pdf-proteger", { ruta, clave, duenio, permisos }),
  pdfDesbloquear: (ruta, clave) => ipcRenderer.invoke("pdf-desbloquear", { ruta, clave }),
  pdfCampos: (ruta) => ipcRenderer.invoke("pdf-campos", { ruta }),
  pdfRellenar: (ruta, valores, aplanar) => ipcRenderer.invoke("pdf-rellenar", { ruta, valores, aplanar }),
  pdfComparar: (rutaA, rutaB) => ipcRenderer.invoke("pdf-comparar", { rutaA, rutaB }),
  pdfAProyecto: (datos) => ipcRenderer.invoke("pdf-a-proyecto", datos),
  documentosExportar: (version, formato, pie = true) => ipcRenderer.invoke("documentos-exportar", { version, formato, pie }),
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
  modelosBorrar: (id) => ipcRenderer.invoke("modelos-borrar", { id }),
  modelosQuitarNube: (proveedor) => ipcRenderer.invoke("modelos-quitar-nube", { proveedor }),
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
  actualizarFallidos: () => ipcRenderer.invoke("actualizar-fallidos"),
  actualizarUno: (id) => ipcRenderer.invoke("actualizar-uno", id),
  agregar: (numero) => ipcRenderer.invoke("agregar", numero),
  agregarCancelar: () => ipcRenderer.invoke("agregar-cancelar"),
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
  gastoResumen: () => ipcRenderer.invoke("gasto-resumen"),
  gastoUltimo: (proyectoId) => ipcRenderer.invoke("gasto-ultimo", { proyectoId }),
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
  alAbrirMis: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("abrir-mis", canal);
    return () => ipcRenderer.removeListener("abrir-mis", canal);
  },
  alAbrirCambios: (fn) => {
    const canal = (_evento, dato) => fn(dato);
    ipcRenderer.on("abrir-cambios", canal);
    return () => ipcRenderer.removeListener("abrir-cambios", canal);
  },
});
