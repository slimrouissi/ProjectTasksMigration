/**
 * Validation Service — pre-flight checks before migration
 * Detects circular deps, missing parents, orphaned references, etc.
 */

import { SourceProjectData } from '../types/migration';
import { ValidationResult, ValidationIssue } from '../types/ui';
import { detectCircularDependencies } from '../utils/taskSorter';

export class ValidationService {
  /**
   * Run all validation checks on a project's source data
   */
  validate(data: SourceProjectData): ValidationResult {
    console.log(`ValidationService: Validating project "${data.project.msdyn_subject}"`);
    console.time('ValidationService.validate');

    const issues: ValidationIssue[] = [];

    this.checkCircularParentRefs(data, issues);
    this.checkMissingParents(data, issues);
    this.checkOrphanedDependencies(data, issues);
    this.checkOrphanedAssignments(data, issues);
    this.checkEmptyProject(data, issues);
    this.checkDuplicateWbs(data, issues);

    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warnCount = issues.filter(i => i.severity === 'warning').length;

    console.log(`ValidationService: ${issues.length} issues (${errorCount} errors, ${warnCount} warnings)`);
    console.timeEnd('ValidationService.validate');

    return {
      isValid: errorCount === 0,
      issues,
    };
  }

  private checkCircularParentRefs(data: SourceProjectData, issues: ValidationIssue[]) {
    const circularIds = detectCircularDependencies(data.tasks);
    for (const taskId of circularIds) {
      const task = data.tasks.find(t => t.msdyn_projecttaskid === taskId);
      issues.push({
        severity: 'error',
        message: `Circular parent reference detected for task "${task?.msdyn_subject || taskId}"`,
        entityType: 'task',
        entityId: taskId,
        entityName: task?.msdyn_subject,
      });
    }
  }

  private checkMissingParents(data: SourceProjectData, issues: ValidationIssue[]) {
    const taskIds = new Set(data.tasks.map(t => t.msdyn_projecttaskid));

    for (const task of data.tasks) {
      if (task._msdyn_parenttask_value && !taskIds.has(task._msdyn_parenttask_value)) {
        issues.push({
          severity: 'warning',
          message: `Task "${task.msdyn_subject}" references parent task ${task._msdyn_parenttask_value} which is not in the task set. It will be created as a root task.`,
          entityType: 'task',
          entityId: task.msdyn_projecttaskid,
          entityName: task.msdyn_subject,
        });
      }
    }
  }

  private checkOrphanedDependencies(data: SourceProjectData, issues: ValidationIssue[]) {
    const taskIds = new Set(data.tasks.map(t => t.msdyn_projecttaskid));

    for (const dep of data.dependencies) {
      if (!taskIds.has(dep._msdyn_predecessortask_value)) {
        issues.push({
          severity: 'warning',
          message: `Dependency ${dep.msdyn_projecttaskdependencyid} references predecessor task ${dep._msdyn_predecessortask_value} which is not in the task set. This dependency will be skipped.`,
          entityType: 'dependency',
          entityId: dep.msdyn_projecttaskdependencyid,
        });
      }
      if (!taskIds.has(dep._msdyn_successortask_value)) {
        issues.push({
          severity: 'warning',
          message: `Dependency ${dep.msdyn_projecttaskdependencyid} references successor task ${dep._msdyn_successortask_value} which is not in the task set. This dependency will be skipped.`,
          entityType: 'dependency',
          entityId: dep.msdyn_projecttaskdependencyid,
        });
      }
    }
  }

  private checkOrphanedAssignments(data: SourceProjectData, issues: ValidationIssue[]) {
    const taskIds = new Set(data.tasks.map(t => t.msdyn_projecttaskid));
    const teamIds = new Set(data.teamMembers.map(t => t.msdyn_projectteamid));

    for (const assignment of data.assignments) {
      if (!taskIds.has(assignment._msdyn_taskid_value)) {
        issues.push({
          severity: 'warning',
          message: `Assignment ${assignment.msdyn_resourceassignmentid} references task ${assignment._msdyn_taskid_value} which is not in the task set. This assignment will be skipped.`,
          entityType: 'assignment',
          entityId: assignment.msdyn_resourceassignmentid,
        });
      }
      if (assignment._msdyn_projectteamid_value && !teamIds.has(assignment._msdyn_projectteamid_value)) {
        issues.push({
          severity: 'info',
          message: `Assignment ${assignment.msdyn_resourceassignmentid} references team member ${assignment._msdyn_projectteamid_value} which is not in the team member set.`,
          entityType: 'assignment',
          entityId: assignment.msdyn_resourceassignmentid,
        });
      }
    }
  }

  private checkEmptyProject(data: SourceProjectData, issues: ValidationIssue[]) {
    if (data.tasks.length === 0) {
      issues.push({
        severity: 'warning',
        message: `Project "${data.project.msdyn_subject}" has no tasks. Only the project shell will be created.`,
        entityType: 'project',
        entityId: data.project.msdyn_projectid,
        entityName: data.project.msdyn_subject,
      });
    }
  }

  private checkDuplicateWbs(data: SourceProjectData, issues: ValidationIssue[]) {
    const wbsIds = new Map<string, string>();
    for (const task of data.tasks) {
      if (task.msdyn_wbsid) {
        if (wbsIds.has(task.msdyn_wbsid)) {
          issues.push({
            severity: 'warning',
            message: `Duplicate WBS ID "${task.msdyn_wbsid}" found on tasks "${task.msdyn_subject}" and "${wbsIds.get(task.msdyn_wbsid)}". Tasks will be created but WBS ordering may differ.`,
            entityType: 'task',
            entityId: task.msdyn_projecttaskid,
            entityName: task.msdyn_subject,
          });
        } else {
          wbsIds.set(task.msdyn_wbsid, task.msdyn_subject);
        }
      }
    }
  }
}
