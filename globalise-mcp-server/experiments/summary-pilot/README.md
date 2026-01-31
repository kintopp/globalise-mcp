# LLM Summary Generation Pilot

Pilot study comparing LLM models for generating titles and abstracts from VOC (Dutch East India Company) transcription pages.

## Goal

Find the optimal cost/quality balance for generating:
- **Titles** (max 80 characters): Concise, informative headings
- **Abstracts** (50-100 words): Key content, entities, and historical significance

## Why This Matters

The GLOBALISE project has **4.8 million transcribed VOC document pages** without metadata. LLM-generated summaries could make this archive searchable and browsable. At scale, cost differences between models are significant:

| Model | Cost per page | Full corpus (4.8M pages) |
|-------|---------------|--------------------------|
| Mistral Small 3.1 | $0.000045 | **$216** |
| Claude Haiku 4.5 | $0.00159 | $7,615 |
| Claude Sonnet 4.5 | $0.00521 | $25,009 |
| Claude Opus 4.5 | $0.00861 | $41,339 |

## Dataset

- **Source**: Inventory 10000 (Ceylon VOC records, 1786)
- **Total pages**: 265
- **Sample size**: 49 pages (stratified by content length)
- **Location**: `/Users/bosse0000/Downloads/10000/`

### Stratification

| Stratum | Word count | Target | Actual |
|---------|------------|--------|--------|
| Short | 50-150 | 10 | 9 |
| Medium | 151-300 | 25 | 25 |
| Long | 301+ | 15 | 15 |

## Models Tested

### Anthropic (via direct API)

| Model | Input $/M | Output $/M | Avg Latency |
|-------|-----------|------------|-------------|
| Haiku 4.5 | $1.00 | $5.00 | 2,735ms |
| Sonnet 4.5 | $3.00 | $15.00 | 5,769ms |
| Opus 4.5 | $5.00 | $25.00 | 6,066ms |

### OpenRouter

| Model | Input $/M | Output $/M | Avg Latency |
|-------|-----------|------------|-------------|
| Mistral Small 3.1 24B | $0.03 | $0.11 | 7,186ms |

## Methodology

### Input Formats Tested

| Format | Description | Token overhead |
|--------|-------------|----------------|
| `plaintext` | Raw transcription text | Baseline |
| `labeled` | Text with `[PARAGRAPH]`, `[MARGINALIA]` tags | +10-15% |

The `labeled` format preserves document structure from PageXML but adds minimal tokens. Results showed negligible quality difference, so `plaintext` is recommended.

### Prompt Template

```
You are an expert in 18th-century Dutch colonial history (VOC records).

Given a transcription page, generate:
1. **Title** (max 80 chars): Concise, informative
2. **Abstract** (50-100 words): Key content, entities, significance

Guidelines:
- HTR output may contain errors
- Historical Dutch spelling varies
- Focus on substantive content

Respond with valid JSON: {"title": "...", "abstract": "..."}
```

## Results

### Success Rate

All models achieved **100% JSON parse success** across 49 pages.

### Quality Metrics

| Model | Avg Title Length | Titles in Range | Avg Abstract Words | Abstracts in Range |
|-------|------------------|-----------------|--------------------|--------------------|
| Haiku 4.5 | 69 chars | 86% | 62 words | 98% |
| Sonnet 4.5 | 67 chars | **100%** | 79 words | **100%** |
| Opus 4.5 | 76 chars | 76% | 86 words | 96% |
| Mistral Small 3.1 | 68 chars | 92% | 71 words | 94% |

**Sonnet** had the best constraint adherence (100% in-range for both title and abstract).

### Cost Summary

| Model | 49 pages | Est. full corpus |
|-------|----------|------------------|
| Mistral Small 3.1 | **$0.002** | **$216** |
| Haiku 4.5 | $0.08 | $7,615 |
| Sonnet 4.5 | $0.26 | $25,009 |
| Opus 4.5 | $0.42 | $41,339 |

## Key Findings

1. **Mistral Small 3.1 is 35x cheaper than Haiku** with comparable quality
2. **Sonnet has best constraint adherence** but costs 120x more than Mistral
3. **Labeled format provides no significant benefit** over plaintext
4. **All models handle historical Dutch** reasonably well despite HTR errors
5. **OpenRouter offers best Mistral pricing** at $0.03/$0.11 per million tokens

