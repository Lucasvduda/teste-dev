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
npm run test        # 39 testes unitários (providers, service, pipe, rotator, circuit breaker, logger)
npm run test:e2e    # 8 testes ponta-a-ponta via supertest (HTTP mockado, sem chamada de rede real)
```

Todos os testes (unitários + e2e) e o build foram executados com sucesso durante o desenvolvimento. Os testes automatizados **nunca** chamam ViaCEP/BrasilAPI de verdade (determinismo/CI); a integração real foi validada manualmente:

```
GET /cep/01001-000 -> 200 { cep, street, neighborhood, city, state: "SP", source: "viacep",    requestId }
GET /cep/30130010  -> 200 { ...                                          source: "brasil-api", requestId }
GET /cep/abc        -> 400 { error: "INVALID_CEP_FORMAT" }   (nenhum provider é chamado)
GET /cep/00000-000  -> 404 { error: "CEP_NOT_FOUND" }         (os dois providers concordaram)
```

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
  health/
  app.module.ts
  main.ts
test/
  cep.e2e-spec.ts           # HTTP mockado, aplicação completa via supertest
```

## O que ficou fora de propósito

Frontend, banco de dados e deploy (conforme o enunciado). Também não há retry com backoff dentro do mesmo provider (ex.: tentar a ViaCEP 3x antes de desistir dela): o failover pro outro provider já cobre esse caso de forma mais rápida pro usuário, e retry-com-backoff-por-provider seria um próximo passo natural se quiséssemos mais uma camada de resiliência (documentado aqui como decisão consciente, não esquecimento).