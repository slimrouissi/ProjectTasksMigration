/**
 * TypeScript interfaces for UI state management
 * Covers wizard steps, migration progress, and configuration options
 */

import { SourceProjectData, EntityCounts, IdMappingTable } from './migration';

// =====================================================
// Wizard State
// =====================================================

export type WizardStep = 'select' | 'preview' | 'config' | 'execute';

export const WIZARD_STEPS: WizardStep[] = ['select', 'preview', 'config', 'execute'];

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  select: 'Select Projects',
  preview: 'Preview & Validate',
  config: 'Configure Options',
  execute: 'Execute Migration',
};

export interface WizardState {
  currentStep: WizardStep;
  selectedProjectIds: string[];
  projectData: Map<string, SourceProjectData>;
  config: MigrationConfig;
  isLoading: boolean;
  error?: string;
}

// =====================================================
// Migration Configuration (Step 3)
// =====================================================

export type NamingStrategy = 'keep' | 'prefix' | 'custom';
export type DateStrategy = 'keep' | 'shift';
export type TeamMemberStrategy = 'generic' | 'match' | 'skip';
export type ConflictStrategy = 'skip' | 'duplicate';

export interface MigrationConfig {
  naming: NamingStrategy;
  namePrefix?: string;             // Used when naming = 'prefix'
  customNames?: Map<string, string>; // Used when naming = 'custom' (projectId → name)
  dateHandling: DateStrategy;
  teamMembers: TeamMemberStrategy;
  conflictHandling: ConflictStrategy;
}

export const DEFAULT_MIGRATION_CONFIG: MigrationConfig = {
  naming: 'keep',
  namePrefix: '[Migrated] ',
  dateHandling: 'keep',
  teamMembers: 'generic',
  conflictHandling: 'skip',
};

// =====================================================
// Migration Execution State (Step 4)
// =====================================================

export type MigrationStage =
  | 'idle'
  | 'creating-project'
  | 'creating-team'
  | 'creating-buckets'
  | 'creating-tasks'
  | 'creating-dependencies'
  | 'creating-assignments'
  | 'creating-sprints'
  | 'completed'
  | 'failed';

export const MIGRATION_STAGE_LABELS: Record<MigrationStage, string> = {
  idle: 'Waiting to start',
  'creating-project': 'Creating project',
  'creating-team': 'Creating team members',
  'creating-buckets': 'Creating buckets',
  'creating-tasks': 'Creating tasks',
  'creating-dependencies': 'Creating dependencies',
  'creating-assignments': 'Creating assignments',
  'creating-sprints': 'Creating sprints',
  completed: 'Migration completed',
  failed: 'Migration failed',
};

export interface MigrationProgress {
  stage: MigrationStage;
  currentProject?: string;         // Name of project being migrated
  currentProjectIndex: number;     // 0-based index
  totalProjects: number;
  stageProgress: number;           // 0-100 for current stage
  overallProgress: number;         // 0-100 across all projects
  logs: MigrationLogEntry[];
  errors: MigrationError[];
}

export interface MigrationLogEntry {
  timestamp: string;               // ISO date
  stage: MigrationStage;
  message: string;
  level: 'info' | 'warn' | 'error' | 'success';
  entityType?: string;
  entityName?: string;
  operationSetId?: string;
}

export interface MigrationError {
  timestamp: string;
  stage: MigrationStage;
  projectName: string;
  entityType?: string;
  entityName?: string;
  sourceId?: string;
  message: string;
  details?: string;
}

// =====================================================
// Migration Result
// =====================================================

export interface MigrationResult {
  success: boolean;
  projectResults: ProjectMigrationResult[];
  totalDuration: number;           // Milliseconds
  idMappings: IdMappingTable[];
}

export interface ProjectMigrationResult {
  sourceProjectId: string;
  sourceProjectName: string;
  targetProjectId?: string;
  success: boolean;
  entityCounts: MigratedEntityCounts;
  errors: MigrationError[];
  duration: number;                // Milliseconds
}

export interface MigratedEntityCounts {
  projects: { attempted: number; succeeded: number };
  teamMembers: { attempted: number; succeeded: number };
  buckets: { attempted: number; succeeded: number };
  tasks: { attempted: number; succeeded: number };
  dependencies: { attempted: number; succeeded: number };
  assignments: { attempted: number; succeeded: number };
  sprints: { attempted: number; succeeded: number };
}

// =====================================================
// Environment Status
// =====================================================

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface EnvironmentStatus {
  name: string;
  url: string;
  status: ConnectionStatus;
  userId?: string;
  userName?: string;
  error?: string;
}

// =====================================================
// Validation
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

// =====================================================
// Project List Item (Step 1 display)
// =====================================================

export interface ProjectListItem {
  id: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  progress?: number;
  entityCounts?: EntityCounts;
  isSelected: boolean;
  isLoadingCounts: boolean;
}
