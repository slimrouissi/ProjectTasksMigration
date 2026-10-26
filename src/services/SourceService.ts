/**
 * Source Service — reads projects and everything that hangs off them from the source environment
 */

import { DataverseClient } from '../clients/DataverseClient';
import type {
  ServiceResult,
  SourceProject,
  SourceTask,
  SourceTeamMember,
  SourceDependency,
  SourceAssignment,
  SourceBucket,
  SourceSprint,
  SourceProjectData,
  EntityCounts,
  RelatedTableInfo,
} from '../types/migration';
import { formatted } from '../utils/odata';

const PROJECT_FIELDS = ['msdyn_projectid', 'msdyn_subject', 'msdyn_description', 'msdyn_projectnumber', 'msdyn_scheduledstart', 'msdyn_finish', 'msdyn_progress', '_msdyn_workhourtemplate_value', 'statecode'];
const TASK_FIELDS = ['msdyn_projecttaskid', 'msdyn_subject', 'msdyn_description', 'msdyn_scheduledstart', 'msdyn_scheduledend', 'msdyn_duration', 'msdyn_progress', 'msdyn_outlinelevel', 'msdyn_displaysequence', 'msdyn_effort', 'msdyn_summary', 'msdyn_ismilestone', 'msdyn_priority', '_msdyn_project_value', '_msdyn_parenttask_value', '_msdyn_projectbucket_value'];
const TEAM_FIELDS = ['msdyn_projectteamid', 'msdyn_name', '_msdyn_project_value', '_msdyn_bookableresourceid_value', '_msdyn_resourcecategory_value', 'msdyn_start', 'msdyn_finish', 'msdyn_effort'];
const ASSIGNMENT_FIELDS = ['msdyn_resourceassignmentid', 'msdyn_name', '_msdyn_projectid_value', '_msdyn_taskid_value', '_msdyn_bookableresourceid_value', '_msdyn_projectteamid_value', 'msdyn_start', 'msdyn_finish', 'msdyn_effort', 'msdyn_plannedwork'];

export class SourceService {
  constructor(private client: DataverseClient) {}

  /** Active projects, including the configured key field when it isn't a standard column */
  async getProjects(keyField?: string, extraFields: string[] = []): Promise<ServiceResult<SourceProject[]>> {
    const select = [...PROJECT_FIELDS];
    for (const f of [keyField, ...extraFields]) if (f && !select.includes(f)) select.push(f);
    const result = await this.client.query<SourceProject>('msdyn_projects', {
      select,
      filter: 'statecode eq 0',
      orderBy: 'msdyn_subject asc',
    });
    if (!result.success && keyField && result.error?.includes(keyField)) {
      return { success: false, error: `The source environment has no project field "${keyField}". Pick another key field.` };
    }
    return result;
  }

  async getTasks(projectId: string, extraColumns: string[] = []): Promise<ServiceResult<SourceTask[]>> {
    return this.client.query<SourceTask>('msdyn_projecttasks', {
      select: [...TASK_FIELDS, ...extraColumns],
      filter: `_msdyn_project_value eq ${projectId} and statecode eq 0`,
      orderBy: 'msdyn_displaysequence asc',
    });
  }

  async getTeamMembers(projectId: string): Promise<ServiceResult<SourceTeamMember[]>> {
    const result = await this.client.query<SourceTeamMember & Record<string, unknown>>('msdyn_projectteams', {
      select: TEAM_FIELDS,
      filter: `_msdyn_project_value eq ${projectId} and statecode eq 0`,
    });
    if (!result.success) return { success: false, error: result.error };
    return {
      success: true,
      data: (result.data || []).map(t => ({
        ...t,
        resourceName: formatted(t, '_msdyn_bookableresourceid_value'),
        roleName: formatted(t, '_msdyn_resourcecategory_value'),
      })),
    };
  }

  async getDependencies(projectId: string): Promise<ServiceResult<SourceDependency[]>> {
    return this.client.query<SourceDependency>('msdyn_projecttaskdependencies', {
      select: ['msdyn_projecttaskdependencyid', '_msdyn_project_value', '_msdyn_predecessortask_value', '_msdyn_successortask_value', 'msdyn_linktype'],
      filter: `_msdyn_project_value eq ${projectId}`,
    });
  }

