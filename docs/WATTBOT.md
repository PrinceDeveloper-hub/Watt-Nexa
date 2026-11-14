# WattBot

WattBot answers questions about a household's electricity using that household's own stored
readings and tariff. It is an assistant layered on top of the energy API — not a generic chatbot.

## What works today

| Capability | State |
| --- | --- |
| Grounded answers from real telemetry | **Working** — verified against seeded readings |
| Conversation persistence, history, delete | **Working** — tested |
| Streaming (SSE) answers | **Working** — verified end to end |
| Deterministic fallback when no provider is set/fails | **Working** — tested |
| Contextual suggested questions | **Working** — derived from device/tariff/data state |
| Product knowledge retrieval | **Working** — approved, source-labelled chunks with optional semantic retrieval and a lexical fallback |
| Page-aware suggestions | **Working** — the current screen changes starter questions and answer emphasis, never the data scope |
| Grounded alert insights | **Working** — deterministic WattBot advice attached when an alert is created |
| OpenAI adapter | **Exercised against a local OpenAI-compatible mock** (success, streaming, 429, timeout). No call with a real OpenAI account has been made — see “Verification” |
| Anthropic adapter | **Implemented, unexercised** — no key available |
| Model-driven tool calling | **Deliberately not implemented** (see “Why the model never writes SQL”) |
| Per-plan message quotas | **Working** — enforced from `subscription_plans.wattbot_messages_per_day`, tested |
| Custom date-range questions | **Working** — deterministic date parser, bounded to 366 days, tested |

Nothing above should be described as "AI-powered answers" when `WATTBOT_PROVIDER=none`: in that
mode every reply is computed deterministically from the user's data and the UI says so.

## Configuration

```dotenv
WATTBOT_PROVIDER=none            # none | openai | anthropic
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-3-5-sonnet-latest

WATTBOT_TIMEOUT_MS=20000         # per-request ceiling
WATTBOT_CONTEXT_MESSAGES=10      # prior turns included in the prompt
WATTBOT_MAX_TOKENS=700
WATTBOT_TEMPERATURE=0.3

# Optional semantic retrieval (lexical retrieval is always the fallback)
WATTBOT_EMBEDDING_PROVIDER=none      # none | openai
WATTBOT_EMBEDDING_MODEL=text-embedding-3-small
WATTBOT_RETRIEVAL_MIN_SCORE=0.28
```

Keys live only in the API process. `GET /api/v1/wattbot/status` reports whether a provider is
configured and why not, and the UI shows that instead of implying an LLM is active.

## Data flow

```
question ──► prepareTurn ──► collectFacts (scoped SQL) ──► generateAnswer
                  │                                          │
                  │                                     provider (optional)
                  │                                          │
                  └────────── persisted transcript ◄── answer (streamed)
```

1. `prepareTurn` checks conversation ownership, creates the conversation when needed, and loads a
   bounded history window.
2. `collectFacts` runs fixed, parameterised queries scoped to `homeId` for the authenticated user:
   today/yesterday/7/30-day totals, previous 7 days, current and previous month, peak power and its
   date, daily series, device status/sensors/last reading, tariff slabs and the bill estimate.
3. `generateAnswer` either calls the configured provider (streaming when requested) or produces a
   deterministic answer from those facts.
4. The user message and the answer are persisted together with metadata (`provider`, `model`,
   `latencyMs`, `fallbackReason`, `dataSource`).

### Product knowledge retrieval

`apps/api/src/services/wattbot/knowledge.ts` is the single approved corpus. It contains short
product-knowledge documents with source paths from `README.md`, `docs/HARDWARE.md`,
`docs/WATTBOT.md`, and the alert engine. `chunkKnowledgeDocuments()` splits them into stable,
retrieval-sized chunks; each chunk keeps its source, which is returned with the answer and stored
in message metadata.

Retrieval has two layers:

1. **Lexical (always available).** A small TF-style ranker scores term overlap with title weighting
   and returns nothing when the question is unrelated. No database or external service is involved.
2. **Semantic (optional).** With `WATTBOT_EMBEDDING_PROVIDER=openai` and `OPENAI_API_KEY`, the API
   embeds each chunk via the configured embedding model, stores the vector in
   `wattbot_knowledge_chunks.embedding` in MariaDB, and ranks chunks by cosine similarity at query
   time. Vectors are cached in process memory for five minutes. A question only uses semantic
   results when the top score clears `WATTBOT_RETRIEVAL_MIN_SCORE`; otherwise, or on any provider/
   database failure, it falls back to lexical retrieval.

