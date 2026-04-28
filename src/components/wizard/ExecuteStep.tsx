/**
 * Step 4: Execute migration with live progress
 */

import { useState, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Button,
  Spinner,
} from '@fluentui/react-components';
import {
  Play24Regular,
  ArrowReset24Regular,
} from '@fluentui/react-icons';
import { MigrationProgress } from '../execution/MigrationProgress';
import { OperationSetLog } from '../execution/OperationSetLog';
import { CompletionSummary } from '../execution/CompletionSummary';
import { UseMigrationWizardReturn } from '../../hooks/useMigrationWizard';
import { UseEnvironmentsReturn } from '../../hooks/useEnvironments';
import { UseMigrationReturn } from '../../hooks/useMigration';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  actions: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'center',
  },
});

interface ExecuteStepProps {
  wizard: UseMigrationWizardReturn;
  environments: UseEnvironmentsReturn;
  migration: UseMigrationReturn;
}

export function ExecuteStep({ wizard, environments, migration }: ExecuteStepProps) {
  const styles = useStyles();
  const [hasStarted, setHasStarted] = useState(false);

  const handleStart = useCallback(async () => {
    setHasStarted(true);
    try {
      await migration.execute(wizard.state.projectData, wizard.state.config);
    } catch (error) {
      console.error('ExecuteStep: Migration failed', error);
    }
  }, [migration, wizard.state.projectData, wizard.state.config]);

  const handleReset = useCallback(() => {
    setHasStarted(false);
    migration.reset();
    wizard.goToStep('select');
    wizard.reset();
  }, [migration, wizard]);

  return (
    <div className={styles.container}>
      <Text size={500} weight="semibold">
        Execute Migration
      </Text>

      {!hasStarted && (
        <div>
          <Text>
            Ready to migrate {wizard.state.selectedProjectIds.length} project(s) from{' '}
            <Text weight="semibold">{environments.sourceStatus.name}</Text> to{' '}
            <Text weight="semibold">{environments.targetStatus.name}</Text>.
          </Text>
          <div className={styles.actions} style={{ marginTop: tokens.spacingVerticalM }}>
            <Button
              appearance="primary"
              icon={<Play24Regular />}
              onClick={handleStart}
              disabled={!environments.isReady}
              size="large"
            >
              Start Migration
            </Button>
          </div>
        </div>
      )}

      {migration.isRunning && (
        <Spinner label="Migration in progress..." />
      )}

      {/* Progress */}
      {migration.progress && (
        <MigrationProgress progress={migration.progress} />
      )}

      {/* Live log */}
      {migration.progress && migration.progress.logs.length > 0 && (
        <OperationSetLog logs={migration.progress.logs} />
      )}

      {/* Completion summary */}
      {migration.result && (
        <>
          <CompletionSummary result={migration.result} />
          <div className={styles.actions}>
            <Button
              appearance="secondary"
              icon={<ArrowReset24Regular />}
              onClick={handleReset}
            >
              Start New Migration
            </Button>
            {migration.result.idMappings.length > 0 && (
              <Button
                appearance="primary"
                onClick={migration.exportIdMappings}
              >
                Export ID Mappings (JSON)
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
