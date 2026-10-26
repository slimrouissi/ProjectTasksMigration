import type { ReactNode } from 'react';
import { makeStyles, mergeClasses, shorthands, tokens, Text } from '@fluentui/react-components';
import {
  CheckmarkCircle20Filled,
  Warning20Filled,
  DismissCircle20Filled,
  Info20Filled,
} from '@fluentui/react-icons';
import type { CheckStatus, ReadinessCheck } from '../../types/migration';

const useStyles = makeStyles({
  section: {
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.borderRadius(tokens.borderRadiusXLarge),
    boxShadow: tokens.shadow4,
    ...shorthands.padding('20px', '24px'),
    display: 'flex',
    flexDirection: 'column',
    rowGap: '14px',
  },
  sectionHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', columnGap: '16px' },
  sectionTitle: { display: 'flex', alignItems: 'center', columnGap: '10px' },
  sectionIcon: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px',
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
    backgroundColor: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1, flexShrink: 0,
  },
  subtitle: { color: tokens.colorNeutralForeground3, display: 'block', marginTop: '2px' },
  actions: { display: 'flex', columnGap: '8px', alignItems: 'center', flexShrink: 0 },

  checks: { display: 'flex', flexDirection: 'column', rowGap: '2px' },
  check: { display: 'grid', gridTemplateColumns: '24px 1fr', columnGap: '10px', ...shorthands.padding('8px', '10px'), ...shorthands.borderRadius(tokens.borderRadiusMedium) },
  checkFail: { backgroundColor: tokens.colorPaletteRedBackground1 },
  checkWarn: { backgroundColor: tokens.colorPaletteYellowBackground1 },
  checkBody: { display: 'flex', flexDirection: 'column', rowGap: '2px', minWidth: 0 },
  detail: { color: tokens.colorNeutralForeground2 },
  fix: { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },

  pass: { color: tokens.colorPaletteGreenForeground1 },
  warn: { color: tokens.colorPaletteMarigoldForeground1 },
  fail: { color: tokens.colorPaletteRedForeground1 },
  info: { color: tokens.colorBrandForeground1 },

  tile: {
    display: 'flex', flexDirection: 'column', rowGap: '2px', ...shorthands.padding('14px', '16px'),
    ...shorthands.borderRadius(tokens.borderRadiusLarge), backgroundColor: tokens.colorNeutralBackground2, minWidth: '140px', flex: 1,
  },
  tileValue: { fontSize: '26px', lineHeight: '32px', fontWeight: tokens.fontWeightSemibold },
  tileLabel: { color: tokens.colorNeutralForeground3 },

  choice: {
    display: 'flex', columnGap: '12px', alignItems: 'flex-start', cursor: 'pointer', textAlign: 'left',
    ...shorthands.padding('14px', '16px'), ...shorthands.borderRadius(tokens.borderRadiusLarge),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1), backgroundColor: tokens.colorNeutralBackground1, flex: 1,
    ':hover': { ...shorthands.borderColor(tokens.colorBrandStroke1) },
    ':focus-visible': { outlineStyle: 'solid', outlineWidth: '2px', outlineColor: tokens.colorStrokeFocus2 },
  },
  choiceSelected: { ...shorthands.border('2px', 'solid', tokens.colorBrandStroke1), backgroundColor: tokens.colorBrandBackground2, ...shorthands.padding('13px', '15px') },
  radio: {
    width: '18px', height: '18px', ...shorthands.borderRadius('50%'), ...shorthands.border('2px', 'solid', tokens.colorNeutralStrokeAccessible),
    flexShrink: 0, marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { ...shorthands.borderColor(tokens.colorBrandStroke1) },
  radioDot: { width: '8px', height: '8px', ...shorthands.borderRadius('50%'), backgroundColor: tokens.colorBrandBackground },
});

export function Section({ title, subtitle, icon, actions, children, className }: { title: string; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  const s = useStyles();
  return (
    <section className={mergeClasses(s.section, className)}>
      <div className={s.sectionHeader}>
        <div className={s.sectionTitle}>
          {icon && <span className={s.sectionIcon}>{icon}</span>}
          <div>
            <Text size={400} weight="semibold">{title}</Text>
            {subtitle && <Text size={200} className={s.subtitle}>{subtitle}</Text>}
          </div>
        </div>
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function StatusIcon({ status }: { status: CheckStatus }) {
  const s = useStyles();
  switch (status) {
    case 'pass': return <CheckmarkCircle20Filled className={s.pass} aria-label="Passed" />;
    case 'warn': return <Warning20Filled className={s.warn} aria-label="Warning" />;
    case 'fail': return <DismissCircle20Filled className={s.fail} aria-label="Needs action" />;
    default: return <Info20Filled className={s.info} aria-label="Information" />;
  }
}

export function CheckList({ checks }: { checks: ReadinessCheck[] }) {
  const s = useStyles();
  return (
    <div className={s.checks}>
      {checks.map(c => (
        <div key={`${c.projectId || 'g'}-${c.id}`} className={mergeClasses(s.check, c.status === 'fail' && s.checkFail, c.status === 'warn' && s.checkWarn)}>
          <StatusIcon status={c.status} />
          <div className={s.checkBody}>
            <Text weight="semibold">{c.title}</Text>
            {c.detail && <Text size={200} className={s.detail}>{c.detail}</Text>}
            {c.fix && <Text size={200} className={s.fix}>How to fix: <span style={{ fontWeight: 400 }}>{c.fix}</span></Text>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatTile({ value, label, tone }: { value: ReactNode; label: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const s = useStyles();
  const color = tone === 'good' ? tokens.colorPaletteGreenForeground1 : tone === 'warn' ? tokens.colorPaletteMarigoldForeground1 : tone === 'bad' ? tokens.colorPaletteRedForeground1 : undefined;
  return (
    <div className={s.tile}>
      <span className={s.tileValue} style={{ color }}>{value}</span>
      <Text size={200} className={s.tileLabel}>{label}</Text>
    </div>
  );
}

export function ChoiceCard({ selected, onSelect, title, description, badge }: { selected: boolean; onSelect: () => void; title: string; description: ReactNode; badge?: ReactNode }) {
  const s = useStyles();
  return (
    <button type="button" role="radio" aria-checked={selected} className={mergeClasses(s.choice, selected && s.choiceSelected)} onClick={onSelect}>
      <span className={mergeClasses(s.radio, selected && s.radioOn)}>{selected && <span className={s.radioDot} />}</span>
      <span style={{ display: 'flex', flexDirection: 'column', rowGap: '4px' }}>
        <span style={{ display: 'flex', alignItems: 'center', columnGap: '8px' }}>
          <Text weight="semibold">{title}</Text>
          {badge}
        </span>
        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{description}</Text>
      </span>
    </button>
  );
}
