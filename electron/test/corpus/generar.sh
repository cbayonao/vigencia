#!/bin/sh
# Genera el corpus de prueba del conversor. Solo herramientas locales:
# LibreOffice (soffice) e ImageMagick. Se corre a mano; los archivos
# resultantes van en el repositorio.
set -e
cd "$(dirname "$0")"
cat > sentencia.txt <<'T'
CORTE CONSTITUCIONAL

Sentencia T-123 de 2024

ANTECEDENTES

La accionante solicitó la protección del derecho fundamental a la salud. La entidad promotora negó el medicamento ordenado por el médico tratante.

CONSIDERACIONES

La Corte reitera que el derecho a la salud es fundamental y autónomo. Ñandú, acción, corazón.

RESUELVE

Primero. CONCEDER el amparo del derecho a la salud.
T
soffice --headless --convert-to pdf sentencia.txt >/dev/null 2>&1
mv sentencia.pdf texto.pdf
soffice --headless --convert-to docx sentencia.txt >/dev/null 2>&1
mv sentencia.docx sentencia.docx 2>/dev/null || true
magick -size 1400x700 xc:white -font DejaVu-Sans -pointsize 40 -fill black \
  -annotate +60+120 'JUZGADO PRIMERO CIVIL' \
  -annotate +60+220 'Auto que admite la demanda' \
  -annotate +60+320 'Se reconoce personeria al apoderado' escaneo.png
magick escaneo.png -quality 85 escaneo.jpg
magick escaneo.jpg escaneado.pdf
printf 'radicado,despacho,estado\n11001400304720220003800,Juzgado 47 Civil Municipal,activo\n' > procesos.csv
printf '<html><body><h1>Concepto</h1><p>El <b>plazo</b> es de diez días.</p><ul><li>uno</li><li>dos</li></ul></body></html>' > concepto.html
rm -f sentencia.txt.bak
