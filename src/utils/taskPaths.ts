/**
 * Task ordering and identity helpers.
 *
 * Tasks are identified across environments by their path (names from the root down, e.g.
 * "Phase 1 › Design"), plus an occurrence number when siblings share a name. This is what lets a
 * re-run skip tasks that already exist in the target project instead of duplicating them.
 */

import type { SourceTask } from '../types/migration';
import { normalizeKey } from './odata';

export interface TaskNode {
  id: string;
  subject: string;
  parentId?: string;
  displaySequence?: number;
}

export const PATH_SEPARATOR = ' › ';

function bySequence(a: TaskNode, b: TaskNode): number {
  const sa = a.displaySequence ?? Number.MAX_SAFE_INTEGER;
  const sb = b.displaySequence ?? Number.MAX_SAFE_INTEGER;
  return sa - sb || a.subject.localeCompare(b.subject);
}

/**
 * Compute display paths and stable match keys for a task list.
 * Returns maps of task ID → display path and task ID → normalized key.
 */
export function computeTaskPaths(tasks: TaskNode[]): { paths: Map<string, string>; keys: Map<string, string> } {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const children = new Map<string | undefined, TaskNode[]>();
  for (const t of tasks) {
    const parent = t.parentId && byId.has(t.parentId) ? t.parentId : undefined;
    const list = children.get(parent) || [];
    list.push(t);
    children.set(parent, list);
  }

  const paths = new Map<string, string>();
  const keys = new Map<string, string>();
  const visited = new Set<string>();

  const walk = (parentId: string | undefined, parentPath: string, parentKey: string) => {
    const siblings = (children.get(parentId) || []).slice().sort(bySequence);
    const seen = new Map<string, number>();
    for (const t of siblings) {
      if (visited.has(t.id)) continue;
      visited.add(t.id);
      const nameKey = normalizeKey(t.subject);
      const occurrence = (seen.get(nameKey) || 0) + 1;
      seen.set(nameKey, occurrence);
      const path = parentPath ? `${parentPath}${PATH_SEPARATOR}${t.subject}` : t.subject;
      const key = `${parentKey}/${nameKey}${occurrence > 1 ? `#${occurrence}` : ''}`;
      paths.set(t.id, path);
      keys.set(t.id, key);
      walk(t.id, path, key);
    }
  };
  walk(undefined, '', '');

  // Tasks in a parent cycle are never reached from a root; give them a flat key so they still match
  for (const t of tasks) {
    if (!visited.has(t.id)) {
      paths.set(t.id, t.subject);
      keys.set(t.id, `/!${normalizeKey(t.subject)}`);
    }
  }

  return { paths, keys };
}

export function toTaskNodes(tasks: SourceTask[]): TaskNode[] {
  return tasks.map(t => ({
    id: t.msdyn_projecttaskid,
    subject: t.msdyn_subject,
    parentId: t._msdyn_parenttask_value,
    displaySequence: t.msdyn_displaysequence,
  }));
}

/**
 * Sort tasks so every parent comes before its children, siblings in display order.
 * Orphans (parent missing from the set) are appended at the end.
 */
export function sortTasksTopologically(tasks: SourceTask[]): SourceTask[] {
  const nodes = new Map(tasks.map(t => [t.msdyn_projecttaskid, t]));
  const children = new Map<string, SourceTask[]>();
  const roots: SourceTask[] = [];

  for (const task of tasks) {
    const parentId = task._msdyn_parenttask_value;
    if (parentId && nodes.has(parentId)) {
      const list = children.get(parentId) || [];
      list.push(task);
      children.set(parentId, list);
    } else {
      roots.push(task);
    }
  }

  const order = (a: SourceTask, b: SourceTask) =>
    (a.msdyn_displaysequence ?? Number.MAX_SAFE_INTEGER) - (b.msdyn_displaysequence ?? Number.MAX_SAFE_INTEGER);

  const sorted: SourceTask[] = [];
  const visited = new Set<string>();
  const visit = (task: SourceTask) => {
    if (visited.has(task.msdyn_projecttaskid)) return;
    visited.add(task.msdyn_projecttaskid);
    sorted.push(task);
    for (const child of (children.get(task.msdyn_projecttaskid) || []).sort(order)) visit(child);
  };
  roots.sort(order).forEach(visit);
  for (const task of tasks) if (!visited.has(task.msdyn_projecttaskid)) sorted.push(task);
  return sorted;
}

/** Task IDs whose parent chain loops back on itself */
export function detectCircularParents(tasks: SourceTask[]): string[] {
  const parentOf = new Map<string, string>();
  for (const t of tasks) if (t._msdyn_parenttask_value) parentOf.set(t.msdyn_projecttaskid, t._msdyn_parenttask_value);
  const circular: string[] = [];
  for (const t of tasks) {
    const seen = new Set<string>();
    let current: string | undefined = t.msdyn_projecttaskid;
    while (current && parentOf.has(current)) {
      if (seen.has(current)) {
        circular.push(t.msdyn_projecttaskid);
        break;
      }
      seen.add(current);
      current = parentOf.get(current);
    }
  }
  return circular;
}

/** Tasks that are parents of other tasks (summary tasks get their dates and effort from children) */
export function summaryTaskIds(tasks: SourceTask[]): Set<string> {
  const ids = new Set(tasks.map(t => t.msdyn_projecttaskid));
  const parents = new Set<string>();
  for (const t of tasks) if (t._msdyn_parenttask_value && ids.has(t._msdyn_parenttask_value)) parents.add(t._msdyn_parenttask_value);
  return parents;
}
