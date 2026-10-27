import { useMemo, useState } from 'react';
import {
  makeStyles, shorthands, tokens, Text, Button, Checkbox, SearchBox, Spinner, Switch, Dropdown, Option, Field, Badge,
  MessageBar, MessageBarBody, MessageBarTitle,
  Table, TableHeader, TableRow, TableHeaderCell, TableBody, TableCell,
} from '@fluentui/react-components';
import { ArrowSync20Regular, ArrowRight16Regular, FolderOpen20Regular, Link20Regular } from '@fluentui/react-icons';
import type { MigrationApp } from '../../hooks/useMigrationApp';
import type { UseEnvironmentsReturn } from '../../hooks/useEnvironments';
import type { FieldOption } from '../../types/migration';
import { ChoiceCard, Section } from '../common/ui';

const useStyles = makeStyles({
  stack: { display: 'flex', flexDirection: 'column', rowGap: '16px' },
  choices: { display: 'flex', columnGap: '12px', flexWrap: 'wrap', rowGap: '12px' },
  keyRow: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', columnGap: '12px', alignItems: 'end' },
  keyArrow: { paddingBottom: '8px', color: tokens.colorNeutralForeground3 },
  toolbar: { display: 'flex', columnGap: '12px', alignItems: 'center', flexWrap: 'wrap' },
  tableWrap: { maxHeight: '460px', overflowY: 'auto', ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2), ...shorthands.borderRadius(tokens.borderRadiusLarge) },
  headerCell: { position: 'sticky', top: 0, backgroundColor: tokens.colorNeutralBackground2, zIndex: 1 },
  row: { cursor: 'pointer' },
  muted: { color: tokens.colorNeutralForeground3 },
  key: { fontFamily: tokens.fontFamilyMonospace, fontSize: '12px' },
});

function fieldLabel(f?: FieldOption, logical?: string) {
  if (!f) return logical || '';
  return `${f.displayName} (${f.logicalName})`;
}

function KeyFieldDropdown({ label, value, options, onChange, hint }: { label: string; value: string; options: FieldOption[]; onChange: (v: string) => void; hint?: string }) {
  const selected = options.find(o => o.logicalName === value);
  return (
    <Field label={label} hint={hint}>
      <Dropdown value={fieldLabel(selected, value)} selectedOptions={[value]} onOptionSelect={(_, d) => d.optionValue && onChange(d.optionValue)}>
        {options.map(o => (
          <Option key={o.logicalName} value={o.logicalName} text={fieldLabel(o)}>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span>{o.displayName}{o.isCustom && <Badge size="small" appearance="tint" color="informative" style={{ marginLeft: 6 }}>custom</Badge>}</span>
              <span style={{ fontSize: 11, color: tokens.colorNeutralForeground3 }}>{o.logicalName}</span>
            </span>
          </Option>
        ))}
      </Dropdown>
    </Field>
  );
}

