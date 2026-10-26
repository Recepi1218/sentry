import type {
  Actor,
  AgentStatus,
  Approval,
  Division,
  Severity,
  SpendCategory,
  TaskSummary,
} from '../core/domain/model';

/* Swedish copy for the domain's enums, in one place so the vocabulary stays consistent. */

export type Tone = 'info' | 'caution' | 'warning' | 'normal' | 'neutral';

export const AGENT_STATUS: Record<AgentStatus, { readonly label: string; readonly tone: Tone }> = {
  WORKING: { label: 'Arbetar', tone: 'info' },
  IDLE: { label: 'Ledig', tone: 'neutral' },
  AWAITING_APPROVAL: { label: 'Väntar på ditt beslut', tone: 'caution' },
  BLOCKED_BUDGET: { label: 'Stoppad av budgeten', tone: 'warning' },
  PAUSED: { label: 'Pausad', tone: 'neutral' },
  ERROR: { label: 'Fel', tone: 'warning' },
};

/** The order status summaries read in: what needs you first, then what is running. */
export const AGENT_STATUS_ORDER: readonly AgentStatus[] = [
  'AWAITING_APPROVAL',
  'ERROR',
  'BLOCKED_BUDGET',
  'WORKING',
  'IDLE',
  'PAUSED',
];

export const SEVERITY: Record<Severity, { readonly label: string; readonly tone: Tone }> = {
  INFO: { label: 'Info', tone: 'neutral' },
  NOTICE: { label: 'Beslut', tone: 'info' },
  WARNING: { label: 'Varning', tone: 'caution' },
  CRITICAL: { label: 'Kritisk', tone: 'warning' },
};

export const SPEND_CATEGORY: Record<SpendCategory, string> = {
  AI_TOKENS: 'AI-tokens',
  API_CALLS: 'API-anrop',
  ADS: 'Annonser',
};

export const DIVISION: Record<Division, { readonly name: string; readonly scope: string }> = {
  VANGUARD: {
    name: 'Division I: Vanguard',
    scope:
      'E-handel och fysiska produkter. Hittar och räknar på produkter, bevakar marknaden och sköter försäljning, leverans och intäkter.',
  },
  MERIDIAN: {
    name: 'Division II: Meridian',
    scope:
      'Digitala produkter, strategi och optimering. Läser trender och målgrupper, driver kampanjer och innehåll och vakar över risk.',
  },
};

export const TASK_OUTCOME: Record<
  TaskSummary['outcome'],
  { readonly label: string; readonly tone: Tone }
> = {
  DONE: { label: 'Klar', tone: 'normal' },
  FAILED: { label: 'Misslyckades', tone: 'warning' },
  DENIED: { label: 'Stoppad', tone: 'caution' },
  CANCELLED: { label: 'Avbruten', tone: 'neutral' },
};

export const APPROVAL_KIND: Record<Approval['kind'], string> = {
  PRODUCT_LAUNCH: 'Produktförslag',
  CAMPAIGN_LAUNCH: 'Kampanjförslag',
  BUDGET_LIMIT: 'Budgetförslag',
};

/** "av dig" / "av SENTINEL" – the operator is addressed, everyone else is named. */
export function byActor(actor: Actor): string {
  return actor.kind === 'OPERATOR' ? 'dig' : actor.label;
}
