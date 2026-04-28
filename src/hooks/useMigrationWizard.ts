/**
 * Hook for managing the 4-step migration wizard state
 */

import { useState, useCallback } from 'react';
import { SourceProjectData, SourceProject } from '../types/migration';
import {
  WizardStep,
  WizardState,
  WIZARD_STEPS,
  MigrationConfig,
  DEFAULT_MIGRATION_CONFIG,
} from '../types/ui';

export interface UseMigrationWizardReturn {
  state: WizardState;
  currentStepIndex: number;
  canGoNext: boolean;
  canGoPrev: boolean;
  goNext: () => void;
  goPrev: () => void;
  goToStep: (step: WizardStep) => void;
  selectProject: (projectId: string) => void;
  deselectProject: (projectId: string) => void;
  toggleProject: (projectId: string) => void;
  setProjectData: (projectId: string, data: SourceProjectData) => void;
  setConfig: (config: Partial<MigrationConfig>) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error?: string) => void;
  reset: () => void;
}

const initialState: WizardState = {
  currentStep: 'select',
  selectedProjectIds: [],
  projectData: new Map(),
  config: { ...DEFAULT_MIGRATION_CONFIG },
  isLoading: false,
};

export function useMigrationWizard(): UseMigrationWizardReturn {
  const [state, setState] = useState<WizardState>(initialState);

  const currentStepIndex = WIZARD_STEPS.indexOf(state.currentStep);

  const canGoNext = currentStepIndex < WIZARD_STEPS.length - 1 && !state.isLoading;
  const canGoPrev = currentStepIndex > 0 && !state.isLoading;

  const goNext = useCallback(() => {
    setState(prev => {
      const idx = WIZARD_STEPS.indexOf(prev.currentStep);
      if (idx < WIZARD_STEPS.length - 1) {
        return { ...prev, currentStep: WIZARD_STEPS[idx + 1], error: undefined };
      }
      return prev;
    });
  }, []);

  const goPrev = useCallback(() => {
    setState(prev => {
      const idx = WIZARD_STEPS.indexOf(prev.currentStep);
      if (idx > 0) {
        return { ...prev, currentStep: WIZARD_STEPS[idx - 1], error: undefined };
      }
      return prev;
    });
  }, []);

  const goToStep = useCallback((step: WizardStep) => {
    setState(prev => ({ ...prev, currentStep: step, error: undefined }));
  }, []);

  const selectProject = useCallback((projectId: string) => {
    setState(prev => ({
      ...prev,
      selectedProjectIds: prev.selectedProjectIds.includes(projectId)
        ? prev.selectedProjectIds
        : [...prev.selectedProjectIds, projectId],
    }));
  }, []);

  const deselectProject = useCallback((projectId: string) => {
    setState(prev => ({
      ...prev,
      selectedProjectIds: prev.selectedProjectIds.filter(id => id !== projectId),
    }));
  }, []);

  const toggleProject = useCallback((projectId: string) => {
    setState(prev => ({
      ...prev,
      selectedProjectIds: prev.selectedProjectIds.includes(projectId)
        ? prev.selectedProjectIds.filter(id => id !== projectId)
        : [...prev.selectedProjectIds, projectId],
    }));
  }, []);

  const setProjectData = useCallback((projectId: string, data: SourceProjectData) => {
    setState(prev => {
      const newMap = new Map(prev.projectData);
      newMap.set(projectId, data);
      return { ...prev, projectData: newMap };
    });
  }, []);

  const setConfig = useCallback((config: Partial<MigrationConfig>) => {
    setState(prev => ({
      ...prev,
      config: { ...prev.config, ...config },
    }));
  }, []);

  const setLoading = useCallback((isLoading: boolean) => {
    setState(prev => ({ ...prev, isLoading }));
  }, []);

  const setError = useCallback((error?: string) => {
    setState(prev => ({ ...prev, error }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    state,
    currentStepIndex,
    canGoNext,
    canGoPrev,
    goNext,
    goPrev,
    goToStep,
    selectProject,
    deselectProject,
    toggleProject,
    setProjectData,
    setConfig,
    setLoading,
    setError,
    reset,
  };
}
