import { useMemo, useRef, useEffect, useState } from 'react';
import {
  makeStyles, shorthands, tokens, Text, Button, ProgressBar, Badge, Switch, TabList, Tab,
  MessageBar, MessageBarBody, MessageBarTitle,
  Table, TableHeader, TableRow, TableHeaderCell, TableBody, TableCell,
} from '@fluentui/react-components';
import { Play20Filled, Stop20Regular, ArrowDownload20Regular, Rocket20Regular, ArrowRight16Regular, ClipboardTaskListLtr20Regular } from '@fluentui/react-icons';
import type { MigrationApp } from '../../hooks/useMigrationApp';
import type { UseEnvironmentsReturn } from '../../hooks/useEnvironments';
import type { ProjectRunResult, StageKey } from '../../types/ui';
import { MIGRATION_STAGE_LABELS, STAGE_COUNT_LABELS } from '../../types/ui';
import { diagnosticsToMarkdown } from '../../services/DiagnosticsService';
import { Section, StatTile, StatusIcon } from '../common/ui';
import { downloadJson, downloadText, stamp } from '../../utils/download';

const useStyles = makeStyles({
  stack: { display: 'flex', flexDirection: 'column', rowGap: '16px' },
  tiles: { display: 'flex', columnGap: '12px', rowGap: '12px', flexWrap: 'wrap' },
  start: { display: 'flex', alignItems: 'center', columnGap: '16px', flexWrap: 'wrap', rowGap: '12px' },
  progressHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', columnGap: '12px' },
  log: {
    maxHeight: '320px', overflowY: 'auto', backgroundColor: tokens.colorNeutralBackground3, ...shorthands.borderRadius(tokens.borderRadiusLarge),
    ...shorthands.padding('8px', '12px'), fontFamily: tokens.fontFamilyMonospace, fontSize: '12px', lineHeight: '18px',
  },
  logLine: { display: 'grid', gridTemplateColumns: '72px 120px 1fr', columnGap: '8px' },
  error: { color: tokens.colorPaletteRedForeground1 },
  warn: { color: tokens.colorPaletteMarigoldForeground2 },
  success: { color: tokens.colorPaletteGreenForeground1 },
  muted: { color: tokens.colorNeutralForeground3 },
  resultHead: { display: 'flex', alignItems: 'center', columnGap: '10px', flexWrap: 'wrap', rowGap: '4px' },
  counts: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', columnGap: '8px', rowGap: '8px' },
  count: { ...shorthands.padding('8px', '10px'), ...shorthands.borderRadius(tokens.borderRadiusMedium), backgroundColor: tokens.colorNeutralBackground2 },
  tableWrap: { maxHeight: '360px', overflowY: 'auto', ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2), ...shorthands.borderRadius(tokens.borderRadiusLarge) },
  th: { position: 'sticky', top: 0, backgroundColor: tokens.colorNeutralBackground2, zIndex: 1 },
  list: { ...shorthands.margin(0), paddingLeft: '18px', fontSize: '12px' },
});

const RECON_BADGE = { match: { color: 'success' as const, text: 'Match' }, differs: { color: 'warning' as const, text: 'Differs' }, missing: { color: 'danger' as const, text: 'Missing' } };

