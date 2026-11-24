// Hot-launch sniper for the pump.fun bonding-curve replay (agent-fun/replay/v2).
//
// Idea: most pump.fun launches are either dead on arrival or a dump waiting to
// happen, but a small slice — a creator who put real SOL in, several real
// buyers piling in within the first slots, nobody dumping yet — runs far
// enough, fast enough, to pay for the losers. This bot only buys that slice,
// in small size, and gets out within a few slots: take profit at +30%, cut at
// -12%, never hold past 5 slots, exit the moment the creator sells.
//
// The numbers behind the settings are in STRATEGY.md: the kit's pilot
// baselines lose on the dev window (momentum -9.39 SOL, mean-reversion -4.02,
// untuned sniper -0.49), while this tuned cell scores about breakeven on the
// real harness and +0.03..+0.07 SOL in the local sims across failed-tx draws,
// over 79 coins with max drawdown ~0.01. The edge is thin and concentrated in
// a few coins, so the sizing discipline is the strategy: 0.1 SOL per coin,
// capped at 1% of the curve's real SOL reserve (so buys are real size, never
// dust), no order splitting (this competition has no minimum-fill guardrail,
// so splits would only burn extra tx fees).
//
// Deterministic by construction: a pure function of the batches it is fed —
// no clock, no randomness, no I/O — so the two graded executions produce
// byte-identical action logs.

import { BPS, type BotState, type Batch, type OrderInput, type Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  /** Youngest age (slots since create) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  /** Lamports to aim for per coin in total (each reply is still capped at 1% of real SOL). */
  stakeLamports: number;
  /** Smallest single buy worth paying the tx fee for. */
  minBuyLamports: number;
  /** Buys after the first one, each on a later batch, while the coin keeps qualifying. */
  maxAdds: number;
  /** An add needs the price at least this far (bps) above the previous buy's decision price (negative: at most this far below). */
  addStepBps: number;
  /** An add waits this many slots after the previous buy was decided. */
  addDelay: number;
  /** Lamports per add (each still capped at 1% of real SOL). */
  addLamports: number;
  /** An add needs the recent net flow at least this. */
  addMinFlowLamports: number;
  /** Real SOL reserve window at decision time (lamports). */
  minRealSol: number;
  maxRealSol: number;
  /** Creator's own buys in the create slot: lamports window. */
  minDevBuy: number;
  maxDevBuy: number;
  /** Trades seen and distinct (non-creator) buyers seen before entry. */
  minTrades: number;
  minBuyers: number;
  /** Distinct non-creator buyers before entry, at most: a launch bundled by many wallets is a dump in waiting. */
  maxBuyers: number;
  /** Lamports sold by others / lamports bought, as bps, at most. */
  maxSellRatioBps: number;
  /** Largest single non-creator sell seen, as bps of the real SOL reserve before it, at most. */
  maxBigSellBps: number;
  /** Price now over the create price, as bps: window. */
  minRunupBps: number;
  maxRunupBps: number;
  /** The recent-flow window (slots) and what it must show. */
  flowWindow: number;
  minFlowLamports: number;
  minRecentBuyers: number;
  /** Creator sold before entry: skip the coin. */
  skipDevSold: boolean;
  /** Slippage allowed on buys (bps): a buy whose price jumps more than this in the latency is refused. */
  buySlippageBps: number;
  /** First take-profit: sell tp1PartBps of the position once it is worth tp1Bps over its cost. */
  tp1Bps: number;
  tp1PartBps: number;
  /** After the first take-profit, the rest stops out at this much under its cost (bps; negative = above). */
  slAfterTp1Bps: number;
  /** Exit when the position is worth this much over its cost (bps). */
  tpBps: number;
  /** Exit when it is worth this much under its cost (bps). */
  slBps: number;
  /** Trailing stop: once up at least trailArmBps, exit on a fall of trailBps from the best value. */
  trailArmBps: number;
  trailBps: number;
  /** Exit after holding this many slots. */
  maxHold: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
  /** Exit when the recent net flow falls below minus this many lamports. */
  exitFlowLamports: number;
  /**
   * Fill pacing: when the bot's filled-order count runs behind fillTarget
   * prorated over the window (windowSeconds of block time from the first
   * event), each order is split into pieces sent in the same reply
   * (baseSplit normally, up to maxSplit). The pieces fill at the same price
   * as the whole order, cost one extra tx fee each, and a failed tx then
   * stalls only part of the order. Shipped at 0: this competition has no
   * minimum-fill guardrail, so splitting would only burn tx fees.
   */
  fillTarget: number;
  windowSeconds: number;
  baseSplit: number;
  maxSplit: number;
  /** Smallest buy piece worth sending (lamports). */
  minPieceLamports: number;
}

