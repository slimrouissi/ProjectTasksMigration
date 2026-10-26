/**
 * Application state: wizard step, project selection, settings, readiness (planning) and run.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UseEnvironmentsReturn } from './useEnvironments';
import type { PlanningResult } from '../services/MigrationPlanner';
import { buildDiagnostics, DiagnosticsReport } from '../services/DiagnosticsService';
import type { FieldOption, RelatedTableInfo, SourceProject, WorkHourTemplateCheck } from '../types/migration';
import {
  DEFAULT_MIGRATION_CONFIG,
  MigrationConfig,
  MigrationProgress,
  MigrationResult,
  WizardStep,
  WIZARD_STEPS,
} from '../types/ui';

const STORAGE_KEY = 'ptm.settings.v2';

/** Settings that are worth remembering between sessions (not the per-run choices) */
function loadSavedConfig(): MigrationConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      ...DEFAULT_MIGRATION_CONFIG,
      ...(saved.mode ? { mode: saved.mode } : {}),
      ...(saved.keyRule ? { keyRule: { ...DEFAULT_MIGRATION_CONFIG.keyRule, ...saved.keyRule } } : {}),
      ...(saved.unresolvedResources ? { unresolvedResources: saved.unresolvedResources } : {}),
      ...(saved.fallbackRoleId ? { fallbackRoleId: saved.fallbackRoleId } : {}),
    };
  } catch {
    return { ...DEFAULT_MIGRATION_CONFIG };
  }
}

/** Fields that change what the readiness check finds */
function planningKey(config: MigrationConfig, selected: string[]): string {
  return JSON.stringify([
    selected.slice().sort(),
    config.mode, config.createMissing, config.keyRule, config.manualMatches, config.unresolvedResources,
    config.fallbackRoleId, config.resourceOverrides, config.roleOverrides, config.relatedTables, config.copyCustomTaskFields,
    config.workHourTemplateId,
  ]);
}

