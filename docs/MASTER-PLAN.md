# Liara Copilot — نقشهٔ اصلی / Master Plan

**The plan of record.** Everything decided, everything built, everything left.
Written 2026-08-21. Supersedes `ARCHITECTURE-NOTES.md` as the plan; defers to
`VERIFIED-FACTS.md` on any question of what the Liara API actually does.

| | |
|---|---|
| **Product** | لیارا کوپایلوت / Liara Copilot — an adaptive AI agent over Liara's cloud platform |
| **Source spec** | `liara-agentic-assistant-product-spec-v2-en.md` (871 lines, purely descriptive — every implementation decision below is ours) |
| **Deliverable** | live URL on Liara + public repo + demo video |
| **Team** | solo |
| **Budget** | 12–16 hours |
| **Language** | Persian UI, شما form, technical terms left in Latin script — the way Liara's own docs write |

---

## 0. Status at a glance

```
Phase 0  recon + verified facts .................... ██████████ 100%
Phase 1  platform client + security ................ ██████████ 100%   24/24 tests
Phase 2  retrieval ................................. ██████████ 100%   20/20 tests
Phase 3  model routing + cost ...................... █████████░  90%   22/22 tests
Phase 4  UI kit (isolated components) .............. █████████░  90%
Phase 5  agent core ................................ ░░░░░░░░░░   0%   ← current
Phase 6  app shell + wiring ........................ ░░░░░░░░░░   0%
Phase 7  the three Skills .......................... ░░░░░░░░░░   0%
Phase 8  demo fleet (real deploys) ................. ░░░░░░░░░░   0%
Phase 9  ship: liara.json, deploy, README, video ... ░░░░░░░░░░   0%
```

About **55% by effort**. The foundations are the larger share of the *hard*
work, but the part a judge actually sees is entirely in Phases 5–9.

---

## 1. What this is

An agent that answers questions about a Liara account and its docs, and — when
asked — safely changes things. Three properties distinguish it from a chatbot
with tools bolted on:

1. **It spends effort in proportion to the question.** «لیارا چیست؟» must not
   cost the same as «چرا اپم ۵۰۲ می‌دهد؟». This is enforced by an escalation
   router that classifies before it spends, and it is the product's thesis.
2. **It shows what it is doing while it does it.** A live ✓/●/○ checklist plus a
   real rendered component per tool — a log viewer for logs, a metrics chart for
   metrics, a diff for a proposed write.
3. **It distinguishes what it knows from what it observed from what it guessed.**
   Every claim is tagged `docs` (official documentation, with a citation URL),
   `account` (observed live, with the endpoint), or `inference` (the agent's own
   reasoning). Spec §14 requires this; the UI never blurs the three.

### The mental model (spec §5)

```
Understand → pick the lightest valid path → Answer or Inspect
                                              ↓
                                        Ask → Plan → Act → Verify
```

The agent never acts without a plan, never plans without inspecting, and never
inspects when the docs already answer the question.

---

## 2. Locked decisions

Seven interview rounds. These are settled; changing one is a re-plan, not a tweak.

### 2.1 Product & delivery

| Decision | Choice | Why |
|---|---|---|
| Name | لیارا کوپایلوت / Liara Copilot | — |
| Deliverable | live URL + repo + demo video | judged on all three |
| Deploy target | Liara team **«لیارا»** (`<team-id>`), not personal | that is where the demo fleet lives |
| Repo | I push it; URL handed over afterwards | — |
| Tone | professional **شما**, technical terms in English/Latin | matches docs.liara.ir; mixing scripts mid-sentence is normal Persian technical writing |

### 2.2 Stack

Next.js 16 App Router · TypeScript strict · Vercel AI SDK **v7** · shadcn/ui ·
Tailwind v4 · Vazirmatn · pnpm.

AI SDK v7 is not v6 — the renames matter and are easy to get wrong from memory:
`parameters`→`inputSchema`, `maxSteps`→`stopWhen: stepCountIs(N)`,
`CoreMessage`→`ModelMessage`, `toDataStreamResponse`→`toUIMessageStreamResponse`,
`agent.generateText()`→`agent.generate()`, `tool-invocation`→`tool-<name>`,
`isLoading`→`status`, `useChat({api})`→`useChat({transport})`.
`node_modules/ai/docs/` ships 277 version-exact `.mdx` files — the authority for
this exact version. Never write SDK code from memory.

