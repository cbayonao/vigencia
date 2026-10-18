// Proteger (AES-256) y recorrer objetos con pdf-lib. Desbloquear vive en
// pdfdescifrar.js (parser propio sobre bytes, porque pdf-lib no abre
// cifrados). No se tocan: flujos XRef, diccionario Encrypt, firmas
// (ByteRange/Contents) ni el ID/trailer.
import crypto from "node:crypto";
import fs from "node:fs";
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString,
} from "pdf-lib";
import { Aviso } from "./db.js";
import { aesCbcCifrar, aesEcbCifrar, crearV5, permisosBytes } from "./pdfcifrado.js";

function leerPdf(ruta) {
  let datos;
  try {
    datos = fs.readFileSync(ruta);
  } catch {
    throw new Aviso("No pude leer ese PDF.");
  }
  if (datos.length < 5 || datos.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Aviso("Ese archivo no es un PDF válido.");
  }
  return datos;
}

function esXRef(obj) {
  if (!(obj instanceof PDFDict)) return false;
  const tipo = obj.get(PDFName.of("Type"));
  return tipo === PDFName.of("XRef");
}

function tieneFirma(obj) {
  return obj instanceof PDFDict && obj.has(PDFName.of("ByteRange"));
}

function hexDe(bytes) {
  return PDFHexString.of(Buffer.from(bytes).toString("hex").toUpperCase());
}

// Cifra strings y flujos con la llave del archivo (V5: directa + IV).
// Los directos heredan el número del indirecto que los contiene; cada
// objeto se cifra una sola vez aunque se alcance por varios caminos.
export function cifrarObjetos(doc, llave) {
  const vistos = new Set();
  const cifrarCadena = (bytes) => {
    const iv = crypto.randomBytes(16);
    return hexDe(Buffer.concat([iv, aesCbcCifrar(llave, Buffer.from(bytes), iv)]));
  };
  const visitar = (obj, num, gen) => {
    if (obj instanceof PDFHexString) return cifrarCadena(obj.asBytes());
    if (obj instanceof PDFString) return cifrarCadena(obj.asBytes());
    if (obj instanceof PDFRawStream) {
      if (esXRef(obj)) return obj;
      const iv = crypto.randomBytes(16);
      obj.contents = Buffer.concat([iv, aesCbcCifrar(llave, Buffer.from(obj.contents), iv)]);
      return obj;
    }
    if (obj == null || vistos.has(obj)) return obj;
    if (obj instanceof PDFDict) {
      vistos.add(obj);
      const firma = tieneFirma(obj);
      for (const [clave, valor] of obj.entries()) {
        const nombre = clave instanceof PDFName ? clave.toString().slice(1) : String(clave);
        if (firma && nombre === "Contents") continue;
        obj.set(clave, visitar(valor, num, gen));
      }
      return obj;
    }
    if (obj instanceof PDFArray) {
      vistos.add(obj);
      for (let i = 0; i < obj.size(); i += 1) obj.set(i, visitar(obj.get(i), num, gen));
      return obj;
    }
    return obj;
  };
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    visitar(obj, ref.objectNumber, ref.generationNumber);
  }
}

export async function protegerPdf(ruta, { usuario, duenio = "", permisos = -4 }) {
  const clave = String(usuario || "");
  if (clave.length < 1) throw new Aviso("Escriba una contraseña de al menos 1 letra.");
  if (clave.length > 127) throw new Aviso("La contraseña es muy larga (máximo 127 letras).");
  const doc = await PDFDocument.load(leerPdf(ruta));
  const visor = doc.getPageCount();
  if (!visor) throw new Aviso("Ese PDF no tiene páginas.");
  const { U, UE, O, OE, llave } = crearV5({ usuario: clave, duenio });
  cifrarObjetos(doc, llave);
  const permsCifrados = aesEcbCifrar(llave, permisosBytes(permisos));
  const enc = doc.context.obj({
    Filter: PDFName.of("Standard"),
    V: PDFNumber.of(5),
    R: PDFNumber.of(6),
    CF: doc.context.obj({
      StdCF: doc.context.obj({ AuthEvent: PDFName.of("DocOpen"), CFM: PDFName.of("AESV3"), Length: PDFNumber.of(32) }),
    }),
    StmF: PDFName.of("StdCF"),
    StrF: PDFName.of("StdCF"),
    O: hexDe(O),
    OE: hexDe(OE),
    U: hexDe(U),
    UE: hexDe(UE),
    P: PDFNumber.of(permisos),
    Perms: hexDe(permsCifrados),
  });
  doc.context.trailerInfo.Encrypt = doc.context.register(enc);
  const id = crypto.randomBytes(16).toString("hex").toUpperCase();
  const ids = doc.context.obj([]);
  ids.push(hexDe(Buffer.from(id, "hex")));
  ids.push(hexDe(Buffer.from(id, "hex")));
  doc.context.trailerInfo.ID = ids;
  return Buffer.from(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }));
}
