# Strategy research log — Hot-Launch Sniper

Competition: `u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122`
(Pump.fun Replay Sprint — Paper Bot, Real Ranking). Capital 10 SOL, 24h final
window, net PnL after all fees, guardrails: ≥20 coins with ≥0.01 SOL round
trips, max drawdown ≤ 0.50. Dev window: 2026-11-02 → 2026-11-03, 1,222 mints,
126,801 trades, 35 completions.

All numbers below are from the kit's own local replay engine (`tools/sim.ts`
ports) run on the **full** dev window — all three `dataset/events` parts. (The
kit's pilot tools load only `part-00000` by default, i.e. the first ~8h; every
number here was re-run on all 24h before it was trusted.)

## What the data says

- Median real SOL at a coin's first trade is ~0.99 SOL, so the 1%-of-real-reserve
  per-order cap limits a launch buy to ~0.01 SOL on a typical coin. Tx fees
  (105,000 lamports/order) are ~1% of a 0.01 SOL buy — small positions are
  fee-poisoned. Size only exists once a curve holds real SOL.
- 11% of coins 2x within 100 slots of create; 5.2% 3x; 2.8% 5x. Median coin
  ends the window at 0.94x its first price — most coins grind down slowly,
  they do not all rug to zero.
- Buying strength is punished: a reserve-threshold momentum sim (buy when real
  SOL first crosses 5–20 SOL and price is flat-or-up) loses −2.4 to −4.6 SOL.

## What was tried (full dev window, local replay)

| Approach | Net PnL | Notes |
|---|---|---|
| Kit pilot momentum (defaults) | −9.39 SOL | 80 trips, 5 wins, dd 0.95. Buys tops, 2 SOL stakes, rugs eat the stop. |
| Kit pilot mean-reversion (defaults) | −4.02 SOL | 424 trips, 111 wins, dd 0.49. Dips keep dipping. |
| Kit pilot sniper (defaults) | −0.49 SOL | 354 trips, 45 wins, dd 0.05. Closest to breakeven, smallest drawdown. |
| Sniper, ride-the-runner (TP 10x + trailing stop, hold 300–2000 slots) | −0.71 to −1.07 SOL | Holding longer loses more on this window. |
| Sniper, entry filters (minTrades 5, maxBuyers 5, minDevBuy 0.5 SOL) | −0.001 SOL | Selectivity is the whole game. |
| **Sniper, tuned (shipped)** | **+0.058 SOL local sim / −0.002 real harness** | See below. |

## Shipped settings (strategy.ts DEFAULT_PARAMS)

- Entry (first 3 slots after create): `minTrades 5`, `maxBuyers 6`,
  `minDevBuy 750_000_000` lamports (0.75 SOL), `maxDevBuy 2.5 SOL`,
  `skipDevSold`, `minRealSol 0.3 SOL`, `maxRealSol 30 SOL`.
- Size: `stakeLamports 100_000_000` (0.1 SOL), capped at 1% of real reserve;
  median filled buy 0.05 SOL, every round trip ≥ 0.01 SOL.
- Exits: `tpBps 3000` (+30%), `slBps 1200` (−12%), `maxHold 5` slots,
  exit immediately on creator sell. Partial take-profit, adds, trailing stop,
  and flow/run-up filters all off — each was tried and did not help.
- `fillTarget 0`: no fill-count pacing. This competition's guardrails have no
  minimum-fill bar, so splitting orders would only burn extra tx fees.

## Robustness of the shipped cell

Gridded around the cell (minTrades 4–7 × maxBuyers 4–6 × minDevBuy 0.5–1.0 SOL,
then tpBps 2000–4000 × slBps 1000–1500 × maxHold 4–6):

- The shipped cell sits in a flat positive region, not a spike: neighbours
  (5,6,0.5 SOL) +0.033, (7,6,0.5 SOL) +0.052, (7,6,0.75 SOL) +0.069
  (momentum-sim; sniper-sim agrees on sign and order).
- Across four failed-tx draws the shipped cell scores +0.065 / +0.053 /
  +0.042 / +0.072 SOL (mean +0.058, worst +0.042); no-failure draw +0.046.
  The real harness (`grade-local --driver process`) scores the same settings
  at −0.002 SOL (90% interval −0.18…+0.21) — the edge is thin and the
  failed-tx draw moves it by ~0.06 SOL, so the honest statement is
  "breakeven on dev, positive in the local sims", not a solid +0.06.
  At 2x fees it goes to −0.14 — the edge is real but fee-sensitive, which is
  why size discipline (never dust) and no order splitting matter.
- The stricter 7-trade cell scores slightly higher (+0.069) but only trades
  27 coins — too close to the 20-coin guardrail for a different final window.
  The shipped 5-trade cell trades 80 coins, a 4x margin.
- Halves: the shipped cell is +0.064 in the first half of the window and
  −0.021 in the second — it is not a one-half fluke, but the edge is thinner
  late in the window; the fast exit (5 slots) is what keeps the second half
  from hurting more.

## Honest caveats

- The final window is a different 24h of chain data (27–28 Nov). Dev-window
  tuning transfers imperfectly; the shipped settings were picked for a flat
  region and a coin-count margin, not for the single best cell.
- Net PnL is small (breakeven on the real harness, +0.06 SOL mean in the
  local sims, on 10 SOL capital). The aim is a positive,
  guardrail-safe entry that ranks, not a lottery ticket.