### 2.3 Models — 100% Liara AI, no other provider

| Tier | Model | Used for |
|---|---|---|
| router | `google/gemini-3.7-flash` | classification, only when heuristics fail |
| answer | `google/gemini-3.7-flash` | Level 1 and Level 2 |
| reason | `anthropic/claude-sonnet-5` | Level 3 only |
| baseline | `anthropic/claude-opus-5` | **never called** — prices the counterfactual |
| embed | `intfloat/multilingual-e5-large` | semantic retrieval, flag-gated |

Opus-5 is exactly **13.3×** flash per token. That ratio is the entire cost story
and the footer exists to show it.

### 2.4 Write scope — the security ceiling

> *"Reversible writes only — delete is hard-blocked at the tool layer."*

Enforced as an allow-list **in code**, never as a prompt instruction. Exactly six
writes, each undoable by an equal-and-opposite call:

| # | Operation | Undo |
|---|---|---|
| 1 | `POST /v1/projects/update-envs` | set them back (previous set is returned) |
| 2 | `POST /v1/projects/{name}/actions/restart` | idempotent |
| 3 | `POST /v1/projects/{name}/actions/scale` | scale to previous value |
| 4 | `POST /v1/projects/{name}/resize` | resize to previous plan |
| 5 | `POST /v2/projects/{name}/releases` | roll forward to previous release |
| 6 | `POST /api/v1/zones/{zone}/dns-records` | delete it in the console |

Every one is gated behind a Before/After diff and an explicit confirmation.

### 2.5 Tokens & secrets

- `LIARA_API_TOKEN`, `LIARA_AI_KEY` — server-side env only, never in a tool
  result, never in model context, never logged.
- "اتصال حساب لیارا" (paste your own token) — held in an **httpOnly, encrypted,
  SameSite=Strict cookie**. Never persisted server-side. Never logged.
- Env-var *values* are redacted before they reach the model: connection strings
  keep their structure and lose only the password (`postgres://u:•••@host:5432/db`),
  everything else collapses to `«مقدار مخفی، N کاراکتر»`. You cannot diagnose a
  wrong DB host without seeing the host; you never need the password.

### 2.6 Persistence

**Client-side only — IndexedDB.** No database, no server-side session store.
Conversations, cost history and settings live in the browser. This is a
deliberate scope cut: it removes a whole class of deployment and privacy
problems, and nothing in the product needs cross-device history.

### 2.7 Retrieval

Hybrid, **BM25 by default**, semantic fully implemented but `ENABLE_SEMANTIC_RAG=false`.
Semantic is escalated to only when keyword confidence < 0.35. Cost-driven, per
owner decision: *"RAG should be disabled by default, but the code should be fully implemented."*

Docs freshness: bundled snapshot in-repo + a Liara cron every 8h writing to a
mounted disk.

### 2.8 Scope

**In:** Diagnose downtime / failed deployment · Environment variables (read + set) ·
Architecture recommendation · Support-summary handoff · full cost instrumentation ·
full generative UI.

**Out:** cost optimisation as a skill (explicitly not selected) · anything
destructive · multi-user auth · server-side history.

---

## 3. Verified facts

Full detail in `VERIFIED-FACTS.md`. The load-bearing ones:

