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

## Completion logging (clankers → API)

Every model call a clanker makes should be logged so trajectories can be
replayed and joined to outcomes:

```
POST /completions
X-API-Key: blather_...
{
  "sessionKey": "<same key used for /activity>",
  "model": "deepseek/deepseek-v4-flash-0731",
  "promptRef": "<object-store ref>",
  "completionRef": "<object-store ref>",
  "inputTokens": 1200, "outputTokens": 340,
  "latencyMs": 2150, "costUsd": 0.000036,
  "metadata": {"workload": "inbound-triage"}
}
```

Prompt and completion bodies go to the object store; the row carries refs
only. Reuse the `/activity` `sessionKey` so completions join to actions.

## Announcement draft for #all

> New reaction conventions on clanker messages, effective now: 👍 good /
> 👎 bad / 🎯 exemplary — train on this / 🤫 shouldn't have spoken. They feed
> the model evals + finetuning pipeline (spec: docs/specs/
> evals-and-finetuning.md). React freely — a 👎 with a one-line "why" is the
> single most useful thing you can do. Nothing enters a training set without
> GP review.