function Counts({ r }: { r: ProjectRunResult }) {
  const s = useStyles();
  return (
    <div className={s.counts}>
      {(Object.keys(r.counts) as StageKey[]).filter(k => { const c = r.counts[k]; return c.created + c.existing + c.skipped + c.failed > 0; }).map(k => {
        const c = r.counts[k];
        const existingLabel = k === 'allocations' ? 'already matching' : 'already there';
        return (
          <div key={k} className={s.count}>
            <Text size={200} className={s.muted}>{STAGE_COUNT_LABELS[k]}</Text>
            <Text block weight="semibold">{c.created} {k === 'allocations' ? 'updated' : 'added'}</Text>
            <Text size={200} className={s.muted}>
              {[c.existing && `${c.existing} ${existingLabel}`, c.skipped && `${c.skipped} skipped`].filter(Boolean).join(' · ')}
              {c.failed ? <span className={s.error}>{c.existing || c.skipped ? ' · ' : ''}{c.failed} failed</span> : null}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

function Reconciliation({ r }: { r: ProjectRunResult }) {
  const s = useStyles();
  const [tab, setTab] = useState<'tasks' | 'assignments' | 'related'>('tasks');
  const [onlyDiff, setOnlyDiff] = useState(true);
  const rec = r.reconciliation;
  if (!rec) return null;
  const tasks = onlyDiff ? rec.tasks.filter(t => t.status !== 'match') : rec.tasks;
  const assignments = onlyDiff ? rec.assignments.filter(a => a.status !== 'match') : rec.assignments;
  const sum = rec.summary;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', rowGap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as typeof tab)} size="small">
          <Tab value="tasks">Tasks · {sum.tasksMatched} match{sum.tasksDiffer ? `, ${sum.tasksDiffer} differ` : ''}{sum.tasksMissing ? `, ${sum.tasksMissing} missing` : ''}</Tab>
          <Tab value="assignments">Assignments · {sum.sourceHours}h → {sum.targetHours}h</Tab>
          {rec.related.length > 0 && <Tab value="related">Related records</Tab>}
        </TabList>
        {tab !== 'related' && <Switch checked={onlyDiff} onChange={(_, d) => setOnlyDiff(d.checked)} label="Only differences" />}
      </div>
      {tab === 'tasks' && (
        tasks.length ? (
          <div className={s.tableWrap}>
            <Table size="small">
              <TableHeader><TableRow>
                <TableHeaderCell className={s.th}>Task</TableHeaderCell>
                <TableHeaderCell className={s.th} style={{ width: 90 }}>Status</TableHeaderCell>
                <TableHeaderCell className={s.th} style={{ width: 210 }}>Source</TableHeaderCell>
                <TableHeaderCell className={s.th} style={{ width: 210 }}>Target</TableHeaderCell>
                <TableHeaderCell className={s.th}>Difference</TableHeaderCell>
              </TableRow></TableHeader>
              <TableBody>
                {tasks.map((t, i) => (
                  <TableRow key={i}>
                    <TableCell>{t.path}</TableCell>
                    <TableCell><Badge appearance="tint" color={RECON_BADGE[t.status].color}>{RECON_BADGE[t.status].text}</Badge></TableCell>
                    <TableCell>{t.source.start || '—'} → {t.source.end || '—'}{t.source.effort != null ? ` · ${t.source.effort}h` : ''}</TableCell>
                    <TableCell>{t.target ? `${t.target.start || '—'} → ${t.target.end || '—'}${t.target.effort != null ? ` · ${t.target.effort}h` : ''}` : '—'}</TableCell>
                    <TableCell><Text size={200}>{t.differences.join('; ')}</Text></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <Text className={s.success}>All {rec.tasks.length} tasks match the source.</Text>
      )}
      {tab === 'assignments' && (
        assignments.length ? (
          <div className={s.tableWrap}>
            <Table size="small">
              <TableHeader><TableRow>
                <TableHeaderCell className={s.th}>Task</TableHeaderCell>
                <TableHeaderCell className={s.th} style={{ width: 200 }}>Resource</TableHeaderCell>
                <TableHeaderCell className={s.th} style={{ width: 90 }}>Status</TableHeaderCell>
                <TableHeaderCell className={s.th} style={{ width: 150 }}>Planned hours</TableHeaderCell>
              </TableRow></TableHeader>
              <TableBody>
                {assignments.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell>{a.task}</TableCell>
                    <TableCell>{a.resource}</TableCell>
                    <TableCell><Badge appearance="tint" color={RECON_BADGE[a.status].color}>{RECON_BADGE[a.status].text}</Badge></TableCell>
                    <TableCell>{a.sourceHours}h → {a.targetHours ?? '—'}{a.targetHours != null ? 'h' : ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <Text className={s.success}>All {rec.assignments.length} assignments carry the same planned hours as the source.</Text>
      )}
      {tab === 'related' && (
        <div className={s.tableWrap}>
          <Table size="small">
            <TableHeader><TableRow>
              <TableHeaderCell className={s.th}>Table</TableHeaderCell>
              <TableHeaderCell className={s.th} style={{ width: 120 }}>Source</TableHeaderCell>
              <TableHeaderCell className={s.th} style={{ width: 120 }}>Target</TableHeaderCell>
            </TableRow></TableHeader>
            <TableBody>
              {rec.related.map(x => (
                <TableRow key={x.table}>
                  <TableCell>{x.displayName}</TableCell>
                  <TableCell>{x.source}</TableCell>
                  <TableCell><span className={x.target >= x.source ? s.success : s.error}>{x.target}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ResultCard({ r, targetUrl }: { r: ProjectRunResult; targetUrl: string }) {
  const s = useStyles();
  const status = r.status === 'succeeded' ? 'pass' : r.status === 'failed' ? 'fail' : r.status === 'skipped' ? 'info' : 'warn';
  const link = r.targetProjectId ? `${targetUrl}/main.aspx?pagetype=entityrecord&etn=msdyn_project&id=${r.targetProjectId}` : undefined;
  return (
    <Section
      title={r.sourceName}
      icon={<StatusIcon status={status} />}
      subtitle={
        <span className={s.resultHead}>
          <ArrowRight16Regular />
          {link ? <a href={link} target="_blank" rel="noreferrer">{r.targetName || 'Open target project'}</a> : <span>{r.targetName || '—'}</span>}
          {r.projectCreated && <Badge appearance="tint" color="brand" size="small">created</Badge>}
          <Badge appearance="filled" color={r.status === 'succeeded' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'skipped' ? 'informative' : 'warning'}>{r.status}</Badge>
          <span className={s.muted}>{(r.durationMs / 1000).toFixed(0)}s</span>
        </span>
      }
    >
      <Counts r={r} />
      {r.errors.length > 0 && (
        <MessageBar intent="error"><MessageBarBody><MessageBarTitle>{r.errors.length} error{r.errors.length === 1 ? '' : 's'}</MessageBarTitle>
          <ul className={s.list}>{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          Fix the cause and run again: everything already migrated is kept and skipped.
        </MessageBarBody></MessageBar>
      )}
      {r.warnings.length > 0 && (
        <MessageBar intent="warning"><MessageBarBody><ul className={s.list}>{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></MessageBarBody></MessageBar>
      )}
      <Reconciliation r={r} />
    </Section>
  );
}

export function RunStep({ app, env }: { app: MigrationApp; env: UseEnvironmentsReturn }) {
  const s = useStyles();
  const logRef = useRef<HTMLDivElement>(null);
  const planning = app.planning;
  const plans = planning?.plans || [];
  const runnable = plans.filter(p => p.match.target || p.willCreate);
  const blocked = plans.filter(p => p.checks.some(c => c.status === 'fail'));
  const globalFail = planning?.globalChecks.some(c => c.status === 'fail');
  const logs = app.progress?.logs || [];
  const results = app.result?.projectResults || app.progress?.results || [];

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs.length]);

  const totals = useMemo(() => ({
    tasks: runnable.reduce((n, p) => n + p.tasksToCreate, 0),
    assignments: runnable.reduce((n, p) => n + p.assignmentsToCreate, 0),
    related: runnable.reduce((n, p) => n + Object.values(p.relatedCounts).reduce((a, b) => a + b, 0), 0),
  }), [runnable]);

  const exportReport = (kind: 'json' | 'md') => {
    const report = app.report();
    if (kind === 'json') downloadJson(`migration-report-${stamp()}.json`, report);
    else downloadText(`migration-report-${stamp()}.md`, diagnosticsToMarkdown(report), 'text/markdown');
  };
  const exportMappings = () => downloadJson(`migration-id-mappings-${stamp()}.json`, results.map(r => r.idMappings).filter(Boolean));

  return (
    <div className={s.stack}>
      {!app.running && !app.result && (
        <Section title="Ready to run" icon={<Rocket20Regular />} subtitle={`Writes to ${env.target.friendlyName || 'the target'} using the Project schedule APIs. Safe to run again: anything already migrated is skipped.`}>
          {app.planningStale && <MessageBar intent="warning"><MessageBarBody>Settings changed since the readiness check. Go back to the readiness check to refresh it.</MessageBarBody></MessageBar>}
          <div className={s.tiles}>
            <StatTile value={runnable.length} label={`project${runnable.length === 1 ? '' : 's'} to migrate`} />
            <StatTile value={totals.tasks} label="tasks" />
            <StatTile value={totals.assignments} label="assignments" />
            <StatTile value={totals.related} label="related records" />
          </div>
          {plans.length > runnable.length && <Text className={s.muted}>{plans.length - runnable.length} project(s) have no target project and will be skipped.</Text>}
          {blocked.length > 0 && <MessageBar intent="warning"><MessageBarBody>{blocked.length} project(s) still have items marked "needs action" in the readiness check. You can run anyway; those items will be skipped or flagged.</MessageBarBody></MessageBar>}
          <div className={s.start}>
            <Button appearance="primary" size="large" icon={<Play20Filled />} disabled={!runnable.length || globalFail || app.planningStale || !planning} onClick={() => app.startRun(runnable.map(p => p.sourceProjectId))}>
              Start migration
            </Button>
            {globalFail && <Text className={s.error}>Fix the environment issues in the readiness check first.</Text>}
          </div>
        </Section>
      )}

      {app.progress && (
        <Section
          title={app.running ? `Migrating ${app.progress.currentProject || ''}` : 'Migration finished'}
          icon={<ClipboardTaskListLtr20Regular />}
          subtitle={app.running ? `${MIGRATION_STAGE_LABELS[app.progress.stage]} · project ${Math.min(app.progress.currentProjectIndex + 1, app.progress.totalProjects)} of ${app.progress.totalProjects}` : app.result ? `${app.result.projectResults.filter(r => r.status === 'succeeded').length} of ${app.result.projectResults.length} projects succeeded in ${(app.result.totalDuration / 1000).toFixed(0)}s` : undefined}
          actions={
            <>
              {app.running && <Button icon={<Stop20Regular />} onClick={app.stopRun}>Stop after this project</Button>}
              {!app.running && app.result && (
                <>
                  <Button appearance="subtle" icon={<ArrowDownload20Regular />} onClick={() => exportReport('md')}>Report</Button>
                  <Button appearance="subtle" icon={<ArrowDownload20Regular />} onClick={() => exportReport('json')}>JSON</Button>
                  <Button appearance="subtle" icon={<ArrowDownload20Regular />} onClick={exportMappings}>ID mappings</Button>
                  <Button appearance="primary" icon={<Play20Filled />} onClick={() => app.startRun(runnable.map(p => p.sourceProjectId))}>Run again</Button>
                </>
              )}
            </>
          }
        >
          <ProgressBar value={app.progress.overallProgress / 100} thickness="large" color={app.result && !app.result.success ? 'warning' : app.result ? 'success' : 'brand'} />
          <div ref={logRef} className={s.log} role="log" aria-live="polite">
            {logs.map((l, i) => (
              <div key={i} className={s.logLine}>
                <span className={s.muted}>{new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
                <span className={s.muted}>{MIGRATION_STAGE_LABELS[l.stage]}</span>
                <span className={l.level === 'error' ? s.error : l.level === 'warn' ? s.warn : l.level === 'success' ? s.success : undefined}>{l.message}</span>
              </div>
            ))}
            {!logs.length && <span className={s.muted}>Starting…</span>}
          </div>
        </Section>
      )}

      {results.map(r => <ResultCard key={r.sourceProjectId} r={r} targetUrl={env.target.url} />)}
    </div>
  );
}