| Fact | Value |
|---|---|
| PaaS base | `https://paas.liara.ir` |
| DBaaS base | `https://dbaas.liara.ir` |
| DNS base | `https://dns-service.iran.liara.ir` |
| Storage base | `https://storage-service.iran.liara.ir` |
| AI base | `https://ai.liara.ir/api/<workspace-id>/v1` |
| Team scoping | `teamID` **required** — without it the API silently answers for the empty personal account instead of erroring |
| Golden endpoint | `GET /v1/me?teamID=…` returns account **and** the full plan catalog with real Toman prices |
| Real cost | Liara returns a non-standard `usage.total_cost_toman` — read it, never estimate |
| USD→Toman | derive from `total_cost_toman / cost`, never hardcode |
| Rate limits | میرزاخانی 10 req/s · تورینگ 100 req/s |
| Docs corpus | 1,125 pages / 6.5 MB — bundles in-repo, no vector DB needed |
| Docs `.md` gotcha | exports contain unrendered `{item}` placeholders where model/plan lists belong — never cite docs for model IDs, use `GET /models` |
| Streaming | Liara documents WebSockets for Next.js ⇒ **SSE is safe**, no timeout blocker |
| Filesystem | ephemeral without a mounted disk |
| `POST /v2/projects` | does not exist (404) — app creation is v1 only |
| `available: true` | **unreliable** — `ir-small` advertises available, then fails `g1_plan_unavailable`. Prefer `-g2`; let the API be the authority |

### The demo fleet (provisioned, network `copilot-net`)

| App | Platform | Intended role |
|---|---|---|
| `liara-copilot-ir` | next | the product itself |
| `digishop-front` | static | healthy control |
| `digishop-api` | node | **must 502** — wrong port |
| `digishop-worker` | node | **must be stopped** — scale 0 |
| `digishop-db` | postgres 18.4 | deployed; used for the architecture skill |

All exist, all `ACTIVE`, **none has code deployed yet** — `isDeployed: false`,
`releases.total = 0`. Phase 8 fixes this.

---

## 4. Architecture

### 4.1 Directory map

```
src/
  lib/
    liara/        ✅ platform client — the only thing between an LLM and a live account
      types.ts        frozen contracts: Product, LiaraCtx, ToolResult<T>, OpKind
      allowlist.ts    SECURITY. Path hygiene + classify() + assertAllowed()
      client.ts       liaraFetch — calls assertAllowed before touching the network
      account.ts      /v1/me, plan catalog, planID validation
      apps.ts         reads + the five PaaS writes
      dbs.ts dns.ts storage.ts
      allowlist.test.ts   540 lines. The security tests.
    retrieval/    ✅ docs search
      normalize.ts    Persian normalisation, stopwords, synonym expansion
      corpus.ts       1,125 docs → 3,650 chunks (182 ms, avg 664 chars)
      bm25.ts         MiniSearch + diversification + confidence
      semantic.ts     e5 embeddings, flag-gated, degrades silently
      index.ts        searchDocs() — BM25, escalates to hybrid via RRF
    ai/
      provider.ts   ✅ Liara AI provider, failover, teed SSE for total_cost_toman
      cost.ts       ✅ pricing from GET /models, Toman, session summary
      router.ts     ✅ escalation router — deterministic first
      projections.ts✅ raw API JSON → UI shapes
      tools.ts      ⬜ the 20 tools
      approval.ts   ⬜ toolApproval policy + HMAC
      capability.ts ⬜ activeToolsFor(level)
      agent.ts      ⬜ ToolLoopAgent per level
      prompts.ts    ⬜ system prompt + the three Skills
  components/     ✅ 20 components + 18 primitives, RTL, presentational only
  app/
    layout.tsx    ✅ RTL shell, Vazirmatn, theme bootstrap
    page.tsx      ⬜ still the Next scaffold
    api/chat/     ⬜
```

### 4.2 Security — three layers, none of them a prompt

The threat is not a malicious user; it is a *confused* model plus a message
history the client controls. Each layer assumes the one above it failed.

**Layer 1 — capability narrowing.** Tools outside the current level's set are
never put in the request. The model is not told they exist, so it cannot be
argued into calling one. Cheaper too: fewer tool schemas per request.

**Layer 2 — `toolApproval`, default-deny and fail-closed.**

| Situation | Result |
|---|---|
| read tool | `approved` |
| reversible write on the allow-list | `user-approval` → Before/After diff + explicit confirm |
| destructive | `denied` **with a reason**, so the agent can explain rather than hang |
| unmatched | `denied` |
| policy function throws | `denied` |

Approvals are HMAC-signed with `experimental_toolApprovalSecret`. The signature
binds tool name + call id + exact input, so a forged or edited approval replayed
through the message history is rejected before execution. No secret configured
⇒ no approvals honoured.

