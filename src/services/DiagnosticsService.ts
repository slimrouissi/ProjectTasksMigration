/**
 * Diagnostics — one report with everything support needs: environments, settings, readiness checks,
 * project matches, resource issues, results, reconciliation and recent failed requests.
 * Replaces screenshots of the console and back-and-forth emails.
 */

import { DataverseClient } from '../clients/DataverseClient';
import type { OrganizationInfo, ReadinessCheck } from '../types/migration';
import type { MigrationConfig, MigrationResult } from '../types/ui';
import type { PlanningResult } from './MigrationPlanner';

export const TOOL_VERSION = '2.0.0';

export interface DiagnosticsInput {
  source?: OrganizationInfo;
  target?: OrganizationInfo;
  sourceUrl: string;
  targetUrl: string;
  config: MigrationConfig;
  planning?: PlanningResult;
  result?: MigrationResult;
}

export interface DiagnosticsReport {
  tool: string;
  version: string;
  generatedAt: string;
  environments: {
    source: { url: string; name?: string; environmentId?: string; projectOperations?: string; user?: string };
    target: { url: string; name?: string; environmentId?: string; projectOperations?: string; user?: string };
  };
  settings: Record<string, unknown>;
  readiness?: {
    global: ReadinessCheck[];
    projects: {
      source: string;
      target?: string;
      match: string;
      checks: ReadinessCheck[];
      team: { name: string; action: string; method: string; target?: string; role?: string; targetRole?: string; issues: string[] }[];
    }[];
  };
  results?: MigrationResult;
  failedRequests: { at: string; env: string; method: string; url: string; status?: number; error?: string }[];
}

export function buildDiagnostics(input: DiagnosticsInput): DiagnosticsReport {
  const { config, planning } = input;
  return {
    tool: 'Project Tasks Migration',
    version: TOOL_VERSION,
    generatedAt: new Date().toISOString(),
    environments: {
      source: { url: input.sourceUrl, name: input.source?.friendlyName, environmentId: input.source?.environmentId, projectOperations: input.source?.projectOperationsVersion, user: input.source?.userName },
      target: { url: input.targetUrl, name: input.target?.friendlyName, environmentId: input.target?.environmentId, projectOperations: input.target?.projectOperationsVersion, user: input.target?.userName },
    },
    settings: {
      mode: config.mode,
      createMissing: config.createMissing,
      keyRule: config.keyRule,
      unresolvedResources: config.unresolvedResources,
      fallbackRoleId: config.fallbackRoleId,
      copyAllocations: config.copyAllocations,
      reapplyAllocations: config.reapplyAllocations,
      copyCustomTaskFields: config.copyCustomTaskFields,
      relatedTables: config.relatedTables,
      workHourTemplate: config.workHourTemplateName,
      manualMatches: Object.keys(config.manualMatches).length,
      resourceOverrides: Object.keys(config.resourceOverrides).length,
    },
    readiness: planning
      ? {
          global: planning.globalChecks,
          projects: planning.plans.map(p => ({
            source: p.sourceName,
            target: p.match.target?.name,
            match: p.willCreate ? 'create' : p.match.status,
            checks: p.checks,
            team: p.teamPlan.map(t => ({
              name: t.displayName,
              action: t.action,
              method: t.method,
              target: t.target?.name,
              role: t.sourceRole?.name,
              targetRole: t.targetRole?.name,
              issues: t.issues.map(i => `${i.severity}: ${i.message}${i.fix ? ` Fix: ${i.fix}` : ''}`),
            })),
          })),
        }
      : undefined,
    results: input.result
      ? { ...input.result, projectResults: input.result.projectResults.map(r => ({ ...r, idMappings: undefined })) }
      : undefined,
    failedRequests: DataverseClient.getRequestLog()
      .filter(r => r.error || (r.status && r.status >= 400))
      .slice(-40)
      .map(r => ({ at: r.at, env: r.env, method: r.method, url: r.url.replace(/^https:\/\/[^/]+\/api\/data\/v9\.2\//, ''), status: r.status, error: r.error })),
  };
}

const icon: Record<string, string> = { pass: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️' };

export function diagnosticsToMarkdown(report: DiagnosticsReport): string {
  const lines: string[] = [];
  lines.push(`# Project Tasks Migration report`, '', `Generated ${report.generatedAt} · tool v${report.version}`, '');
  lines.push('## Environments', '', '| | Environment | URL | Project Operations | Signed in as |', '|---|---|---|---|---|');
  for (const [role, e] of Object.entries(report.environments)) lines.push(`| ${role} | ${e.name || '?'} | ${e.url} | ${e.projectOperations || '?'} | ${e.user || '?'} |`);
  lines.push('', '## Settings', '', '```json', JSON.stringify(report.settings, null, 2), '```', '');

  if (report.readiness) {
    lines.push('## Readiness', '');
    for (const c of report.readiness.global) lines.push(`- ${icon[c.status]} **${c.title}** — ${c.detail || ''}${c.fix ? ` _Fix: ${c.fix}_` : ''}`);
    for (const p of report.readiness.projects) {
      lines.push('', `### ${p.source} → ${p.target || p.match}`, '');
      for (const c of p.checks) lines.push(`- ${icon[c.status]} **${c.title}** — ${c.detail || ''}${c.fix ? ` _Fix: ${c.fix}_` : ''}`);
      if (p.team.length) {
        lines.push('', '| Team member | Action | Matched by | Target resource | Role | Issues |', '|---|---|---|---|---|---|');
        for (const t of p.team) lines.push(`| ${t.name} | ${t.action} | ${t.method} | ${t.target || '—'} | ${t.role || '—'} → ${t.targetRole || 'missing'} | ${t.issues.join('<br>') || ''} |`);
      }
    }
    lines.push('');
  }

  if (report.results) {
    lines.push('## Results', '');
    for (const r of report.results.projectResults) {
      lines.push(`### ${r.sourceName} → ${r.targetName || '—'}: ${r.status}`, '');
      lines.push('| | Created | Already there | Skipped | Failed |', '|---|---|---|---|---|');
      for (const [k, v] of Object.entries(r.counts)) if (v.created + v.existing + v.skipped + v.failed) lines.push(`| ${k} | ${v.created} | ${v.existing} | ${v.skipped} | ${v.failed} |`);
      if (r.reconciliation) {
        const s = r.reconciliation.summary;
        lines.push('', `Reconciliation: tasks ${s.tasksMatched} match, ${s.tasksDiffer} differ, ${s.tasksMissing} missing · assignments ${s.assignmentsMatched} match, ${s.assignmentsDiffer} differ, ${s.assignmentsMissing} missing · hours ${s.sourceHours} → ${s.targetHours}`);
      }
      if (r.errors.length) lines.push('', '**Errors**', '', ...r.errors.map(e => `- ${e}`));
      if (r.warnings.length) lines.push('', '**Warnings**', '', ...r.warnings.map(w => `- ${w}`));
      lines.push('');
    }
  }

  if (report.failedRequests.length) {
    lines.push('## Failed requests', '', '| Time | Env | Request | Status | Error |', '|---|---|---|---|---|');
    for (const f of report.failedRequests) lines.push(`| ${f.at.slice(11, 19)} | ${f.env} | ${f.method} ${f.url.slice(0, 80)} | ${f.status || ''} | ${(f.error || '').slice(0, 160).replace(/\|/g, '/')} |`);
  }
  return lines.join('\n');
}
