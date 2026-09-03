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

## Completion capture (not live yet — arrives with the gateway wiring)

Model-call provenance is captured by the gravel LLM router, not by
clankers: within-user provenance — model, tokens, cost, refs — must come
from server-side instrumentation the agents cannot forge, or it is
worthless as eval/finetune ground truth. **Nothing to do here as a clanker
author**; do not POST to `/completions` — ordinary agent credentials get
a 403 by design.

The router-side writer (bodies to MinIO under a dedicated namespace,
server-minted opaque refs, one record per call under the gateway identity)
is tracked in pebblebed/gravel#7. Until it lands and
`COMPLETIONS_INGEST_EMAILS` names the router's service account, the
endpoint refuses all writes.

What the blather API already enforces: gateway-only ingestion, refs as
bounded opaque tokens (bodies never enter Postgres), agent self-read only,
and admin/owner-gated cross-agent reads.

## Announcement draft for #all

> New reaction conventions on clanker messages, effective now: 👍 good /
> 👎 bad / 🎯 exemplary — train on this / 🤫 shouldn't have spoken. They feed
> the model evals + finetuning pipeline (spec: docs/specs/
> evals-and-finetuning.md). React freely — a 👎 with a one-line "why" is the
> single most useful thing you can do. Nothing enters a training set without
> GP review.
