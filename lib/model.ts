// Comparables valuation for pre-token DeFi protocols (Node 22, standard library only).
//
// The question the board answers: if a protocol's record stayed as it is today, what would its token be
// worth? We answer it the way an analyst prices a private company, by comparables. The snapshot itself
// carries ~128 protocols whose token already trades; each one's market cap over its TVL is a live
// "price of a dollar of deposits" for its category. A pre-token protocol is valued at
//
//   implied = TVL × category multiple × growth tilt × maturity tilt
//
// where the category multiple is the median mcap/TVL of that category's live tokens (the global median
// when a category has too few), clamped to [0.03, 3]; the growth tilt reads the 7-day TVL change; the
// maturity tilt reads how long the protocol has run with no token. Nothing is keyed on a protocol's name.

export const MODEL_VERSION = 'radar-comps-1';

/** A category needs this many live tokens before its own median is trusted over the global one. */
export const MIN_COMPS = 3;
export const MULTIPLE_FLOOR = 0.03;
export const MULTIPLE_CAP = 3;
export const BOARD_SIZE = 200;

export interface Protocol {
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
  protocols: Protocol[];
  watchlist: string[];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) throw new Error('snapshot: as_of is not a YYYY-MM-DD date');
  return raw;
}

/** DefiLlama records no token for it: say "records no token", never "has none". */
export const recordsNoToken = (p: Protocol): boolean => p.gecko_id === null && p.symbol === null;

/** A comparable: a token that trades, with a market cap and deposits to divide it by. */
export const isLiveComp = (p: Protocol): boolean =>
  !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

export interface Comp {
  slug: string;
  name: string;
  symbol: string | null;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface CompSet {
  global: number;
  live: Comp[];
  byCategory: Map<string, Comp[]>;
}

/** Every live token's mcap/TVL, grouped by category, plus the global median. */
export function computeComps(snapshot: Snapshot): CompSet {
  const live: Comp[] = snapshot.protocols.filter(isLiveComp).map((p) => ({
    slug: p.slug,
    name: p.name,
    symbol: p.symbol,
    category: p.category ?? 'Uncategorised',
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd!,
    ratio: round4(p.mcap_usd! / p.tvl_usd),
  }));
  const byCategory = new Map<string, Comp[]>();
  for (const c of live) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  for (const list of byCategory.values()) list.sort((a, b) => b.mcap_usd - a.mcap_usd || a.slug.localeCompare(b.slug));
  live.sort((a, b) => b.mcap_usd - a.mcap_usd || a.slug.localeCompare(b.slug));
  return { global: round4(median(live.map((c) => c.ratio))), live, byCategory };
}

export interface Multiple {
  value: number;
  raw: number;
  basis: 'category' | 'global';
  comps: number;
}

/** The category's median multiple when it has MIN_COMPS live tokens, else the global median; clamped. */
export function compMultiple(category: string | null, comps: CompSet): Multiple {
  const list = comps.byCategory.get(category ?? 'Uncategorised') ?? [];
  if (list.length >= MIN_COMPS) {
    const raw = round4(median(list.map((c) => c.ratio)));
    return { value: round4(clamp(raw, MULTIPLE_FLOOR, MULTIPLE_CAP)), raw, basis: 'category', comps: list.length };
  }
  return { value: round4(clamp(comps.global, MULTIPLE_FLOOR, MULTIPLE_CAP)), raw: comps.global, basis: 'global', comps: comps.live.length };
}

/** 7-day TVL momentum: a smooth tilt, +20% a week ≈ ×1.38, −20% ≈ ×0.62, flat or unreported = ×1. */
export function growthTilt(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  return round4(1 + 0.5 * Math.tanh(change7d / 20));
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * How long it has run with no token. A thin record (< 6 months) is discounted; 12–36 months tokenless with
 * deposits intact is the strongest record; past three years each further month without a token makes
 * a launch less likely, so the tilt decays to a floor.
 */
export function maturityTilt(ageDays: number | null): number {
  if (ageDays === null) return 1;
  const months = ageDays / 30.44;
  let t: number;
  if (months < 6) t = 0.8 + (months / 6) * 0.2;
  else if (months < 18) t = 1 + ((months - 6) / 12) * 0.15;
  else if (months <= 36) t = 1.15;
  else t = 1.15 - (months - 36) * 0.01;
  return round4(clamp(t, 0.85, 1.15));
}

export interface Valuation {
  multiple: Multiple;
  growth: number;
  maturity: number;
  age_days: number | null;
  implied_value_usd: number;
}

export function impliedValue(p: Protocol, comps: CompSet, asOf: string): Valuation {
  const multiple = compMultiple(p.category, comps);
  const growth = growthTilt(p.change_7d);
  const age = p.listed_at === null ? null : Math.max(0, daysBetween(p.listed_at, asOf));
  const maturity = maturityTilt(age);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple.value * growth * maturity));
  return { multiple, growth, maturity, age_days: age, implied_value_usd: implied };
}

