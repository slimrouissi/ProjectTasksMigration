/**
 * Hierarchical task display (tree view by outline level)
 */

import { useMemo } from 'react';
import {
  makeStyles,
  tokens,
  Text,
} from '@fluentui/react-components';
import {
  TaskListSquareLtr24Regular,
} from '@fluentui/react-icons';
import { SourceTask } from '../../types/migration';
import { sortTasksTopologically } from '../../utils/taskSorter';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: `${tokens.spacingVerticalS} 0`,
  },
  taskRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusSmall,
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.colorBrandStroke1,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  taskName: {
    flex: 1,
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

interface TaskTreeViewProps {
  tasks: SourceTask[];
}

export function TaskTreeView({ tasks }: TaskTreeViewProps) {
  const styles = useStyles();

  const sortedTasks = useMemo(() => sortTasksTopologically(tasks), [tasks]);

  if (tasks.length === 0) {
    return <Text size={200}>No tasks</Text>;
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className={styles.container}>
      {sortedTasks.map(task => {
        const indent = ((task.msdyn_outlinelevel || 1) - 1) * 24;
        return (
          <div
            key={task.msdyn_projecttaskid}
            className={styles.taskRow}
            style={{ paddingLeft: `${indent + 8}px` }}
          >
            <TaskListSquareLtr24Regular />
            <Text className={styles.taskName} size={200}>
              {task.msdyn_wbsid && <span style={{ color: tokens.colorNeutralForeground3 }}>{task.msdyn_wbsid} </span>}
              {task.msdyn_subject}
            </Text>
            <span className={styles.meta}>
              {formatDate(task.msdyn_scheduledstart)}
              {task.msdyn_scheduledstart && task.msdyn_scheduledend && ' — '}
              {formatDate(task.msdyn_scheduledend)}
            </span>
            {task.msdyn_effort != null && (
              <span className={styles.meta}>{task.msdyn_effort}h</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
