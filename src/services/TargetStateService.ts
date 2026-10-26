/**
 * Target Service — reads what already exists in a target project (tasks, team, buckets, assignments)
 * so re-runs and "add to existing project" don't create duplicates.
 */

import { DataverseClient } from '../clients/DataverseClient';
import type { ServiceResult, TargetProjectState } from '../types/migration';
import { computeTaskPaths } from '../utils/taskPaths';

interface TaskRow {
  msdyn_projecttaskid: string;
  msdyn_subject: string;
  _msdyn_parenttask_value?: string;
  msdyn_displaysequence?: number;
  msdyn_scheduledstart?: string;
  msdyn_scheduledend?: string;
  msdyn_effort?: number;
}

export interface TargetTaskDetail extends TaskRow {
  pathKey: string;
  path: string;
}

export interface TargetAssignmentDetail {
  msdyn_resourceassignmentid: string;
  _msdyn_taskid_value: string;
  _msdyn_projectteamid_value?: string;
  _msdyn_bookableresourceid_value?: string;
  msdyn_plannedwork?: string;
  msdyn_effort?: number;
}

export class TargetStateService {
  constructor(private client: DataverseClient) {}

  async getTaskDetails(projectId: string): Promise<ServiceResult<TargetTaskDetail[]>> {
    const result = await this.client.query<TaskRow>('msdyn_projecttasks', {
      select: ['msdyn_projecttaskid', 'msdyn_subject', '_msdyn_parenttask_value', 'msdyn_displaysequence', 'msdyn_scheduledstart', 'msdyn_scheduledend', 'msdyn_effort'],
      filter: `_msdyn_project_value eq ${projectId} and statecode eq 0`,
    });
    if (!result.success) return { success: false, error: result.error };
    const rows = result.data || [];
    const { paths, keys } = computeTaskPaths(rows.map(t => ({ id: t.msdyn_projecttaskid, subject: t.msdyn_subject, parentId: t._msdyn_parenttask_value, displaySequence: t.msdyn_displaysequence })));
    return {
      success: true,
      data: rows.map(t => ({ ...t, pathKey: keys.get(t.msdyn_projecttaskid)!, path: paths.get(t.msdyn_projecttaskid)! })),
    };
  }

  async getAssignmentDetails(projectId: string): Promise<ServiceResult<TargetAssignmentDetail[]>> {
    return this.client.query<TargetAssignmentDetail>('msdyn_resourceassignments', {
      select: ['msdyn_resourceassignmentid', '_msdyn_taskid_value', '_msdyn_projectteamid_value', '_msdyn_bookableresourceid_value', 'msdyn_plannedwork', 'msdyn_effort'],
      filter: `_msdyn_projectid_value eq ${projectId} and statecode eq 0`,
    });
  }

  async getState(projectId: string): Promise<ServiceResult<TargetProjectState>> {
    const [tasks, team, buckets, assignments, deps] = await Promise.all([
      this.getTaskDetails(projectId),
      this.client.query<{ msdyn_projectteamid: string; msdyn_name?: string; _msdyn_bookableresourceid_value?: string; _msdyn_resourcecategory_value?: string }>('msdyn_projectteams', {
        select: ['msdyn_projectteamid', 'msdyn_name', '_msdyn_bookableresourceid_value', '_msdyn_resourcecategory_value'],
        filter: `_msdyn_project_value eq ${projectId} and statecode eq 0`,
      }),
      this.client.query<{ msdyn_projectbucketid: string; msdyn_name: string }>('msdyn_projectbuckets', {
        select: ['msdyn_projectbucketid', 'msdyn_name'],
        filter: `_msdyn_project_value eq ${projectId}`,
      }),
      this.getAssignmentDetails(projectId),
      this.client.query<{ _msdyn_predecessortask_value: string; _msdyn_successortask_value: string }>('msdyn_projecttaskdependencies', {
        select: ['_msdyn_predecessortask_value', '_msdyn_successortask_value'],
        filter: `_msdyn_project_value eq ${projectId}`,
      }),
    ]);

    const failed = [tasks, team, buckets, assignments].find(r => !r.success);
    if (failed) return { success: false, error: `Could not read the target project: ${failed.error}` };

    return {
      success: true,
      data: {
        projectId,
        tasks: (tasks.data || []).map(t => ({ id: t.msdyn_projecttaskid, subject: t.msdyn_subject, parentId: t._msdyn_parenttask_value, pathKey: t.pathKey })),
        teamMembers: (team.data || []).map(t => ({ id: t.msdyn_projectteamid, name: t.msdyn_name, resourceId: t._msdyn_bookableresourceid_value, roleId: t._msdyn_resourcecategory_value })),
        buckets: (buckets.data || []).map(b => ({ id: b.msdyn_projectbucketid, name: b.msdyn_name })),
        assignments: (assignments.data || []).map(a => ({ id: a.msdyn_resourceassignmentid, taskId: a._msdyn_taskid_value, teamMemberId: a._msdyn_projectteamid_value })),
        dependencies: (deps.data || []).map(d => ({ predecessorId: d._msdyn_predecessortask_value, successorId: d._msdyn_successortask_value })),
      },
    };
  }

  /** Wait until the default bucket exists (CreateProjectV1 creates it asynchronously) */
  async waitForBucket(projectId: string, attempts = 20): Promise<string | undefined> {
    for (let i = 0; i < attempts; i++) {
      const r = await this.client.query<{ msdyn_projectbucketid: string }>('msdyn_projectbuckets', {
        select: ['msdyn_projectbucketid'],
        filter: `_msdyn_project_value eq ${projectId}`,
        top: 1,
      });
      if (r.data?.length) return r.data[0].msdyn_projectbucketid;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    return undefined;
  }
}