// Shipped settings — chosen on the dev window (see STRATEGY.md), preferring a
// flat region of the grid over its single best cell, and a coin count with a
// wide margin over the 20-coin guardrail.
export const DEFAULT_PARAMS: Params = {
  minAge: 0,
  maxAge: 3,
  stakeLamports: 100_000_000,
  minBuyLamports: 5_000_000,
  maxAdds: 0,
  addStepBps: 0,
  addDelay: 2,
  addLamports: 100_000_000,
  addMinFlowLamports: 0,
  minRealSol: 300_000_000,
  maxRealSol: 30_000_000_000,
  minDevBuy: 750_000_000,
  maxDevBuy: 2_500_000_000,
  minTrades: 5,
  minBuyers: 0,
  maxBuyers: 6,
  maxSellRatioBps: 10_000,
  maxBigSellBps: 10_000,
  minRunupBps: 0,
  maxRunupBps: 1_000_000,
  flowWindow: 10,
  minFlowLamports: -1_000_000_000_000,
  minRecentBuyers: 0,
  skipDevSold: true,
  buySlippageBps: 10_000,
  tp1Bps: 1_000_000,
  tp1PartBps: 5_000,
  slAfterTp1Bps: 0,
  tpBps: 3_000,
  slBps: 1_200,
  trailArmBps: 1_000_000,
  trailBps: 1_000,
  maxHold: 5,
  exitOnDevSell: true,
  staleSlots: 1_000_000,
  exitFlowLamports: 1_000_000_000_000,
  fillTarget: 0,
  windowSeconds: 21_600,
  baseSplit: 1,
  maxSplit: 6,
  minPieceLamports: 2_000_000,
};

interface Tick {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: Pubkey;
}

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** Reserves at create: the price run-up is measured against them. */
  vq0: bigint;
  vt0: bigint;
  devBuy: bigint;
  trades: number;
  buyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  bigSellBps: bigint;
  devSold: boolean;
  lastTradeSlot: number;
  /** Trades of the last flowWindow slots (older ones dropped as new ones come). */
  recent: Tick[];
  buysSent: number;
  spentSent: bigint;
  /** Decision price (vq/vt as a pair) of the last buy sent. */
  lastBuyVq: bigint;
  lastBuyVt: bigint;
  lastBuySlot: number;
  /** Never buy it again (exited, filtered out for good, or completed). */
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  txPaid: bigint;
  best: bigint;
  devSoldAtOpen: boolean;
  tookTp1: boolean;
}

export interface Strategy {
  onBatch(state: BotState, batch: Batch): OrderInput[];
}

/** Curve fee on a sale: protocol 95 bps + creator 30 bps. */
const FEE_BPS = 125n;

