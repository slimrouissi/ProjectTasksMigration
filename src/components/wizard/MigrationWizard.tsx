/**
 * 4-step wizard container with step navigation
 */

import {
  makeStyles,
  tokens,
  Button,
  Divider,
  ProgressBar,
} from '@fluentui/react-components';
import {
  ArrowLeft24Regular,
  ArrowRight24Regular,
} from '@fluentui/react-icons';
import { WizardStep, WIZARD_STEPS, WIZARD_STEP_LABELS } from '../../types/ui';
import { ProjectSelectStep } from './ProjectSelectStep';
import { PreviewStep } from './PreviewStep';
import { ConfigStep } from './ConfigStep';
import { ExecuteStep } from './ExecuteStep';
import { UseMigrationWizardReturn } from '../../hooks/useMigrationWizard';
import { UseEnvironmentsReturn } from '../../hooks/useEnvironments';
import { UseMigrationReturn } from '../../hooks/useMigration';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    flex: 1,
  },
  stepIndicator: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center',
    padding: `${tokens.spacingVerticalS} 0`,
  },
  stepBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  stepActive: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  stepCompleted: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
    color: tokens.colorPaletteGreenForeground2,
  },
  stepPending: {
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground3,
  },
  stepConnector: {
    width: '24px',
    height: '2px',
    backgroundColor: tokens.colorNeutralStroke2,
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  },
  navigation: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: `${tokens.spacingVerticalM} 0`,
  },
});

interface MigrationWizardProps {
  wizard: UseMigrationWizardReturn;
  environments: UseEnvironmentsReturn;
  migration: UseMigrationReturn;
}

export function MigrationWizard({ wizard, environments, migration }: MigrationWizardProps) {
  const styles = useStyles();
  const { state, currentStepIndex, canGoNext, canGoPrev, goNext, goPrev } = wizard;

  const getStepClass = (step: WizardStep, index: number) => {
    if (index === currentStepIndex) return `${styles.stepBadge} ${styles.stepActive}`;
    if (index < currentStepIndex) return `${styles.stepBadge} ${styles.stepCompleted}`;
    return `${styles.stepBadge} ${styles.stepPending}`;
  };

  const canProceed = () => {
    switch (state.currentStep) {
      case 'select':
        return state.selectedProjectIds.length > 0;
      case 'preview':
        return state.projectData.size > 0;
      case 'config':
        return true;
      case 'execute':
        return false; // No "next" from execute
      default:
        return false;
    }
  };

  return (
    <div className={styles.container}>
      {/* Step indicator */}
      <div className={styles.stepIndicator}>
        {WIZARD_STEPS.map((step, index) => (
          <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {index > 0 && <div className={styles.stepConnector} />}
            <div className={getStepClass(step, index)}>
              {index + 1}. {WIZARD_STEP_LABELS[step]}
            </div>
          </div>
        ))}
      </div>

      <Divider />

      {/* Error display */}
      {state.error && (
        <div style={{ color: tokens.colorPaletteRedForeground1, padding: tokens.spacingVerticalS }}>
          {state.error}
        </div>
      )}

      {/* Step content */}
      <div className={styles.content}>
        {state.currentStep === 'select' && (
          <ProjectSelectStep wizard={wizard} environments={environments} />
        )}
        {state.currentStep === 'preview' && (
          <PreviewStep wizard={wizard} migration={migration} />
        )}
        {state.currentStep === 'config' && (
          <ConfigStep wizard={wizard} />
        )}
        {state.currentStep === 'execute' && (
          <ExecuteStep wizard={wizard} environments={environments} migration={migration} />
        )}
      </div>

      {/* Navigation */}
      <Divider />
      <div className={styles.navigation}>
        <Button
          appearance="secondary"
          icon={<ArrowLeft24Regular />}
          disabled={!canGoPrev || migration.isRunning}
          onClick={goPrev}
        >
          Back
        </Button>
        {state.currentStep !== 'execute' && (
          <Button
            appearance="primary"
            icon={<ArrowRight24Regular />}
            iconPosition="after"
            disabled={!canGoNext || !canProceed() || state.isLoading}
            onClick={goNext}
          >
            {state.currentStep === 'config' ? 'Start Migration' : 'Next'}
          </Button>
        )}
      </div>
    </div>
  );
}
