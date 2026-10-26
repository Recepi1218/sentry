import * as z from 'zod';

/*
 * Sentry's data contract. These schemas are the single source of truth for the shapes that
 * travel between Airtable, n8n and the dashboard: the TypeScript types are inferred from them
 * and the n8n adapter validates every response against them at runtime.
 * All money fields are integer öre (see money.ts).
 */

const Ore = z.int();
const NonNegativeOre = z.int().nonnegative();
const Count = z.int().nonnegative();
const DateTime = z.iso.datetime({ offset: true });
const BasisPoints = z.int().min(-1_000_000).max(1_000_000);

// ── Control ────────────────────────────────────────────────────────────────────

export const SwitchStateSchema = z.enum(['ARMED', 'LOCKED']);
export type SwitchState = z.infer<typeof SwitchStateSchema>;

export const ActorSchema = z.object({
  kind: z.enum(['OPERATOR', 'AGENT', 'SENTINEL', 'SYSTEM', 'WORKFLOW']),
  id: z.string().min(1),
  label: z.string(),
});
export type Actor = z.infer<typeof ActorSchema>;

export const ControlStateSchema = z.object({
  state: SwitchStateSchema,
  /** Increments on every change; ARM requests must name the revision they were based on. */
  revision: Count,
  changedAt: DateTime,
  changedBy: ActorSchema,
  reason: z.string(),
});
export type ControlState = z.infer<typeof ControlStateSchema>;

export const MasterSwitchCommandSchema = z.object({
  action: z.enum(['ARM', 'LOCK']),
  expectedRevision: Count.optional(),
  reason: z.string().trim().min(1).max(200),
});
export type MasterSwitchCommand = z.infer<typeof MasterSwitchCommandSchema>;

// ── Budget ─────────────────────────────────────────────────────────────────────

export const SpendCategorySchema = z.enum(['AI_TOKENS', 'API_CALLS', 'ADS']);
export type SpendCategory = z.infer<typeof SpendCategorySchema>;

export const CategorySpendSchema = z.object({
  category: SpendCategorySchema,
  settledOre: NonNegativeOre,
  reservedOre: NonNegativeOre,
});
export type CategorySpend = z.infer<typeof CategorySpendSchema>;

export const BudgetStatusSchema = z.object({
  weekId: z.string().regex(/^\d{4}-W\d{2}$/),
  weekStartsAt: DateTime,
  weekEndsAt: DateTime,
  /** The hard weekly limit. settled + reserved can never exceed it. */
  limitOre: NonNegativeOre,
  /** The most a profit-driven raise may ever propose; null = no growth policy. */
  limitCeilingOre: NonNegativeOre.nullable().default(null),
  /** Actual, settled spend this week. */
  settledOre: NonNegativeOre,
  /** Worst-case amounts held by in-flight requests and running campaigns. */
  reservedOre: NonNegativeOre,
  /** Utilisation that triggers a Sentinel warning, in basis points (8000 = 80 %). */
  warnAtBp: z.int().min(0).max(10_000),
  byCategory: z.array(CategorySpendSchema),
  tokens: z.object({ input: Count, output: Count }),
  apiCalls: Count,
  deniedRequests: Count,
  /** Settled spend over the last hour – drives the runway estimate. */
  burnRateOrePerHour: NonNegativeOre,
});
export type BudgetStatus = z.infer<typeof BudgetStatusSchema>;

// ── Finance ────────────────────────────────────────────────────────────────────

export const ProductKindSchema = z.enum(['PHYSICAL', 'DIGITAL']);
export type ProductKind = z.infer<typeof ProductKindSchema>;

