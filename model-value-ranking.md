# Model value ranking

Last substantive update: **2026-09-03**
Metric version: **v1 — input-price value**

This artifact ranks broadly frontier-competitive language models by:

\[
\text{Value} = \frac{\text{Artificial Analysis Intelligence Index}}{\text{uncached input price in USD per 1M tokens}}
\]

The inclusion floor is an Artificial Analysis Intelligence Index score of **35**. For models with multiple reasoning settings, the score is the best currently scored configuration exposed in the live data, unless that setting lacks comparable public access or pricing; in that case, the strongest generally available scored configuration is used and identified. Prices are standard, non-batch OpenRouter input prices; free endpoints are excluded rather than treated as infinite value. Open and proprietary models are included.

## Current ranking

| Rank | Model | Access | AA score | Input $/1M | Score / $ | Note |
|---:|---|:---:|---:|---:|---:|---|
| 1 | [Ling 3.0 Flash](https://openrouter.ai/inclusionai/ling-3.0-flash) | Open | 37.8 | $0.021 | **1,800.00** | Extraordinary sticker-price value; only narrowly clears the quality floor. |
| 2 | [Solar Pro 4](https://openrouter.ai/upstage/solar-pro4) | API | 41.6 | $0.030 | **1,386.67** | Very low input price; API-only in the current catalog. |
| 3 | [DeepSeek V4 Flash 0731](https://openrouter.ai/deepseek/deepseek-v4-flash-0731) | Open | 51.8 | $0.050 | **1,036.00** | AA configuration: Reasoning, Max Effort. Cheapest standard route is now non-promotional FP8; validate endpoint accuracy for critical workloads. |
| 4 | [GLM-5.3-Flash](https://openrouter.ai/z-ai/glm-5.3-flash) | Open | 57.5 | $0.075 | **766.67** | Reasoning model; launch price is 50% off through 2026-09-09 and AA finds it unusually verbose. |
| 5 | [Qwen3.8-Flash-Next](https://artificialanalysis.ai/models/qwen3-8-flash-next) | Open* | 56.0 | $0.150 | **373.33** | AA scored the reasoning open-weight preview; price is the non-promotional managed Qwen3.8 Flash API based on it. |
| 6 | [MiMo-V2.5](https://openrouter.ai/xiaomi/mimo-v2.5) | Open | 38.0 | $0.140 | **271.43** | Strong low-cost worker; below the 50+ driver tier. |
| 7 | [GPT-5.6 Luna](https://openrouter.ai/openai/gpt-5.6-luna) | API | 52.3 | $0.200 | **261.50** | OpenRouter price is materially below the provider-direct price. |
| 8 | [Hy3 Preview](https://openrouter.ai/tencent/hy3-preview) | Open | 42.2 | $0.180 | **234.44** | Preview endpoint; recheck pricing at GA. |
| 9 | [GPT-5.4 Nano](https://openrouter.ai/openai/gpt-5.4-nano) | API | 39.7 | $0.200 | **198.50** | Cheap closed-model baseline. |
| 10 | [Gemini 3.8 Flash](https://openrouter.ai/google/gemini-3.8-flash) | API | 59.0 | $0.375 | **157.33** | AA configuration: high reasoning. Promotional Flex route is 50% off; exceptionally fast but very verbose in AA's evaluation. |
| 11 | [MiniMax M3](https://openrouter.ai/minimax/minimax-m3) | Open* | 45.4 | $0.300 | **151.33** | Weights available; confirm commercial-license terms. |
| 12 | [Gemini 3.7 Flash](https://openrouter.ai/google/gemini-3.7-flash) | API | 56.0 | $0.375 | **149.33** | Strong closed-model value; narrowly ahead of Qwen3.8 27B on this metric. |
| 13 | [Qwen3.8 27B](https://openrouter.ai/qwen/qwen3.8-27b) | Open | 52.0 | $0.350 | **148.57** | AA configuration: xhigh. Cheapest standard route is non-promotional FP8. |
| 14 | [Qwen3.6 27B](https://openrouter.ai/qwen/qwen3.6-27b) | Open | 37.7 | $0.289 | **130.45** | Older 27B Qwen; cheapest standard route is non-promotional FP4. |
| 15 | [GLM-5.2](https://openrouter.ai/z-ai/glm-5.2) | Open | 52.6 | $0.4144 | **126.93** | Promotional FP8 route (70.4% off); strong value from the prior GLM generation. |
| 16 | [Gemini 3.5 Flash Lite](https://openrouter.ai/google/gemini-3.5-flash-lite) | API | 37.4 | $0.300 | **124.67** | Older but still cost-competitive. |
| 17 | [Qwen3.7 Plus](https://openrouter.ai/qwen/qwen3.7-plus) | API | 39.4 | $0.320 | **123.13** | Hosted/API configuration. |
| 18 | [MiMo-V2.5 Pro](https://openrouter.ai/xiaomi/mimo-v2.5-pro) | Open | 42.9 | $0.435 | **98.62** | More capable than base MiMo, but worse by this metric. |
| 19 | [Inkling Small](https://openrouter.ai/thinkingmachines/inkling-small) | Open | 41.2 | $0.450 | **91.56** | Open-weight multimodal option. |
| 20 | [Kimi K2.6](https://openrouter.ai/moonshotai/kimi-k2.6) | Open | 45.1 | $0.5415 | **83.29** | Promotional routed price (43% off); superseded on quality by Kimi K3. |
| 21 | [DeepSeek V4 Pro 0813](https://openrouter.ai/deepseek/deepseek-v4-pro-0813) | Open | 53.2 | $0.660 | **80.61** | Slightly stronger than Flash, with much lower input-price value. |
| 22 | [Nemotron 3 Ultra](https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b) | Open | 38.3 | $0.500 | **76.60** | Non-Chinese open-weight option; cheapest standard route is non-promotional FP4. |
| 23 | [Kimi K2.7 Code](https://openrouter.ai/moonshotai/kimi-k2.7-code) | Open | 43.0 | $0.660 | **65.15** | Coding-specialized rather than general-purpose; cheapest standard route is non-promotional INT4. |
| 24 | [GPT-5.4 Mini](https://openrouter.ai/openai/gpt-5.4-mini) | API | 40.9 | $0.750 | **54.53** | Closed-model mid-tier baseline. |
| 25 | [Muse Spark 1.3](https://openrouter.ai/meta/muse-spark-1.3) | API | 61.0 | $1.250 | **48.80** | AA configuration: xhigh, the strongest generally available setting; max scores 62 but remains in limited preview. |
| 26 | [Muse Spark 1.2](https://openrouter.ai/meta/muse-spark-1.2) | API | 56.8 | $1.250 | **45.44** | Strong capability but middling input-price value. |
| 27 | [Inkling](https://openrouter.ai/thinkingmachines/inkling) | Open | 42.3 | $0.950 | **44.53** | Full model trails Inkling Small on input-price value. |
| 28 | [GLM-5.3](https://openrouter.ai/z-ai/glm-5.3) | API | 59.5 | $1.400 | **42.50** | Newly measurable release; API access is live, while weights remain unavailable. |
| 29 | [Grok Build 0.1](https://openrouter.ai/x-ai/grok-build-0.1) | API | 40.7 | $1.000 | **40.70** | Coding-agent specialist. |
| 30 | [Gemini 3.5 Flash](https://openrouter.ai/google/gemini-3.5-flash) | API | 52.0 | $1.500 | **34.67** | Superseded on value by Gemini 3.7 Flash. |
| 31 | [Grok 4.6](https://openrouter.ai/x-ai/grok-4.6) | API | 60.9 | $2.000 | **30.45** | Tied with GPT-5.6 Sol on the input-price metric. |
| 31 | [GPT-5.6 Sol](https://openrouter.ai/openai/gpt-5.6-sol) | API | 60.9 | $2.000 | **30.45** | Promotional routed price (50% off); tied with Grok 4.6. |
| 33 | [Qwen3.8 Max](https://openrouter.ai/qwen/qwen3.8-max) | API | 58.1 | $2.000 | **29.05** | Hosted flagship configuration. |
| 34 | [Qwen3.8 2.4T A95B](https://openrouter.ai/qwen/qwen3.8-2.4t-a95b) | Open | 57.7 | $2.000 | **28.85** | Highest-scoring open-weight Qwen. |
| 35 | [GPT-5.6 Terra](https://openrouter.ai/openai/gpt-5.6-terra) | API | 56.6 | $2.000 | **28.30** | Balanced closed-model tier. |
| 36 | [Claude Sonnet 5](https://openrouter.ai/anthropic/claude-sonnet-5) | API | 55.3 | $2.000 | **27.65** | Anthropic's best input-price value in this table. |
| 37 | [Kimi K3](https://openrouter.ai/moonshotai/kimi-k3) | Open | 59.7 | $3.000 | **19.90** | Highest-quality established open-weight model, but not cheap. |
| 38 | [Claude Opus 5](https://openrouter.ai/anthropic/claude-opus-5) | API | 63.1 | $5.000 | **12.62** | Still high quality, but no longer the table's quality leader. |
| 39 | [Claude Fable 5.1](https://openrouter.ai/anthropic/claude-fable-5.1) | API | 66.0 | $10.000 | **6.60** | AA configuration: Adaptive Reasoning, Max Effort, Default Fallback. Highest quality in the table, but expensive and very verbose. |
| 40 | [Claude Fable 5](https://openrouter.ai/anthropic/claude-fable-5) | API | 62.1 | $10.000 | **6.21** | Superseded by Fable 5.1; lowest ratio in the qualifying set. |

\* Open weights with licensing or commercial-use caveats; inspect the model license before deployment.

## Unranked promotional / free access

These models clear the quality floor and have measurable token pricing, but their current input price is zero. They are kept outside the ranking rather than assigned infinite value.

| Model | Access | AA score | Current input $/1M | Standard list $/1M | Note |
|---|:---:|---:|---:|---:|---|
| [Apodex 1.1](https://artificialanalysis.ai/models/apodex-1-1) | API | 44.0 | $0.00 | $0.300 | Proprietary reasoning model; the provider's free campaign has no published end date. At list price its reference ratio would be 146.67, but it remains unranked until paid billing resumes. |

## Pending / watchlist

These releases are noteworthy but do not yet have every datum needed for a defensible row.

| Model | Release/pricing status | Missing item |
|---|---|---|
| [GPT-5.6 Cyber](https://developers.openai.com/api/docs/models/gpt-5.6-cyber) | Restricted Daybreak access; official uncached input price $12.50/M, not marked promotional | AA Intelligence Index score |
| [Seed 2.1 Turbo](https://openrouter.ai/bytedance-seed/seed-2-1-turbo) | OpenRouter input price $0.50/M | AA Intelligence Index score |
| [Thomson](https://www.thomsonreuters.com/en/press-releases/2026/august/thomson-reuters-leverages-its-world-class-data-assets-to-launch-its-own-frontier-model) | Announced 2026-08-24; domain-specialized deployment is initially inside CoCounsel, with a small academic/non-commercial open-weight variant planned | AA Intelligence Index score and public per-token API price |
| [Hy4 preview](https://www.tencent.com/tencent-releases-and-open-sources-tencent-hy4-preview/) | Released open-weight on 2026-08-28; OpenRouter input price $0.834/M on a non-promotional FP8 route | AA Intelligence Index score |
| [Endeavor 1.0](https://flower.ai/blog/2026-09-01-introducing-endeavor-1.0) | Frontier-generalist preview released 2026-09-01; managed API and private deployment are available only by request, with no public per-token price | AA Intelligence Index score and public per-token API price |
| [Mercury 2.5 Preview](https://openrouter.ai/inception/mercury-2.5-preview) | Exclusive OpenRouter preview released 2026-09-01; promotional input price $0.040/M (80% off) | AA Intelligence Index score |
| [Qwen3.8-Max-0902](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max) | Upgraded snapshot released 2026-09-02; no OpenRouter route yet, while official US/global-region input pricing is $1.65/M and is not marked promotional | AA Intelligence Index score |

## Interpretation

This metric answers a narrow question: **how much benchmark score is purchased per dollar of uncached input?** It deliberately ignores output and reasoning-token prices, token consumption, retries, latency, cache economics, and task success rate. Models that are terse or cheap on input but expensive or verbose on output can look better here than they do in a real agent workload.

Useful operational slices:

- Raw ratio leaders: Ling 3.0 Flash, Solar Pro 4, and DeepSeek V4 Flash 0731.
- Best 50+ score value: DeepSeek V4 Flash 0731, using OpenRouter's cheapest listed standard route.
- Best closed 50+ score value: GPT-5.6 Luna at OpenRouter pricing.
- Best 55+ score value: GLM-5.3-Flash at its promotional launch price.
- Highest-quality open-weight model: Kimi K3, while Qwen3.8 2.4T A95B is close and slightly cheaper.

The earlier ranking based on the actual full Artificial Analysis evaluation bill remains a better proxy for total agent economics. This input-only version is retained because it is simple, reproducible, and was explicitly requested.

## Sources and conventions

- Scores: [Artificial Analysis model comparison](https://artificialanalysis.ai/models), Intelligence Index v4.1.1, accessed 2026-09-03. The live leaderboard describes nine constituent evaluations and independently measured model performance.
- Prices: [OpenRouter public model catalog](https://openrouter.ai/api/v1/models) and live model/provider pages, accessed 2026-09-03. The cheapest listed paid standard endpoint is used as the uncached input price; batch, free, and specially named contributor variants are excluded. Quantized and Flex routes are allowed but flagged when materially relevant because endpoint accuracy or service priority can differ.
- Promotion status: OpenRouter marked the ranked $2.00/M GPT-5.6 Sol route as 50% off and the $0.5415/M Kimi K2.6 route as 43% off on 2026-08-23. GLM-5.3-Flash launched at 50% off ($0.075/M input) through 2026-09-09; its [official pricing page](https://docs.z.ai/guides/overview/pricing) and OpenRouter endpoints agree. GLM-5.2's selected $0.4144/M FP8 route was 70.4% off on 2026-09-02. Apodex 1.1 is temporarily free against a $0.30/M standard list price, with no published campaign end date; Mercury 2.5 Preview is 80% off at $0.040/M. Gemini 3.8 Flash's cheapest Flex route is 50% off at $0.375/M. The selected DeepSeek V4 Flash, Qwen3.8 Flash, Qwen3.6 27B, Kimi K2.7 Code, Nemotron 3 Ultra, Muse Spark 1.3, and Hy4 preview routes were not marked promotional when last checked. Promotional prices are retained but flagged rather than treated as durable list prices; promotional-free models are unranked.
- Release verification: official [GLM-5.3 documentation](https://docs.z.ai/guides/llm/glm-5.3) and [Qwen3.8 27B model card](https://huggingface.co/Qwen/Qwen3.8-27B), accessed 2026-08-19.
- New-release verification: official [GPT-5.6 Cyber model page](https://developers.openai.com/api/docs/models/gpt-5.6-cyber), accessed 2026-08-20. The model requires separate Daybreak approval; its official uncached input price is $12.50/M and is not marked promotional.
- New-release verification: official [Thomson Reuters announcement](https://www.thomsonreuters.com/en/press-releases/2026/august/thomson-reuters-leverages-its-world-class-data-assets-to-launch-its-own-frontier-model), accessed 2026-08-25. Thomson is initially domain-specialized and product-embedded, with no public token API price or AA score.
- New-release verification: official [GLM-5.3-Flash announcement](https://z.ai/blog/glm-5.3-flash), [Artificial Analysis score](https://artificialanalysis.ai/models/glm-5-3-flash), and [Z.AI API pricing](https://docs.z.ai/guides/overview/pricing), accessed 2026-08-26. The model is open-weight under MIT; AA scored its reasoning configuration.
- New-release verification: official [Qwen3.8-Flash-Next announcement](https://qwen.ai/blog?id=qwen3.8-flash-next), [Artificial Analysis score](https://artificialanalysis.ai/models/qwen3-8-flash-next), and [OpenRouter Qwen3.8 Flash pricing](https://openrouter.ai/qwen/qwen3.8-flash), accessed 2026-08-27. Qwen states that the managed `qwen3.8-flash` API is the production version based on the open-weight Flash-Next preview.
- New-release verification: official [Tencent Hy4 preview announcement](https://www.tencent.com/tencent-releases-and-open-sources-tencent-hy4-preview/), official [model repository](https://github.com/Tencent-Hunyuan/Hy4-preview), and [OpenRouter pricing](https://openrouter.ai/tencent/hy4-preview), accessed 2026-08-28. The 770B/49B-active Apache-2.0 release defaults to high reasoning and remains unranked pending an AA score.
- New-release verification: provider-supplied [Apodex 1.1 announcement](https://www.prnewswire.com/news-releases/apodex-1-1-moves-ai-beyond-deep-research-to-verifiable-execution-302866271.html), [Artificial Analysis score](https://artificialanalysis.ai/models/apodex-1-1), and official [Apodex API pricing](https://platform.apodex.ai/docs/pricing), accessed 2026-09-01. AA scored the proprietary 397B flagship reasoning model at 44; it is unranked while the provider's token price is promotionally free.
- New-release verification: official [Endeavor 1.0 announcement](https://flower.ai/blog/2026-09-01-introducing-endeavor-1.0), accessed 2026-09-01. Flower describes a broad frontier generalist in managed/private preview, but has not published an AA score or per-token price.
- New-release verification: live [Mercury 2.5 Preview model page](https://openrouter.ai/inception/mercury-2.5-preview) and provider endpoint, accessed 2026-09-01. The OpenRouter-exclusive Inception preview is priced at a promotional $0.040/M input (80% off) and remains unranked pending an AA score.
- New-release verification: official [Claude Fable 5.1 and Mythos 5.1 announcement](https://www.anthropic.com/claude-fable-and-mythos-5-1), [Artificial Analysis score](https://artificialanalysis.ai/models/claude-fable-5-1/), and [OpenRouter pricing](https://openrouter.ai/anthropic/claude-fable-5.1), accessed 2026-09-02. AA's most capable comparable configuration is Adaptive Reasoning at Max Effort with Default Fallback (66); its $10/M input routes are not marked promotional. Mythos 5.1 is the same underlying model with restricted safeguards/access, so it is not duplicated as a separate row.
- New-release verification: official [Gemini 3.8 Flash API model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [Artificial Analysis score](https://artificialanalysis.ai/models/gemini-3-8-flash/), and [OpenRouter pricing](https://openrouter.ai/google/gemini-3.8-flash), accessed 2026-09-03. AA scored high reasoning at 59; the model ranks on the promotional $0.375/M Flex input route (50% off; $0.75/M standard route).
- New-release verification: official [Qwen3.8 Max model and snapshot documentation](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max), accessed 2026-09-02. The 0902 snapshot is available through Alibaba Model Studio at $1.65/M uncached input in the US/global region ($2/M in Singapore), with no OpenRouter route or AA score yet.
- New-release verification: official [Muse Spark 1.3 announcement](https://research.meta.ai/blog/introducing-muse-spark-1-3), [Artificial Analysis score](https://artificialanalysis.ai/models/muse-spark-1-3-xhigh/), and [OpenRouter pricing](https://openrouter.ai/meta/muse-spark-1.3), accessed 2026-09-03. The generally available xhigh configuration scores 61 and costs $1.25/M input; max scores 62 but remains in limited preview. A separately named $0.10/M contributor endpoint is excluded from the standard ranking.
- OpenAI cross-check: official pages for [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), and [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol). OpenRouter is intentionally preferred where its live routed price is lower.
- “Open” means weights are available, not necessarily that the license is OSI-approved or unrestricted for commercial use.
- Displayed values are rounded; ordering uses unrounded values.

## Changelog

- **2026-09-03 — Gemini 3.8 and Muse Spark 1.3 become measurable:** Moved Gemini 3.8 Flash from the watchlist into rank 10 at AA 59 (high reasoning) and a promotional $0.375/M Flex input price (value 157.33). Added newly released Muse Spark 1.3 at rank 25 using its generally available xhigh configuration (AA 61, $1.25/M input, value 48.80); max scores 62 but remains in limited preview. Qwen3.8-Max-0902 and the other watchlist entries still lack AA scores, and no other material ranked-model repricing was found.
- **2026-09-02 — Fable 5.1 debuts; two releases watched; routed prices move:** Added Claude Fable 5.1 at AA 66 and $10/M input (value 6.60, rank 37), making it the table's quality leader. Added Gemini 3.8 Flash and Qwen3.8-Max-0902 to the watchlist pending AA scores. DeepSeek V4 Flash 0731's cheapest non-promotional route rose from $0.030 to $0.050/M (value 1,036.00), moving it from rank 2 to rank 3; GLM-5.2 gained a promotional $0.4144/M FP8 route (70.4% off; value 126.93), moving it from rank 16 to rank 14.
- **2026-09-01 — Apodex becomes measurable; Endeavor and Mercury watchlist:** Added AA-scored Apodex 1.1 to a new unranked promotional/free section at AA 44 and a temporarily free token price (standard input list price $0.30/M; list-price reference ratio 146.67). Added Flower Labs' Endeavor 1.0 to the watchlist pending an AA score and public per-token price, and Mercury 2.5 Preview pending an AA score at its promotional $0.040/M OpenRouter input price. The paid ranking is unchanged.
- **2026-08-29 — DeepSeek route repricing:** Updated DeepSeek V4 Flash 0731 from $0.035 to OpenRouter's cheapest listed standard route at $0.030/M input (non-promotional FP4), raising its value from 1,480.00 to 1,726.67 while retaining rank 2. No new noteworthy model release was found; Hy4 preview and the other watchlist entries remain unscored by AA.
- **2026-08-28 — Hy4 preview watchlist and Nemotron repricing:** Added Tencent's newly released 770B/49B-active open-weight flagship to the watchlist at a non-promotional $0.834/M FP8 input price, pending an AA score. Updated Nemotron 3 Ultra from $0.60 to a non-promotional $0.50/M FP4 route (value 76.60), moving it from rank 22 to rank 21.
- **2026-08-27 — Qwen3.8-Flash-Next debuts at rank 5:** Added the new open-weight Qwen4-architecture preview at AA 56 and paired it with the managed Qwen3.8 Flash API's non-promotional $0.15/M input price (value 373.33). Refined GLM-5.3-Flash's live AA score from 57.0 to 57.5 (value 766.67; still rank 4). Updated Qwen3.6 27B to a returned non-promotional $0.289/M FP4 route (value 130.45, rank 15 to 13) and Kimi K2.7 Code to $0.66/M INT4 (value 65.15, still rank 21).
- **2026-08-26 — GLM-5.3-Flash debuts at rank 4:** Added Z.AI's 320B/18B-active open-weight reasoning model at AA 57 and a promotional $0.075/M input price (50% off through 2026-09-09), producing a value score of 760.00 and becoming the best 55+ score value entry.
- **2026-08-25 — DeepSeek route moves to rank 2:** Updated DeepSeek V4 Flash 0731 from $0.0658 to OpenRouter's cheapest listed standard route at $0.035/M input (non-promotional FP4; value 1,480.00), moving it ahead of Solar Pro 4; updated Qwen3.8 27B from $0.40 to a non-promotional $0.35/M FP8 route (value 148.57, still rank 10). Added Thomson to the watchlist pending an AA score and public per-token API price.
- **2026-08-24 — DeepSeek and Qwen route changes:** Updated DeepSeek V4 Flash 0731 from $0.08 to a promotional $0.0658/M input (value 787.23, still rank 3); updated Qwen3.6 27B from $0.289 to a non-promotional $0.32/M (value 117.81), moving it from rank 10 to rank 13.
- **2026-08-23 — Qwen3.8 27B repricing:** Updated Qwen3.8 27B from $0.45 to $0.40/M input on standard, non-promotional OpenRouter endpoints (value 130.00), moving it from rank 13 to rank 11.
- **2026-08-22 — Sol and Kimi repricing:** Updated GPT-5.6 Sol from $2.50 to a promotional $2.00/M input (value 30.45), tying Grok 4.6 at rank 27; updated Kimi K2.6 from $0.5605 to a promotional $0.5415/M (value 83.29), moving it ahead of DeepSeek V4 Pro 0813. OpenAI's official direct Sol price also fell from $5 to $4/M.
- **2026-08-21 — Routed-price drops:** Updated DeepSeek V4 Flash 0731 from $0.14 to $0.08/M input (value 647.50, still rank 3) and Kimi K2.7 Code from $0.71 to $0.67/M (value 64.18), moving it just ahead of Nemotron 3 Ultra. Both prices were available on standard, non-promotional OpenRouter endpoints.
- **2026-08-20 — GPT-5.6 Cyber watchlist:** Added OpenAI's newly documented, restricted-access cybersecurity model to the watchlist at its official $12.50/M input price; it remains unranked pending an AA Intelligence Index score. Live OpenRouter endpoint checks found no material repricing of ranked models.
- **2026-08-19 — GLM-5.3 and Qwen3.8 27B become measurable:** Added GLM-5.3 at AA 59.5 and $1.40/M input (value 42.50), with API access live but weights still unavailable; added Qwen3.8 27B at AA 52.0 and $0.45/M input (value 115.56).
- **2026-08-18 — Muse Spark 1.2 scored:** Added Muse Spark 1.2 at AA 56.8 and $1.25/M input (value 45.44); refreshed GLM-5.2's routed input price to $0.49/M and Qwen3.8 2.4T A95B's live score to 57.7.
- **2026-08-17 — Bootstrap:** Initialized the ranking from the prior “Rank cost-effective open models” candidate set, refreshed against live Artificial Analysis and OpenRouter data, added recent Qwen3.8 releases, and placed GLM-5.3 plus other unscored releases on the watchlist.
