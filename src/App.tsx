/**
 * Root App component — sign-in screen, app header and main page
 */

import { AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react';
import { makeStyles, shorthands, tokens, Button, Text } from '@fluentui/react-components';
import { ArrowSwap20Regular, SignOut20Regular } from '@fluentui/react-icons';
import { MigrationPage } from './pages/MigrationPage';
import { useAuth } from './auth/useAuth';
import { SOURCE_ENV, TARGET_ENV } from './config/environments';
import { TOOL_VERSION } from './services/DiagnosticsService';

const useStyles = makeStyles({
  login: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', ...shorthands.padding('24px') },
  loginCard: {
    width: '100%', maxWidth: '520px', backgroundColor: tokens.colorNeutralBackground1, boxShadow: tokens.shadow16,
    ...shorthands.borderRadius(tokens.borderRadiusXLarge), ...shorthands.padding('36px'), display: 'flex', flexDirection: 'column', rowGap: '18px',
  },
  logo: {
    width: '44px', height: '44px', ...shorthands.borderRadius(tokens.borderRadiusXLarge), display: 'flex', alignItems: 'center', justifyContent: 'center',
    backgroundColor: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand,
  },
  envs: { display: 'flex', flexDirection: 'column', rowGap: '4px', ...shorthands.padding('12px', '14px'), backgroundColor: tokens.colorNeutralBackground2, ...shorthands.borderRadius(tokens.borderRadiusLarge) },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: '12px' },
  header: { position: 'sticky', top: 0, zIndex: 20, backgroundColor: tokens.colorNeutralBackground1, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  headerInner: { maxWidth: '1360px', ...shorthands.margin('0', 'auto'), ...shorthands.padding('10px', '28px'), display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  brand: { display: 'flex', alignItems: 'center', columnGap: '10px' },
  smallLogo: {
    width: '30px', height: '30px', ...shorthands.borderRadius(tokens.borderRadiusLarge), display: 'flex', alignItems: 'center', justifyContent: 'center',
    backgroundColor: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand,
  },
  muted: { color: tokens.colorNeutralForeground3 },
  user: { display: 'flex', alignItems: 'center', columnGap: '8px' },
});

function App() {
  const s = useStyles();
  const { login, logout, userName } = useAuth();

  return (
    <>
      <UnauthenticatedTemplate>
        <div className={s.login}>
          <div className={s.loginCard}>
            <div className={s.logo}><ArrowSwap20Regular /></div>
            <div>
              <Text size={600} weight="semibold" block>Project Tasks Migration</Text>
              <Text className={s.muted}>Copy tasks, team members, assignments with planned hours, and RAID records between Dynamics 365 Project Operations environments.</Text>
            </div>
            <div className={s.envs}>
              <Text size={200} className={s.muted}>From</Text>
              <span className={s.mono}>{SOURCE_ENV.url || 'VITE_SOURCE_URL not set'}</span>
              <Text size={200} className={s.muted}>To</Text>
              <span className={s.mono}>{TARGET_ENV.url || 'VITE_TARGET_URL not set'}</span>
            </div>
            <Button appearance="primary" size="large" onClick={login}>Sign in with Microsoft</Button>
            <Text size={200} className={s.muted}>Sign in with an account that's a user in both environments and has a Project Operations licence. Nothing is written until you start the run.</Text>
          </div>
        </div>
      </UnauthenticatedTemplate>

      <AuthenticatedTemplate>
        <header className={s.header}>
          <div className={s.headerInner}>
            <div className={s.brand}>
              <span className={s.smallLogo}><ArrowSwap20Regular /></span>
              <div>
                <Text weight="semibold" block>Project Tasks Migration</Text>
                <Text size={100} className={s.muted}>Dynamics 365 Project Operations · v{TOOL_VERSION}</Text>
              </div>
            </div>
            <div className={s.user}>
              <Text size={200}>{userName}</Text>
              <Button appearance="subtle" size="small" icon={<SignOut20Regular />} onClick={logout}>Sign out</Button>
            </div>
          </div>
        </header>
        <MigrationPage />
      </AuthenticatedTemplate>
    </>
  );
}

export default App;
