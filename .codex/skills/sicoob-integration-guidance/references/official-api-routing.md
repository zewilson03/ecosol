# Roteamento das APIs oficiais

## Prioridade Ecosol

1. Cobrança: registrar, consultar, obter artefatos, cancelar e conciliar.
2. Recebimentos: identificar liquidação e reconciliar extrato.
3. Pagamentos: cadastrar, aprovar, executar, consultar, cancelar e reconciliar.
4. Relatórios e extratos bancários.
5. Pix Cobrança, Pix pagamento e devoluções.

## Verificação obrigatória

Para cada operação registre produto/API, versão, ambiente, URL-base, método, caminho, campos obrigatórios, escopos, mTLS, limites, idempotência documentada, códigos HTTP, códigos de negócio, consulta de recuperação e data da fonte.

Use somente documentação oficial do Sicoob ou contrato fornecido formalmente pela instituição. Se a documentação autenticada não estiver acessível, marque a conclusão como pendente. Não copie manuais inteiros; registre apenas decisões verificáveis e o vínculo para a fonte.

O contrato interno do Ecosol deve isolar nomes e formatos do provedor. Mudança de versão externa não deve alterar diretamente telas, faturamento ou cadastro de clientes.
