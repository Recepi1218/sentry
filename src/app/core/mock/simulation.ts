import { SentryApiError } from '../api/sentry-api';
import {
  evaluateSpend,
  ledgerTotals,
  overrunOre,
  remainingOre,
  utilizationBp,
  verifyReservation,
  type DenyReason,
  type LedgerStatus,
  type LedgerTotals,
} from '../domain/budget-gate';
import {
  addDays,
  calendarDateOf,
  isoDateString,
  isoWeekAt,
  zonedTimeToInstant,
  type IsoWeek,
} from '../domain/iso-week';
import {
  DEFAULT_GROWTH_POLICY,
  nextWeeklyLimit,
  settledWeekAt,
  type GrowthPolicy,
} from '../domain/budget-growth';
import {
  ApprovalDecisionSchema,
  MasterSwitchCommandSchema,
  type Actor,
  type Agent,
  type AgentStatus,
  type Alert,
  type Approval,
  type ApprovalDecision,
  type ApprovalDecisionResult,
  type AuditEvent,
  type BudgetStatus,
  type CategorySpend,
  type ControlState,
  type DailyPoint,
  type DashboardSnapshot,
  type FinanceSummary,
  type Handoff,
  type MasterSwitchCommand,
  type ModelUsage,
  type OrderLine,
  type Severity,
  type SpendCategory,
  type TaskSummary,
} from '../domain/model';
import type { Ore } from '../domain/money';
import { orderEconomics, summarizeOrders } from '../domain/order-economics';
import {
  actualCallOre,
  modelLabel,
  worstCaseCallOre,
  type FxPolicy,
  type ModelId,
} from '../domain/pricing';
import { formatSek } from '../../shared/format';
import { chance, createRng, pick, randomInt, type Rng } from './rng';
import {
  AGENTS,
  CAMPAIGN_CANDIDATES,
  FX_SEK_PER_USD,
  LIVE_PRODUCTS,
  ORG_CHART,
  PAST_WEEK_PROFIT_ORE,
  PRODUCT_CANDIDATES,
  TOOLS,
  WARN_AT_BP,
  WEEKLY_LIMIT_ORE,
  type AgentDefinition,
  type ProductDefinition,
  type TaskTemplate,
} from './seed';

/*
 * An in-memory stand-in for n8n + Airtable. It runs the same budget gate the real workflows
 * will run, so the dashboard behaves exactly as it will in production: nothing spends while
 * the switch is locked, and no sequence of requests can push the week past its limit.
 * The pace is faster than real operation so there is something to watch.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CATEGORIES: readonly SpendCategory[] = ['AI_TOKENS', 'API_CALLS', 'ADS'];
const CAMPAIGN_DURATION_MS = 12 * MINUTE;
const STRIPE_FEE_BP = 150;
const STRIPE_FEE_FIXED_ORE = 180;

const OPERATOR: Actor = { kind: 'OPERATOR', id: 'operator', label: 'Du' };
const SYSTEM: Actor = { kind: 'SYSTEM', id: 'sentry', label: 'Sentry' };
const GATE: Actor = { kind: 'WORKFLOW', id: 'wf-10-budget-gate', label: 'Budgetspärren' };
const STRIPE: Actor = { kind: 'WORKFLOW', id: 'wf-30-stripe', label: 'Stripe-webhook' };

interface LedgerRow {
  readonly id: string;
  readonly weekId: string;
  readonly agentId: string;
  readonly category: SpendCategory;
  status: LedgerStatus;
  readonly reservedOre: Ore;
  actualOre: Ore;
  readonly createdAt: number;
  settledAt: number | null;
  readonly model: ModelId | null;
  inputTokens: number;
  outputTokens: number;
}

interface RunningTask {
  readonly id: string;
  readonly title: string;
  readonly startedAt: number;
  readonly completesAt: number;
  readonly reservationId: string;
  readonly reservedOre: Ore;
  readonly template: TaskTemplate;
  /** Started before the switch was locked; finishes and settles anyway. */
  inFlightAtLock: boolean;
}

interface AgentRuntime {
  readonly def: AgentDefinition;
  task: RunningTask | null;
  nextStartAt: number;
  blockedUntil: number;
  lastActiveAt: number | null;
  lastDenialLoggedAt: number;
  history: TaskSummary[];
}

interface Campaign {
  readonly id: string;
  readonly title: string;
  readonly productId: string;
  readonly reservationId: string;
  readonly budgetOre: Ore;
  readonly startedAt: number;
  spentOre: Ore;
  status: 'RUNNING' | 'ENDED' | 'PAUSED';
}

type ApprovalPayload =
  | { readonly type: 'product'; readonly product: ProductDefinition }
  | { readonly type: 'campaign'; readonly productId: string; readonly budgetOre: Ore }
  | { readonly type: 'limit'; readonly limitOre: Ore };

/** Settled spend of a week that has closed, kept after its ledger rows are pruned. */
interface ClosedWeek {
  readonly adsOre: Ore;
  readonly aiOre: Ore;
  readonly apiOre: Ore;
}

interface PendingApproval {
  readonly approval: Approval;
  readonly payload: ApprovalPayload;
}

interface StoredOrder {
  readonly line: OrderLine;
  readonly at: number;
  readonly localDate: string;
}

export interface SimulationOptions {
  readonly seed: number;
  readonly now: number;
  readonly limitOre?: Ore;
  readonly growth?: GrowthPolicy;
  /** Realised profit of the weeks before the start, most recent first. */
  readonly pastWeekProfitOre?: readonly Ore[];
}

export class SentrySimulation {
  private readonly rng: Rng;
  private readonly fx: FxPolicy = { sekPerUsd: FX_SEK_PER_USD };
  private limitOre: Ore;
  private readonly growth: GrowthPolicy;
  private readonly closedWeeks = new Map<string, ClosedWeek>();
  /** Seeded results of the weeks before the simulation started. */
  private readonly pastProfit = new Map<string, Ore>();
  private readonly ledger: LedgerRow[] = [];
  private readonly agents: AgentRuntime[];
  private readonly products: ProductDefinition[] = [...LIVE_PRODUCTS];
  private readonly orders: StoredOrder[] = [];
  private readonly campaigns: Campaign[] = [];
  private readonly approvals: PendingApproval[] = [];
  private readonly handoffs: Handoff[] = [];
  private readonly audit: AuditEvent[] = [];
  private readonly alerts: Alert[] = [];
  private readonly deniedByWeek = new Map<string, number>();
  private control: ControlState;
  private weekId: string;
  private lastTickAt: number;
  private nextOrderAt: number;
  private nextProposalAt: number;
  private sequence = 0;
  private warnedWeek: string | null = null;
  private exhaustedWeek: string | null = null;

