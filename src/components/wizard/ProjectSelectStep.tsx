/**
 * Step 1: Browse and select projects from source environment
 * Shows entity counts when selected, expandable detail panel on click
 */

import { useState, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Button,
  Spinner,
  Text,
  Checkbox,
  Badge,
  Card,
  CardHeader,
  Divider,
  TabList,
  Tab,
} from '@fluentui/react-components';
import {
  ArrowSync24Regular,
  ChevronDown24Regular,
  ChevronUp24Regular,
} from '@fluentui/react-icons';
import { SourceProject, EntityCounts, SourceProjectData } from '../../types/migration';
import { EntityCountSummary } from '../preview/EntityCountSummary';
import { TaskTreeView } from '../preview/TaskTreeView';
import { TeamMemberList } from '../preview/TeamMemberList';
import { UseMigrationWizardReturn } from '../../hooks/useMigrationWizard';
import { UseEnvironmentsReturn } from '../../hooks/useEnvironments';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  projectList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  projectCard: {
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  selectedCard: {
    borderLeftColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderTopColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftWidth: '2px',
    borderRightWidth: '2px',
    borderTopWidth: '2px',
    borderBottomWidth: '2px',
  },
  meta: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  countsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    paddingTop: tokens.spacingVerticalXS,
  },
  detailPanel: {
    paddingTop: tokens.spacingVerticalS,
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: tokens.spacingHorizontalL,
    paddingBottom: tokens.spacingVerticalM,
  },
  detailContent: {
    paddingTop: tokens.spacingVerticalS,
    maxHeight: '400px',
    overflowY: 'auto',
  },
  expandButton: {
    marginTop: tokens.spacingVerticalXS,
  },
  assignmentRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    fontSize: tokens.fontSizeBase200,
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.colorPalettePurpleBorderActive,
    borderRadius: tokens.borderRadiusSmall,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  depRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    fontSize: tokens.fontSizeBase200,
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.colorPaletteYellowBorderActive,
    borderRadius: tokens.borderRadiusSmall,
  },
});

type DetailTab = 'tasks' | 'team' | 'assignments' | 'dependencies';

interface ProjectSelectStepProps {
  wizard: UseMigrationWizardReturn;
  environments: UseEnvironmentsReturn;
}

