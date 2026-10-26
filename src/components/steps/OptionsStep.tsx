import { useEffect } from 'react';
import {
  makeStyles, tokens, Text, Switch, Dropdown, Option, Field, Input, Checkbox, Spinner, Badge, RadioGroup, Radio,
  MessageBar, MessageBarBody,
} from '@fluentui/react-components';
import { PeopleTeam20Regular, CalendarLtr20Regular, DocumentBulletList20Regular, FolderOpen20Regular } from '@fluentui/react-icons';
import type { MigrationApp } from '../../hooks/useMigrationApp';
import type { UseEnvironmentsReturn } from '../../hooks/useEnvironments';
import { Section } from '../common/ui';

const useStyles = makeStyles({
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 1fr))', columnGap: '16px', rowGap: '16px', alignItems: 'start' },
  stack: { display: 'flex', flexDirection: 'column', rowGap: '12px' },
  hint: { color: tokens.colorNeutralForeground3, display: 'block', marginLeft: '44px', marginTop: '-6px' },
  tableRow: { display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', columnGap: '12px', paddingTop: '4px', paddingBottom: '4px' },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function OptionsStep({ app, env }: { app: MigrationApp; env: UseEnvironmentsReturn }) {
  const s = useStyles();
  const { config, updateConfig } = app;
  const createsProjects = config.mode === 'create' || config.createMissing;

  useEffect(() => { app.loadRelatedTables(); }, [app.loadRelatedTables]);
  useEffect(() => { if (createsProjects) app.loadTemplates(); }, [createsProjects, app.loadTemplates]);

  const fallbackRole = app.targetRoles.find(r => r.id === config.fallbackRoleId);
  const templates = app.templateCheck?.templates || [];
  const template = templates.find(t => t.id === config.workHourTemplateId);
  const selectedRelated = new Set(config.relatedTables);
  const toggleRelated = (name: string, on: boolean) => app.setRelatedSelection(on ? [...selectedRelated, name] : [...selectedRelated].filter(n => n !== name));

  return (
    <div className={s.grid}>
      <Section title="Team members and resources" icon={<PeopleTeam20Regular />} subtitle="Each source team member is matched to the same person's bookable resource in the target (by Entra user, then email, then name), and checked for work hours.">
        <Field label="When a resource can't be used in the target">
          <RadioGroup value={config.unresolvedResources} onChange={(_, d) => updateConfig({ unresolvedResources: d.value as 'generic' | 'skip' })}>
            <Radio value="generic" label="Add a generic team member with the same role (assignments and hours are kept)" />
            <Radio value="skip" label="Leave the team member and their assignments out" />
          </RadioGroup>
        </Field>
        <Field label="Role to use when a source role doesn't exist in the target" hint="Leave empty to flag these team members in the readiness check instead.">
          <Dropdown
            placeholder="No fallback — flag missing roles"
            value={fallbackRole?.name || ''}
            selectedOptions={config.fallbackRoleId ? [config.fallbackRoleId] : []}
            onOptionSelect={(_, d) => updateConfig({ fallbackRoleId: d.optionValue === '__none' ? undefined : d.optionValue })}
          >
            <Option value="__none" text="No fallback">No fallback — flag missing roles</Option>
            {app.targetRoles.map(r => <Option key={r.id} value={r.id} text={r.name}>{r.name}</Option>)}
          </Dropdown>
        </Field>
      </Section>

      <Section title="Schedule" icon={<CalendarLtr20Regular />} subtitle="Tasks keep their hierarchy, dates, effort and dependencies. Existing tasks in the target are left as they are.">
        <div className={s.stack}>
          <Switch checked={config.copyAllocations} onChange={(_, d) => updateConfig({ copyAllocations: d.checked })} label="Copy planned hours (allocations) for each assignment" />
          <Text size={200} className={s.hint}>Without this, Project Operations spreads each task's effort evenly across its assignees.</Text>
          <Switch checked={config.reapplyAllocations} disabled={!config.copyAllocations} onChange={(_, d) => updateConfig({ reapplyAllocations: d.checked })} label="Also reset planned hours on assignments already in the target" />
          <Text size={200} className={s.hint}>Use this after an interrupted run. It overwrites hours that were changed in the target since.</Text>
          <Switch checked={config.copyCustomTaskFields} onChange={(_, d) => updateConfig({ copyCustomTaskFields: d.checked })} label="Copy custom task columns that exist in both environments" />
          <MessageBar intent="info" layout="multiline"><MessageBarBody>Task progress (% complete) can't be copied: Project Operations calculates it from actuals and rejects it through the API.</MessageBarBody></MessageBar>
        </div>
      </Section>

      <Section
        title="Related records"
        icon={<DocumentBulletList20Regular />}
        subtitle={`Rows linked to the selected projects. They're copied into the matched target project, with lookups re-pointed and duplicates skipped.`}
        actions={app.relatedLoading ? <Spinner size="tiny" /> : undefined}
      >
        {!app.relatedTables.length && !app.relatedLoading && <Text className={s.muted}>No related tables found.</Text>}
        {app.relatedTables.map(t => (
          <div key={t.logicalName} className={s.tableRow}>
            <Checkbox
              checked={selectedRelated.has(t.logicalName)}
              disabled={!t.existsInTarget}
              onChange={(_, d) => toggleRelated(t.logicalName, !!d.checked)}
              label={
                <span>
                  {t.displayName} <span className={s.muted} style={{ fontSize: 12 }}>({t.logicalName})</span>
                  {t.isCustom && <Badge size="small" appearance="tint" color="informative" style={{ marginLeft: 6 }}>custom</Badge>}
                  {!t.existsInTarget && <Badge size="small" appearance="tint" color="danger" style={{ marginLeft: 6 }}>missing in target</Badge>}
                </span>
              }
            />
            <Text size={200} className={s.muted}>{t.sourceCount} row{t.sourceCount === 1 ? '' : 's'}</Text>
          </div>
        ))}
      </Section>

      <Section title="New projects" icon={<FolderOpen20Regular />} subtitle={config.mode === 'create' ? 'Settings for the projects this run creates.' : 'Only used if you allow creating projects that have no shell in the target.'}>
        {config.mode === 'existing' && (
          <Switch checked={config.createMissing} onChange={(_, d) => updateConfig({ createMissing: d.checked })} label="Create the project when no matching shell is found" />
        )}
        {createsProjects && (
          <>
            <Field label="Calendar template" hint="Sets the working days and hours of new projects. It must have a valid calendar in the target.">
              <Dropdown
                placeholder={templates.length ? 'Target default' : 'Loading…'}
                value={template ? `${template.name}${template.isDefault ? ' (default)' : ''}${template.status !== 'valid' && template.status !== 'unknown' ? ' — no valid calendar' : ''}` : ''}
                selectedOptions={config.workHourTemplateId ? [config.workHourTemplateId] : []}
                onOptionSelect={(_, d) => { const t = templates.find(x => x.id === d.optionValue); if (t) updateConfig({ workHourTemplateId: t.id, workHourTemplateName: t.name }); }}
              >
                {templates.map(t => (
                  <Option key={t.id} value={t.id} text={t.name}>
                    {t.name}{t.isDefault ? ' (default)' : ''}{t.status === 'missing-calendar' ? ' — calendar missing' : t.status === 'no-work-hours' ? ' — no work hours' : ''}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label="Project names">
              <RadioGroup value={config.naming} onChange={(_, d) => updateConfig({ naming: d.value as 'keep' | 'prefix' })} layout="horizontal">
                <Radio value="keep" label="Same as source" />
                <Radio value="prefix" label="Add a prefix" />
              </RadioGroup>
            </Field>
            {config.naming === 'prefix' && (
              <Field label="Prefix"><Input value={config.namePrefix} onChange={(_, d) => updateConfig({ namePrefix: d.value })} /></Field>
            )}
            {config.mode === 'create' && (
              <Field label="Dates">
                <RadioGroup value={config.dateHandling} onChange={(_, d) => updateConfig({ dateHandling: d.value as 'keep' | 'shift' })} layout="horizontal">
                  <Radio value="keep" label="Keep source dates" />
                  <Radio value="shift" label="Shift so each project starts today" />
                </RadioGroup>
              </Field>
            )}
          </>
        )}
        {!createsProjects && <Text size={200} className={s.muted}>Source projects without a matching shell in {env.target.friendlyName || 'the target'} are skipped.</Text>}
      </Section>
    </div>
  );
}
