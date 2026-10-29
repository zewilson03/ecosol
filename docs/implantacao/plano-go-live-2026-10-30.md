# Plano de entrada em produção — 30/10/2026

## Objetivo

Disponibilizar o Ecosol na internet até sexta-feira, 30/10/2026, com:

1. autenticação da equipe em HTTPS;
2. conferência e aprovação de faturas;
3. emissão controlada de boletos Sicoob;
4. backup externo, restauração e rollback verificados;
5. pagamentos bancários desativados nesta entrada em produção.

O prazo não autoriza emissão real enquanto os portões bancários deste documento
estiverem incompletos. A conferência de faturas pode entrar no ar separadamente,
com o executor bancário desligado.

## Situação observada em 26/10/2026

- Aplicação monolítica Node.js 24, Express, React/Vite e SQLite.
- O frontend é compilado antes da inicialização em produção.
- O banco local principal ocupa aproximadamente 582 MB e o WAL observado,
  aproximadamente 84 MB. PDFs e artefatos bancários são mantidos no SQLite.
- SQLite usa WAL e `busy_timeout`, mas a aplicação não foi desenhada para vários
  processos gravando o mesmo arquivo.
- Sessões, clientes, faturas, PDFs, auditoria e operações bancárias pertencem ao
  mesmo banco.
- OAuth e mTLS do Sicoob já possuem implementação e testes locais.
- O executor iniciado pelo servidor aceita atualmente apenas `desligado` ou
  `simulado`; o modo Sicoob real ainda precisa ser integrado explicitamente.
- O `numeroCliente` oficial do convênio ainda é um portão operacional conhecido.
- Existe um endpoint público mínimo `GET /api/saude`, que verifica somente a
  disponibilidade do processo e do SQLite sem expor diagnóstico sensível.
- O banco e os segredos permanecem locais; ainda não há restauração comprovada
  em servidor independente.

## Verificação local em 28/10/2026

- O modo real `sicoob` do executor já foi implementado com habilitação explícita
  de produção; a fila persistida continua sendo um portão separado. A suíte
  bancária, as suítes de implantação, permissões e faturamento, e o build
  passaram localmente nesta data.
- A configuração local disponível contém somente chaves `SICOOB_HOMOLOGACAO_*`.
  Nenhuma configuração `SICOOB_PRODUCAO_*` foi identificada. Por isso não houve
  tentativa de emissão, pagamento ou consulta bancária ao vivo nesta revisão.
- A presença local de `numeroCliente` não comprova o vínculo entre aplicação,
  beneficiário e convênio, nem a autorização operacional de produção.
- Os scripts Linux de implantação e backup passaram em verificação sintática;
  ainda não foram executados em VPS. A restauração externa, domínio HTTPS,
  monitoramento e teste ponta a ponta continuam sem evidência operacional.
- `GET http://127.0.0.1:3000/api/saude` respondeu HTTP 200 localmente. Isso não
  identifica a versão em execução nem valida login, permissões ou o fluxo em HTTPS.
- O trabalho de cadastro de clientes e usinas está com Matheus em outra frente;
  esta verificação não altera esses módulos nem antecipa a integração de dados.

## Decisão de arquitetura

### Opção recomendada: VPS única no Amazon Lightsail

- Região: América do Sul — São Paulo (`sa-east-1`).
- Instância inicial: Linux, 4 GB RAM, 2 vCPU, 80 GB SSD.
- Uma única instância da aplicação e um único escritor SQLite.
- IP IPv4 estático anexado à instância.
- Caddy como proxy reverso e terminador HTTPS.
- Node.js 24 executado pelo `systemd`, ouvindo somente em `127.0.0.1:3000`.
- Dados fora da pasta de releases, em `/var/lib/ecosol`.
- Segredos fora do Git, em `/etc/ecosol/ecosol.env`, modo `0600`.
- Certificado PFX fora do Git, em `/etc/ecosol/segredos/`, legível somente pelo
  usuário do serviço.
- Réplica contínua do SQLite para armazenamento de objetos externo e snapshots
  automáticos diários da instância.

O plano público de 4 GB/80 GB é anunciado a US$ 24/mês, mas o preço final da
região e impostos deve ser confirmado no checkout. Domínio, armazenamento de
backup e tráfego excedente são custos separados.

### Por que esta opção

- preserva a pilha existente e cabe no prazo;
- mantém persistência, IP de saída estável e controle do PFX/mTLS;
- suporta o volume atual sem uma migração de banco apressada;
- oferece caminho de rollback por release e recuperação por snapshot/backup;
- permite migrar depois para uma arquitetura maior sem alterar agora o domínio.

