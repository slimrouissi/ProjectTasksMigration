import { makeStyles, mergeClasses, shorthands, tokens, Text } from '@fluentui/react-components';
import { Checkmark16Filled } from '@fluentui/react-icons';
import { WizardStep, WIZARD_STEPS, WIZARD_STEP_HINTS, WIZARD_STEP_LABELS } from '../../types/ui';

const useStyles = makeStyles({
  nav: { display: 'grid', gridTemplateColumns: `repeat(${WIZARD_STEPS.length}, 1fr)`, columnGap: '8px' },
  step: {
    display: 'flex', columnGap: '10px', alignItems: 'flex-start', textAlign: 'left', ...shorthands.padding('10px', '12px'),
    ...shorthands.borderRadius(tokens.borderRadiusLarge), ...shorthands.border('0'), backgroundColor: 'transparent', cursor: 'pointer',
    borderTopWidth: '3px', borderTopStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2,
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    ':disabled': { cursor: 'default', ':hover': { backgroundColor: 'transparent' } },
  },
  active: { borderTopColor: tokens.colorBrandStroke1, backgroundColor: tokens.colorNeutralBackground1 },
  done: { borderTopColor: tokens.colorPaletteGreenBorder2 },
  num: {
    width: '24px', height: '24px', ...shorthands.borderRadius('50%'), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    fontSize: '12px', fontWeight: tokens.fontWeightSemibold, backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground2,
  },
  numActive: { backgroundColor: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand },
  numDone: { backgroundColor: tokens.colorPaletteGreenBackground3, color: tokens.colorNeutralForegroundOnBrand },
  hint: { color: tokens.colorNeutralForeground3, display: 'block' },
});

export function Stepper({ current, onSelect, canSelect }: { current: WizardStep; onSelect: (s: WizardStep) => void; canSelect: (s: WizardStep) => boolean }) {
  const s = useStyles();
  const currentIndex = WIZARD_STEPS.indexOf(current);
  return (
    <nav className={s.nav} aria-label="Migration steps">
      {WIZARD_STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <button
            key={step}
            type="button"
            className={mergeClasses(s.step, active && s.active, done && s.done)}
            onClick={() => onSelect(step)}
            disabled={!canSelect(step)}
            aria-current={active ? 'step' : undefined}
          >
            <span className={mergeClasses(s.num, active && s.numActive, done && s.numDone)}>{done ? <Checkmark16Filled /> : i + 1}</span>
            <span>
              <Text weight="semibold" size={300}>{WIZARD_STEP_LABELS[step]}</Text>
              <Text size={200} className={s.hint}>{WIZARD_STEP_HINTS[step]}</Text>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
