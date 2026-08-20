# Liara Agentic Assistant — Product Specification

## 1. Problem

Over time, Liara has added more services, capabilities, and documentation. As this ecosystem grows, the main problem is no longer simply a “lack of documentation”; rather, users:

- Do not know which section of the documentation contains the answer to their question.
- Do not always know the exact name of the feature or service related to their problem.
- Need to combine multiple documents to solve a problem.
- May find the solution but still not know exactly how to apply it to their current situation.
- Do not know where to start or what to inspect during troubleshooting.
- Ultimately create a Support ticket or call for issues that could have been solved through documentation or a simple inspection.

Therefore, the problem is not merely **Documentation Search**.

The real problem is:

> The user has a question, goal, or problem; but to reach the answer or solve it, they need to understand Liara’s service structure, the relevant documentation, the current account state, and the appropriate problem-solving path.

The product goal should be to transform this path from “search and trial-and-error” into **intelligent, fast, personalized, and reliable answering and problem resolution**.

---

# 2. The Product We Want to Build

The proposed product is not a simple chatbot over documentation.

We want to build a **Liara Agentic Assistant** that decides between a simple answer and Agentic behavior depending on the type of user request.

The key product principle is:

> **Agentic behavior should only be used when it is actually required to solve the problem.**

If a simple question can be solved with a small retrieval and a direct answer, the system should not run a complex workflow, create a plan, or make multiple Tool Calls.

But if the problem requires context, diagnosis, account inspection, multiple steps, or an action, the Agent should be able to enter a complete workflow.

Product mental model:

**Understand → Choose the lightest valid path → Answer or Inspect → Ask if needed → Plan if needed → Act if needed → Verify**

---

# 3. Adaptive Agenticity

Agentic behavior should be **adaptive**, not the default for every request.

The system should first determine which level the request belongs to.

## Level 1 — Simple Question

Example:

> Static IP چیست؟

Appropriate behavior:

1. Find the minimal required source.
2. Give a direct and concise answer.
3. Show the source.
4. Stop.

In this case, the account should not be inspected, no plan should be created, and unnecessary Tools should not be called.

---

## Level 2 — Contextual or Personalized Question

Example:

> چطور env ست کنم؟

If account information is available, the system should use it for personalization.

For example:

> می‌توانید Environment Variable را از پنل یا CLI تنظیم کنید. در حساب شما `api`، `frontend` و `worker` وجود دارد؛ اگر بگویید روی کدام سرویس و چه متغیری را می‌خواهید تنظیم کنید، می‌توانم ادامه‌ی کار را برای همان سرویس انجام دهم.

In this case, only the context or Tools needed for the answer and the next-step suggestion should be used.

---

## Level 3 — Troubleshooting or Multi-step Task

Example:

> اپ `shop-api` بالا نمی‌آید.

In this case, the Agent can:

1. Find the correct resource.
2. Inspect its state.
3. Check the relevant deployment and logs.
4. Ask a clarifying question if needed.
5. Build a hypothesis.
6. Propose a fix.
7. Get approval.
8. Perform the action.
9. Verify the result.

---

# 4. Key Principle: Do the Minimum Work Required to Reach the Correct Answer

The product should always seek the **lowest-cost and simplest reliable path**.

That means:

- If a simple answer is sufficient, do not run a complex workflow.
- If a Tool can provide a definitive answer, the Agent should not guess.
- If the current context is sufficient, do not load more information.
- If only one source is needed, do not put a large set of docs into context.
- If enough evidence has been gathered, stop the process.

General principle:

> **Use the minimum intelligence, context and actions required to solve the user's problem reliably.**

---

# 5. Agent-first, Not Chat-first

Chat is only one of the product surfaces.

When needed, the Agent should be able to:

- Understand the user’s intent.
- Decide whether a direct answer is sufficient.
- Find the necessary information from official sources.
- Inspect the real account state.
- Ask a clarifying question.
- Diagnose the problem step by step.
- Use multiple Tools in the appropriate order.
- Get approval before sensitive operations.
- Verify the result.
- If the problem is not resolved, prepare it properly for Support.