The policy re-derives risk *independently* by feeding the tool's actual input
back through `classify()`, and takes the **stricter** of the declared kind and
the derived kind. A tool mislabelled in either direction still fails safe.

**Layer 3 — the HTTP client.** `assertAllowed()` runs before every request.
Path hygiene is checked on the **raw** input before any normalisation: no
whitespace, no `..`, no `//`, no backslash, no `#`, no NUL, and no `%` at all —
rejecting percent-encoding wholesale kills `%2f`, `%5c`, `%2e%2e`, `%00` and
every future variant in one rule rather than by whack-a-mole. Matching and
sending use the *same* normalised string, because matching one string and
sending another is exactly how this kind of layer gets bypassed.

Reads are enumerated **path by path**. There is deliberately no `GET *` rule: a
blanket read would have exposed `/disks/{d}/ftp` (FTP credentials),
`/api/v1/keys` (object-storage secrets) and object bodies. Those three are
excluded by name even though the specs document them.

A load-time invariant refuses to import the module if a `DELETE` ever appears in
the writes table or a rule lands in both writes and destructive.

**Hard rule: no generic `liara_api_call` tool.** A coarse dispatcher lets the
model route around per-action rules. Only fine-grained named tools.

### 4.3 Agenticity levels

| Level | Trigger | Model | Tools | Steps |
|---|---|---|---|---|
| **1** simple | definitional, "what is X" | flash | docs only | 2 |
| **2** contextual | about *this* account | flash | docs + 12 read tools | 5 |
| **3** troubleshooting | failure, or a write | **sonnet-5** | docs + reads + gated writes | 12 |

**Routing is deterministic first.** Signal arrays are checked in a fixed order —
continuity → L3 failure → L3 write → L2 strong → L1 frame → L2 weak + activator
— and only an unmatched question reaches a model. All 19 hand-checked Persian
phrasings resolve with **zero** model calls. Paying a model to decide how much to
spend is precisely the cost bug this product exists to demonstrate.

Two Persian-specific problems the router has to survive:

- **Imperative vs first-person collision.** `دیپلوی کن` (do it — a write) is a
  substring of `دیپلوی کنم` (how do I — a question). Ordering and framing
  detection resolve it: an L3 write signal is demoted when an L1 question frame
  is present, but an L3 *failure* signal is never demoted.
- **Continuity.** A four-word `بله` must inherit the previous level, or
  confirming a Level-3 plan silently restarts at Level 1.

### 4.4 Cost instrumentation — a hero feature, not telemetry

Per message: model badge · tokens in/out · **cost in Toman** · tool-call count ·
latency · a «چرا این مسیر؟» popover explaining the routing decision in Persian.

Per session: a footer comparing actual spend against an **always-opus-5**
baseline for the identical conversation, and the percentage saved.

Toman is **read from the provider**, never estimated — Liara returns
`usage.total_cost_toman` in a non-standard field, which the provider's
`instrumentedFetch` recovers by teeing the SSE body. Pricing comes from
`GET /models` at runtime; the USD→Toman rate is derived from the API's own
`total_cost_toman / cost` ratio rather than hardcoded.

This is the visible payoff of §17 cost discipline: deterministic-before-
generative, model selection, context budgeting, tool-call economy, stop-early.

### 4.5 Retrieval

BM25 over 3,650 chunks. Three fixes that only measuring found:

1. **ZWNJ is deleted, not folded to a space.** Persian writes `می‌شود` with a
   zero-width non-joiner; users type `میشود`. Deleting collapses both onto one
   token, and prefix search still lets `می شود` reach it. Folding to a space
   indexes `می` + `شود` and then fails outright on the *more common* typed form —
   the worse direction to be wrong in.
2. **Interrogatives are stopworded.** `/ai/faq/` is a wall of «چگونه می‌توانم …»
   headings and was ranking #1 for unrelated queries. Strong *routing* signals,
   pure retrieval noise.
