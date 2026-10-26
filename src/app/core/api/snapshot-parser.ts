import * as z from 'zod';
import {
  AgentSchema,
  AlertSchema,
  ApprovalSchema,
  AuditEventSchema,
  BudgetStatusSchema,
  ControlStateSchema,
  CostBreakdownSchema,
  FinanceSummarySchema,
  HandoffSchema,
  OrderLineSchema,
} from '../domain/model';
import { SentryApiError, type SnapshotResult } from './sentry-api';

/*
 * Airtable fields get renamed and n8n nodes get edited, so responses are validated at the door.
 * The safety-critical parts (switch, budget, finance) must be valid or the whole snapshot is
 * rejected. List rows are checked one by one: a broken order row is dropped and reported
 * instead of blinding the operator to everything else.
 */

const SnapshotEnvelopeSchema = z.object({
  generatedAt: z.iso.datetime({ offset: true }),
  source: z.enum(['mock', 'n8n']),
  control: ControlStateSchema,
  budget: BudgetStatusSchema,
  finance: FinanceSummarySchema,
  costs: CostBreakdownSchema,
  orders: z.array(z.unknown()),
  agents: z.array(z.unknown()),
  handoffs: z.array(z.unknown()),
  approvals: z.array(z.unknown()),
  audit: z.array(z.unknown()),
  alerts: z.array(z.unknown()),
});

export function parseSnapshot(raw: unknown): SnapshotResult {
  const envelope = SnapshotEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new SentryApiError(
      'invalid-response',
      `Snapshot från n8n gick inte att läsa: ${z.prettifyError(envelope.error)}`,
    );
  }

  const issues: string[] = [];
  const rows = <T>(name: string, schema: z.ZodType<T>, items: readonly unknown[]): T[] =>
    items.flatMap((item, index) => {
      const result = schema.safeParse(item);
      if (result.success) return [result.data];
      const first = result.error.issues[0];
      const path = first?.path.length ? `.${first.path.join('.')}` : '';
      issues.push(`${name}[${index}]${path}: ${first?.message ?? 'ogiltig post'}`);
      return [];
    });

  const data = envelope.data;
  return {
    snapshot: {
      ...data,
      orders: rows('orders', OrderLineSchema, data.orders),
      agents: rows('agents', AgentSchema, data.agents),
      handoffs: rows('handoffs', HandoffSchema, data.handoffs),
      approvals: rows('approvals', ApprovalSchema, data.approvals),
      audit: rows('audit', AuditEventSchema, data.audit),
      alerts: rows('alerts', AlertSchema, data.alerts),
    },
    issues,
  };
}

/** Validates a command response; anything unexpected is an error, never a guess. */
export function parseResponse<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new SentryApiError(
      'invalid-response',
      `Oväntat ${what} från n8n: ${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
