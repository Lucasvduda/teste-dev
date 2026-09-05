# Teste Técnico - Desenvolvedor

## O problema

Você precisa criar uma API que consulta CEP. Simples, certo?

Só que: você não controla as APIs externas. Elas caem, demoram, retornam erro. Seu serviço precisa continuar funcionando.

## APIs disponíveis

- ViaCEP: `https://viacep.com.br/ws/{cep}/json/`
- BrasilAPI: `https://brasilapi.com.br/api/cep/v1/{cep}`

## Requisitos

### Endpoint
`GET /cep/{cep}`

### Comportamento esperado
- Alterna entre as duas APIs (pode ser aleatório ou round-robin)
- Se uma falhar, tenta a outra automaticamente
- Retorna um contrato único, independente de qual API respondeu

### O que queremos ver

1. **Abstração** — Como você isola os providers externos? Se amanhã adicionarmos uma terceira API, o que muda no código?

2. **Resiliência** — O que acontece quando uma API demora 30 segundos? E quando as duas estão fora?

3. **Observabilidade** — Se der erro em produção, como a gente descobre o que aconteceu?

4. **Tratamento de erros** — Erros diferentes devem ter tratamentos diferentes. Timeout não é a mesma coisa que 404.

## Stack

NestJS + TypeScript. Fora isso, use o que fizer sentido.

## O que não estamos avaliando

- Frontend
- Banco de dados
- Deploy
- Cobertura de testes de 100%

## Como entregar

Fork este repositório, implemente. Retorne ao e-mail em que você recebeu o teste e encaminhe seu resultado por lá com o assunto **Teste Dev - Monest**.

---

# Solução

## Como rodar

```bash
npm install
npm run start:dev      # http://localhost:3000
```

```bash
curl http://localhost:3000/cep/01001000
curl http://localhost:3000/health
```

Não precisa de `.env` para rodar (todo valor tem default sensato); `.env.example` documenta o que pode ser ajustado (timeout, thresholds do circuit breaker, URLs base dos providers).

## Como testar

```bash
npm run build      # compila TS sem erros (tsc --strict)
npm run test        # 72 testes unitários (providers, service, pipe, rotator, circuit breaker, logger, filas, repositorios, webhook, backoff...)
npm run test:e2e    # 14 testes ponta-a-ponta via supertest (HTTP mockado, sem chamada de rede real)
```

Todos os testes (unitários + e2e) e o build foram executados com sucesso durante o desenvolvimento. Os testes automatizados **nunca** chamam ViaCEP/BrasilAPI de verdade (determinismo/CI); a integração real foi validada manualmente:

```
GET /cep/01001-000 -> 200 { cep, street, neighborhood, city, state: "SP", source: "viacep",    requestId }
GET /cep/30130010  -> 200 { ...                                          source: "brasil-api", requestId }
GET /cep/abc        -> 400 { error: "INVALID_CEP_FORMAT" }   (nenhum provider é chamado)
GET /cep/00000-000  -> 404 { error: "CEP_NOT_FOUND" }         (os dois providers concordaram)
```

## Stack da vaga x o que foi implementado

A vaga (Monest, time de Integrações) pede `NestJS, BullMQ (ou Kafka, RabbitMQ e/ou SQS), MySQL, DynamoDB e AWS`, além de "filas e processamento assíncrono" e "consumir/integrar APIs de parceiros". Mapeamento honesto:

| Pedido na vaga | Status neste projeto |
|---|---|
| NestJS + TypeScript | ✅ Todo o projeto (`GET /cep/{cep}` + extra) |
| Consumir/integrar APIs de parceiros | ✅ ViaCEP + BrasilAPI, com abstração (`CepProvider`), failover e circuit breaker |
| Filas / processamento assíncrono | ✅ `POST /webhooks/cep-batch` (202 + processamento fora do request) |
| BullMQ | ✅ Driver real (`BullMqQueueDriver`, lib `bullmq` de verdade) - **opcional**, `QUEUE_DRIVER=bullmq`; testado com Redis **mockado** (sem Redis de verdade disponível aqui, ver seção "Drivers reais") |
| MySQL | ✅ Driver real (`MySqlBatchJobRepository`, lib `mysql2` de verdade) - **opcional**, `DB_DRIVER=mysql`; testado com Pool **mockado** (sem MySQL de verdade disponível aqui) |
| DynamoDB / AWS | ❌ Não implementado (ver "Próximos passos" abaixo) |
| Idempotência, retry+backoff, dead letter | ✅ (não pedido no enunciado do teste, adicionado por reforçar o dia a dia da vaga) |

