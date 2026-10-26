/**
 * Migration Planner — builds the readiness check: what will happen to each project before anything is
 * written. Everything here is read-only, so it can be run as often as needed (and exported for support).
 */

import { DataverseClient } from '../clients/DataverseClient';
import { EnvironmentService } from './EnvironmentService';
import { MetadataService } from './MetadataService';
import { SourceService } from './SourceService';
import { TargetStateService } from './TargetStateService';
import { ProjectMatchService } from './ProjectMatchService';
import { ResourceService, ResourceResolution } from './ResourceService';
import { TargetCalendarService, isUsableTemplate } from './TargetCalendarService';
import { ValidationService } from './ValidationService';
import type {
  OrganizationInfo,
  ProjectPlan,
  ReadinessCheck,
  RelatedTableInfo,
  ServiceResult,
  SourceProject,
  SourceProjectData,
  TargetProjectRef,
  TargetProjectState,
  WorkHourTemplateCheck,
} from '../types/migration';
import type { MigrationConfig } from '../types/ui';
import { computeTaskPaths, summaryTaskIds, toTaskNodes } from '../utils/taskPaths';
import { chunk, inFilter, mapWithConcurrency } from '../utils/odata';
import { READ_CONCURRENCY } from '../config/appConfig';
import { CALENDAR_TEMPLATE_FIX_STEPS } from '../utils/dataverseErrors';

export interface PlanningResult {
  generatedAt: string;
  plans: ProjectPlan[];
  data: Map<string, SourceProjectData>;
  resolution: ResourceResolution;
  relatedTables: RelatedTableInfo[];
  globalChecks: ReadinessCheck[];
  templateCheck?: WorkHourTemplateCheck;
  customTaskColumns: string[];
  targetProjects: TargetProjectRef[];
}

export interface PlannerEnvironment {
  source: OrganizationInfo;
  target: OrganizationInfo;
}

export function projectCreatesNewProject(plan: Pick<ProjectPlan, 'match'>, config: MigrationConfig): boolean {
  if (config.mode === 'create') return true;
  return !plan.match.target && config.createMissing;
}

export class MigrationPlanner {
  readonly sourceService: SourceService;
  readonly sourceMeta: MetadataService;
  readonly targetMeta: MetadataService;
  readonly targetState: TargetStateService;
  readonly matcher: ProjectMatchService;
  readonly resources: ResourceService;
  readonly calendars: TargetCalendarService;
  readonly sourceEnv: EnvironmentService;
  readonly targetEnv: EnvironmentService;
  private validation = new ValidationService();

  constructor(readonly source: DataverseClient, readonly target: DataverseClient) {
    this.sourceService = new SourceService(source);
    this.sourceMeta = new MetadataService(source);
    this.targetMeta = new MetadataService(target);
    this.targetState = new TargetStateService(target);
    this.matcher = new ProjectMatchService(target);
    this.resources = new ResourceService(source, target);
    this.calendars = new TargetCalendarService(target);
    this.sourceEnv = new EnvironmentService(source);
    this.targetEnv = new EnvironmentService(target);
  }

  /** Tables that hang off projects in the source (with row counts for the given projects), flagged when missing in the target */
  async discoverRelatedTables(projectIds: string[] = []): Promise<ServiceResult<RelatedTableInfo[]>> {
    const tables = await this.sourceMeta.getProjectRelatedTables();
    if (!tables.success) return { success: false, error: tables.error };
    const result: RelatedTableInfo[] = [];
    for (const t of tables.data || []) {
      const inTarget = await this.targetMeta.getEntity(t.logicalName);
      let sourceCount = 0;
      for (const group of chunk(projectIds, 50)) {
        const rows = await this.source.query<Record<string, unknown>>(t.entitySetName, { select: [t.primaryIdAttribute], filter: inFilter(t.projectLookup, group) });
        sourceCount += rows.data?.length || 0;
      }
      result.push({ ...t, existsInTarget: !!inTarget, sourceCount });
    }
    return { success: true, data: result };
  }

  async getCustomTaskColumns(): Promise<string[]> {
    const [src, tgt] = await Promise.all([this.sourceMeta.getCustomTaskColumns(), this.targetMeta.getCustomTaskColumns()]);
    const inTarget = new Set(tgt);
    return src.filter(c => inTarget.has(c));
  }

