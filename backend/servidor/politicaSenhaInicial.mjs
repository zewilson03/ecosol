const valoresInseguros = new Set([
  "adm123",
  "admin",
  "admin123",
  "password",
  "senha",
  "senha123",
  "troque-esta-senha-antes-de-publicar",
]);

export function senhaInicialForte(senha, ambiente = process.env.NODE_ENV) {
  if (typeof senha !== "string") return false;
  const normalizada = senha.trim();
  if (!normalizada || valoresInseguros.has(normalizada.toLowerCase()))
    return false;
  if (ambiente !== "production") return true;
  return (
    normalizada.length >= 12 &&
    /[A-Za-zÀ-ÿ]/.test(normalizada) &&
    /\d/.test(normalizada)
  );
}