**Por que os drivers reais são opcionais, não o default:** o enunciado do teste diz explicitamente que banco de dados e deploy não são avaliados - deixar Redis/MySQL como obrigatórios pra rodar o projeto seria pior, não melhor, pra quem for avaliar sem essa infra. O padrão (`memory`) sempre roda com `npm install && npm start`; os drivers reais existem, compilam, têm teste próprio e são plugáveis por `.env`, mas não são exigidos pra ver o resto funcionando.

**Próximos passos (se a vaga pedir na prática):** um driver DynamoDB seguiria o mesmo padrão de `MySqlBatchJobRepository` (implementar `BatchJobRepositoryPort` com `@aws-sdk/client-dynamodb`), e AWS entraria naturalmente no lugar do MySQL/BullMQ locais (RDS MySQL, ElastiCache/MemoryDB pro Redis do BullMQ, ou SQS no lugar do BullMQ).

## Arquitetura, em 1 minuto

```
Controller (:cep) --Pipe--> valida formato, falha rápido em 400
      |
      v
 CepService.lookup(cep, requestId)
      |  1. pega a ordem de tentativa do ProviderRotator (round-robin)
      |  2. tenta cada provider da lista, em ordem
      v
 CircuitBreakerProvider (decorator) --> ViaCepProvider   \  implementam a mesma
 CircuitBreakerProvider (decorator) --> BrasilApiProvider /  interface CepProvider
      |
      v
 AllExceptionsFilter --> resposta HTTP padronizada { statusCode, error, message, requestId, path, timestamp }
```

### 1. Abstração — isolando os providers externos

Todo provider implementa uma interface única (`src/cep/providers/cep-provider.interface.ts`):

```ts
interface CepProvider {
  readonly name: string;
  lookup(cep: string): Promise<CepLookupResult>; // já no contrato unificado
}
```

`ViaCepProvider` e `BrasilApiProvider` (cada um no seu arquivo) são os únicos lugares que sabem o formato de resposta de cada API, e as peculiaridades de cada uma:

- **ViaCEP** responde `HTTP 200` com corpo `{ erro: true }` quando o CEP não existe (não usa 404 pra isso).
- **BrasilAPI** responde `HTTP 404` de verdade.

Essas diferenças morrem dentro do provider: pra fora, os dois só produzem `CepLookupResult` (sucesso) ou um erro tipado (`ProviderNotFoundError` / `ProviderTimeoutError` / `ProviderHttpError`). O `CepService` nunca sabe qual API respondeu, nem como ela sinaliza erro.

**Se adicionarmos uma terceira API amanhã:** cria-se `NovoProvider implements CepProvider` (um arquivo novo, seguindo o padrão do `ViaCepProvider`) e acrescenta-se **uma linha** na factory de `CEP_PROVIDERS` em `src/cep/cep.module.ts`. Não muda nada em `CepService`, `CepController`, nas exceptions HTTP, no rotator ou no circuit breaker — é o ponto principal de todo esse desenho.

```ts
// cep.module.ts — o único lugar que precisa saber quantos providers existem
return [
  new CircuitBreakerProvider(viaCep, new CircuitBreaker(breakerOptions)),
  new CircuitBreakerProvider(brasilApi, new CircuitBreaker(breakerOptions)),
  new CircuitBreakerProvider(novoProvider, new CircuitBreaker(breakerOptions)), // <- só isso
];
```

### 2. Resiliência — "e se uma API demorar 30s? E se as duas caírem?"

