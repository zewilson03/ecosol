import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function chaveDeCriptografia(valor) {
  if (typeof valor !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(valor))
    throw new Error("Chave de criptografia Gmail inválida.");
  const chave = Buffer.from(valor, "base64");
  if (chave.length !== 32 || chave.toString("base64") !== valor)
    throw new Error("Chave de criptografia Gmail inválida.");
  return chave;
}

export function cifrarRefreshToken(token, contaId, chave) {
  if (typeof token !== "string" || !token || token.length > 4096)
    throw new Error("Refresh token inválido.");
  const nonce = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave, nonce);
  cifra.setAAD(Buffer.from(`ecosol:gmail:${contaId}:v1`));
  const dados = Buffer.concat([cifra.update(token, "utf8"), cifra.final()]);
  return `v1.${nonce.toString("base64url")}.${cifra.getAuthTag().toString("base64url")}.${dados.toString("base64url")}`;
}

export function decifrarRefreshToken(valor, contaId, chave) {
  const partes = String(valor).split(".");
  if (partes.length !== 4 || partes[0] !== "v1")
    throw new Error("Credencial Gmail indisponível.");
  try {
    const nonce = Buffer.from(partes[1], "base64url");
    const tag = Buffer.from(partes[2], "base64url");
    if (nonce.length !== 12 || tag.length !== 16)
      throw new Error("Formato inválido.");
    const cifra = createDecipheriv("aes-256-gcm", chave, nonce);
    cifra.setAAD(Buffer.from(`ecosol:gmail:${contaId}:v1`));
    cifra.setAuthTag(tag);
    return Buffer.concat([
      cifra.update(Buffer.from(partes[3], "base64url")),
      cifra.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Credencial Gmail indisponível.");
  }
}
