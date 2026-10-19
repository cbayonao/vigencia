# Registro de cambios

## Sin publicar (rama feature/estados-formatos)

### Estados del juzgado a tabla
- Estados en otro formato: ahora también se leen los estados hechos en Word con el título "NOTIFICACIÓN POR ESTADO DEL ..." (un registro por línea, la clase junto al número del proceso, por ejemplo "Ejecutivo No 2023-00073", la fecha del auto en letras y el cuaderno como "1 y 2."). Salen en la misma tabla: clase, número como viene, demandante, demandado, actuación, fecha del auto (dd/mm/aaaa) y cuaderno. La fecha del estado se toma del título.
- Estos estados no traen el radicado de 23 dígitos, solo el número corto: la columna Radicado queda vacía, el número va en Radicado como viene, la fila avisa y no se cruza con los procesos que usted sigue.
- El lector detecta el formato de cada página y usa el lector de ese formato; el listado de la Rama se lee igual que antes. Las palabras que Word parte en pedazos se vuelven a juntar.
- Un solo lector para cualquier estado con fila de títulos: ya no hay un lector por formato. Los títulos dicen qué es cada columna (Proceso, Radicación, Demandante, Accionante, Actuación, Auto / Anotación, Fecha, Cdno...) y la columna del número decide cómo empieza cada registro: con el radicado completo o con el número corto (con o sin la clase delante). El listado de la Rama sale igual que antes.
- Estados de Justicia XXI ("FIJACIÓN DE ESTADOS"): radicado completo en una línea, celdas de varias líneas y una sola columna Auto / Anotación, que se parte en el primer guion (Auto Decide - Accede a la solicitud). La fecha del estado se toma del título (Estado No. 104 De Martes, 23 De Julio De 2024) y la secretaría del pie.
- Si el pie dice el número de registros y no coincide con las filas leídas, se avisa.
- El pie de la última página se separa también cuando no hay un salto grande: empieza en la primera línea que cruza columnas.
- Radicado armado: en los estados que solo traen el número corto (2023-00073, 2023-73, 26-489, No 2024-00210, 202400210, con recurso 2023-00073-01) el radicado de 23 dígitos se arma con el juzgado del título del estado. El juzgado sale, en este orden, de lo aprendido de estados con radicados completos y de los procesos de la consulta nacional y SAMAI que usted ya tiene, o del catálogo de despachos de la Rama que trae la app (municipio, corporación, especialidad y número del juzgado).
- El radicado armado se ve distinto en la tabla (Armado, no viene en el PDF) y sirve para cruzar con los procesos que usted sigue. Si se tuvo que suponer algo (el juzgado 001 cuando hay varios en el municipio, o un juzgado que no está en el catálogo) queda como Supuesto, con confianza Dudosa, y no se puede agregar a Mis procesos hasta verificarlo o corregirlo.
- Verificar en la consulta: una sola consulta a la Rama por ese número, sin guardar nada, que confirma si el radicado existe.
- Los despachos comisorios y los números sin año no se arman.
- Base de datos: migración 20 agrega la tabla rad_juzgado (juzgados aprendidos). No cambia nada de lo que ya existe.

## 3.8.0 (19 de octubre de 2026)