**Timeout:** cada chamada a um provider tem um timeout próprio (`PROVIDER_TIMEOUT_MS`, default **5000ms**). Não esperamos os 30 segundos do enunciado de propósito: se deixássemos, o pior caso (as duas lentas) faria nosso próprio serviço demorar até 1 minuto pra responder, o que degradaria nosso SLA tanto quanto o problema original. Ao cortar em 5s por provider, o pior caso fica em ~10s antes de decidirmos que "os dois estão fora" — ainda ruim, mas com teto conhecido e configurável via `.env`.

**Failover automático:** se um provider falha (timeout, 5xx, erro de rede, circuito aberto), o `CepService` tenta o próximo da lista **na mesma requisição**, sem o cliente precisar tentar de novo.

**Alternância (round-robin):** `ProviderRotator` guarda um índice e, a cada chamada, começa por um provider diferente do anterior (`ViaCEP -> BrasilAPI -> ViaCEP -> ...`). Isso distribui carga entre os dois em vez de martelar sempre o mesmo primeiro, e ainda satisfaz o "alterna entre as duas" do enunciado enquanto o failover garante o "se uma falhar, tenta a outra".

**Circuit breaker por provider** (`src/common/circuit-breaker/circuit-breaker.ts`, aplicado via decorator em `CircuitBreakerProvider`): depois de `CIRCUIT_BREAKER_FAILURE_THRESHOLD` falhas técnicas consecutivas (default 3) de um provider, ele fica "aberto" por `CIRCUIT_BREAKER_COOLDOWN_MS` (default 30s) — durante esse tempo nem tentamos chamá-lo, falhamos rápido e vamos direto pro próximo. Isso responde à pergunta "e quando as duas estão fora": em vez de cada requisição pagar o timeout completo dos dois providers pra sempre, depois de poucas tentativas o serviço aprende que estão fora e responde rápido (ainda como erro, mas sem desperdiçar segundos). Um sucesso fecha o circuito de novo (padrão CLOSED → OPEN → HALF_OPEN → CLOSED, testado em `circuit-breaker.spec.ts`).

Importante: um provider responder "não encontrado" **não** conta como falha pro circuit breaker — ele respondeu certinho, só não tinha aquele CEP. Só falha técnica (timeout/5xx/rede) conta.

### 3. Observabilidade — "se der erro em produção, como a gente descobre o que aconteceu?"

- **Logs 100% estruturados em JSON** (`AppLogger`, plugado via `app.useLogger()` em `main.ts`): toda linha de log é um objeto JSON com `timestamp`, `level`, `context`, `message` — pronto pra ir num agregador (CloudWatch, Datadog, ELK) e ser filtrado por campo.
- **Correlation id (`requestId`)** em toda requisição (`requestIdMiddleware`): usa o `x-request-id` do cliente se vier, senão gera um novo (`crypto.randomUUID()`), devolve no header de resposta **e** no corpo da resposta de sucesso/erro. Todo log da requisição — inclusive de cada tentativa de provider — carrega esse mesmo id, permitindo reconstruir a linha do tempo completa de uma requisição específica.
- **Eventos de domínio logados em cada etapa** (`CepService.logEvent`): `provider_success`, `provider_not_found`, `provider_failed` (com `reason`, `durationMs`, `providerName`), `cep_not_found`, `all_providers_unavailable`. Dá pra responder "qual provider estava lento", "quantas vezes caímos pro fallback", "quando o circuito abriu" só olhando os logs.
- **Filtro global de exceções** (`AllExceptionsFilter`): toda resposta de erro sai no mesmo formato (`statusCode`, `error`, `message`, `requestId`, `path`, `timestamp`), e é logada com `warn` (4xx, erro esperado do cliente) ou `error` (5xx, algo real quebrou) — separando ruído de incidente real.
- **`GET /health`**: endpoint simples de liveness, hábito padrão de observabilidade mesmo não sendo exigido.

### 4. Tratamento de erros — timeout ≠ 404 ≠ 503

