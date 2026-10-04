# Agora

**A deliberation panel of OpenRouter's free models.** You put a proposition to the panel. Every seat answers it alone
first, then reads what the other seats said and answers again. Agora counts that second round itself and keeps the
dissent visible.

English and Turkish. Runs entirely in the browser.

## What it does

1. **Reads the live free roster.** `GET /api/v1/models` is public: no key, no quota. The roster rotates without notice,
   so what you see is a dated snapshot, and any free model that cannot hold a position is left off the panel with the
   reason shown.
2. **Runs a blind first round.** Every seat sees only the proposition. Nobody can copy, and nobody can be steered.
3. **Runs a floor round.** Each seat then sees the other positions — under blind seat labels, never under model names.
   A seat that can read "nemotron-ultra" has something to defer to; a seat that can only read "Member C argued for…"
   has to argue.
4. **Counts the floor round itself.** No model writes the verdict, so no panelist authors the count that judges it.
   The count, the agreement share, the dissenting seats and any member that ignored the requested answer format are
   all shown.

## What it does not claim

- **Agreement is not correctness.** A verdict is the panel's leaning at one moment. It is never described as the right
  answer, and no model in the panel is described as reliable.
- **These are small models.** They are free, which is not the same as good.
- **Confidence comes in two kinds and they are never mixed.** For the few roster members that report token
  log-probability, the number is a measured fluency measure over the whole answer. For everyone else it is the
  model's own claim. Neither feeds the count: every readable vote weighs the same.

## The quota is part of the design

The free tier allows 20 requests per minute and **50 per UTC day**, and a panel of N seats spends `2N` of them: one
blind answer and one floor answer each. A five-seat session is 10 requests, so the free tier buys about five sessions
a day. Agora stays inside that ceiling on purpose — scarcity is what turns a session into a decision instead of an
unlimited conversation. Buying the higher tier (50 → 1000 per day, a one-time $10 lifetime threshold) was considered
and rejected.

Extra accounts and extra keys do **not** raise the limit, because capacity is governed globally.

## Bring your own key

There is no Agora server. Your key is stored in this browser and sent to `openrouter.ai`, nowhere else. OpenRouter
answers with `access-control-allow-origin: *` on all three endpoints Agora uses, which is what makes a static site
with no backend possible.

## Local development

```bash
npm ci --legacy-peer-deps
npm run dev        # http://127.0.0.1:4189
npm test           # vitest, unit and contract
npm run build      # lint, type-check, bundle, write dist/release.json
npm run verify:artifact
```

## Structure

| Path | Role |
| --- | --- |
| `src/core/openrouter.ts` | catalogue, quota and streaming transport |
| `src/core/roster.ts` | seating rules and the reasoned exclusion list |
| `src/core/parse.ts` | tolerant answer reader and confidence basis |
| `src/core/engine.ts` | blind round, floor round, tally, verdict text |
| `src/core/archive.ts` | local session record and key storage |
| `lab.manifest.json` | the shared lab contract, evidence policy and assumptions |
| `AGENTS.md` | the working contract for anyone changing this app |

## Status

`preview`. The shared timeline in the plan is not built yet: sessions are currently stored in the browser only.
