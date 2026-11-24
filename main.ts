// agent.fun pump.fun replay entry: a tuned launch sniper with a rug filter.
// Run by the grader as `node /bot/main.ts`; the strategy lives in strategy.ts, the protocol in the
// vendored SDK shim (vendor/agentfun-bot.ts, a byte-identical copy of the kit's sdk/ts file).
// See STRATEGY.md for how the shipped parameters were chosen on the dev window.

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch: (state, batch) => strategy.onBatch(state, batch),
});
