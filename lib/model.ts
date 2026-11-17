// Token Radar model: an implied launch value for every protocol in the sealed
// snapshot that records no token, fitted from the snapshot's own tokenized
// protocols — never from a hardcoded list of names.
//
// The fit (fitCategoryMultiples): for each tokenized protocol the market's own
// multiple is mcap_usd / tvl_usd. A category's multiple is the median of its
// members' multiples, shrunk toward the global median in log space with
// weight n / (n + SHRINK_K), so a category priced by three protocols leans on
// the global figure and one priced by thirty mostly stands on its own.
// Categories with fewer than MIN_CATEGORY members get the global median.
// impliedValueUsd is then TVL x the protocol's category multiple.
//
// The honesty check (validateOutOfSample): the fit set is split by slug order
// — every third protocol is held out — the model is fitted on the training
// part only, and its predictions are scored against the held-out part's real
// market caps. Growth and age adjustments were fitted the same way during
// development and rejected: inside training, 5-fold cross-validation scored
// them worse than the plain category model, and the held-out split agreed.
// The shipped model is the one that survived; its error is printed on the
// dashboard, not hidden.
//
// Language: a protocol whose mcap_usd, gecko_id and symbol are all null
// "records no token" in this snapshot. That is all anyone can say from the
// file, so that is the phrase the entry uses.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface CategoryFit {
  category: string;
  n: number;
  median_multiple: number;
  blended_multiple: number;
}

export interface FittedModel {
  global_multiple: number;
  fit_n: number;
  zero_mcap_excluded: number;
  categories: CategoryFit[];
  byCategory: Map<string, CategoryFit>;
}

export interface Validation {
  train_n: number;
  test_n: number;
  median_ape_pct: number;
  mape_pct: number;
  median_factor: number;
  spearman: number;
  flat_baseline_median_ape_pct: number;
  global_baseline_median_ape_pct: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  multiple_used: number;
  category_peers: number;
  watchlist: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  change_7d: number | null;
}

export interface Radar {
  board: BoardRow[];
  live: LiveRow[];
  model: FittedModel;
  validation: Validation;
  early_size: number;
  live_size: number;
}

