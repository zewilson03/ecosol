import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const passoMs = 30_000;

function chaveMfa() {
  const valor = process.env.BANCARIO_MFA_ENCRYPTION_KEY;
  if (typeof valor !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(valor))
    throw new Error("Chave de MFA bancário não configurada.");
  const chave = Buffer.from(valor, "base64");
  if (chave.length !== 32 || chave.toString("base64") !== valor)
    throw new Error("Chave de MFA bancário inválida.");
  return chave;
}

export function gerarSegredoTotp() {
  const bytes = randomBytes(20);
  let bits = 0;
  let valor = 0;
  let resultado = "";
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      resultado += alfabeto[(valor >>> (bits -= 5)) & 31];
    }
  }
  if (bits) resultado += alfabeto[(valor << (5 - bits)) & 31];
  return resultado;
}

function decodificarBase32(segredo) {
  if (typeof segredo !== "string" || !/^[A-Z2-7]{32}$/.test(segredo))
    throw new Error("Segredo TOTP inválido.");
  let bits = 0;
  let valor = 0;
  const bytes = [];
  for (const caractere of segredo) {
    valor = (valor << 5) | alfabeto.indexOf(caractere);
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits -= 8)) & 255);
    }
  }
  return Buffer.from(bytes);
}

export function codigoTotp(segredo, contador, digitos = 6) {
  if (!Number.isSafeInteger(contador) || contador < 0)
    throw new Error("Contador TOTP inválido.");
  const mensagem = Buffer.alloc(8);
  mensagem.writeBigUInt64BE(BigInt(contador));
  const assinatura = createHmac("sha1", decodificarBase32(segredo))
    .update(mensagem)
    .digest();
  const deslocamento = assinatura[assinatura.length - 1] & 15;
  const numero =
    (assinatura.readUInt32BE(deslocamento) & 0x7fffffff) % 10 ** digitos;
  return String(numero).padStart(digitos, "0");
}

export function verificarTotp(
  segredo,
  codigo,
  ultimoContador = -1,
  agora = Date.now(),
) {
  if (typeof codigo !== "string" || !/^\d{6}$/.test(codigo)) return null;
  const atual = Math.floor(agora / passoMs);
  for (const contador of [atual - 1, atual, atual + 1]) {
    if (contador <= ultimoContador || contador < 0) continue;
    const esperado = Buffer.from(codigoTotp(segredo, contador));
    if (timingSafeEqual(Buffer.from(codigo), esperado)) return contador;
  }
  return null;
}

export function cifrarSegredoTotp(segredo, staffId) {
  decodificarBase32(segredo);
  const nonce = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chaveMfa(), nonce);
  cifra.setAAD(Buffer.from(`ecosol:bancario:mfa:${staffId}:v1`));
  const dados = Buffer.concat([cifra.update(segredo, "utf8"), cifra.final()]);
  return `v1.${nonce.toString("base64url")}.${cifra.getAuthTag().toString("base64url")}.${dados.toString("base64url")}`;
}

export function decifrarSegredoTotp(valor, staffId) {
  const partes = String(valor).split(".");
  if (partes.length !== 4 || partes[0] !== "v1")
    throw new Error("Segredo MFA indisponível.");
  try {
    const nonce = Buffer.from(partes[1], "base64url");
    const tag = Buffer.from(partes[2], "base64url");
    if (nonce.length !== 12 || tag.length !== 16)
      throw new Error("Formato inválido.");
    const cifra = createDecipheriv("aes-256-gcm", chaveMfa(), nonce);
    cifra.setAAD(Buffer.from(`ecosol:bancario:mfa:${staffId}:v1`));
    cifra.setAuthTag(tag);
    const segredo = Buffer.concat([
      cifra.update(Buffer.from(partes[3], "base64url")),
      cifra.final(),
    ]).toString("utf8");
    decodificarBase32(segredo);
    return segredo;
  } catch {
    throw new Error("Segredo MFA indisponível.");
  }
}
