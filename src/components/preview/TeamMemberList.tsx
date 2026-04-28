/**
 * Displays team members in a list
 */

import {
  makeStyles,
  tokens,
  Text,
} from '@fluentui/react-components';
import { Person24Regular } from '@fluentui/react-icons';
import { SourceTeamMember } from '../../types/migration';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: `${tokens.spacingVerticalS} 0`,
  },
  memberRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusSmall,
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.colorPaletteGreenBorderActive,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

interface TeamMemberListProps {
  teamMembers: SourceTeamMember[];
}

export function TeamMemberList({ teamMembers }: TeamMemberListProps) {
  const styles = useStyles();

  if (teamMembers.length === 0) {
    return <Text size={200}>No team members</Text>;
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className={styles.container}>
      {teamMembers.map(member => (
        <div key={member.msdyn_projectteamid} className={styles.memberRow}>
          <Person24Regular />
          <Text size={200}>{member.msdyn_name}</Text>
          {(member.msdyn_from || member.msdyn_to) && (
            <span className={styles.meta}>
              {formatDate(member.msdyn_from)}
              {member.msdyn_from && member.msdyn_to && ' — '}
              {formatDate(member.msdyn_to)}
            </span>
          )}
          {member.msdyn_hoursrequested != null && (
            <span className={styles.meta}>{member.msdyn_hoursrequested}h</span>
          )}
        </div>
      ))}
    </div>
  );
}