### Alternativas avaliadas

1. **PaaS com disco persistente:** reduz administração do sistema operacional,
   mas exige conferir IP de saída, montagem do PFX, persistência, backup e regra
   de instância única. A incerteza operacional é maior para o prazo.
2. **Hospedar no computador do escritório:** recusado para produção. Energia,
   internet, IP, atualização, invasão física e backup ficam no mesmo ponto de
   falha.
3. **Migrar já para PostgreSQL:** melhora escalabilidade e alta disponibilidade,
   mas muda persistência, migrações, testes e operação. Não há evidência de que
   esse risco caiba antes de sexta-feira.

## Topologia

```text
Usuário
  │ HTTPS 443
  ▼
DNS ──► IP estático Lightsail
          │
          ▼
        Caddy
          │ HTTP local 127.0.0.1:3000
          ▼
     Ecosol Node.js 24 ──mTLS/OAuth──► Sicoob
          │
          ▼
   /var/lib/ecosol/ecosol.db
          │
          ├── réplica contínua criptografada ──► armazenamento externo
          └── snapshot diário ──► Lightsail
```

Somente 80/443 ficam públicos. SSH deve ser restrito aos IPs administrativos;
a porta 3000 e o SQLite nunca são expostos.

## Separação de ambientes

| Item        | Ensaio                           | Produção                            |
| ----------- | -------------------------------- | ----------------------------------- |
| URL         | subdomínio restrito              | domínio definitivo                  |
| Banco       | cópia descartável ou anonimizada | banco operacional                   |
| Sicoob      | executor desligado/simulado      | executor real, inicialmente pausado |
| Certificado | material de teste quando existir | PFX de produção                     |
| OAuth/Gmail | redirect próprio                 | redirect do domínio definitivo      |
| Segredos    | arquivo exclusivo                | arquivo exclusivo e restrito        |

Nunca compartilhar banco, token, cookie, certificado ou arquivo de ambiente entre
ensaio e produção.

## Portões obrigatórios

### Site e conferência de faturas

- [ ] Domínio ou subdomínio definitivo decidido e sob controle da Ecosol.
- [ ] Conta AWS com cobrança e acesso administrativo nominal.
- [ ] IP estático, DNS, HTTPS e renovação automática comprovados.
- [ ] Build reproduzível com Node.js 24 e dependências travadas.
- [x] A aplicação recusa iniciar com `NODE_ENV=production` sem
      `APP_URL=https://...`; `HOST=127.0.0.1` permanece o padrão.
- [x] Endpoint de saúde sem dados pessoais nem diagnóstico sensível.
- [ ] Banco copiado por mecanismo consistente do SQLite, não por cópia bruta do
      arquivo enquanto estiver escrevendo.
- [ ] Restauração executada em diretório limpo e conferida.
- [ ] Login e permissões de pelo menos dois acessos nominais testados.
- [ ] Upload, conferência, cálculo, aprovação e leitura do PDF testados em HTTPS.
- [ ] Logs, alertas, espaço em disco e reinício automático testados.

### Emissão de boleto

- [ ] `numeroCliente` oficial confirmado pelo Sicoob.
- [ ] Autorização de produção e escopos `boletos_inclusao` e
      `boletos_consulta` ativos para a aplicação.
- [ ] PFX de produção instalado sem entrar no repositório ou no backup comum.
- [x] Modo real do executor implementado, testado localmente e negado por padrão.
- [ ] Executor inicia pausado e exige liberação nominal.
- [ ] OAuth, mTLS e `/health` do Sicoob validados pelo backend de produção.
- [ ] Uma cobrança autorizada é revisada por nome, documento, UC, valor e
      vencimento antes da liberação.
- [ ] Inclusão usa a idempotência persistida; timeout não dispara reenvio.
- [ ] Consulta confirmatória encontra o título e persiste `nossoNumero`, linha,
      código, PDF e estado.
- [ ] Segunda execução da mesma intenção não cria outro boleto.
- [ ] Procedimento de pausa, consulta, cancelamento e incidente está acessível.

Sem qualquer item acima, o site pode operar a conferência, mas o botão de emissão
deve permanecer bloqueado.

## Backup e recuperação

Metas iniciais:

- RPO: até 5 minutos, após validar a réplica contínua;
- RTO: até 2 horas;
- snapshot diário da instância, mantendo os sete automáticos mais recentes;
- backup manual antes de cada implantação e mudança de esquema;
- teste de restauração antes do go-live e depois mensalmente.

A restauração deve comprovar: integridade SQLite, contagem de faturas, leitura de
PDF amostral, usuários, operações bancárias, auditoria e hashes. Snapshot da VPS
não substitui backup lógico/contínuo fora do mesmo ponto de falha.