export const OrderLineSchema = z.object({
  id: z.string().min(1),
  /** Stripe PaymentIntent id (simulated in mock mode). */
  stripeRef: z.string(),
  createdAt: DateTime,
  productId: z.string(),
  productTitle: z.string(),
  productKind: ProductKindSchema,
  quantity: z.int().positive(),
  /** What the customer paid, VAT included. */
  grossOre: NonNegativeOre,
  /** VAT rate in basis points: 2500 = 25 %, 600 = 6 % (e-books). */
  vatRateBp: z.int().min(0).max(10_000),
  /** Amount refunded to the customer, VAT included. */
  refundedOre: NonNegativeOre,
  paymentFeeOre: NonNegativeOre,
  cogsOre: NonNegativeOre,
  shippingOre: NonNegativeOre,
  /** Ad spend attributed to this order (estimate). */
  adCostOre: NonNegativeOre,
  status: z.enum(['PAID', 'FULFILLED', 'REFUNDED']),
});
export type OrderLine = z.infer<typeof OrderLineSchema>;

export const DailyPointSchema = z.object({
  date: z.iso.date(),
  netSalesOre: Ore,
  contributionOre: Ore,
  orders: Count,
});
export type DailyPoint = z.infer<typeof DailyPointSchema>;

export const FinanceSummarySchema = z.object({
  from: DateTime,
  to: DateTime,
  orderCount: Count,
  grossOre: NonNegativeOre,
  refundsOre: NonNegativeOre,
  vatOre: Ore,
  /** Omsättning: sales excluding VAT, net of refunds. */
  netSalesOre: Ore,
  cogsOre: NonNegativeOre,
  shippingOre: NonNegativeOre,
  paymentFeesOre: NonNegativeOre,
  /** Actual ad spend in the period (not the per-order attribution). */
  adSpendOre: NonNegativeOre,
  /** Täckningsbidrag: net sales minus all variable costs. */
  contributionOre: Ore,
  aiCostOre: NonNegativeOre,
  apiCostOre: NonNegativeOre,
  /** The period's share of fixed tool subscriptions. */
  toolCostOre: NonNegativeOre,
  netResultOre: Ore,
  /** One point per calendar day, oldest first. */
  daily: z.array(DailyPointSchema),
});
export type FinanceSummary = z.infer<typeof FinanceSummarySchema>;

export const ToolCostSchema = z.object({
  id: z.string(),
  name: z.string(),
  plan: z.string(),
  monthlyOre: NonNegativeOre,
  weekShareOre: NonNegativeOre,
});
export type ToolCost = z.infer<typeof ToolCostSchema>;

export const ModelUsageSchema = z.object({
  model: z.string(),
  label: z.string(),
  calls: Count,
  inputTokens: Count,
  outputTokens: Count,
  costOre: NonNegativeOre,
});
export type ModelUsage = z.infer<typeof ModelUsageSchema>;

export const CostBreakdownSchema = z.object({
  tools: z.array(ToolCostSchema),
  models: z.array(ModelUsageSchema),
});
export type CostBreakdown = z.infer<typeof CostBreakdownSchema>;

// ── Agents ─────────────────────────────────────────────────────────────────────

export const DivisionSchema = z.enum(['VANGUARD', 'MERIDIAN']);
export type Division = z.infer<typeof DivisionSchema>;

