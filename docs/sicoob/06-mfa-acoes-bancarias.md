# MFA para ações bancárias

Status: implementado no Ecosol; requer configuração da chave local e validação assistida no navegador antes de homologação bancária.

## Objetivo e limites

Uma sessão da equipe e a senha, isoladamente, não autorizam alterações de permissões bancárias, preparação ou aprovação de cobranças, controle do executor nem envio à fila. Essas ações exigem uma confirmação recente com senha e TOTP (ou um código de recuperação). A confirmação dura cinco minutos, fica ligada à sessão e deixa de valer quando a senha ou o autenticador muda. O papel bancário continua sendo verificado separadamente pelo servidor.

TOTP segue [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238). O verificador aceita janela de até um passo de 30 segundos em cada direção, registra o último passo aceito para impedir reutilização e limita tentativas por conta. Essa proteção não é resistente a phishing; antes de pagamentos reais, avaliar também uma opção resistente a phishing, como autenticação criptográfica vinculada à origem, conforme o [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html).

## Configuração operacional

1. Gerar uma chave aleatória Base64 de **32 bytes** para `BANCARIO_MFA_ENCRYPTION_KEY` e defini-la somente em `backend/.env.local` ou no gerenciador de segredos do ambiente. Não reutilizar a chave do Gmail.
2. Manter uma cópia segura da chave fora do computador do Ecosol. Uma restauração do banco sem a mesma chave não consegue verificar os autenticadores já cadastrados.
3. Usar HTTPS e `APP_URL` correspondente ao endereço público em produção. Se `APP_URL` for HTTP em produção, as ações bancárias são recusadas.
4. Fazer backup do banco e testar a restauração com a chave preservada antes de liberar operações reais.

Sem chave válida, a ativação do MFA falha de forma segura e as ações bancárias continuam bloqueadas. Nenhum segredo ou código de recuperação deve ser enviado por chat, incluído em logs ou salvo no repositório.

## Fluxo da equipe

1. Na primeira ação bancária, informar a senha da conta nominal da equipe.
2. Adicionar manualmente no aplicativo autenticador a chave exibida pelo Ecosol, sob o nome “Ecosol”. A chave pendente expira em dez minutos e é cifrada no banco.
3. Digitar o código de seis dígitos para concluir a ativação.
4. Guardar, fora do Ecosol, os dez códigos de recuperação apresentados uma única vez. Cada um serve apenas uma vez.
5. Para uma ação bancária, confirmar senha e código atual (ou um código de recuperação). O servidor emite uma prova temporária de cinco minutos vinculada à sessão; cada rota confere também origem e permissão.

O código TOTP usado para ativar o autenticador não pode ser reutilizado na confirmação seguinte: aguarde o próximo código ou use um código de recuperação.

## Perda e troca do autenticador

Quem ainda tem um código de recuperação pode escolher **“Perdi o autenticador — trocar dispositivo”**, confirmar senha e código de recuperação, cadastrar uma nova chave e validá-la. O autenticador antigo permanece ativo durante a configuração. Ao confirmar a troca, o código de recuperação usado e todos os antigos são invalidados; dez novos códigos são exibidos uma vez; provas bancárias emitidas antes da troca deixam de valer.

Se o dispositivo **e todos os códigos de recuperação** forem perdidos, não há redefinição automática nem desativação administrativa de um clique. A conta fica sem poder autorizar ações bancárias. A pessoa solicita a recuperação com a senha da equipe; dois aprovadores nominais e distintos confirmam sua identidade presencialmente, com MFA próprio, e o titular cadastra um novo autenticador. O titular não pode aprovar sua própria recuperação. O pedido expira em 24 horas, é consumido uma única vez e deixa rastro de auditoria.

O perfil especial **Proprietário** foi definido para duas pessoas no máximo, com acesso global às abas e aos papéis bancários. Um **Guardião de recuperação** separado tem apenas o papel excepcional de recuperação. Para uma conta comum, são necessários os dois Proprietários; para recuperar um Proprietário, são necessários o outro Proprietário e o Guardião. Cada aprovador usa sua própria sessão, MFA ativo e confirmação bancária recente. As aprovações são verificadas novamente antes de iniciar e de concluir a troca; a troca revoga os códigos antigos e as confirmações bancárias anteriores. Nenhum aprovador isolado pode desativar o MFA. **Pendente antes de uso operacional:** cadastrar nominalmente o Guardião, testar o fluxo assistido com as pessoas designadas e definir um canal previamente confirmado para notificação do titular. O sistema ainda não envia essa notificação.

O banco local consultado em 19/10/2026 ainda não possui contas nominais para Victor Japiassu, Veygna e Matheus. O perfil Proprietário foi reservado a Victor e Veygna; Matheus foi indicado como Guardião. Nenhum papel crítico foi atribuído enquanto essas contas não existirem e não tiverem suas identidades verificadas.

## Autoaprovação excepcional do Proprietário

Por decisão expressa do responsável pelo projeto, **somente o Proprietário** pode preparar e aprovar a própria operação bancária. Isso reduz a segregação de funções e aumenta o risco de erro ou fraude caso essa conta seja comprometida. A exceção exige MFA, confirmação bancária recente e aceite explícito, fica registrada em tabela e auditoria próprias, e perde validade antes do envio se o perfil Proprietário for revogado. Administrador da integração, Operador financeiro, Aprovador financeiro, Guardião e demais níveis continuam obrigados a usar aprovador distinto. O executor Sicoob continua pausado até a homologação e configuração bancária.

## Proteção resistente a phishing

O TOTP atual continua sendo uma proteção de segundo fator, mas **não é resistente a phishing**. O caminho previsto é adicionar passkeys/WebAuthn com verificação de origem, desafio de uso único e autenticação local do dispositivo, sem substituir a autorização por papel e a segregação entre preparador e aprovador. O domínio HTTPS definitivo do Ecosol ainda não foi escolhido. Uma credencial cadastrada em `localhost` não poderá simplesmente ser transferida para outro domínio; a equipe deverá cadastrar novas credenciais no domínio de produção. Por isso, passkeys e eventual obrigatoriedade para ações bancárias permanecem pendentes de implementação e homologação nesse domínio. Até essa transição, não apresentar o fluxo atual como resistente a phishing.

## Evidências e aceite

- Testes automatizados cobrem vetor público de TOTP, segredo cifrado, ativação, código incorreto, replay, recuperação de uso único, troca, invalidação de prova anterior e sessão expirada.
- Teste assistido no navegador ainda deve confirmar o cadastro em um aplicativo autenticador real, a leitura dos códigos de recuperação e a experiência de troca.
- MFA não substitui segregação entre preparador e aprovador, conciliação, idempotência nem homologação Sicoob.
