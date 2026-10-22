# Pendências de formatação

Levantamento realizado em 22/10/2026 com `npm.cmd run format:check`.

## Orientação

Estes arquivos já estavam fora do padrão do Prettier e não foram alterados durante a integração Sicoob para evitar diffs extensos e conflitos com o trabalho em andamento. A regularização deve ser feita posteriormente em um commit exclusivo de formatação, depois de sincronizar as branches ativas.

## Arquivos pendentes

### Frontend

- `frontend/src/admin/Clientes.tsx`
- `frontend/src/admin/DemonstrativoCalculo.tsx`
- `frontend/src/admin/estilosAdministrativos.css`
- `frontend/src/admin/Faturas.tsx`
- `frontend/src/admin/Gmail.tsx`
- `frontend/src/admin/LotesFaturamento.tsx`
- `frontend/src/admin/PreparacaoFaturas.tsx`
- `frontend/src/admin/prontidaoFatura.ts`
- `frontend/src/admin/tiposFaturamento.ts`
- `frontend/src/admin/Usinas.tsx`
- `frontend/testes/calculos.test.mjs`

### Backend — faturamento e Gmail

- `backend/servidor/faturamento/esquema.mjs`
- `backend/servidor/faturamento/extracao.mjs`
- `backend/servidor/faturamento/lotes.mjs`
- `backend/servidor/faturamento/normalizacaoFinanceira.mjs`
- `backend/servidor/faturamento/planilhas.mjs`
- `backend/servidor/faturamento/preenchimentoPorGeradora.mjs`
- `backend/servidor/faturamento/reanalisar.mjs`
- `backend/servidor/faturamento/receberPdf.mjs`
- `backend/servidor/faturamento/regras.mjs`
- `backend/servidor/faturamento/rotas.mjs`
- `backend/servidor/faturamento/rotasPlanilhas.mjs`
- `backend/servidor/faturamento/rotasTransferenciasUsinas.mjs`
- `backend/servidor/faturamento/vinculosUsinas.mjs`
- `backend/servidor/gmail/esquema.mjs`
- `backend/servidor/gmail/google.mjs`
- `backend/servidor/gmail/receberAnexo.mjs`
- `backend/servidor/gmail/repositorio.mjs`
- `backend/servidor/gmail/rotas.mjs`
- `backend/servidor/gmail/sincronizar.mjs`

### Backend — Sicoob

- `backend/servidor/bancario/contratoOAuthSicoob.mjs`
- `backend/servidor/bancario/mapeamentoCobrancaSicoob.mjs`

### Testes

- `backend/testes/equivalenciaCentral.test.mjs`
- `backend/testes/faturamento.test.mjs`
- `backend/testes/gmailAceiteProcessos.test.mjs`
- `backend/testes/gmailCaptura.test.mjs`
- `backend/testes/gmailPeriodo.test.mjs`
- `backend/testes/gmailTriagem.test.mjs`
- `backend/testes/lotesFaturamento.test.mjs`
- `backend/testes/normalizacaoFinanceira.test.mjs`
- `backend/testes/planilhas.test.mjs`
- `backend/testes/referenciasCentral.mjs`
- `backend/testes/saidasCarteira.test.mjs`
- `backend/testes/transferenciasUsinas.test.mjs`

### Documentação de contratos

- `docs/contratos/analise-minutas-e-arquitetura.md`
- `docs/contratos/backlog.md`
- `docs/contratos/checklist-aceite-camada-1.md`
- `docs/contratos/matriz-decisoes-camada-1.md`
- `docs/contratos/processo-01-modelos.md`
- `docs/contratos/prototipo.html`
- `docs/contratos/README.md`
- `docs/contratos/registro-fontes.md`
- `docs/contratos/validacao.md`

## Critérios para regularização futura

1. Atualizar as branches e confirmar que não existem mudanças concorrentes nos arquivos.
2. Executar o Prettier somente sobre esta lista.
3. Confirmar que o diff contém apenas alterações de estilo.
4. Executar os testes de faturamento, Gmail, planilhas, cálculos e bancários.
5. Executar o build e novamente `npm.cmd run format:check`.
6. Registrar tudo em um commit exclusivo, sem misturar mudanças funcionais.
