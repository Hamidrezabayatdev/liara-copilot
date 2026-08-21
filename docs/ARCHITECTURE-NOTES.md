# Liara Copilot — یادداشت‌های معماری (Architecture notes)

> **Superseded as the plan.** This was the scaffold-time architecture note. The
> live plan of record is **[`MASTER-PLAN.md`](./MASTER-PLAN.md)**, which carries
> every decision from all seven interview rounds, the phase breakdown, and the
> current state. This file is kept for the reasoning behind the early
> architectural calls — it is history, and two of its base URLs are now known
> wrong (see `VERIFIED-FACTS.md` §2 for the measured values).

## 0. Verified facts (measured, not assumed)

### Model layer — §24.8 RESOLVED
Liara AI is an OpenAI-compatible gateway. Liara's **own docs** use exactly our pattern:
```ts
createOpenAI({ baseURL: process.env.BASE_URL, apiKey: process.env.LIARA_API_KEY })
```
with IDs like `anthropic/claude-opus-4`, plus `customProvider` / `createProviderRegistry`.
- base: `https://ai.liara.ir/api/v1/<workspace_id>`
- supported: `tools`, `tool_choice`, `stream`, `response_format`, `seed`, `temperature` ⇒ tool calling + streaming + JSON mode all confirmed
- **plan gates model availability** — verify with `GET {base}/models` before locking routing
- embedders on the same key: `intfloat/multilingual-e5-large`, `openai/text-embedding-3-{small,large}`, `google/gemini-embedding-{001,2}` ⇒ **zero model files in the container**

### Management API — §24.3 / §24.4 RESOLVED
`https://developers.liara.ir/` publishes OpenAPI specs. **95 operations inventoried**, each classifiable R/W/X.
| product | base |
|---|---|
| PaaS, DBaaS | `https://api.iran.liara.ir` |
| DNS | `https://dns-service.iran.liara.ir` |
| Object storage | `https://storage-service.iran.liara.ir` |
| AI | `https://ai.liara.ir` |

Auth `Authorization: Bearer <token>`; `teamID` query param for teams.
Caveat: the specs contain duplicate YAML keys — treat as documentation, not a codegen source. Paths transcribed by hand into `allowlist.ts`.

### Docs corpus — §24.1 RESOLVED
1125 docs / **4.24 MB** ⇒ bundles in-repo, **no vector DB**.
`all-links-llms.txt` (1143 URLs) gives every page a deterministic `.md` twin ⇒ exact citation URLs by stripping `/llms/` + `.md`.
**Gotcha:** `.md` exports contain unrendered `{item}` placeholders where model/plan lists belong. Docs are unreliable for model IDs — never cite them for that; use `GET /models`.

### Existing search — §24.2 RESOLVED (build our own)
Liara's public Meilisearch is live and free but `displayedAttributes` excludes `body` ⇒ returns **zero body text**, and collapses on natural Persian problem queries. Not reusable.

### Deploy constraints RESOLVED
- Liara documents WebSocket/persistent connections for Next.js ⇒ **SSE streaming is safe. No timeout blocker.**
- `liara.json`: `{"next":{"mirror":true},"port":3000}` — never set `app`/`platform` (auto-detected)
- cron: `"cron": ["0 */8 * * * curl http://localhost:3000/api/docs/refresh"]`, `$ROOT` available
- mounted disk required for anything surviving restart (filesystem otherwise ephemeral)

### SDK reality check
Installed: **`ai@7.0.71`**, `@ai-sdk/openai@4.0.45`, `@ai-sdk/react@4.0.74`, `zod@4.4.3`, `next@16.3.1`, `react@19.2.8`.
**`node_modules/ai/docs/` ships 277 version-exact `.mdx` docs** — the authoritative reference for this exact version. Do not write SDK code from memory; grep those.

v7 gives us native primitives for most of §17:
| need | primitive |
|---|---|
| Confirm Action (§8) | `toolApproval` (`approved`/`denied`/`user-approval`/`not-applicable`) |
| forge-proof confirms | `experimental_toolApprovalSecret` (HMAC) |
| context budgeting | `pruneMessages` |
| progressive tool loading | `prepareStep` + `experimental_filterActiveTools` |
| stop-early | `stepCountIs` / `StopCondition` |
| tier routing + failover | `customProvider`, `createProviderRegistry`, `wrapLanguageModel` |
| hybrid rerank | `rerank`, `cosineSimilarity`, `embedMany` |
| per-message cost badge | message metadata |
| live checklist / cards | custom data parts via `createUIMessageStream` |

