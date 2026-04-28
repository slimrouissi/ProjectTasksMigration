/**
 * Step 3: Configure migration options
 */

import {
  makeStyles,
  tokens,
  Text,
  Field,
  RadioGroup,
  Radio,
  Input,
  Divider,
} from '@fluentui/react-components';
import { UseMigrationWizardReturn } from '../../hooks/useMigrationWizard';
import { NamingStrategy, DateStrategy, TeamMemberStrategy, ConflictStrategy } from '../../types/ui';

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
});

interface ConfigStepProps {
  wizard: UseMigrationWizardReturn;
}

export function ConfigStep({ wizard }: ConfigStepProps) {
  const styles = useStyles();
  const { config } = wizard.state;

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
