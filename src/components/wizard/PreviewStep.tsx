/**
 * Step 2: Preview entities and run validation
 */

import { useState, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Spinner,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  Badge,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components';
import { TaskTreeView } from '../preview/TaskTreeView';
import { TeamMemberList } from '../preview/TeamMemberList';
import { EntityCountSummary } from '../preview/EntityCountSummary';
import { UseMigrationWizardReturn } from '../../hooks/useMigrationWizard';
import { UseMigrationReturn } from '../../hooks/useMigration';
import { SourceProjectData } from '../../types/migration';
import { ValidationResult } from '../../types/ui';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  validationSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
});

interface PreviewStepProps {
  wizard: UseMigrationWizardReturn;
  migration: UseMigrationReturn;
}

export function PreviewStep({ wizard, migration }: PreviewStepProps) {
  const styles = useStyles();
  const [isLoading, setIsLoading] = useState(false);
  const [localValidation, setLocalValidation] = useState<Map<string, ValidationResult>>(new Map());

  // Load full project data for selected projects
  useEffect(() => {
    const loadData = async () => {
      // Data already loaded — skip
      if (wizard.state.projectData.size >= wizard.state.selectedProjectIds.length) return;

      // We'd need sourceService here. In the real flow, the parent page
      // should have loaded data before proceeding to preview.
      // This is handled by MigrationPage.
    };
    loadData();
  }, [wizard.state.selectedProjectIds, wizard.state.projectData.size]);

  // Filter projectData to only include selected projects
  const selectedProjectData = new Map(
    wizard.state.selectedProjectIds
      .filter(id => wizard.state.projectData.has(id))
      .map(id => [id, wizard.state.projectData.get(id)!])
  );

  // Run validation when data is available
  useEffect(() => {
    if (selectedProjectData.size > 0) {
      const results = migration.validate(selectedProjectData);
      setLocalValidation(results);
    }
  }, [wizard.state.projectData, wizard.state.selectedProjectIds, migration.validate]);

  return (
    <div className={styles.container}>
      <Text size={500} weight="semibold">
        Preview & Validate ({wizard.state.selectedProjectIds.length} project(s))
      </Text>

      {isLoading ? (
        <Spinner label="Loading project details..." />
      ) : (
        <Accordion multiple collapsible>
          {Array.from(selectedProjectData.entries()).map(([projectId, data]) => {
            const validation = localValidation.get(projectId);
            const errorCount = validation?.issues.filter(i => i.severity === 'error').length || 0;
            const warnCount = validation?.issues.filter(i => i.severity === 'warning').length || 0;

            return (
              <AccordionItem key={projectId} value={projectId}>
                <AccordionHeader>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Text weight="semibold">{data.project.msdyn_subject}</Text>
                    <EntityCountSummary
                      tasks={data.tasks.length}
                      teamMembers={data.teamMembers.length}
                      dependencies={data.dependencies.length}
                      assignments={data.assignments.length}
                      buckets={data.buckets.length}
                      sprints={data.sprints.length}
                    />
                    {errorCount > 0 && (
                      <Badge appearance="filled" color="danger">{errorCount} errors</Badge>
                    )}
                    {warnCount > 0 && (
                      <Badge appearance="filled" color="warning">{warnCount} warnings</Badge>
                    )}
                  </div>
                </AccordionHeader>
                <AccordionPanel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>
                    {/* Validation messages */}
                    {validation && validation.issues.length > 0 && (
                      <div className={styles.validationSection}>
                        {validation.issues.map((issue, idx) => (
                          <MessageBar
                            key={idx}
                            intent={issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}
                          >
                            <MessageBarBody>
                              <MessageBarTitle>
                                {issue.entityType ? `[${issue.entityType}]` : ''} {issue.entityName || ''}
                              </MessageBarTitle>
                              {issue.message}
                            </MessageBarBody>
                          </MessageBar>
                        ))}
                      </div>
                    )}

                    {/* Task tree */}
                    <div>
                      <Text weight="semibold" size={400}>Tasks ({data.tasks.length})</Text>
                      <TaskTreeView tasks={data.tasks} />
                    </div>

                    {/* Team members */}
                    <div>
                      <Text weight="semibold" size={400}>Team Members ({data.teamMembers.length})</Text>
                      <TeamMemberList teamMembers={data.teamMembers} />
                    </div>

                    {/* Dependencies summary */}
                    <div>
                      <Text weight="semibold" size={400}>Dependencies ({data.dependencies.length})</Text>
                      {data.dependencies.length === 0 ? (
                        <Text size={200}>No dependencies</Text>
                      ) : (
                        <Text size={200}>{data.dependencies.length} task dependencies will be migrated</Text>
                      )}
                    </div>

                    {/* Assignments summary */}
                    <div>
                      <Text weight="semibold" size={400}>Assignments ({data.assignments.length})</Text>
                      {data.assignments.length === 0 ? (
                        <Text size={200}>No resource assignments</Text>
                      ) : (
                        <Text size={200}>{data.assignments.length} resource assignments will be migrated</Text>
                      )}
                    </div>
                  </div>
                </AccordionPanel>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
