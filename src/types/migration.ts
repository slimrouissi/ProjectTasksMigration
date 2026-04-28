/**
 * Core TypeScript interfaces for the Migration Tool
 * Maps Dataverse D365 Project Operations entities to migration types
 */

// =====================================================
// ServiceResult Pattern (matches ProjectRoadmapSimulator)
// =====================================================

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  isLiveData?: boolean;
}

// =====================================================
// Source Entity Types (read from source environment)
// =====================================================

/**
 * Project entity from source environment
 */
export interface SourceProject {
  msdyn_projectid: string;            // Primary key
  msdyn_subject: string;              // Project name
  msdyn_description?: string;         // Project description
  msdyn_scheduledstart?: string;      // ISO date
  msdyn_scheduledend?: string;        // ISO date
  msdyn_progress?: number;            // 0-100
  msdyn_projectmanager?: string;      // SystemUser lookup
  _msdyn_projectmanager_value?: string;
  msdyn_projectteamid?: string;
  statecode: number;                  // 0 = Active
  statuscode: number;
  createdon: string;
  modifiedon: string;
}

/**
 * Project task entity from source environment
 */
export interface SourceTask {
  msdyn_projecttaskid: string;        // Primary key
  msdyn_subject: string;              // Task name
  msdyn_description?: string;
  msdyn_scheduledstart?: string;      // ISO date
  msdyn_scheduledend?: string;        // ISO date
  msdyn_duration?: number;            // Duration in minutes
  msdyn_scheduleddurationminutes?: number;
  msdyn_progress?: number;            // 0-100
  msdyn_outlinelevel?: number;        // Hierarchy depth (1 = root)
  msdyn_wbsid?: string;              // WBS ID (e.g., "1", "1.1", "1.1.1")
  _msdyn_project_value: string;       // Parent project ID
  _msdyn_parenttask_value?: string;   // Parent task ID (null for root tasks)
  _msdyn_projectbucket_value?: string; // Bucket assignment
  msdyn_priority?: number;            // Priority option set
  msdyn_autoscheduling?: boolean;
  msdyn_effortcompleted?: number;
  msdyn_effortremaining?: number;
  msdyn_effort?: number;              // Planned effort in hours
  statecode: number;
  statuscode: number;
}

/**
 * Project team member entity from source environment
 */
export interface SourceTeamMember {
  msdyn_projectteamid: string;        // Primary key
  msdyn_name: string;                 // Display name
  _msdyn_project_value: string;       // Parent project ID
  _msdyn_bookableresourceid_value?: string; // Linked bookable resource
  msdyn_membershipstatus?: number;    // Option set
  msdyn_roleid?: string;             // Role lookup
  _msdyn_roleid_value?: string;
  msdyn_from?: string;               // ISO date
  msdyn_to?: string;                 // ISO date
  msdyn_allocationmethod?: number;   // Option set
  msdyn_hoursrequested?: number;
  statecode: number;
}

/**
 * Project task dependency from source environment
 */
export interface SourceDependency {
  msdyn_projecttaskdependencyid: string;  // Primary key
  _msdyn_project_value: string;            // Parent project ID
  _msdyn_predecessortask_value: string;    // Predecessor task ID
  _msdyn_successortask_value: string;      // Successor task ID
  msdyn_linktype: number;                  // 192350000=FS, 192350001=FF, etc.
}

/**
 * Resource assignment from source environment
 */
export interface SourceAssignment {
  msdyn_resourceassignmentid: string;      // Primary key
  msdyn_name?: string;
  _msdyn_projectid_value: string;          // Parent project ID
  _msdyn_taskid_value: string;             // Assigned task
  _msdyn_bookableresourceid_value?: string; // Assigned resource
  _msdyn_projectteamid_value?: string;     // Team member link
  msdyn_from?: string;                     // ISO date
  msdyn_to?: string;                       // ISO date
  msdyn_plannedwork?: number;              // Planned hours
  statecode: number;
}

/**
 * Project bucket (sprint/category) from source environment
 */
export interface SourceBucket {
  msdyn_projectbucketid: string;           // Primary key
  msdyn_name: string;                      // Bucket name
  _msdyn_project_value: string;            // Parent project ID
}

/**
 * Sprint entity from source environment
 */
export interface SourceSprint {
  msdyn_projectsprintid: string;           // Primary key
  msdyn_name: string;                      // Sprint name
  _msdyn_project_value: string;            // Parent project ID
  msdyn_startdate?: string;               // ISO date
  msdyn_finishdate?: string;              // ISO date
  msdyn_number?: number;                  // Sprint number
}

// =====================================================
// Dependency Type Mapping
// =====================================================

export type DependencyType = 'FS' | 'FF' | 'SS' | 'SF';

export const LINK_TYPE_MAP: Record<number, DependencyType> = {
  192350000: 'FS',   // Finish-to-Start
  192350001: 'FF',   // Finish-to-Finish
  192350002: 'SS',   // Start-to-Start
  192350003: 'SF',   // Start-to-Finish
};

export const LINK_TYPE_LABELS: Record<DependencyType, string> = {
  FS: 'Finish-to-Start',
  FF: 'Finish-to-Finish',
  SS: 'Start-to-Start',
  SF: 'Start-to-Finish',
};

// =====================================================
// Aggregated Source Data
// =====================================================

/**
 * Complete project data fetched from source environment
 */
export interface SourceProjectData {
  project: SourceProject;
  tasks: SourceTask[];
  teamMembers: SourceTeamMember[];
  dependencies: SourceDependency[];
  assignments: SourceAssignment[];
  buckets: SourceBucket[];
  sprints: SourceSprint[];
}

/**
 * Entity counts for a project (displayed in UI)
 */
export interface EntityCounts {
  tasks: number;
  teamMembers: number;
  dependencies: number;
  assignments: number;
  buckets: number;
  sprints: number;
}

// =====================================================
// ID Mapping
// =====================================================

export type EntityType = 'project' | 'task' | 'teamMember' | 'dependency' | 'assignment' | 'bucket' | 'sprint';

export interface IdMapping {
  entityType: EntityType;
  sourceId: string;
  targetId: string;
  sourceName?: string;
}

export interface IdMappingTable {
  projectId: string;
  projectName: string;
  mappings: IdMapping[];
  createdAt: string;
}