export const AgentStatusSchema = z.enum([
  'IDLE',
  'WORKING',
  'AWAITING_APPROVAL',
  'BLOCKED_BUDGET',
  'PAUSED',
  'ERROR',
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Place in the organisation. A chief leads a division and receives its workers' results;
 * oversight (Sentinel) answers to the operator directly, outside both chains of command.
 */
export const AgentRankSchema = z.enum(['CHIEF', 'WORKER', 'OVERSIGHT']);
export type AgentRank = z.infer<typeof AgentRankSchema>;

export const TaskSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  startedAt: DateTime,
  finishedAt: DateTime,
  outcome: z.enum(['DONE', 'FAILED', 'DENIED', 'CANCELLED']),
  costOre: NonNegativeOre,
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const AgentSchema = z.object({
  /** "T1-01" … "T2-10" */
  id: z.string().regex(/^T[12]-\d{2}$/),
  codename: z.string(),
  role: z.string(),
  division: DivisionSchema,
  // Defaults keep older Airtable rows valid until the org-chart fields are filled in.
  rank: AgentRankSchema.default('WORKER'),
  team: z.string().default(''),
  /** Agent id of the manager; null = reports to the operator. */
  reportsTo: z.string().nullable().default(null),
  model: z.string(),
  status: AgentStatusSchema,
  currentTask: z
    .object({ id: z.string(), title: z.string(), startedAt: DateTime, reservedOre: NonNegativeOre })
    .nullable(),
  lastActiveAt: DateTime.nullable(),
  weekSpendOre: NonNegativeOre,
  weekTasks: Count,
  /** Most recent first. */
  history: z.array(TaskSummarySchema).max(20),
});
export type Agent = z.infer<typeof AgentSchema>;

/** One agent handing work to another through an n8n workflow and an Airtable table. */
export const HandoffSchema = z.object({
  id: z.string(),
  at: DateTime,
  fromAgentId: z.string(),
  toAgentId: z.string(),
  subject: z.string(),
  workflow: z.string(),
  table: z.string(),
});
export type Handoff = z.infer<typeof HandoffSchema>;

// ── Approvals ──────────────────────────────────────────────────────────────────

export const ApprovalSchema = z.object({
  id: z.string(),
  kind: z.enum(['PRODUCT_LAUNCH', 'CAMPAIGN_LAUNCH', 'BUDGET_LIMIT']),
  title: z.string(),
  summary: z.string(),
  requestedBy: z.string(),
  createdAt: DateTime,
  /** Budget reserved the moment it is approved. 0 = no direct spend. */
  costOre: NonNegativeOre,
  expectedMarginBp: BasisPoints.nullable(),
  /** BUDGET_LIMIT only: the weekly limit that applies once approved. */
  proposedLimitOre: NonNegativeOre.nullable().default(null),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ApprovalDecisionSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(500).optional(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalDecisionResultSchema = z.object({
  approvalId: z.string(),
  decision: z.enum(['APPROVE', 'REJECT']),
  appliedAt: DateTime,
});
export type ApprovalDecisionResult = z.infer<typeof ApprovalDecisionResultSchema>;

// ── Audit & alerts ─────────────────────────────────────────────────────────────

export const SeveritySchema = z.enum(['INFO', 'NOTICE', 'WARNING', 'CRITICAL']);
export type Severity = z.infer<typeof SeveritySchema>;

export const AuditEventSchema = z.object({
  id: z.string(),
  at: DateTime,
  actor: ActorSchema,
  /** Machine-readable action, e.g. MASTER_SWITCH_ARMED, SPEND_DENIED. Kept open on purpose. */
  action: z.string(),
  severity: SeveritySchema,
  message: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AlertSchema = z.object({
  id: z.string(),
  raisedAt: DateTime,
  severity: z.enum(['WARNING', 'CRITICAL']),
  source: z.string(),
  message: z.string(),
});
export type Alert = z.infer<typeof AlertSchema>;

// ── Snapshot ───────────────────────────────────────────────────────────────────

export const DashboardSnapshotSchema = z.object({
  generatedAt: DateTime,
  source: z.enum(['mock', 'n8n']),
  control: ControlStateSchema,
  budget: BudgetStatusSchema,
  finance: FinanceSummarySchema,
  costs: CostBreakdownSchema,
  /** Most recent first. */
  orders: z.array(OrderLineSchema),
  agents: z.array(AgentSchema),
  /** Most recent first. */
  handoffs: z.array(HandoffSchema),
  /** Pending only, oldest first. */
  approvals: z.array(ApprovalSchema),
  /** Most recent first. */
  audit: z.array(AuditEventSchema),
  alerts: z.array(AlertSchema),
});
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;