// ---------------------------------------------------------------------------------------------------
// Who goes on the board. The watchlist is the floor; below $50M we apply the house's own product rule
// (no wrapped / staked / bridged / exchange products, no version-marker names) to every protocol that
// records no token. Records that fail it are listed apart as "set aside", never ranked as launches.

const WRAPPER_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Why a no-token record is not a launch candidate, or null when it is one. */
export function setAsideReason(p: Protocol): string | null {
  if (p.category !== null && WRAPPER_CATEGORIES.has(p.category)) return `${p.category} product`;
  if (VERSION_MARK.test(p.name)) return 'a version of an existing protocol';
  if (WRAPPER_WORD.test(p.name)) return 'a wrapped or staked product';
  if (EXCHANGE_PREFIX.test(p.name)) return "an exchange's product";
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Farm plans. Every step names what it costs and how long it takes, from the protocol's own chains,
// category, size and momentum. Gas figures are typical late-2026 costs of one transaction.

interface ChainCost { gas: string; usd: number }
const CHAIN_COST: Record<string, ChainCost> = {
  Ethereum: { gas: '$2-10 per transaction', usd: 6 },
  Bitcoin: { gas: '$1-4 per on-chain transaction', usd: 2.5 },
  Tron: { gas: '$1-3 of energy per transaction', usd: 2 },
  Binance: { gas: 'about $0.05 per transaction', usd: 0.05 },
  Arbitrum: { gas: 'under $0.05 per transaction', usd: 0.03 },
  Base: { gas: 'under $0.02 per transaction', usd: 0.01 },
  Optimism: { gas: 'under $0.02 per transaction', usd: 0.01 },
  Polygon: { gas: 'under $0.02 per transaction', usd: 0.01 },
  Avalanche: { gas: 'about $0.05 per transaction', usd: 0.05 },
  Solana: { gas: 'under $0.01 per transaction', usd: 0.005 },
  Sui: { gas: 'under $0.01 per transaction', usd: 0.005 },
  Aptos: { gas: 'under $0.01 per transaction', usd: 0.005 },
  'Hyperliquid L1': { gas: 'no gas on trades, about $1 to bridge in', usd: 0.08 },
  Monad: { gas: 'under $0.01 per transaction', usd: 0.005 },
  Plasma: { gas: 'zero-fee USDT transfers, cents otherwise', usd: 0.004 },
  Sonic: { gas: 'under $0.01 per transaction', usd: 0.005 },
  Berachain: { gas: 'under $0.02 per transaction', usd: 0.01 },
  Linea: { gas: 'under $0.05 per transaction', usd: 0.03 },
  Mantle: { gas: 'under $0.02 per transaction', usd: 0.01 },
  Ripple: { gas: 'a fraction of a cent per transaction', usd: 0.001 },
  Stellar: { gas: 'a fraction of a cent per transaction', usd: 0.001 },
  TON: { gas: 'about $0.02 per transaction', usd: 0.02 },
  Cardano: { gas: 'about $0.20 per transaction', usd: 0.2 },
};
const DEFAULT_COST: ChainCost = { gas: 'well under $1 per transaction', usd: 0.25 };

/** The cheapest chain the protocol runs on, with its gas line. */
export function cheapestChain(chains: string[]): ChainCost & { chain: string } {
  let best: (ChainCost & { chain: string }) | null = null;
  for (const chain of chains) {
    const c = CHAIN_COST[chain] ?? DEFAULT_COST;
    if (best === null || c.usd < best.usd) best = { chain, ...c };
  }
  return best ?? { chain: 'its main chain', ...DEFAULT_COST };
}

export function usd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

type Play = (p: Protocol, chain: string) => string[];

/** What a depositor actually does in each kind of protocol: the two core steps. */
const PLAYS: Record<string, Play> = {
  Lending: (p, c) => [
    `Supply $1,000-2,500 of USDC or USDT to ${p.name} on ${c}: one approve and one deposit, about 5 minutes. Supplied balance x days is what lending point programs usually weigh.`,
    `Borrow against it at 25-30% loan-to-value and keep the loan open; repay and re-borrow once a month (2 transactions, 5 minutes) so the account shows both sides of the book.`,
  ],
  Dexs: (p, c) => [
    `Add $500-2,000 of liquidity to one of ${p.name}'s two or three deepest pools on ${c}, a stable or ETH pair: about 10 minutes; expect 0.5-2% impermanent loss a month on volatile pairs.`,
    `Make 3-5 real swaps a week of $50-200 each (well under $1 a week in fees on a cheap chain); swap count and active weeks are what DEX snapshots tend to read.`,
  ],
  'Risk Curators': (p, c) => [
    `Deposit $1,000-5,000 of USDC into ${p.name}'s largest curated vault on ${c}: one approve and one deposit, about 5 minutes; the curator, not you, picks the underlying markets.`,
    `Leave it for at least 60 days and check the vault's allocation once a week (2 minutes); curator programs usually weigh deposit size x time, so early, steady balances count most.`,
  ],
  'Onchain Capital Allocator': (p, c) => [
    `Allocate $1,000-3,000 of stablecoins to ${p.name}'s main strategy on ${c}: about 10 minutes including reading its allocation page.`,
    `Hold through at least two monthly rebalances (about 60 days) and claim interim rewards as they unlock (1 transaction, 2 minutes each).`,
  ],
  Yield: (p, c) => [
    `Deposit $1,000-3,000 into ${p.name}'s highest-TVL vault on ${c}: one approve and one deposit, about 5 minutes; prefer the stablecoin vault over leveraged ones for a first position.`,
    `Compound or claim rewards every two weeks (1 transaction, 2 minutes) and keep the deposit for 60-90 days.`,
  ],
  RWA: (p, c) => [
    `Pass ${p.name}'s KYC or accreditation check if it asks for one: 1-3 days of review and a passport scan; many RWA issuers set $1,000-100,000 minimums, so read the subscription page first (10 minutes).`,
    `Subscribe to the tokenised fund or note on ${c} and hold it in your own wallet; settlement takes T+0 to T+2 and redemptions can be monthly, so size only what you can leave for a quarter.`,
  ],
  'Basis Trading': (p, c) => [
    `Mint ${p.name}'s yield-bearing dollar on ${c} with $1,000-3,000 of USDC (about 5 minutes) and stake it in its savings vault; note the unstake cooldown, often 7 days.`,
    `Put a slice into a DEX pool or money market that accepts it; such programs often multiply points for using the dollar elsewhere. Re-check funding rates weekly (2 minutes): negative funding cuts the yield.`,
  ],
  CDP: (p, c) => [
    `Open a vault at ${p.name} on ${c}: deposit $1,000-3,000 of collateral and mint its stablecoin at no more than 40% of the maximum loan-to-value, about 10 minutes.`,
    `Use the minted stablecoin in its savings module or a partner pool, and top up collateral if the ratio falls 15 points; check it twice a week (1 minute each).`,
  ],
  Restaking: (p, c) => [
    `Restake $500-2,000 of the native asset through ${p.name} on ${c} (about 10 minutes); read the unbonding period first, often 7-21 days.`,
    `Delegate to one of its top operators and leave it for 90 days; claim points or rewards monthly (1 transaction, 2 minutes).`,
  ],
  Chain: (p) => [
    `Bridge $200-1,000 into ${p.name} through its official bridge: 10-30 minutes, $1-10 in fees from Ethereum or cents from an L2.`,
    `Use 3-5 of its own apps every week, a swap, a lend and a mint, about 15 minutes a week; chain-level drops have rewarded distinct active weeks more than size.`,
  ],
  Derivatives: (p, c) => [
    `Deposit $300-1,000 of USDC as margin on ${p.name} (${c}) and trade with resting limit orders, which pay maker fees or earn rebates, instead of market orders.`,
    `Keep leverage at 2x or less, or run delta-neutral (long spot, short perp); aim for steady weekly volume over 8-12 weeks rather than one burst.`,
  ],
  Insurance: (p, c) => [
    `Buy a small cover for a protocol you already use through ${p.name} on ${c} (roughly $20-100 a year for $2,000-5,000 of cover), about 10 minutes.`,
    `Or underwrite: stake $500-2,000 in one of its capital pools for 90 days; read the claim-assessment rules first (10 minutes), since a paid claim can cut the stake.`,
  ],
  Payments: (p, c) => [
    `Open a ${p.name} account and fund it with $100-500 of stablecoins on ${c}: 10-20 minutes, plus a KYC check of a day or two if it issues a card.`,
    `Pay with it weekly, real purchases or transfers (5 minutes a week); spend count and active weeks are what payment programs measure.`,
  ],
  'Governance Incentives': (p, c) => [
    `Lock a small position in a gauge token that ${p.name} routes votes for on ${c}, and delegate its votes through ${p.name} (about 10 minutes).`,
    `Claim the weekly incentives each epoch (1 transaction, 2 minutes) for at least 8 weeks.`,
  ],
};
PLAYS['Yield Aggregator'] = PLAYS.Yield!;
PLAYS['Stablecoin Wrapper'] = PLAYS.CDP!;
PLAYS['Dual-Token Stablecoin'] = PLAYS.CDP!;
PLAYS['Staking Pool'] = PLAYS.Restaking!;
PLAYS.CeDeFi = PLAYS.Payments!;
PLAYS['Collateral Markets'] = PLAYS.Lending!;

const GENERIC: Play = (p, c) => [
  `Use ${p.name}'s main product on ${c} with $500-2,000: one deposit or position, about 10 minutes; read its docs page on fees and withdrawals first (5 minutes).`,
  `Interact once a week for 8-12 weeks (about 5 minutes a visit) rather than once with more money; most programs read active weeks as well as size.`,
];

/** 3 to 12 concrete steps, each 20 to 600 characters. */
export function farmPlan(p: Protocol, v: Valuation, asOf: string): string[] {
  const cheap = cheapestChain(p.chains);
  const where = p.chains.length > 1 ? `${cheap.chain} (the cheapest of its ${p.chains.length} chains)` : cheap.chain;
  const play = (p.category !== null ? PLAYS[p.category] : undefined) ?? GENERIC;
  const hold = v.age_days !== null && v.age_days < 365 ? '8-12 weeks' : '3-6 months';
  const budget = Math.max(1, Math.ceil(cheap.usd * 12));
  const momentum = p.change_7d === null
    ? 'its 7-day TVL change is unreported'
    : `its TVL moved ${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}% in the last 7 days`;
  return [
    `Set up a fresh wallet for ${p.name} and fund it on ${where}: gas there is ${cheap.gas}; budget about $${budget} for the dozen transactions this plan takes, 15 minutes to set up.`,
    ...play(p, cheap.chain),
    `Hold for ${hold} with a weekly 2-minute check: ${momentum} on ${usd(p.tvl_usd)} of deposits. Withdraw if TVL falls more than 25% in a week; that record is what this valuation rests on.`,
    `Verify before you buy anything: DefiLlama records no token for ${p.name} as of ${asOf}, which is not proof it has none. Trust only a token announced on its official site or docs; claim links sent by DM are scams.`,
  ];
}

// ---------------------------------------------------------------------------------------------------
// The board and the page's data.

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  token_status: 'records-no-token';
  multiple: number;
  multiple_raw: number;
  multiple_basis: 'category' | 'global';
  multiple_comps: number;
  growth_tilt: number;
  maturity_tilt: number;
}