## Implantação e rollback

Estrutura sugerida:

```text
/opt/ecosol/releases/<commit>/   código e frontend compilado
/opt/ecosol/current              link para o release ativo
/var/lib/ecosol/                 banco e WAL
/etc/ecosol/ecosol.env           configuração e segredos
/etc/ecosol/segredos/            PFX e materiais privados
```

Implantação:

1. registrar o commit aprovado;
2. executar todas as suítes e o build;
3. criar backup consistente e verificar espaço em disco;
4. instalar em novo diretório de release;
5. iniciar contra cópia do banco e executar smoke test;
6. pausar gravações no corte final;
7. trocar o link `current` e reiniciar o serviço;
8. validar saúde, login, faturas e executor pausado;
9. liberar usuários gradualmente.

Rollback de código: voltar o link ao release anterior. Rollback de dados não é
automático porque as migrações atuais são progressivas; se uma mudança de esquema
falhar, parar a aplicação e restaurar o backup pré-implantação. Nunca executar
dois releases simultaneamente sobre o mesmo SQLite.

## Cronograma até sexta-feira

### Segunda, 26/10 — decisão e bloqueadores

- aprovar Lightsail São Paulo e tamanho inicial;
- decidir domínio/subdomínio;
- obter `numeroCliente` e autorização de produção do Sicoob;
- congelar o escopo: faturas + boletos; pagamentos ficam fora;
- implementar saúde, validação de configuração e inventário de segredos;
- definir responsáveis por go/no-go e incidente.

Entregue localmente em 26/10: modelos versionados de `systemd`, Caddy e ambiente,
backup SQLite consistente, validação de release, ativação atômica com rollback de
código e manual operacional. A execução em VPS e o ensaio de restauração continuam
pendentes.

Também foi entregue o encerramento coordenado: saúde indisponível durante a
parada, drenagem HTTP, suspensão e espera de Gmail/executor bancário, checkpoint
do WAL e fechamento do SQLite. O limite interno é menor que o do `systemd`; uma
falha termina com código não zero sem fechar o banco durante trabalho ativo.

### Terça, 27/10 — infraestrutura e recuperação

- criar VPS, usuário de serviço, IP estático e firewall;
- configurar DNS, Caddy, HTTPS, Node 24 e `systemd`;
- preparar diretórios e permissões;
- configurar backup externo e snapshot diário;
- restaurar uma cópia e documentar tempo/evidências.

### Quarta, 28/10 — aplicação e Sicoob

- publicar versão candidata com executor desligado;
- validar login, permissões e fluxo completo de conferência;
- implementar o modo real do executor atrás dos portões de produção;
- validar OAuth/mTLS/saúde e manter a fila pausada;
- ensaiar timeout, duplicidade, reinício e reconciliação sem emitir em massa.

### Quinta, 29/10 — ensaio geral

- migrar uma cópia atualizada do banco e medir o tempo;
- executar regressão completa e smoke test móvel/desktop;
- realizar um único piloto bancário autorizado e consulta confirmatória;
- testar restauração e rollback do release;
- corrigir somente bloqueadores e congelar a versão candidata.

### Sexta, 30/10 — corte controlado

- backup final e pausa de gravações locais;
- copiar o banco consistentemente e validar hashes/integridade;
- apontar DNS e iniciar produção;
- validar HTTPS, login, faturas, PDFs, auditoria e backup;
- liberar conferência primeiro;
- liberar emissão somente após todos os portões bancários;
- observar erros, disco, memória e fila durante o período assistido.

## Go/no-go de sexta-feira

**GO para conferência:** HTTPS, autenticação, permissões, banco, PDFs, backup,
restauração, monitoramento e rollback aprovados.

**GO para boletos:** todos os itens anteriores mais contrato Sicoob completo,
executor real, piloto único confirmado por consulta e idempotência demonstrada.

**NO-GO para boletos:** ausência de `numeroCliente`, dúvida de ambiente/escopo,
falha de mTLS/OAuth, resultado inconclusivo sem consulta, backup não restaurável,
executor não pausável ou divergência entre valor local e bancário.

## Decisões ainda necessárias do responsável

1. domínio/subdomínio definitivo;
2. criação e custódia da conta AWS da empresa;
3. responsável nominal pelo go/no-go;
4. responsável nominal pelos alertas e incidentes;
5. confirmação do `numeroCliente` e autorização de produção pelo Sicoob;
6. cliente/cobrança autorizada para o único piloto real;
7. janela de indisponibilidade para a cópia final do banco.
