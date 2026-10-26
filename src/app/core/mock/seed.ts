import type { AgentRank, Division, ProductKind } from '../domain/model';
import type { Ore } from '../domain/money';
import type { ModelId } from '../domain/pricing';

/*
 * Seed data for the simulation: Sentry's 20 agents, the product catalogue and the tool
 * subscriptions. In production the same records live in Airtable (Agents, Products, ToolCosts).
 */

export type TaskTemplate =
  | {
      readonly kind: 'llm';
      readonly title: string;
      readonly promptTokens: number;
      readonly maxOutputTokens: number;
    }
  | { readonly kind: 'api'; readonly title: string; readonly costOre: Ore };

export interface AgentDefinition {
  readonly id: string;
  readonly codename: string;
  readonly role: string;
  readonly division: Division;
  readonly model: ModelId;
  /** The n8n workflow that runs this agent. */
  readonly workflow: string;
  /** Agents this one hands finished work to (through the Airtable Tasks table). */
  readonly handsOffTo: readonly string[];
  readonly tasks: readonly TaskTemplate[];
}

export interface OrgPlacement {
  readonly rank: AgentRank;
  readonly team: string;
  /** null = reports to the operator. */
  readonly reportsTo: string | null;
}

/**
 * The chain of command. Each division chief is the agent its workers already hand their
 * results to (VOID decides what is worth selling, STAR sets the strategy); Sentinel
 * watches both divisions and answers only to the operator.
 */
export const ORG_CHART: Readonly<Record<string, OrgPlacement>> = {
  'T1-05': { rank: 'CHIEF', team: 'Divisionsledning', reportsTo: null },
  'T1-01': { rank: 'WORKER', team: 'Marknad', reportsTo: 'T1-05' },
  'T1-02': { rank: 'WORKER', team: 'Marknad', reportsTo: 'T1-05' },
  'T1-03': { rank: 'WORKER', team: 'Marknad', reportsTo: 'T1-05' },
  'T1-04': { rank: 'WORKER', team: 'Inköp och försäljning', reportsTo: 'T1-05' },
  'T1-06': { rank: 'WORKER', team: 'Inköp och försäljning', reportsTo: 'T1-05' },
  'T1-07': { rank: 'WORKER', team: 'Inköp och försäljning', reportsTo: 'T1-05' },
  'T1-08': { rank: 'WORKER', team: 'Order och intäkter', reportsTo: 'T1-05' },
  'T1-09': { rank: 'WORKER', team: 'Order och intäkter', reportsTo: 'T1-05' },
  'T1-10': { rank: 'WORKER', team: 'Order och intäkter', reportsTo: 'T1-05' },
  'T2-01': { rank: 'CHIEF', team: 'Divisionsledning', reportsTo: null },
  'T2-02': { rank: 'WORKER', team: 'Insikt', reportsTo: 'T2-01' },
  'T2-03': { rank: 'WORKER', team: 'Insikt', reportsTo: 'T2-01' },
  'T2-04': { rank: 'WORKER', team: 'Kampanj och innehåll', reportsTo: 'T2-01' },
  'T2-05': { rank: 'WORKER', team: 'Kampanj och innehåll', reportsTo: 'T2-01' },
  'T2-06': { rank: 'WORKER', team: 'Kampanj och innehåll', reportsTo: 'T2-01' },
  'T2-07': { rank: 'WORKER', team: 'Tillväxt och produkt', reportsTo: 'T2-01' },
  'T2-08': { rank: 'WORKER', team: 'Tillväxt och produkt', reportsTo: 'T2-01' },
  'T2-09': { rank: 'WORKER', team: 'Tillväxt och produkt', reportsTo: 'T2-01' },
  'T2-10': { rank: 'OVERSIGHT', team: 'Tillsyn', reportsTo: null },
};

const llm = (title: string, promptTokens: number, maxOutputTokens: number): TaskTemplate => ({
  kind: 'llm',
  title,
  promptTokens,
  maxOutputTokens,
});
const api = (title: string, costOre: Ore): TaskTemplate => ({ kind: 'api', title, costOre });