export function useMigrationApp(env: UseEnvironmentsReturn) {
  const [step, setStep] = useState<WizardStep>('projects');
  const [config, setConfig] = useState<MigrationConfig>(loadSavedConfig);

  // Projects
  const [projects, setProjects] = useState<SourceProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [keyFields, setKeyFields] = useState<{ source: FieldOption[]; target: FieldOption[] }>({ source: [], target: [] });

  // Options
  const [relatedTables, setRelatedTables] = useState<RelatedTableInfo[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const relatedFor = useRef('');
  const relatedTouched = useRef(false);
  const [templateCheck, setTemplateCheck] = useState<WorkHourTemplateCheck>();
  const [targetRoles, setTargetRoles] = useState<{ id: string; name: string }[]>([]);

  // Readiness
  const [planning, setPlanning] = useState<PlanningResult | null>(null);
  const [planningKeyUsed, setPlanningKeyUsed] = useState('');
  const [planningBusy, setPlanningBusy] = useState(false);
  const [planningMessage, setPlanningMessage] = useState('');
  const [planningError, setPlanningError] = useState<string>();

  // Run
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [running, setRunning] = useState(false);
  const stopRequested = useRef(false);

  const updateConfig = useCallback((partial: Partial<MigrationConfig>) => {
    setConfig(prev => {
      const next = { ...prev, ...partial };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: next.mode, keyRule: next.keyRule, unresolvedResources: next.unresolvedResources, fallbackRoleId: next.fallbackRoleId }));
      return next;
    });
  }, []);

  const loadProjects = useCallback(async () => {
    if (!env.planner) return;
    setProjectsLoading(true);
    setProjectsError(undefined);
    const keyField = config.keyRule.sourceField;
    const r = await env.planner.sourceService.getProjects(keyField);
    if (r.success) {
      setProjects(r.data || []);
    } else {
      setProjectsError(r.error);
      // fall back to the standard key so the list still loads
      if (keyField !== 'msdyn_projectnumber') {
        const fallback = await env.planner.sourceService.getProjects('msdyn_projectnumber');
        if (fallback.success) setProjects(fallback.data || []);
      }
    }
    setProjectsLoading(false);
  }, [env.planner, config.keyRule.sourceField]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!env.planner) return;
    Promise.all([env.planner.sourceMeta.getProjectKeyFields(), env.planner.targetMeta.getProjectKeyFields()]).then(([s, t]) => {
      setKeyFields({ source: s.data || [], target: t.data || [] });
    });
    env.planner.target.query<{ bookableresourcecategoryid: string; name: string }>('bookableresourcecategories', { select: ['bookableresourcecategoryid', 'name'], filter: 'statecode eq 0', orderBy: 'name asc' })
      .then(r => setTargetRoles((r.data || []).map(x => ({ id: x.bookableresourcecategoryid, name: x.name }))));
  }, [env.planner]);

  const loadRelatedTables = useCallback(async (force = false) => {
    if (!env.planner || !selectedIds.length) return;
    const key = selectedIds.slice().sort().join(',');
    if (!force && relatedFor.current === key) return;
    relatedFor.current = key;
    setRelatedLoading(true);
    const r = await env.planner.discoverRelatedTables(selectedIds);
    const tables = r.data || [];
    setRelatedTables(tables);
    setRelatedLoading(false);
    if (!relatedTouched.current) {
      // Default: copy every related table that has rows and exists in the target
      setConfig(prev => ({ ...prev, relatedTables: tables.filter(t => t.existsInTarget && t.sourceCount > 0).map(t => t.logicalName) }));
    }
  }, [env.planner, selectedIds]);

  const setRelatedSelection = useCallback((names: string[]) => {
    relatedTouched.current = true;
    updateConfig({ relatedTables: names });
  }, [updateConfig]);

  const loadTemplates = useCallback(async () => {
    if (!env.calendars) return;
    const r = await env.calendars.getWorkHourTemplates();
    setTemplateCheck(r.data);
    if (r.data && !config.workHourTemplateId) {
      const preferred = r.data.templates.find(t => t.isDefault && (t.status === 'valid' || t.status === 'unknown')) || r.data.templates.find(t => t.status === 'valid');
      if (preferred) updateConfig({ workHourTemplateId: preferred.id, workHourTemplateName: preferred.name });
    }
  }, [env.calendars, config.workHourTemplateId, updateConfig]);

  const selectedProjects = useMemo(() => projects.filter(p => selectedIds.includes(p.msdyn_projectid)), [projects, selectedIds]);
  const currentPlanningKey = planningKey(config, selectedIds);
  const planningStale = !planning || planningKeyUsed !== currentPlanningKey;

  const runPlanning = useCallback(async () => {
    if (!env.planner || !env.sourceInfo || !env.targetInfo || !selectedProjects.length) return;
    setPlanningBusy(true);
    setPlanningError(undefined);
    const key = planningKey(config, selectedIds);
    const r = await env.planner.plan(selectedProjects, config, { source: env.sourceInfo, target: env.targetInfo }, setPlanningMessage);
    if (r.success && r.data) {
      setPlanning(r.data);
      setPlanningKeyUsed(key);
    } else {
      setPlanningError(r.error);
    }
    setPlanningBusy(false);
    setPlanningMessage('');
  }, [env.planner, env.sourceInfo, env.targetInfo, selectedProjects, selectedIds, config]);

  const startRun = useCallback(async (projectIds: string[]) => {
    if (!env.engine || !planning) return;
    stopRequested.current = false;
    setRunning(true);
    setResult(null);
    setProgress({ stage: 'idle', currentProjectIndex: 0, totalProjects: projectIds.length, overallProgress: 0, logs: [], results: [] });
    try {
      const r = await env.engine.run(planning, config, projectIds, {
        onProgress: setProgress,
        onLog: entry => setProgress(p => (p ? { ...p, logs: [...p.logs, entry] } : p)),
        shouldStop: () => stopRequested.current,
      });
      setResult(r);
    } finally {
      setRunning(false);
    }
  }, [env.engine, planning, config]);

  const stopRun = useCallback(() => {
    stopRequested.current = true;
  }, []);

  const report = useCallback((): DiagnosticsReport => buildDiagnostics({
    source: env.sourceInfo,
    target: env.targetInfo,
    sourceUrl: env.source.url,
    targetUrl: env.target.url,
    config,
    planning: planning || undefined,
    result: result || undefined,
  }), [env.sourceInfo, env.targetInfo, env.source.url, env.target.url, config, planning, result]);

  const stepIndex = WIZARD_STEPS.indexOf(step);
  const goTo = useCallback((s: WizardStep) => setStep(s), []);

  return {
    step, stepIndex, goTo,
    config, updateConfig,
    projects, projectsLoading, projectsError, loadProjects, selectedIds, setSelectedIds, selectedProjects, keyFields,
    relatedTables, relatedLoading, loadRelatedTables, setRelatedSelection, templateCheck, loadTemplates, targetRoles,
    planning, planningBusy, planningMessage, planningError, planningStale, runPlanning,
    progress, result, running, startRun, stopRun,
    report,
  };
}

export type MigrationApp = ReturnType<typeof useMigrationApp>;
