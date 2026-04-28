/**
 * Top-level migration page — wires up environments, wizard, and migration hooks
 * Handles loading full project data when transitioning from Step 1 → Step 2
 */

import { useCallback, useEffect } from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Divider,
  Spinner,
} from '@fluentui/react-components';
import {
  PlugConnected24Regular,
  PlugDisconnected24Regular,
  ErrorCircle24Regular,
} from '@fluentui/react-icons';
import { MigrationWizard } from '../components/wizard/MigrationWizard';
import { useEnvironments } from '../hooks/useEnvironments';
import { useMigrationWizard } from '../hooks/useMigrationWizard';
import { useMigration } from '../hooks/useMigration';
import { ConnectionStatus, WizardStep } from '../types/ui';

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    padding: tokens.spacingVerticalL,
    gap: tokens.spacingVerticalM,
    maxWidth: '1200px',
    margin: '0 auto',
    width: '100%',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  envStatus: {
    display: 'flex',
    gap: tokens.spacingHorizontalL,
    alignItems: 'center',
  },
  envBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
  },
});

function ConnectionBadge({ name, status }: { name: string; status: ConnectionStatus }) {
  const styles = useStyles();

  const getColor = () => {
    switch (status) {
      case 'connected': return 'success' as const;
      case 'connecting': return 'informative' as const;
      case 'error': return 'danger' as const;
      default: return 'important' as const;
    }
  };

  const getIcon = () => {
    switch (status) {
      case 'connected': return <PlugConnected24Regular />;
      case 'error': return <ErrorCircle24Regular />;
      default: return <PlugDisconnected24Regular />;
    }
  };

  return (
    <div className={styles.envBadge}>
      {getIcon()}
      <Badge appearance="filled" color={getColor()}>
        {name}: {status}
      </Badge>
    </div>
  );
}

export function MigrationPage() {
  const styles = useStyles();
  const environments = useEnvironments();
  const wizard = useMigrationWizard();
  const migration = useMigration(environments.sourceService, environments.targetService);

  // Intercept step transitions to load data when needed
  const originalGoNext = wizard.goNext;
  const enhancedGoNext = useCallback(async () => {
    // When going from "select" to "preview", load full project data for any
    // selected projects not already cached (expanded projects are already cached)
    if (wizard.state.currentStep === 'select' && environments.sourceService) {
      wizard.setLoading(true);
      try {
        // First, fetch the project list so we have real project objects with names
        const projectsResult = await environments.sourceService.getProjects();
        const projectMap = new Map(
          (projectsResult.data || []).map(p => [p.msdyn_projectid, p])
        );

        for (const projectId of wizard.state.selectedProjectIds) {
          if (!wizard.state.projectData.has(projectId)) {
            const project = projectMap.get(projectId);
            if (!project) {
              console.warn(`MigrationPage: Project ${projectId} not found in source`);
              continue;
            }
            const allResult = await environments.sourceService.getFullProjectData(project);
            if (allResult.success && allResult.data) {
              wizard.setProjectData(projectId, allResult.data);
            }
          }
        }
      } catch (error) {
        wizard.setError(error instanceof Error ? error.message : 'Failed to load project data');
        wizard.setLoading(false);
        return;
      }
      wizard.setLoading(false);
    }
    originalGoNext();
  }, [wizard.state.currentStep, wizard.state.selectedProjectIds, environments.sourceService, originalGoNext]);

  // Override wizard.goNext with enhanced version
  const enhancedWizard = {
    ...wizard,
    goNext: enhancedGoNext,
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <Text size={700} weight="bold">
            Project Tasks Migration
          </Text>
          <br />
          <Text size={300}>
            Migrate D365 Project Operations data between environments
          </Text>
        </div>
        <div className={styles.envStatus}>
          <ConnectionBadge name={environments.sourceStatus.name} status={environments.sourceStatus.status} />
          <Text size={300}>→</Text>
          <ConnectionBadge name={environments.targetStatus.name} status={environments.targetStatus.status} />
        </div>
      </div>

      <Divider />

      {!environments.isReady && environments.sourceStatus.status !== 'connecting' && environments.targetStatus.status !== 'connecting' ? (
        <div style={{ textAlign: 'center', padding: tokens.spacingVerticalXXL }}>
          <Text size={400}>
            Waiting for environment connections...
          </Text>
          {environments.sourceStatus.error && (
            <Text block size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
              Source: {environments.sourceStatus.error}
            </Text>
          )}
          {environments.targetStatus.error && (
            <Text block size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
              Target: {environments.targetStatus.error}
            </Text>
          )}
        </div>
      ) : (
        <MigrationWizard
          wizard={enhancedWizard}
          environments={environments}
          migration={migration}
        />
      )}
    </div>
  );
}