3. **Queries expand through a synonym map.** «دیپلوی» appears in **0** of 1,125
   docs; «استقرار» appears in 287. Expansion is query-only, one-directional and
   OR-combined, so it cannot hurt ranking.

Plus `diversify(maxPerDoc=1)` with a 5× over-fetch, because three chunks of the
same page were filling the top three.

Semantic path: e5 with the mandatory literal `query: ` / `passage: ` prefixes
(asymmetric model — omitting them silently degrades). Refuses to load vectors
built by a different model. Returns `[]` rather than throwing when unavailable,
and `searchDocs` reports the strategy that *actually* ran, never the one it
intended.

### 4.6 Tool inventory — 20

**Informational · Level 1+**
`searchDocs`

**Inspect · Level 2+**
`listApps` · `getApp` · `getAppLogs` · `getAppEvents` · `getAppReleases` ·
`getAppMetrics` · `listEnvVars` · `listDatabases` · `getDatabase` ·
`listBuckets` · `listDnsRecords` · `getPlans`

**Action · Level 3, all behind confirmation**
`setEnvVars` · `restartApp` · `scaleApp` · `resizeApp` · `rollbackRelease` ·
`createDnsRecord`

**Meta**
`askUser` — no `execute`, so the client fulfils it and the loop suspends

Every tool carries `kind: OpKind` plus a `probe(input)` returning the allow-list
coordinates it will hit, so the approval layer can verify the claim rather than
trust it. Results are **projected into UI shapes**, not passed through as raw
JSON: a `GET /v1/projects` response is ~14 KB, mostly plan tables and internal
ids, and eight fields per app costs about a twentieth of the context.

### 4.7 Generative UI

38 files, presentational only — no fetching, no AI SDK imports.

Agent visibility: a live ✓/●/○ checklist, plus a real component per tool —
`application-card`, `deployment-card`, `log-viewer`, `metrics-panel`,
`env-editor`, `dns-records-table`, `before-after-diff`, `diagnostic-result`,
`source-card`, `support-summary-card`, `cost-badge`, `session-cost-footer`,
`ask-user-prompt`, `confirmation-dialog`.

### 4.8 The three Skills

| Skill | Shape |
|---|---|
| **Diagnose downtime / failed deploy** | status → releases → logs → events → metrics → envs, stopping the moment the cause is found. Emits a `diagnostic-result` with cause, evidence, and a proposed fix behind a confirm |
| **Environment variables** | read with secrets redacted; set via merge-by-default (`update-envs` *replaces* upstream, which makes a partial payload silently destructive), Before/After diff, exact undo |
| **Architecture recommendation** | reads the actual fleet + plan catalog, recommends against real Toman prices, marks every claim `account` or `docs` and its own opinion `inference` |

Cross-cutting: **Support Summary** — a copyable handoff of what was tried, what
was observed, and what remains.

---

## 5. Phases

### ✅ Phase 0 — Recon
Every API fact measured against the live account. 95 operations inventoried and
classified R/W/X. Fleet provisioned. Corpus fetched. → `VERIFIED-FACTS.md`

### ✅ Phase 1 — Platform client + security · 1,969 lines · 24/24
Types, allow-list, client, account, apps, dbs, dns, storage. All six writes
return their own previous state.

### ✅ Phase 2 — Retrieval · 723 lines · 20/20
Normalisation, corpus, BM25, semantic, hybrid fusion (RRF k=60).
`scripts/build-docs-index.mjs` builds the vector store when semantic is enabled.

### ✅ Phase 3 — Model routing + cost · 1,003 lines · 22/22
Provider with failover, cost accounting, escalation router, projections.
*Remaining:* reconcile the duplicate `UsageMeta` (cost.ts should extend the
component type rather than restate it).

### ✅ Phase 4 — UI kit · 38 files
Typecheck clean. *Remaining:* `src/components/preview/` is empty — optional.

### ⬜ Phase 5 — Agent core ← **current**
`tools.ts` · `approval.ts` · `capability.ts` · `agent.ts` · `prompts.ts`.
Done when: a Level-3 write is refused without a signed approval, and a `DELETE`
cannot be reached from any tool.