  private environmentChecks(env: PlannerEnvironment): ReadinessCheck[] {
    const checks: ReadinessCheck[] = [];
    const same = (env.source.environmentId && env.source.environmentId === env.target.environmentId) || this.source.env.url === this.target.env.url;
    checks.push(
      same
        ? { id: 'env-different', area: 'environment', title: 'Source and target are different environments', status: 'fail', detail: `Both point to ${env.source.friendlyName} (${this.source.env.url}).`, fix: 'Set VITE_SOURCE_URL and VITE_TARGET_URL to two different environments.' }
        : { id: 'env-different', area: 'environment', title: 'Source and target are different environments', status: 'pass', detail: `${env.source.friendlyName} → ${env.target.friendlyName}` }
    );

    const sv = env.source.projectOperationsVersion;
    const tv = env.target.projectOperationsVersion;
    if (!tv) {
      checks.push({ id: 'po-installed', area: 'environment', title: 'Project Operations is installed in the target', status: 'fail', detail: `${env.target.friendlyName} has no Project Operations solution.`, fix: 'Install Project Operations in the target environment.' });
    } else if (sv && sv !== tv) {
      checks.push({ id: 'po-version', area: 'environment', title: 'Project Operations versions', status: 'warn', detail: `Source ${sv}, target ${tv}. Different versions usually work, but update both if you see schedule errors.` });
    } else {
      checks.push({ id: 'po-version', area: 'environment', title: 'Project Operations versions', status: 'pass', detail: `Both on ${tv}.` });
    }
    return checks;
  }