export const AGENTS: readonly AgentDefinition[] = [
  // Division I · Vanguard – e-handel och fysiska produkter
  {
    id: 'T1-01',
    codename: 'SCOUT',
    role: 'Produktforskning',
    division: 'VANGUARD',
    model: 'claude-haiku-5-5',
    workflow: 'WF-21 Produktpipeline',
    handsOffTo: ['T1-05', 'T1-03'],
    tasks: [
      llm('Skannar leverantörskataloger efter trendande hemprodukter', 18_000, 3_000),
      llm('Jämför 40 produkter i kategorin kök', 24_000, 4_000),
      api('Hämtar säljdata från marknadsplats-API', 60),
    ],
  },
  {
    id: 'T1-02',
    codename: 'ATLAS',
    role: 'Marknadsanalys',
    division: 'VANGUARD',
    model: 'claude-sonnet-5-5',
    workflow: 'WF-21 Produktpipeline',
    handsOffTo: ['T2-01', 'T1-05'],
    tasks: [
      llm('Beräknar efterfrågan på LED-belysning i Norden', 14_000, 3_000),
      llm('Gör säsongsanalys inför julhandeln', 20_000, 4_000),
    ],
  },
  {
    id: 'T1-03',
    codename: 'RECON',
    role: 'Konkurrentanalys',
    division: 'VANGUARD',
    model: 'claude-haiku-5-5',
    workflow: 'WF-21 Produktpipeline',
    handsOffTo: ['T1-05'],
    tasks: [
      llm('Bevakar konkurrenternas priser på laptopställ', 16_000, 2_000),
      api('Kartlägger konkurrenters annonser via annonsbibliotek', 45),
    ],
  },
  {
    id: 'T1-04',
    codename: 'HARBOR',
    role: 'Leverantörer och inköp',
    division: 'VANGUARD',
    model: 'claude-haiku-5-5',
    workflow: 'WF-21 Produktpipeline',
    handsOffTo: ['T1-05', 'T1-08'],
    tasks: [
      llm('Verifierar leveranstider hos leverantören i Shenzhen', 8_000, 1_500),
      llm('Jämför fraktalternativ till Sverige', 12_000, 2_000),
    ],
  },
  {
    id: 'T1-05',
    codename: 'VOID',
    role: 'Prissättning och marginal',
    division: 'VANGUARD',
    model: 'claude-sonnet-5-5',
    workflow: 'WF-21 Produktpipeline',
    handsOffTo: ['T2-01'],
    tasks: [
      llm('Räknar marginal för nya produktförslag', 10_000, 3_000),
      llm('Prisoptimerar mobilhållaren', 8_000, 2_000),
    ],
  },
  {
    id: 'T1-06',
    codename: 'MAGNET',
    role: 'Leadhantering',
    division: 'VANGUARD',
    model: 'claude-haiku-5-5',
    workflow: 'WF-22 Försäljning och leads',
    handsOffTo: ['T1-07'],
    tasks: [
      llm('Kvalificerar nya nyhetsbrevsprenumeranter', 6_000, 1_000),
      llm('Segmenterar leads från senaste kampanjen', 9_000, 1_500),
    ],
  },
  {
    id: 'T1-07',
    codename: 'CONDUIT',
    role: 'Säljpipeline',
    division: 'VANGUARD',
    model: 'claude-sonnet-5-5',
    workflow: 'WF-22 Försäljning och leads',
    handsOffTo: ['T1-10'],
    tasks: [
      llm('Följer upp offert till kontorskund', 7_000, 2_000),
      llm('Lägger in nya förfrågningar i säljpipelinen', 5_000, 1_500),
    ],
  },
  {
    id: 'T1-08',
    codename: 'COURIER',
    role: 'Order och leverans',
    division: 'VANGUARD',
    model: 'claude-haiku-5-5',
    workflow: 'WF-23 Order och kundservice',
    handsOffTo: ['T1-09'],
    tasks: [
      api('Skickar betalda ordrar till leverantören', 30),
      llm('Uppdaterar spårningsnummer i Airtable', 4_000, 800),
    ],
  },
  {
    id: 'T1-09',
    codename: 'HAVEN',
    role: 'Kundservice och återköp',
    division: 'VANGUARD',
    model: 'claude-haiku-5-5',
    workflow: 'WF-23 Order och kundservice',
    handsOffTo: ['T1-08'],
    tasks: [
      llm('Besvarar kundfrågor om leveranstid', 6_000, 1_200),
      llm('Hanterar en returförfrågan', 5_000, 1_000),
    ],
  },
  {
    id: 'T1-10',
    codename: 'LEDGER',
    role: 'Intäktsoperationer',
    division: 'VANGUARD',
    model: 'claude-sonnet-5-5',
    workflow: 'WF-24 Intäktsavstämning',
    handsOffTo: ['T2-10'],
    tasks: [
      llm('Stämmer av Stripe-utbetalningar mot ordrar', 12_000, 2_000),
      llm('Bokför återbetalningar och avgifter', 8_000, 1_500),
    ],
  },
  // Division II · Meridian – digitala produkter, strategi och optimering
  {
    id: 'T2-01',
    codename: 'STAR',
    role: 'Affärsstrategi',
    division: 'MERIDIAN',
    model: 'claude-opus-5-5',
    workflow: 'WF-31 Strategi och trender',
    handsOffTo: ['T2-02', 'T2-09'],
    tasks: [
      llm('Utvärderar produktportföljens lönsamhet', 30_000, 6_000),
      llm('Sätter veckans fokusområden', 20_000, 4_000),
    ],
  },
  {
    id: 'T2-02',
    codename: 'PULSE',
    role: 'Trendanalys',
    division: 'MERIDIAN',
    model: 'claude-haiku-5-5',
    workflow: 'WF-31 Strategi och trender',
    handsOffTo: ['T2-03', 'T1-01'],
    tasks: [
      llm('Analyserar TikTok-trender inom hemorganisering', 20_000, 2_500),
      api('Hämtar sökvolymer för digitala mallar', 40),
    ],
  },
  {
    id: 'T2-03',
    codename: 'PRISM',
    role: 'Målgruppsanalys',
    division: 'MERIDIAN',
    model: 'claude-sonnet-5-5',
    workflow: 'WF-31 Strategi och trender',
    handsOffTo: ['T2-04'],
    tasks: [
      llm('Bygger målgruppsprofil för digitala mallar', 12_000, 3_000),
      llm('Analyserar köparna av LED-lampan', 10_000, 2_500),
    ],
  },
  {
    id: 'T2-04',
    codename: 'MUSE',
    role: 'Annonskreativ',
    division: 'MERIDIAN',
    model: 'claude-sonnet-5-5',
    workflow: 'WF-32 Kampanjmotor',
    handsOffTo: ['T2-05'],
    tasks: [
      llm('Skriver annonsvarianter för LED-lampan', 6_000, 3_000),
      llm('Tar fram öppningar till kortvideor', 5_000, 2_500),
    ],
  },
  {
    id: 'T2-05',
    codename: 'VECTOR',
    role: 'Kampanjledning',
    division: 'MERIDIAN',
    model: 'claude-sonnet-5-5',
    workflow: 'WF-32 Kampanjmotor',
    handsOffTo: ['T2-07'],
    tasks: [
      llm('Planerar kampanjbudget för nästa vecka', 9_000, 2_000),
      api('Hämtar kampanjresultat per annonsgrupp', 50),
    ],
  },
  {
    id: 'T2-06',
    codename: 'QUILL',
    role: 'Innehållsproduktion',
    division: 'MERIDIAN',
    model: 'claude-sonnet-5-5',
    workflow: 'WF-33 Innehåll och SEO',
    handsOffTo: ['T2-08'],
    tasks: [
      llm('Skriver produkttexter för mobilhållaren', 5_000, 3_000),
      llm('Skriver blogginlägg om hemmakontor', 6_000, 5_000),
    ],
  },
  {
    id: 'T2-07',
    codename: 'CATALYST',
    role: 'Konverteringsoptimering',
    division: 'MERIDIAN',
    model: 'claude-sonnet-5-5',
    workflow: 'WF-34 Konvertering och digitala produkter',
    handsOffTo: ['T2-06'],
    tasks: [
      llm('Analyserar avbrutna köp i kassan', 14_000, 2_500),
      llm('Utvärderar A/B-test av produktsidan för laptopstället', 10_000, 2_000),
    ],
  },
  {
    id: 'T2-08',
    codename: 'BEACON',
    role: 'SEO och organisk synlighet',
    division: 'MERIDIAN',
    model: 'claude-haiku-5-5',
    workflow: 'WF-33 Innehåll och SEO',
    handsOffTo: ['T2-06'],
    tasks: [
      llm('Optimerar metadata för produktsidor', 8_000, 1_500),
      api('Letar sökordsluckor mot konkurrenter', 35),
    ],
  },
  {
    id: 'T2-09',
    codename: 'FOUNDRY',
    role: 'Digital produktutveckling',
    division: 'MERIDIAN',
    model: 'claude-sonnet-5-5',
    workflow: 'WF-34 Konvertering och digitala produkter',
    handsOffTo: ['T2-06'],
    tasks: [
      llm('Tar fram kalkylmallen Budget 2027', 8_000, 6_000),
      llm('Uppdaterar e-boken till en ny utgåva', 12_000, 6_000),
    ],
  },
  {
    id: 'T2-10',
    codename: 'SENTINEL',
    role: 'Risk- och prestandakontroll',
    division: 'MERIDIAN',
    model: 'claude-sonnet-5-5',
    workflow: 'WF-90 Sentinel',
    handsOffTo: ['T2-01'],
    tasks: [
      llm('Granskar veckans kostnader mot budgeten', 10_000, 1_500),
      llm('Letar avvikelser i orderflödet', 8_000, 1_500),
    ],
  },
];

