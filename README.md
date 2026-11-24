[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/zeromix555/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122-entry/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/zeromix555/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122-entry/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

# Hot-Launch Sniper — Pump.fun Replay Sprint

Entry for the make.fun competition
`u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122` — a paper trading bot
that trades 10 SOL on a 24h replay of pump.fun bonding-curve activity.

Bounty page: https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122

## The bot

`main.ts` (Node 22, no dependencies) runs a launch sniper with a rug filter
(`strategy.ts`, protocol shim in `vendor/agentfun-bot.ts` — a byte-identical
copy of the kit's `sdk/ts` file):

- Every coin is watched from its `CreateEvent`. In its first 3 slots the bot
  reads the opening tape: the creator's own buy size, how many trades and
  distinct non-creator buyers showed up, whether the creator already sold,
  and how much real SOL the curve holds.
- It buys only hot, committed launches: at least 5 trades in the first slots,
  a creator buy of at least 0.75 SOL, at most 6 distinct non-creator buyers
  (a launch bundled by many wallets is a dump in waiting), no creator sell.
- Stake is 0.1 SOL per coin (capped at 1% of the curve's real SOL reserve, so
  buys are real size, not dust). It takes profit at +30%, cuts at −12%, never
  holds past 5 slots, and exits immediately if the creator sells.
- No fill-count pacing (`fillTarget: 0`): this competition has no minimum-fill
  guardrail, so orders are never split into extra fee-paying pieces.

Pure function of the batches it is fed: no clock, no randomness, no I/O — the
two graded executions produce byte-identical action logs.

## Dev-window results

On the kit's frozen 24h dev window (1,222 mints, 126,801 trades), backtested
with the kit's own local replay engine on all three dataset parts:

- **Net PnL −0.002 SOL on the real harness** (`grade-local --driver process`,
  two executions, byte-identical action logs; 90% bootstrap interval
  −0.18…+0.21 SOL) — essentially breakeven on the dev window. The local
  replay sims score the same settings at +0.03…+0.07 SOL across failed-tx
  draws (mean +0.058); the gap is one failed-tx draw landing on a winner
  plus fee-model detail, i.e. the edge is thin and concentrated (3 coins made
  54% of the gains). 79 round trips over 79 coins, 20 winners,
  max drawdown 0.011 — far inside the 0.50 guardrail.
- Every round trip is at least 0.01 SOL, on 80 distinct coins (guardrail: 20).
- For comparison on the same window, the kit's pilot baselines lose:
  momentum −9.39 SOL, mean-reversion −4.02 SOL, untuned sniper −0.49 SOL.

See `STRATEGY.md` for the full research log: what was tried, what failed, and
why the shipped settings are the flat, robust region of the grid rather than
its single best cell.

## Run it

```sh
node main.ts
```

Graded locally with the kit CLI:

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```
