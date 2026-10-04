# Agora

**A deliberation panel of OpenRouter's free models.** You put a topic to the panel. Every seat answers it alone
first, then reads what the other seats said and answers *them*, and the seats that still disagree are invited back
once more. Agora counts the discussion itself, measures whether the panel converged, and keeps the dissent visible.

English and Turkish. Runs entirely in the browser.

## How a session runs

| Round | What happens | Requests |
| --- | --- | --- |
| **Agenda** *(optional)* | Every seat proposes one claim the panel is well placed to argue about. Agora groups overlapping proposals and names the largest group; you choose what is debated. | 1 per seat |
| **Blind** | Every seat sees only the proposition. Nobody can copy, and nobody can be steered. | 1 per seat |
| **Floor** | Each seat sees the others' positions — under blind seat letters, never under model names — and must name the seat it is answering. This is where the argument happens. | 1 per seat |
| **Convergence** | Only the seats that dissented are invited back. Each either moves, or holds and says which argument against it is still wrong. | 1 per dissenter |

A seat that can read "nemotron-ultra" has something to defer to; a seat that can only read "Member C argued for…" has
to argue. So no model name ever reaches a prompt — but every turn is attributed to a model once you read it.

## Two ways to choose the topic

- **You give the topic.** Type a claim that can be supported or opposed.
- **The panel chooses.** Every seat proposes one. Proposals that overlap in wording are grouped, the largest group is
  Agora's pick, and you can pick a different one. Grouping is a lexical heuristic and is shown with its size, so a
  single proposer can never pass as a shared agenda.

## What it does not claim

- **Agreement is not accuracy.** A panel can agree immediately without ever having been tested against each other, and
  a panel that argues can split further. The interface shows the agreement path across the rounds so the two cases
  stay distinguishable, and the bar it applies is a declared constant, not one chosen to suit a result.
- **These are small models.** They are free, which is not the same as good.
- **Confidence comes in two kinds and they are never mixed.** For the few roster members that report token
  log-probability, the number is a measured fluency measure over the whole answer. For everyone else it is the model's
  own claim. Neither feeds the count: every readable vote weighs the same.
- **No panel member writes the verdict.** Agora counts the rounds itself, so no seat authors the count that judges it.

## The quota is part of the design

The free tier allows 20 requests per minute and **50 per UTC day**. Agora stays inside that ceiling on purpose, and
quotes a **range** rather than a number, because the final round is only spent on dissenters: a five-seat session costs
10 requests if the panel agrees immediately and 15 if it splits all the way down to one seat. Extra accounts and extra
keys do **not** raise the limit, because capacity is governed globally.

## Bring your own key

There is no Agora server. Your key is stored in this browser and sent to `openrouter.ai`, nowhere else. OpenRouter
answers with `access-control-allow-origin: *` on all three endpoints Agora uses, which is what makes a static site
with no backend possible.

## The shared record

Sessions can be exported and filed in `archive/`. A record is only accepted if

- its own daily free-request counter moved by at least the cost it claims, and
- its stored count matches a count Agora re-derives from the stored positions, and
- its request cost matches the rounds that were actually run.

Publishing therefore costs real quota, so an invented record cannot be published for free. When a proposition is
answered more than once, the count from each roster sits next to the others — that comparison is the reason the
archive exists.

## Local development

```bash
npm ci --legacy-peer-deps
npm run dev              # http://127.0.0.1:4189
npm test                 # vitest, unit and contract
npm run build            # lint, test, archive build, type-check, bundle, release.json
npm run verify:artifact
npm run test:e2e         # playwright acceptance
AGR_LIVE=1 npm test      # also read the real OpenRouter catalogue
```

## Structure

| Path | Role |
| --- | --- |
| `src/core/openrouter.ts` | catalogue, quota and streaming transport |
| `src/core/roster.ts` | seating rules and the reasoned exclusion list |
| `src/core/parse.ts` | tolerant answer reader, addressing and confidence basis |
| `src/core/prompts.ts` | one prompt per round kind |
| `src/core/engine.ts` | agenda, three rounds, tally, convergence, verdict text |
| `src/core/archive-schema.ts` | export shape and timeline grouping |
| `scripts/archive-contract.mjs` | the archive integrity rules, shared by browser and Node |
| `archive/` | filed verdict records |
| `AGENTS.md` | the working contract for anyone changing this app |

## Status

`preview`. The shared timeline is wired but empty: no real session has been run yet, because that needs a real
OpenRouter key.