export interface ProductDefinition {
  readonly id: string;
  readonly title: string;
  readonly kind: ProductKind;
  /** Price incl. VAT. */
  readonly priceOre: Ore;
  readonly vatRateBp: number;
  readonly cogsOre: Ore;
  readonly shippingOre: Ore;
  /** Relative popularity for the order simulation. */
  readonly weight: number;
}

export const LIVE_PRODUCTS: readonly ProductDefinition[] = [
  {
    id: 'prd_mount',
    title: 'Magnetisk mobilhållare för bil',
    kind: 'PHYSICAL',
    priceOre: 24_900,
    vatRateBp: 2_500,
    cogsOre: 4_800,
    shippingOre: 2_900,
    weight: 5,
  },
  {
    id: 'prd_lamp',
    title: 'LED-skrivbordslampa med trådlös laddning',
    kind: 'PHYSICAL',
    priceOre: 49_900,
    vatRateBp: 2_500,
    cogsOre: 13_200,
    shippingOre: 4_900,
    weight: 4,
  },
  {
    id: 'prd_bottle',
    title: 'Hopfällbar vattenflaska i silikon',
    kind: 'PHYSICAL',
    priceOre: 19_900,
    vatRateBp: 2_500,
    cogsOre: 3_100,
    shippingOre: 2_900,
    weight: 3,
  },
  {
    id: 'prd_stand',
    title: 'Laptopställ i aluminium',
    kind: 'PHYSICAL',
    priceOre: 44_900,
    vatRateBp: 2_500,
    cogsOre: 11_800,
    shippingOre: 4_900,
    weight: 3,
  },
  {
    id: 'prd_budget',
    title: 'Budgetplanerare 2027 (kalkylmall)',
    kind: 'DIGITAL',
    priceOre: 14_900,
    vatRateBp: 2_500,
    cogsOre: 0,
    shippingOre: 0,
    weight: 3,
  },
  {
    id: 'prd_ebook',
    title: 'E-bok: Starta e-handel på 30 dagar',
    kind: 'DIGITAL',
    priceOre: 12_900,
    vatRateBp: 600,
    cogsOre: 0,
    shippingOre: 0,
    weight: 2,
  },
];

