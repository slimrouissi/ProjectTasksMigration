/**
 * Domain types for the migration engine (source data, matching, resources, readiness, results).
 * Field names follow the Dataverse Web API logical names verified against Project Operations.
 */

// =====================================================
// ServiceResult pattern
// =====================================================

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  isLiveData?: boolean;
}

// =====================================================
// Source entities (read from the source environment)
// =====================================================

export interface SourceProject {
  msdyn_projectid: string;
  msdyn_subject: string;
  msdyn_description?: string;
  msdyn_projectnumber?: string;
  msdyn_scheduledstart?: string;
  msdyn_finish?: string;
  msdyn_scheduledend?: string;
  msdyn_progress?: number;
  _msdyn_workhourtemplate_value?: string;
  /** Value of the configured matching key field, when it isn't msdyn_projectnumber/msdyn_subject */
  [field: string]: unknown;
}

export interface SourceTask {
  msdyn_projecttaskid: string;
  msdyn_subject: string;
  msdyn_description?: string;
  msdyn_scheduledstart?: string;
  msdyn_scheduledend?: string;
  msdyn_duration?: number;
  msdyn_progress?: number;
  msdyn_outlinelevel?: number;
  msdyn_displaysequence?: number;
  msdyn_effort?: number;
  msdyn_summary?: boolean;
  msdyn_ismilestone?: boolean;
  msdyn_priority?: number;
  _msdyn_project_value: string;
  _msdyn_parenttask_value?: string;
  _msdyn_projectbucket_value?: string;
}

export interface SourceTeamMember {
  msdyn_projectteamid: string;
  msdyn_name?: string;
  _msdyn_project_value: string;
  _msdyn_bookableresourceid_value?: string;
  _msdyn_resourcecategory_value?: string;
  msdyn_start?: string;
  msdyn_finish?: string;
  msdyn_effort?: number;
  /** Display names from formatted-value annotations */
  resourceName?: string;
  roleName?: string;
}

export interface SourceDependency {
  msdyn_projecttaskdependencyid: string;
  _msdyn_project_value: string;
  _msdyn_predecessortask_value: string;
  _msdyn_successortask_value: string;
  msdyn_linktype: number;
}

/** One time slice of msdyn_plannedwork (dates are WCF "/Date(ms)/" strings in Dataverse) */
export interface PlannedWorkSlice {
  Start: string;
  End: string;
  Hours: number;
}

export interface SourceAssignment {
  msdyn_resourceassignmentid: string;
  msdyn_name?: string;
  _msdyn_projectid_value: string;
  _msdyn_taskid_value: string;
  _msdyn_bookableresourceid_value?: string;
  _msdyn_projectteamid_value?: string;
  msdyn_start?: string;
  msdyn_finish?: string;
  msdyn_effort?: number;
  /** JSON array of PlannedWorkSlice */
  msdyn_plannedwork?: string;
}

export interface SourceBucket {
  msdyn_projectbucketid: string;
  msdyn_name: string;
  _msdyn_project_value: string;
}

export interface SourceSprint {
  msdyn_projectsprintid: string;
  msdyn_name: string;
  _msdyn_project_value: string;
  msdyn_start?: string;
  msdyn_finish?: string;
}

export interface SourceProjectData {
  project: SourceProject;
  tasks: SourceTask[];
  teamMembers: SourceTeamMember[];
  dependencies: SourceDependency[];
  assignments: SourceAssignment[];
  buckets: SourceBucket[];
  sprints: SourceSprint[];
  /** Rows of related tables (risks, issues, status reports...) keyed by entity logical name */
  related: Record<string, Record<string, unknown>[]>;
}

export interface EntityCounts {
  tasks: number;
  teamMembers: number;
  dependencies: number;
  assignments: number;
  buckets: number;
  sprints: number;
}

// =====================================================
// Environments
// =====================================================

export interface OrganizationInfo {
  friendlyName: string;
  uniqueName: string;
  urlName: string;
  environmentId?: string;
  version?: string;
  projectOperationsVersion?: string;
  userId: string;
  userName?: string;
}

// =====================================================
// Target calendar templates (msdyn_workhourtemplate)
// =====================================================

export type WorkHourTemplateStatus = 'valid' | 'missing-calendar' | 'no-work-hours' | 'unknown';

export interface WorkHourTemplateInfo {
  id: string;
  name: string;
  calendarId?: string;
  templateResourceId?: string;
  isDefault: boolean;
  status: WorkHourTemplateStatus;
  statusDetail?: string;
}

export interface WorkHourTemplateCheck {
  templates: WorkHourTemplateInfo[];
  defaultTemplateId?: string;
}

// =====================================================
// Project matching (source project -> existing target project)
// =====================================================

export interface ProjectKeyRule {
  /** Logical name of the source msdyn_project field holding the key (e.g. an "Oracle Project Number" column) */
  sourceField: string;
  /** Logical name of the target msdyn_project field holding the same value (e.g. msdyn_projectnumber = "Project ID") */
  targetField: string;
  /** When the key is empty or not found, try an exact (case-insensitive) project name match */
  fallbackToName: boolean;
}

export type ProjectMatchStatus = 'matched' | 'matched-by-name' | 'not-found' | 'ambiguous' | 'no-key';

export interface TargetProjectRef {
  id: string;
  name: string;
  key?: string;
}

export interface ProjectMatch {
  sourceProjectId: string;
  sourceName: string;
  sourceKey?: string;
  status: ProjectMatchStatus;
  target?: TargetProjectRef;
  candidates?: TargetProjectRef[];
}

