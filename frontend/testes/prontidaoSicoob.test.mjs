import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  estadoDaProntidao,
  nomeDaPendenciaSicoob,
} from "../src/admin/prontidaoSicoobApresentacao.ts";

assert.deepEqual(
  estadoDaProntidao({
    configuracaoConsultaCompleta: false,
    configuracaoEmissaoCompleta: false,
    executorRealDisponivel: false,
    executorPausado: true,
    producaoHabilitada: false,
  }),
  { rotulo: "Configuração incompleta", nivel: "bloqueado" },
);
assert.deepEqual(
  estadoDaProntidao({
    configuracaoConsultaCompleta: true,
    configuracaoEmissaoCompleta: false,
    executorRealDisponivel: false,
    executorPausado: true,
    producaoHabilitada: false,
  }),
  { rotulo: "Somente consulta", nivel: "atencao" },
);
assert.deepEqual(
  estadoDaProntidao({
    configuracaoConsultaCompleta: true,
    configuracaoEmissaoCompleta: true,
    executorRealDisponivel: false,
    executorPausado: true,
    producaoHabilitada: false,
  }),
  { rotulo: "Executor real indisponível", nivel: "atencao" },
);
assert.deepEqual(
  estadoDaProntidao({
    configuracaoConsultaCompleta: true,
    configuracaoEmissaoCompleta: true,
    executorRealDisponivel: true,
    executorPausado: false,
    producaoHabilitada: false,
  }),
  { rotulo: "Pronto para homologação", nivel: "pronto" },
);
assert.equal(
  nomeDaPendenciaSicoob("MTLS_INCOMPLETO"),
  "Certificado mTLS ou chave privada ausente",
);
assert.equal(
  nomeDaPendenciaSicoob("CODIGO_DESCONHECIDO"),
  "Pendência não reconhecida",
);

const componente = readFileSync(
  new URL("../src/admin/ProntidaoSicoob.tsx", import.meta.url),
  "utf8",
);
assert.match(componente, /\/api\/admin\/bancario\/prontidao/);
assert.match(componente, /Produção permanece bloqueada/);
assert.match(componente, /valores e segredos nunca são exibidos/);
assert.doesNotMatch(componente, /method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
assert.doesNotMatch(
  componente,
  /client_secret|private_key|passphrase|numeroCliente/,
);

console.log("Prontidão visual Sicoob: portões e privacidade validados.");
