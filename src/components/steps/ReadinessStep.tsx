import { useEffect, useMemo, useState } from 'react';
import {
  makeStyles, shorthands, tokens, Text, Button, Spinner, Badge, Tooltip,
  MessageBar, MessageBarBody, MessageBarTitle,
  Accordion, AccordionItem, AccordionHeader, AccordionPanel,
  Table, TableHeader, TableRow, TableHeaderCell, TableBody, TableCell,
} from '@fluentui/react-components';
import {
  ArrowSync20Regular, ArrowDownload20Regular, Copy20Regular, ShieldCheckmark20Regular, ArrowRight16Regular,
  PeopleTeam20Regular, Building20Regular,
} from '@fluentui/react-icons';
import type { MigrationApp } from '../../hooks/useMigrationApp';
import type { UseEnvironmentsReturn } from '../../hooks/useEnvironments';
import type { CheckStatus, ProjectPlan, TeamMemberPlan } from '../../types/migration';
import { RESOURCE_TYPE } from '../../types/migration';
import { RESOURCE_TYPE_LABEL } from '../../services/ResourceService';
import { diagnosticsToMarkdown } from '../../services/DiagnosticsService';
import { CheckList, Section, StatTile, StatusIcon } from '../common/ui';
import { SearchPicker } from '../common/SearchPicker';
import { copyText, downloadJson, downloadText, stamp } from '../../utils/download';

const useStyles = makeStyles({
  stack: { display: 'flex', flexDirection: 'column', rowGap: '16px' },
  tiles: { display: 'flex', columnGap: '12px', rowGap: '12px', flexWrap: 'wrap' },
  busy: { display: 'flex', flexDirection: 'column', alignItems: 'center', rowGap: '8px', ...shorthands.padding('48px') },
  projectHead: { display: 'flex', alignItems: 'center', columnGap: '10px', minWidth: 0, flexWrap: 'wrap', rowGap: '4px' },
  matchRow: { display: 'flex', alignItems: 'center', columnGap: '12px', flexWrap: 'wrap', rowGap: '8px', ...shorthands.padding('12px', '14px'), backgroundColor: tokens.colorNeutralBackground2, ...shorthands.borderRadius(tokens.borderRadiusLarge) },
  panel: { display: 'flex', flexDirection: 'column', rowGap: '14px', ...shorthands.padding('4px', '0', '12px', '0') },
  tableWrap: { overflowX: 'auto', ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2), ...shorthands.borderRadius(tokens.borderRadiusLarge) },
  muted: { color: tokens.colorNeutralForeground3 },
  issue: { display: 'block', fontSize: '12px' },
  fix: { display: 'block', fontSize: '12px', color: tokens.colorNeutralForeground2, marginTop: '2px' },
  sub: { display: 'block', fontSize: '11px', color: tokens.colorNeutralForeground3 },
  actions: { display: 'flex', columnGap: '8px' },
});

const ACTION_LABEL: Record<TeamMemberPlan['action'], { text: string; color: 'success' | 'informative' | 'warning' | 'danger' | 'brand' }> = {
  reuse: { text: 'Already on project', color: 'informative' },
  create: { text: 'Add', color: 'success' },
  generic: { text: 'Add as generic', color: 'warning' },
  skip: { text: 'Left out', color: 'danger' },
};

const METHOD_LABEL: Record<string, string> = {
  'same-id': 'Same resource ID',
  'entra-user': 'Same Entra user',
  email: 'Same email',
  name: 'Same name',
  manual: 'Picked manually',
  generic: 'Generic resource',
  none: 'No match',
};

function projectStatus(plan: ProjectPlan): CheckStatus {
  if (plan.checks.some(c => c.status === 'fail')) return 'fail';
  if (plan.checks.some(c => c.status === 'warn')) return 'warn';
  return 'pass';
}