export interface FieldOption {
  logicalName: string;
  displayName: string;
  isCustom: boolean;
}

// =====================================================
// Bookable resources and roles
// =====================================================

/** bookableresource.resourcetype option values */
export const RESOURCE_TYPE = {
  Generic: 1,
  Contact: 2,
  User: 3,
  Equipment: 4,
  Account: 5,
  Crew: 6,
  Facility: 7,
  Pool: 8,
} as const;

export interface ResourceInfo {
  id: string;
  name: string;
  resourceType: number;
  active: boolean;
  calendarId?: string;
  userId?: string;
  contactId?: string;
  /** Entra object ID of the linked user (stable across environments in the same tenant) */
  aadObjectId?: string;
  email?: string;
}

export type ResourceMatchMethod = 'same-id' | 'entra-user' | 'email' | 'name' | 'manual' | 'generic' | 'none';

export type ResourceIssueCode =
  | 'not-found'
  | 'user-without-resource'
  | 'inactive'
  | 'no-calendar'
  | 'role-missing'
  | 'ambiguous'
  | 'no-source-resource';

export interface ResourceIssue {
  code: ResourceIssueCode;
  severity: 'error' | 'warning';
  message: string;
  fix?: string;
}

export interface RoleInfo {
  id: string;
  name: string;
}

/** How one source team member will be brought into the target project */
export interface TeamMemberPlan {
  sourceTeamMemberId: string;
  displayName: string;
  source?: ResourceInfo;
  target?: ResourceInfo;
  method: ResourceMatchMethod;
  sourceRole?: RoleInfo;
  targetRole?: RoleInfo;
  issues: ResourceIssue[];
  /** reuse = already on the target project; create = new team member; generic = fall back to a generic member; skip = not migrated */
  action: 'reuse' | 'create' | 'generic' | 'skip';
  existingTargetTeamMemberId?: string;
  assignmentCount: number;
  plannedHours: number;
}

// =====================================================
// Related records (RAID log, status reports, custom tables)
// =====================================================

export interface RelatedTableInfo {
  logicalName: string;
  entitySetName: string;
  displayName: string;
  primaryIdAttribute: string;
  primaryNameAttribute: string;
  /** Lookup attribute on the related table that points to msdyn_project */
  projectLookup: string;
  /** Navigation property for the project lookup (case-sensitive, used in @odata.bind) */
  projectNavigation?: string;
  existsInTarget: boolean;
  sourceCount: number;
  isCustom: boolean;
}

// =====================================================
// Readiness (pre-flight) checks
// =====================================================

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface ReadinessCheck {
  id: string;
  area: 'environment' | 'project' | 'resources' | 'calendar' | 'data';
  title: string;
  status: CheckStatus;
  detail?: string;
  fix?: string;
  projectId?: string;
}

export interface TargetProjectState {
  projectId: string;
  tasks: { id: string; subject: string; parentId?: string; pathKey: string }[];
  teamMembers: { id: string; name?: string; resourceId?: string; roleId?: string }[];
  buckets: { id: string; name: string }[];
  assignments: { id: string; taskId: string; teamMemberId?: string }[];
  dependencies: { predecessorId: string; successorId: string }[];
}

export interface ProjectPlan {
  sourceProjectId: string;
  sourceName: string;
  match: ProjectMatch;
  /** Project will be created in the target (only in "create missing" mode) */
  willCreate: boolean;
  teamPlan: TeamMemberPlan[];
  targetState?: TargetProjectState;
  tasksToCreate: number;
  tasksAlreadyInTarget: number;
  assignmentsToCreate: number;
  relatedCounts: Record<string, number>;
  checks: ReadinessCheck[];
}

// =====================================================
// Dependency link types (msdyn_projecttaskdependency.msdyn_linktype)
// =====================================================

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export const LINK_TYPE_MAP: Record<number, DependencyType> = {
  192350000: 'FS',
  192350001: 'SS',
  192350002: 'FF',
  192350004: 'SF',
};

// =====================================================
// ID mapping
// =====================================================

export type EntityType =
  | 'project'
  | 'task'
  | 'teamMember'
  | 'dependency'
  | 'assignment'
  | 'bucket'
  | 'sprint'
  | 'related';

export interface IdMapping {
  entityType: EntityType;
  sourceId: string;
  targetId: string;
  sourceName?: string;
  /** created = new record, existing = matched to a record already in the target */
  origin: 'created' | 'existing';
}

export interface IdMappingTable {
  projectId: string;
  projectName: string;
  targetProjectId?: string;
  mappings: IdMapping[];
  createdAt: string;
}

// =====================================================
// Reconciliation (source vs target after migration)
// =====================================================

export type ReconcileStatus = 'match' | 'differs' | 'missing';

export interface TaskReconciliation {
  path: string;
  status: ReconcileStatus;
  source: { start?: string; end?: string; effort?: number };
  target?: { start?: string; end?: string; effort?: number };
  differences: string[];
}

export interface AssignmentReconciliation {
  task: string;
  resource: string;
  status: ReconcileStatus;
  sourceHours: number;
  targetHours?: number;
}

export interface ProjectReconciliation {
  sourceProjectId: string;
  sourceName: string;
  targetProjectId: string;
  targetName?: string;
  tasks: TaskReconciliation[];
  assignments: AssignmentReconciliation[];
  related: { table: string; displayName: string; source: number; target: number }[];
  summary: {
    tasksMatched: number;
    tasksDiffer: number;
    tasksMissing: number;
    assignmentsMatched: number;
    assignmentsDiffer: number;
    assignmentsMissing: number;
    sourceHours: number;
    targetHours: number;
  };
}
