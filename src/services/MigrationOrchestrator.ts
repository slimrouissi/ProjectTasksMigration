/**
 * Migration Orchestrator — coordinates the full migration workflow
 * Loads source data → validates → migrates each project → reports results
 */

import { SourceService } from './SourceService';
import { TargetService, StageCallback } from './TargetService';
import { ValidationService } from './ValidationService';
import { IdMappingService } from './IdMappingService';
import { SourceProjectData, IdMappingTable, ServiceResult } from '../types/migration';
import {
  MigrationConfig,
  MigrationProgress,
  MigrationResult,
  ProjectMigrationResult,
  MigrationLogEntry,
  MigrationError,
  MigrationStage,
  MigratedEntityCounts,
  ValidationResult,
} from '../types/ui';

export class MigrationOrchestrator {
  private sourceService: SourceService;
  private targetService: TargetService;
  private validationService: ValidationService;

  constructor(
    sourceService: SourceService,
    targetService: TargetService,
    validationService: ValidationService
  ) {
    this.sourceService = sourceService;
    this.targetService = targetService;
    this.validationService = validationService;
  }

  /**
   * Validate a set of project data before migration
   */
  validateProjects(projectDataMap: Map<string, SourceProjectData>): Map<string, ValidationResult> {
    console.log(`MigrationOrchestrator: Validating ${projectDataMap.size} projects`);
    const results = new Map<string, ValidationResult>();

    for (const [projectId, data] of projectDataMap) {
      results.set(projectId, this.validationService.validate(data));
    }

    return results;
  }

  /**
   * Execute migration for all selected projects
   */
  async executeMigration(
    projectDataMap: Map<string, SourceProjectData>,
    config: MigrationConfig,
    onProgress: (progress: MigrationProgress) => void
  ): Promise<MigrationResult> {
    const startTime = Date.now();
    const projects = Array.from(projectDataMap.values());
    const projectResults: ProjectMigrationResult[] = [];
    const idMappings: IdMappingTable[] = [];
    const logs: MigrationLogEntry[] = [];
    const errors: MigrationError[] = [];

    console.log(`MigrationOrchestrator: Starting migration of ${projects.length} projects`);
    console.time('MigrationOrchestrator.executeMigration');

    for (let i = 0; i < projects.length; i++) {
      const data = projects[i];
      const projectName = data.project.msdyn_subject;
      const projectStartTime = Date.now();

      const addLog = (stage: MigrationStage, message: string, level: MigrationLogEntry['level'] = 'info') => {
        const entry: MigrationLogEntry = {
          timestamp: new Date().toISOString(),
          stage,
          message,
          level,
        };
        logs.push(entry);
      };

      const addError = (stage: MigrationStage, message: string, details?: string) => {
        const err: MigrationError = {
          timestamp: new Date().toISOString(),
          stage,
          projectName,
          message,
          details,
        };
        errors.push(err);
      };

      addLog('idle', `Starting migration of project "${projectName}" (${i + 1}/${projects.length})`, 'info');

      // Report progress
      const reportProgress = (stage: MigrationStage, message: string, stageProgress?: number) => {
        addLog(stage, message);
        onProgress({
          stage,
          currentProject: projectName,
          currentProjectIndex: i,
          totalProjects: projects.length,
          stageProgress: stageProgress || 0,
          overallProgress: Math.round(((i + (stageProgress || 0) / 100) / projects.length) * 100),
          logs: [...logs],
          errors: [...errors],
        });
      };

      // Stage callback for TargetService
      const stageCallback: StageCallback = (stage, message, progress) => {
        if (stage === 'failed') {
          addError(stage, message);
          addLog(stage, message, 'error');
        } else if (stage === 'completed') {
          addLog(stage, message, 'success');
        }
        reportProgress(stage, message, progress);
      };

      try {
        const result = await this.targetService.migrateProject(data, config, stageCallback);

        if (result.success && result.data) {
          const mappingTable = result.data.toMappingTable();
          idMappings.push(mappingTable);

          projectResults.push({
            sourceProjectId: data.project.msdyn_projectid,
            sourceProjectName: projectName,
            targetProjectId: result.data.getTargetId(data.project.msdyn_projectid),
            success: true,
            entityCounts: this.countEntities(data, mappingTable),
            errors: [],
            duration: Date.now() - projectStartTime,
          });
        } else {
          addError('failed', result.error || 'Unknown error during migration');
          projectResults.push({
            sourceProjectId: data.project.msdyn_projectid,
            sourceProjectName: projectName,
            success: false,
            entityCounts: this.emptyEntityCounts(),
            errors: errors.filter(e => e.projectName === projectName),
            duration: Date.now() - projectStartTime,
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        addError('failed', errorMsg);
        console.error(`MigrationOrchestrator: Project "${projectName}" failed`, error);

        projectResults.push({
          sourceProjectId: data.project.msdyn_projectid,
          sourceProjectName: projectName,
          success: false,
          entityCounts: this.emptyEntityCounts(),
          errors: errors.filter(e => e.projectName === projectName),
          duration: Date.now() - projectStartTime,
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    const successCount = projectResults.filter(r => r.success).length;

    console.log(`MigrationOrchestrator: Migration complete. ${successCount}/${projects.length} projects succeeded in ${totalDuration}ms`);
    console.timeEnd('MigrationOrchestrator.executeMigration');

    // Final progress update
    onProgress({
      stage: 'completed',
      currentProjectIndex: projects.length,
      totalProjects: projects.length,
      stageProgress: 100,
      overallProgress: 100,
      logs,
      errors,
    });

    return {
      success: successCount === projects.length,
      projectResults,
      totalDuration,
      idMappings,
    };
  }

  private countEntities(data: SourceProjectData, mappingTable: IdMappingTable): MigratedEntityCounts {
    const countForType = (type: string) => {
      const mapped = mappingTable.mappings.filter(m => m.entityType === type).length;
      return { attempted: mapped, succeeded: mapped };
    };

    return {
      projects: { attempted: 1, succeeded: 1 },
      teamMembers: countForType('teamMember'),
      buckets: countForType('bucket'),
      tasks: countForType('task'),
      dependencies: countForType('dependency'),
      assignments: countForType('assignment'),
      sprints: countForType('sprint'),
    };
  }

  private emptyEntityCounts(): MigratedEntityCounts {
    const zero = { attempted: 0, succeeded: 0 };
    return {
      projects: zero,
      teamMembers: zero,
      buckets: zero,
      tasks: zero,
      dependencies: zero,
      assignments: zero,
      sprints: zero,
    };
  }
}