### Mis procesos
- Mis procesos, nueva pantalla de inicio y primera de la barra: todos los procesos de la consulta nacional, SAMAI, SPOA, los que llegan de un estado del juzgado y los manuales, con su fuente, la última actuación, filtros por fuente, abogado, despacho y estado, búsqueda, y tablero con activos, conteo por fuente, audiencias de la semana, pendientes y procesos quietos (más de 60 días). El detalle completo se abre en la pantalla de su sistema.
- Lado del despacho: notas, reuniones, llamadas, memoriales, pendientes de radicar y tareas, con fecha, vencimiento y hecho. Van en tablas propias y salen junto a las del juzgado en una sola línea de tiempo, con filtro. La revisión automática no las lee: nunca generan cambios ni avisos.
- Procesos manuales para lo que no está en ningún sistema, con sus actuaciones escritas a mano. Nadie los consulta.
- Estados: guarda las filas de los procesos que ya sigue como su historia (sin repetir radicado, fecha del auto y actuación), Seguir este proceso y el nuevo Agregar los seleccionados los dejan en Mis procesos, y si el radicado aparece después en la consulta nacional se ofrece vincularlos.
- Audiencias: calendario por mes y semana, próximas audiencias, programación a mano, sugerencias leídas de las actuaciones (sp.30/24 08:30am, 3 de noviembre de 2026 a las 9 a.m., 15/03/2025 3 pm) que se confirman con un clic, recordatorio un día y una hora antes, y exportación a .ics.
- Documentos por proceso: archivos referenciados, vista del PDF, abrir, mostrar en la carpeta y Usar con la IA en el proyecto de Documentos del proceso. Los proyectos ligados al proceso aparecen ahí.
- Exportar la lista filtrada a Excel.

### Estados del juzgado a tabla
- Estados del juzgado a tabla (Herramientas PDF): se sueltan uno o varios listados de estado de la Rama (PDF, o el mismo estado en Excel, CSV, Word o HTML) y salen como tabla que se ordena, se filtra, se busca y se corrige a mano. Al tocar una fila, el PDF muestra su lugar resaltado en la página.
- Lee el formato Siglo XXI (radicado partido en dos líneas, celdas de varias líneas, títulos repetidos en cada página y columnas corridas) y otros títulos (Radicación, Accionante, Accionado, Anotación, Fecha Providencia, Cuaderno, Folios). El radicado queda en 23 dígitos cuando es seguro y si no, como viene. Juzgado, número y fecha del estado salen del encabezado; el pie (constancia y secretario) queda aparte, sin perder texto.
- Cada fila trae su confianza y sus avisos (radicado completado o incompleto, sin fecha, anotación que sigue en otra página, leído con OCR o sin columnas).
- Marca "Usted sigue este proceso" en los radicados de su lista y ofrece "Seguir este proceso" con el mismo Agregar de la consulta. Exporta a Excel y CSV, y Usar con la IA recibe la tabla en Markdown.
## Sin publicar (rama feature/pdf-visual)
- Herramientas PDF con vista: cada herramienta muestra las páginas en el panel derecho, con zona grande para soltar, estado de avance y tarjeta de resultado con Abrir, Mostrar en carpeta y Usar con la IA. Tema claro y oscuro, todo con teclado.
- Unir: tarjetas con la primera página, páginas y peso; se ordenan arrastrando o con Alt y flechas, se quitan con Supr, se agregan soltando y se pueden elegir páginas de cada archivo. Abajo se ve cómo queda.
- Separar: cuadrícula de páginas con tijeras entre ellas o Cortar cada n páginas, partes de colores y resumen; también Sacar páginas. Varias partes se guardan en una carpeta sin pisar nada.
- Girar: cada página con sus botones, Elegir todas, girar las elegidas, teclas R y Mayús+R, Deshacer. El giro se ve al instante.
- Comprimir: niveles como tarjetas con el peso medido, barras de antes y después con el porcentaje y una página de muestra antes y después, también de cerca.
- Proteger y Desbloquear: candado que se cierra o se abre, medidor de fuerza de la contraseña, mostrar u ocultar, permisos (imprimir, copiar, cambiar páginas, comentar) con su resumen, y la primera página después de desbloquear.
- Rellenar: los campos se escriben sobre la página y en la lista de al lado, que van juntas y resaltan el campo que se edita.
- Comparar: los dos PDF lado a lado moviéndose juntos, marcas de cambios por página y panel con lo agregado, cambiado y quitado palabra por palabra; tocar un cambio lleva a su página en los dos.
- Guardar encima del PDF original ahora dice qué hacer: guardarlo con otro nombre.

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
