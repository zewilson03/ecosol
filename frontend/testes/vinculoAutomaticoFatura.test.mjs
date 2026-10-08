import assert from "node:assert/strict";
import { unidadeDaFatura } from "../src/admin/vinculoAutomaticoFatura.ts";

const provisoria = {
  id: 12,
  uc: "290318801200",
  cliente_id: null,
  cliente_provisorio_id: 4,
  cliente_nome: "Cliente provisório",
};
const definitiva = {
  id: 13,
  uc: "11785001211",
  cliente_id: 7,
  cliente_provisorio_id: null,
  cliente_nome: "Cliente definitivo",
};
const ucIncorretaDoPdf = {
  id: 14,
  uc: "2026094232190",
  cliente_id: null,
  cliente_provisorio_id: null,
};
const unidades = [provisoria, definitiva, ucIncorretaDoPdf];

assert.equal(
  unidadeDaFatura({ uc: "2.903.188.012-00" }, "", "fatura.pdf", unidades),
  provisoria,
);
assert.equal(
  unidadeDaFatura({ uc: "" }, "2.903.188.012-00", "fatura.pdf", unidades),
  provisoria,
);
assert.equal(
  unidadeDaFatura(
    { uc: "2026094232190" },
    "2.903.188.012-00",
    "2026094232190.pdf",
    unidades,
  ),
  provisoria,
);
assert.equal(
  unidadeDaFatura(
    { uc: "2026092845989" },
    "11785001211",
    "2026092845989.pdf",
    unidades,
  ),
  definitiva,
);
assert.equal(
  unidadeDaFatura({ uc: "999" }, "290318801200", "fatura.pdf", unidades),
  null,
);
assert.equal(
  unidadeDaFatura(
    { uc: "11785001211" },
    "290318801200",
    "fatura.pdf",
    unidades,
  ),
  null,
);
console.log("Vínculo automático por UC: testes concluídos.");
