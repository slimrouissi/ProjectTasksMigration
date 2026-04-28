/**
 * Maps source entities to target Schedule API payloads
 * Handles ID remapping from source GUIDs to pre-generated target GUIDs
 */

import {
  SourceTask,
  SourceTeamMember,
  SourceDependency,
  SourceAssignment,
  SourceBucket,
  SourceSprint,
  SourceProject,
} from '../types/migration';
import {
  CreateProjectPayload,
  CreateTeamMemberPayload,
  TaskPssEntity,
  DependencyPssEntity,
  AssignmentPssEntity,
  BucketPssEntity,
  SprintPssEntity,
} from '../types/operationSet';
import { MigrationConfig } from '../types/ui';

type IdMap = Map<string, string>;

/**
 * Map a source project to a CreateProjectV1 payload
 */
export function mapProject(
  source: SourceProject,
  targetProjectId: string,
  config: MigrationConfig,
  dateOffset?: number
): CreateProjectPayload {
  let name = source.msdyn_subject;
  if (config.naming === 'prefix' && config.namePrefix) {
    name = config.namePrefix + name;
  } else if (config.naming === 'custom' && config.customNames?.has(source.msdyn_projectid)) {
    name = config.customNames.get(source.msdyn_projectid)!;
  }

  const payload: CreateProjectPayload = {
    Project: {
      '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_project',
      msdyn_projectid: targetProjectId,
      msdyn_subject: name,
      msdyn_description: source.msdyn_description,
    },
  };

  if (source.msdyn_scheduledstart) {
    payload.Project.msdyn_scheduledstart = applyDateOffset(source.msdyn_scheduledstart, dateOffset);
  }
  if (source.msdyn_scheduledend) {
    payload.Project.msdyn_scheduledend = applyDateOffset(source.msdyn_scheduledend, dateOffset);
  }

  return payload;
}

/**
 * Map a source team member to a CreateTeamMemberV1 payload
 */
export function mapTeamMember(
  source: SourceTeamMember,
  targetTeamMemberId: string,
  targetProjectId: string,
  dateOffset?: number
): CreateTeamMemberPayload {
  const payload: CreateTeamMemberPayload = {
    TeamMember: {
      '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectteam',
      msdyn_projectteamid: targetTeamMemberId,
      msdyn_name: source.msdyn_name,
      'msdyn_project@odata.bind': `/msdyn_projects(${targetProjectId})`,
    },
  };

  if (source.msdyn_from) {
    payload.TeamMember.msdyn_from = applyDateOffset(source.msdyn_from, dateOffset);
  }
  if (source.msdyn_to) {
    payload.TeamMember.msdyn_to = applyDateOffset(source.msdyn_to, dateOffset);
  }

  return payload;
}

/**
 * Map a source task to a PssCreateV1 entity payload
 */
export function mapTask(
  source: SourceTask,
  targetTaskId: string,
  targetProjectId: string,
  taskIdMap: IdMap,
  bucketIdMap: IdMap,
  dateOffset?: number
): TaskPssEntity {
  const entity: TaskPssEntity = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask',
    msdyn_projecttaskid: targetTaskId,
    msdyn_subject: source.msdyn_subject,
    'msdyn_project@odata.bind': `/msdyn_projects(${targetProjectId})`,
  };

  // Map parent task reference
  if (source._msdyn_parenttask_value) {
    const targetParentId = taskIdMap.get(source._msdyn_parenttask_value);
    if (targetParentId) {
      entity['msdyn_parenttask@odata.bind'] = `/msdyn_projecttasks(${targetParentId})`;
    }
  }

  // Map bucket reference
  if (source._msdyn_projectbucket_value) {
    const targetBucketId = bucketIdMap.get(source._msdyn_projectbucket_value);
    if (targetBucketId) {
      entity['msdyn_projectbucket@odata.bind'] = `/msdyn_projectbuckets(${targetBucketId})`;
    }
  }

  if (source.msdyn_outlinelevel != null) entity.msdyn_outlinelevel = source.msdyn_outlinelevel;
  if (source.msdyn_scheduledstart) entity.msdyn_scheduledstart = applyDateOffset(source.msdyn_scheduledstart, dateOffset);
  if (source.msdyn_scheduledend) entity.msdyn_scheduledend = applyDateOffset(source.msdyn_scheduledend, dateOffset);
  if (source.msdyn_duration != null) entity.msdyn_duration = source.msdyn_duration;
  if (source.msdyn_effort != null) entity.msdyn_effort = source.msdyn_effort;
  if (source.msdyn_priority != null) entity.msdyn_priority = source.msdyn_priority;
  if (source.msdyn_autoscheduling != null) entity.msdyn_autoscheduling = source.msdyn_autoscheduling;

  return entity;
}

