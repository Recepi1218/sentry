import type { Agent } from '../../core/domain/model';
import { formatDuration, formatRelative } from '../../shared/format';

/** One line on what the agent is doing now, or what it did last. */
export function activityOf(agent: Agent, now: number): string {
  if (agent.currentTask) {
    const elapsed = formatDuration(now - new Date(agent.currentTask.startedAt).getTime());
    return `${agent.currentTask.title}, ${elapsed}`;
  }
  const last = agent.history[0];
  return last
    ? `Senast: ${last.title}, ${formatRelative(last.finishedAt, now)}`
    : 'Inga uppgifter än den här veckan';
}
