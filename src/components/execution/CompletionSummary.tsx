/**
 * Final migration report with entity counts and results per project
 */

import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Card,
  CardHeader,
  Divider,
} from '@fluentui/react-components';
import {
  CheckmarkCircle24Regular,
  DismissCircle24Regular,
} from '@fluentui/react-icons';
import { MigrationResult, ProjectMigrationResult } from '../../types/ui';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  summaryHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusMedium,
  },
  successHeader: {
    backgroundColor: tokens.colorPaletteGreenBackground1,
  },
  failedHeader: {
    backgroundColor: tokens.colorPaletteRedBackground1,
  },
  projectCard: {
    marginBottom: tokens.spacingVerticalS,
  },
  entityGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} 0`,
  },
  entityCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: tokens.spacingVerticalXS,
  },
});

interface CompletionSummaryProps {
  result: MigrationResult;
}

export function CompletionSummary({ result }: CompletionSummaryProps) {
  const styles = useStyles();

  const successCount = result.projectResults.filter(r => r.success).length;
  const totalCount = result.projectResults.length;
  const duration = (result.totalDuration / 1000).toFixed(1);

  return (
    <div className={styles.container}>
      <div className={`${styles.summaryHeader} ${result.success ? styles.successHeader : styles.failedHeader}`}>
        {result.success ? <CheckmarkCircle24Regular /> : <DismissCircle24Regular />}
        <div>
          <Text size={500} weight="semibold">
            {result.success ? 'Migration Completed Successfully' : 'Migration Completed with Errors'}
          </Text>
          <br />
          <Text size={300}>
            {successCount}/{totalCount} projects migrated in {duration}s
          </Text>
        </div>
      </div>

      <Divider />

      {result.projectResults.map((pr, idx) => (
        <ProjectResultCard key={idx} result={pr} />
      ))}
    </div>
  );
}

function ProjectResultCard({ result }: { result: ProjectMigrationResult }) {
  const styles = useStyles();
  const duration = (result.duration / 1000).toFixed(1);

  return (
    <Card className={styles.projectCard}>
      <CardHeader
        image={result.success ? <CheckmarkCircle24Regular /> : <DismissCircle24Regular />}
        header={
          <Text weight="semibold">{result.sourceProjectName}</Text>
        }
        description={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Badge appearance="filled" color={result.success ? 'success' : 'danger'}>
              {result.success ? 'Success' : 'Failed'}
            </Badge>
            <Text size={200}>{duration}s</Text>
            {result.targetProjectId && (
              <Text size={200}>Target ID: {result.targetProjectId}</Text>
            )}
          </div>
        }
      />
      <div className={styles.entityGrid}>
        {Object.entries(result.entityCounts).map(([type, counts]) => (
          <div key={type} className={styles.entityCell}>
            <Text size={200} weight="semibold">{type}</Text>
            <Text size={200}>
              {counts.succeeded}/{counts.attempted}
            </Text>
          </div>
        ))}
      </div>
      {result.errors.length > 0 && (
        <div style={{ padding: tokens.spacingVerticalS }}>
          <Text size={200} weight="semibold" style={{ color: tokens.colorPaletteRedForeground1 }}>
            Errors:
          </Text>
          {result.errors.map((err, idx) => (
            <Text key={idx} size={200} block style={{ color: tokens.colorPaletteRedForeground1 }}>
              [{err.stage}] {err.message}
            </Text>
          ))}
        </div>
      )}
    </Card>
  );
}