/**
 * Map a source dependency to a PssCreateV1 entity payload
 */
export function mapDependency(
  source: SourceDependency,
  targetDepId: string,
  targetProjectId: string,
  taskIdMap: IdMap
): DependencyPssEntity | null {
  const targetPredecessor = taskIdMap.get(source._msdyn_predecessortask_value);
  const targetSuccessor = taskIdMap.get(source._msdyn_successortask_value);

  if (!targetPredecessor || !targetSuccessor) {
    console.warn(`entityMapper: Skipping dependency ${source.msdyn_projecttaskdependencyid} — missing task mapping`);
    return null;
  }

  return {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttaskdependency',
    msdyn_projecttaskdependencyid: targetDepId,
    'msdyn_project@odata.bind': `/msdyn_projects(${targetProjectId})`,
    'msdyn_predecessortask@odata.bind': `/msdyn_projecttasks(${targetPredecessor})`,
    'msdyn_successortask@odata.bind': `/msdyn_projecttasks(${targetSuccessor})`,
    msdyn_linktype: source.msdyn_linktype,
  };
}

/**
 * Map a source assignment to a PssCreateV1 entity payload
 */
export function mapAssignment(
  source: SourceAssignment,
  targetAssignmentId: string,
  targetProjectId: string,
  taskIdMap: IdMap,
  teamMemberIdMap: IdMap,
  dateOffset?: number
): AssignmentPssEntity | null {
  const targetTaskId = taskIdMap.get(source._msdyn_taskid_value);
  if (!targetTaskId) {
    console.warn(`entityMapper: Skipping assignment ${source.msdyn_resourceassignmentid} — missing task mapping`);
    return null;
  }

  const entity: AssignmentPssEntity = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_resourceassignment',
    msdyn_resourceassignmentid: targetAssignmentId,
    'msdyn_projectid@odata.bind': `/msdyn_projects(${targetProjectId})`,
    'msdyn_taskid@odata.bind': `/msdyn_projecttasks(${targetTaskId})`,
  };

  // Map team member reference
  if (source._msdyn_projectteamid_value) {
    const targetTeamId = teamMemberIdMap.get(source._msdyn_projectteamid_value);
    if (targetTeamId) {
      entity['msdyn_projectteamid@odata.bind'] = `/msdyn_projectteams(${targetTeamId})`;
    }
  }

  if (source.msdyn_from) entity.msdyn_from = applyDateOffset(source.msdyn_from, dateOffset);
  if (source.msdyn_to) entity.msdyn_to = applyDateOffset(source.msdyn_to, dateOffset);
  if (source.msdyn_plannedwork != null) entity.msdyn_plannedwork = source.msdyn_plannedwork;

  return entity;
}

/**
 * Map a source bucket to a PssCreateV1 entity payload
 */
export function mapBucket(
  source: SourceBucket,
  targetBucketId: string,
  targetProjectId: string
): BucketPssEntity {
  return {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectbucket',
    msdyn_projectbucketid: targetBucketId,
    msdyn_name: source.msdyn_name,
    'msdyn_project@odata.bind': `/msdyn_projects(${targetProjectId})`,
  };
}

/**
 * Map a source sprint to a PssCreateV1 entity payload
 */
export function mapSprint(
  source: SourceSprint,
  targetSprintId: string,
  targetProjectId: string,
  dateOffset?: number
): SprintPssEntity {
  const entity: SprintPssEntity = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectsprint',
    msdyn_projectsprintid: targetSprintId,
    msdyn_name: source.msdyn_name,
    'msdyn_project@odata.bind': `/msdyn_projects(${targetProjectId})`,
  };

  if (source.msdyn_startdate) entity.msdyn_startdate = applyDateOffset(source.msdyn_startdate, dateOffset);
  if (source.msdyn_finishdate) entity.msdyn_finishdate = applyDateOffset(source.msdyn_finishdate, dateOffset);
  if (source.msdyn_number != null) entity.msdyn_number = source.msdyn_number;

  return entity;
}

/**
 * Apply a date offset (in milliseconds) to an ISO date string
 * Used when dateHandling = 'shift' to move dates relative to today
 */
function applyDateOffset(isoDate: string, offsetMs?: number): string {
  if (!offsetMs) return isoDate;
  const date = new Date(isoDate);
  date.setTime(date.getTime() + offsetMs);
  return date.toISOString();
}

/**
 * Calculate the date offset needed to shift the project start date to today
 */
export function calculateDateOffset(projectStartDate: string): number {
  const start = new Date(projectStartDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  return today.getTime() - start.getTime();
}
