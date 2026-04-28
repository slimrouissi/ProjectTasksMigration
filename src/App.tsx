/**
 * Root App component — auth gate + main page
 */

import {
  AuthenticatedTemplate,
  UnauthenticatedTemplate,
} from '@azure/msal-react';
import {
  makeStyles,
  tokens,
  Button,
  Text,
} from '@fluentui/react-components';
import { LockClosed24Regular } from '@fluentui/react-icons';
import { MigrationPage } from './pages/MigrationPage';
import { useAuth } from './auth/useAuth';

const useStyles = makeStyles({
  loginContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    gap: tokens.spacingVerticalL,
    padding: tokens.spacingVerticalXXL,
  },
  appHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
});

function App() {
  const styles = useStyles();
  const { login, logout, userName } = useAuth();

  return (
    <>
      <UnauthenticatedTemplate>
        <div className={styles.loginContainer}>
          <LockClosed24Regular style={{ fontSize: '48px' }} />
          <Text size={700} weight="bold">
            Project Tasks Migration
          </Text>
          <Text size={400}>
            Migrate D365 Project Operations data from source to destination environment
          </Text>
          <Button appearance="primary" size="large" onClick={login}>
            Sign in with Microsoft
          </Button>
        </div>
      </UnauthenticatedTemplate>

      <AuthenticatedTemplate>
        <div className={styles.appHeader}>
          <Text weight="semibold">Project Tasks Migration Tool</Text>
          <div className={styles.userInfo}>
            <Text size={200}>{userName}</Text>
            <Button appearance="subtle" size="small" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
        <MigrationPage />
      </AuthenticatedTemplate>
    </>
  );
}

export default App;