| Situação | Exceção interna | HTTP | Código (`error`) |
|---|---|---|---|
| CEP com formato inválido (não é 8 dígitos) | `InvalidCepFormatException` | 400 | `INVALID_CEP_FORMAT` |
| Todos os providers tentados dizem, com confiança, que o CEP não existe | `CepNotFoundException` | 404 | `CEP_NOT_FOUND` |
| Provider demorou mais que `PROVIDER_TIMEOUT_MS` | `ProviderTimeoutError` (interno) → aciona failover | — | — |
| Provider respondeu 5xx / erro de rede / circuito aberto | `ProviderHttpError` / `ProviderCircuitOpenError` (interno) → aciona failover | — | — |
| Depois do failover, nenhum provider confirmou "não existe" nem teve sucesso (só falha técnica, ou mistura de não-encontrado + falha técnica) | `AllProvidersUnavailableException` | 503 | `ALL_PROVIDERS_UNAVAILABLE` |

Ponto de design que vale destacar: se **um** provider diz "não encontrado" e o **outro** falha tecnicamente (timeout/5xx), a resposta é **503**, não 404. Só confiamos num 404 quando conseguimos uma confirmação real de todos os providers consultados — do contrário, o provider que falhou poderia ter encontrado o CEP, e devolver 404 seria uma informação incorreta pro cliente. Fica testado explicitamente em `cep.service.spec.ts`.

## Estrutura de pastas

```
src/
  common/
    circuit-breaker/     # CircuitBreaker (state machine, sem I/O, 100% testável)
    logger/               # AppLogger (logs estruturados em JSON)
    middleware/           # requestIdMiddleware (correlation id)
    filters/               # AllExceptionsFilter (resposta de erro padronizada)
  cep/
    providers/             # CepProvider (interface), ViaCepProvider, BrasilApiProvider,
                           # CircuitBreakerProvider (decorator), erros tipados
    pipes/                 # CepFormatPipe (validação/normalização de :cep)
    utils/                 # ProviderRotator (round-robin)
    errors/                # Exceptions HTTP (400/404/503)
    dto/                    # Contrato único de resposta
    cep.service.ts          # Orquestração: rotação + failover + classificação de erro
    cep.controller.ts
    cep.module.ts            # Único lugar que registra quais providers existem
  webhook/                  # extra: batch assincrono + webhook (ver secao dedicada abaixo)
  health/
  app.module.ts
  main.ts
test/
  cep.e2e-spec.ts           # HTTP mockado, aplicação completa via supertest
  webhook.e2e-spec.ts       # idem, para o fluxo de batch/webhook
```

> Nota sobre o build: `tsconfig.json` usa `rootDir: "./"` (inclui `src/` e
> `test/`), então o `tsc` gera `dist/src/**` (não `dist/**`) - é por isso
> que `npm start` roda `node dist/src/main.js`, não `node dist/main.js`.

## O que ficou fora de propósito

Frontend, banco de dados e deploy (conforme o enunciado). Também não há retry com backoff dentro do mesmo provider (ex.: tentar a ViaCEP 3x antes de desistir dela): o failover pro outro provider já cobre esse caso de forma mais rápida pro usuário, e retry-com-backoff-por-provider seria um próximo passo natural se quiséssemos mais uma camada de resiliência (documentado aqui como decisão consciente, não esquecimento).

---

## Extra: consulta em lote assíncrona com webhook (fila, idempotência, retry+backoff, dead letter)

O enunciado pede só o `GET /cep/{cep}` síncrono acima, que funciona sozinho e cobre 100% do que foi pedido. Como a vaga da Monest (time de Integrações) cita explicitamente **filas, processamento assíncrono e webhooks** como parte do dia a dia, adicionei um segundo módulo, independente do primeiro, pra demonstrar esses padrões na prática - sem tocar em nada do `CepModule`.

### `POST /webhooks/cep-batch`

```json
{
  "idempotencyKey": "meu-lote-2026-09-05-01",
  "ceps": ["01001000", "30130-010", "abc", "00000000"],
  "webhookUrl": "https://cliente.example.com/callback"
}
```