There is no separate vector database: the corpus is small and changes rarely, so MariaDB plus an
in-process cosine scan is sufficient. A larger corpus or multiple API replicas would justify a
shared vector index, which would add an operational dependency.

Re-index after editing the corpus or changing the embedding model:

```bash
pnpm --filter @wattnexa/api kb:reindex
```

`reindexKnowledge()` is idempotent: unchanged chunks are skipped, changed text is re-embedded, and
chunks removed from the corpus are deleted. Without an embedding provider the command still refreshes
the stored text for future indexing. The server also lazily indexes an empty/stale vector table on
the first semantic question.

Update the approved documents when product contracts change so the assistant does not infer a
feature from stale documentation.

### Why the model never writes SQL

The model receives a pre-computed fact sheet, not database access, and cannot request arbitrary
queries. Tool inputs are fixed by the code path; the only variable is the user's question text.
This removes an entire class of prompt-injection-to-data-exfiltration paths: even a successful
jailbreak cannot widen the data scope beyond what `collectFacts` already collected.

## Honesty rules enforced in code

- Figures come from `collectFacts`; the system prompt forbids inventing readings, tariffs or savings.
- If no tariff is configured, WattBot asks the user to configure one and never assumes a rate.
- Bill answers show the calculation basis (energy slabs, fixed charge, tax) and are labelled
  estimates.
- Appliance-level attribution is explicitly refused: one whole-house CT cannot separate loads.
- Simulated rows are labelled as simulated in both the prompt and the answer.
- Provider timeouts, 429s, empty responses and malformed frames all degrade to the deterministic
  answer — the chat never fabricates filler content.

## Safety

- `POST /wattbot/messages` and `/messages/stream` require authentication and are rate limited to
  **20 messages/minute per user** (`wattbotLimiter`).
- Messages are validated by Zod (1–2000 chars); control characters are stripped before prompting.
- User text is wrapped in `<user_question>` delimiters with an explicit instruction that it is data,
  not instructions. Tool output and the system prompt are never echoed back.
- Conversations are scoped by `userId` on every read, continuation and delete; a foreign ID returns
  `404`.
- Provider errors are logged with the failure code only — never the prompt, payload or API key.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/wattbot/conversations` | Latest 50 conversations |
| `GET` | `/api/v1/wattbot/conversations/:id` | Transcript (max 200 messages) |
| `DELETE` | `/api/v1/wattbot/conversations/:id` | Delete conversation and messages |
| `GET` | `/api/v1/wattbot/status` | Provider configuration status |
| `GET` | `/api/v1/wattbot/suggestions?homeId=&page=` | Contextual starter questions for the current screen |
| `GET` | `/api/v1/wattbot/series?homeId=&days=7\|30` | Daily totals for the sidebar chart |
| `POST` | `/api/v1/wattbot/messages` | Non-streaming answer |
| `POST` | `/api/v1/wattbot/messages/stream` | SSE: `meta`, `delta`, `done`, `error` |

## Verification

No paid API key was available in this environment, so the wire protocol was verified two ways:

1. **Real OpenAI endpoint, invalid key** — `POST https://api.openai.com/v1/chat/completions` returns `401`;
   WattBot logged `failure: unavailable` and answered from data with `fallbackReason: "unavailable"`.
   The key never appeared in the logs.
2. **Local OpenAI-compatible mock** (`apps/api/scripts/mock-openai.ts`) for the paths a real key is
   needed for:

```bash
# terminal 1
pnpm --filter @wattnexa/api exec tsx scripts/mock-openai.ts

# terminal 2
WATTBOT_PROVIDER=openai OPENAI_API_KEY=sk-local-mock \
OPENAI_BASE_URL=http://localhost:4801/v1 pnpm --filter @wattnexa/api dev
```

| Scenario | Result |
| --- | --- |
| Non-streaming success | `provider: openai`, `model: gpt-4o-mini`, `fallbackReason: null` |
| Streaming success | 3 `delta` frames then `done` with `provider: openai`; persisted metadata `{model, latencyMs: 198, streamed: true}` |
| Provider 429 | `provider: rule_based`, `fallbackReason: rate_limited`, grounded answer |
| Provider slower than `WATTBOT_TIMEOUT_MS=2000` | answered in 2194 ms (`fallbackReason: timeout`) instead of hanging |
| API key in logs | 0 occurrences |

