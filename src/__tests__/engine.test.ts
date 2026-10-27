import { describe, it, expect } from 'vitest';
import { alignToTargetSlots, buildContour, parsePlannedWork, totalHours } from '../utils/plannedWork';
import { computeTaskPaths, sortTasksTopologically, summaryTaskIds, detectCircularParents } from '../utils/taskPaths';
import { extractDataverseErrorMessage, isWorkHourTemplateCalendarError } from '../utils/dataverseErrors';
import { ProjectMatchService } from '../services/ProjectMatchService';
import { ResourceService, ResourceResolution } from '../services/ResourceService';
import { reconcileProject } from '../services/ReconciliationService';
import { ValidationService } from '../services/ValidationService';
import { inFilter, normalizeGuid, normalizeKey } from '../utils/odata';
import type { SourceProject, SourceProjectData, SourceTask, SourceTeamMember, SourceAssignment } from '../types/migration';

const wcf = (iso: string) => `/Date(${new Date(iso).getTime()})/`;
const slice = (day: string, hours: number) => ({ Start: wcf(`${day}T09:00:00Z`), End: wcf(`${day}T17:00:00Z`), Hours: hours });
const task = (id: string, subject: string, parent?: string, seq?: number, extra: Partial<SourceTask> = {}): SourceTask => ({
  msdyn_projecttaskid: id, msdyn_subject: subject, _msdyn_parenttask_value: parent, msdyn_displaysequence: seq, _msdyn_project_value: 'p1', ...extra,
});

describe('planned work', () => {
  it('parses Dataverse WCF dates and totals hours', () => {
    const slices = parsePlannedWork(JSON.stringify([slice('2026-01-06', 8), slice('2026-01-05', 4)]));
    expect(slices).toHaveLength(2);
    expect(slices[0].start.toISOString()).toBe('2026-01-05T09:00:00.000Z');
    expect(totalHours(slices)).toBe(12);
  });

  it('returns [] for empty or malformed values', () => {
    expect(parsePlannedWork(undefined)).toEqual([]);
    expect(parsePlannedWork('not json')).toEqual([]);
  });

  it('builds a contour in minutes and zeroes target days the source does not use', () => {
    const src = parsePlannedWork(JSON.stringify([slice('2026-01-05', 6)]));
    const tgt = parsePlannedWork(JSON.stringify([slice('2026-01-05', 8), slice('2026-01-06', 8)]));
    const contour = buildContour(src, tgt);
    expect(contour).toEqual([
      { start: '2026-01-05T09:00:00.000Z', end: '2026-01-05T17:00:00.000Z', minutes: 360 },
      { start: '2026-01-06T09:00:00.000Z', end: '2026-01-06T17:00:00.000Z', minutes: 0 },
    ]);
  });

  it('aligns source hours to target working-day slots and spreads hours on non-working days', () => {
    // Source has 15h Mon + 10h Sat; target only has Mon and Tue slots
    const src = parsePlannedWork(JSON.stringify([slice('2026-01-05', 15), slice('2026-01-10', 10)]));
    const tgt = parsePlannedWork(JSON.stringify([slice('2026-01-05', 8), slice('2026-01-06', 8)]));
    const aligned = alignToTargetSlots(src, tgt);
    expect(aligned.unplacedHours).toBe(10);
    expect(aligned.contour.map(c => c.minutes)).toEqual([25 * 60, 0]);
    expect(aligned.contour.reduce((s, c) => s + c.minutes, 0) / 60).toBe(25);
    expect(aligned.unchanged).toBe(false);
  });

  it('reports unchanged when the target already carries the source hours', () => {
    const src = parsePlannedWork(JSON.stringify([slice('2026-01-05', 8), slice('2026-01-06', 8)]));
    expect(alignToTargetSlots(src, src).unchanged).toBe(true);
  });
});