- **202 Accepted** imediato: `{ jobId, status: "pending", idempotent: false, requestId }`. O processamento roda depois, fora do ciclo request/response, numa fila (`QueueDriver` - em memória por padrão, ou **BullMQ + Redis real** via `QUEUE_DRIVER=bullmq`, ver seção "Drivers reais" abaixo).
- **Idempotência:** reenviar a **mesma** `idempotencyKey` não cria um job novo nem reprocessa - devolve **200** com o job já existente (`idempotent: true`), igual ao padrão usado por APIs de pagamento (Stripe etc). Testado em `webhook.service.spec.ts` e `webhook.e2e-spec.ts`.
- **Reaproveita o `CepService`:** cada CEP do lote passa pelo mesmo motor de abstração/failover/circuit breaker do endpoint síncrono. Um CEP inválido ou não encontrado dentro do lote só marca aquele item como `ok: false` - não derruba o job inteiro (sucesso parcial).
- **Retry com backoff exponencial na entrega do webhook:** se o `webhookUrl` do cliente falhar (rede, timeout, 5xx), tenta de novo em 1s, 2s, 4s, 8s... (`WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_BACKOFF_BASE_MS`). Backoff testado isoladamente em `backoff.spec.ts` e `webhook-delivery.service.spec.ts`.
- **Dead letter:** se todas as tentativas de entrega se esgotarem, o job vira `status: "dead_letter"` (não se perde) e passa a aparecer em `GET /webhooks/cep-batch/dead-letter` - visibilidade operacional pra reprocessar manualmente depois.

### Outras rotas

```
GET /webhooks/cep-batch/:id            -> status + resultados do job
GET /webhooks/cep-batch/dead-letter    -> jobs que esgotaram as tentativas de entrega
```

### Validado de ponta a ponta com infraestrutura real (não só mock)

Além dos testes automatizados (`webhook.e2e-spec.ts`, HTTP mockado), rodei manualmente com o servidor real + um receptor de webhook HTTP real em `localhost:4000`:

```
POST /webhooks/cep-batch { ceps: ["01001-000", "30130010", "abc", "00000000"], webhookUrl: "http://localhost:4000/hook" }
  -> 202 { status: "pending" }
  -> (assincrono) status vira "delivered"; o receptor local recebeu o POST com os 4 resultados
       (2 sucesso - um via ViaCEP, um via BrasilAPI -, 1 INVALID_CEP_FORMAT, 1 CEP_NOT_FOUND)

Reenvio da mesma idempotencyKey -> 200 { idempotent: true }, nenhum provider foi chamado de novo

POST .../cep-batch com webhookUrl apontando pra uma porta sem ningum escutando
  -> 5 tentativas de entrega (ECONNREFUSED), backoff 1s/2s/4s/8s (~15s no total)
  -> status final: "dead_letter", visivel em GET /webhooks/cep-batch/dead-letter
```

### Arquivos

```
src/webhook/
  dto/create-batch-webhook.dto.ts          # validacao (class-validator): idempotencyKey, ceps[], webhookUrl
  entities/batch-job.entity.ts
  repository/
    batch-job-repository.interface.ts       # contrato (BatchJobRepositoryPort) + token BATCH_JOB_REPOSITORY
    in-memory-batch-job.repository.ts        # driver default: Map em memoria, zero infra
    mysql-batch-job.repository.ts            # driver real: MySQL (mysql2), colunas JSON p/ ceps/results
    mysql-pool.factory.ts                    # cria o Pool mysql2 (lazy - so conecta no 1o uso)
    schema.sql                                # CREATE TABLE de referencia p/ o driver mysql
  delivery/
    backoff.ts                                # calculo puro do backoff exponencial
    sleep.token.ts                             # sleep injetavel (testes nao esperam tempo real)
    webhook-delivery.service.ts                 # retry + backoff na entrega do webhook do cliente
  webhook.service.ts                              # fila + idempotencia + reuso do CepService + dead-letter
  webhook.controller.ts
  webhook.module.ts                                # factories QUEUE_DRIVER e BATCH_JOB_REPOSITORY (ver abaixo)
src/common/queue/
  queue-driver.interface.ts     # contrato (QueueDriver: registerProcessor + enqueue) + token QUEUE_DRIVER
  in-memory-queue.driver.ts     # driver default: fila em processo, concorrencia 1, zero infra
  bullmq-queue.driver.ts        # driver real: BullMQ + Redis (ioredis), Queue + Worker de verdade
```