The goal is for complex issues to feel similar to interacting with tools such as Claude Code or Codex, while simple questions remain fast and frictionless.

---

# 6. Skills

The Agent should not merely have a collection of independent Tools.

For important problem categories, it should have **Skills**: bundles of knowledge, inspection steps, behaviors, and relevant Tools for a specific type of problem.

Possible examples:

- Deploy Application
- Diagnose Failed Deployment
- Diagnose Application Downtime
- DNS & Domain Troubleshooting
- Environment Variables
- Database Connection Troubleshooting
- Object Storage Setup
- Persistent File Storage
- Email Delivery Troubleshooting
- Cost Optimization
- Resource / Plan Selection
- Migration to Liara
- Architecture Recommendation

A Skill should help the Agent know:

- Where to start.
- What needs to be checked.
- What information may be required from the user.
- Which Tools are relevant.
- What common errors exist.
- When enough evidence exists to reach a conclusion.
- When to ask a question.
- When to stop the workflow.

Skills should only be activated when the problem genuinely requires them.

> Before implementation, we should determine which problem categories create the most value for Liara users and the Support team.

---

# 7. Tools

Tools transform the Agent from a system that only answers questions into one that can **observe, inspect, and act**.

## Informational Tools

Examples:

- Search documentation.
- Open a specific document or section.
- View API reference.
- View CLI reference.
- Check a service’s capabilities.

## Inspect Tools

When an account is connected:

- View the user’s applications.
- Inspect an application’s status.
- View deployments.
- View logs.
- Inspect domains.
- Inspect DNS.
- Inspect databases.
- View environment variable metadata.
- Inspect storages.
- Inspect resources and plans.

## Action Tools

Where appropriate and with approval:

- Set an environment variable.
- Restart an application.
- Change a specific configuration.
- Run deployment-related operations.
- Create or modify supported resources.

Destructive or high-risk operations should be restricted and require explicit confirmation.

---

# 8. Special Tools for Agent Behavior

Some Tools are designed specifically for the interaction and reasoning workflow itself.

## Ask User

The Agent should be able to ask the user structured questions.

These questions should:

- Only be asked when necessary to continue.
- Use existing context.
- Not ask again for information the Agent can retrieve itself.
- Show real account options when possible.
- Also allow free-form answers.

Example:

> روی کدام سرویس می‌خواهید ENV را تنظیم کنید؟

- `api` — Node.js — Running
- `frontend` — Next.js — Running
- `worker` — Node.js — Stopped
- سرویس دیگر

From a UX perspective, this interaction should be close to Claude Code’s question-asking pattern in Plan Mode.

---

## Confirm Action

Before important actions, it should be clear:

- What will change.
- Which resource will be affected.
- What the likely impact is.
- Whether rollback or recovery is possible.

---

# 9. Personalization Should Be a Core Part of the Product

Personalization should not be limited to the user’s name or response style.

The Agent should use actionable context about the user and their environment, including:

- The user’s current Liara services.
- The stacks they use.
- Frequently used applications.
- Existing databases and storages.
- The user’s preferred method: CLI, Console, or API.
- The user’s approximate technical level.
- Previous decisions in conversations.
- Stored preferences.
- The current project or resource.

This context should influence answers, questions, and recommendations.

---

# 10. Recommendation as Agentic Behavior

The Agent should not only answer direct questions.

If there is a useful next step, it may suggest it.

But recommendations should:

- Be grounded in real context.
- Be relevant to the current goal.
- Be explainable.
- Not be intrusive or overly proactive.

Example:

If the user asks about persistent storage and already has Object Storage:

> با توجه به اینکه همین الان Object Storage فعال دارید، احتمالاً نیازی به ساخت resource جدید نیست و می‌توانیم همان را برای uploadهای application استفاده کنیم.

Or if the user has a resource that is larger than they need:

> مصرف فعلی این سرویس پایین‌تر از ظرفیت plan فعلی است. اگر هدفتان کاهش هزینه است، می‌توانیم بررسی کنیم plan کوچک‌تر برای workload شما کافی هست یا نه.

---