## Recommendation

For production at scale:
- **Budget option**: Mistral Small 3.1 via OpenRouter ($216 for full corpus)
- **Quality option**: Claude Sonnet 4.5 ($25,009 for full corpus)
- **Hybrid approach**: Mistral for bulk processing, Sonnet for quality-critical pages

## Usage

### Install dependencies

```bash
cd experiments/summary-pilot
npm install
```

### CLI Commands

```bash
# Show configuration
npx tsx src/index.ts info

# Select sample pages (stratified)
npx tsx src/index.ts sample --count 50 --seed 42

# Test single page
npx tsx src/index.ts single --page 0030 --experiment haiku-plaintext

# Run experiment
npx tsx src/index.ts run --experiment haiku-plaintext

# Run all Anthropic experiments
npx tsx src/index.ts run --all

# Generate comparison report
npx tsx src/index.ts report
```

### OpenRouter CLI

```bash
# Show available models
npx tsx src/openrouter-cli.ts info

# Test single page
npx tsx src/openrouter-cli.ts single --page 0030 --experiment mistral-small-24b

# Run experiment
npx tsx src/openrouter-cli.ts run --experiment mistral-small-24b
```

## Project Structure

```
experiments/summary-pilot/
├── src/
│   ├── index.ts              # Anthropic CLI
│   ├── openrouter-cli.ts     # OpenRouter CLI
│   ├── config.ts             # Anthropic experiment configs
│   ├── config-openrouter.ts  # OpenRouter experiment configs
│   ├── runner.ts             # Experiment execution
│   ├── sampler.ts            # Stratified sampling
│   ├── evaluator.ts          # Metrics and reporting
│   ├── types.ts              # TypeScript interfaces
│   ├── providers/
│   │   ├── types.ts          # LLMProvider interface
│   │   ├── anthropic.ts      # Anthropic SDK wrapper
│   │   └── openrouter.ts     # OpenRouter API client
│   └── input/
│       ├── plaintext.ts      # Parse consolidated TXT
│       ├── pagexml.ts        # Parse PageXML structure
│       └── labeled.ts        # Add region labels
├── prompts/
│   └── summary-v1.txt        # Prompt template
├── data/
│   ├── samples.json          # Selected page IDs
│   ├── report.md             # Generated report
│   ├── model-comparison.md   # Side-by-side outputs
│   └── results/              # Per-experiment JSON
├── package.json
└── tsconfig.json
```

## Environment Variables

```bash
# Required for Anthropic experiments
ANTHROPIC_API_KEY=sk-ant-...

# Required for OpenRouter experiments
OPENROUTER_API_KEY=sk-or-...

# Optional: custom data directory
PILOT_DATA_DIR=/path/to/10000
```

## Sample Output

**Page**: [NL-HaNA_1.04.02_10000_0030](https://transcriptions.globalise.huygens.knaw.nl/detail/urn:globalise:NL-HaNA_1.04.02_10000_0030)

**Mistral Small 3.1**:
- **Title**: VOC Rice Supply and Shankoos Payment Dispute, Ceylon 1784
- **Abstract**: In June 1784, the VOC received an offer to supply 800-1000 lasten of Bengal or coastal rice annually in Ceylon without payment in shankoos. The VOC accepted 800 lasten at 4 rijksdaalders per zak of 150 lb. The shankoosduikerij was left unpaid that year. The VOC awaits further orders regarding the payment of shankoos, previously to be covered by Blinne or Ross's estate, as per a 1780 resolution.

**Claude Sonnet 4.5**:
- **Title**: VOC Ceylon Rice Supply and Chank Shell Diving Contract Disputes, 1778-1784
- **Abstract**: This document discusses a proposal to supply 800-1000 lasts of Bengali or Coromandel rice annually to Ceylon, to be paid in chank shells (sjankoosen). The VOC suspended chank diving farm leases in favor of direct Company operations. A significant dispute concerns unpaid chank shells from 1778-1779 involving Bengali merchant Blinne and former Director Ross, complicated by the English capture of Trincomalee.

## Future Work

- [ ] Test additional OpenRouter models (DeepSeek, Llama 3.3)
- [ ] Implement Anthropic Batch API for 50% cost reduction
- [ ] Add archival context (settlement, year) to prompts
- [ ] Evaluate on pages from different inventories/time periods
- [ ] Human quality assessment on subset of outputs
