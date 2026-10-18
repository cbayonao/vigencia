// Cifrado PDF (ISO 32000 §7.6) en este computador, sin dependencias: RC4,
// AES-128/256, derivación V1/V2/V4 (MD5) y V5R6 (SHA-256). Proteger usa
// AES-256; Desbloquear abre V5/V4/V2/V1 con la contraseña del usuario.
// No se tocan: flujos cruzados (XRef), diccionario Encrypt, firmas
// (ByteRange/Contents) ni metadatos excluidos.
import crypto from "node:crypto";

export const RELLENO = Buffer.from([
  0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56,
  0xFF, 0xFA, 0x01, 0x08, 0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80,
  0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A,
]);

export function rc4(llave, datos) {
  const s = [...Array(256).keys()];
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i] + llave[i % llave.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const salida = Buffer.alloc(datos.length);
  let a = 0;
  j = 0;
  for (let i = 0; i < datos.length; i += 1) {
    a = (a + 1) & 0xff;
    j = (j + s[a]) & 0xff;
    [s[a], s[j]] = [s[j], s[a]];
    salida[i] = datos[i] ^ s[(s[a] + s[j]) & 0xff];
  }
  return salida;
}

export const md5 = (b) => crypto.createHash("md5").update(b).digest();
export const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
export const sha384 = (b) => crypto.createHash("sha384").update(b).digest();
export const sha512 = (b) => crypto.createHash("sha512").update(b).digest();

export function aesCbcCifrar(llave, datos, iv, relleno = true) {
  const c = crypto.createCipheriv(`aes-${llave.length * 8}-cbc`, llave, iv);
  if (!relleno) c.setAutoPadding(false);
  return Buffer.concat([c.update(datos), c.final()]);
}

export function aesCbcDescifrar(llave, datos, iv, relleno = true) {
  const c = crypto.createDecipheriv(`aes-${llave.length * 8}-cbc`, llave, iv);
  if (!relleno) c.setAutoPadding(false);
  return Buffer.concat([c.update(datos), c.final()]);
}

export function aesEcbCifrar(llave, datos) {
  const c = crypto.createCipheriv(`aes-${llave.length * 8}-ecb`, llave, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(datos), c.final()]);
}

export function aesEcbDescifrar(llave, datos) {
  const c = crypto.createDecipheriv(`aes-${llave.length * 8}-ecb`, llave, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(datos), c.final()]);
}

// Contraseña a 32 bytes (acepta texto o bytes ya recuperados del dueño;
// los bytes no se tocan: pasarlos por UTF-8 los corrompe).
export function rellenarClave(clave) {
  const b = Buffer.isBuffer(clave) ? clave.subarray(0, 32) : Buffer.from(String(clave || ""), "utf8").subarray(0, 32);
  return Buffer.concat([b, RELLENO.subarray(0, 32 - b.length)]);
}

export function xorLlave(llave, n) {
  return Buffer.from(llave.map((x) => x ^ n));
}

// Clave de archivo V1/V2/V4 con MD5 (paso e: 50 vueltas si R>=3).
// P llega con o sin signo según quién escribió el archivo.
export function claveV124(claveUsuario, O, P, id0, longBytes, cifrarMetadatos = true, rondas = true) {
  const pNum = Number(P) || 0;
  const firmado = pNum > 0x7fffffff ? pNum - 0x100000000 : pNum;
  const p = Buffer.alloc(4);
  p.writeInt32LE(firmado, 0);
  const partes = [rellenarClave(claveUsuario), O, p, id0];
  if (!cifrarMetadatos) partes.push(Buffer.from([0xff, 0xff, 0xff, 0xff]));
  let h = md5(Buffer.concat(partes)).subarray(0, longBytes);
  if (rondas) {
    for (let i = 0; i < 50; i += 1) h = md5(h.subarray(0, longBytes));
  }
  return h;
}

// Entrada O con dueño (R3+: MD5 inicial + 50 vueltas + 20 RC4).
export function entradaO(claveDuenio, claveUsuario, longBytes, rondas = true) {
  let h = md5(rellenarClave(claveDuenio));
  if (rondas) {
    for (let i = 0; i < 50; i += 1) h = md5(h);
    h = h.subarray(0, longBytes);
  }
  let u = rellenarClave(claveUsuario);
  const vueltas = rondas ? 20 : 1;
  for (let i = 0; i < vueltas; i += 1) u = rc4(xorLlave([...h], i), u);
  return u;
}

// Entrada U (R2: RC4 directo; R3+: RC4 en cadena sobre MD5(pad+ID) + 16
// al azar al crear, según el Algoritmo 5).
export function entradaU(claveArchivo, id0, rondas = true, cola = null) {
  if (!rondas) return rc4(claveArchivo, RELLENO);
  let u = rc4(claveArchivo, md5(Buffer.concat([RELLENO, id0])));
  for (let i = 1; i < 20; i += 1) u = rc4(xorLlave([...claveArchivo], i), u);
  return Buffer.concat([u.subarray(0, 16), cola || crypto.randomBytes(16)]);
}

