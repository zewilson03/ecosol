const formatoDeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarContatoCliente(emailInformado, telefoneInformado) {
  if (
    (emailInformado != null && typeof emailInformado !== "string") ||
    (telefoneInformado != null && typeof telefoneInformado !== "string")
  )
    return null;
  const email = String(emailInformado ?? "")
    .trim()
    .toLowerCase();
  const telefoneTexto = String(telefoneInformado ?? "").trim();
  if (email.length > 180 || (email && !formatoDeEmail.test(email))) return null;
  if (
    telefoneTexto.length > 30 ||
    (telefoneTexto && !/^[+\d().\s-]+$/.test(telefoneTexto))
  )
    return null;
  let telefone = telefoneTexto.replace(/\D/g, "");
  if (telefone.startsWith("55") && [12, 13].includes(telefone.length))
    telefone = telefone.slice(2);
  if (telefoneTexto && ![10, 11].includes(telefone.length)) return null;
  if (telefone && (telefone.startsWith("0") || /^(\d)\1+$/.test(telefone)))
    return null;
  if (!email && !telefone) return null;
  return { email, phone: telefone };
}