export function ProjectsStep({ app, env }: { app: MigrationApp; env: UseEnvironmentsReturn }) {
  const s = useStyles();
  const { config, updateConfig } = app;
  const [search, setSearch] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const keyField = config.keyRule.sourceField;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return app.projects.filter(p => {
      if (selectedOnly && !app.selectedIds.includes(p.msdyn_projectid)) return false;
      if (!q) return true;
      return [p.msdyn_subject, p.msdyn_projectnumber, p[keyField]].some(v => v != null && String(v).toLowerCase().includes(q));
    });
  }, [app.projects, app.selectedIds, search, selectedOnly, keyField]);

  const allVisibleSelected = filtered.length > 0 && filtered.every(p => app.selectedIds.includes(p.msdyn_projectid));
  const someVisibleSelected = filtered.some(p => app.selectedIds.includes(p.msdyn_projectid));
  const toggleAll = () => {
    const ids = filtered.map(p => p.msdyn_projectid);
    app.setSelectedIds(allVisibleSelected ? app.selectedIds.filter(id => !ids.includes(id)) : [...new Set([...app.selectedIds, ...ids])]);
  };
  const toggle = (id: string) => app.setSelectedIds(app.selectedIds.includes(id) ? app.selectedIds.filter(x => x !== id) : [...app.selectedIds, id]);

  const formatDate = (v?: unknown) => (v ? new Date(String(v)).toLocaleDateString() : '—');
  const targetName = env.target.friendlyName || 'the target';

  return (
    <div className={s.stack}>
      <Section title="Where should the data go?" icon={<FolderOpen20Regular />} subtitle={`Tasks, team members, assignments with their planned hours, and the project's RAID log are copied into ${targetName}.`}>
        <div className={s.choices} role="radiogroup" aria-label="Migration mode">
          <ChoiceCard
            selected={config.mode === 'existing'}
            onSelect={() => updateConfig({ mode: 'existing' })}
            title="Add to projects that already exist in the target"
            badge={<Badge appearance="tint" color="brand" size="small">recommended</Badge>}
            description="For project shells already created in the target (for example by an ERP integration). Each source project is matched to its shell by a key field, and only what's missing is added, so it's safe to run again."
          />
          <ChoiceCard
            selected={config.mode === 'create'}
            onSelect={() => updateConfig({ mode: 'create' })}
            title="Create new projects in the target"
            description="Creates a new project for each source project, using a calendar template from the target."
          />
        </div>
      </Section>

      {config.mode === 'existing' && (
        <Section title="How to find each project in the target" icon={<Link20Regular />} subtitle="Pick the field that holds the same value on both sides, for example an ERP project number in the source and the Project ID in the target.">
          <div className={s.keyRow}>
            <KeyFieldDropdown
              label={`Source field (${env.source.friendlyName || 'source'})`}
              value={config.keyRule.sourceField}
              options={app.keyFields.source}
              onChange={v => updateConfig({ keyRule: { ...config.keyRule, sourceField: v } })}
            />
            <span className={s.keyArrow}><ArrowRight16Regular /></span>
            <KeyFieldDropdown
              label={`Target field (${targetName})`}
              value={config.keyRule.targetField}
              options={app.keyFields.target}
              onChange={v => updateConfig({ keyRule: { ...config.keyRule, targetField: v } })}
            />
          </div>
          <Switch
            checked={config.keyRule.fallbackToName}
            onChange={(_, d) => updateConfig({ keyRule: { ...config.keyRule, fallbackToName: d.checked } })}
            label="If the key is empty or not found, match by project name"
          />
        </Section>
      )}

      <Section
        title={`Projects in ${env.source.friendlyName || 'the source'}`}
        subtitle={`${app.projects.length} active projects · ${app.selectedIds.length} selected`}
        actions={<Button appearance="subtle" icon={<ArrowSync20Regular />} onClick={app.loadProjects} disabled={app.projectsLoading}>Refresh</Button>}
      >
        {app.projectsError && (
          <MessageBar intent="warning">
            <MessageBarBody><MessageBarTitle>Projects couldn't be loaded with this key field</MessageBarTitle>{app.projectsError}</MessageBarBody>
          </MessageBar>
        )}
        <div className={s.toolbar}>
          <SearchBox placeholder="Search by name or key" value={search} onChange={(_, d) => setSearch(d.value)} style={{ minWidth: 300 }} />
          <Switch checked={selectedOnly} onChange={(_, d) => setSelectedOnly(d.checked)} label="Selected only" />
          {app.selectedIds.length > 0 && <Button appearance="transparent" onClick={() => app.setSelectedIds([])}>Clear selection</Button>}
        </div>
        {app.projectsLoading ? (
          <Spinner label="Loading projects…" />
        ) : (
          <div className={s.tableWrap}>
            <Table size="small" aria-label="Source projects">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell className={s.headerCell} style={{ width: 44 }}>
                    <Checkbox checked={allVisibleSelected ? true : someVisibleSelected ? 'mixed' : false} onChange={toggleAll} aria-label="Select all shown" />
                  </TableHeaderCell>
                  <TableHeaderCell className={s.headerCell}>Project</TableHeaderCell>
                  {config.mode === 'existing' && <TableHeaderCell className={s.headerCell} style={{ width: 200 }}>{app.keyFields.source.find(f => f.logicalName === keyField)?.displayName || keyField}</TableHeaderCell>}
                  {keyField !== 'msdyn_projectnumber' && <TableHeaderCell className={s.headerCell} style={{ width: 150 }}>Project ID</TableHeaderCell>}
                  <TableHeaderCell className={s.headerCell} style={{ width: 110 }}>Start</TableHeaderCell>
                  <TableHeaderCell className={s.headerCell} style={{ width: 110 }}>Finish</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(p => {
                  const checked = app.selectedIds.includes(p.msdyn_projectid);
                  const key = p[keyField];
                  return (
                    <TableRow key={p.msdyn_projectid} className={s.row} onClick={() => toggle(p.msdyn_projectid)} aria-selected={checked}>
                      <TableCell><Checkbox checked={checked} onChange={() => toggle(p.msdyn_projectid)} onClick={e => e.stopPropagation()} aria-label={`Select ${p.msdyn_subject}`} /></TableCell>
                      <TableCell><Text weight={checked ? 'semibold' : 'regular'}>{p.msdyn_subject}</Text></TableCell>
                      {config.mode === 'existing' && <TableCell>{key == null || key === '' ? <span className={s.muted}>empty</span> : <span className={s.key}>{String(key)}</span>}</TableCell>}
                      {keyField !== 'msdyn_projectnumber' && <TableCell><span className={s.key}>{p.msdyn_projectnumber || '—'}</span></TableCell>}
                      <TableCell>{formatDate(p.msdyn_scheduledstart)}</TableCell>
                      <TableCell>{formatDate(p.msdyn_finish)}</TableCell>
                    </TableRow>
                  );
                })}
                {!filtered.length && (
                  <TableRow><TableCell colSpan={6}><span className={s.muted}>No projects match.</span></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}