const MIN_CATEGORY = 3;
const SHRINK_K = 4;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
/** Product types the watchlist definition itself sets aside: a wrapped, staked or bridged product of a token that already trades is not a launch waiting to happen. */
const PRODUCT_TYPES_SET_ASIDE = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** A protocol records no token when all three token fields are null. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Rankable on the board: records no token, and passes the same product-type
 * line the snapshot's watchlist definition draws — no wrapped, staked or
 * bridged products, no exchange-fronted names, no version-suffixed names —
 * applied without the watchlist's $50M floor. The floor is a size line; the
 * product-type line is a kind line, and the board keeps the kind line.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    recordsNoToken(p) &&
    !(p.category !== null && PRODUCT_TYPES_SET_ASIDE.has(p.category)) &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))
  );
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** The protocols the multiples are fitted on: a token with a real, positive market cap and TVL. */
export function fitSet(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/**
 * Fit the category multiples on the given protocols. The global median is
 * computed from exactly the protocols passed in — callers validating
 * out-of-sample pass the training part only, so no held-out figure can leak
 * into a category median or into the global fallback.
 */
export function fitCategoryMultiples(protocols: SnapshotProtocol[]): FittedModel {
  const fit = fitSet(protocols);
  const global = median(fit.map((p) => p.mcap_usd! / p.tvl_usd));
  const groups = new Map<string, number[]>();
  for (const p of fit) {
    const key = p.category ?? 'Uncategorized';
    const list = groups.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    groups.set(key, list);
  }
  const categories: CategoryFit[] = [];
  const byCategory = new Map<string, CategoryFit>();
  for (const [category, multiples] of groups) {
    if (multiples.length < MIN_CATEGORY) continue;
    const med = median(multiples);
    const w = multiples.length / (multiples.length + SHRINK_K);
    const blended = Math.exp(w * Math.log(med) + (1 - w) * Math.log(global));
    const entry: CategoryFit = {
      category,
      n: multiples.length,
      median_multiple: round6(med),
      blended_multiple: round6(blended),
    };
    categories.push(entry);
    byCategory.set(category, entry);
  }
  categories.sort((a, b) => b.blended_multiple - a.blended_multiple);
  return {
    global_multiple: round6(global),
    fit_n: fit.length,
    zero_mcap_excluded: protocols.filter((p) => p.mcap_usd === 0).length,
    categories,
    byCategory,
  };
}

/** The multiple applied to one protocol: its category's blended multiple, or the global median. */
export function multipleFor(p: SnapshotProtocol, model: FittedModel): { multiple: number; peers: number } {
  const fit = model.byCategory.get(p.category ?? 'Uncategorized');
  if (fit) return { multiple: fit.blended_multiple, peers: fit.n };
  return { multiple: model.global_multiple, peers: 0 };
}

/** impliedValueUsd: the model's whole claim — TVL times the fitted category multiple. */
export function impliedValueUsd(p: SnapshotProtocol, model: FittedModel): number {
  const { multiple } = multipleFor(p, model);
  return Math.max(1, Math.round(p.tvl_usd * multiple));
}

function apeStats(preds: number[], actuals: number[]): { medianApe: number; mape: number; medianFactor: number; spearman: number } {
  const apes = preds.map((pr, i) => Math.abs(pr - actuals[i]!) / actuals[i]!);
  const factors = preds.map((pr, i) => Math.exp(Math.abs(Math.log(pr / actuals[i]!))));
  const rankOf = (xs: number[]): number[] => {
    const order = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!);
    const ranks = new Array<number>(xs.length);
    order.forEach((idx, r) => (ranks[idx] = r));
    return ranks;
  };
  const pr = rankOf(preds);
  const ar = rankOf(actuals);
  const n = preds.length;
  const d2 = pr.reduce((sum, r, i) => sum + (r - ar[i]!) ** 2, 0);
  const spearman = 1 - (6 * d2) / (n * (n * n - 1));
  return {
    medianApe: median(apes) * 100,
    mape: (apes.reduce((a, b) => a + b, 0) / apes.length) * 100,
    medianFactor: median(factors),
    spearman,
  };
}

/**
 * Out-of-sample validation. The fit set, sorted by slug, is split
 * deterministically: every third protocol is held out. The model is fitted
 * on the training part only — category medians, shrinkage and the global
 * fallback all come from training figures — then scored on the held-out
 * part against its real market caps, beside two baselines scored the same way.
 */