# 11. Understand the Problem Correctly Before Acting

The Agent should not jump to conclusions.

For ambiguous issues or troubleshooting, it should determine when necessary:

- What the desired outcome is.
- Which resource is involved.
- When the problem started.
- Whether any recent change was made.
- What has already been tried.

But questions should be **minimal**.

The Agent should not ask the user for information that it can obtain from the account or the conversation.

---

# 12. UI/UX: The Agent’s Work Should Be Visible

The product should not be just a sequence of chat messages.

The user should be able to see what the Agent is doing.

Example:

- ✓ Application پیدا شد
- ✓ Deployment اخیر بررسی شد
- ● در حال بررسی logها
- ○ بررسی domain configuration
- ○ بررسی environment

Tool calls should be represented as clear UI components.

Example components:

- Application Card
- Deployment Card
- Log Viewer
- DNS Record Viewer
- Database Card
- Environment Variable Editor
- Plan / Checklist
- Before / After Diff
- Source Card
- Confirmation Dialog
- Diagnostic Result
- Cost Recommendation Card

The UI should make three things clear:

1. What the Agent understood.
2. What it is doing now.
3. What the next step is.

---

# 13. Conversation Should Be Interactive

A conversation is not only:

**User Message → Assistant Message**

It can also include:

- Multiple-choice questions.
- Service selection.
- Resource selection.
- Plan approval.
- Action approval.
- Log viewing.
- Diff viewing.
- Retry.
- Choosing between multiple solutions.
- Refining the problem scope.

These interactions should reduce the user’s cognitive load and help the Agent understand intent.

---

# 14. Source-grounded Answers

The Agent should distinguish between these three categories:

- Information obtained from official Liara sources.
- Information observed from the real account.
- Inferences made by the Agent.

For answers related to the Liara product, a visible source should be provided.

If there is not enough evidence, the Agent should explicitly say that it does not have a definitive answer and should avoid hallucination.

---

# 15. Support Escalation / Ticket Assistant

The product goal is not to eliminate human Support completely.

If the Agent cannot resolve the issue, it should improve escalation.

The Agent can create a short and actionable Support Summary containing:

- The main problem.
- The affected resource.
- The relevant time or deployment.
- Checks that were performed.
- The key finding.
- Actions that were performed.
- Essential error or log details.
- Identifiers needed by Support.

Example:

> **Issue:** API بعد از deployment اخیر 502 می‌دهد  
> **App:** `shop-api`  
> **Checked:** runtime, deployment, logs, domain  
> **Finding:** application روی port متفاوتی listen می‌کند  
> **Tried:** restart + configuration check  
> **Relevant release:** `...`

This report should remain concise and should not turn into a long dump of logs or conversation history.

---

# 16. Security and Trust

Because the Agent may have access to a real account:

- The user should know what permissions the Agent has.
- Secrets should not be exposed unnecessarily.
- Read and write operations should be clearly distinguished.
- Sensitive operations should require confirmation.
- Destructive operations should be restricted or require stronger confirmation.
- The user should be able to view the history of important Agent operations.
- The Agent should avoid automatic action when uncertain.
- Important changes should be visible before execution.

---

# 17. Cost Optimization as Product Behavior

Cost optimization is not only a backend concern; it should be part of the product’s core behavior.

For every request, the system should select an appropriate **model, context, and number of actions** based on its complexity.

## Model Selection

Not every request should be sent to the most capable and expensive model.

Example behavior:

- FAQ and simple lookup → faster and cheaper model.
- Classification or simple query understanding → lightweight model.
- Complex reasoning or troubleshooting → stronger model.
- Deterministic tasks → where possible, no additional inference.

Model selection should balance:

- quality
- latency
- cost

---

## Context Budgeting

For every request, the system should not send:

- all documentation,
- all history,
- all account state,
- all previous Tool results

to the model.

Context should be constructed only based on what the request needs.

---

## Progressive Context Loading

The Agent should start with the minimum context required.

Only if the answer or decision requires more information should it:

- Read more documents.
- Inspect more account state.
- Load more conversation history.
- Activate a more complex Skill.