function ResourceTable({ plan, app }: { plan: ProjectPlan; app: MigrationApp }) {
  const s = useStyles();
  const planning = app.planning!;
  const resourceItems = useMemo(() => planning.resolution.targetResources
    .filter(r => r.active)
    .map(r => ({ id: r.id, label: r.name, secondary: `${RESOURCE_TYPE_LABEL[r.resourceType] || 'Resource'}${r.email ? ` · ${r.email}` : ''}` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [planning]);
  const roleItems = useMemo(() => planning.resolution.targetRoles.map(r => ({ id: r.id, label: r.name })).sort((a, b) => a.label.localeCompare(b.label)), [planning]);

  if (!plan.teamPlan.length) return <Text className={s.muted}>No team members in the source project.</Text>;

  return (
    <div className={s.tableWrap}>
      <Table size="small" aria-label={`Team members of ${plan.sourceName}`}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell style={{ width: 200 }}>Source team member</TableHeaderCell>
            <TableHeaderCell style={{ width: 300 }}>Target bookable resource</TableHeaderCell>
            <TableHeaderCell style={{ width: 210 }}>Role in target</TableHeaderCell>
            <TableHeaderCell style={{ width: 150 }}>Result</TableHeaderCell>
            <TableHeaderCell>Issues and fixes</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.teamPlan.map(t => {
            const generic = t.source?.resourceType === RESOURCE_TYPE.Generic;
            const action = ACTION_LABEL[t.action];
            return (
              <TableRow key={t.sourceTeamMemberId}>
                <TableCell>
                  <Text weight="semibold">{t.displayName}</Text>
                  <span className={s.sub}>{t.source ? `${RESOURCE_TYPE_LABEL[t.source.resourceType] || 'Resource'}${t.source.email ? ` · ${t.source.email}` : ''}` : 'No resource'}</span>
                  <span className={s.sub}>{t.assignmentCount} assignment{t.assignmentCount === 1 ? '' : 's'} · {t.plannedHours}h</span>
                </TableCell>
                <TableCell>
                  {generic ? (
                    <Text>{t.target?.name || '—'} <span className={s.sub}>Generic</span></Text>
                  ) : t.source ? (
                    <>
                      <SearchPicker
                        ariaLabel={`Target resource for ${t.displayName}`}
                        items={resourceItems}
                        value={app.config.resourceOverrides[t.source.id] || t.target?.id}
                        placeholder="Pick a resource…"
                        clearLabel="Automatic match"
                        onChange={id => {
                          const next = { ...app.config.resourceOverrides };
                          if (id) next[t.source!.id] = id; else delete next[t.source!.id];
                          app.updateConfig({ resourceOverrides: next });
                        }}
                      />
                      <span className={s.sub}>{METHOD_LABEL[t.method] || t.method}</span>
                    </>
                  ) : '—'}
                </TableCell>
                <TableCell>
                  {t.sourceRole ? (
                    <>
                      <SearchPicker
                        ariaLabel={`Target role for ${t.displayName}`}
                        width={190}
                        items={roleItems}
                        value={app.config.roleOverrides[t.sourceRole.id] || t.targetRole?.id}
                        placeholder="Missing — pick a role"
                        clearLabel="Same name / fallback"
                        onChange={id => {
                          const next = { ...app.config.roleOverrides };
                          if (id) next[t.sourceRole!.id] = id; else delete next[t.sourceRole!.id];
                          app.updateConfig({ roleOverrides: next });
                        }}
                      />
                      <span className={s.sub}>Source: {t.sourceRole.name}</span>
                    </>
                  ) : '—'}
                </TableCell>
                <TableCell><Badge appearance="tint" color={action.color}>{action.text}</Badge></TableCell>
                <TableCell>
                  {t.issues.length ? t.issues.map((i, idx) => (
                    <div key={idx} style={{ marginBottom: 4 }}>
                      <span className={s.issue} style={{ color: i.severity === 'error' ? tokens.colorPaletteRedForeground1 : tokens.colorPaletteMarigoldForeground1 }}>{i.message}</span>
                      {i.fix && <span className={s.fix}>{i.fix}</span>}
                    </div>
                  )) : <span className={s.muted}>None</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function ReadinessStep({ app, env }: { app: MigrationApp; env: UseEnvironmentsReturn }) {
  const s = useStyles();
  const [copied, setCopied] = useState(false);
  const { planning } = app;

  useEffect(() => {
    if (app.planningStale && !app.planningBusy && !app.planningError) app.runPlanning();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.planningStale, app.planningBusy, app.planningError]);

  const targetProjectItems = useMemo(() => (planning?.targetProjects || []).map(p => ({ id: p.id, label: p.name, secondary: p.key })), [planning]);

  const exportReport = (kind: 'json' | 'md') => {
    const report = app.report();
    if (kind === 'json') downloadJson(`migration-readiness-${stamp()}.json`, report);
    else downloadText(`migration-readiness-${stamp()}.md`, diagnosticsToMarkdown(report), 'text/markdown');
  };
  const copySummary = async () => {
    setCopied(await copyText(diagnosticsToMarkdown(app.report())));
    setTimeout(() => setCopied(false), 2500);
  };

  const actions = (
    <div className={s.actions}>
      <Button appearance="subtle" icon={<ArrowSync20Regular />} onClick={app.runPlanning} disabled={app.planningBusy}>Re-check</Button>
      <Tooltip content="Everything on this page, for support or your records" relationship="description">
        <Button appearance="subtle" icon={<ArrowDownload20Regular />} onClick={() => exportReport('md')} disabled={!planning}>Report</Button>
      </Tooltip>
      <Button appearance="subtle" icon={<ArrowDownload20Regular />} onClick={() => exportReport('json')} disabled={!planning}>JSON</Button>
      <Button appearance="subtle" icon={<Copy20Regular />} onClick={copySummary} disabled={!planning}>{copied ? 'Copied' : 'Copy'}</Button>
    </div>
  );

  if (app.planningBusy && !planning) {
    return (
      <Section title="Readiness check" icon={<ShieldCheckmark20Regular />} actions={actions}>
        <div className={s.busy}><Spinner /><Text>{app.planningMessage || 'Checking…'}</Text><Text size={200} className={s.muted}>Nothing is written to {env.target.friendlyName || 'the target'} during this check.</Text></div>
      </Section>
    );
  }

  if (app.planningError) {
    return (
      <Section title="Readiness check" icon={<ShieldCheckmark20Regular />} actions={actions}>
        <MessageBar intent="error"><MessageBarBody><MessageBarTitle>The check couldn't finish</MessageBarTitle>{app.planningError}</MessageBarBody></MessageBar>
      </Section>
    );
  }

  if (!planning) return null;

  const plans = planning.plans;
  const ready = plans.filter(p => projectStatus(p) !== 'fail').length;
  const team = plans.flatMap(p => p.teamPlan);
  const teamIssues = team.filter(t => t.issues.some(i => i.severity === 'error')).length;
  const tasks = plans.reduce((n, p) => n + p.tasksToCreate, 0);
  const existingTasks = plans.reduce((n, p) => n + p.tasksAlreadyInTarget, 0);
  const assignments = plans.reduce((n, p) => n + p.assignmentsToCreate, 0);
  const related = plans.reduce((n, p) => n + Object.values(p.relatedCounts).reduce((a, b) => a + b, 0), 0);
  const globalFail = planning.globalChecks.some(c => c.status === 'fail');

  return (
    <div className={s.stack}>
      <Section
        title="Readiness check"
        icon={<ShieldCheckmark20Regular />}
        subtitle={<>Checked {new Date(planning.generatedAt).toLocaleTimeString()} · nothing has been written yet{app.planningBusy ? ' · re-checking…' : ''}</>}
        actions={actions}
      >
        <div className={s.tiles}>
          <StatTile value={`${ready}/${plans.length}`} label="projects ready" tone={ready === plans.length ? 'good' : 'bad'} />
          <StatTile value={teamIssues ? `${teamIssues}/${team.length}` : team.length} label={teamIssues ? 'team members with resource issues' : 'team members, all valid'} tone={teamIssues ? 'warn' : 'good'} />
          <StatTile value={tasks} label={existingTasks ? `tasks to add (${existingTasks} already there)` : 'tasks to add'} />
          <StatTile value={assignments} label="assignments" />
          <StatTile value={related} label="related records" />
        </div>
        {globalFail && (
          <MessageBar intent="error"><MessageBarBody><MessageBarTitle>Fix the environment issues below first</MessageBarTitle>They affect every project.</MessageBarBody></MessageBar>
        )}
      </Section>

      <Section title="Environments and migration account" icon={<Building20Regular />}>
        <CheckList checks={planning.globalChecks} />
      </Section>

      <Section title="Projects" icon={<PeopleTeam20Regular />} subtitle="Expand a project to see its match, checks and team. Changing a match, resource or role re-runs the check automatically.">
        <Accordion multiple collapsible defaultOpenItems={plans.filter(p => projectStatus(p) !== 'pass').map(p => p.sourceProjectId).slice(0, 3)}>
          {plans.map(plan => {
            const status = projectStatus(plan);
            const target = plan.match.target;
            return (
              <AccordionItem key={plan.sourceProjectId} value={plan.sourceProjectId}>
                <AccordionHeader size="large">
                  <span className={s.projectHead}>
                    <StatusIcon status={status} />
                    <Text weight="semibold">{plan.sourceName}</Text>
                    <ArrowRight16Regular />
                    <Text>{target ? target.name : plan.willCreate ? 'new project' : 'no match'}</Text>
                    {plan.match.status === 'matched-by-name' && <Badge appearance="tint" color="warning" size="small">matched by name</Badge>}
                    {plan.tasksAlreadyInTarget > 0 && <Badge appearance="tint" color="informative" size="small">{plan.tasksAlreadyInTarget} tasks already there</Badge>}
                  </span>
                </AccordionHeader>
                <AccordionPanel>
                  <div className={s.panel}>
                    {app.config.mode === 'existing' && (
                      <div className={s.matchRow}>
                        <div>
                          <Text size={200} className={s.muted}>Source {app.keyFields.source.find(f => f.logicalName === app.config.keyRule.sourceField)?.displayName || app.config.keyRule.sourceField}</Text>
                          <Text block weight="semibold">{plan.match.sourceKey || 'empty'}</Text>
                        </div>
                        <ArrowRight16Regular />
                        <div style={{ flex: 1, minWidth: 260 }}>
                          <Text size={200} className={s.muted}>Target project</Text>
                          <SearchPicker
                            ariaLabel={`Target project for ${plan.sourceName}`}
                            width={420}
                            items={targetProjectItems}
                            value={app.config.manualMatches[plan.sourceProjectId] || target?.id}
                            placeholder={plan.willCreate ? 'Will be created — or pick a project' : 'Pick the target project…'}
                            clearLabel="Automatic match"
                            onChange={id => {
                              const next = { ...app.config.manualMatches };
                              if (id) next[plan.sourceProjectId] = id; else delete next[plan.sourceProjectId];
                              app.updateConfig({ manualMatches: next });
                            }}
                          />
                        </div>
                      </div>
                    )}
                    <CheckList checks={plan.checks} />
                    <Text weight="semibold">Team members</Text>
                    <ResourceTable plan={plan} app={app} />
                  </div>
                </AccordionPanel>
              </AccordionItem>
            );
          })}
        </Accordion>
      </Section>
    </div>
  );
}
