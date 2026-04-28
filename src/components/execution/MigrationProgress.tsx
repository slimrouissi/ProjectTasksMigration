/**
 * Progress bar with stage labels during migration execution
 */

import {
  makeStyles,
  tokens,
  Text,
  ProgressBar,
  Badge,
} from '@fluentui/react-components';
import { MigrationProgress as MigrationProgressType, MIGRATION_STAGE_LABELS } from '../../types/ui';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalM,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stageInfo: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center',
  },
});

interface MigrationProgressProps {
  progress: MigrationProgressType;
}

export function MigrationProgress({ progress }: MigrationProgressProps) {
  const styles = useStyles();

  const stageLabel = MIGRATION_STAGE_LABELS[progress.stage] || progress.stage;
  const isComplete = progress.stage === 'completed';
  const isFailed = progress.stage === 'failed';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.stageInfo}>
          <Text weight="semibold">
            {isComplete ? 'Migration Complete' : isFailed ? 'Migration Failed' : stageLabel}
          </Text>
          {progress.currentProject && !isComplete && (
            <Badge appearance="outline">{progress.currentProject}</Badge>
          )}
        </div>
        <Text size={200}>
          {progress.currentProjectIndex}/{progress.totalProjects} projects | {progress.overallProgress}%
        </Text>
      </div>

      <ProgressBar
        value={progress.overallProgress / 100}
        color={isFailed ? 'error' : isComplete ? 'success' : 'brand'}
      />

      {progress.stageProgress > 0 && progress.stageProgress < 100 && !isComplete && !isFailed && (
        <div>
          <Text size={200}>Stage progress: {Math.round(progress.stageProgress)}%</Text>
          <ProgressBar value={progress.stageProgress / 100} />
        </div>
      )}

      {progress.errors.length > 0 && (
        <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
          {progress.errors.length} error(s) encountered
        </Text>
      )}
    </div>
  );
}
