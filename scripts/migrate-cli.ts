/**
 * Headless run of the migration engine (same code as the web app) for testing against real environments.
 *
 *   npx vite-node scripts/migrate-cli.ts -- --source https://src.crm.dynamics.com --target https://tgt.crm.dynamics.com \
 *        --project "<source project name or ID>" [--mode existing|create] [--key msdyn_projectnumber] [--target-key msdyn_projectnumber]
 *        [--plan-only] [--related msdyn_projectrisk,msdyn_projectissue] [--fallback-role "Team Member"] [--out report.json]
 *
 * Tokens come from the Azure CLI (az login), so no app registration is needed for the test harness.
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { DataverseClient } from '../src/clients/DataverseClient';
import { createEnvironmentConfig, EnvironmentConfig } from '../src/config/environments';
import { MigrationPlanner } from '../src/services/MigrationPlanner';
import { MigrationEngine } from '../src/services/MigrationEngine';
import { EnvironmentService } from '../src/services/EnvironmentService';
import { buildDiagnostics, diagnosticsToMarkdown } from '../src/services/DiagnosticsService';
import { DEFAULT_MIGRATION_CONFIG, MigrationConfig, MigrationResult } from '../src/types/ui';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const tokenCache = new Map<string, { token: string; at: number }>();
async function azToken(env: EnvironmentConfig): Promise<string> {
  const cached = tokenCache.get(env.url);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.token;
  const token = execSync(`az account get-access-token --resource ${env.url} --query accessToken -o tsv`, { encoding: 'utf8' }).trim();
  tokenCache.set(env.url, { token, at: Date.now() });
  return token;
}

async function main() {
  const source = new DataverseClient(createEnvironmentConfig('Source', arg('source')!), azToken);
  const target = new DataverseClient(createEnvironmentConfig('Target', arg('target')!), azToken);

  const [srcInfo, tgtInfo] = await Promise.all([new EnvironmentService(source).getOrganizationInfo(), new EnvironmentService(target).getOrganizationInfo()]);
  if (!srcInfo.success || !tgtInfo.success) throw new Error(`Connection failed: ${srcInfo.error || tgtInfo.error}`);
  console.log(`Source: ${srcInfo.data!.friendlyName} (${source.env.url}) as ${srcInfo.data!.userName}`);
  console.log(`Target: ${tgtInfo.data!.friendlyName} (${target.env.url}) as ${tgtInfo.data!.userName}`);

  const config: MigrationConfig = {
    ...DEFAULT_MIGRATION_CONFIG,
    mode: arg('mode', 'existing') as MigrationConfig['mode'],
    createMissing: flag('create-missing'),
    keyRule: { sourceField: arg('key', 'msdyn_projectnumber')!, targetField: arg('target-key', 'msdyn_projectnumber')!, fallbackToName: !flag('no-name-fallback') },
    unresolvedResources: arg('unresolved', 'generic') as 'generic' | 'skip',
    relatedTables: (arg('related', '') || '').split(',').filter(Boolean),
    copyCustomTaskFields: flag('custom-task-fields'),
    reapplyAllocations: flag('reapply-allocations'),
  };

  const planner = new MigrationPlanner(source, target);
  const projectsResult = await planner.sourceService.getProjects(config.keyRule.sourceField);
  if (!projectsResult.success) throw new Error(projectsResult.error);
  const wanted = (arg('project') || '').split('|').map(s => s.trim().toLowerCase()).filter(Boolean);
  const projects = (projectsResult.data || []).filter(p => wanted.includes(p.msdyn_projectid.toLowerCase()) || wanted.includes(p.msdyn_subject.toLowerCase()));
  if (!projects.length) throw new Error(`No source project matches ${arg('project')}`);

  const fallbackRoleName = arg('fallback-role');
  if (fallbackRoleName) {
    const roles = await target.query<{ bookableresourcecategoryid: string; name: string }>('bookableresourcecategories', { select: ['bookableresourcecategoryid', 'name'], filter: `name eq '${fallbackRoleName}'` });
    config.fallbackRoleId = roles.data?.[0]?.bookableresourcecategoryid;
  }

  const planning = await planner.plan(projects, config, { source: srcInfo.data!, target: tgtInfo.data! }, m => console.log(`  … ${m}`));
  if (!planning.success || !planning.data) throw new Error(planning.error);

  console.log('\n=== Readiness');
  for (const c of planning.data.globalChecks) console.log(`[${c.status.toUpperCase()}] ${c.title}: ${c.detail || ''}${c.fix ? `\n        fix: ${c.fix}` : ''}`);
  for (const p of planning.data.plans) {
    console.log(`\n# ${p.sourceName} → ${p.match.target ? `${p.match.target.name} (${p.match.status})` : p.willCreate ? 'NEW PROJECT' : p.match.status}`);
    for (const c of p.checks) console.log(`[${c.status.toUpperCase()}] ${c.title}: ${c.detail || ''}${c.fix ? `\n        fix: ${c.fix}` : ''}`);
    for (const t of p.teamPlan) console.log(`   team: ${t.displayName.padEnd(26)} ${t.action.padEnd(8)} ${t.method.padEnd(10)} → ${t.target?.name || '-'} | role ${t.sourceRole?.name || '-'} → ${t.targetRole?.name || 'MISSING'} | ${t.assignmentCount} asg ${t.plannedHours}h ${t.issues.map(i => `[${i.code}]`).join(' ')}`);
  }
  console.log('\nRelated tables:', planning.data.relatedTables.map(t => `${t.logicalName}${t.existsInTarget ? '' : '(missing in target)'}`).join(', '));

  let result: MigrationResult | undefined;
  if (!flag('plan-only')) {
    const engine = new MigrationEngine(source, target);
    console.log('\n=== Run');
    result = await engine.run(planning.data, config, projects.map(p => p.msdyn_projectid), {
      onLog: e => console.log(`${e.timestamp.slice(11, 19)} [${e.level}] ${e.stage}: ${e.message}`),
    });
    for (const r of result.projectResults) {
      console.log(`\n# ${r.sourceName} → ${r.targetName} (${r.targetProjectId}) : ${r.status} in ${(r.durationMs / 1000).toFixed(1)}s`);
      for (const [k, v] of Object.entries(r.counts)) if (v.created + v.existing + v.skipped + v.failed) console.log(`   ${k.padEnd(13)} created ${v.created}, existing ${v.existing}, skipped ${v.skipped}, failed ${v.failed}`);
      r.errors.forEach(e => console.log(`   ERROR ${e}`));
      r.warnings.forEach(w => console.log(`   warn  ${w}`));
      if (r.reconciliation) {
        const s = r.reconciliation.summary;
        console.log(`   reconcile: tasks ${s.tasksMatched} match / ${s.tasksDiffer} differ / ${s.tasksMissing} missing; assignments ${s.assignmentsMatched}/${s.assignmentsDiffer}/${s.assignmentsMissing}; hours ${s.sourceHours} → ${s.targetHours}`);
        r.reconciliation.tasks.filter(t => t.status !== 'match').forEach(t => console.log(`     task ${t.status}: ${t.path} ${t.differences.join('; ')}`));
        r.reconciliation.assignments.filter(a => a.status !== 'match').forEach(a => console.log(`     asg ${a.status}: ${a.task} / ${a.resource} ${a.sourceHours}h → ${a.targetHours ?? '-'}h`));
        r.reconciliation.related.forEach(x => console.log(`     ${x.displayName}: source ${x.source}, target ${x.target}`));
      }
    }
  }

  const out = arg('out');
  if (out) {
    const report = buildDiagnostics({ source: srcInfo.data!, target: tgtInfo.data!, sourceUrl: source.env.url, targetUrl: target.env.url, config, planning: planning.data, result });
    writeFileSync(out, JSON.stringify(report, null, 2));
    writeFileSync(out.replace(/\.json$/, '.md'), diagnosticsToMarkdown(report));
    console.log(`\nReport written to ${out}`);
  }
}

main().catch(error => {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