  private projectChecks(
    project: SourceProject,
    plan: ProjectPlan,
    data: SourceProjectData,
    config: MigrationConfig,
    relatedTables: RelatedTableInfo[],
    targetState?: TargetProjectState
  ): ReadinessCheck[] {
    const checks: ReadinessCheck[] = [];
    const pid = project.msdyn_projectid;
    const m = plan.match;
    const keyLabel = config.keyRule.sourceField;

    if (m.status === 'matched' || m.status === 'matched-by-name') {
      checks.push({
        id: 'match', area: 'project', projectId: pid,
        title: 'Target project found',
        status: m.status === 'matched' ? 'pass' : 'warn',
        detail: m.status === 'matched'
          ? `"${m.target!.name}"${m.target!.key ? ` (${m.target!.key})` : ''}`
          : `Matched "${m.target!.name}" by name because ${m.sourceKey ? `no target project has ${config.keyRule.targetField} = "${m.sourceKey}"` : `the source ${keyLabel} is empty`}. Confirm it's the right project.`,
      });
    } else if (plan.willCreate) {
      checks.push({ id: 'match', area: 'project', projectId: pid, title: 'Target project', status: 'info', detail: config.mode === 'create' ? 'A new project will be created.' : 'No target project found; a new one will be created.' });
    } else if (m.status === 'ambiguous') {
      checks.push({ id: 'match', area: 'project', projectId: pid, title: 'Target project found', status: 'fail', detail: `${m.candidates?.length} target projects match: ${m.candidates?.map(c => `"${c.name}"`).join(', ')}.`, fix: 'Pick the right target project in the match table.' });
    } else {
      checks.push({
        id: 'match', area: 'project', projectId: pid, title: 'Target project found', status: 'fail',
        detail: m.status === 'no-key'
          ? `The source project has no value in ${keyLabel}${config.keyRule.fallbackToName ? ' and no target project has the same name' : ''}.`
          : `No target project has ${config.keyRule.targetField} = "${m.sourceKey}"${config.keyRule.fallbackToName ? ' or the same name' : ''}.`,
        fix: 'Pick the target project in the match table, check the key fields, or allow creating missing projects in Options.',
      });
    }

    const validation = this.validation.validate(data);
    const errors = validation.issues.filter(i => i.severity === 'error');
    const warnings = validation.issues.filter(i => i.severity === 'warning');
    checks.push({
      id: 'source-data', area: 'data', projectId: pid,
      title: 'Source data is consistent',
      status: errors.length ? 'fail' : warnings.length ? 'warn' : 'pass',
      detail: errors.length || warnings.length ? [...errors, ...warnings].slice(0, 6).map(i => i.message).join(' ') + (errors.length + warnings.length > 6 ? ` (+${errors.length + warnings.length - 6} more)` : '') : `${data.tasks.length} tasks, ${data.dependencies.length} dependencies, ${data.assignments.filter(a => a._msdyn_projectteamid_value).length} assignments.`,
      fix: errors.length ? 'Fix the circular task hierarchy in the source project.' : undefined,
    });

    if (targetState || plan.willCreate) {
      checks.push({
        id: 'tasks', area: 'data', projectId: pid,
        title: 'Tasks to add',
        status: 'info',
        detail: plan.tasksAlreadyInTarget
          ? `${plan.tasksToCreate} new, ${plan.tasksAlreadyInTarget} already in the target (kept as they are).`
          : `${plan.tasksToCreate} tasks will be added.`,
      });
      if (targetState && targetState.buckets.length === 0) {
        checks.push({ id: 'bucket', area: 'project', projectId: pid, title: 'Target project has a task bucket', status: 'info', detail: 'The target project has no bucket yet; "Bucket 1" will be created.' });
      }
    }

    const team = plan.teamPlan;
    const blocked = team.filter(t => t.issues.some(i => i.severity === 'error'));
    const generic = team.filter(t => t.action === 'generic' && t.source?.resourceType !== 1);
    const skipped = team.filter(t => t.action === 'skip');
    const skippedHours = skipped.reduce((s, t) => s + t.plannedHours, 0);
    if (!team.length) {
      checks.push({ id: 'resources', area: 'resources', projectId: pid, title: 'Bookable resources', status: 'pass', detail: 'No team members in the source project.' });
    } else if (!blocked.length) {
      checks.push({ id: 'resources', area: 'resources', projectId: pid, title: 'Bookable resources', status: 'pass', detail: `All ${team.length} team members map to valid target resources and roles.` });
    } else {
      const parts = [
        generic.length ? `${generic.length} will be added as generic team members (${generic.map(g => g.displayName).join(', ')})` : '',
        skipped.length ? `${skipped.length} will be left out with ${Math.round(skippedHours * 10) / 10}h of assignments (${skipped.map(s => s.displayName).join(', ')})` : '',
      ].filter(Boolean);
      checks.push({
        id: 'resources', area: 'resources', projectId: pid,
        title: 'Bookable resources',
        status: skipped.length ? 'fail' : 'warn',
        detail: `${blocked.length} of ${team.length} team members have resource issues${parts.length ? `: ${parts.join('; ')}` : ''}. See the resource table.`,
        fix: 'Fix the resources in the target (each row shows how), pick a different resource in the table, or choose a fallback role in Options.',
      });
    }

    const summaries = summaryTaskIds(data.tasks);
    const withProgress = data.tasks.filter(t => !summaries.has(t.msdyn_projecttaskid) && (t.msdyn_progress || 0) > 0);
    if (withProgress.length) {
      checks.push({
        id: 'progress', area: 'data', projectId: pid,
        title: 'Task progress (% complete)',
        status: 'info',
        detail: `${withProgress.length} task(s) show progress in the source. Project Operations calculates progress from actuals and doesn't accept it through the API (verified), so tasks start at 0% in the target. Record time or actuals in the target to bring progress across.`,
      });
    }

    for (const tableName of config.relatedTables) {
      const table = relatedTables.find(t => t.logicalName === tableName);
      if (!table) continue;
      const count = data.related[tableName]?.length || 0;
      if (!count) continue;
      checks.push(
        table.existsInTarget
          ? { id: `related-${tableName}`, area: 'data', projectId: pid, title: table.displayName, status: 'info', detail: `${count} to copy.` }
          : { id: `related-${tableName}`, area: 'data', projectId: pid, title: table.displayName, status: 'fail', detail: `${count} rows, but the table "${tableName}" doesn't exist in the target.`, fix: 'Import the solution that contains this table into the target, or untick it in Options.' }
      );
    }

    return checks;
  }

