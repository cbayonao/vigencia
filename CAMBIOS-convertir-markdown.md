# Cambios: Convertir a Markdown (rama feature/convertir-markdown)

Versión base 3.4.0. Todo local, sin push.

## Hecho
- Convertir a Markdown en proceso aparte (utilityProcess): PDF con texto y CID (pdfjs), PDF escaneado e imágenes con OCR en español (se instala desde Menú, Modelos de IA), Word, Excel y CSV, HTML, texto. Caché por hash, revisiones al editar, limpiar caché.
- Jurisprudencia: botón Convertir a Markdown (Corte Constitucional y Consejo de Estado), con agregar al proyecto, a la Biblioteca o guardar .md.
- Documentos: Contexto del proyecto con archivos (arrastrar, incluir o quitar) y AGENTS.md por proyecto.
- Trozos con página y búsqueda BM25 con FTS5; citas [archivo, página n].
- Solo local por proyecto, encendido por defecto. Revisar envío muestra el texto exacto y lo que va; se registra en envio_nube.
- Memoria del documento (doc_memoria): instrucciones, decisiones, fuentes, modelos usados, esquema de secciones y resumen. Sobrevive reinicios y cambio de modelo, y entra al encargo del siguiente modelo.
- Cambiar un párrafo: ids de bloque estables, el modelo devuelve solo ese párrafo, antes y después por palabras, Aceptar (versión nueva) o Rechazar, historial por bloque, memoria actualizada.
- Exportar a Word, ODT y PDF con el pie "Generado con IA. Favor revisar." por defecto (casilla para quitarlo; en Word y ODT es un pie normal que se puede borrar).
- Migraciones 13 a 16, probadas en copias de una base real (v10 y v12 a v16), dos veces seguidas, sin pérdida de filas.
- Arreglos de paso: importar por arrastre fallaba (variable base tapaba la base); Electron 44 quitó File.path.

## Pendiente (diseño)
### Editor enriquecido
- Vista de edición tipo documento sobre los mismos bloques: cada párrafo es un elemento contenteditable con data-bloque igual al id de doc_bloque; títulos como bloques de sección. Barra mínima: negrita, itálica, viñetas, título. Se guarda como Markdown (** * - ##), que es lo que ya entienden docx.js, odt y PDF, así no hay dos formatos.
- Al guardar, sincronizar() conserva los ids; los párrafos tocados a mano quedan en la memoria como "editado a mano" y en doc_bloque_cambio con origen "manual" y estado aceptado.
- Botón en cada párrafo: Cambiar con IA, que abre el diálogo actual ya elegido.
- Pie de IA en la vista: línea final propia que el usuario puede borrar; si la borra, la casilla del exportar arranca apagada.
- Sin librería externa grande al principio (CSP style-src 'self' obliga a clases, no estilos en línea).
### Otros
- Embeddings y skills: fuera del MVP.
- Vista del original dentro de la app (bloqueada por la CSP; opción: abrir con el visor del sistema).
- Tres conversiones a la vez y pausa del OCR.
- Cambiar un párrafo en la nube reutiliza Revisar envío; falta probarlo a mano con una clave real.

## Pruebas
cd electron && npm test   (199 pasan)