/** What selling `tokens` against (vq, vt) would pay after curve fees. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const quote = (tokens * vq) / (vt + tokens);
  return quote - (quote * FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Strategy {
  const P = params;
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Mints with a sell in flight. */
  const selling = new Set<Pubkey>();
  const stake = BigInt(P.stakeLamports);
  const minBuy = BigInt(P.minBuyLamports);
  let firstTime: number | null = null;
  let nowTime = 0;
  let filled = 0;

  /** How many pieces to split an order into now: baseSplit, more when the fill count lags its pace. */
  function pieces(): number {
    if (firstTime === null) return P.baseSplit;
    const elapsed = Math.max(0, Math.min(P.windowSeconds, nowTime - firstTime));
    const due = (P.fillTarget * elapsed) / P.windowSeconds;
    if (filled >= due) return P.baseSplit;
    const behind = due - filled;
    return Math.min(P.maxSplit, P.baseSplit + (behind > P.fillTarget * 0.15 ? 2 : 1));
  }

  /** Sell all of `tokens` as k orders in one reply. */
  function sellOrders(mint: Pubkey, tokens: bigint, k: number, room: number): OrderInput[] {
    const n = BigInt(Math.max(1, Math.min(k, room)));
    const out: OrderInput[] = [];
    const piece = tokens / n;
    if (piece === 0n) return [{ side: 'sell', mint, token_amount: tokens, max_slippage_bps: 10_000 }];
    for (let i = 0n; i < n; i++) {
      const amt = i === n - 1n ? tokens - piece * (n - 1n) : piece;
      out.push({ side: 'sell', mint, token_amount: amt, max_slippage_bps: 10_000 });
    }
    return out;
  }

  /** Buy `amount` lamports as up to k orders in one reply (pieces of at least minPieceLamports). */
  function buyOrders(mint: Pubkey, amount: bigint, k: number, room: number): OrderInput[] {
    let n = BigInt(Math.max(1, Math.min(k, room)));
    const minPiece = BigInt(P.minPieceLamports);
    while (n > 1n && amount / n < minPiece) n -= 1n;
    const piece = amount / n;
    const out: OrderInput[] = [];
    for (let i = 0n; i < n; i++) {
      const amt = i === n - 1n ? amount - piece * (n - 1n) : piece;
      out.push({ side: 'buy', mint, quote_lamports: amt, max_slippage_bps: P.buySlippageBps });
    }
    return out;
  }

  /** Fold a batch's events into the per-coin tapes. */
  function readEvents(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          mint: e.mint,
          createSlot: e.slot,
          creator: e.creator,
          vq0: BigInt(e.virtual_quote_reserves),
          vt0: BigInt(e.virtual_token_reserves),
          devBuy: 0n,
          trades: 0,
          buyers: new Set(),
          bought: 0n,
          soldByOthers: 0n,
          bigSellBps: 0n,
          devSold: false,
          lastTradeSlot: e.slot,
          recent: [],
          buysSent: 0,
          spentSent: 0n,
          lastBuyVq: 0n,
          lastBuyVt: 1n,
          lastBuySlot: 0,
          done: false,
          complete: false,
        });
      } else if (e.event === 'TradeEvent') {
        const coin = coins.get(e.mint);
        if (coin === undefined) continue;
        const sol = BigInt(e.sol_amount);
        coin.trades += 1;
        coin.lastTradeSlot = e.slot;
        coin.recent.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user });
        const isDev = e.user === coin.creator;
        if (e.is_buy) {
          coin.bought += sol;
          if (isDev && e.slot === coin.createSlot) coin.devBuy += sol;
          else if (!isDev) coin.buyers.add(e.user);
        } else if (isDev) {
          coin.devSold = true;
        } else {
          coin.soldByOthers += sol;
          const rqBefore = BigInt(e.real_quote_reserves) + sol;
          if (rqBefore > 0n) {
            const bps = (sol * BPS) / rqBefore;
            if (bps > coin.bigSellBps) coin.bigSellBps = bps;
          }
        }
      } else {
        const coin = coins.get(e.mint);
        if (coin !== undefined) {
          coin.complete = true;
          coin.done = true;
        }
      }
    }
  }

  /** Net lamports bought minus sold, and the distinct buyers, over the last flowWindow slots. */
  function flow(coin: Coin, slot: number): { net: bigint; buyers: number } {
    const from = slot - P.flowWindow;
    let drop = 0;
    while (drop < coin.recent.length && coin.recent[drop]!.slot <= from) drop++;
    if (drop > 0) coin.recent.splice(0, drop);
    let net = 0n;
    const buyers = new Set<Pubkey>();
    for (const t of coin.recent) {
      if (t.isBuy) {
        net += t.sol;
        if (t.user !== coin.creator) buyers.add(t.user);
      } else net -= t.sol;
    }
    return { net, buyers: buyers.size };
  }

  function hasPendingBuy(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'buy') return true;
    return false;
  }

  function hasPendingSell(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'sell') return true;
    return false;
  }

  return {
    onBatch(state, batch) {
      readEvents(batch);
      for (const e of batch.events) {
        if (e.block_time === null) continue;
        if (firstTime === null) firstTime = e.block_time;
        if (e.block_time > nowTime) nowTime = e.block_time;
      }
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });

      // Bookkeep fills: count them, track tx paid per position, open a Held
      // record when a buy lands. Fills with a '_' client id are the harness's
      // own closes, not ours — drop their bookkeeping.
      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        if (f.status === 'filled') filled += 1;
        const h = held.get(f.mint);
        if (f.status !== 'rejected' && h !== undefined) h.txPaid += BigInt(f.tx_fee_lamports);
        if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
          held.set(f.mint, { openedSlot: f.slot, txPaid: BigInt(f.tx_fee_lamports), best: 0n, devSoldAtOpen: coins.get(f.mint)?.devSold ?? false, tookTp1: false });
        }
      }
      for (const mint of [...selling]) if (!hasPendingSell(state, mint)) selling.delete(mint);
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPendingBuy(state, mint)) held.delete(mint);
      }
      const k = pieces();

      // Exits first: take profit, cut losers, trail, time out, or leave the
      // moment the creator sells / the tape goes quiet / flow turns against us.
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const coin = coins.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: state.slot, txPaid: tx, best: 0n, devSoldAtOpen: coin?.devSold ?? false, tookTp1: false };
          held.set(mint, h);
        }
        let mk = marks.get(mint);
        if (mk === undefined) {
          const cv = state.curves.get(mint);
          if (cv === undefined) continue;
          mk = { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
        }
        const value = sellValue(pos.token_amount, mk.vq, mk.vt) - tx;
        const basis = pos.cost_lamports + h.txPaid;
        if (value > h.best) h.best = value;
        let exit = false;
        if (basis > 0n) {
          // Partial take-profit first: sell a slice, then let the rest run
          // under its own (tighter) stop. Off by default (tp1Bps huge).
          if (!h.tookTp1 && value * BPS >= basis * (BPS + BigInt(P.tp1Bps))) {
            const part = (pos.token_amount * BigInt(P.tp1PartBps)) / BPS;
            if (part > 0n && part < pos.token_amount) {
              orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
              selling.add(mint);
              h.tookTp1 = true;
              h.best = 0n;
              if (coin !== undefined) coin.done = true;
              continue;
            }
          }
          if (value * BPS >= basis * (BPS + BigInt(P.tpBps))) exit = true;
          const sl = h.tookTp1 ? BigInt(P.slAfterTp1Bps) : BigInt(P.slBps);
          if (value * BPS <= basis * (BPS - sl)) exit = true;
          if (h.best * BPS >= basis * (BPS + BigInt(P.trailArmBps)) && value * BPS <= h.best * (BPS - BigInt(P.trailBps))) exit = true;
        }
        if (state.slot - h.openedSlot >= P.maxHold) exit = true;
        if (coin !== undefined) {
          if (P.exitOnDevSell && coin.devSold && !h.devSoldAtOpen) exit = true;
          if (state.slot - coin.lastTradeSlot >= P.staleSlots) exit = true;
          if (flow(coin, state.slot).net < -BigInt(P.exitFlowLamports)) exit = true;
        }
        if (!exit) continue;
        orders.push(...sellOrders(mint, pos.token_amount, k, cap - orders.length));
        selling.add(mint);
        if (coin !== undefined) coin.done = true;
      }

      // Entries and adds.
      let free = state.freeCashLamports() - tx * BigInt(orders.length);
      // Leave room in the reply for the split pieces of an exit next to new buys.
      let open = state.committedPositionCount();
      for (const coin of coins.values()) {
        if (orders.length >= cap) break;
        if (coin.done || coin.complete) continue;
        const age = state.slot - coin.createSlot;
        const isAdd = coin.buysSent > 0;
        if (!isAdd && age > P.maxAge) {
          coin.done = true;
          continue;
        }
        if (age < P.minAge) continue;
        if (isAdd) {
          if (coin.buysSent > P.maxAdds) continue;
          if (!state.positions.has(coin.mint) || selling.has(coin.mint) || hasPendingBuy(state, coin.mint)) continue;
        } else if (open >= state.hello.caps.max_open_positions) continue;
        const curve = state.curves.get(coin.mint);
        if (curve === undefined || curve.complete) continue;
        if (coin.devSold && (P.skipDevSold || isAdd)) {
          if (!isAdd) coin.done = true;
          continue;
        }
        const vq = curve.virtual_quote_reserves;
        const vt = curve.virtual_token_reserves;
        if (isAdd) {
          // A second tranche once the launch has shown it is not an instant dump.
          if (state.slot - coin.lastBuySlot < P.addDelay) continue;
          if (vq * coin.lastBuyVt * BPS < coin.lastBuyVq * vt * BigInt(10_000 + P.addStepBps)) continue;
          if (flow(coin, state.slot).net < BigInt(P.addMinFlowLamports)) continue;
          const maxAdd = state.maxBuyLamports(coin.mint);
          const want = BigInt(P.addLamports);
          const amount = want < maxAdd ? want : maxAdd;
          if (amount < minBuy || free < amount + tx * 6n) continue;
          const add = buyOrders(coin.mint, amount, k, cap - orders.length);
          orders.push(...add);
          free -= amount + tx * BigInt(add.length);
          coin.buysSent += 1;
          coin.spentSent += amount;
          coin.lastBuyVq = vq;
          coin.lastBuyVt = vt;
          coin.lastBuySlot = state.slot;
          continue;
        }
        // Rug filter: the launch must look committed, not bundled, not dumped.
        const rq = curve.real_quote_reserves;
        if (rq < BigInt(P.minRealSol) || rq > BigInt(P.maxRealSol)) continue;
        if (coin.devBuy < BigInt(P.minDevBuy) || coin.devBuy > BigInt(P.maxDevBuy)) continue;
        if (coin.trades < P.minTrades || coin.buyers.size < P.minBuyers || coin.buyers.size > P.maxBuyers) continue;
        if (coin.bought > 0n && coin.soldByOthers * BPS > coin.bought * BigInt(P.maxSellRatioBps)) continue;
        if (coin.bigSellBps > BigInt(P.maxBigSellBps)) continue;
        const runup = (vq * coin.vt0 * BPS) / (vt * coin.vq0);
        if (runup > BigInt(P.maxRunupBps) || runup < BigInt(P.minRunupBps)) continue;
        const fl = flow(coin, state.slot);
        if (fl.net < BigInt(P.minFlowLamports) || fl.buyers < P.minRecentBuyers) continue;
        const room = stake - coin.spentSent;
        if (room < minBuy) continue;
        const maxBuy = state.maxBuyLamports(coin.mint);
        const amount = room < maxBuy ? room : maxBuy;
        if (amount < minBuy) continue;
        if (free < amount + tx * 6n) continue;
        const buys = buyOrders(coin.mint, amount, k, cap - orders.length);
        orders.push(...buys);
        free -= amount + tx * BigInt(buys.length);
        coin.buysSent += 1;
        coin.spentSent += amount;
        coin.lastBuyVq = vq;
        coin.lastBuyVt = vt;
        coin.lastBuySlot = state.slot;
        open += 1;
      }
      return orders;
    },
  };
}
