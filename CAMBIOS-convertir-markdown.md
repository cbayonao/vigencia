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

- Editor enriquecido del documento (TipTap 3, licencia MIT, empaquetado local en electron/renderer/vendor/editor.js con `npm run editor`; sin internet y compatible con la CSP). Estilos: Párrafo, Título de sección, Subtítulo, Cita textual, Firma; negrita, cursiva, subrayado, viñetas, numerales, tablas (agregar fila o columna, quitar), alineación izquierda, centro, derecha y justificado, deshacer y rehacer. Hoja tamaño carta con letra Times.
- El editor guarda en Markdown (formato en compartido/formato.js): ## sección, #### subtítulo, > cita, - viñeta, 1. numeral, tabla con |, **negrita**, *cursiva*, ++subrayado++, {centro} {derecha} {izquierda} {justificado} al inicio del párrafo. Botón Markdown para ver o editar ese texto.
- Cada párrafo del editor lleva su id de bloque (data-bloque). Guardar conserva los ids aunque el párrafo se reescriba entero, deja historial por párrafo (origen manual) y anota en la memoria "Editado a mano". Partir un párrafo con Enter crea un bloque nuevo.
- "Cambiar este párrafo con IA" en la barra del editor y "Cambiar con IA" en cada párrafo de la vista abren el diálogo con ese párrafo elegido. Si el modelo devuelve solo el texto, el párrafo conserva su forma (viñeta, numeral, cita, alineación).
- Word, ODT y PDF respetan todo el formato (tablas con borde, cita con sangría, subtítulo, subrayado, alineación). El pie "Generado con IA. Favor revisar." se ve al final del editor con "Quitar pie" y "Poner pie", va unido a la casilla del exportar y sigue siendo un pie normal en Word y LibreOffice. Word de Documentos ahora lleva el título arriba.
- Restaurar una versión también sincroniza los párrafos y la memoria.
- Probado a mano con el modelo local llama 3.2 1B: documento de tutela, formato en el editor (27 ids conservados más una tabla nueva), Cambiar este párrafo con IA en una pretensión, diff, Aceptar (versión 3, mismo id, numeral conservado, memoria actualizada). El 3B no cupo en la ventana de contexto de este equipo. Capturas en ~/vigencia-capturas.

## Pendiente (diseño)
- Listas anidadas: se guardan planas (cada viñeta es un párrafo). Para anidar haría falta sangría en el Markdown ("  - ").
- Celdas combinadas en tablas: el Markdown no las representa; el editor permite combinarlas pero al guardar quedan separadas.
- Notas al pie, encabezado con membrete y numeración de páginas en el editor.
- Ver el documento en páginas separadas dentro del editor (hoy es una hoja continua).
### Otros
- Embeddings y skills: fuera del MVP.
- Vista del original dentro de la app (bloqueada por la CSP; opción: abrir con el visor del sistema).
- Tres conversiones a la vez y pausa del OCR.
- Cambiar un párrafo en la nube reutiliza Revisar envío; falta probarlo a mano con una clave real.

## Pruebas
cd electron && npm test   (206 pasan)
npm run editor   (vuelve a armar renderer/vendor/editor.js si cambia electron/editor/editor.js)