### ⬜ Phase 6 — App shell
`/api/chat` streaming route · `page.tsx` · wire all 38 components to tool parts ·
IndexedDB persistence · the "connect your own token" dialog.
Done when: both hero demos run end to end in a browser.

### ⬜ Phase 7 — The three Skills
Prompt scaffolding + checklist templates + the `diagnostic-result` path.

### ⬜ Phase 8 — Demo fleet
Deploy real code with `@liara/cli 9.4.7` (installed):
`digishop-front` healthy · `digishop-api` listening on the wrong port → real 502 ·
`digishop-worker` deployed then scaled to 0.
**Blocking for the hero demo** — right now there are no logs to diagnose.

### ⬜ Phase 9 — Ship
`liara.json` (port 3000, `next.mirror`, 8h docs cron, mounted disk) · deploy to
`liara-copilot-ir` · README · demo video script · push the repo.

---

## 6. The hero demo — both extremes, back to back

**Take 1 — «لیارا چیست؟»**
One tool call. Flash. Two steps. Answer with a docs citation. Badge shows a
fraction of a Toman. *This question did not deserve an agent, and it did not get one.*

**Take 2 — «چرا digishop-api پاسخ ۵۰۲ می‌دهد؟»**
Level 3. Sonnet-5. The checklist fills in live: status ✓ → releases ✓ → logs ✓
(the error appears) → envs ✓ → cause found. `PORT=3000` is set but the process
listens elsewhere. The agent proposes the fix, renders a Before/After diff, and
**stops** for confirmation. Confirm → applied → restart → verify → green.

Then the footer: what it cost, what always-opus-5 would have cost, and the
percentage saved.

---

## 7. Deployment

`liara.json`:
```json
{
  "port": 3000,
  "next": { "mirror": true },
  "disks": [{ "name": "docs", "mountTo": "/app/data/docs-cache" }],
  "cron": ["0 0 */8 * * * curl -fsS http://localhost:3000/api/docs/refresh"]
}
```
Never set `app`/`platform` — auto-detected. `$ROOT` is available in cron.
The mounted disk is required for anything surviving a restart.

---

## 8. Honest gaps

Things that will be **stated, not faked**, in the demo and the README:

- **No DNS zones exist in this account.** `createDnsRecord` is implemented,
  validated and tested, but has nothing to create a record in. Creating a zone
  is not on the allow-list and will not be added for a demo.
- **`getAppEvents` returns `{}`** with no `data` key on this account. Projections
  are defensive; the UI omits the section rather than inventing rows.
- **Metric endpoints have been observed empty.** The series parser handles three
  plausible shapes from the spec, but it has not been validated against live data
  because there is none yet. Phase 8 will produce some.
- **Semantic retrieval ships off.** The code is complete and tested; enabling it
  costs an embedding call per query. `ENABLE_SEMANTIC_RAG=true` +
  `node scripts/build-docs-index.mjs` turns it on.

---

## 9. Definition of done

- [ ] Live URL on Liara, in the team account, loading in Persian RTL
- [ ] Both hero demos run end to end without a manual step
- [ ] A write is impossible without an explicit confirmation, and a forged
      approval in the message history is rejected
- [ ] No `DELETE` is reachable from any tool, proven by a test
- [ ] Every answer carries provenance; every docs claim carries a URL
- [ ] Per-message cost in Toman, and a session footer showing the saving
- [ ] Conversations survive a page reload
- [ ] Repo public, README explains the security model in one screen
- [ ] Demo video recorded

---

## 10. Commands

```bash
pnpm dev                                              # localhost:3000
pnpm exec tsc --noEmit                                # must stay clean

node --import ./scripts/register-ts.mjs --test src/lib/**/*.test.ts
node scripts/test-liara-client.mjs                    # live API, needs .env
node scripts/build-docs-index.mjs [--limit N]         # costs money

liara deploy --app liara-copilot-ir --team-id "$LIARA_TEAM_ID"
```

`scripts/register-ts.mjs` exists because Node 24 strips types but will not
resolve an extensionless relative specifier, while `tsc` rejects a literal `.ts`
in a static import. The shim reconciles the two so tests run on bare Node with
no build step.
