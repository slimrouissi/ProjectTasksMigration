/**
 * Hook for executing migration with progress tracking
 */

import { useState, useCallback, useRef } from 'react';
import { MigrationOrchestrator } from '../services/MigrationOrchestrator';
import { SourceService } from '../services/SourceService';
import { TargetService } from '../services/TargetService';
import { ValidationService } from '../services/ValidationService';
import { SourceProjectData } from '../types/migration';
import {
  MigrationConfig,
  MigrationProgress,
  MigrationResult,
  ValidationResult,
} from '../types/ui';

export interface UseMigrationReturn {
  progress: MigrationProgress | null;
  result: MigrationResult | null;
  validationResults: Map<string, ValidationResult>;
  isRunning: boolean;
  validate: (projectData: Map<string, SourceProjectData>) => Map<string, ValidationResult>;
  execute: (
    projectData: Map<string, SourceProjectData>,
    config: MigrationConfig
  ) => Promise<MigrationResult>;
  reset: () => void;
  exportIdMappings: () => void;
}

export function useMigration(
  sourceService: SourceService | null,
  targetService: TargetService | null
): UseMigrationReturn {
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [validationResults, setValidationResults] = useState<Map<string, ValidationResult>>(new Map());
  const [isRunning, setIsRunning] = useState(false);

  const validationService = useRef(new ValidationService());

  const validate = useCallback(
    (projectData: Map<string, SourceProjectData>): Map<string, ValidationResult> => {
      if (!sourceService) {
        console.error('useMigration: sourceService not available');
        return new Map();
      }

      const orchestrator = new MigrationOrchestrator(
        sourceService,
        targetService!,
        validationService.current
      );

      const results = orchestrator.validateProjects(projectData);
      setValidationResults(results);
      return results;
    },
    [sourceService, targetService]
  );

  const execute = useCallback(
    async (
      projectData: Map<string, SourceProjectData>,
      config: MigrationConfig
    ): Promise<MigrationResult> => {
      if (!sourceService || !targetService) {
        throw new Error('Services not initialized. Check environment connections.');
      }

      setIsRunning(true);
      setResult(null);
      setProgress({
        stage: 'idle',
        currentProjectIndex: 0,
        totalProjects: projectData.size,
        stageProgress: 0,
        overallProgress: 0,
        logs: [],
        errors: [],
      });

      const orchestrator = new MigrationOrchestrator(
        sourceService,
        targetService,
        validationService.current
      );

      try {
        const migrationResult = await orchestrator.executeMigration(
          projectData,
          config,
          setProgress
        );
        setResult(migrationResult);
        setIsRunning(false);
        return migrationResult;
      } catch (error) {
        setIsRunning(false);
        throw error;
      }
    },
    [sourceService, targetService]
  );

  const reset = useCallback(() => {
    setProgress(null);
    setResult(null);
    setValidationResults(new Map());
    setIsRunning(false);
  }, []);

  const exportIdMappings = useCallback(() => {
    if (!result?.idMappings.length) return;

    const json = JSON.stringify(result.idMappings, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `migration-id-mappings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return {
    progress,
    result,
    validationResults,
    isRunning,
    validate,
    execute,
    reset,
    exportIdMappings,
  };
}
