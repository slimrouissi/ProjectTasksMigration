/**
 * Validation Service — checks the source data of a project before migration
 */

import type { SourceProjectData } from '../types/migration';
import type { ValidationResult, ValidationIssue } from '../types/ui';
import { detectCircularParents, summaryTaskIds } from '../utils/taskPaths';
import { parsePlannedWork } from '../utils/plannedWork';

export class ValidationService {
  validate(data: SourceProjectData): ValidationResult {
    const issues: ValidationIssue[] = [];
    const taskIds = new Set(data.tasks.map(t => t.msdyn_projecttaskid));
    const teamIds = new Set(data.teamMembers.map(t => t.msdyn_projectteamid));
    const taskName = (id: string) => data.tasks.find(t => t.msdyn_projecttaskid === id)?.msdyn_subject || id;

    for (const id of detectCircularParents(data.tasks)) {
      issues.push({ severity: 'error', message: `Task "${taskName(id)}" has a circular parent reference.`, entityType: 'task', entityId: id, entityName: taskName(id) });
    }

    for (const task of data.tasks) {
      if (task._msdyn_parenttask_value && !taskIds.has(task._msdyn_parenttask_value)) {
        issues.push({ severity: 'warning', message: `Task "${task.msdyn_subject}" has a parent that isn't active in the source. It will be added at the top level.`, entityType: 'task', entityId: task.msdyn_projecttaskid, entityName: task.msdyn_subject });
      }
    }

    for (const dep of data.dependencies) {
      if (!taskIds.has(dep._msdyn_predecessortask_value) || !taskIds.has(dep._msdyn_successortask_value)) {
        issues.push({ severity: 'warning', message: 'A dependency points to a task that isn\'t active in the source; it will be skipped.', entityType: 'dependency', entityId: dep.msdyn_projecttaskdependencyid });
      }
    }

    // Finish-to-start links the source schedule doesn't respect: the target scheduler will move the successor
    const byId = new Map(data.tasks.map(t => [t.msdyn_projecttaskid, t]));
    const violated = data.dependencies.filter(d => {
      if (d.msdyn_linktype !== 192350000) return false;
      const pred = byId.get(d._msdyn_predecessortask_value);
      const succ = byId.get(d._msdyn_successortask_value);
      return !!pred?.msdyn_scheduledend && !!succ?.msdyn_scheduledstart && new Date(succ.msdyn_scheduledstart) < new Date(pred.msdyn_scheduledend);
    });
    if (violated.length) {
      const names = violated.slice(0, 3).map(d => `"${taskName(d._msdyn_successortask_value)}"`).join(', ');
      issues.push({
        severity: 'warning',
        message: `${violated.length} task(s) start before their predecessor finishes (${names}${violated.length > 3 ? '…' : ''}). The target schedules them after the predecessor, so their dates will move; the reconciliation will show the difference.`,
        entityType: 'dependency',
      });
    }

    const summaries = summaryTaskIds(data.tasks);
    for (const a of data.assignments) {
      if (!a._msdyn_projectteamid_value) continue; // placeholder rows the scheduling engine keeps for unassigned tasks
      if (!taskIds.has(a._msdyn_taskid_value)) {
        issues.push({ severity: 'warning', message: `An assignment of "${a.msdyn_name || 'a resource'}" points to a task that isn't active; it will be skipped.`, entityType: 'assignment', entityId: a.msdyn_resourceassignmentid });
      } else if (summaries.has(a._msdyn_taskid_value)) {
        issues.push({ severity: 'warning', message: `"${taskName(a._msdyn_taskid_value)}" is a summary task with a resource assignment; Project Operations only allows assignments on leaf tasks, so it will be skipped.`, entityType: 'assignment', entityId: a.msdyn_resourceassignmentid });
      }
      if (!teamIds.has(a._msdyn_projectteamid_value)) {
        issues.push({ severity: 'warning', message: `An assignment on "${taskName(a._msdyn_taskid_value)}" belongs to an inactive team member; it will be skipped.`, entityType: 'assignment', entityId: a.msdyn_resourceassignmentid });
      }
      if (a.msdyn_plannedwork && parsePlannedWork(a.msdyn_plannedwork).length === 0 && (a.msdyn_effort || 0) > 0) {
        issues.push({ severity: 'info', message: `Planned work on "${taskName(a._msdyn_taskid_value)}" couldn't be read; the target will spread the task effort evenly instead.`, entityType: 'assignment', entityId: a.msdyn_resourceassignmentid });
      }
    }

    if (data.tasks.length === 0) {
      issues.push({ severity: 'warning', message: `"${data.project.msdyn_subject}" has no tasks in the source.`, entityType: 'project', entityId: data.project.msdyn_projectid, entityName: data.project.msdyn_subject });
    }

    return { isValid: !issues.some(i => i.severity === 'error'), issues };
  }
}
