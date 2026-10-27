import assert from "node:assert/strict";
import { senhaInicialForte } from "../servidor/politicaSenhaInicial.mjs";

for (const senha of [
  undefined,
  "",
  "ADM123",
  "admin123",
  "troque-esta-senha-antes-de-publicar",
  "somente letras longas",
  "Curta123",
]) {
  assert.equal(senhaInicialForte(senha, "production"), false, String(senha));
}

assert.equal(senhaInicialForte("Frase temporaria 4821", "production"), true);
assert.equal(senhaInicialForte("local", "development"), true);

console.log("OK: senha inicial insegura é rejeitada em produção.");
