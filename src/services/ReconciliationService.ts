/**
 * Reconciliation — compares a source project with its target project after migration:
 * task by task (path, dates, effort), assignment by assignment (hours), and related-record counts.
 */

import type {
  AssignmentReconciliation,
  ProjectReconciliation,
  SourceProjectData,
  TaskReconciliation,
} from '../types/migration';
import type { TargetAssignmentDetail, TargetTaskDetail } from './TargetStateService';
import { computeTaskPaths, summaryTaskIds, toTaskNodes } from '../utils/taskPaths';
import { parsePlannedWork, round, sameHours, totalHours } from '../utils/plannedWork';

export interface ReconcileInput {
  source: SourceProjectData;
  targetProjectId: string;
  targetName?: string;
  targetTasks: TargetTaskDetail[];
  targetAssignments: TargetAssignmentDetail[];
  /** source team member ID → target team member ID */
  teamMap: Map<string, string>;
  /** source team member ID → display name */
  teamNames: Map<string, string>;
  /** Shift applied to dates (create mode with "shift dates") */
  dateOffsetMs?: number;
  related?: { table: string; displayName: string; source: number; target: number }[];
}

const day = (value?: string, offsetMs = 0) => (value ? new Date(new Date(value).getTime() + offsetMs).toISOString().slice(0, 10) : undefined);

export function reconcileProject(input: ReconcileInput): ProjectReconciliation {
  const { source, targetTasks, targetAssignments, teamMap, teamNames } = input;
  const offset = input.dateOffsetMs || 0;

  const { paths, keys } = computeTaskPaths(toTaskNodes(source.tasks));
  const summaries = summaryTaskIds(source.tasks);
  const targetByKey = new Map(targetTasks.map(t => [t.pathKey, t]));
  const sourceTaskToTarget = new Map<string, string>();

  const tasks: TaskReconciliation[] = source.tasks.map(t => {
    const key = keys.get(t.msdyn_projecttaskid)!;
    const target = targetByKey.get(key);
    const src = { start: day(t.msdyn_scheduledstart, offset), end: day(t.msdyn_scheduledend, offset), effort: t.msdyn_effort == null ? undefined : round(t.msdyn_effort) };
    if (!target) return { path: paths.get(t.msdyn_projecttaskid)!, status: 'missing' as const, source: src, differences: ['not in target'] };
    sourceTaskToTarget.set(t.msdyn_projecttaskid, target.msdyn_projecttaskid);
    const tgt = { start: day(target.msdyn_scheduledstart), end: day(target.msdyn_scheduledend), effort: target.msdyn_effort == null ? undefined : round(target.msdyn_effort) };
    const differences: string[] = [];
    if (src.start && tgt.start && src.start !== tgt.start) differences.push(`start ${src.start} → ${tgt.start}`);
    if (src.end && tgt.end && src.end !== tgt.end) differences.push(`finish ${src.end} → ${tgt.end}`);
    if (!summaries.has(t.msdyn_projecttaskid) && src.effort != null && tgt.effort != null && !sameHours(src.effort, tgt.effort)) differences.push(`effort ${src.effort}h → ${tgt.effort}h`);
    return { path: paths.get(t.msdyn_projecttaskid)!, status: differences.length ? ('differs' as const) : ('match' as const), source: src, target: tgt, differences };
  });

  const targetAssignmentByKey = new Map<string, TargetAssignmentDetail>();
  for (const a of targetAssignments) if (a._msdyn_projectteamid_value) targetAssignmentByKey.set(`${a._msdyn_taskid_value}|${a._msdyn_projectteamid_value}`, a);

  const assignments: AssignmentReconciliation[] = [];
  let sourceHours = 0;
  let targetHours = 0;
  for (const a of source.assignments) {
    if (!a._msdyn_projectteamid_value) continue; // unassigned placeholder rows created by the scheduling engine
    const hours = totalHours(parsePlannedWork(a.msdyn_plannedwork));
    sourceHours += hours;
    const taskPath = paths.get(a._msdyn_taskid_value) || a._msdyn_taskid_value;
    const resource = teamNames.get(a._msdyn_projectteamid_value) || 'Team member';
    const tTask = sourceTaskToTarget.get(a._msdyn_taskid_value);
    const tTeam = teamMap.get(a._msdyn_projectteamid_value);
    const target = tTask && tTeam ? targetAssignmentByKey.get(`${tTask}|${tTeam}`) : undefined;
    if (!target) {
      assignments.push({ task: taskPath, resource, status: 'missing', sourceHours: hours });
      continue;
    }
    const tHours = totalHours(parsePlannedWork(target.msdyn_plannedwork));
    targetHours += tHours;
    assignments.push({ task: taskPath, resource, status: sameHours(hours, tHours) ? 'match' : 'differs', sourceHours: hours, targetHours: tHours });
  }

  return {
    sourceProjectId: source.project.msdyn_projectid,
    sourceName: source.project.msdyn_subject,
    targetProjectId: input.targetProjectId,
    targetName: input.targetName,
    tasks,
    assignments,
    related: input.related || [],
    summary: {
      tasksMatched: tasks.filter(t => t.status === 'match').length,
      tasksDiffer: tasks.filter(t => t.status === 'differs').length,
      tasksMissing: tasks.filter(t => t.status === 'missing').length,
      assignmentsMatched: assignments.filter(a => a.status === 'match').length,
      assignmentsDiffer: assignments.filter(a => a.status === 'differs').length,
      assignmentsMissing: assignments.filter(a => a.status === 'missing').length,
      sourceHours: round(sourceHours),
      targetHours: round(targetHours),
    },
  };
}
