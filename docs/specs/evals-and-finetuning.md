# Clanker Evals & Finetune Datasets — Plan

Status: **draft for review** · Owner: kma · Companion doc: `bedrock/processes/model-evals/README.md` (firm-side process, labeling, data placement)

## Why

Two pressures, one pipeline:

1. **Model selection.** `model-value-ranking.md` ranks models by AA-score-per-dollar, but a generic intelligence index tells us little about whether a model can triage Pebblebed's cold inbound or write a diligence memo Keith would sign. We need per-workload evals so the value ranking's denominator (price) can be paired with a numerator we actually believe (quality *on our tasks*).
2. **Embedding our preferences.** The clankers accumulate corrections daily — GPs edit their drafts, reject their deal-stage changes, react to their channel messages — and today all of that signal evaporates. Captured properly, it is simultaneously eval ground truth and finetune data.

The strategic play the value ranking implies: the cheap open-weight tier (DeepSeek V4 Flash, GLM-5.3-Flash, Qwen3.8, MiMo) is 10–100× cheaper per token than the frontier closed tier. If finetuning closes the quality gap *on our specific workloads*, the fleet runs at a fraction of the cost. Evals are how we know whether it did.

## Workloads under evaluation

One eval suite per clanker role, plus two cross-cutting suites. Each row notes its grading style — this determines build cost and ordering.

| Suite | Clanker | Task shape | Grading |
|---|---|---|---|
| `inbound-triage` | irma | Classify + route cold inbound (invest / pass / VC / LP / spam), draft pass emails | **Deterministic** labels + rubric on drafts |
| `metrics-extract` | portia | Extract `portfolio_metrics` fields from founder updates, board decks, KPI form replies | **Deterministic** field-level match |
| `diligence` | dilligence | Company research memo from a deal packet | LLM-judge rubric + fact checks against bedrock |
| `sourcing` | sourcy | Rank papers/repos/companies for relevance to `bedrock/domains/*.yaml` theses | Graded relevance labels |
| `social-signal` | aura | Summarize/escalate from a Twitter/X firehose slice: what's real, what's noise, what needs a GP ping | Graded escalation labels + dedup penalty |
| `etiquette` | all | Given channel context: respond or stay silent, and how | Deterministic (speak/silent) + rubric |
| `agent-loop` | all | End-to-end replay: task queue discipline, tool-call correctness against the Blather API | Deterministic end-state assertions |

Notes:

- `metrics-extract` and `inbound-triage` come first: ground truth already exists (the `portfolio_metrics` table with `source`/`confidence`, and years of Gmail pass/reply history via the `pass-check` skill) and grading is mechanical. They calibrate the harness before we trust any LLM-judge suite.
- `etiquette` is `config/agents/ETIQUETTE.md` converted from prose into test cases. It is the suite most likely to differentiate models in practice — "knows when to shut up" doesn't show up in any public benchmark, and it's half of what makes a clanker tolerable in a group chat.
- `agent-loop` reuses the existing test infrastructure: the PGlite API harness (`createApp(db)` factory, WS manager mocks) already lets us stand up a full Blather workspace in-process. A replay case is: seed workspace state → let the candidate model drive the real HTTP API with the clanker's actual system prompt (SOUL/HEARTBEAT) → assert on end state (task transitioned, deal fields correct, no messages posted where silence was correct, no etiquette violations).

## Eval harness

A small Python package — `evals/` at the blather repo root — in the spirit of simplicity over framework weight:

```
evals/
  pyproject.toml          # uv-managed, minimal deps (httpx, pyyaml, pydantic)
  harness/
    runner.py             # load suite → run cases (async, provider-parallel) → score → report
    providers.py          # one OpenRouter client covers nearly the whole candidate list; Anthropic direct for Claude
    graders/
      exact.py            # label / field-level match, per-field partial credit
      rubric.py           # LLM-judge with pinned judge model + rubric prompt; judge outputs per-criterion scores
      pairwise.py         # A/B preference judge (position-debiased: judge both orders)
      replay.py           # drives the agent-loop suite against the PGlite-backed API
  suites/
    inbound-triage/
      suite.yaml          # task description, grader config, judge rubric
      cases/              # POINTERS ONLY — case ids + object-store refs, never raw content
    ...
  reports/                # gitignored; JSON per run: per-case scores, tokens, latency, cost
```

Design decisions:

- **Cases are content-addressed pointers.** Raw case content (emails, decks, transcripts) lives in the object store (MinIO — already provisioned, see bedrock `MINIO_SETUP.md`), never in git. Same rule as `network/linkedin/`: repo holds ids + fetch code. This is non-negotiable for the inbound and social suites, which are full of third-party personal data.
- **Frozen judge, versioned rubrics.** Every rubric suite pins a judge model + rubric version in `suite.yaml`; scores are only comparable within a (judge, rubric) pair. Judge upgrades are a deliberate migration with a re-score of the golden set, not a drift.
- **Judge calibration is part of Phase 1, not an afterthought.** Before trusting a rubric suite: run the judge over ~30 cases that humans have already scored, check agreement (target ≥0.8 on pass/fail, directionally consistent rankings). The human scores come out of the labeling ritual in the bedrock process doc.
- **Every run records cost.** Tokens in/out, latency, dollars at current OpenRouter prices. The headline output per model per suite is a (quality, $/case) point; the fleet-level artifact is a quality-vs-cost frontier per workload — the workload-specific successor to `model-value-ranking.md`.
- **Temporal holdout.** Suites split by date: cases older than the split are eligible for finetune training, newer cases are eval-only. This is the one split discipline that prevents us from quietly training on the test set as the pipeline grows.

