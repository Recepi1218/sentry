import { AgentSchema } from '../domain/model';
import { AGENTS, ORG_CHART } from './seed';

describe('ORG_CHART', () => {
  it('places every agent, with one chief per division and Sentinel outside both', () => {
    expect(Object.keys(ORG_CHART).sort()).toEqual(AGENTS.map((agent) => agent.id).sort());
    for (const division of ['VANGUARD', 'MERIDIAN'] as const) {
      const chiefs = AGENTS.filter(
        (agent) => agent.division === division && ORG_CHART[agent.id]?.rank === 'CHIEF',
      );
      expect(chiefs).toHaveLength(1);
    }
    const oversight = AGENTS.filter((agent) => ORG_CHART[agent.id]?.rank === 'OVERSIGHT');
    expect(oversight.map((agent) => agent.codename)).toEqual(['SENTINEL']);
    expect(ORG_CHART[oversight[0]!.id]?.reportsTo).toBeNull();
  });

  it('has every worker report to the chief of its own division', () => {
    for (const agent of AGENTS) {
      const place = ORG_CHART[agent.id];
      if (place?.rank !== 'WORKER') continue;
      const manager = AGENTS.find((candidate) => candidate.id === place.reportsTo);
      expect(manager?.division).toBe(agent.division);
      expect(ORG_CHART[manager!.id]?.rank).toBe('CHIEF');
    }
  });

  it('keeps Airtable rows without the org-chart fields valid', () => {
    const parsed = AgentSchema.parse({
      id: 'T1-01',
      codename: 'SCOUT',
      role: 'Produktforskning',
      division: 'VANGUARD',
      model: 'claude-haiku-5-5',
      status: 'IDLE',
      currentTask: null,
      lastActiveAt: null,
      weekSpendOre: 0,
      weekTasks: 0,
      history: [],
    });
    expect(parsed).toMatchObject({ rank: 'WORKER', team: '', reportsTo: null });
  });
});