export interface Radar {
  model: string;
  as_of: string;
  source: string;
  floor_usd: number;
  global_multiple: number;
  min_comps: number;
  clamp: [number, number];
  counts: { protocols: number; watchlist: number; board: number; live: number; set_aside: number };
  rows: BoardRow[];
  comps: Comp[];
  set_aside: { slug: string; name: string; category: string | null; tvl_usd: number; reason: string }[];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const comps = computeComps(snapshot);
  const watch = new Set(snapshot.watchlist);
  const candidates: Protocol[] = [];
  const setAside: Radar['set_aside'] = [];
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) continue;
    const reason = watch.has(p.slug) ? null : setAsideReason(p);
    if (reason === null) candidates.push(p);
    else setAside.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason });
  }
  // Watchlist first, then the largest candidates below the floor, up to BOARD_SIZE.
  candidates.sort((a, b) => Number(watch.has(b.slug)) - Number(watch.has(a.slug)) || b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
  const chosen = candidates.slice(0, Math.max(BOARD_SIZE, snapshot.watchlist.length));

  const rows: BoardRow[] = chosen.map((p) => {
    const v = impliedValue(p, comps, snapshot.as_of);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      implied_value_usd: v.implied_value_usd,
      farm_steps: farmPlan(p, v, snapshot.as_of),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: v.age_days,
      watchlist: watch.has(p.slug),
      token_status: 'records-no-token',
      multiple: v.multiple.value,
      multiple_raw: v.multiple.raw,
      multiple_basis: v.multiple.basis,
      multiple_comps: v.multiple.comps,
      growth_tilt: v.growth,
      maturity_tilt: v.maturity,
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  rows.forEach((r, i) => { r.rank = i + 1; });
  setAside.sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));

  const radar: Radar = {
    model: MODEL_VERSION,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    global_multiple: comps.global,
    min_comps: MIN_COMPS,
    clamp: [MULTIPLE_FLOOR, MULTIPLE_CAP],
    counts: { protocols: snapshot.protocols.length, watchlist: snapshot.watchlist.length, board: rows.length, live: comps.live.length, set_aside: setAside.length },
    rows,
    comps: comps.live,
    set_aside: setAside,
  };
  return { board: rows, radar };
}

/** The gate's seven board rules, checked before anything is written. null when the board passes. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `${board.length} rows, not 100 to 4,000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const [i, r] of board.entries()) {
    if (!known.has(r.slug)) return `row ${i}: ${r.slug} is not in the snapshot`;
    if (seen.has(r.slug)) return `row ${i}: ${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `row ${i}: rank ${r.rank}, expected ${i + 1}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) return `${r.slug}: implied value ${r.implied_value_usd}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `${r.slug}: value rises at rank ${r.rank}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const n = s.trim().length;
      if (n < 20 || n > 600) return `${r.slug}: a farm step of ${n} characters`;
    }
  }
  for (const w of snapshot.watchlist) if (!seen.has(w)) return `watchlist slug ${w} is missing`;
  if (new Set(board.map((r) => r.implied_value_usd)).size === 1) return 'every implied value is the same';
  return null;
}

/** The page's data, as a script the dashboard loads from ../data.js (no fetch, so it opens from disk). */
export function dataScript(radar: Radar): string {
  return `// ${radar.model}: written by main.ts from the sealed snapshot of ${radar.as_of}.\nwindow.RADAR = ${JSON.stringify(radar)};\n`;
}