Still unverified: a successful generation from a **real** OpenAI account, and any Anthropic call.
The mock proves the request/parse/stream/fallback code, not OpenAI's model quality or your account's
quota.

## Quotas

WattBot is metered from the live plan catalogue, so an admin change to a plan takes effect on the
next message with no deploy:

| Plan | `wattbotMessagesPerDay` | Behaviour |
| --- | --- | --- |
| Free | 0 | Not included — `403 WATTBOT_NOT_IN_PLAN` |
| Plus | 20 | 20 questions per UTC day |
| Pro | 100 | 100 questions per UTC day |

**`0` means "not included", not "unlimited".** This matches the catalogue copy ("Plus … and WattBot",
"WattBot (20 messages/day)"); an admin can still raise a plan's limit at any time.

- Only **user questions** count. Assistant replies, regenerated answers and failed requests do not.
- The day boundary is **00:00 UTC**, matching how the rest of the product buckets days. `resetAt` in
the payload is that instant.
- The check runs in `assertWattbotQuota` **before** the conversation row is created and before any
  provider call, so a blocked message costs one count query and never spends provider tokens.
- Both `/messages` and `/messages/stream` are covered. A blocked stream returns JSON
  (`application/json`) rather than opening an event stream.
- An account with no active subscription falls back to the **Free** plan — never to Pro.

Responses carry the balance so the UI never has to guess:

```json
{
  "planSlug": "plus", "planName": "Plus", "limitPerDay": 20,
  "usedToday": 8, "remainingToday": 12,
  "resetAt": "2026-11-15T00:00:00.000Z", "included": true
}
```

It is returned by `GET /wattbot/status`, in the non-streaming response, and in the SSE `meta` and
`done` frames. Exhaustion is `429 WATTBOT_QUOTA_EXCEEDED`, exclusion is `403 WATTBOT_NOT_IN_PLAN`;
both include the quota object in `error.details`.

Known limitation: the check-then-insert is not atomic, so two simultaneous requests can both pass at
the boundary. The 20/min per-user limiter bounds the overshoot; closing it fully would need a
serialising transaction on the subscription row.

## Custom date ranges

Questions that name a window are parsed deterministically by `services/wattbot/daterange.ts` and
aggregated for exactly that window — no model involvement in choosing the range, so a prompt cannot
widen it.

Supported phrasings:

| Question | Window (UTC) |
| --- | --- |
| `between 2026-11-01 and 2026-11-07` | 1–7 Nov |
| `from march 1 to march 7` | 1–7 Mar of the most recent occurrence |
| `March 2026` | the whole month |
| `on 2026-11-08` / `5 June` | that single day |
| `1-7 march`, `march 1-7` | 1–7 Mar |
| `01/03/2026 to 07/03/2026` | 1–7 Mar (day-first) |
| `dec 20 to jan 5` | rolls into the following January |

Rules:

- Ranges are **half-open UTC windows**, ending the day after the date the user named.
- A missing year means the **most recent occurrence**, never a future date.
- Maximum span is **366 days**; longer requests are refused with an explanation rather than truncated.
- A reversed range is reported as unreadable, with an example of the accepted format.
- Buckets are daily for windows up to 62 days, monthly beyond that.
- The response includes the total, stored sample count, average per day, peak power and the total for
the **immediately preceding equally long window** (when that window has data).
- **If the window has no stored samples, WattBot says so and refuses to report `0 kWh`** — no data is
  not the same as zero consumption.

The parsed window and its aggregates are also added to the model's fact sheet, so with a provider
configured the prose comes from the same numbers.

## Known limits

- Windows are limited to what the parser can recognise; relative phrasing like “the week before
  Diwali” or “since my last bill” is not resolved.
- Chat charts are still limited to a 7-day bar summary in the sidebar; custom ranges return text
  totals plus a per-day/per-month breakdown, not a chart.
- Token usage and cost are not tracked.
- Quota enforcement is check-then-insert, so a burst of simultaneous requests can slightly exceed the daily limit (see Quotas).
- Semantic retrieval has only been exercised through its lexical fallback and unit-level cosine tests;
  no real embedding key was available in this environment. Provider-model changes require a re-index.
- The page context is a screen name only (for example `energy`), not the alert or device currently
  open; alert explanations use the alert text passed by the notification popup.
- Alerts get a deterministic WattBot insight at creation time. A provider is not called per alert,
  by design, so the insight is not model-written prose.
