# Registro de cambios

## Sin publicar (rama feature/firma-visual)
- Firmar como Rellenar y firmar de Adobe: el PDF se ve completo en la pantalla, con páginas seguidas, contador, anterior y siguiente, acercar, alejar y Ajustar al ancho. Las páginas giradas o recortadas se ven y se firman bien.
- Mis firmas: dibujarla con el ratón o el touchpad (con Deshacer trazo y Limpiar), subir una imagen PNG o JPG quitando el fondo blanco, o escribir el nombre en letra cursiva (Great Vibes, licencia OFL). Se guardan en este computador y se pueden renombrar y borrar.
- Poner firmas y campos de Nombre, Fecha (dd/mm/aaaa) y Texto libre con su tamaño de letra: se arrastran a la página o se tocan y luego se toca la página. Se mueven, se agrandan desde las esquinas sin deformarse, se duplican (también en otras páginas), se quitan con el botón o Supr y Deshacer vuelve atrás. Varias firmas en varias páginas.
- Firmar y guardar deja siempre un PDF nuevo, nombre-firmado.pdf, y nunca escribe encima del original. La página de constancia con código es opcional (encendida por defecto). Abrir el firmado lo muestra enseguida y Usar con la IA lo recibe.
- La ventana aclara que es firma electrónica (Ley 527 de 1999, Decreto 2364 de 2012) y no firma digital con certificado.
- Arreglos: Verificar decía alterado a todo PDF firmado si se revisaba un segundo después; el visor no cargaba porque la app no servía el worker de pdfjs; una firma JPG pequeña fallaba al estamparla; un PDF con contraseña ahora da la guía de Desbloquear.

## Sin publicar (rama feature/pdf-contexto-ia)
- Herramientas PDF: unir, separar, girar, firmar, comprimir, proteger, desbloquear, rellenar y comparar, todo en este computador.
- PDF, Convertir y Documentos ya trabajan juntos: en Herramientas PDF, el panel Usar con la IA convierte a Markdown el PDF elegido o el que acaba de salir de una herramienta, o lo lleva al contexto de un proyecto. Desbloquear deja una copia temporal sin contraseña para llevarla aunque no se guarde copia.
- Convertir: proyecto de destino al subir (cada archivo queda en su contexto), marcar varios para llevarlos al proyecto o a la biblioteca, y Abrir en Documentos.
- Biblioteca de fuentes: acepta lo mismo que Convertir (PDF, imágenes, Word, Excel, HTML, texto) y todo pasa por el mismo conversor, con caché, OCR y avance. La fuente queda ligada al archivo y Documentos usa sus fragmentos con página; si se edita el texto, se desliga. Las fuentes viejas siguen igual.
- Revisar envío muestra por archivo y por fuente las páginas que van, cuántas se leyeron con OCR, la calidad del texto y de qué pantalla vino.
- OCR con tope de 200 páginas escaneadas por conversión, con aviso de cuántas quedaron sin leer. Un PDF con contraseña dice cómo abrirlo en vez de fallar.
- Comparar PDF usa el lector completo (fuentes CID y OCR).
- Migración 17: índice de fuentes por archivo (solo suma).
- Arreglos: la caché por hash nunca se usaba al volver a convertir el mismo archivo; las pestañas Comprimir, Proteger, Desbloquear, Rellenar y Comparar no respondían; Separar y Girar corrían dos veces; la barra de avance de Convertir no se movía (estilos en línea bloqueados).

## 3.5.0 (16 de octubre de 2026)
- Convertir a Markdown en este computador: PDF con texto (pdfjs, incluso CID), PDF escaneado e imágenes con OCR en español (descarga bajo demanda en Modelos de IA), Word, Excel, CSV, HTML y texto. Caché, revisiones y limpiar caché.
- Jurisprudencia: botón Convertir a Markdown para agregar la sentencia al proyecto, a la Biblioteca o guardarla como .md.
- Documentos: Contexto del proyecto con archivos (arrastrar, incluir o quitar) y AGENTS.md por proyecto; búsqueda por fragmentos con citas [archivo, página n].
- Solo local por proyecto (encendido por defecto) y Revisar envío con el texto exacto que va a la nube.
- Memoria del documento que sobrevive reinicios y cambios de modelo.
- Cambiar un párrafo con IA: antes y después por palabras, Aceptar o Rechazar, historial por párrafo.
- Editor enriquecido (TipTap, local): estilos jurídicos, negrita, cursiva, subrayado, listas, tablas, alineación, cita y modo Markdown.
- Exportar a Word, ODT y PDF con el pie "Generado con IA. Favor revisar." (se puede quitar).
- Migraciones 13 a 16 probadas en copias de bases reales.
- Arreglos: importar por arrastre; nombres de archivo del Contexto del proyecto se veían enormes.
