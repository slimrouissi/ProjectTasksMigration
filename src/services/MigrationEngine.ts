/**
 * Migration Engine — executes the plan for each project:
 *   project (match or create) → team members → buckets → tasks → dependencies → assignments
 *   → allocations (planned work) → task progress → related records → reconciliation
 *
 * Every stage is idempotent: things already in the target project are reused, so a run that stopped
 * halfway can simply be run again.
 */

import { ScheduleApiClient, PssEntity, ScheduleOperation, TASK_LINK_STATUS_NOT_LINKED } from '../clients/ScheduleApiClient';
import { DataverseClient } from '../clients/DataverseClient';
import { MAX_OPERATIONS_PER_SET, OPERATION_SET_DELAY } from '../config/appConfig';
import type { IdMapping, ProjectPlan, RelatedTableInfo, SourceProjectData, TeamMemberPlan } from '../types/migration';
import { RESOURCE_TYPE } from '../types/migration';
import {
  emptyStageCounts,
  MigrationConfig,
  MigrationLogEntry,
  MigrationProgress,
  MigrationResult,
  MigrationStage,
  ProjectRunResult,
} from '../types/ui';
import { TargetStateService } from './TargetStateService';
import { RelatedRecordService } from './RelatedRecordService';
import { MetadataService } from './MetadataService';
import { reconcileProject } from './ReconciliationService';
import type { PlanningResult } from './MigrationPlanner';
import { chunk, newGuid, normalizeKey } from '../utils/odata';
import { computeTaskPaths, sortTasksTopologically, summaryTaskIds, toTaskNodes } from '../utils/taskPaths';
import { alignToTargetSlots, parsePlannedWork } from '../utils/plannedWork';
import { extractDataverseErrorMessage, isWorkHourTemplateCalendarError, WORK_HOUR_TEMPLATE_FIX } from '../utils/dataverseErrors';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const P = (id: string) => `/msdyn_projects(${id})`;

export interface EngineCallbacks {
  onLog?: (entry: MigrationLogEntry) => void;
  onProgress?: (progress: MigrationProgress) => void;
  /** Return true to stop after the current project */
  shouldStop?: () => boolean;
}

export class MigrationEngine {
  private schedule: ScheduleApiClient;
  private targetState: TargetStateService;
  private related: RelatedRecordService;

  constructor(private source: DataverseClient, private target: DataverseClient) {
    this.schedule = new ScheduleApiClient(target);
    this.targetState = new TargetStateService(target);
    this.related = new RelatedRecordService(source, target, new MetadataService(source), new MetadataService(target));
  }

  async run(planning: PlanningResult, config: MigrationConfig, projectIds: string[], callbacks: EngineCallbacks = {}): Promise<MigrationResult> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const logs: MigrationLogEntry[] = [];
    const results: ProjectRunResult[] = [];
    const plans = planning.plans.filter(p => projectIds.includes(p.sourceProjectId));

    const emit = (stage: MigrationStage, index: number, current?: string, stageFraction = 0) => {
      callbacks.onProgress?.({
        stage,
        currentProject: current,
        currentProjectIndex: index,
        totalProjects: plans.length,
        overallProgress: Math.round(((index + stageFraction) / Math.max(plans.length, 1)) * 100),
        logs: [...logs],
        results: [...results],
      });
    };

    for (let i = 0; i < plans.length; i++) {
      if (callbacks.shouldStop?.()) break;
      const plan = plans[i];
      const data = planning.data.get(plan.sourceProjectId)!;
      const log = (stage: MigrationStage, message: string, level: MigrationLogEntry['level'] = 'info') => {
        const entry = { timestamp: new Date().toISOString(), project: plan.sourceName, stage, message, level };
        logs.push(entry);
        callbacks.onLog?.(entry);
      };
      const stageWeights: MigrationStage[] = ['project', 'team', 'buckets', 'tasks', 'dependencies', 'assignments', 'allocations', 'related', 'reconcile'];
      const onStage = (stage: MigrationStage) => emit(stage, i, plan.sourceName, stageWeights.indexOf(stage) / stageWeights.length);

      const result = await this.migrateProject(plan, data, planning.relatedTables, config, log, onStage);
      results.push(result);
      emit(result.status === 'failed' ? 'failed' : 'completed', i + 1, plan.sourceName);
    }