  async plan(
    projects: SourceProject[],
    config: MigrationConfig,
    env: PlannerEnvironment,
    onProgress?: (message: string) => void
  ): Promise<ServiceResult<PlanningResult>> {
    const globalChecks: ReadinessCheck[] = this.environmentChecks(env);

    onProgress?.('Checking the migration account in the target…');
    const createsAny = config.mode === 'create' || config.createMissing;
    const user = await this.targetEnv.getMigrationUser(env.target.userId);
    globalChecks.push(...EnvironmentService.migrationUserChecks(user.data, env.target.friendlyName, createsAny));

    let templateCheck: WorkHourTemplateCheck | undefined;
    if (createsAny) {
      onProgress?.('Checking calendar templates in the target…');
      const t = await this.calendars.getWorkHourTemplates();
      templateCheck = t.data;
      const selected = templateCheck?.templates.find(x => x.id === config.workHourTemplateId) || templateCheck?.templates.find(x => x.isDefault);
      if (!t.success) {
        globalChecks.push({ id: 'calendar-template', area: 'calendar', title: 'Calendar template for new projects', status: 'warn', detail: `Couldn't check calendar templates: ${t.error}` });
      } else if (!selected || !isUsableTemplate(selected)) {
        globalChecks.push({ id: 'calendar-template', area: 'calendar', title: 'Calendar template for new projects', status: 'fail', detail: selected ? `"${selected.name}": ${selected.statusDetail}.` : 'No usable calendar template in the target.', fix: `${CALENDAR_TEMPLATE_FIX_STEPS} Then pick it in Options.` });
      } else {
        globalChecks.push({ id: 'calendar-template', area: 'calendar', title: 'Calendar template for new projects', status: 'pass', detail: `"${selected.name}" has a valid calendar.` });
      }
    }

    onProgress?.('Looking for related tables…');
    const related = await this.discoverRelatedTables(projects.map(p => p.msdyn_projectid));
    const relatedTables = related.data || [];
    const selectedRelated = relatedTables.filter(t => config.relatedTables.includes(t.logicalName));
    const customTaskColumns = config.copyCustomTaskFields ? await this.getCustomTaskColumns() : [];

    onProgress?.('Matching projects…');
    const targets = await this.matcher.loadTargetProjects(config.keyRule, true);
    if (!targets.success) return { success: false, error: targets.error };
    const matches = ProjectMatchService.matchProjects(projects, targets.data || [], config.keyRule, config.manualMatches);

    onProgress?.(`Reading ${projects.length} source project(s)…`);
    const data = new Map<string, SourceProjectData>();
    const loaded = await mapWithConcurrency(projects, READ_CONCURRENCY, async p => {
      const r = await this.sourceService.getFullProjectData(p, selectedRelated, customTaskColumns);
      return { p, r };
    });
    for (const { p, r } of loaded) {
      if (!r.success || !r.data) return { success: false, error: r.error };
      data.set(p.msdyn_projectid, r.data);
    }

    onProgress?.('Validating bookable resources…');
    const allTeam = [...data.values()].flatMap(d => d.teamMembers);
    const resolution = await this.resources.resolve(allTeam, config.resourceOverrides);
    if (!resolution.success || !resolution.data) return { success: false, error: resolution.error };

    onProgress?.('Reading target projects…');
    const plans: ProjectPlan[] = [];
    for (const project of projects) {
      const d = data.get(project.msdyn_projectid)!;
      const match = matches.find(m => m.sourceProjectId === project.msdyn_projectid)!;
      let targetState: TargetProjectState | undefined;
      if (match.target) {
        const s = await this.targetState.getState(match.target.id);
        if (!s.success) return { success: false, error: s.error };
        targetState = s.data;
      }
      const teamPlan = ResourceService.planTeam(d.teamMembers, d.assignments, resolution.data, targetState, {
        unresolved: config.unresolvedResources,
        fallbackRoleId: config.fallbackRoleId,
        roleOverrides: config.roleOverrides,
      });

      const { keys } = computeTaskPaths(toTaskNodes(d.tasks));
      const existingKeys = new Set((targetState?.tasks || []).map(t => t.pathKey));
      const alreadyThere = config.mode === 'create' ? 0 : [...keys.values()].filter(k => existingKeys.has(k)).length;
      const usable = new Set(teamPlan.filter(t => t.action !== 'skip').map(t => t.sourceTeamMemberId));
      const summaries = summaryTaskIds(d.tasks);

      const plan: ProjectPlan = {
        sourceProjectId: project.msdyn_projectid,
        sourceName: project.msdyn_subject,
        match: config.mode === 'create' ? { ...match, status: 'not-found', target: undefined } : match,
        willCreate: config.mode === 'create' || (!match.target && config.createMissing),
        teamPlan,
        targetState: config.mode === 'create' ? undefined : targetState,
        tasksToCreate: d.tasks.length - alreadyThere,
        tasksAlreadyInTarget: alreadyThere,
        assignmentsToCreate: d.assignments.filter(a => a._msdyn_projectteamid_value && usable.has(a._msdyn_projectteamid_value) && !summaries.has(a._msdyn_taskid_value)).length,
        relatedCounts: Object.fromEntries(Object.entries(d.related).map(([k, v]) => [k, v.length])),
        checks: [],
      };
      plan.checks = this.projectChecks(project, plan, d, config, relatedTables, plan.targetState);
      plans.push(plan);
    }

    return {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        plans,
        data,
        resolution: resolution.data,
        relatedTables,
        globalChecks,
        templateCheck,
        customTaskColumns,
        targetProjects: targets.data || [],
      },
    };
  }
}