Sizing: 30–50 golden cases per suite to start (enough to rank models with confidence intervals worth reading; small enough to hand-verify every label), growing continuously from production capture.

## Provenance capture (the prerequisite for everything)

Today `agent_activity_log` records *that* an agent acted; nothing records *what the model saw and produced*. Both evals (replay cases) and finetunes (trajectories) need that. Schema addition in `@blather/db`:

```
agent_completions
  id, agent_user_id, session_key      -- joins to agent_activity_log
  model                                -- e.g. "deepseek/deepseek-v4-flash-0731"
  prompt_ref, completion_ref           -- object-store refs (content lives in MinIO, not Postgres)
  input_tokens, output_tokens, latency_ms, cost_usd
  created_at
```

Plus three feedback channels that turn daily use into labels, cheapest first:

1. **Reactions as labels.** A GP 👍/👎 (and a small reserved set, e.g. 🎯 = "exemplary, use for training") on a clanker message is already stored in `reactions`; we just start treating it as a label. Zero new UI.
2. **Edits as preference pairs.** `deal_changes` already captures agent-attributed field diffs; when a human overwrites an agent's value within a window, that's a (rejected, chosen) pair with full context. Same pattern extends to message edits and task re-routing.
3. **Outcomes as delayed labels.** Deal advanced past screening / pass email actually sent / sourced paper later cited in a memo — harvested weekly from Attio + Gmail + bedrock by a batch job, joined back to the originating `session_key`.

## Finetune datasets

Three dataset families, assembled by generation scripts in `evals/datasets/` (code in git, output in MinIO under `datasets/{family}/{version}/`, manifest checked into git with counts + content hashes):

1. **SFT trajectories** — (system prompt, workspace context, tool-call sequence, final message) tuples in OpenAI-messages-with-tools format (what every open-model finetune stack accepts). Sources: human-authored exemplars (GP-written pass emails, Keith's memos in `bedrock/portfolio/*/investment-memo.md`, VOICE.md-conformant writing), plus agent trajectories that earned 🎯 or passed outcome checks. Target: ~1–2k high-quality trajectories per workload before first run; quality over volume.
2. **Preference pairs (DPO/KTO)** — (context, chosen, rejected) from the edit stream and reaction stream above. This is the family that most directly "embeds our preferences," and it's the one no amount of prompt engineering replicates.
3. **Voice conditioning** — per-pebble rewrite pairs (neutral draft → VOICE.md-conformant final), sourced from the same edit stream filtered to authored prose. Kept separate so voice can be a LoRA/adapter per pebble rather than baked into the base tune.

Finetune targets: open-weight models only, chosen from the top of the value ranking with clean licenses — Qwen3.8 27B and DeepSeek V4 Flash are the obvious first candidates (verify the FP-quantized route caveats and license terms noted in the ranking before committing GPU time). Closed models are eval-only baselines.

Hygiene, enforced by the generation scripts and spelled out in the bedrock process doc: strip credentials/API keys, drop anything from `#private`/DM channels unless explicitly whitelisted, third-party PII stays in the inbound suites only (never in voice/SFT sets that might be shared with a training provider), and every dataset version has a manifest naming its sources so we can answer "is X in the training data?" later.

## Rollout phases

**Phase 0 — capture (unblocks everything else, ~days).** `agent_completions` migration; reaction-label conventions announced in `#all`; weekly outcome-harvest job. Ship this first — every week without it is a week of training signal lost.

**Phase 1 — harness + deterministic suites.** `evals/` package, OpenRouter + Anthropic providers, `metrics-extract` and `inbound-triage` suites with 30–50 hand-verified cases each (backfilled from `portfolio_metrics` rows and Gmail history). First deliverable: a real quality-vs-cost table across ~10 models from the value ranking, replacing AA-score with our numbers for these two workloads. Judge-calibration set labeled in the same pass.

**Phase 2 — rubric + replay suites.** `diligence`, `sourcing`, `etiquette` (rubrics reviewed by GPs against the labeled calibration set), then `agent-loop` on the PGlite harness. At the end of Phase 2 we can rank any new model across the whole fleet in an afternoon of compute.

**Phase 3 — first finetune.** Assemble SFT v1 for `inbound-triage` (highest volume, cheapest to validate, most deterministic grading), tune Qwen3.8-27B-class model, eval against Phase 1 baselines. Deploy behind **shadow mode**: the tuned model runs alongside the incumbent on live traffic, outputs logged to `agent_completions` but not posted; a week of shadow diffs is the promotion gate.

**Phase 4 — preference tuning + cadence.** DPO on the accumulated pair stream; voice adapters; re-eval ritual wired to the same daily refresh that updates `model-value-ranking.md` — a new model entering the ranking's top tier automatically gets queued for the eval suite.

## Open questions for review

- **Finetune substrate:** rent-a-GPU + open stack (Axolotl/torchtune — more control, PyTorch-native, fits our tooling) vs. a managed tuning API (Together/Fireworks — faster to first result, but our preference data transits a third party). Leaning open stack for exactly the data-custody reason; worth a GP call since preference pairs contain deal flow.
- **Where eval compute runs:** the fleet host is busy; a scheduled off-peak run is probably fine at 30–50 cases/suite, but Phase 2 replay suites are heavier.
- **Whether `social-signal` is worth a golden set now** or waits until aura's workload stabilizes — its ground truth is the most subjective of the seven.
