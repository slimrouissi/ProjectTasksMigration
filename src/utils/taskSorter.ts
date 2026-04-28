/**
 * Topological sort for project tasks
 * Ensures parents are created before children within OperationSet batches
 */

import { SourceTask } from '../types/migration';

/**
 * Sort tasks topologically so parents appear before children.
 * Uses outline level + parent reference for ordering.
 * Falls back to WBS ID string comparison for siblings.
 */
export function sortTasksTopologically(tasks: SourceTask[]): SourceTask[] {
  console.log(`taskSorter: Sorting ${tasks.length} tasks topologically`);
  console.time('taskSorter.sortTopologically');

  // Build adjacency: parentId → children
  const childrenMap = new Map<string, SourceTask[]>();
  const rootTasks: SourceTask[] = [];

  for (const task of tasks) {
    const parentId = task._msdyn_parenttask_value;
    if (!parentId) {
      rootTasks.push(task);
    } else {
      const siblings = childrenMap.get(parentId) || [];
      siblings.push(task);
      childrenMap.set(parentId, siblings);
    }
  }

  // Sort siblings by WBS ID for deterministic ordering
  const sortByWbs = (a: SourceTask, b: SourceTask) => {
    const wbsA = a.msdyn_wbsid || '';
    const wbsB = b.msdyn_wbsid || '';
    // Compare WBS segments numerically (e.g., "1.2" < "1.10")
    const partsA = wbsA.split('.').map(Number);
    const partsB = wbsB.split('.').map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const a = partsA[i] ?? 0;
      const b = partsB[i] ?? 0;
      if (a !== b) return a - b;
    }
    return 0;
  };

  rootTasks.sort(sortByWbs);

  // DFS traversal: parent before children
  const sorted: SourceTask[] = [];
  const visited = new Set<string>();

  function visit(task: SourceTask) {
    if (visited.has(task.msdyn_projecttaskid)) return;
    visited.add(task.msdyn_projecttaskid);
    sorted.push(task);

    const children = childrenMap.get(task.msdyn_projecttaskid) || [];
    children.sort(sortByWbs);
    for (const child of children) {
      visit(child);
    }
  }

  for (const root of rootTasks) {
    visit(root);
  }

  // Add any orphaned tasks (parent not in task set) at the end
  for (const task of tasks) {
    if (!visited.has(task.msdyn_projecttaskid)) {
      console.warn(`taskSorter: Orphaned task "${task.msdyn_subject}" (parent ${task._msdyn_parenttask_value} not found)`);
      sorted.push(task);
    }
  }

  console.log(`taskSorter: Sorted ${sorted.length} tasks (${rootTasks.length} root tasks)`);
  console.timeEnd('taskSorter.sortTopologically');
  return sorted;
}

/**
 * Detect circular parent references in tasks
 * Returns list of task IDs involved in cycles
 */
export function detectCircularDependencies(tasks: SourceTask[]): string[] {
  const parentMap = new Map<string, string>();
  for (const task of tasks) {
    if (task._msdyn_parenttask_value) {
      parentMap.set(task.msdyn_projecttaskid, task._msdyn_parenttask_value);
    }
  }

  const circular: string[] = [];
  const taskIds = new Set(tasks.map(t => t.msdyn_projecttaskid));

  for (const task of tasks) {
    const visited = new Set<string>();
    let current = task.msdyn_projecttaskid;

    while (current && taskIds.has(current)) {
      if (visited.has(current)) {
        circular.push(task.msdyn_projecttaskid);
        break;
      }
      visited.add(current);
      current = parentMap.get(current)!;
    }
  }

  return circular;
}
