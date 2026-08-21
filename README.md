<p align="center">
  <img src="public/liara-logo.svg" width="112" alt="Liara" />
</p>

<h1 align="center">Liara Copilot</h1>

<p align="center">
  A Persian-first AI agent for Liara documentation, cloud diagnostics, and safe infrastructure actions.
</p>

<p align="center">
  <a href="https://liara-copilot-ir.liara.run"><strong>Live app</strong></a>
  ·
  <a href="https://liara-copilot-ir.liara.run/api/health">Service health</a>
  ·
  <a href="docs/DEPLOYMENT.md">Deployment</a>
</p>

<p align="center">
  <strong>English</strong>
  ·
  <a href="README.fa.md">فارسی</a>
</p>

<p align="center">
  <a href="https://github.com/Hamidrezabayatdev/liara-copilot/actions/workflows/quality.yml">
    <img src="https://github.com/Hamidrezabayatdev/liara-copilot/actions/workflows/quality.yml/badge.svg" alt="CI status" />
  </a>
</p>

![Liara Copilot conversation interface](docs/assets/liara-copilot-demo.png)

> Liara Copilot is an independent project and is not an official Liara product.

## About

Liara Copilot brings documentation search, live account inspection, diagnostics,
and infrastructure actions into one conversational interface. It can answer public
questions without an account. When a user connects their own Liara account, the
agent can inspect real resources and prepare explicitly approved changes.

### Highlights

- **Grounded answers:** searches a bundled snapshot of 1,125 official Liara
  documentation pages, applies adaptive hybrid retrieval with BM25, E5, and RRF,
  and links the sources used in each answer.
- **Live cloud context:** inspects connected apps, deployments, databases, disks,
  domains, logs, events, plans, and account details through allow-listed tools.
- **Multi-step diagnostics:** correlates configuration, runtime state, logs, and
  recent events instead of treating each signal in isolation.
- **Human-approved actions:** shows a before/after preview and requires a signed,
  user-specific confirmation before any supported write operation. Destructive
  `DELETE` operations are intentionally unavailable.
- **Cost-aware routing:** uses deterministic rules when possible, a lightweight
  router for ambiguous requests, Luna Pro for normal answers, and Gemini only for
  complex reasoning.
- **Conversation-focused UI:** streams Markdown, code, tables, links, sources, tool
  progress, and per-answer usage in a responsive Persian RTL interface.
- **Local persistence:** stores redacted conversation history in the browser and
  restores it after refresh without creating a server-side transcript database.

### Typical workflows

| You ask | Liara Copilot does |
|---|---|
| “How should I deploy Next.js securely on Liara?” | Searches official docs and returns a cited, actionable answer. |
| “Which apps are active in my account?” | Requests an account connection, then reads and summarizes live app state. |
| “Why is my API returning 502?” | Checks relevant configuration, deployment state, events, and logs to form a diagnosis. |
| “Set `APP_PORT` to `3000`.” | Prepares a change preview and waits for explicit approval before applying it. |
| A follow-up question | Reuses useful conversation context without resending unrelated data. |

### Model routing

| Role | Default model | When it runs |
|---|---|---|
| Router | `deepseek/deepseek-v4-flash` | Only when deterministic intent rules are not confident enough. |
| Answer | `openai/gpt-5.6-luna-pro` | Documentation answers, summaries, and ordinary tool-assisted requests. |
| Reasoning | `google/gemini-3.7-flash` | Complex diagnosis and multi-step reasoning. |

The enabled tool set and retrieved context are selected per request. Keyword search
is always available locally; semantic retrieval is invoked only when keyword
confidence is low, and at most four relevant sources enter the model context.

### Architecture

```text
Streaming Persian UI
  → deterministic-first intent routing
  → DeepSeek router / Luna Pro answer / Gemini reasoning
  → official-doc search or an explicit Liara capability set
       ├─ bundled docs: BM25 → conditional E5 + RRF
       └─ allow-listed Liara Management API client
  → projected and redacted tool results + sources + usage
  → browser-local conversation persistence
```

### Run locally

Requirements: Node.js 22+ and pnpm 9.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Set `LIARA_AI_BASE_URL`, `LIARA_AI_KEY`, `TOOL_APPROVAL_SECRET`, and
`TOKEN_COOKIE_SECRET` in `.env`. The shared `LIARA_API_TOKEN` and
`LIARA_TEAM_ID` are optional and intended only for private development or smoke
tests. Public users connect their own accounts through the encrypted session flow.

See [.env.example](.env.example) for every setting and safe default.

### Quality checks

```bash
pnpm check       # lint + typecheck + unit/integration tests + production build
pnpm test:e2e    # desktop/mobile Chromium + streaming + keyboard + accessibility
```

To run the read-only Management API smoke test:

```bash
node scripts/test-liara-client.mjs
```

### Deployment and operations

The production app exposes a network-free `/api/health` endpoint and includes a
global request deadline, model-call budget, rate and concurrency guards, structured
telemetry, CSP, and HSTS. Telemetry records operational metadata, latency, model
usage, and cost—not prompts, responses, account tokens, cookies, or authorization
headers.

Follow [the Liara deployment guide](docs/DEPLOYMENT.md) for environment variables,
semantic-index generation, standard deployment, the standalone fallback, and
post-deployment checks.

### Security boundaries

- Connected account tokens are encrypted in an `HttpOnly` cookie with an
  eight-hour lifetime; they are not exposed to browser JavaScript or model context.
- Tool access is allow-listed per intent. Results are projected and redacted before
  they reach the model or browser.
- Every supported write requires a before/after preview, an HMAC-signed approval
  bound to the current user, and an explicit confirmation.
- Rate limits, approval replay protection, and circuit state are process-local in
  the current single-instance deployment and must move to a shared store before
  horizontal scaling.
- The semantic index must be rebuilt with `node scripts/build-docs-index.mjs`
  after changing the bundled documentation snapshot.

### Documentation

- [Architecture notes](docs/ARCHITECTURE-NOTES.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Verified Liara API behavior](docs/VERIFIED-FACTS.md)
- [Product specification](docs/liara-agentic-assistant-product-spec-v2-en.md)
