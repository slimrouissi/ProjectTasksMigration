import { makeStyles, mergeClasses, shorthands, tokens, Text, Button, Spinner, Tooltip } from '@fluentui/react-components';
import { ArrowRight20Regular, ArrowSync20Regular, Building20Regular, Person20Regular } from '@fluentui/react-icons';
import type { EnvironmentStatus } from '../../types/ui';
import type { UseEnvironmentsReturn } from '../../hooks/useEnvironments';

const useStyles = makeStyles({
  bar: { display: 'flex', alignItems: 'stretch', columnGap: '12px', flexWrap: 'wrap', rowGap: '12px' },
  card: {
    flex: '1 1 280px', display: 'flex', columnGap: '12px', alignItems: 'flex-start', minWidth: 0,
    ...shorthands.padding('12px', '16px'), ...shorthands.borderRadius(tokens.borderRadiusXLarge),
    backgroundColor: tokens.colorNeutralBackground1, boxShadow: tokens.shadow4,
    borderLeftWidth: '4px', borderLeftStyle: 'solid',
  },
  connected: { borderLeftColor: tokens.colorPaletteGreenBorder2 },
  connecting: { borderLeftColor: tokens.colorBrandStroke1 },
  error: { borderLeftColor: tokens.colorPaletteRedBorder2 },
  idle: { borderLeftColor: tokens.colorNeutralStroke1 },
  role: { textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '11px', fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground3 },
  name: { display: 'block', fontSize: '16px', fontWeight: tokens.fontWeightSemibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { display: 'flex', flexWrap: 'wrap', columnGap: '12px', rowGap: '2px', color: tokens.colorNeutralForeground3, fontSize: '12px', marginTop: '2px' },
  metaItem: { display: 'inline-flex', alignItems: 'center', columnGap: '4px', minWidth: 0 },
  arrow: { display: 'flex', alignItems: 'center', color: tokens.colorNeutralForeground3 },
  errorText: { color: tokens.colorPaletteRedForeground1, fontSize: '12px', display: 'block', marginTop: '4px' },
  icon: { color: tokens.colorNeutralForeground3, marginTop: '4px', flexShrink: 0 },
});

function EnvCard({ env }: { env: EnvironmentStatus }) {
  const s = useStyles();
  const host = env.url ? env.url.replace(/^https?:\/\//, '') : 'not configured';
  return (
    <div className={mergeClasses(s.card, s[env.status === 'disconnected' ? 'idle' : env.status])}>
      <Building20Regular className={s.icon} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <span className={s.role}>{env.role === 'source' ? 'Source (read only)' : 'Target (written to)'}</span>
        <span className={s.name} title={env.friendlyName || host}>
          {env.status === 'connecting' ? <Spinner size="extra-tiny" label="Connecting…" labelPosition="after" /> : env.friendlyName || host}
        </span>
        <div className={s.meta}>
          <span className={s.metaItem} title={env.url}>{host}</span>
          {env.userName && <span className={s.metaItem}><Person20Regular style={{ fontSize: 14 }} />{env.userName}</span>}
          {env.projectOperationsVersion && <span className={s.metaItem}>Project Operations {env.projectOperationsVersion}</span>}
        </div>
        {env.status === 'error' && <Text className={s.errorText}>{env.error}</Text>}
      </div>
    </div>
  );
}

export function EnvironmentBar({ env }: { env: UseEnvironmentsReturn }) {
  const s = useStyles();
  return (
    <div className={s.bar}>
      <EnvCard env={env.source} />
      <div className={s.arrow}><ArrowRight20Regular /></div>
      <EnvCard env={env.target} />
      <div className={s.arrow}>
        <Tooltip content="Check both connections again" relationship="label">
          <Button appearance="subtle" icon={<ArrowSync20Regular />} onClick={env.checkConnections} disabled={env.isChecking} />
        </Tooltip>
      </div>
    </div>
  );
}
