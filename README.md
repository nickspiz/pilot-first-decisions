# pilot-first-decisions

**Stop paying a chat model to answer yes/no. A recipe and a benchmark harness for decision models.**

Many LLM calls in production are not "write something". They are "decide something": is this message angry, which topic is it, is the brand mentioned, how urgent is it. A chat model does these fine, but you pay for a full generation and wait for it. A decision model returns the answer as probabilities with a confidence, and it is built for exactly this job.

This repo has two small scripts, no dependencies, Node 18 or newer:

- `decide.mjs`: a client for the OpenRouter decisions endpoint. Many questions about one text in one request.
- `bench.mjs`: runs the decision model and a chat model of your choice on the same rows and tells you where they agree, where they don't, what each costs, and whether a hybrid setup is worth it.

The recipe is the order of work: **pilot first, compare by eye, then route by confidence.** Don't switch a production call because a vendor page says it is cheaper. Run 20 rows, read the disagreements, then decide.

## When to use it

Good fit:

- Classification: tone, topic, intent, category.
- Yes/no checks: spam, mentions a deadline, needs a human, should this step run.
- Scoring on a short scale: urgency, relevance, quality.
- Picking the best of N candidates.
- A cheap filter in front of an expensive model, so the big model only sees rows that pass.

Bad fit:

- Text generation. A decision model does not write.
- Arithmetic, counting, dates, pulling numbers out of text.
- Images, audio, video. Text only for now.
- Inputs over 32k tokens.

## Quick start

```bash
git clone https://github.com/nickspiz/pilot-first-decisions
cd pilot-first-decisions
# put your own OpenRouter key in the OPENROUTER_API_KEY environment variable
# and never write it into a file in this repo
npm test                        # no network needed
```

Ask a few questions about one text:

```bash
node decide.mjs --text "I was charged twice and nobody replied." --questions examples/questions.json
```

Run the pilot. The default is 20 rows, so a first run is small. Check your chat model's price before you raise the limit:

```bash
node bench.mjs \
  --data examples/support-messages.jsonl \
  --questions examples/questions.json \
  --chat-model openai/gpt-4o-mini \
  --confidence-threshold 0.8
```

Pass `--limit 60` or `--limit all` only after you have read the first report.

### Question spec

A JSON object, one entry per question. Three types:

```json
{
  "angry":   { "type": "noul",   "instructions": "Is the customer angry?" },
  "topic":   { "type": "choice", "instructions": "What is it about?",
               "criteria": { "bug": "something is broken", "billing": "payments" } },
  "urgency": { "type": "score",  "instructions": "How urgent is it?",
               "criteria": ["low", "medium", "high"] }
}
```

- `noul`: a probability of yes between 0 and 1. The client turns it into `yes`/`no` and a confidence.
- `choice`: picks one key from `criteria`, with probabilities and a confidence.
- `score`: a number on the scale, mapped to the nearest label.

### Input files

CSV or JSONL, one row per item. The text column is `text` (change it with `--text-field`). Optional columns named `expected_<question>` hold your own labels, and the report then shows accuracy for each side as well as their agreement.

### Options

| Option | Default | Meaning |
|---|---|---|
| `--limit` | 20 | Rows to run. `all` for everything. |
| `--confidence-threshold` | off | Hybrid mode: decision answers below this confidence are replaced by the chat answer. |
| `--chat-model` | required | Any OpenRouter model id. |
| `--decision-model` | `typesafe/jev-1.13` | Decision model id. |
| `--concurrency` | 4 | Parallel rows. |
| `--out` | `bench-out` | Where `report.md` and `results.json` go. |

For `noul` questions, confidence is how far the probability is from 0.5, scaled to 0..1.

## What the report looks like

The layout below is illustrative. The numbers are invented to show the shape, they are not a measurement.

```
## Cost and latency
|          | Total cost | Per 100 rows | Median latency |
| Decision | $0.00040   | $0.00200     | 380 ms         |
| Chat     | $0.00500   | $0.02500     | 900 ms         |

## Agreement
| Question  | Agreement | N  | Hybrid agreement | Routed to chat |
| sentiment | 80.0%     | 20 | 90.0%            | 25.0%          |
| topic     | 95.0%     | 20 | 100.0%           | 10.0%          |

## Confusion matrix: sentiment      (rows: chat, columns: decision)
## Disagreements
- row 7: chat=negative, decision=neutral (confidence 0.41) "The refund you promised..."
```

`results.json` keeps every raw answer, so you can slice it yourself.

## Numbers from one pilot

In one pilot of 100 rows (tone of brand mentions in real answers, three classes), the decision model agreed with a chat model on about 70% of rows. It cost about $0.003 per 100 calls, with a median latency of about 0.35 s. It rarely mixed up positive and negative, but it leans toward "neutral": most of the rows the chat model called negative came back neutral. That is why the confidence threshold exists. Treat these as one data point on one task, not a benchmark. Disagreement is not the same as error, since the chat model is not ground truth either. Run your own rows.

## Honest notes

- The decision model is in beta. The endpoint is `alpha`, the model is not in the public OpenRouter model list, and the response shape or pricing can change. Pin the model id and keep the chat model as a fallback.
- Cost figures come from the `usage.cost` field each endpoint returns. Check your OpenRouter dashboard before you scale up.
- Hybrid mode in `bench.mjs` needs the chat answer for every row to measure it. In production you would call the chat model only for the routed share, which is the point.
- The example data is synthetic: 60 invented support messages. No real user data is in this repo.

## Tests

```bash
npm test
```

Covers answer parsing, request shape, CSV and JSONL loading, agreement, confusion matrix, hybrid routing, and the report. Fetch is mocked, so tests never touch the network.

## License

MIT
