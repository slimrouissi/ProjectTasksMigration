/**
 * UI and run configuration types
 */

import type { IdMappingTable, ProjectKeyRule, ProjectReconciliation, ReadinessCheck } from './migration';

export type WizardStep = 'projects' | 'options' | 'readiness' | 'run';

export const WIZARD_STEPS: WizardStep[] = ['projects', 'options', 'readiness', 'run'];

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  projects: 'Projects',
  options: 'Options',
  readiness: 'Readiness check',
  run: 'Run & reconcile',
};

export const WIZARD_STEP_HINTS: Record<WizardStep, string> = {
  projects: 'What to migrate, and where it goes',
  options: 'What to copy and how to handle gaps',
  readiness: 'Matches, resources and data, checked before anything is written',
  run: 'Migrate, then compare source and target',
};

// =====================================================
// Run configuration
// =====================================================

/** existing = add tasks/assignments into project shells that already exist in the target; create = create new projects */
export type ProjectMode = 'existing' | 'create';
export type DateStrategy = 'keep' | 'shift';

export interface MigrationConfig {
  mode: ProjectMode;
  /** existing mode: create a project when no shell is found (otherwise the project is skipped) */
  createMissing: boolean;
  keyRule: ProjectKeyRule;
  /** Manual project pairing chosen in the readiness step (source project ID → target project ID) */
  manualMatches: Record<string, string>;
  /** Names for created projects */
  naming: 'keep' | 'prefix';
  namePrefix: string;
  dateHandling: DateStrategy;
  /** Calendar template for created projects (unset = target default) */
  workHourTemplateId?: string;
  workHourTemplateName?: string;
  /** Team members whose resource can't be used: add a generic team member with the same role, or leave them out */
  unresolvedResources: 'generic' | 'skip';
  fallbackRoleId?: string;
  resourceOverrides: Record<string, string>;
  roleOverrides: Record<string, string>;
  copyAllocations: boolean;
  /** Also reset planned hours on assignments that were already in the target (e.g. after an interrupted run) */
  reapplyAllocations: boolean;
  copyCustomTaskFields: boolean;
  /** Logical names of related tables to copy (risks, issues, status reports, custom tables) */
  relatedTables: string[];
}

export const DEFAULT_MIGRATION_CONFIG: MigrationConfig = {
  mode: 'existing',
  createMissing: false,
  keyRule: { sourceField: 'msdyn_projectnumber', targetField: 'msdyn_projectnumber', fallbackToName: true },
  manualMatches: {},
  naming: 'keep',
  namePrefix: '[Migrated] ',
  dateHandling: 'keep',
  unresolvedResources: 'generic',
  resourceOverrides: {},
  roleOverrides: {},
  copyAllocations: true,
  reapplyAllocations: false,
  copyCustomTaskFields: false,
  relatedTables: [],
};

// =====================================================
// Run progress and results
// =====================================================

export type MigrationStage =
  | 'idle'
  | 'project'
  | 'team'
  | 'buckets'
  | 'tasks'
  | 'dependencies'
  | 'assignments'
  | 'allocations'
  | 'related'
  | 'reconcile'
  | 'completed'
  | 'failed';

export const MIGRATION_STAGE_LABELS: Record<MigrationStage, string> = {
  idle: 'Waiting',
  project: 'Project',
  team: 'Team members',
  buckets: 'Buckets',
  tasks: 'Tasks',
  dependencies: 'Dependencies',
  assignments: 'Assignments',
  allocations: 'Allocations',
  related: 'Related records',
  reconcile: 'Reconciliation',
  completed: 'Completed',
  failed: 'Failed',
};

export interface MigrationLogEntry {
  timestamp: string;
  project?: string;
  stage: MigrationStage;
  message: string;
  level: 'info' | 'warn' | 'error' | 'success';
}

export interface StageCount {
  created: number;
  existing: number;
  skipped: number;
  failed: number;
}

export type StageKey = 'teamMembers' | 'buckets' | 'tasks' | 'dependencies' | 'assignments' | 'allocations' | 'related';

export type StageCounts = Record<StageKey, StageCount>;

export const STAGE_COUNT_LABELS: Record<StageKey, string> = {
  teamMembers: 'Team members',
  buckets: 'Buckets',
  tasks: 'Tasks',
  dependencies: 'Dependencies',
  assignments: 'Assignments',
  allocations: 'Allocations',
  related: 'Related records',
};

export const emptyStageCounts = (): StageCounts => ({
  teamMembers: { created: 0, existing: 0, skipped: 0, failed: 0 },
  buckets: { created: 0, existing: 0, skipped: 0, failed: 0 },
  tasks: { created: 0, existing: 0, skipped: 0, failed: 0 },
  dependencies: { created: 0, existing: 0, skipped: 0, failed: 0 },
  assignments: { created: 0, existing: 0, skipped: 0, failed: 0 },
  allocations: { created: 0, existing: 0, skipped: 0, failed: 0 },
  related: { created: 0, existing: 0, skipped: 0, failed: 0 },
});

export interface ProjectRunResult {
  sourceProjectId: string;
  sourceName: string;
  targetProjectId?: string;
  targetName?: string;
  projectCreated: boolean;
  status: 'succeeded' | 'partial' | 'failed' | 'skipped';
  counts: StageCounts;
  errors: string[];
  warnings: string[];
  durationMs: number;
  idMappings?: IdMappingTable;
  reconciliation?: ProjectReconciliation;
}

export interface MigrationProgress {
  stage: MigrationStage;
  currentProject?: string;
  currentProjectIndex: number;
  totalProjects: number;
  overallProgress: number;
  logs: MigrationLogEntry[];
  results: ProjectRunResult[];
}

export interface MigrationResult {
  success: boolean;
  projectResults: ProjectRunResult[];
  totalDuration: number;
  startedAt: string;
  finishedAt: string;
}

// =====================================================
// Environment status (header)
// =====================================================

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface EnvironmentStatus {
  role: 'source' | 'target';
  url: string;
  status: ConnectionStatus;
  friendlyName?: string;
  userId?: string;
  userName?: string;
  projectOperationsVersion?: string;
  environmentId?: string;
  error?: string;
}

// =====================================================
// Validation (source data)
// =====================================================

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: ValidationSeverity;
  message: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
}

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
}

export type { ReadinessCheck };
