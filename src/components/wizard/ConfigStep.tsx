/**
 * Step 3: Configure migration options
 */

import { useState, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Field,
  RadioGroup,
  Radio,
  Input,
  Divider,
  Dropdown,
  Option,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components';
import { ArrowSync20Regular } from '@fluentui/react-icons';
import { UseMigrationWizardReturn } from '../../hooks/useMigrationWizard';
import { UseEnvironmentsReturn } from '../../hooks/useEnvironments';
import { NamingStrategy, DateStrategy, TeamMemberStrategy, ConflictStrategy } from '../../types/ui';
import { WorkHourTemplateCheck, WorkHourTemplateInfo, WorkHourTemplateStatus } from '../../types/migration';
import { isUsableTemplate, pickPreferredTemplate } from '../../services/TargetCalendarService';
import { CALENDAR_TEMPLATE_FIX_STEPS } from '../../utils/dataverseErrors';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    maxWidth: '600px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});

const TEMPLATE_STATUS_SUFFIX: Record<WorkHourTemplateStatus, string> = {
  valid: '',
  unknown: ' — calendar not verified',
  'missing-calendar': ' — calendar missing',
  'no-work-hours': ' — no work hours',
};

const CALENDAR_ERROR_TEXT = '"The calendar for the specified work hour template cannot be found"';

function templateLabel(template: WorkHourTemplateInfo): string {
  return `${template.name}${template.isDefault ? ' (default)' : ''}${TEMPLATE_STATUS_SUFFIX[template.status]}`;
}

interface ConfigStepProps {
  wizard: UseMigrationWizardReturn;
  environments: UseEnvironmentsReturn;
}

export function ConfigStep({ wizard, environments }: ConfigStepProps) {
  const styles = useStyles();
  const { config } = wizard.state;
  const { setConfig } = wizard;
  const calendarService = environments.targetCalendarService;

  const [templateCheck, setTemplateCheck] = useState<WorkHourTemplateCheck | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string>();

  const loadTemplates = useCallback(async () => {
    if (!calendarService) return;
    setTemplatesLoading(true);
    setTemplatesError(undefined);
    const result = await calendarService.getWorkHourTemplates();
    setTemplateCheck(result.success && result.data ? result.data : null);
    setTemplatesError(result.success ? undefined : result.error);
    setTemplatesLoading(false);
  }, [calendarService]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Preselect a usable template, keeping the user's choice if it still exists in the target
  useEffect(() => {
    if (!templateCheck) return;
    if (templateCheck.templates.some(t => t.id === config.workHourTemplateId)) return;
    const preferred = pickPreferredTemplate(templateCheck);
    if (preferred?.id !== config.workHourTemplateId) {
      setConfig({ workHourTemplateId: preferred?.id, workHourTemplateName: preferred?.name });
    }
  }, [templateCheck, config.workHourTemplateId, setConfig]);

  const templates = templateCheck?.templates || [];
  const selectedTemplate = templates.find(t => t.id === config.workHourTemplateId);
  const selectedIsBroken = !!selectedTemplate && !isUsableTemplate(selectedTemplate);
  const defaultTemplate = templates.find(t => t.isDefault);
  const hasUsableTemplate = templates.some(isUsableTemplate);
  const defaultIsBroken = !!defaultTemplate && !isUsableTemplate(defaultTemplate);
  const defaultIsInactive = !!templateCheck?.defaultTemplateId && !defaultTemplate;

  return (
    <div className={styles.container}>
      <Text size={500} weight="semibold">
        Configure Migration Options
      </Text>

      {/* Project Naming */}
      <div className={styles.section}>
        <Text size={400} weight="semibold">Project Naming</Text>
        <Field label="How should migrated projects be named?">
          <RadioGroup
            value={config.naming}
            onChange={(_, data) => wizard.setConfig({ naming: data.value as NamingStrategy })}
          >
            <Radio value="keep" label="Keep original names" />
            <Radio value="prefix" label="Add prefix to names" />
            <Radio value="custom" label="Custom rename (per project)" />
          </RadioGroup>
        </Field>
        {config.naming === 'prefix' && (
          <Field label="Prefix">
            <Input
              value={config.namePrefix || ''}
              onChange={(_, data) => wizard.setConfig({ namePrefix: data.value })}
              placeholder="[Migrated] "
            />
          </Field>
        )}
      </div>

      <Divider />

      {/* Date Handling */}
      <div className={styles.section}>
        <Text size={400} weight="semibold">Date Handling</Text>
        <Field label="How should dates be handled?">
          <RadioGroup
            value={config.dateHandling}
            onChange={(_, data) => wizard.setConfig({ dateHandling: data.value as DateStrategy })}
          >
            <Radio value="keep" label="Keep original dates" />
            <Radio value="shift" label="Shift dates relative to today (project starts today)" />
          </RadioGroup>
        </Field>
      </div>

      <Divider />

      {/* Project Calendar */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Text size={400} weight="semibold">Project Calendar</Text>
          <Button
            appearance="subtle"
            size="small"
            icon={templatesLoading ? <Spinner size="extra-tiny" /> : <ArrowSync20Regular />}
            onClick={loadTemplates}
            disabled={!calendarService || templatesLoading}
          >
            Re-check
          </Button>
        </div>
        <Field
          label="Which calendar template should new projects use?"
          hint="Sets each project's working days and hours. The template needs a valid calendar in the target environment."
        >
          <Dropdown
            placeholder={templatesLoading ? 'Checking calendar templates…' : 'Target default (Settings > Parameters)'}
            value={selectedTemplate ? templateLabel(selectedTemplate) : config.workHourTemplateName || ''}
            selectedOptions={config.workHourTemplateId ? [config.workHourTemplateId] : []}
            onOptionSelect={(_, data) => {
              const template = templates.find(t => t.id === data.optionValue);
              if (template) setConfig({ workHourTemplateId: template.id, workHourTemplateName: template.name });
            }}
            disabled={templatesLoading || templates.length === 0}
          >
            {templates.map(template => (
              <Option key={template.id} value={template.id} text={templateLabel(template)}>
                {templateLabel(template)}
              </Option>
            ))}
          </Dropdown>
        </Field>

        {!calendarService && (
          <MessageBar intent="info">
            <MessageBarBody>Connect to the target environment to check its calendar templates.</MessageBarBody>
          </MessageBar>
        )}

        {templatesError && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>Calendar templates could not be checked</MessageBarTitle>
              {templatesError}{' '}
              {config.workHourTemplateId
                ? `Projects will use the previously selected template "${config.workHourTemplateName || config.workHourTemplateId}".`
                : "Projects will use the target's Default Work Template (Settings > Parameters)."}
            </MessageBarBody>
          </MessageBar>
        )}

        {templateCheck && !hasUsableTemplate && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>No usable calendar template in the target</MessageBarTitle>
              {templates.length === 0
                ? 'The target has no active calendar templates, so new projects have no calendar to copy. '
                : `Every active template points to a missing calendar or has no work hours, so project creation fails (typically with ${CALENDAR_ERROR_TEXT}). `}
              {CALENDAR_TEMPLATE_FIX_STEPS} Then click Re-check.
            </MessageBarBody>
          </MessageBar>
        )}

        {hasUsableTemplate && defaultIsBroken && selectedTemplate?.id !== defaultTemplate.id && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>The target's default calendar template is broken</MessageBarTitle>
              "{defaultTemplate.name}": {defaultTemplate.statusDetail}.{' '}
              {defaultTemplate.status === 'missing-calendar' && `This is what causes ${CALENDAR_ERROR_TEXT}. `}
              {selectedTemplate && `This migration will use "${selectedTemplate.name}" instead. `}
              To fix the target itself, make a working template the Default Work Template in Settings &gt; Parameters.
            </MessageBarBody>
          </MessageBar>
        )}

        {defaultIsInactive && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>Default calendar template not found</MessageBarTitle>
              The Default Work Template in the target's Settings &gt; Parameters isn't an active calendar template.
              {selectedTemplate && ` This migration will use "${selectedTemplate.name}" instead.`}
            </MessageBarBody>
          </MessageBar>
        )}

        {selectedIsBroken && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>The selected template has no valid calendar</MessageBarTitle>
              {selectedTemplate.statusDetail}. Choose another template, or fix this one in the target and click Re-check.
            </MessageBarBody>
          </MessageBar>
        )}
      </div>

      <Divider />

      {/* Team Members */}
      <div className={styles.section}>
        <Text size={400} weight="semibold">Team Members</Text>
        <Field label="How should team members be handled?">
          <RadioGroup
            value={config.teamMembers}
            onChange={(_, data) => wizard.setConfig({ teamMembers: data.value as TeamMemberStrategy })}
          >
            <Radio value="generic" label="Create as generic team members" />
            <Radio value="match" label="Match by name in target environment" />
            <Radio value="skip" label="Skip team members (no assignments)" />
          </RadioGroup>
        </Field>
      </div>

      <Divider />

      {/* Conflict Handling */}
      <div className={styles.section}>
        <Text size={400} weight="semibold">Conflict Handling</Text>
        <Field label="What to do if a project with the same name exists in target?">
          <RadioGroup
            value={config.conflictHandling}
            onChange={(_, data) => wizard.setConfig({ conflictHandling: data.value as ConflictStrategy })}
          >
            <Radio value="skip" label="Skip if name exists in target" />
            <Radio value="duplicate" label="Create duplicate (different ID)" />
          </RadioGroup>
        </Field>
      </div>
    </div>
  );
}
