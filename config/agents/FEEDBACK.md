# FEEDBACK.md — Reaction Labels & Provenance Conventions

Phase 0 of `docs/specs/evals-and-finetuning.md`: turn daily Blather use into
training and eval signal, with as close to zero extra work as possible.

## Reaction labels (humans → clanker messages)

Reacting to a clanker message is a label. The harvest jobs read `reactions`
rows on agent-authored messages; nothing else is required.

| Reaction | Meaning | Used for |
|---|---|---|
| 👍 | Good output | Quality label (positive) |
| 👎 | Bad output — wrong, noisy, off-tone | Quality label (negative); candidate rejected side of a preference pair |
| 🎯 | Exemplary — train on this | SFT candidate, fast-tracked into dataset review |
| 🤫 | Shouldn't have spoken at all | Etiquette suite case (speak/silent ground truth) |

Notes:

- Labels only count on **agent-authored** messages; reactions between humans
  are untouched.
- 👎 and 🤫 are most valuable with a short reply saying why — the reply text
  rides along as rationale when the case enters a dataset.
- Everything still passes the GP review ritual before entering a dataset
  (`bedrock/processes/model-evals/README.md`); a 🎯 is a nomination, not a
  publication.

## Edits as preference pairs (automatic)

No convention needed: when a human overwrites an agent-set deal field
(`deal_changes`), edits an agent draft, or re-routes an agent-filed task, the
harvest treats (agent version, human version) as a preference pair with full
context. Just work normally.

## Completion logging (model gateway → API)

Completions are **not self-reported by clankers**: within-user provenance —
model, tokens, cost, refs — must come from server-side instrumentation the
agents cannot forge, or it is worthless as eval/finetune ground truth. The
gravel LLM router (which every clanker's model calls already transit)
ingests them with its own gateway identity:

```
POST /completions
X-API-Key: blather_...   (gateway service account, in COMPLETIONS_INGEST_EMAILS)
{
  "agentUserId": "<blather user id of the clanker whose call this was>",
  "sessionKey": "<same key used for /activity>",
  "model": "deepseek/deepseek-v4-flash-0731",
  "promptRef": "<opaque object-store ref>",
  "completionRef": "<opaque object-store ref>",
  "inputTokens": 1200, "outputTokens": 340,
  "latencyMs": 2150, "costUsd": 0.000036,
  "metadata": {"workload": "inbound-triage"}
}
```

Ordinary agent credentials get a 403 from this endpoint. Refs are bounded
opaque tokens (no whitespace, ≤512 chars) — prompt and completion bodies go
to the object store, never Postgres. Reads: an agent may query its own rows;
cross-agent reads require an admin/owner (non-agent) account.

## Announcement draft for #all

> New reaction conventions on clanker messages, effective now: 👍 good /
> 👎 bad / 🎯 exemplary — train on this / 🤫 shouldn't have spoken. They feed
> the model evals + finetuning pipeline (spec: docs/specs/
> evals-and-finetuning.md). React freely — a 👎 with a one-line "why" is the
> single most useful thing you can do. Nothing enters a training set without
> GP review.