---

## Tool-call Economy

Every Tool Call should have a clear reason.

The Agent should not execute a Tool merely because the Tool exists.

Principle:

> A Tool should only be executed when its result is necessary for the answer or the next decision.

---

## Deterministic Before Generative

If an API or Tool can provide a definitive answer, an LLM should not be used to guess the same information.

---

## Cache

Cache should be used where appropriate, including for:

- Static documentation information.
- Suitable retrieval results.
- Low-change account metadata.
- Reusable results.

But cache should not produce stale answers for sensitive or dynamic data.

---

## Conversation Efficiency

In long conversations:

- Old and irrelevant context should not be continuously sent.
- Important context should be preserved.
- Repetition should be reduced.
- Token usage should be controlled without losing personalization.

---

## Stop Early

Once enough evidence exists to answer, the Agent should stop.

More thinking, more retrieval, or more Tool Calls do not always mean higher quality.

---

# 18. Proposed Behavior for Troubleshooting

User:

> اپ من بالا نمیاد.

Appropriate behavior:

1. Determine whether the account is connected.
2. Find the appropriate resource.
3. If there is ambiguity, ask only the necessary question.
4. Inspect the app state.
5. Inspect the relevant deployment or logs.
6. Build a hypothesis based on evidence.
7. Perform the next inspection if needed.
8. Explain the result.
9. Propose a fix.
10. Get approval.
11. Perform the action.
12. Verify the result.
13. If unresolved, create a Support Summary.

If a definitive answer is found at step 4 or 5, extra steps should not be executed.

---

# 19. Proposed Behavior for a Simple Question

User:

> Static IP چیست؟

Appropriate behavior:

1. Minimal retrieval.
2. Direct answer.
3. Source.
4. Stop.

No additional Plan or inspection is required.

---

# 20. Proposed Behavior for a Contextual Question

User:

> چطور env ست کنم؟

Appropriate behavior:

1. Give a short and direct answer.
2. Take the user’s CLI / Console / API preference into account.
3. If account context is available, show real services.
4. Suggest that the Agent can continue for that specific resource.

---

# 21. Proposed Behavior for Architecture Recommendation

User:

> یک Next.js دارم، PostgreSQL می‌خوام و فایل‌های کاربران هم باید ذخیره بشن.

The Agent should:

- Extract the requirements.
- Recommend suitable Liara services.
- Check whether the user already has similar resources.
- Show the proposed architecture visually.
- Specify the next steps.
- Continue the setup workflow if the user wants.

---

# 22. Core Product Principles

## Direct answer when sufficient

Simple questions should receive simple answers.

## Escalate intelligence only when necessary

Agentic workflows, stronger models, more context, and more Tools should only be used when needed.

## Ask only when needed

The Agent should not ask the user for something it can determine itself.

## Prefer solving over linking

Documentation should be a source, not a substitute for a solution.

## Context everywhere, but not all context everywhere

Personalization matters, but only relevant context should enter each interaction.

## Verify after action

An Action is not the end of the workflow; the result must be checked.

## Stop when solved

The Agent should not continue merely to appear agentic.

---

# 23. Non-goals

For the initial version, the goal is not to:

- Fully replace human Support.
- Automate every Liara operation.
- Give the Agent access to every dangerous operation.
- Build a general chat system for unrelated topics.
- Merely create a prettier semantic search experience over docs.
- Run a heavy multi-step workflow for every request.

---

# 24. Items That Must Be Verified Before Implementation

## 24.1. LLM-oriented Documentation

Liara has Markdown versions of its documentation specifically for LLMs.

We need to verify:

- Are all production docs available under `/llms`?
- Is the mapping between the original page and Markdown reliable?
- How are these files updated?
- Is there enough metadata for source attribution?
- Is this corpus alone sufficient for retrieval?
- Does semantic retrieval or Persian embedding actually improve accuracy?

References:

- https://docs.liara.ir/
- https://github.com/liara-cloud/docs
- `public/llms/`
- `public/all-links-llms.txt`
- scripts related to `generate-llms`

---

## 24.2. Current Liara Search