  constructor(options: SimulationOptions) {
    this.rng = createRng(options.seed);
    this.limitOre = options.limitOre ?? WEEKLY_LIMIT_ORE;
    this.growth = options.growth ?? DEFAULT_GROWTH_POLICY;
    let past = isoWeekAt(options.now);
    for (const profitOre of options.pastWeekProfitOre ?? PAST_WEEK_PROFIT_ORE) {
      past = isoWeekAt(past.startsAt - 1);
      this.pastProfit.set(past.id, profitOre);
    }
    this.lastTickAt = options.now;
    this.weekId = isoWeekAt(options.now).id;
    this.agents = AGENTS.map((def) => ({
      def,
      task: null,
      nextStartAt: options.now,
      blockedUntil: 0,
      lastActiveAt: null,
      lastDenialLoggedAt: 0,
      history: [],
    }));
    this.control = {
      state: 'LOCKED',
      revision: 0,
      changedAt: iso(options.now),
      changedBy: SYSTEM,
      reason: 'Sentry startar alltid i låst läge.',
    };
    this.seedHistory(options.now);
    this.nextOrderAt = options.now + randomInt(this.rng, 5_000, 25_000);
    this.nextProposalAt = options.now + 2 * MINUTE;
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  setMasterSwitch(command: MasterSwitchCommand, now: number): ControlState {
    const parsed = MasterSwitchCommandSchema.safeParse(command);
    if (!parsed.success)
      throw new SentryApiError('rejected', 'Ogiltigt kommando till huvudbrytaren.');
    const { action, expectedRevision, reason } = parsed.data;

    if (action === 'LOCK') {
      if (this.control.state === 'LOCKED') return this.control;
      this.lock(now, OPERATOR, reason);
      return this.control;
    }

    if (this.control.state === 'ARMED') return this.control;
    if (expectedRevision !== this.control.revision) {
      throw new SentryApiError(
        'conflict',
        'Läget har ändrats sedan du hämtade det. Kontrollera läget och försök igen.',
      );
    }
    const totals = this.totals(now);
    if (remainingOre(totals) <= 0) {
      throw new SentryApiError(
        'rejected',
        'Veckobudgeten är slut. Systemet kan aktiveras igen måndag 00:00 eller när gränsen höjs i Airtable.',
      );
    }
    if (this.alerts.some((alert) => alert.severity === 'CRITICAL')) {
      throw new SentryApiError(
        'rejected',
        'Sentinel har ett kritiskt larm. Åtgärda det innan du aktiverar.',
      );
    }

    this.control = {
      state: 'ARMED',
      revision: this.control.revision + 1,
      changedAt: iso(now),
      changedBy: OPERATOR,
      reason,
    };
    for (const agent of this.agents) {
      agent.nextStartAt = now + randomInt(this.rng, 1_500, 20_000);
    }
    this.log(
      now,
      OPERATOR,
      'MASTER_SWITCH_ARMED',
      'NOTICE',
      `Systemet aktiverades: ${reason}. Agenterna får förbruka högst ${formatSek(remainingOre(totals))} till den här veckan.`,
    );
    return this.control;
  }

  decideApproval(decision: ApprovalDecision, now: number): ApprovalDecisionResult {
    const parsed = ApprovalDecisionSchema.safeParse(decision);
    if (!parsed.success) throw new SentryApiError('rejected', 'Ogiltigt beslut.');
    const index = this.approvals.findIndex((item) => item.approval.id === parsed.data.approvalId);
    const pending = this.approvals[index];
    if (!pending) {
      throw new SentryApiError(
        'not-found',
        'Förslaget finns inte längre. Det kan redan vara beslutat.',
      );
    }
    const { approval, payload } = pending;
    const result: ApprovalDecisionResult = {
      approvalId: approval.id,
      decision: parsed.data.decision,
      appliedAt: iso(now),
    };

    if (parsed.data.decision === 'REJECT') {
      this.approvals.splice(index, 1);
      this.log(
        now,
        OPERATOR,
        'APPROVAL_REJECTED',
        'NOTICE',
        `Du avvisade förslaget ”${approval.title}”.`,
      );
      return result;
    }

    if (payload.type === 'limit') {
      if (payload.limitOre > this.growth.ceilingOre) {
        throw new SentryApiError('rejected', 'Förslaget ligger över taket för veckogränsen.');
      }
      this.approvals.splice(index, 1);
      this.limitOre = Math.max(this.limitOre, payload.limitOre);
      this.log(
        now,
        OPERATOR,
        'WEEKLY_LIMIT_RAISED',
        'NOTICE',
        `Du höjde veckogränsen till ${formatSek(this.limitOre)}. Den gäller från nu och kommande veckor.`,
      );
      return result;
    }

    if (payload.type === 'product') {
      this.approvals.splice(index, 1);
      this.products.push(payload.product);
      this.log(
        now,
        OPERATOR,
        'PRODUCT_APPROVED',
        'NOTICE',
        `Du godkände ”${approval.title}”. Produkten är nu till salu.`,
      );
      return result;
    }

    const row = this.reserve(now, approval.requestedBy, 'ADS', payload.budgetOre, null);
    if (!row.ok) {
      throw new SentryApiError(
        'rejected',
        denialText(row.reason, payload.budgetOre, row.remainingOre),
      );
    }
    this.approvals.splice(index, 1);
    this.campaigns.push({
      id: this.nextId('cmp'),
      title: approval.title,
      productId: payload.productId,
      reservationId: row.id,
      budgetOre: payload.budgetOre,
      startedAt: now,
      spentOre: 0,
      status: 'RUNNING',
    });
    this.log(
      now,
      OPERATOR,
      'CAMPAIGN_APPROVED',
      'NOTICE',
      `Du godkände ”${approval.title}”. Hela livstidsbudgeten på ${formatSek(payload.budgetOre)} reserverades direkt.`,
    );
    return result;
  }

  // ── Time ───────────────────────────────────────────────────────────────────

  tick(now: number): void {
    const elapsed = Math.min(now - this.lastTickAt, 10_000);
    if (elapsed <= 0) return;
    this.lastTickAt = now;
    this.rollWeek(now);
    this.completeTasks(now);
    this.advanceCampaigns(now, elapsed);
    this.generateOrders(now);
    if (this.control.state === 'ARMED') {
      this.startTasks(now);
      this.maybePropose(now);
    }
    this.watch(now);
  }

  totals(now: number): LedgerTotals {
    return ledgerTotals(this.ledger, isoWeekAt(now).id, this.limitOre);
  }

  // ── Snapshot ───────────────────────────────────────────────────────────────

  snapshot(now: number): DashboardSnapshot {
    const week = isoWeekAt(now);
    const weekRows = this.ledger.filter((row) => row.weekId === week.id);
    const totals = ledgerTotals(weekRows, week.id, this.limitOre);
    const byCategory = CATEGORIES.map((category) => categorySpend(weekRows, category));
    const settledRows = weekRows.filter((row) => row.status === 'SETTLED');

    const budget: BudgetStatus = {
      weekId: week.id,
      weekStartsAt: iso(week.startsAt),
      weekEndsAt: iso(week.endsAt),
      limitOre: this.limitOre,
      limitCeilingOre: this.growth.ceilingOre,
      settledOre: totals.settledOre,
      reservedOre: totals.reservedOre,
      warnAtBp: WARN_AT_BP,
      byCategory,
      tokens: {
        input: settledRows.reduce((sum, row) => sum + row.inputTokens, 0),
        output: settledRows.reduce((sum, row) => sum + row.outputTokens, 0),
      },
      apiCalls: settledRows.filter((row) => row.category !== 'ADS').length,
      deniedRequests: this.deniedByWeek.get(week.id) ?? 0,
      burnRateOrePerHour: settledRows
        .filter((row) => row.settledAt !== null && row.settledAt > now - HOUR)
        .reduce((sum, row) => sum + row.actualOre, 0),
    };

    return {
      generatedAt: iso(now),
      source: 'mock',
      control: this.control,
      budget,
      finance: this.finance(now, week.startsAt, byCategory),
      costs: { tools: toolCosts(), models: modelUsage(weekRows) },
      orders: this.orders
        .slice(-25)
        .reverse()
        .map((order) => order.line),
      agents: this.agents.map((agent) => this.agentView(agent, weekRows, now)),
      handoffs: this.handoffs.slice(0, 20),
      approvals: this.approvals.map((item) => item.approval),
      audit: this.audit.slice(0, 80),
      alerts: [...this.alerts],
    };
  }

  private finance(
    now: number,
    weekStart: number,
    byCategory: readonly CategorySpend[],
  ): FinanceSummary {
    const weekOrders = this.orders
      .filter((order) => order.at >= weekStart)
      .map((order) => order.line);
    const sums = summarizeOrders(weekOrders);
    const spent = (category: SpendCategory) =>
      byCategory.find((entry) => entry.category === category)?.settledOre ?? 0;
    const adSpendOre = spent('ADS');
    const aiCostOre = spent('AI_TOKENS');
    const apiCostOre = spent('API_CALLS');
    const toolCostOre = toolCosts().reduce((sum, tool) => sum + tool.weekShareOre, 0);
    const contributionOre =
      sums.netSalesOre - sums.cogsOre - sums.shippingOre - sums.paymentFeesOre - adSpendOre;
    return {
      from: iso(weekStart),
      to: iso(now),
      orderCount: sums.orderCount,
      grossOre: sums.grossOre,
      refundsOre: sums.refundsOre,
      vatOre: sums.vatOre,
      netSalesOre: sums.netSalesOre,
      cogsOre: sums.cogsOre,
      shippingOre: sums.shippingOre,
      paymentFeesOre: sums.paymentFeesOre,
      adSpendOre,
      contributionOre,
      aiCostOre,
      apiCostOre,
      toolCostOre,
      netResultOre: contributionOre - aiCostOre - apiCostOre - toolCostOre,
      daily: this.daily(now),
    };
  }

  private daily(now: number): DailyPoint[] {
    const today = calendarDateOf(now);
    const points = new Map<
      string,
      { netSalesOre: number; contributionOre: number; orders: number }
    >();
    for (let offset = 13; offset >= 0; offset--) {
      points.set(isoDateString(addDays(today, -offset)), {
        netSalesOre: 0,
        contributionOre: 0,
        orders: 0,
      });
    }
    for (const order of this.orders) {
      const point = points.get(order.localDate);
      if (!point) continue;
      const economics = orderEconomics(order.line);
      point.netSalesOre += economics.netRevenueOre;
      point.contributionOre += economics.contributionOre;
      point.orders += 1;
    }
    return [...points.entries()].map(([date, point]) => ({ date, ...point }));
  }

  private agentView(agent: AgentRuntime, weekRows: readonly LedgerRow[], now: number): Agent {
    const own = weekRows.filter((row) => row.agentId === agent.def.id);
    return {
      id: agent.def.id,
      codename: agent.def.codename,
      role: agent.def.role,
      division: agent.def.division,
      ...(ORG_CHART[agent.def.id] ?? { rank: 'WORKER', team: '', reportsTo: null }),
      model: agent.def.model,
      status: this.statusOf(agent, now),
      currentTask: agent.task
        ? {
            id: agent.task.id,
            title: agent.task.title,
            startedAt: iso(agent.task.startedAt),
            reservedOre: agent.task.reservedOre,
          }
        : null,
      lastActiveAt: agent.lastActiveAt === null ? null : iso(agent.lastActiveAt),
      weekSpendOre: own.reduce(
        (sum, row) => sum + (row.status === 'RELEASED' ? 0 : row.actualOre),
        0,
      ),
      weekTasks: own.filter((row) => row.status === 'SETTLED').length,
      history: agent.history.slice(0, 8),
    };
  }

  private statusOf(agent: AgentRuntime, now: number): AgentStatus {
    if (agent.task) return 'WORKING';
    if (this.control.state === 'LOCKED') return 'PAUSED';
    if (agent.blockedUntil > now) return 'BLOCKED_BUDGET';
    if (this.approvals.some((item) => item.approval.requestedBy === agent.def.id))
      return 'AWAITING_APPROVAL';
    return 'IDLE';
  }

  // ── The gate, as n8n runs it ───────────────────────────────────────────────

  private reserve(
    now: number,
    agentId: string,
    category: SpendCategory,
    maxCostOre: Ore,
    model: ModelId | null,
  ): { ok: true; id: string } | { ok: false; reason: DenyReason; remainingOre: Ore } {
    const request = { agentId, category, maxCostOre };
    const precheck = evaluateSpend(this.control.state, this.totals(now), request);
    if (!precheck.allowed)
      return { ok: false, reason: precheck.reason, remainingOre: precheck.remainingOre };

    const row: LedgerRow = {
      id: this.nextId('res'),
      weekId: isoWeekAt(now).id,
      agentId,
      category,
      status: 'ACTIVE',
      reservedOre: maxCostOre,
      actualOre: 0,
      createdAt: now,
      settledAt: null,
      model,
      inputTokens: 0,
      outputTokens: 0,
    };
    this.ledger.push(row);

    const verified = verifyReservation(this.control.state, this.totals(now));
    if (!verified.allowed) {
      row.status = 'RELEASED';
      return { ok: false, reason: verified.reason, remainingOre: verified.remainingOre };
    }
    return { ok: true, id: row.id };
  }

  private settle(
    now: number,
    reservationId: string,
    actualOre: Ore,
    tokens?: { input: number; output: number },
  ): LedgerRow | null {
    const row = this.ledger.find((entry) => entry.id === reservationId);
    if (!row || row.status !== 'ACTIVE') return null;
    row.status = 'SETTLED';
    row.actualOre = actualOre;
    row.settledAt = now;
    if (tokens) {
      row.inputTokens = tokens.input;
      row.outputTokens = tokens.output;
    }
    const overrun = overrunOre(row.reservedOre, actualOre);
    if (overrun > 0) {
      this.raise(
        now,
        'CRITICAL',
        `Kostnaden överskred sin reservation med ${formatSek(overrun, 'auto')}.`,
      );
      if (this.control.state === 'ARMED') {
        this.lock(now, sentinelActor(), 'Kostnad över reservation – estimatet måste ses över');
      }
    }
    return row;
  }

  // ── Agents ─────────────────────────────────────────────────────────────────

  private startTasks(now: number): void {
    for (const agent of this.agents) {
      if (agent.task || agent.nextStartAt > now || agent.blockedUntil > now) continue;
      const template = pick(this.rng, agent.def.tasks);
      const category: SpendCategory = template.kind === 'llm' ? 'AI_TOKENS' : 'API_CALLS';
      const maxCostOre =
        template.kind === 'llm'
          ? worstCaseCallOre(
              agent.def.model,
              template.promptTokens,
              template.maxOutputTokens,
              this.fx,
            )
          : template.costOre;
      const reservation = this.reserve(
        now,
        agent.def.id,
        category,
        maxCostOre,
        template.kind === 'llm' ? agent.def.model : null,
      );
      if (!reservation.ok) {
        this.onDenied(agent, template.title, maxCostOre, reservation, now);
        continue;
      }
      agent.task = {
        id: this.nextId('tsk'),
        title: template.title,
        startedAt: now,
        completesAt: now + randomInt(this.rng, 6_000, 18_000),
        reservationId: reservation.id,
        reservedOre: maxCostOre,
        template,
        inFlightAtLock: false,
      };
      agent.lastActiveAt = now;
    }
  }

  private onDenied(
    agent: AgentRuntime,
    title: string,
    maxCostOre: Ore,
    denial: { reason: DenyReason; remainingOre: Ore },
    now: number,
  ): void {
    const weekId = isoWeekAt(now).id;
    this.deniedByWeek.set(weekId, (this.deniedByWeek.get(weekId) ?? 0) + 1);
    agent.blockedUntil = now + 45_000;
    agent.nextStartAt = now + 45_000;
    agent.history.unshift({
      id: this.nextId('tsk'),
      title,
      startedAt: iso(now),
      finishedAt: iso(now),
      outcome: 'DENIED',
      costOre: 0,
    });
    agent.history.length = Math.min(agent.history.length, 8);
    if (now - agent.lastDenialLoggedAt > 5 * MINUTE) {
      agent.lastDenialLoggedAt = now;
      this.log(
        now,
        GATE,
        'SPEND_DENIED',
        'WARNING',
        `Stoppade ${agent.def.codename}: ”${title}” behövde upp till ${formatSek(maxCostOre, 'auto')}, ${formatSek(denial.remainingOre, 'auto')} återstår av veckobudgeten.`,
      );
    }
  }

  private completeTasks(now: number): void {
    for (const agent of this.agents) {
      const task = agent.task;
      if (!task || task.completesAt > now) continue;
      const { template } = task;
      let actualOre: Ore;
      let tokens: { input: number; output: number } | undefined;
      if (template.kind === 'llm') {
        const outputTokens = Math.round(template.maxOutputTokens * (0.25 + this.rng() * 0.65));
        const cacheReadTokens = Math.round(template.promptTokens * 0.6);
        const cacheWriteTokens = Math.round(template.promptTokens * 0.1);
        const inputTokens = template.promptTokens - cacheReadTokens - cacheWriteTokens;
        actualOre = actualCallOre(
          agent.def.model,
          { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens },
          this.fx,
        );
        tokens = { input: template.promptTokens, output: outputTokens };
      } else {
        actualOre = template.costOre;
      }
      this.settle(now, task.reservationId, actualOre, tokens);

      agent.history.unshift({
        id: task.id,
        title: task.title,
        startedAt: iso(task.startedAt),
        finishedAt: iso(now),
        outcome: 'DONE',
        costOre: actualOre,
      });
      agent.history.length = Math.min(agent.history.length, 8);
      agent.task = null;
      agent.lastActiveAt = now;
      agent.nextStartAt = now + randomInt(this.rng, 30_000, 120_000);

      if (task.inFlightAtLock) {
        this.log(
          now,
          agentActor(agent.def),
          'IN_FLIGHT_SETTLED',
          'INFO',
          `Slutförde ett anrop som redan pågick vid låsningen och bokförde ${formatSek(actualOre, 'auto')}.`,
        );
      }
      if (agent.def.id === 'T1-08' && template.kind === 'api')
        this.fulfilPaidOrders(task.startedAt);
      if (chance(this.rng, 0.55)) this.handOff(agent, task.title, now);
    }
  }

  private handOff(agent: AgentRuntime, subject: string, now: number): void {
    const toId = pick(this.rng, agent.def.handsOffTo);
    this.handoffs.unshift({
      id: this.nextId('hnd'),
      at: iso(now),
      fromAgentId: agent.def.id,
      toAgentId: toId,
      subject,
      workflow: agent.def.workflow,
      table: 'Tasks',
    });
    this.handoffs.length = Math.min(this.handoffs.length, 40);
    const receiver = this.agents.find((candidate) => candidate.def.id === toId);
    if (receiver && !receiver.task && this.control.state === 'ARMED') {
      receiver.nextStartAt = Math.min(
        receiver.nextStartAt,
        now + randomInt(this.rng, 2_000, 6_000),
      );
    }
  }

  private maybePropose(now: number): void {
    if (now < this.nextProposalAt) return;
    this.nextProposalAt = now + randomInt(this.rng, 90_000, 240_000);
    if (this.approvals.length >= 4) return;

    const pendingTitles = new Set(this.approvals.map((item) => item.approval.title));
    if (chance(this.rng, 0.6)) {
      const candidates = PRODUCT_CANDIDATES.filter(
        (candidate) =>
          !pendingTitles.has(candidate.title) &&
          !this.products.some((live) => live.id === candidate.id),
      );
      if (candidates.length === 0) return;
      this.proposeProduct(pick(this.rng, candidates), now);
    } else {
      const candidates = CAMPAIGN_CANDIDATES.filter(
        (candidate) =>
          !pendingTitles.has(candidate.title) &&
          !this.campaigns.some(
            (campaign) => campaign.status === 'RUNNING' && campaign.title === candidate.title,
          ),
      );
      if (candidates.length === 0) return;
      this.proposeCampaign(pick(this.rng, candidates), now);
    }
  }

  private proposeProduct(candidate: (typeof PRODUCT_CANDIDATES)[number], now: number): void {
    const { proposedBy, pitch, ...product } = candidate;
    const estimatedAdCost = product.kind === 'PHYSICAL' ? Math.round(product.priceOre * 0.15) : 0;
    const estimate = orderEconomics(this.orderFor(product, 1, now, estimatedAdCost));
    const approval: Approval = {
      id: this.nextId('apr'),
      kind: 'PRODUCT_LAUNCH',
      title: product.title,
      summary: `${pitch} Pris ${formatSek(product.priceOre)} inkl. moms.`,
      requestedBy: proposedBy,
      createdAt: iso(now),
      costOre: 0,
      expectedMarginBp: estimate.marginBp,
      proposedLimitOre: null,
    };
    this.approvals.push({ approval, payload: { type: 'product', product } });
    const agent = AGENTS.find((def) => def.id === proposedBy);
    this.log(
      now,
      agent ? agentActor(agent) : SYSTEM,
      'APPROVAL_REQUESTED',
      'INFO',
      `Föreslår produkten ”${product.title}”. Väntar på ditt beslut.`,
    );
  }

  private proposeCampaign(candidate: (typeof CAMPAIGN_CANDIDATES)[number], now: number): void {
    const approval: Approval = {
      id: this.nextId('apr'),
      kind: 'CAMPAIGN_LAUNCH',
      title: candidate.title,
      summary: candidate.pitch,
      requestedBy: 'T2-05',
      createdAt: iso(now),
      costOre: candidate.budgetOre,
      expectedMarginBp: null,
      proposedLimitOre: null,
    };
    this.approvals.push({
      approval,
      payload: { type: 'campaign', productId: candidate.productId, budgetOre: candidate.budgetOre },
    });
    const vector = AGENTS.find((def) => def.id === 'T2-05');
    this.log(
      now,
      vector ? agentActor(vector) : SYSTEM,
      'APPROVAL_REQUESTED',
      'INFO',
      `Föreslår ”${candidate.title}” med livstidsbudget ${formatSek(candidate.budgetOre)}. Väntar på ditt beslut.`,
    );
  }

  // ── Campaigns, orders, Sentinel ────────────────────────────────────────────

  private advanceCampaigns(now: number, elapsed: number): void {
    for (const campaign of this.campaigns) {
      if (campaign.status !== 'RUNNING') continue;
      const increment = Math.round((campaign.budgetOre * elapsed) / CAMPAIGN_DURATION_MS);
      campaign.spentOre = Math.min(campaign.budgetOre, campaign.spentOre + increment);
      const row = this.ledger.find((entry) => entry.id === campaign.reservationId);
      if (row && row.status === 'ACTIVE') row.actualOre = campaign.spentOre;
      if (
        campaign.spentOre >= campaign.budgetOre ||
        now >= campaign.startedAt + CAMPAIGN_DURATION_MS
      ) {
        campaign.status = 'ENDED';
        this.settle(now, campaign.reservationId, campaign.spentOre);
        this.log(
          now,
          agentActorById('T2-05'),
          'CAMPAIGN_ENDED',
          'INFO',
          `”${campaign.title}” är avslutad. ${formatSek(campaign.spentOre)} av ${formatSek(campaign.budgetOre)} förbrukades.`,
        );
      }
    }
  }

  private generateOrders(now: number): void {
    if (now - this.nextOrderAt > MINUTE) this.nextOrderAt = now;
    while (this.nextOrderAt <= now) {
      this.createOrder(this.nextOrderAt);
      const running = this.campaigns.filter((campaign) => campaign.status === 'RUNNING').length;
      const perSecond = 1 / 120 + running / 40;
      this.nextOrderAt += Math.round((-Math.log(1 - this.rng()) / perSecond) * 1000);
    }
  }

  private createOrder(at: number): void {
    const running = this.campaigns.filter((campaign) => campaign.status === 'RUNNING');
    const boosted = running.length > 0 && chance(this.rng, 0.6) ? pick(this.rng, running) : null;
    const product =
      (boosted && this.products.find((candidate) => candidate.id === boosted.productId)) ||
      this.weightedProduct();
    const quantity = chance(this.rng, 0.1) ? 2 : 1;
    const adCostOre = boosted ? randomInt(this.rng, 3_000, 7_000) : 0;
    const line = this.orderFor(product, quantity, at, adCostOre);
    this.orders.push({ line, at, localDate: isoDateString(calendarDateOf(at)) });
    if (this.orders.length > 600) this.orders.splice(0, this.orders.length - 600);

    if (chance(this.rng, 0.02)) this.refundSomething(at);
  }

  private orderFor(
    product: ProductDefinition,
    quantity: number,
    at: number,
    adCostOre: Ore,
  ): OrderLine {
    const grossOre = product.priceOre * quantity;
    return {
      id: this.nextId('ord'),
      stripeRef: `pi_sim_${(this.sequence * 7919).toString(36)}`,
      createdAt: iso(at),
      productId: product.id,
      productTitle: product.title,
      productKind: product.kind,
      quantity,
      grossOre,
      vatRateBp: product.vatRateBp,
      refundedOre: 0,
      paymentFeeOre: Math.round((grossOre * STRIPE_FEE_BP) / 10_000) + STRIPE_FEE_FIXED_ORE,
      cogsOre: product.cogsOre * quantity,
      shippingOre: product.shippingOre,
      adCostOre,
      status: product.kind === 'DIGITAL' ? 'FULFILLED' : 'PAID',
    };
  }

  private weightedProduct(): ProductDefinition {
    const total = this.products.reduce((sum, product) => sum + product.weight, 0);
    let roll = this.rng() * total;
    for (const product of this.products) {
      roll -= product.weight;
      if (roll <= 0) return product;
    }
    return pick(this.rng, this.products);
  }

  private refundSomething(now: number): void {
    const candidates = this.orders.filter(
      (order) => order.line.status === 'FULFILLED' && order.at < now - 30 * MINUTE,
    );
    if (candidates.length === 0) return;
    const target = pick(this.rng, candidates.slice(-60));
    const index = this.orders.indexOf(target);
    const line: OrderLine = {
      ...target.line,
      status: 'REFUNDED',
      refundedOre: target.line.grossOre,
    };
    this.orders[index] = { ...target, line };
    this.log(
      now,
      STRIPE,
      'ORDER_REFUNDED',
      'NOTICE',
      `Återbetalning på ${formatSek(line.grossOre)} för ”${line.productTitle}”. Avgift, inköp och frakt ligger kvar som kostnad.`,
    );
  }

  private fulfilPaidOrders(before: number): void {
    for (let i = 0; i < this.orders.length; i++) {
      const order = this.orders[i];
      if (order && order.line.status === 'PAID' && order.at <= before) {
        this.orders[i] = { ...order, line: { ...order.line, status: 'FULFILLED' } };
      }
    }
  }

  /** Sentinel's deterministic rules. It may lock the system; it can never arm it. */
  private watch(now: number): void {
    const week = isoWeekAt(now).id;
    const totals = this.totals(now);
    const used = utilizationBp(totals);
    if (used >= WARN_AT_BP && this.warnedWeek !== week) {
      this.warnedWeek = week;
      this.raise(
        now,
        'WARNING',
        `${Math.round(used / 100)} % av veckobudgeten är förbrukad eller reserverad. ${formatSek(remainingOre(totals))} återstår.`,
      );
    }
    if (remainingOre(totals) < 100 && this.exhaustedWeek !== week) {
      this.exhaustedWeek = week;
      this.raise(
        now,
        'WARNING',
        'Veckobudgeten räcker inte till fler anrop. Nya kostnader spärras till måndag 00:00.',
      );
    }
  }

  private raise(now: number, severity: Alert['severity'], message: string): void {
    this.alerts.unshift({
      id: this.nextId('alr'),
      raisedAt: iso(now),
      severity,
      source: 'SENTINEL',
      message,
    });
    this.alerts.length = Math.min(this.alerts.length, 5);
    this.log(
      now,
      sentinelActor(),
      severity === 'CRITICAL' ? 'SENTINEL_CRITICAL' : 'SENTINEL_WARNING',
      severity,
      message,
    );
  }

  private lock(now: number, actor: Actor, reason: string): void {
    this.control = {
      state: 'LOCKED',
      revision: this.control.revision + 1,
      changedAt: iso(now),
      changedBy: actor,
      reason,
    };
    this.log(
      now,
      actor,
      'MASTER_SWITCH_LOCKED',
      actor.kind === 'OPERATOR' ? 'NOTICE' : 'CRITICAL',
      `Systemet låstes: ${reason}.`,
    );

    for (const campaign of this.campaigns) {
      if (campaign.status !== 'RUNNING') continue;
      campaign.status = 'PAUSED';
      this.settle(now, campaign.reservationId, campaign.spentOre);
      this.log(
        now,
        agentActorById('T2-05'),
        'CAMPAIGN_PAUSED',
        'NOTICE',
        `Pausade ”${campaign.title}” vid låsningen. ${formatSek(campaign.spentOre)} förbrukades och ${formatSek(campaign.budgetOre - campaign.spentOre)} gick tillbaka till veckobudgeten.`,
      );
    }

    const inFlight = this.agents.filter((agent) => agent.task !== null);
    for (const agent of inFlight) {
      if (agent.task) agent.task.inFlightAtLock = true;
    }
    if (inFlight.length > 0) {
      this.log(
        now,
        SYSTEM,
        'IN_FLIGHT_DRAINING',
        'INFO',
        `${inFlight.length} anrop pågick redan och slutförs inom sina reservationer. Inga nya startas.`,
      );
    }
  }

  private rollWeek(now: number): void {
    const week = isoWeekAt(now);
    if (week.id === this.weekId) return;
    const closing = this.ledger.filter(
      (row) => row.weekId === this.weekId && row.status === 'SETTLED',
    );
    const settled = (category: SpendCategory) =>
      closing
        .filter((row) => row.category === category)
        .reduce((sum, row) => sum + row.actualOre, 0);
    this.closedWeeks.set(this.weekId, {
      adsOre: settled('ADS'),
      aiOre: settled('AI_TOKENS'),
      apiOre: settled('API_CALLS'),
    });
    this.weekId = week.id;
    this.alerts.length = 0;
    this.ledger.splice(
      0,
      this.ledger.length,
      ...this.ledger.filter((row) => row.status === 'ACTIVE' || row.weekId === week.id),
    );
    this.log(
      now,
      SYSTEM,
      'BUDGET_WEEK_STARTED',
      'INFO',
      `Ny budgetvecka ${week.id}. Veckogränsen är ${formatSek(this.limitOre)}.`,
    );
    this.reviewWeeklyLimit(now);
  }

  /**
   * Monday's review: Sentinel proposes reinvesting a share of the newest settled week's
   * profit. A raise waits for the operator; a loss lowers the limit at once – but never
   * below what this week has already committed.
   */
  private reviewWeeklyLimit(now: number): void {
    for (let i = this.approvals.length - 1; i >= 0; i--) {
      if (this.approvals[i]?.payload.type === 'limit') this.approvals.splice(i, 1);
    }
    const week = settledWeekAt(now, this.growth.settleDays);
    const profitOre = this.realisedProfit(week);
    if (profitOre === null) return;
    const change = nextWeeklyLimit(this.limitOre, profitOre, this.growth);
    const sentinel = AGENTS.find((def) => def.id === 'T2-10');
    const actor = sentinel ? agentActor(sentinel) : SYSTEM;
    const label = `Vecka ${week.week}`;

    if (change.kind === 'RAISE') {
      const approval: Approval = {
        id: this.nextId('apr'),
        kind: 'BUDGET_LIMIT',
        title: `Höj veckogränsen till ${formatSek(change.limitOre)}`,
        summary: `${label} gav ${formatSek(profitOre)} i vinst efter AI, API och verktyg, och ångerrätten har löpt ut. ${this.growth.shareBp / 100} % av vinsten läggs på gränsen, upp till taket ${formatSek(this.growth.ceilingOre)}.`,
        requestedBy: sentinel?.id ?? 'T2-10',
        createdAt: iso(now),
        costOre: 0,
        expectedMarginBp: null,
        proposedLimitOre: change.limitOre,
      };
      this.approvals.unshift({ approval, payload: { type: 'limit', limitOre: change.limitOre } });
      this.log(
        now,
        actor,
        'WEEKLY_LIMIT_PROPOSED',
        'INFO',
        `Föreslår att veckogränsen höjs till ${formatSek(change.limitOre)}. Väntar på ditt beslut.`,
      );
    } else if (change.kind === 'LOWER') {
      const committed = ledgerTotals(this.ledger, isoWeekAt(now).id, this.limitOre);
      this.limitOre = Math.max(change.limitOre, committed.settledOre + committed.reservedOre);
      this.log(
        now,
        actor,
        'WEEKLY_LIMIT_LOWERED',
        'WARNING',
        `${label} gick med förlust (${formatSek(profitOre)}). Veckogränsen sänktes till ${formatSek(this.limitOre)}.`,
      );
    }
  }

  /** Net result of a closed week after ads, AI, API and the tools' share; null = unknown. */
  private realisedProfit(week: IsoWeek): Ore | null {
    const spend = this.closedWeeks.get(week.id);
    if (!spend) return this.pastProfit.get(week.id) ?? null;
    const sums = summarizeOrders(
      this.orders
        .filter((order) => order.at >= week.startsAt && order.at < week.endsAt)
        .map((order) => order.line),
    );
    const toolsOre = toolCosts().reduce((sum, tool) => sum + tool.weekShareOre, 0);
    return (
      sums.netSalesOre -
      sums.cogsOre -
      sums.shippingOre -
      sums.paymentFeesOre -
      spend.adsOre -
      spend.aiOre -
      spend.apiOre -
      toolsOre
    );
  }

  private log(
    now: number,
    actor: Actor,
    action: string,
    severity: Severity,
    message: string,
  ): void {
    this.audit.unshift({ id: this.nextId('evt'), at: iso(now), actor, action, severity, message });
    this.audit.length = Math.min(this.audit.length, 400);
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString(36).padStart(5, '0')}`;
  }

  // ── Seed: the week so far ──────────────────────────────────────────────────

  private seedHistory(now: number): void {
    const week = isoWeekAt(now);
    const span = Math.max(now - week.startsAt, 2 * HOUR);
    const weekStart = now - span;
    const armedAt = weekStart + span * 0.3;
    const lockedAt = weekStart + span * 0.85;

    this.log(
      weekStart,
      SYSTEM,
      'BUDGET_WEEK_STARTED',
      'INFO',
      `Ny budgetvecka ${week.id}. Veckogränsen är ${formatSek(this.limitOre)}.`,
    );
    this.reviewWeeklyLimit(week.startsAt);
    this.log(
      armedAt,
      OPERATOR,
      'MASTER_SWITCH_ARMED',
      'NOTICE',
      'Systemet aktiverades: Morgonkörning.',
    );

    // Agent work while the system was armed, until roughly a third of the limit is spent.
    const seeded: { at: number; agent: AgentRuntime; template: TaskTemplate }[] = [];
    let aiAndApi = 0;
    while (aiAndApi < this.limitOre * 0.3) {
      const agent = pick(this.rng, this.agents);
      const template = pick(this.rng, agent.def.tasks);
      const at = armedAt + this.rng() * (lockedAt - armedAt);
      seeded.push({ at, agent, template });
      aiAndApi +=
        template.kind === 'llm'
          ? worstCaseCallOre(
              agent.def.model,
              template.promptTokens,
              template.maxOutputTokens,
              this.fx,
            ) * 0.55
          : template.costOre;
    }
    seeded.sort((a, b) => a.at - b.at);
    for (const { at, agent, template } of seeded) {
      const llmTask = template.kind === 'llm';
      const outputTokens = llmTask
        ? Math.round(template.maxOutputTokens * (0.25 + this.rng() * 0.65))
        : 0;
      const actualOre = llmTask
        ? actualCallOre(
            agent.def.model,
            {
              inputTokens: Math.round(template.promptTokens * 0.3),
              cacheReadTokens: Math.round(template.promptTokens * 0.6),
              cacheWriteTokens: Math.round(template.promptTokens * 0.1),
              outputTokens,
            },
            this.fx,
          )
        : template.costOre;
      const id = this.nextId('res');
      this.ledger.push({
        id,
        weekId: week.id,
        agentId: agent.def.id,
        category: llmTask ? 'AI_TOKENS' : 'API_CALLS',
        status: 'SETTLED',
        reservedOre: actualOre,
        actualOre,
        createdAt: at,
        settledAt: at + 9_000,
        model: llmTask ? agent.def.model : null,
        inputTokens: llmTask ? template.promptTokens : 0,
        outputTokens,
      });
      agent.history.unshift({
        id: this.nextId('tsk'),
        title: template.title,
        startedAt: iso(at),
        finishedAt: iso(at + 9_000),
        outcome: 'DONE',
        costOre: actualOre,
      });
      agent.history.length = Math.min(agent.history.length, 8);
      agent.lastActiveAt = at + 9_000;
      if (chance(this.rng, 0.015)) this.handOff(agent, template.title, at + 9_000);
    }

    // One campaign ran to the end, one was paused by the lock.
    const firstBudget = Math.round(this.limitOre * 0.3);
    const secondBudget = Math.round(this.limitOre * 0.2);
    const seededCampaigns = [
      {
        title: 'Meta-kampanj: Mobilhållaren, 5 dagar',
        budgetOre: firstBudget,
        spentOre: firstBudget,
        at: armedAt + span * 0.05,
      },
      {
        title: 'Meta-kampanj: Budgetplaneraren, 3 dagar',
        budgetOre: secondBudget,
        spentOre: Math.round(secondBudget * 0.62),
        at: armedAt + span * 0.3,
      },
    ];
    for (const campaign of seededCampaigns) {
      this.ledger.push({
        id: this.nextId('res'),
        weekId: week.id,
        agentId: 'T2-05',
        category: 'ADS',
        status: 'SETTLED',
        reservedOre: campaign.budgetOre,
        actualOre: campaign.spentOre,
        createdAt: campaign.at,
        settledAt: lockedAt,
        model: null,
        inputTokens: 0,
        outputTokens: 0,
      });
      this.log(
        campaign.at,
        OPERATOR,
        'CAMPAIGN_APPROVED',
        'NOTICE',
        `Du godkände ”${campaign.title}”. Hela livstidsbudgeten på ${formatSek(campaign.budgetOre)} reserverades direkt.`,
      );
    }

    // Two weeks of orders for the trend lines.
    const today = calendarDateOf(now);
    for (let offset = 13; offset >= 0; offset--) {
      const day = addDays(today, -offset);
      const opensAt = zonedTimeToInstant(day, 7, 0);
      const closesAt = zonedTimeToInstant(day, 23, 30);
      const count = randomInt(this.rng, 9, 21);
      const times = Array.from({ length: count }, () => opensAt + this.rng() * (closesAt - opensAt))
        .filter((at) => at < now)
        .sort((a, b) => a - b);
      for (const at of times) {
        const product = this.weightedProduct();
        const adCostOre = chance(this.rng, 0.35) ? randomInt(this.rng, 3_000, 7_000) : 0;
        const line = this.orderFor(product, chance(this.rng, 0.1) ? 2 : 1, at, adCostOre);
        const status: OrderLine['status'] =
          at < now - 30 * MINUTE && chance(this.rng, 0.03)
            ? 'REFUNDED'
            : line.productKind === 'DIGITAL' || at < now - 4 * HOUR
              ? 'FULFILLED'
              : 'PAID';
        this.orders.push({
          line: { ...line, status, refundedOre: status === 'REFUNDED' ? line.grossOre : 0 },
          at,
          localDate: isoDateString(day),
        });
      }
    }

    // Decisions waiting for the operator.
    const projector = PRODUCT_CANDIDATES.find((candidate) => candidate.id === 'prd_projector');
    const notion = PRODUCT_CANDIDATES.find((candidate) => candidate.id === 'prd_notion');
    const lampCampaign = CAMPAIGN_CANDIDATES[0];
    if (projector) this.proposeProduct(projector, lockedAt - 40 * MINUTE);
    if (lampCampaign) this.proposeCampaign(lampCampaign, lockedAt - 12 * MINUTE);
    if (notion) this.proposeProduct(notion, lockedAt - 5 * MINUTE);

    this.control = {
      state: 'LOCKED',
      revision: 2,
      changedAt: iso(lockedAt),
      changedBy: OPERATOR,
      reason: 'Paus för genomgång',
    };
    this.log(
      lockedAt,
      OPERATOR,
      'MASTER_SWITCH_LOCKED',
      'NOTICE',
      'Systemet låstes: Paus för genomgång.',
    );
    this.log(
      now,
      SYSTEM,
      'SIMULATION_STARTED',
      'INFO',
      'Simulerad drift startad. Ingen riktig koppling till Stripe, n8n eller Airtable.',
    );
    this.audit.sort((a, b) => b.at.localeCompare(a.at));
    this.handoffs.sort((a, b) => b.at.localeCompare(a.at));
  }
}

function iso(at: number): string {
  return new Date(at).toISOString();
}

function agentActor(def: AgentDefinition): Actor {
  return { kind: 'AGENT', id: def.id, label: def.codename };
}

function agentActorById(id: string): Actor {
  const def = AGENTS.find((candidate) => candidate.id === id);
  return def ? agentActor(def) : SYSTEM;
}

function sentinelActor(): Actor {
  return { kind: 'SENTINEL', id: 'T2-10', label: 'SENTINEL' };
}

function categorySpend(rows: readonly LedgerRow[], category: SpendCategory): CategorySpend {
  let settledOre = 0;
  let reservedOre = 0;
  for (const row of rows) {
    if (row.category !== category || row.status === 'RELEASED') continue;
    settledOre += row.actualOre;
    if (row.status === 'ACTIVE') reservedOre += Math.max(0, row.reservedOre - row.actualOre);
  }
  return { category, settledOre, reservedOre };
}

function toolCosts() {
  return TOOLS.map((tool) => ({ ...tool, weekShareOre: Math.round((tool.monthlyOre * 12) / 52) }));
}

function modelUsage(rows: readonly LedgerRow[]): ModelUsage[] {
  const byModel = new Map<string, ModelUsage>();
  for (const row of rows) {
    if (row.category !== 'AI_TOKENS' || row.status !== 'SETTLED' || !row.model) continue;
    const current = byModel.get(row.model) ?? {
      model: row.model,
      label: modelLabel(row.model),
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costOre: 0,
    };
    byModel.set(row.model, {
      ...current,
      calls: current.calls + 1,
      inputTokens: current.inputTokens + row.inputTokens,
      outputTokens: current.outputTokens + row.outputTokens,
      costOre: current.costOre + row.actualOre,
    });
  }
  return [...byModel.values()].sort((a, b) => b.costOre - a.costOre);
}

function denialText(reason: DenyReason, costOre: Ore, remaining: Ore): string {
  switch (reason) {
    case 'SYSTEM_LOCKED':
      return 'Systemet är låst. Aktivera huvudbrytaren innan du startar kampanjen.';
    case 'BUDGET_EXCEEDED':
      return `Budgeten räcker inte: kampanjen behöver ${formatSek(costOre)} och ${formatSek(remaining)} återstår den här veckan.`;
    case 'INVALID_REQUEST':
      return 'Kampanjens budget är ogiltig.';
    case 'STATE_UNAVAILABLE':
      return 'Läget kunde inte bekräftas. Försök igen.';
  }
}