    const finishedAt = new Date().toISOString();
    callbacks.onProgress?.({ stage: 'completed', currentProjectIndex: plans.length, totalProjects: plans.length, overallProgress: 100, logs: [...logs], results: [...results] });
    return {
      success: results.every(r => r.status === 'succeeded'),
      projectResults: results,
      totalDuration: Date.now() - started,
      startedAt,
      finishedAt,
    };
  }

  private async runSets(
    projectId: string,
    label: string,
    ops: ScheduleOperation[],
    log: (s: MigrationStage, m: string, l?: MigrationLogEntry['level']) => void,
    stage: MigrationStage,
    isolateFailures = false
  ): Promise<{ done: number; failed: number; errors: string[]; failedOps: ScheduleOperation[] }> {
    let done = 0;
    let failed = 0;
    const errors: string[] = [];
    const failedOps: ScheduleOperation[] = [];
    const batches = chunk(ops, MAX_OPERATIONS_PER_SET);
    const waiting = (elapsedMs: number) =>
      log(stage, `Still waiting for Project Operations to process the ${label} (${Math.round(elapsedMs / 1000)}s). Large or busy environments can take several minutes; don't close this tab.`);
    for (let b = 0; b < batches.length; b++) {
      const description = `Migration ${label}${batches.length > 1 ? ` ${b + 1}/${batches.length}` : ''}`;
      try {
        await this.schedule.run(projectId, description, batches[b], waiting);
        done += batches[b].length;
      } catch (error) {
        if (isolateFailures && batches[b].length > 1) {
          // A failed set is rolled back as a whole; retry one by one so one bad item doesn't block the rest
          log(stage, `A batch failed; retrying the ${batches[b].length} items one at a time to isolate the problem…`, 'warn');
          for (const op of batches[b]) {
            try {
              await this.schedule.run(projectId, `${description} – ${op.label || 'item'}`, [op], waiting);
              done++;
            } catch (singleError) {
              failed++;
              failedOps.push(op);
              const message = `${op.label ? `${op.label}: ` : ''}${(singleError as Error).message.replace(/^Migration [^:]+: /, '')}`;
              errors.push(message);
              log(stage, message, 'error');
            }
          }
        } else {
          failed += batches[b].length;
          failedOps.push(...batches[b]);
          const message = (error as Error).message;
          errors.push(message);
          log(stage, message, 'error');
        }
      }
      if (b < batches.length - 1) await sleep(OPERATION_SET_DELAY);
    }
    return { done, failed, errors, failedOps };
  }

  async migrateProject(
    plan: ProjectPlan,
    data: SourceProjectData,
    relatedTables: RelatedTableInfo[],
    config: MigrationConfig,
    log: (stage: MigrationStage, message: string, level?: MigrationLogEntry['level']) => void,
    onStage: (stage: MigrationStage) => void
  ): Promise<ProjectRunResult> {
    const started = Date.now();
    const counts = emptyStageCounts();
    const errors: string[] = [];
    const warnings: string[] = [];
    const mappings: IdMapping[] = [];
    const result: ProjectRunResult = { sourceProjectId: plan.sourceProjectId, sourceName: plan.sourceName, projectCreated: false, status: 'failed', counts, errors, warnings, durationMs: 0 };
    const finish = (status?: ProjectRunResult['status']) => {
      result.durationMs = Date.now() - started;
      result.status = status || (errors.length ? (counts.tasks.created + counts.tasks.existing > 0 ? 'partial' : 'failed') : 'succeeded');
      result.idMappings = { projectId: plan.sourceProjectId, projectName: plan.sourceName, targetProjectId: result.targetProjectId, mappings, createdAt: new Date().toISOString() };
      log(result.status === 'succeeded' ? 'completed' : 'failed', `${plan.sourceName}: ${result.status}${errors.length ? ` with ${errors.length} error(s)` : ''}`, result.status === 'succeeded' ? 'success' : result.status === 'partial' ? 'warn' : 'error');
      return result;
    };

    const project = data.project;
    const dateOffsetMs = config.mode === 'create' && config.dateHandling === 'shift' && project.msdyn_scheduledstart
      ? new Date().setUTCHours(0, 0, 0, 0) - new Date(new Date(project.msdyn_scheduledstart).setUTCHours(0, 0, 0, 0)).getTime()
      : 0;
    const shift = (value?: string) => (value && dateOffsetMs ? new Date(new Date(value).getTime() + dateOffsetMs).toISOString() : value);

    // ---------------------------------------------------------------- Project
    onStage('project');
    let targetProjectId = plan.match.target?.id;
    if (config.mode === 'create' || (!targetProjectId && config.createMissing)) {
      const name = config.naming === 'prefix' ? `${config.namePrefix}${project.msdyn_subject}` : project.msdyn_subject;
      const payload: Record<string, unknown> = { msdyn_projectid: newGuid(), msdyn_subject: name };
      if (project.msdyn_description) payload.msdyn_description = project.msdyn_description;
      if (project.msdyn_scheduledstart) payload.msdyn_scheduledstart = shift(project.msdyn_scheduledstart);
      const key = project[config.keyRule.sourceField];
      if (key && config.keyRule.targetField === 'msdyn_projectnumber') payload.msdyn_projectnumber = String(key);
      if (config.workHourTemplateId) payload['msdyn_workhourtemplate@odata.bind'] = `/msdyn_workhourtemplates(${config.workHourTemplateId})`;
      log('project', `Creating project "${name}"…`);
      const created = await this.schedule.createProject(payload);
      if (!created.success) {
        let message = `Couldn't create project "${name}": ${extractDataverseErrorMessage(created.error)}`;
        if (isWorkHourTemplateCalendarError(created.error)) message += ` ${WORK_HOUR_TEMPLATE_FIX}`;
        errors.push(message);
        log('project', message, 'error');
        return finish('failed');
      }
      targetProjectId = created.data!;
      result.projectCreated = true;
      result.targetName = name;
      mappings.push({ entityType: 'project', sourceId: project.msdyn_projectid, targetId: targetProjectId, sourceName: project.msdyn_subject, origin: 'created' });
    } else if (!targetProjectId) {
      warnings.push('No target project matched, so nothing was migrated.');
      log('project', `Skipped "${plan.sourceName}": no matching target project.`, 'warn');
      return finish('skipped');
    } else {
      result.targetName = plan.match.target!.name;
      mappings.push({ entityType: 'project', sourceId: project.msdyn_projectid, targetId: targetProjectId, sourceName: project.msdyn_subject, origin: 'existing' });
      log('project', `Adding to existing project "${plan.match.target!.name}"${plan.match.target!.key ? ` (${plan.match.target!.key})` : ''}.`);
    }
    result.targetProjectId = targetProjectId;

    if (result.projectCreated) await this.targetState.waitForBucket(targetProjectId);
    const stateResult = await this.targetState.getState(targetProjectId);
    if (!stateResult.success || !stateResult.data) {
      errors.push(stateResult.error || 'Could not read the target project.');
      return finish('failed');
    }
    const state = stateResult.data;

    // ---------------------------------------------------------------- Team members
    onStage('team');
    const teamMap = new Map<string, string>();
    const teamNames = new Map<string, string>();
    const teamPlan: TeamMemberPlan[] = plan.teamPlan;
    for (const tm of teamPlan) {
      teamNames.set(tm.sourceTeamMemberId, tm.displayName);
      // Generic team members share one generic resource, so they're told apart by name and role
      const isGenericMember = tm.action === 'generic' || tm.target?.resourceType === RESOURCE_TYPE.Generic;
      // Re-check against the current target state (a team member may have been added since planning)
      const existing = !isGenericMember && tm.target
        ? state.teamMembers.find(t => t.resourceId === tm.target!.id)
        : state.teamMembers.find(t => normalizeKey(t.name) === normalizeKey(tm.displayName) && (!tm.targetRole || t.roleId === tm.targetRole.id));
      if (existing && tm.action !== 'skip') {
        teamMap.set(tm.sourceTeamMemberId, existing.id);
        counts.teamMembers.existing++;
        mappings.push({ entityType: 'teamMember', sourceId: tm.sourceTeamMemberId, targetId: existing.id, sourceName: tm.displayName, origin: 'existing' });
        continue;
      }
      if (tm.action === 'skip') {
        counts.teamMembers.skipped++;
        const why = tm.issues.find(i => i.severity === 'error')?.message || 'no usable resource or role';
        warnings.push(`Team member "${tm.displayName}" left out (${why}); ${tm.assignmentCount} assignment(s) skipped.`);
        log('team', `Left out "${tm.displayName}": ${why}`, 'warn');
        continue;
      }
      const payload: Record<string, unknown> = { msdyn_name: tm.displayName, 'msdyn_project@odata.bind': P(targetProjectId) };
      if (tm.targetRole) payload['msdyn_resourcecategory@odata.bind'] = `/bookableresourcecategories(${tm.targetRole.id})`;
      if (tm.action === 'create' && tm.target) payload['msdyn_bookableresourceid@odata.bind'] = `/bookableresources(${tm.target.id})`;
      const created = await this.schedule.createTeamMember(payload);
      if (created.success && created.data) {
        teamMap.set(tm.sourceTeamMemberId, created.data);
        state.teamMembers.push({ id: created.data, name: tm.displayName, resourceId: isGenericMember ? undefined : tm.target?.id, roleId: tm.targetRole?.id });
        counts.teamMembers.created++;
        mappings.push({ entityType: 'teamMember', sourceId: tm.sourceTeamMemberId, targetId: created.data, sourceName: tm.displayName, origin: 'created' });
        log('team', `Added ${tm.action === 'generic' ? 'generic ' : ''}team member "${tm.displayName}"${tm.targetRole ? ` as ${tm.targetRole.name}` : ''}.`);
      } else {
        counts.teamMembers.failed++;
        const message = `Team member "${tm.displayName}": ${extractDataverseErrorMessage(created.error)}`;
        errors.push(message);
        log('team', message, 'error');
      }
    }

    // ---------------------------------------------------------------- Buckets
    onStage('buckets');
    const bucketMap = new Map<string, string>();
    const bucketOps: ScheduleOperation[] = [];
    const targetBucketByName = new Map(state.buckets.map(b => [normalizeKey(b.name), b.id]));
    for (const b of data.buckets) {
      const existing = targetBucketByName.get(normalizeKey(b.msdyn_name));
      if (existing) {
        bucketMap.set(b.msdyn_projectbucketid, existing);
        counts.buckets.existing++;
        continue;
      }
      const id = newGuid();
      bucketMap.set(b.msdyn_projectbucketid, id);
      targetBucketByName.set(normalizeKey(b.msdyn_name), id);
      bucketOps.push({ kind: 'create', entity: { '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectbucket', msdyn_projectbucketid: id, msdyn_name: b.msdyn_name, 'msdyn_project@odata.bind': P(targetProjectId) } });
    }
    let defaultBucket = state.buckets[0]?.id || [...bucketMap.values()][0];
    if (!defaultBucket) {
      defaultBucket = newGuid();
      bucketOps.push({ kind: 'create', entity: { '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectbucket', msdyn_projectbucketid: defaultBucket, msdyn_name: 'Bucket 1', 'msdyn_project@odata.bind': P(targetProjectId) } });
    }
    if (bucketOps.length) {
      const r = await this.runSets(targetProjectId, `buckets for ${plan.sourceName}`, bucketOps, log, 'buckets');
      counts.buckets.created += r.done;
      counts.buckets.failed += r.failed;
      errors.push(...r.errors);
      if (r.failed) return finish();
    }

    // ---------------------------------------------------------------- Tasks
    onStage('tasks');
    const { keys: sourceKeys, paths: sourcePaths } = computeTaskPaths(toTaskNodes(data.tasks));
    const existingByKey = config.mode === 'create' && result.projectCreated ? new Map<string, string>() : new Map(state.tasks.map(t => [t.pathKey, t.id]));
    const summaries = summaryTaskIds(data.tasks);
    const taskMap = new Map<string, string>();
    const taskOps: ScheduleOperation[] = [];
    const customColumns = config.copyCustomTaskFields ? Object.keys(data.tasks[0] || {}).filter(k => !k.startsWith('msdyn_') && !k.startsWith('_') && !k.includes('@') && k !== 'statecode') : [];

    for (const t of sortTasksTopologically(data.tasks)) {
      const key = sourceKeys.get(t.msdyn_projecttaskid)!;
      const existing = existingByKey.get(key);
      if (existing) {
        taskMap.set(t.msdyn_projecttaskid, existing);
        counts.tasks.existing++;
        mappings.push({ entityType: 'task', sourceId: t.msdyn_projecttaskid, targetId: existing, sourceName: sourcePaths.get(t.msdyn_projecttaskid), origin: 'existing' });
        continue;
      }
      const id = newGuid();
      taskMap.set(t.msdyn_projecttaskid, id);
      const entity: PssEntity = {
        '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask',
        msdyn_projecttaskid: id,
        msdyn_subject: t.msdyn_subject,
        msdyn_LinkStatus: TASK_LINK_STATUS_NOT_LINKED,
        'msdyn_project@odata.bind': P(targetProjectId),
        'msdyn_projectbucket@odata.bind': `/msdyn_projectbuckets(${(t._msdyn_projectbucket_value && bucketMap.get(t._msdyn_projectbucket_value)) || defaultBucket})`,
      };
      const parent = t._msdyn_parenttask_value && taskMap.get(t._msdyn_parenttask_value);
      if (parent) entity['msdyn_parenttask@odata.bind'] = `/msdyn_projecttasks(${parent})`;
      else entity.msdyn_outlinelevel = 1;
      if (t.msdyn_description) entity.msdyn_description = t.msdyn_description;
      if (t.msdyn_priority != null) entity.msdyn_priority = t.msdyn_priority;
      if (!summaries.has(t.msdyn_projecttaskid)) {
        // Verified on Project Operations 1.0.0.87: start+end+effort works when effort > 0; for zero-effort
        // tasks the schedule engine rejects an explicit finish ("scheduledStart is read-only"), so use duration.
        if (t.msdyn_scheduledstart) entity.msdyn_scheduledstart = shift(t.msdyn_scheduledstart);
        if ((t.msdyn_effort || 0) > 0 && t.msdyn_scheduledend) {
          entity.msdyn_scheduledend = shift(t.msdyn_scheduledend);
          entity.msdyn_effort = t.msdyn_effort;
        } else if (t.msdyn_duration != null) {
          entity.msdyn_duration = t.msdyn_duration;
        }
      }
      for (const c of customColumns) {
        const v = (t as unknown as Record<string, unknown>)[c];
        if (v !== null && v !== undefined) entity[c] = v;
      }
      taskOps.push({ kind: 'create', entity, label: sourcePaths.get(t.msdyn_projecttaskid) });
      mappings.push({ entityType: 'task', sourceId: t.msdyn_projecttaskid, targetId: id, sourceName: sourcePaths.get(t.msdyn_projecttaskid), origin: 'created' });
    }
    if (taskOps.length) {
      log('tasks', `Adding ${taskOps.length} task(s)${counts.tasks.existing ? ` (${counts.tasks.existing} already in the target)` : ''}…`);
      const r = await this.runSets(targetProjectId, `tasks for ${plan.sourceName}`, taskOps, log, 'tasks');
      counts.tasks.created += r.done;
      counts.tasks.failed += r.failed;
      errors.push(...r.errors);
      if (r.failed && !r.done) return finish();
    } else {
      log('tasks', `All ${counts.tasks.existing} task(s) are already in the target.`);
    }

    // ---------------------------------------------------------------- Dependencies
    onStage('dependencies');
    const existingDeps = new Set(state.dependencies.map(d => `${d.predecessorId}|${d.successorId}`));
    const depOps: ScheduleOperation[] = [];
    for (const d of data.dependencies) {
      const pred = taskMap.get(d._msdyn_predecessortask_value);
      const succ = taskMap.get(d._msdyn_successortask_value);
      if (!pred || !succ) { counts.dependencies.skipped++; continue; }
      if (existingDeps.has(`${pred}|${succ}`)) { counts.dependencies.existing++; continue; }
      depOps.push({
        kind: 'create',
        entity: {
          '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttaskdependency',
          msdyn_projecttaskdependencyid: newGuid(),
          'msdyn_Project@odata.bind': P(targetProjectId),
          'msdyn_PredecessorTask@odata.bind': `/msdyn_projecttasks(${pred})`,
          'msdyn_SuccessorTask@odata.bind': `/msdyn_projecttasks(${succ})`,
          msdyn_linktype: d.msdyn_linktype,
        },
      });
    }
    if (depOps.length) {
      log('dependencies', `Adding ${depOps.length} dependenc${depOps.length === 1 ? 'y' : 'ies'}…`);
      const r = await this.runSets(targetProjectId, `dependencies for ${plan.sourceName}`, depOps, log, 'dependencies');
      counts.dependencies.created += r.done;
      counts.dependencies.failed += r.failed;
      errors.push(...r.errors);
    }

    // ---------------------------------------------------------------- Assignments
    onStage('assignments');
    const existingAssignments = new Map(state.assignments.filter(a => a.teamMemberId).map(a => [`${a.taskId}|${a.teamMemberId}`, a.id]));
    const assignmentOps: ScheduleOperation[] = [];
    const assignmentPairs: { sourceId: string; targetId: string; created: boolean }[] = [];
    for (const a of data.assignments) {
      if (!a._msdyn_projectteamid_value) continue; // unassigned placeholder rows from the scheduling engine
      const taskId = taskMap.get(a._msdyn_taskid_value);
      const teamId = teamMap.get(a._msdyn_projectteamid_value);
      if (!taskId || !teamId || summaries.has(a._msdyn_taskid_value)) { counts.assignments.skipped++; continue; }
      const key = `${taskId}|${teamId}`;
      const existing = existingAssignments.get(key);
      if (existing) {
        counts.assignments.existing++;
        assignmentPairs.push({ sourceId: a.msdyn_resourceassignmentid, targetId: existing, created: false });
        mappings.push({ entityType: 'assignment', sourceId: a.msdyn_resourceassignmentid, targetId: existing, sourceName: a.msdyn_name, origin: 'existing' });
        continue;
      }
      const id = newGuid();
      existingAssignments.set(key, id);
      assignmentOps.push({
        kind: 'create',
        entity: {
          '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_resourceassignment',
          msdyn_resourceassignmentid: id,
          msdyn_name: a.msdyn_name || teamNames.get(a._msdyn_projectteamid_value) || 'Assignment',
          'msdyn_projectid@odata.bind': P(targetProjectId),
          'msdyn_taskid@odata.bind': `/msdyn_projecttasks(${taskId})`,
          'msdyn_projectteamid@odata.bind': `/msdyn_projectteams(${teamId})`,
        },
      });
      assignmentPairs.push({ sourceId: a.msdyn_resourceassignmentid, targetId: id, created: true });
      mappings.push({ entityType: 'assignment', sourceId: a.msdyn_resourceassignmentid, targetId: id, sourceName: a.msdyn_name, origin: 'created' });
    }
    const failedAssignments = new Set<string>();
    if (assignmentOps.length) {
      log('assignments', `Adding ${assignmentOps.length} assignment(s)…`);
      const r = await this.runSets(targetProjectId, `assignments for ${plan.sourceName}`, assignmentOps, log, 'assignments', true);
      counts.assignments.created += r.done;
      counts.assignments.failed += r.failed;
      errors.push(...r.errors);
      r.failedOps.forEach(o => failedAssignments.add((o as { entity: PssEntity }).entity.msdyn_resourceassignmentid as string));
    }

    // ---------------------------------------------------------------- Allocations (planned work)
    onStage('allocations');
    if (config.copyAllocations && assignmentPairs.length) {
      const current = await this.targetState.getAssignmentDetails(targetProjectId);
      const targetById = new Map((current.data || []).map(a => [a.msdyn_resourceassignmentid, a]));
      const sourceById = new Map(data.assignments.map(a => [a.msdyn_resourceassignmentid, a]));
      const taskNameBySource = new Map(data.tasks.map(t => [t.msdyn_projecttaskid, t.msdyn_subject]));
      const contourOps: ScheduleOperation[] = [];
      let spreadHours = 0;
      for (const pair of assignmentPairs) {
        if (failedAssignments.has(pair.targetId)) continue;
        if (!pair.created && !config.reapplyAllocations) { counts.allocations.existing++; continue; }
        const source = sourceById.get(pair.sourceId);
        const src = parsePlannedWork(source?.msdyn_plannedwork);
        const tgt = parsePlannedWork(targetById.get(pair.targetId)?.msdyn_plannedwork);
        if (!src.length && !tgt.length) { counts.allocations.skipped++; continue; }
        const aligned = alignToTargetSlots(src, tgt, dateOffsetMs);
        if (aligned.unchanged) { counts.allocations.existing++; continue; }
        spreadHours += aligned.unplacedHours;
        const label = `${taskNameBySource.get(source?._msdyn_taskid_value || '') || 'task'} / ${teamNames.get(source?._msdyn_projectteamid_value || '') || 'resource'}`;
        contourOps.push({ kind: 'contour', assignmentId: pair.targetId, contour: aligned.contour, label });
      }
      if (spreadHours > 0) {
        warnings.push(`${Math.round(spreadHours * 10) / 10}h were planned on days that aren't working days in the target calendar; they were spread over the assignment's working days so total effort is unchanged.`);
      }
      if (contourOps.length) {
        log('allocations', `Copying planned hours for ${contourOps.length} assignment(s)…`);
        const r = await this.runSets(targetProjectId, `allocations for ${plan.sourceName}`, contourOps, log, 'allocations', true);
        counts.allocations.created += r.done;
        counts.allocations.failed += r.failed;
        errors.push(...r.errors);
      } else {
        log('allocations', `Planned hours already match the source for all ${counts.allocations.existing} assignment(s).`);
      }
    }

    // ---------------------------------------------------------------- Related records
    onStage('related');
    const relatedSummary: { table: string; displayName: string; source: number; target: number }[] = [];
    for (const tableName of config.relatedTables) {
      const table = relatedTables.find(t => t.logicalName === tableName);
      const rows = data.related[tableName] || [];
      if (!table || !rows.length) continue;
      const r = await this.related.copy(table, rows, { sourceProjectId: project.msdyn_projectid, targetProjectId, taskIdMap: taskMap });
      counts.related.created += r.created;
      counts.related.existing += r.existing;
      counts.related.failed += r.failed;
      errors.push(...r.errors);
      warnings.push(...r.warnings);
      r.errors.forEach(e => log('related', e, 'error'));
      log('related', `${table.displayName}: ${r.created} copied${r.existing ? `, ${r.existing} already there` : ''}${r.failed ? `, ${r.failed} failed` : ''}.`, r.failed ? 'warn' : 'info');
      relatedSummary.push({ table: tableName, displayName: table.displayName, source: rows.length, target: await this.related.countOnTarget(table, targetProjectId) });
    }

    // ---------------------------------------------------------------- Reconciliation
    onStage('reconcile');
    const [tasksNow, assignmentsNow] = await Promise.all([this.targetState.getTaskDetails(targetProjectId), this.targetState.getAssignmentDetails(targetProjectId)]);
    if (tasksNow.success && assignmentsNow.success) {
      result.reconciliation = reconcileProject({
        source: data,
        targetProjectId,
        targetName: result.targetName,
        targetTasks: tasksNow.data || [],
        targetAssignments: assignmentsNow.data || [],
        teamMap,
        teamNames,
        dateOffsetMs,
        related: relatedSummary,
      });
      const s = result.reconciliation.summary;
      log('reconcile', `Reconciliation: ${s.tasksMatched} task(s) match, ${s.tasksDiffer} differ, ${s.tasksMissing} missing; ${s.assignmentsMatched} assignment(s) match, ${s.assignmentsDiffer} differ, ${s.assignmentsMissing} missing; ${s.sourceHours}h source vs ${s.targetHours}h target.`, s.tasksMissing || s.assignmentsMissing ? 'warn' : 'success');
    }

    return finish();
  }
}
