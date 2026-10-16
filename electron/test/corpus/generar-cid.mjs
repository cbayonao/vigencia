// PDF con fuente Type0 Identity-H y ToUnicode: el caso CID que el lector
// viejo (pdftexto.js) no entiende. Se corre con: node generar-cid.mjs
import fs from "node:fs";
const lineas = ["SALA DE CASACION LABORAL", "La pension de vejez se reconoce.", "Se casa la sentencia del tribunal."];
const glifos = new Map();
for (const l of lineas) for (const c of l) if (!glifos.has(c)) glifos.set(c, glifos.size + 1);
const hex = (n) => n.toString(16).padStart(4, "0").toUpperCase();
let contenido = "BT /F1 18 Tf 72 720 Td\n";
lineas.forEach((l, i) => {
  if (i) contenido += "0 -30 Td\n";
  contenido += `<${[...l].map((c) => hex(glifos.get(c))).join("")}> Tj\n`;
});
contenido += "ET\n";
const bf = [...glifos].map(([c, g]) => `<${hex(g)}> <${hex(c.charCodeAt(0))}>`).join("\n");
const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def /CMapType 2 def
1 begincodespacerange <0000> <FFFF> endcodespacerange
${glifos.size} beginbfchar
${bf}
endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
const objs = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  `<< /Length ${contenido.length} >>\nstream\n${contenido}endstream`,
  "<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAB+ArialCID /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
  "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /AAAAAB+ArialCID /CIDToGIDMap /Identity /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 600 /FontDescriptor 8 0 R >>",
  `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
  "<< /Type /FontDescriptor /FontName /AAAAAB+ArialCID /Flags 32 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>",
];
let pdf = "%PDF-1.4\n";
const pos = [];
objs.forEach((o, i) => { pos.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = pdf.length;
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(new URL("./cid.pdf", import.meta.url), pdf, "latin1");