export function validateOutOfSample(protocols: SnapshotProtocol[]): Validation {
  const fit = fitSet(protocols).sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const train = fit.filter((_, i) => i % 3 !== 2);
  const test = fit.filter((_, i) => i % 3 === 2);
  const model = fitCategoryMultiples(train);
  const actuals = test.map((p) => p.mcap_usd!);
  const stats = apeStats(test.map((p) => impliedValueUsd(p, model)), actuals);
  const flat = apeStats(test.map((p) => Math.round(p.tvl_usd * 0.25)), actuals);
  const globalOnly = apeStats(test.map((p) => Math.round(p.tvl_usd * model.global_multiple)), actuals);
  return {
    train_n: train.length,
    test_n: test.length,
    median_ape_pct: Math.round(stats.medianApe * 10) / 10,
    mape_pct: Math.round(stats.mape * 10) / 10,
    median_factor: Math.round(stats.medianFactor * 100) / 100,
    spearman: Math.round(stats.spearman * 100) / 100,
    flat_baseline_median_ape_pct: Math.round(flat.medianApe * 10) / 10,
    global_baseline_median_ape_pct: Math.round(globalOnly.medianApe * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Farm plans. Generated per protocol from its category's line of work, its
// chains and its size: the actions, the capital band and the gas budget all
// move with the protocol, and a per-slug hash picks among phrasings so two
// protocols in one category do not read as one plan with the name swapped.
// ---------------------------------------------------------------------------

const GAS_TOKEN: Record<string, string> = {
  Ethereum: 'ETH', Base: 'ETH', Arbitrum: 'ETH', Optimism: 'ETH', Linea: 'ETH',
  Scroll: 'ETH', 'zkSync Era': 'ETH', Mantle: 'MNT', Solana: 'SOL',
  'BNB Chain': 'BNB', Binance: 'BNB', Polygon: 'POL', Avalanche: 'AVAX', Sui: 'SUI',
  Aptos: 'APT', Tron: 'TRX', Bitcoin: 'BTC', Cosmos: 'ATOM', NEAR: 'NEAR',
  Fantom: 'FTM', Starknet: 'STRK', Hyperliquid: 'HYPE', Sei: 'SEI',
  Injective: 'INJ', Celestia: 'TIA', Berachain: 'BERA', Monad: 'MON',
  Stellar: 'XLM', Bittensor: 'TAO', Sonic: 'S', Flare: 'FLR', Algorand: 'ALGO',
  TON: 'TON', Ripple: 'XRP', Cardano: 'ADA', Ink: 'ETH', Doge: 'DOGE', Litecoin: 'LTC',
};

interface Tier { position: string; gas: string; weeks: string }
function tierFor(tvl: number): Tier {
  if (tvl >= 250_000_000) return { position: '$2,500–$10,000', gas: '$60–$150', weeks: '8–12 weeks' };
  if (tvl >= 100_000_000) return { position: '$1,000–$4,000', gas: '$40–$100', weeks: '8–12 weeks' };
  if (tvl >= 50_000_000) return { position: '$500–$2,000', gas: '$25–$60', weeks: '6–10 weeks' };
  if (tvl >= 15_000_000) return { position: '$200–$800', gas: '$15–$40', weeks: '6–8 weeks' };
  return { position: '$50–$300', gas: '$5–$20', weeks: '4–6 weeks' };
}

/** Small deterministic string hash (FNV-1a): picks plan phrasings per protocol. */
function hashSlug(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface PlanShape { open: string; core: string; second: string; secondSolo?: string }
const PLAN_SHAPES: Record<string, PlanShape> = {
  Dexs: {
    open: 'Open the swap interface and make a first small trade',
    core: 'route regular swaps through it and add two-sided liquidity to one of its main pools',
    second: 'trade on its second-busiest chain as well, so activity is not confined to one network',
    secondSolo: 'add liquidity to a second pool with a different pair, so the history is not one market only',
  },
  Lending: {
    open: 'Open a supply position in its main money market',
    core: 'supply collateral, borrow a modest share against it and repay on a cycle, keeping the health factor comfortably above liquidation',
    second: 'run a second, smaller supply position on another chain it serves',
    secondSolo: 'run a second, smaller supply position in a different asset market it lists, so the history is not one market only',
  },
  'Liquid Staking': {
    open: 'Stake a first tranche through its staking contract',
    core: 'hold the liquid staking receipt in the wallet and use it in one integrated DeFi position rather than selling it',
    second: 'stake a second tranche from a different chain it supports, if it takes deposits there',
    secondSolo: 'stake a second tranche at a later date rather than one lump, so the staking history spans the window',
  },
  'Liquid Restaking': {
    open: 'Restake a first tranche of the underlying staking receipt',
    core: 'keep the restaked position live across the plan window and claim any points or rewards it issues on schedule',
    second: 'add a second restaking vault or operator set if the protocol offers one',
  },
  Restaking: {
    open: 'Delegate or restake a first tranche through its main vault',
    core: 'keep the position delegated for the full window and track its operator or AVS rewards as they accrue',
    second: 'split a smaller second tranche across another operator or vault it lists',
  },
  'Staking Pool': {
    open: 'Stake a first tranche in its main pool',
    core: 'compound or re-stake rewards on a fixed cadence instead of letting them sit idle',
    second: 'join a second pool it runs where the terms differ, to hold more than one position type',
  },
  Bridge: {
    open: 'Bridge a small amount across its busiest route',
    core: 'move funds in both directions on two different routes, at varied times of day, rather than one large crossing',
    second: 'use its liquidity or relay product on a second chain pair if it offers one',
  },
  'Canonical Bridge': {
    open: 'Bridge a small amount in through the canonical route',
    core: 'cross in and out on a regular cadence and use the bridged funds in the destination chain\u2019s own apps',
    second: 'bridge through a second corridor it maintains, where one exists',
  },
  'Cross Chain Bridge': {
    open: 'Bridge a small amount across its busiest route',
    core: 'move funds in both directions on two different routes, at varied times of day, rather than one large crossing',
    second: 'use a second chain pair it supports so the history is not a single corridor',
  },
  Yield: {
    open: 'Deposit a first tranche into its main vault or strategy',
    core: 'keep the deposit live, harvest or compound on schedule, and add in tranches rather than one lump',
    second: 'open a smaller position in a second vault with a different strategy or asset',
  },
  'Yield Aggregator': {
    open: 'Deposit a first tranche into its main auto-compounding vault',
    core: 'keep the position compounding across the window and top it up in tranches',
    second: 'open a smaller position in a vault on another chain it aggregates',
    secondSolo: 'open a smaller position in a second vault on a different underlying asset it aggregates',
  },
  Farm: {
    open: 'Deposit a first tranche into its main farm',
    core: 'keep the farm position live and claim or compound rewards on a weekly cadence',
    second: 'join a second pool it runs with a different pair or asset',
  },
  'Leveraged Farming': {
    open: 'Open a small, conservatively leveraged position',
    core: 'keep leverage low, check the position\u2019s health weekly, and be ready to top up collateral rather than be liquidated',
    second: 'run a second small position on a different pair it offers',
  },
  CDP: {
    open: 'Open a small collateralised debt position',
    core: 'mint a modest amount of its stablecoin against collateral, keep the collateral ratio well above the liquidation line, and repay and re-mint on a cycle',
    second: 'use the minted stablecoin inside the protocol\u2019s own ecosystem where it is accepted',
  },
  'CDP Manager': {
    open: 'Open a small vault through its manager interface',
    core: 'keep the vault\u2019s collateral ratio conservative and adjust it on a weekly check rather than chasing the minimum',
    second: 'open a second small vault on another collateral type it manages',
  },
  Derivatives: {
    open: 'Open a first small trade on its main market',
    core: 'trade small size on a regular cadence, opening and closing cleanly, rather than holding one large directional position',
    second: 'trade a second market it lists so activity is not one instrument only',
  },
  Options: {
    open: 'Buy or write a first small option position',
    core: 'roll small positions on a weekly cadence and let some expire rather than closing everything early',
    second: 'use a second strike or expiry series it offers',
  },
  'Options Vault': {
    open: 'Deposit a first tranche into its main options vault',
    core: 'keep the deposit across several weekly epochs, since vault strategies settle per epoch',
    second: 'join a second vault on a different underlying where offered',
  },
  RWA: {
    open: 'Complete its onboarding or KYC step if it requires one, then make a first deposit',
    core: 'hold the real-world-asset position across the window and claim distributions as they are paid',
    second: 'add a second asset or tranche it offers rather than concentrating in one',
  },
  Launchpad: {
    open: 'Register or verify the wallet on its launch platform',
    core: 'take part in sales it runs at small size and hold at least part of each allocation instead of flipping all of it',
    second: 'stake or lock in its participation tier system if it runs one',
  },
  Chain: {
    open: 'Bridge starter funds onto the chain and make a first transaction',
    core: 'use its native decentralised apps weekly — swaps, lending, a name or NFT mint where cheap — so the wallet builds ordinary history',
    second: 'hold a small balance and keep transacting through quiet weeks, not only during campaigns',
  },
  'Prediction Market': {
    open: 'Fund the account and take a first small position in a liquid market',
    core: 'trade both sides across several markets over the window rather than one large bet',
    second: 'provide liquidity or take the less crowded side in a second market category',
  },
  'NFT Marketplace': {
    open: 'Make a first small purchase or listing on the marketplace',
    core: 'trade modest items on a regular cadence, listing as well as buying, so the wallet is not one-directional',
    second: 'use its second-busiest collection or chain where it operates on more than one',
  },
  Privacy: {
    open: 'Make a first small shielded deposit through its main interface',
    core: 'use the private transfer or shield flow a few times at varied amounts and intervals',
    second: 'withdraw through its standard route so the full cycle is on record',
  },
  Synthetics: {
    open: 'Mint or trade a first small synthetic position',
    core: 'keep collateral posted and adjust the position on a weekly cadence rather than setting and forgetting',
    second: 'use a second synthetic asset it issues where available',
  },
  'Risk Curators': {
    open: 'Deposit a first tranche into one of its curated vaults',
    core: 'keep the vault position live across the window and follow the curator\u2019s reallocation notices',
    second: 'split a smaller tranche into a second vault under a different curator or risk profile',
  },
  'Onchain Capital Allocator': {
    open: 'Deposit a first tranche into its main allocation vault',
    core: 'keep the allocation live, claim distributions on schedule, and add in tranches',
    second: 'open a smaller position in a second strategy it allocates to',
  },
  'Liquidity Manager': {
    open: 'Deposit a first tranche into its main managed position',
    core: 'keep the managed position in range and check it weekly, topping up rather than withdrawing at the first rebalance',
    second: 'open a second position on another pair or chain it manages',
    secondSolo: 'open a second position on another pair it manages, at a different range',
  },
  'Basis Trading': {
    open: 'Open a first small basis position through its vault',
    core: 'keep the position funded across the window; basis returns accrue with time in the trade, not with churn',
    second: 'add a second tranche on a different underlying if it offers one',
  },
  Indexes: {
    open: 'Buy a first tranche of its main index product',
    core: 'hold the index across the window and add on a monthly cadence rather than trading it',
    second: 'hold a second index it issues where the composition differs',
  },
  Insurance: {
    open: 'Buy a small cover policy or stake into its capital pool',
    core: 'keep cover or stake live across the window and renew rather than letting it lapse',
    second: 'take a second cover type it underwrites where offered',
  },
  Payments: {
    open: 'Make a first real payment or transfer through it',
    core: 'route ordinary small payments through it weekly, the way its product is meant to be used',
    second: 'use a second rail or currency it supports',
  },
  'Token Locker': {
    open: 'Lock a small amount through its locker',
    core: 'keep a lock live for a full term and renew it once, since locker usage is measured in completed terms',
    second: 'use its vesting or distribution tool if a small project-side use is available',
  },
};
const DEFAULT_SHAPE: PlanShape = {
  open: 'Make a first small transaction through its main product',
  core: 'use its core product on a regular cadence at modest size, the way a genuine early user would',
  second: 'use a second surface it offers — another chain, market or product line — so the history is not one action repeated',
};

export function farmSteps(p: SnapshotProtocol, watchlist: boolean): string[] {
  const shape = PLAN_SHAPES[p.category ?? ''] ?? DEFAULT_SHAPE;
  const tier = tierFor(p.tvl_usd);
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = GAS_TOKEN[chain] ?? 'native gas token';
  const h = hashSlug(p.slug);
  const pick = (options: string[], salt: number): string => options[(h >>> salt) % options.length]!;
  const ageNote = p.listed_at
    ? `DefiLlama has tracked it since ${p.listed_at}`
    : 'DefiLlama gives no listing date for it';
  const move = p.change_7d === null
    ? 'its 7-day TVL change is not reported'
    : `its TVL moved ${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}% over the last 7 days`;
  const steps = [
    pick([
      `Set up a dedicated wallet for ${p.name} and fund it on ${chain} with ${tier.gas} of ${gas} for fees; keep this wallet separate from any main wallet. Allow 30–45 minutes for setup and a first balance check.`,
      `Prepare one clean wallet for ${p.name}: fund it on ${chain} with roughly ${tier.gas} worth of ${gas} so fees never stall a session. Setup takes about 30 minutes, including a small test transaction.`,
      `Start with a fresh farming wallet on ${chain}: send over ${tier.gas} of ${gas} for gas and confirm a small test transaction lands before committing real size. Budget 30–45 minutes.`,
    ], 0),
    `${shape.open} on ${chain}, sized inside a ${tier.position} working position for a protocol of this scale. ${ageNote}, and ${move}, so size in gradually rather than all at once.`,
    `Core activity for ${tier.weeks}: ${shape.core}. Keep individual transactions varied in size and timing; two or three sessions a week of 15–30 minutes is a sustainable cadence.`,
    p.chains.length > 1
      ? `Spread the activity: ${p.name} also runs on ${p.chains.slice(1, 3).join(' and ')}. ${shape.second.charAt(0).toUpperCase() + shape.second.slice(1)}.`
      : `Deepen the single-chain footprint: ${shape.secondSolo ?? shape.second}. ${p.name} is tracked on ${chain} only, so breadth has to come from its own product range.`,
    pick([
      `Check ${p.name}\u2019s official site and announcements channel for a points, quests or early-user programme; if one is live, enrol the same wallet and keep a dated log of every session, position and fee in a spreadsheet. Review the log weekly, about 10 minutes.`,
      `Look for ${p.name}\u2019s points or early-user programme on its official channels and join it with the same wallet if it exists. Keep a simple log — date, action, amount, fee — after every session; it takes 5 minutes and is what proves consistent use later.`,
      `If ${p.name} runs a points, quest or governance programme, participate from the farming wallet and vote or post where it asks users to. Keep dated records of each action; 10 minutes of bookkeeping a week is enough.`,
    ], 3),
    watchlist
      ? `Stay launch-ready: ${p.name} sits on the bounty\u2019s watchlist of large protocols recording no token, so keep the position and records live until it announces a token, and keep a little ${gas} spare for a claim transaction. Re-check its official channels weekly, 5 minutes.`
      : `Stay launch-ready: keep the position and the session log live until ${p.name} announces a token or a snapshot, and keep a little ${gas} in reserve for claim-day fees. A 5-minute weekly check of its official channels is enough to catch the announcement.`,
  ];
  return steps.map((s) => s.trim());
}

// ---------------------------------------------------------------------------

export function buildRadar(snapshot: Snapshot): Radar {
  const model = fitCategoryMultiples(snapshot.protocols);
  const validation = validateOutOfSample(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => {
      const { multiple, peers } = multipleFor(p, model);
      return { p, implied: impliedValueUsd(p, model), multiple, peers };
    })
    .sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const board: BoardRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p, watch.has(s.p.slug)),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    multiple_used: s.multiple,
    category_peers: s.peers,
    watchlist: watch.has(s.p.slug),
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, 80)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round6(p.mcap_usd! / p.tvl_usd),
      change_7d: p.change_7d,
    }));
  return {
    board,
    live,
    model,
    validation,
    early_size: board.length,
    live_size: snapshot.protocols.filter((p) => p.mcap_usd !== null).length,
  };
}

/** The dashboard's data, written beside the page: window.RADAR = { board, live, model, validation, meta }. */
export function dataScript(radar: Radar, snapshot: Snapshot): string {
  const payload = {
    board: radar.board,
    live: radar.live,
    live_total: radar.live_size,
    model: {
      global_multiple: radar.model.global_multiple,
      fit_n: radar.model.fit_n,
      zero_mcap_excluded: radar.model.zero_mcap_excluded,
      categories: radar.model.categories,
    },
    validation: radar.validation,
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
    },
  };
  return `window.RADAR = ${JSON.stringify(payload)};\n`;
}

/** A self-check in the gate's own terms: returns the first refusal, or null when the board is clean. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100–4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  for (const [i, row] of board.entries()) {
    if (!slugs.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, not ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 1e14) {
      return `row ${row.slug}: implied_value_usd ${row.implied_value_usd} is not a positive whole number within the cap`;
    }
    if (row.implied_value_usd > prev) return `row ${row.slug}: implied value rises as rank ascends`;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug}: ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug}: a farm step trims to ${len} characters`;
    }
  }
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2) return 'every implied value is the same';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}
