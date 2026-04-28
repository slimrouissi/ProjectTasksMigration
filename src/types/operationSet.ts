/**
 * TypeScript interfaces for the D365 Project Operations Schedule API
 * Covers OperationSet creation, entity operations, and execution
 */

// =====================================================
// OperationSet Types
// =====================================================

/**
 * Request to create an OperationSet
 */
export interface CreateOperationSetRequest {
  ProjectId: string;               // Target project GUID
  Description: string;             // Human-readable description
}

/**
 * Response from msdyn_CreateOperationSetV1
 */
export interface CreateOperationSetResponse {
  OperationSetId: string;          // GUID of the created OperationSet
}

/**
 * A single operation within an OperationSet (PssCreateV1 payload)
 */
export interface PssCreateRequest {
  Entity: PssEntity;               // The entity to create
  OperationSetId: string;          // The OperationSet this belongs to
}

/**
 * Entity payload for PssCreateV1 — fields vary by entity type
 */
export interface PssEntity {
  '@odata.type': string;           // e.g., "Microsoft.Dynamics.CRM.msdyn_projecttask"
  [key: string]: unknown;          // Dynamic fields based on entity type
}

// =====================================================
// Schedule API Action Payloads
// =====================================================

/**
 * Payload for msdyn_CreateProjectV1 unbound action
 */
export interface CreateProjectPayload {
  Project: {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_project';
    msdyn_projectid?: string;      // Pre-generated GUID
    msdyn_subject: string;         // Project name
    msdyn_description?: string;
    msdyn_scheduledstart?: string; // ISO date
    msdyn_scheduledend?: string;   // ISO date
  };
}

/**
 * Response from msdyn_CreateProjectV1
 */
export interface CreateProjectResponse {
  ProjectId: string;               // GUID of created project
}

/**
 * Payload for msdyn_CreateTeamMemberV1 unbound action
 */
export interface CreateTeamMemberPayload {
  TeamMember: {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectteam';
    msdyn_projectteamid?: string;  // Pre-generated GUID
    msdyn_name: string;
    'msdyn_project@odata.bind': string; // /msdyn_projects(<guid>)
    msdyn_from?: string;
    msdyn_to?: string;
  };
}

/**
 * Response from msdyn_CreateTeamMemberV1
 */
export interface CreateTeamMemberResponse {
  TeamMemberId: string;            // GUID of created team member
}

// =====================================================
// Task Entity for OperationSet
// =====================================================

export interface TaskPssEntity extends PssEntity {
  '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask';
  msdyn_projecttaskid: string;     // Pre-generated GUID
  msdyn_subject: string;
  'msdyn_project@odata.bind': string;
  msdyn_outlinelevel?: number;
  'msdyn_parenttask@odata.bind'?: string;
  'msdyn_projectbucket@odata.bind'?: string;
  msdyn_scheduledstart?: string;
  msdyn_scheduledend?: string;
  msdyn_duration?: number;
  msdyn_effort?: number;
  msdyn_priority?: number;
  msdyn_autoscheduling?: boolean;
  msdyn_wbsid?: string;
}

// =====================================================
// Dependency Entity for OperationSet
// =====================================================

export interface DependencyPssEntity extends PssEntity {
  '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttaskdependency';
  msdyn_projecttaskdependencyid: string;
  'msdyn_project@odata.bind': string;
  'msdyn_predecessortask@odata.bind': string;
  'msdyn_successortask@odata.bind': string;
  msdyn_linktype: number;
}

// =====================================================
// Assignment Entity for OperationSet
// =====================================================

export interface AssignmentPssEntity extends PssEntity {
  '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_resourceassignment';
  msdyn_resourceassignmentid: string;
  'msdyn_projectid@odata.bind': string;
  'msdyn_taskid@odata.bind': string;
  'msdyn_bookableresourceid@odata.bind'?: string;
  'msdyn_projectteamid@odata.bind'?: string;
  msdyn_from?: string;
  msdyn_to?: string;
  msdyn_plannedwork?: number;
}

// =====================================================
// Bucket Entity for OperationSet
// =====================================================

export interface BucketPssEntity extends PssEntity {
  '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectbucket';
  msdyn_projectbucketid: string;
  msdyn_name: string;
  'msdyn_project@odata.bind': string;
}

// =====================================================
// Sprint Entity for OperationSet
// =====================================================

export interface SprintPssEntity extends PssEntity {
  '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectsprint';
  msdyn_projectsprintid: string;
  msdyn_name: string;
  'msdyn_project@odata.bind': string;
  msdyn_startdate?: string;
  msdyn_finishdate?: string;
  msdyn_number?: number;
}

// =====================================================
// OperationSet Execution
// =====================================================

/**
 * Payload for msdyn_ExecuteOperationSetV1
 */
export interface ExecuteOperationSetRequest {
  OperationSetId: string;
}

/**
 * Response from msdyn_ExecuteOperationSetV1
 */
export interface ExecuteOperationSetResponse {
  OperationSetId: string;
  Status: OperationSetStatus;
}

export type OperationSetStatus = 'Completed' | 'Failed' | 'Processing' | 'NotStarted';

/**
 * OperationSet result detail (from polling msdyn_operationsets)
 */
export interface OperationSetDetail {
  msdyn_operationsetid: string;
  msdyn_description?: string;
  msdyn_status: number;            // 192350000=NotStarted, 192350001=Processing, 192350002=Completed, 192350003=Failed
  msdyn_statusreason?: string;
  msdyn_completedon?: string;
}

export const OPERATION_SET_STATUS_MAP: Record<number, OperationSetStatus> = {
  192350000: 'NotStarted',
  192350001: 'Processing',
  192350002: 'Completed',
  192350003: 'Failed',
};