  async getAssignments(projectId: string): Promise<ServiceResult<SourceAssignment[]>> {
    return this.client.query<SourceAssignment>('msdyn_resourceassignments', {
      select: ASSIGNMENT_FIELDS,
      filter: `_msdyn_projectid_value eq ${projectId} and statecode eq 0`,
    });
  }

  async getBuckets(projectId: string): Promise<ServiceResult<SourceBucket[]>> {
    return this.client.query<SourceBucket>('msdyn_projectbuckets', {
      select: ['msdyn_projectbucketid', 'msdyn_name', '_msdyn_project_value'],
      filter: `_msdyn_project_value eq ${projectId}`,
    });
  }

  async getSprints(projectId: string): Promise<ServiceResult<SourceSprint[]>> {
    return this.client.query<SourceSprint>('msdyn_projectsprints', {
      select: ['msdyn_projectsprintid', 'msdyn_name', '_msdyn_project_value', 'msdyn_start', 'msdyn_finish'],
      filter: `_msdyn_project_value eq ${projectId}`,
    });
  }

  async getRelatedRows(table: Pick<RelatedTableInfo, 'entitySetName' | 'projectLookup'>, projectId: string): Promise<ServiceResult<Record<string, unknown>[]>> {
    return this.client.query<Record<string, unknown>>(table.entitySetName, {
      filter: `_${table.projectLookup}_value eq ${projectId}`,
    });
  }

  /**
   * Everything needed to migrate one project. Reads fail loudly: a failed read is an error, not an
   * empty list, so a missing privilege can't silently produce a "successful" but empty migration.
   */
  async getFullProjectData(project: SourceProject, relatedTables: RelatedTableInfo[] = [], extraTaskColumns: string[] = []): Promise<ServiceResult<SourceProjectData>> {
    const id = project.msdyn_projectid;
    const [tasks, team, deps, assignments, buckets, sprints] = await Promise.all([
      this.getTasks(id, extraTaskColumns),
      this.getTeamMembers(id),
      this.getDependencies(id),
      this.getAssignments(id),
      this.getBuckets(id),
      this.getSprints(id),
    ]);

    const failures = ([
      ['tasks', tasks],
      ['team members', team],
      ['dependencies', deps],
      ['resource assignments', assignments],
      ['buckets', buckets],
    ] as [string, ServiceResult<unknown>][]).filter(([, r]) => !r.success);
    if (failures.length) {
      return {
        success: false,
        error: `Could not read ${failures.map(f => f[0]).join(', ')} for "${project.msdyn_subject}" in the source: ${failures[0][1].error}. Check that the migration account can read these tables.`,
      };
    }

    const related: Record<string, Record<string, unknown>[]> = {};
    for (const table of relatedTables) {
      const rows = await this.getRelatedRows(table, id);
      if (!rows.success) {
        return { success: false, error: `Could not read ${table.displayName} for "${project.msdyn_subject}": ${rows.error}` };
      }
      related[table.logicalName] = rows.data || [];
    }

    return {
      success: true,
      isLiveData: true,
      data: {
        project,
        tasks: tasks.data || [],
        teamMembers: team.data || [],
        dependencies: deps.data || [],
        assignments: assignments.data || [],
        buckets: buckets.data || [],
        sprints: sprints.success ? sprints.data || [] : [],
        related,
      },
    };
  }

  async getEntityCounts(projectId: string): Promise<ServiceResult<EntityCounts>> {
    const [tasks, team, deps, assignments, buckets, sprints] = await Promise.all([
      this.getTasks(projectId),
      this.getTeamMembers(projectId),
      this.getDependencies(projectId),
      this.getAssignments(projectId),
      this.getBuckets(projectId),
      this.getSprints(projectId),
    ]);
    return {
      success: tasks.success,
      error: tasks.error,
      data: {
        tasks: tasks.data?.length || 0,
        teamMembers: team.data?.length || 0,
        dependencies: deps.data?.length || 0,
        assignments: (assignments.data || []).filter(a => a._msdyn_projectteamid_value).length,
        buckets: buckets.data?.length || 0,
        sprints: sprints.data?.length || 0,
      },
    };
  }
}