export function ProjectSelectStep({ wizard, environments }: ProjectSelectStepProps) {
  const styles = useStyles();
  const [projects, setProjects] = useState<SourceProject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [entityCounts, setEntityCounts] = useState<Map<string, EntityCounts>>(new Map());
  const [loadingCounts, setLoadingCounts] = useState<Set<string>>(new Set());
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [projectDetails, setProjectDetails] = useState<Map<string, SourceProjectData>>(new Map());
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<DetailTab>('tasks');

  const loadProjects = useCallback(async () => {
    if (!environments.sourceService) return;

    setIsLoading(true);
    wizard.setLoading(true);

    try {
      const result = await environments.sourceService.getProjects();
      if (result.success && result.data) {
        setProjects(result.data);
      } else {
        wizard.setError(result.error || 'Failed to load projects');
      }
    } catch (error) {
      wizard.setError(error instanceof Error ? error.message : 'Failed to load projects');
    } finally {
      setIsLoading(false);
      wizard.setLoading(false);
    }
  }, [environments.sourceService, wizard]);

  // Load entity counts when a project is selected
  const loadEntityCounts = useCallback(async (projectId: string) => {
    if (!environments.sourceService || entityCounts.has(projectId)) return;

    setLoadingCounts(prev => new Set(prev).add(projectId));
    try {
      const result = await environments.sourceService.getEntityCounts(projectId);
      if (result.success && result.data) {
        setEntityCounts(prev => new Map(prev).set(projectId, result.data!));
      }
    } catch (error) {
      console.error(`Failed to load entity counts for ${projectId}`, error);
    } finally {
      setLoadingCounts(prev => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  }, [environments.sourceService, entityCounts]);

  // Load full project data for detail panel
  const loadProjectDetails = useCallback(async (projectId: string) => {
    if (!environments.sourceService || projectDetails.has(projectId) || loadingDetails.has(projectId)) return;

    const project = projects.find(p => p.msdyn_projectid === projectId);
    if (!project) return;

    setLoadingDetails(prev => new Set(prev).add(projectId));
    try {
      const result = await environments.sourceService.getFullProjectData(project);
      if (result.success && result.data) {
        setProjectDetails(prev => new Map(prev).set(projectId, result.data!));
        // Also store in wizard for later use in Step 2
        wizard.setProjectData(projectId, result.data);
      }
    } catch (error) {
      console.error(`Failed to load project details for ${projectId}`, error);
    } finally {
      setLoadingDetails(prev => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  }, [environments.sourceService, projectDetails, loadingDetails, projects, wizard]);

  // Load projects on mount
  useEffect(() => {
    if (environments.sourceService && projects.length === 0) {
      loadProjects();
    }
  }, [environments.sourceService]);

  // Load counts when selection changes
  useEffect(() => {
    for (const projectId of wizard.state.selectedProjectIds) {
      if (!entityCounts.has(projectId) && !loadingCounts.has(projectId)) {
        loadEntityCounts(projectId);
      }
    }
  }, [wizard.state.selectedProjectIds]);

  const handleToggle = useCallback((e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    wizard.toggleProject(projectId);
  }, [wizard]);

  const handleExpandToggle = useCallback((projectId: string) => {
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null);
    } else {
      setExpandedProjectId(projectId);
      setActiveTab('tasks');
      loadProjectDetails(projectId);
    }
  }, [expandedProjectId, loadProjectDetails]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text size={500} weight="semibold">
          Select projects to migrate from {environments.sourceStatus.name}
        </Text>
        <Button
          appearance="subtle"
          icon={<ArrowSync24Regular />}
          onClick={loadProjects}
          disabled={isLoading}
        >
          Refresh
        </Button>
      </div>

      {wizard.state.selectedProjectIds.length > 0 && (
        <Text>
          <Badge appearance="filled" color="brand">
            {wizard.state.selectedProjectIds.length}
          </Badge>{' '}
          project(s) selected
        </Text>
      )}

      {isLoading ? (
        <Spinner label="Loading projects from source environment..." />
      ) : (
        <div className={styles.projectList}>
          {projects.length === 0 ? (
            <Text>No active projects found in {environments.sourceStatus.name}.</Text>
          ) : (
            projects.map(project => {
              const projectId = project.msdyn_projectid;
              const isSelected = wizard.state.selectedProjectIds.includes(projectId);
              const counts = entityCounts.get(projectId);
              const isCountLoading = loadingCounts.has(projectId);
              const isExpanded = expandedProjectId === projectId;
              const details = projectDetails.get(projectId);
              const isDetailLoading = loadingDetails.has(projectId);

              return (
                <Card
                  key={projectId}
                  className={`${styles.projectCard} ${isSelected ? styles.selectedCard : ''}`}
                >
                  <CardHeader
                    onClick={() => handleExpandToggle(projectId)}
                    image={
                      <Checkbox
                        checked={isSelected}
                        onChange={(e) => handleToggle(e as any, projectId)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    }
                    header={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Text weight="semibold">{project.msdyn_subject}</Text>
                        {isExpanded ? <ChevronUp24Regular /> : <ChevronDown24Regular />}
                      </div>
                    }
                    description={
                      <div>
                        <div className={styles.meta}>
                          <span>Start: {formatDate(project.msdyn_scheduledstart)}</span>
                          <span>End: {formatDate(project.msdyn_scheduledend)}</span>
                          {project.msdyn_progress != null && (
                            <span>Progress: {Math.round(project.msdyn_progress)}%</span>
                          )}
                        </div>
                        {isSelected && (
                          <div className={styles.countsRow}>
                            {isCountLoading ? (
                              <Spinner size="tiny" label="Loading counts..." />
                            ) : counts ? (
                              <EntityCountSummary
                                tasks={counts.tasks}
                                teamMembers={counts.teamMembers}
                                dependencies={counts.dependencies}
                                assignments={counts.assignments}
                                buckets={counts.buckets}
                                sprints={counts.sprints}
                              />
                            ) : null}
                          </div>
                        )}
                      </div>
                    }
                  />

                  {/* Expandable detail panel */}
                  {isExpanded && (
                    <div className={styles.detailPanel}>
                      <Divider />
                      {isDetailLoading ? (
                        <div style={{ padding: tokens.spacingVerticalM }}>
                          <Spinner label="Loading project details..." />
                        </div>
                      ) : details ? (
                        <>
                          <TabList
                            selectedValue={activeTab}
                            onTabSelect={(_, data) => setActiveTab(data.value as DetailTab)}
                            size="small"
                          >
                            <Tab value="tasks">
                              Tasks ({details.tasks.length})
                            </Tab>
                            <Tab value="team">
                              Team ({details.teamMembers.length})
                            </Tab>
                            <Tab value="assignments">
                              Assignments ({details.assignments.length})
                            </Tab>
                            <Tab value="dependencies">
                              Dependencies ({details.dependencies.length})
                            </Tab>
                          </TabList>

                          <div className={styles.detailContent}>
                            {activeTab === 'tasks' && (
                              <TaskTreeView tasks={details.tasks} />
                            )}
                            {activeTab === 'team' && (
                              <TeamMemberList teamMembers={details.teamMembers} />
                            )}
                            {activeTab === 'assignments' && (
                              <AssignmentList
                                assignments={details.assignments}
                                tasks={details.tasks}
                                teamMembers={details.teamMembers}
                              />
                            )}
                            {activeTab === 'dependencies' && (
                              <DependencyList
                                dependencies={details.dependencies}
                                tasks={details.tasks}
                              />
                            )}
                          </div>
                        </>
                      ) : (
                        <Text size={200}>Click to load details</Text>
                      )}
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Inline assignment list — shows task name + team member name for each assignment
 */
function AssignmentList({
  assignments,
  tasks,
  teamMembers,
}: {
  assignments: SourceProjectData['assignments'];
  tasks: SourceProjectData['tasks'];
  teamMembers: SourceProjectData['teamMembers'];
}) {
  const styles = useStyles();

  if (assignments.length === 0) {
    return <Text size={200} style={{ padding: tokens.spacingVerticalS }}>No resource assignments</Text>;
  }

  const taskMap = new Map(tasks.map(t => [t.msdyn_projecttaskid, t.msdyn_subject]));
  const teamMap = new Map(teamMembers.map(m => [m.msdyn_projectteamid, m.msdyn_name]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: `${tokens.spacingVerticalS} 0` }}>
      {assignments.map(a => {
        const taskName = taskMap.get(a._msdyn_taskid_value) || a._msdyn_taskid_value;
        const memberName = a._msdyn_projectteamid_value
          ? teamMap.get(a._msdyn_projectteamid_value) || a._msdyn_projectteamid_value
          : '(unassigned)';

        return (
          <div key={a.msdyn_resourceassignmentid} className={styles.assignmentRow}>
            <Badge appearance="outline" size="small" color="brand">{taskName}</Badge>
            <Text size={200}>→</Text>
            <Badge appearance="outline" size="small" color="informative">{memberName}</Badge>
            {a.msdyn_plannedwork != null && (
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                {a.msdyn_plannedwork}h
              </Text>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Inline dependency list — shows predecessor → successor with link type
 */
function DependencyList({
  dependencies,
  tasks,
}: {
  dependencies: SourceProjectData['dependencies'];
  tasks: SourceProjectData['tasks'];
}) {
  const styles = useStyles();

  if (dependencies.length === 0) {
    return <Text size={200} style={{ padding: tokens.spacingVerticalS }}>No dependencies</Text>;
  }

  const taskMap = new Map(tasks.map(t => [t.msdyn_projecttaskid, t.msdyn_subject]));
  const linkTypeLabels: Record<number, string> = {
    192350000: 'FS',
    192350001: 'FF',
    192350002: 'SS',
    192350003: 'SF',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: `${tokens.spacingVerticalS} 0` }}>
      {dependencies.map(d => {
        const predName = taskMap.get(d._msdyn_predecessortask_value) || d._msdyn_predecessortask_value;
        const succName = taskMap.get(d._msdyn_successortask_value) || d._msdyn_successortask_value;
        const linkType = linkTypeLabels[d.msdyn_linktype] || `type:${d.msdyn_linktype}`;

        return (
          <div key={d.msdyn_projecttaskdependencyid} className={styles.depRow}>
            <Text size={200}>{predName}</Text>
            <Badge appearance="outline" size="small">{linkType}</Badge>
            <Text size={200}>→ {succName}</Text>
          </div>
        );
      })}
    </div>
  );
}
