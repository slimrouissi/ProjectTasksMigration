/**
 * Hook for acquiring access tokens per environment
 * Wraps MSAL acquireTokenSilent with fallback to acquireTokenPopup
 */

import { useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError, SilentRequest } from '@azure/msal-browser';
import { EnvironmentConfig } from '../config/environments';

export interface UseAuthReturn {
  getToken: (env: EnvironmentConfig) => Promise<string>;
  login: () => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  userName?: string;
}

export function useAuth(): UseAuthReturn {
  const { instance, accounts } = useMsal();
  const account = accounts[0];

  const getToken = useCallback(
    async (env: EnvironmentConfig): Promise<string> => {
      if (!account) {
        throw new Error('No authenticated account. Please log in first.');
      }

      const request: SilentRequest = {
        scopes: [env.scope],
        account,
      };

      try {
        console.log(`useAuth: Acquiring token silently for ${env.name}`);
        const response = await instance.acquireTokenSilent(request);
        return response.accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          console.warn(`useAuth: Silent token failed for ${env.name}, falling back to popup`);
          const response = await instance.acquireTokenPopup({
            scopes: [env.scope],
          });
          return response.accessToken;
        }
        throw error;
      }
    },
    [instance, account]
  );

  const login = useCallback(async () => {
    console.log('useAuth: Initiating login');
    await instance.loginPopup({
      scopes: ['user.read'],
    });
  }, [instance]);

  const logout = useCallback(() => {
    console.log('useAuth: Logging out');
    instance.logoutPopup();
  }, [instance]);

  return {
    getToken,
    login,
    logout,
    isAuthenticated: accounts.length > 0,
    userName: account?.name,
  };
}