/** Products the agents may propose. Approving one puts it on sale. */
export const PRODUCT_CANDIDATES: readonly (ProductDefinition & {
  readonly proposedBy: string;
  readonly pitch: string;
})[] = [
  {
    id: 'prd_projector',
    title: 'Portabel miniprojektor',
    kind: 'PHYSICAL',
    priceOre: 89_900,
    vatRateBp: 2_500,
    cogsOre: 31_000,
    shippingOre: 5_900,
    weight: 2,
    proposedBy: 'T1-05',
    pitch:
      'Sökvolymen har ökat 38 % på fyra veckor. Två leverantörer klarar leverans inom 9 dagar.',
  },
  {
    id: 'prd_grinder',
    title: 'Elektrisk kryddkvarn i rostfritt stål',
    kind: 'PHYSICAL',
    priceOre: 29_900,
    vatRateBp: 2_500,
    cogsOre: 6_900,
    shippingOre: 2_900,
    weight: 3,
    proposedBy: 'T1-05',
    pitch: 'Få svenska återförsäljare. Konkurrenternas pris ligger på 349–399 kr.',
  },
  {
    id: 'prd_ringlight',
    title: 'Ringlampa för videomöten',
    kind: 'PHYSICAL',
    priceOre: 34_900,
    vatRateBp: 2_500,
    cogsOre: 8_900,
    shippingOre: 3_900,
    weight: 3,
    proposedBy: 'T1-05',
    pitch: 'Säljer jämnt året runt och passar köpare av laptopstället.',
  },
  {
    id: 'prd_notion',
    title: 'Notion-mall: Veckoplanering för småföretag',
    kind: 'DIGITAL',
    priceOre: 9_900,
    vatRateBp: 2_500,
    cogsOre: 0,
    shippingOre: 0,
    weight: 3,
    proposedBy: 'T2-09',
    pitch: 'Bygger på budgetplanerarens köpare. Klar att publicera, inga lagerkostnader.',
  },
  {
    id: 'prd_pricing',
    title: 'Kalkylmall: Prissättning för e-handlare',
    kind: 'DIGITAL',
    priceOre: 19_900,
    vatRateBp: 2_500,
    cogsOre: 0,
    shippingOre: 0,
    weight: 2,
    proposedBy: 'T2-09',
    pitch: 'Efterfrågad i två forum för e-handlare. Kan säljas i paket med e-boken.',
  },
];

