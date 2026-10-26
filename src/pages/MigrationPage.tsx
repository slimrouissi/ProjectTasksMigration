import { makeStyles, shorthands, tokens, Button, Text, MessageBar, MessageBarBody, MessageBarTitle, Spinner } from '@fluentui/react-components';
import { ArrowLeft20Regular, ArrowRight20Regular } from '@fluentui/react-icons';
import { useEnvironments } from '../hooks/useEnvironments';
import { useMigrationApp } from '../hooks/useMigrationApp';
import { EnvironmentBar } from '../components/layout/EnvironmentBar';
import { Stepper } from '../components/layout/Stepper';
import { ProjectsStep } from '../components/steps/ProjectsStep';
import { OptionsStep } from '../components/steps/OptionsStep';
import { ReadinessStep } from '../components/steps/ReadinessStep';
import { RunStep } from '../components/steps/RunStep';
import { WizardStep, WIZARD_STEPS } from '../types/ui';

const useStyles = makeStyles({
  page: { display: 'flex', flexDirection: 'column', rowGap: '16px', ...shorthands.padding('20px', '28px', '96px'), maxWidth: '1360px', width: '100%', ...shorthands.margin('0', 'auto') },
  footer: {
    position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 10, backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`, boxShadow: tokens.shadow8,
  },
  footerInner: { maxWidth: '1360px', ...shorthands.margin('0', 'auto'), ...shorthands.padding('12px', '28px'), display: 'flex', alignItems: 'center', justifyContent: 'space-between', columnGap: '16px' },
  muted: { color: tokens.colorNeutralForeground3 },
  waiting: { display: 'flex', alignItems: 'center', justifyContent: 'center', ...shorthands.padding('64px') },
});

export function MigrationPage() {
  const s = useStyles();
  const env = useEnvironments();
  const app = useMigrationApp(env);
  const { step, stepIndex } = app;

  const hasSelection = app.selectedIds.length > 0;
  const canSelect = (target: WizardStep) => {
    const i = WIZARD_STEPS.indexOf(target);
    if (app.running) return target === 'run';
    if (i === 0) return true;
    if (!hasSelection) return false;
    if (target === 'run') return !!app.planning && !app.planningStale;
    return true;
  };

  const next = WIZARD_STEPS[stepIndex + 1];
  const prev = WIZARD_STEPS[stepIndex - 1];
  const nextDisabled = !next || !canSelect(next) || (step === 'readiness' && (app.planningBusy || !app.planning));
  const nextLabel = step === 'projects' ? 'Options' : step === 'options' ? 'Check readiness' : step === 'readiness' ? 'Continue to run' : '';
  const footerNote =
    step === 'projects' ? (hasSelection ? `${app.selectedIds.length} project(s) selected` : 'Select at least one project') :
    step === 'readiness' && app.planning ? `${app.planning.plans.filter(p => !p.checks.some(c => c.status === 'fail')).length} of ${app.planning.plans.length} project(s) ready` : '';

  return (
    <>
      <div className={s.page}>
        <EnvironmentBar env={env} />
        {!env.isReady ? (
          env.isChecking || env.source.status === 'connecting' || env.target.status === 'connecting' ? (
            <div className={s.waiting}><Spinner label="Connecting to both environments…" /></div>
          ) : (
            <MessageBar intent="error">
              <MessageBarBody>
                <MessageBarTitle>Both environments must be connected</MessageBarTitle>
                Fix the connection error shown above, then select the refresh button. The URLs come from VITE_SOURCE_URL and VITE_TARGET_URL in the .env file.
              </MessageBarBody>
            </MessageBar>
          )
        ) : (
          <>
            <Stepper current={step} onSelect={app.goTo} canSelect={canSelect} />
            {step === 'projects' && <ProjectsStep app={app} env={env} />}
            {step === 'options' && <OptionsStep app={app} env={env} />}
            {step === 'readiness' && <ReadinessStep app={app} env={env} />}
            {step === 'run' && <RunStep app={app} env={env} />}
          </>
        )}
      </div>

      {env.isReady && (
        <footer className={s.footer}>
          <div className={s.footerInner}>
            <Button appearance="secondary" icon={<ArrowLeft20Regular />} disabled={!prev || app.running} onClick={() => prev && app.goTo(prev)}>Back</Button>
            <Text size={200} className={s.muted}>{footerNote}</Text>
            {next ? (
              <Button appearance="primary" icon={<ArrowRight20Regular />} iconPosition="after" disabled={nextDisabled} onClick={() => app.goTo(next)}>{nextLabel}</Button>
            ) : <span />}
          </div>
        </footer>
      )}
    </>
  );
}