describe('task paths', () => {
  const tasks = [
    task('a', 'Phase 1', undefined, 2),
    task('b', 'Design', 'a', 3),
    task('c', 'Design', 'a', 4),
    task('d', 'Phase 2', undefined, 5),
    task('e', 'Design', 'd', 6),
  ];

  it('builds stable keys that tell duplicate sibling names apart', () => {
    const { keys, paths } = computeTaskPaths(tasks.map(t => ({ id: t.msdyn_projecttaskid, subject: t.msdyn_subject, parentId: t._msdyn_parenttask_value, displaySequence: t.msdyn_displaysequence })));
    expect(keys.get('b')).toBe('/phase 1/design');
    expect(keys.get('c')).toBe('/phase 1/design#2');
    expect(keys.get('e')).toBe('/phase 2/design');
    expect(paths.get('e')).toBe('Phase 2 › Design');
  });

  it('matches the same tree regardless of IDs (so re-runs find existing tasks)', () => {
    const source = computeTaskPaths([{ id: '1', subject: 'Phase 1' }, { id: '2', subject: ' design ', parentId: '1' }]);
    const target = computeTaskPaths([{ id: 'x', subject: 'phase 1' }, { id: 'y', subject: 'Design', parentId: 'x' }]);
    expect(source.keys.get('2')).toBe(target.keys.get('y'));
  });

  it('sorts parents before children in display order', () => {
    const shuffled = [tasks[4], tasks[2], tasks[0], tasks[3], tasks[1]];
    expect(sortTasksTopologically(shuffled).map(t => t.msdyn_projecttaskid)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('finds summary tasks and circular parents', () => {
    expect([...summaryTaskIds(tasks)].sort()).toEqual(['a', 'd']);
    expect(detectCircularParents([task('x', 'X', 'y'), task('y', 'Y', 'x')]).sort()).toEqual(['x', 'y']);
  });
});

describe('Dataverse errors', () => {
  it('extracts the message from a plugin error body', () => {
    const raw = 'HTTP 400: {"error":{"code":"0x80040265","message":"The calendar for the specified work hour template cannot be found.","@Microsoft.PowerApps.CDS.TraceText":"long trace"}}';
    expect(extractDataverseErrorMessage(raw)).toBe('HTTP 400: The calendar for the specified work hour template cannot be found.');
    expect(isWorkHourTemplateCalendarError(raw)).toBe(true);
  });

  it('turns nested schedule-engine batch errors into one sentence', () => {
    const inner = JSON.stringify({ errorKey: 'E_BATCHFAILED', ErrorMessage: 'One of the batch requests failed', failedBatchRequestIndex: 5, failedBatchRequestError: { ErrorMessage: 'Field is readonly', field: 'scheduledStart' } });
    const raw = `Migration tasks: HTTP 400: ${JSON.stringify({ error: { code: '-1', message: inner } })}`;
    expect(extractDataverseErrorMessage(raw)).toBe('Migration tasks: HTTP 400: Schedule engine rejected the batch: Field is readonly (item 6 in the batch, field scheduledStart)');
  });
});

describe('OData helpers', () => {
  it('normalizes GUIDs and keys', () => {
    expect(normalizeGuid('{6A3B0E9C-0000-4000-8000-00000000000A}')).toBe('6a3b0e9c-0000-4000-8000-00000000000a');
    expect(normalizeGuid('nope')).toBeUndefined();
    expect(normalizeKey('  P-001  21 ')).toBe('p-001 21');
  });
  it('builds an In() filter', () => {
    expect(inFilter('calendarid', ['a', 'b'])).toBe("Microsoft.Dynamics.CRM.In(PropertyName='calendarid',PropertyValues=['a','b'])");
  });
});

describe('project matching', () => {
  const sources = [
    { msdyn_projectid: 's1', msdyn_subject: 'Contoso ERP Rollout', cr_erpprojectnumber: 'CON-2041' },
    { msdyn_projectid: 's2', msdyn_subject: 'No Key Project', cr_erpprojectnumber: null },
    { msdyn_projectid: 's3', msdyn_subject: 'Missing', cr_erpprojectnumber: '999' },
    { msdyn_projectid: 's4', msdyn_subject: 'Dup', cr_erpprojectnumber: '111' },
  ] as unknown as SourceProject[];
  const targets = [
    { id: 't1', name: 'Contoso ERP Rollout (shell)', key: 'CON-2041' },
    { id: 't2', name: 'no key project', key: undefined },
    { id: 't3', name: 'A', key: '111' },
    { id: 't4', name: 'B', key: '111 ' },
  ];
  const rule = { sourceField: 'cr_erpprojectnumber', targetField: 'msdyn_projectnumber', fallbackToName: true };

  it('matches by key, falls back to name, flags missing and ambiguous', () => {
    const m = ProjectMatchService.matchProjects(sources, targets, rule);
    expect(m[0]).toMatchObject({ status: 'matched', target: { id: 't1' }, sourceKey: 'CON-2041' });
    expect(m[1]).toMatchObject({ status: 'matched-by-name', target: { id: 't2' } });
    expect(m[2]).toMatchObject({ status: 'not-found' });
    expect(m[3]).toMatchObject({ status: 'ambiguous' });
    expect(m[3].candidates).toHaveLength(2);
  });

  it('lets a manual pick win', () => {
    const m = ProjectMatchService.matchProjects(sources, targets, rule, { s3: 't3' });
    expect(m[2]).toMatchObject({ status: 'matched', target: { id: 't3' } });
  });

  it('does not match by name when the fallback is off', () => {
    const m = ProjectMatchService.matchProjects(sources, targets, { ...rule, fallbackToName: false });
    expect(m[1].status).toBe('no-key');
  });
});

describe('team planning', () => {
  const resolution: ResourceResolution = {
    matches: new Map([
      ['r-jordan', { source: { id: 'r-jordan', name: 'Jordan Lee', resourceType: 3, active: true }, target: { id: 't-jordan', name: 'Jordan Lee', resourceType: 3, active: true, calendarId: 'c1' }, method: 'entra-user', issues: [] }],
      ['r-gone', { source: { id: 'r-gone', name: 'Former Employee', resourceType: 3, active: true }, method: 'none', issues: [{ code: 'not-found', severity: 'error', message: 'not found' }] }],
      ['r-gen', { source: { id: 'r-gen', name: 'Generic Resource', resourceType: 1, active: true }, target: { id: 't-gen', name: 'Generic Resource', resourceType: 1, active: true, calendarId: 'c2' }, method: 'generic', issues: [] }],
    ]),
    targetResources: [],
    sourceRoles: new Map([['role-dev', { id: 'role-dev', name: 'Developer' }], ['role-an', { id: 'role-an', name: 'Analyst' }]]),
    targetRoles: [{ id: 'trole-dev', name: 'developer' }, { id: 'trole-tm', name: 'Team Member' }],
  };
  const team: SourceTeamMember[] = [
    { msdyn_projectteamid: 'tm1', msdyn_name: 'Jordan Lee', _msdyn_project_value: 'p', _msdyn_bookableresourceid_value: 'r-jordan', _msdyn_resourcecategory_value: 'role-dev', resourceName: 'Jordan Lee' },
    { msdyn_projectteamid: 'tm2', msdyn_name: 'Former Employee', _msdyn_project_value: 'p', _msdyn_bookableresourceid_value: 'r-gone', _msdyn_resourcecategory_value: 'role-dev', resourceName: 'Former Employee' },
    { msdyn_projectteamid: 'tm3', msdyn_name: 'Analyst', _msdyn_project_value: 'p', _msdyn_bookableresourceid_value: 'r-gen', _msdyn_resourcecategory_value: 'role-an', resourceName: 'Generic Resource' },
  ];
  const assignments: SourceAssignment[] = [
    { msdyn_resourceassignmentid: 'a1', _msdyn_projectid_value: 'p', _msdyn_taskid_value: 't', _msdyn_projectteamid_value: 'tm1', msdyn_plannedwork: JSON.stringify([slice('2026-01-05', 8), slice('2026-01-06', 8)]) },
  ];

  it('maps resources and roles, and falls back to generic team members', () => {
    const plan = ResourceService.planTeam(team, assignments, resolution, undefined, { unresolved: 'generic' });
    expect(plan[0]).toMatchObject({ action: 'create', target: { id: 't-jordan' }, targetRole: { id: 'trole-dev' }, plannedHours: 16, assignmentCount: 1 });
    expect(plan[1]).toMatchObject({ action: 'generic', targetRole: { id: 'trole-dev' } });
    expect(plan[2].action).toBe('skip'); // generic with a role that doesn't exist and no fallback
    expect(plan[2].issues.some(i => i.code === 'role-missing' && i.severity === 'error')).toBe(true);
  });

  it('uses the fallback role and skips unresolved people when asked', () => {
    const plan = ResourceService.planTeam(team, assignments, resolution, undefined, { unresolved: 'skip', fallbackRoleId: 'trole-tm' });
    expect(plan[1].action).toBe('skip');
    expect(plan[2]).toMatchObject({ action: 'generic', targetRole: { id: 'trole-tm' } });
  });

  it('reuses a team member already on the target project', () => {
    const state = { projectId: 'tp', tasks: [], buckets: [], assignments: [], dependencies: [], teamMembers: [{ id: 'existing-tm', name: 'Jordan Lee', resourceId: 't-jordan', roleId: 'trole-dev' }] };
    const plan = ResourceService.planTeam(team, assignments, resolution, state, { unresolved: 'generic' });
    expect(plan[0]).toMatchObject({ action: 'reuse', existingTargetTeamMemberId: 'existing-tm' });
  });

  it('honours a role override', () => {
    const { role } = ResourceService.mapRole('role-an', resolution, { roleOverrides: { 'role-an': 'trole-tm' } });
    expect(role?.id).toBe('trole-tm');
  });
});

describe('reconciliation and validation', () => {
  const data: SourceProjectData = {
    project: { msdyn_projectid: 'p', msdyn_subject: 'P' },
    tasks: [
      task('s1', 'Phase', undefined, 1),
      task('s2', 'Build', 's1', 2, { msdyn_scheduledstart: '2026-01-05T09:00:00Z', msdyn_scheduledend: '2026-01-09T17:00:00Z', msdyn_effort: 16 }),
      task('s3', 'Test', 's1', 3, { msdyn_scheduledstart: '2026-01-12T09:00:00Z', msdyn_scheduledend: '2026-01-16T17:00:00Z', msdyn_effort: 8 }),
    ],
    teamMembers: [{ msdyn_projectteamid: 'tm1', _msdyn_project_value: 'p' }],
    dependencies: [{ msdyn_projecttaskdependencyid: 'd', _msdyn_project_value: 'p', _msdyn_predecessortask_value: 's3', _msdyn_successortask_value: 's2', msdyn_linktype: 192350000 }],
    assignments: [
      { msdyn_resourceassignmentid: 'a1', _msdyn_projectid_value: 'p', _msdyn_taskid_value: 's2', _msdyn_projectteamid_value: 'tm1', msdyn_plannedwork: JSON.stringify([slice('2026-01-05', 8), slice('2026-01-06', 8)]) },
      { msdyn_resourceassignmentid: 'placeholder', _msdyn_projectid_value: 'p', _msdyn_taskid_value: 's3' },
    ],
    buckets: [], sprints: [], related: {},
  };

  it('compares tasks by path and assignments by hours, ignoring placeholders', () => {
    const rec = reconcileProject({
      source: data,
      targetProjectId: 'tp',
      targetTasks: [
        { msdyn_projecttaskid: 'x1', msdyn_subject: 'Phase', pathKey: '/phase', path: 'Phase' },
        { msdyn_projecttaskid: 'x2', msdyn_subject: 'Build', pathKey: '/phase/build', path: 'Phase › Build', msdyn_scheduledstart: '2026-01-05T09:00:00Z', msdyn_scheduledend: '2026-01-09T17:00:00Z', msdyn_effort: 16 },
      ],
      targetAssignments: [{ msdyn_resourceassignmentid: 'ta', _msdyn_taskid_value: 'x2', _msdyn_projectteamid_value: 'ttm', msdyn_plannedwork: JSON.stringify([slice('2026-01-05', 8), slice('2026-01-06', 7)]) }],
      teamMap: new Map([['tm1', 'ttm']]),
      teamNames: new Map([['tm1', 'Jordan']]),
    });
    expect(rec.summary).toMatchObject({ tasksMatched: 2, tasksMissing: 1, assignmentsDiffer: 1, sourceHours: 16, targetHours: 15 });
    expect(rec.assignments).toHaveLength(1);
  });

  it('warns when a successor starts before its predecessor finishes', () => {
    const v = new ValidationService().validate(data);
    expect(v.isValid).toBe(true);
    expect(v.issues.some(i => /start before their predecessor/.test(i.message))).toBe(true);
  });
});
