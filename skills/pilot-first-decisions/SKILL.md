---
name: pilot-first-decisions
description: Check whether a decision model can replace a chat model for yes/no, classification or scoring calls. Use when code asks an LLM to decide something (tone, topic, spam, urgency) and you want to compare cost and answers on real rows before switching.
---

# Pilot first, then route by confidence

Use this when an LLM call returns a label or a yes/no, not a piece of writing.

1. Get 20 real rows and a questions file (see `examples/questions.json` in the plugin folder for the shape).
2. Run the pilot with the bundled script. Never raise the limit before reading the first report.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bench.mjs" --data rows.jsonl --questions questions.json \
  --chat-model <your current model id> --confidence-threshold 0.8
```

3. Read the disagreements row by row. The chat model is not ground truth, so disagreement is not the same as error.
4. If the decision model holds up, route by confidence: low-confidence answers go back to the chat model.
5. Report the before and after in cost and quality. Do not switch on a price claim alone.

To see a report without an API key, add `--fixture "${CLAUDE_PLUGIN_ROOT}/examples/fixture.json"` and point `--data` and `--questions` at the files in `examples/`. Those answers are invented.

Rules:

- The API key comes from the `OPENROUTER_API_KEY` environment variable. Never write it into a file.
- Without `--fixture`, the script sends each row's text to openrouter.ai. Tell the user that before the first real run and use only rows they are allowed to share.
- A decision model does not write text, do arithmetic, or read media. Keep those on the chat model.
- The decisions endpoint is alpha and the model is in beta. Pin the model id and keep the chat model as a fallback.