We need to determine exactly what the current Search covers.

Items to inspect:

- Current Meilisearch index.
- Section-level indexing.
- Synonyms and stop words.
- Platform-specific indexing.
- Quality of natural Persian queries.
- Quality of problem-oriented search.

References:

- https://github.com/liara-cloud/docs/tree/master/indexer
- `indexer/src/index.js`
- `indexer/src/crawlers/`
- `src/components/Header/index.jsx`

---

## 24.3. Liara OpenAPI

We need to determine which capabilities can be inspected or modified.

Important areas:

- Apps
- Deployments
- Logs / Reports
- Domains
- DNS
- Databases
- Object Storage
- IaaS
- Mail
- Teams / Permissions

Also:

- What is the authentication model?
- How do permissions work?
- Is limited or scoped token access possible?
- Which operations are suitable to expose as Tools?
- Which operations are better kept read-only for the hackathon?

Reference:

- https://github.com/liara-cloud/openapi

---

## 24.4. Liara CLI

We need to inspect:

- What are the main commands?
- Which official workflows does it represent?
- Which inspection and troubleshooting operations does it support?
- What is the appropriate mapping between CLI workflows and Agent actions?

Reference:

- https://github.com/liara-cloud/cli

---

## 24.5. Compose Templates

For architecture and setup recommendations, we need to determine which official templates and applications are available.

Reference:

- https://github.com/liara-cloud/compose-templates

---

## 24.6. Liara UI / Design Language

At this stage, a complete standalone public Design System has not been found.

We need to verify:

- Is there another UI Kit or package?
- Are the Console design tokens accessible?
- What are the main typography, spacing, color, and component patterns?
- Is reusing docs components appropriate for consistency?

References:

- https://github.com/liara-cloud/docs/tree/master/src/components
- `src/components/Common/`
- `@liara/platformicons`

---

## 24.7. Most Important Support Use Cases

This section must be validated using real data or information from the Liara team.

We need to determine:

- What are the most frequent tickets?
- Which tickets are caused by documentation discovery problems?
- Which problems can support automated diagnosis?
- Which categories consume the most Support team time?
- Which Skills have the highest impact?

This data should directly prioritize the MVP.

---

## 24.8. Model Options and Cost

Given the official competition criteria, model selection should be benchmarked and verified separately.

We need to determine:

- Which models provide suitable Persian quality?
- Which models are better for Tool Calling?
- Is routing between multiple models worthwhile?
- What is the minimum model required for FAQ use cases?
- What model is required for troubleshooting?
- What is the cost per conversation for different scenarios?
- What is the latency/quality trade-off?
- Are the models available on Liara AI suitable for this workload?

This decision should be based on real benchmarks, not simply model popularity.

---

# 25. Product Success Criteria

The product is not successful merely because it “gives good answers.”

The product is successful when:

- It answers simple questions quickly and cheaply.
- It activates the correct workflow for complex problems.
- The user reaches the desired outcome faster.
- Clarifying questions are fewer and more precise.
- Answers are personalized using account and context.
- The number of preventable tickets decreases.
- Remaining tickets contain more useful information.
- The user understands what the Agent did.
- Agent operations are controllable and trustworthy.
- Token, model, and Tool usage are proportional to the complexity of the problem.

---

# 26. Final Vision

The goal is not to build “ChatGPT for Liara documentation.”

The goal is to build an **Adaptive Liara Agent** where documentation is only one of its information sources.

For a simple question:

> سریع، مستقیم و مستند پاسخ می‌دهد.

For a contextual question:

> پاسخ را با توجه به account و preference کاربر شخصی‌سازی می‌کند.

For a complex problem:

> مشکل را می‌فهمد، وضعیت را بررسی می‌کند، سؤال لازم را می‌پرسد، plan می‌سازد، action انجام می‌دهد، نتیجه را verify می‌کند و در صورت نیاز مسئله را با context مفید به Support منتقل می‌کند.

Throughout this path, the main principle is:

> **The minimum cost and complexity required to reach a reliable answer or outcome.**

The best short description of the product is:

> **From documentation search to efficient problem resolution.**