export const CAMPAIGN_CANDIDATES: readonly {
  readonly title: string;
  readonly productId: string;
  readonly budgetOre: Ore;
  readonly pitch: string;
}[] = [
  {
    title: 'Meta-kampanj: LED-lampan, 7 dagar',
    productId: 'prd_lamp',
    budgetOre: 30_000,
    pitch: 'Tre annonsvarianter från MUSE. Livstidsbudget, avslutas automatiskt.',
  },
  {
    title: 'Meta-kampanj: Laptopstället, 5 dagar',
    productId: 'prd_stand',
    budgetOre: 20_000,
    pitch: 'Riktas mot målgruppen hemmakontor från PRISM. Livstidsbudget.',
  },
  {
    title: 'TikTok-kampanj: Mobilhållaren, 3 dagar',
    productId: 'prd_mount',
    budgetOre: 15_000,
    pitch: 'Två kortvideor. Lågt pris per klick i testgruppen.',
  },
];

export interface ToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly plan: string;
  readonly monthlyOre: Ore;
}

/** Illustrative amounts – the real ones belong in Airtable (ToolCosts) with your actual plans. */
export const TOOLS: readonly ToolDefinition[] = [
  { id: 'n8n', name: 'n8n Cloud', plan: 'Starter (exempel)', monthlyOre: 26_000 },
  { id: 'airtable', name: 'Airtable', plan: 'Team, 1 plats (exempel)', monthlyOre: 24_000 },
  { id: 'domain', name: 'Domän och e-post', plan: 'Exempel', monthlyOre: 6_000 },
  { id: 'cloudflare', name: 'Cloudflare Pages och Access', plan: 'Gratisnivå', monthlyOre: 0 },
  { id: 'stripe', name: 'Stripe', plan: 'Ingen månadsavgift, avgift per köp', monthlyOre: 0 },
];

export const WEEKLY_LIMIT_ORE: Ore = 150_000;

/**
 * Realised profit (after AI, API and tools) of the weeks before the simulation starts, most
 * recent first. The one three weeks back is past the refund window, so Monday's review uses it.
 */
export const PAST_WEEK_PROFIT_ORE: readonly Ore[] = [212_400, 96_800, 184_050, 71_300];
export const WARN_AT_BP = 8_000;
/** Deliberately above the market rate: a reservation must never undershoot the real bill. */
export const FX_SEK_PER_USD = 11;
