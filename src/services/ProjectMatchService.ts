/**
 * Project Match Service — pairs each source project with an existing target project (the "shell")
 * using a configurable key field on both sides, e.g. source "ERP Project Number" → target "Project ID".
 */

import { DataverseClient } from '../clients/DataverseClient';
import type { ProjectKeyRule, ProjectMatch, ServiceResult, SourceProject, TargetProjectRef } from '../types/migration';
import { normalizeKey } from '../utils/odata';

interface TargetProjectRow {
  msdyn_projectid: string;
  msdyn_subject: string;
  [field: string]: unknown;
}

export class ProjectMatchService {
  private targetProjects?: TargetProjectRef[];

  constructor(private targetClient: DataverseClient) {}

  /** All active target projects with the configured key (cached until refresh) */
  async loadTargetProjects(rule: ProjectKeyRule, refresh = false): Promise<ServiceResult<TargetProjectRef[]>> {
    if (this.targetProjects && !refresh) return { success: true, data: this.targetProjects };
    const select = ['msdyn_projectid', 'msdyn_subject'];
    if (rule.targetField && !select.includes(rule.targetField)) select.push(rule.targetField);
    const result = await this.targetClient.query<TargetProjectRow>('msdyn_projects', { select, filter: 'statecode eq 0', orderBy: 'msdyn_subject asc' });
    if (!result.success) {
      const missing = rule.targetField && result.error?.includes(rule.targetField);
      return { success: false, error: missing ? `The target environment has no project field "${rule.targetField}". Pick another key field.` : result.error };
    }
    this.targetProjects = (result.data || []).map(p => ({
      id: p.msdyn_projectid,
      name: p.msdyn_subject,
      key: p[rule.targetField] == null ? undefined : String(p[rule.targetField]),
    }));
    return { success: true, data: this.targetProjects };
  }

  static matchProjects(
    sources: SourceProject[],
    targets: TargetProjectRef[],
    rule: ProjectKeyRule,
    manual: Record<string, string> = {}
  ): ProjectMatch[] {
    const byKey = new Map<string, TargetProjectRef[]>();
    const byName = new Map<string, TargetProjectRef[]>();
    const byId = new Map(targets.map(t => [t.id, t]));
    for (const t of targets) {
      const k = normalizeKey(t.key);
      if (k) byKey.set(k, [...(byKey.get(k) || []), t]);
      const n = normalizeKey(t.name);
      if (n) byName.set(n, [...(byName.get(n) || []), t]);
    }

    return sources.map(source => {
      const sourceKeyRaw = source[rule.sourceField];
      const sourceKey = sourceKeyRaw == null || sourceKeyRaw === '' ? undefined : String(sourceKeyRaw);
      const base = { sourceProjectId: source.msdyn_projectid, sourceName: source.msdyn_subject, sourceKey };

      const manualId = manual[source.msdyn_projectid];
      if (manualId && byId.has(manualId)) return { ...base, status: 'matched' as const, target: byId.get(manualId) };

      if (sourceKey) {
        const hits = byKey.get(normalizeKey(sourceKey)) || [];
        if (hits.length === 1) return { ...base, status: 'matched' as const, target: hits[0] };
        if (hits.length > 1) return { ...base, status: 'ambiguous' as const, candidates: hits };
      }

      if (rule.fallbackToName) {
        const hits = byName.get(normalizeKey(source.msdyn_subject)) || [];
        if (hits.length === 1) return { ...base, status: 'matched-by-name' as const, target: hits[0] };
        if (hits.length > 1) return { ...base, status: 'ambiguous' as const, candidates: hits };
      }

      return { ...base, status: sourceKey ? ('not-found' as const) : ('no-key' as const) };
    });
  }

  async match(sources: SourceProject[], rule: ProjectKeyRule, manual: Record<string, string> = {}): Promise<ServiceResult<ProjectMatch[]>> {
    const targets = await this.loadTargetProjects(rule);
    if (!targets.success) return { success: false, error: targets.error };
    return { success: true, data: ProjectMatchService.matchProjects(sources, targets.data || [], rule, manual) };
  }
}