// Clave por objeto V2/V4 (RC4 o AESV2 con su sal).
export function claveObjeto(claveArchivo, num, gen, aes = false) {
  const sufijo = Buffer.alloc(5);
  sufijo.writeUIntLE(num & 0xffffff, 0, 3);
  sufijo.writeUIntLE(gen & 0xffff, 3, 2);
  const partes = [claveArchivo, sufijo];
  if (aes) partes.push(Buffer.from([0x73, 0x41, 0x6c, 0x54]));
  const h = md5(Buffer.concat(partes));
  return h.subarray(0, Math.min(16, claveArchivo.length + 5));
}

export function cifrarObjetoV24(claveArchivo, num, gen, datos, aes = false) {
  const k = claveObjeto(claveArchivo, num, gen, aes);
  if (!aes) return rc4(k, datos);
  const iv = crypto.randomBytes(16);
  return Buffer.concat([iv, aesCbcCifrar(k, datos, iv)]);
}

export function descifrarObjetoV24(claveArchivo, num, gen, datos, aes = false) {
  const k = claveObjeto(claveArchivo, num, gen, aes);
  if (!aes) return rc4(k, datos);
  return aesCbcDescifrar(k, datos.subarray(16), datos.subarray(0, 16));
}

// ---- V5R6 (AES-256): autenticación y llaves ----

// ---- V5R6 (AES-256): algoritmo 2.B de ISO 32000-2 (bucle R6, no un
// SHA-256 solo: los lectores reales lo exigen y rechazan lo demás) ----

// Hash R6: SHA-256 inicial y luego 64+ vueltas AES con SHA-256/384/512.
// Las contraseñas se normalizan NFKC (cerca de SASLprep para lo común).
export function hashR6(clave, sal, datos = Buffer.alloc(0)) {
  const pw = Buffer.from(String(clave || "").normalize("NFKC"), "utf8").subarray(0, 127);
  const sal8 = Buffer.from(sal).subarray(0, 8);
  const ud = Buffer.from(datos);
  let k = sha256(Buffer.concat([pw, sal8, ud]));
  const fns = [sha256, sha384, sha512];
  let count = 0;
  for (;;) {
    count += 1;
    const k1 = Buffer.concat([pw, k, ud]);
    const rep = Buffer.alloc(k1.length * 64);
    for (let i = 0; i < 64; i += 1) k1.copy(rep, i * k1.length);
    const e = aesCbcCifrar(k.subarray(0, 16), rep, k.subarray(16, 32), false);
    let suma = 0;
    for (let i = 0; i < 16; i += 1) suma += e[i];
    k = fns[suma % 3](e);
    if (count >= 64 && e[e.length - 1] <= count - 32) break;
    if (count > 2048) throw new Error("hash R6 sin fin");
  }
  return k.subarray(0, 32);
}

export function validarV5({ U, UE, O, OE, claveUsuario = "", claveDuenio = "" }) {
  const CERO = Buffer.alloc(16);
  const VACIO = Buffer.alloc(0);
  if (U?.length === 48 && hashR6(claveUsuario, U.subarray(32, 40), VACIO).equals(U.subarray(0, 32))) {
    return { ok: true, como: "usuario", llave: aesCbcDescifrar(hashR6(claveUsuario, U.subarray(40, 48), VACIO), UE, CERO, false) };
  }
  if (O?.length === 48 && U?.length === 48 && claveDuenio) {
    const u48 = U.subarray(0, 48);
    if (hashR6(claveDuenio, O.subarray(32, 40), u48).equals(O.subarray(0, 32))) {
      return { ok: true, como: "duenio", llave: aesCbcDescifrar(hashR6(claveDuenio, O.subarray(40, 48), u48), OE, CERO, false) };
    }
  }
  return { ok: false };
}

// Par U/OE/UE nuevos para una contraseña (dueño al azar si no se da).
export function crearV5({ usuario, duenio = "" }) {
  const duenioFinal = duenio || crypto.randomBytes(16).toString("hex");
  const VACIO = Buffer.alloc(0);
  const llave = crypto.randomBytes(32);
  const salValU = crypto.randomBytes(8);
  const salKeyU = crypto.randomBytes(8);
  const salValO = crypto.randomBytes(8);
  const salKeyO = crypto.randomBytes(8);
  const U = Buffer.concat([hashR6(usuario, salValU, VACIO), salValU, salKeyU]);
  const UE = aesCbcCifrar(hashR6(usuario, salKeyU, VACIO), llave, Buffer.alloc(16), false);
  const u48 = U.subarray(0, 48);
  const O = Buffer.concat([hashR6(duenioFinal, salValO, u48), salValO, salKeyO]);
  const OE = aesCbcCifrar(hashR6(duenioFinal, salKeyO, u48), llave, Buffer.alloc(16), false);
  return { U, UE, O, OE, llave };
}

export function permisosBytes(P) {
  const b = Buffer.alloc(16);
  b.writeInt32LE(P, 0);
  b.fill(0xff, 4, 8);
  b.write("Tadb", 8, "latin1");
  crypto.randomBytes(4).copy(b, 12);
  return b;
}