### Drivers reais: BullMQ (fila) e MySQL (persistência) - a stack que a vaga pede

A vaga cita explicitamente `NestJS, BullMQ (ou Kafka, RabbitMQ e/ou SQS), MySQL, DynamoDB e AWS`. Além da versão em memória (que garante que o projeto roda com `npm install && npm run start:dev`, sem exigir nenhuma infra pra ser avaliado), implementei os drivers **reais** de BullMQ e MySQL, seguindo o mesmo princípio de abstração do `CepProvider`: uma interface (`QueueDriver` / `BatchJobRepositoryPort`), duas implementações, e uma factory em `webhook.module.ts` que escolhe qual usar via `.env` - nada em `WebhookService` muda entre elas.

```bash
# .env - ligar os drivers reais (precisa de Redis/MySQL de verdade rodando)
QUEUE_DRIVER=bullmq
REDIS_HOST=localhost
REDIS_PORT=6379

DB_DRIVER=mysql
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=teste_dev
# aplique src/webhook/repository/schema.sql no banco antes de subir
```

**Por que o default continua em memória:** o próprio enunciado do teste diz explicitamente que banco de dados e deploy não são avaliados. Forçar Redis/MySQL como obrigatórios pra rodar quebraria a entrega pra quem só faz `npm install && npm start` sem essa infra - pareceria pior, não melhor. Por isso os drivers reais são **opcionais e plugáveis**, exatamente como o `CepProvider`: dá pra ver o código de verdade sem depender dele pra avaliar o resto.

**Honestidade sobre o teste desses drivers:** não há Docker/WSL disponível no ambiente onde este projeto foi desenvolvido, então não dava pra validar a conexão de rede real com Redis/MySQL de ponta a ponta. O que **foi** testado e validado:

- `bullmq-queue.driver.spec.ts`: a lógica de *wiring* (o `enqueue` chama `Queue.add` com o payload certo, `registerProcessor` cria um `Worker` que delega pro processor registrado, `close()` fecha as duas conexões, os handlers de erro não lançam exceção) - com a lib `bullmq` **mockada** (`jest.mock('bullmq', ...)`), sem Redis real.
- `mysql-batch-job.repository.spec.ts`: a lógica de SQL/mapeamento (quais queries são disparadas, como as linhas viram `BatchJob`, `JSON.parse`/`JSON.stringify` de `ceps`/`results`) - com um `Pool` **fake** (`{ execute: jest.fn() }`), sem MySQL real.
- **Boot com os drivers reais selecionados, sem Redis/MySQL disponíveis:** subi o servidor com `QUEUE_DRIVER=bullmq DB_DRIVER=mysql` e sem nenhuma das duas infras rodando. A aplicação **inicializou e serviu HTTP normalmente** (`GET /health` respondeu 200) - o `ioredis` fica tentando reconectar em background (log `bullmq_worker_error` a cada ~1s) sem derrubar o processo, graças a `lazyConnect: true` e ao fato de `BullMqQueueDriver`/`MySqlBatchJobRepository` só serem instanciados (não registrados como `@Injectable()` do Nest) dentro da própria factory, só quando selecionados.

O que eu **não** consigo afirmar sem Redis/MySQL de verdade: se a query SQL bate 100% com o schema em produção, ou se o comportamento de retry/reconexão do BullMQ é exatamente o esperado sob carga real. Isso é o próximo passo natural se a vaga pedir - documentado aqui como limitação conhecida, não como algo escondido.