## 1. Security model — two enforced layers, neither a prompt

**Layer 1 — capability middleware** (`wrapLanguageModel`): tools outside the level's active set are dropped *before the model is told they exist*. Defense in depth + token savings + better jailbreak rejection.

**Layer 2 — `toolApproval`** (default-deny, fail-closed):
- read tool → `approved`
- reversible write on allow-list → `user-approval` (Before/After diff + explicit confirm, HMAC-signed)
- destructive → `denied` **with a reason**, so the agent can explain the refusal instead of hanging
- unmatched → `denied`
- thrown error → `denied`

**Layer 3 — HTTP client**: `allowlist.ts` matches `(method, pathPattern)`. Anything else throws before a request is made. Every `DELETE` in all 95 operations is absent from the allow-list.

Allowed writes (reversible only): `POST /v1/projects/update-envs`, `POST /v1/projects/{name}/actions/restart`, `POST /v1/projects/{name}/actions/scale`, `POST /v1/projects/{name}/resize`, `POST /v2/projects/{name}/releases`, `POST /api/v1/zones/{zone}/dns-records`.

**Hard rule: no generic `liara_api_call` tool.** A coarse dispatcher would let the model route around per-action rules (the transitive-enforcement problem). Only fine-grained named tools.

**Secrets**: `LIARA_API_TOKEN` / `LIARA_AI_KEY` server-side env only. A user-supplied token lives in an httpOnly, encrypted, SameSite=Strict cookie — never persisted server-side, never logged, never in a tool result or model context.

## 2. Interface contracts (frozen — parallel work builds against these)

```ts
// lib/liara/types.ts
export type Product = 'paas' | 'dbaas' | 'dns' | 'storage';
export type LiaraCtx = { token: string; teamId?: string };
export type ToolResult<T> = { ok: true; data: T; source: 'account' } | { ok: false; error: string; status?: number };

// lib/liara/client.ts
export function liaraFetch<T>(p: Product, method: string, path: string, o?: {ctx: LiaraCtx; body?: unknown; query?: Record<string,string>}): Promise<ToolResult<T>>;

// lib/liara/allowlist.ts
export function assertAllowed(product: Product, method: string, path: string): void; // throws
export function classify(product: Product, method: string, path: string): 'read' | 'reversible-write' | 'destructive' | 'unknown';

// lib/retrieval/index.ts
export type DocHit = { id: string; title: string; url: string; score: number; snippet: string };
export function searchDocs(q: string, k?: number): Promise<{hits: DocHit[]; confidence: number; mode: 'bm25'|'hybrid'}>;
export function readDoc(id: string): Promise<{title: string; url: string; content: string}>;

// lib/ai/cost.ts
export type UsageMeta = { model: string; tier: 'router'|'answer'|'reason'; inputTokens: number; outputTokens: number; toman: number; toolCalls: number; latencyMs: number; level: 1|2|3; why: string };
```

## 3. Workstreams

| # | scope | owner | depends on |
|---|---|---|---|
| A | retrieval: corpus bundle, Persian normalizer, MiniSearch index, `search_docs`/`read_doc`, adaptive semantic fallback | delegated | none |
| B | UI: RTL + Vazirmatn shell, shadcn init, all cards, checklist, cost badges | delegated | contracts only |
| C | Liara client + allow-list + read/write tools | delegated (security) | contracts only |
| D | agent core: provider tiers, level router, approval, capability middleware, cost meter, 3 Skills | **me** | A/C signatures |
| E | seed script, `liara.json`, deploy, demo script | me | 1–4 of checklist |

Retrieval is adaptive hybrid in production: BM25 always runs first and semantic
search is enabled with a prebuilt E5 index only when BM25 confidence is low.
The code still defaults safely to BM25 when the feature flag or index is absent.

## 4. Level routing
- **L1** trivial → `openai/gpt-5.6-luna`, docs tools only, `stepCountIs(2)`
- **L2** contextual → `openai/gpt-5.6-luna` + read tools, `stepCountIs(5)`
- **L3** troubleshooting → `google/gemini-3.7-flash`, read + gated writes, `stepCountIs(12)`

The fallback router is one `deepseek/deepseek-v4-flash` call returning
`{level, why, tools}`; `why` feeds the "چرا این مسیر؟" popover. Deterministic
pre-checks short-circuit before any model call.
