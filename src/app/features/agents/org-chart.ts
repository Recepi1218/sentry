import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Agent, AgentStatus, Division } from '../../core/domain/model';
import { SentryStore } from '../../core/state/sentry-store';
import { AGENT_STATUS, AGENT_STATUS_ORDER, DIVISION } from '../../shared/labels';
import { SekPipe } from '../../shared/pipes';
import { AgentCard } from './agent-card';
import { AgentDetail } from './agent-detail';

interface TeamView {
  readonly name: string;
  readonly agents: readonly Agent[];
  readonly working: number;
}

interface DivisionView {
  readonly id: Division;
  readonly name: string;
  readonly scope: string;
  readonly chief: Agent | null;
  readonly teams: readonly TeamView[];
  readonly total: number;
  readonly working: number;
  readonly spendOre: number;
}

const DIVISIONS: readonly Division[] = ['VANGUARD', 'MERIDIAN'];

/**
 * The organisation: you at the top, Sentinel beside you as independent oversight, and under
 * you the two division chiefs with their teams of workers. Selecting an agent opens its detail.
 */
@Component({
  selector: 'app-org-chart',
  imports: [AgentCard, AgentDetail, RouterLink, SekPipe],
  templateUrl: './org-chart.html',
  styleUrl: './org-chart.scss',
})
export class OrgChart {
  protected readonly store = inject(SentryStore);
  protected readonly selectedId = signal<string | null>(null);

  private readonly agents = computed(() => this.store.snapshot()?.agents ?? []);

  protected readonly selected = computed(() => {
    const id = this.selectedId();
    return id === null ? null : (this.store.agentsById().get(id) ?? null);
  });

  protected readonly oversight = computed(() =>
    this.agents().filter((agent) => agent.rank === 'OVERSIGHT'),
  );

  protected readonly divisions = computed<readonly DivisionView[]>(() =>
    DIVISIONS.map((id) => {
      const members = this.agents().filter(
        (agent) => agent.division === id && agent.rank !== 'OVERSIGHT',
      );
      const chief = members.find((agent) => agent.rank === 'CHIEF') ?? null;
      return {
        id,
        ...DIVISION[id],
        chief,
        teams: teamsOf(members.filter((agent) => agent !== chief)),
        total: members.length,
        working: members.filter((agent) => agent.status === 'WORKING').length,
        spendOre: members.reduce((sum, agent) => sum + agent.weekSpendOre, 0),
      };
    }),
  );

  protected readonly summary = computed(() => {
    const counts = new Map<AgentStatus, number>();
    for (const agent of this.agents()) counts.set(agent.status, (counts.get(agent.status) ?? 0) + 1);
    return AGENT_STATUS_ORDER.filter((status) => counts.has(status)).map((status) => ({
      status,
      count: counts.get(status) ?? 0,
      ...AGENT_STATUS[status],
    }));
  });

  protected readonly operatorState = computed(() => {
    switch (this.store.switchView()) {
      case 'armed':
        return { label: 'Systemet är aktivt', tone: 'caution' };
      case 'locked':
        return { label: 'Systemet är låst', tone: 'info' };
      default:
        return { label: 'Läget bekräftas', tone: 'neutral' };
    }
  });

  protected readonly pendingApprovals = computed(() => this.store.snapshot()?.approvals.length ?? 0);

  protected toggle(agentId: string): void {
    this.selectedId.update((current) => (current === agentId ? null : agentId));
  }
}

/** Workers grouped by team, in the order the teams first appear. */
function teamsOf(workers: readonly Agent[]): readonly TeamView[] {
  const teams = new Map<string, Agent[]>();
  for (const agent of workers) {
    const name = agent.team || 'Agenter';
    teams.set(name, [...(teams.get(name) ?? []), agent]);
  }
  return [...teams].map(([name, agents]) => ({
    name,
    agents,
    working: agents.filter((agent) => agent.status === 'WORKING').length,
  }));
}
