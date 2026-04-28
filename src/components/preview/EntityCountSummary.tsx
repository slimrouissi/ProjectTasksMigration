/**
 * Inline badge display of entity counts
 */

import { Badge, makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    flexWrap: 'wrap',
  },
});

interface EntityCountSummaryProps {
  tasks: number;
  teamMembers: number;
  dependencies: number;
  assignments: number;
  buckets: number;
  sprints: number;
}

export function EntityCountSummary({
  tasks,
  teamMembers,
  dependencies,
  assignments,
  buckets,
  sprints,
}: EntityCountSummaryProps) {
  const styles = useStyles();

  return (
    <div className={styles.container}>
      <Badge appearance="filled" color="brand">{tasks} tasks</Badge>
      <Badge appearance="filled" color="success">{teamMembers} team</Badge>
      <Badge appearance="filled" color="warning">{dependencies} deps</Badge>
      <Badge appearance="filled" color="danger">{assignments} assign</Badge>
      {buckets > 0 && <Badge appearance="filled" color="informative">{buckets} buckets</Badge>}
      {sprints > 0 && <Badge appearance="filled" color="subtle">{sprints} sprints</Badge>}
    </div>
  );
}
