/**
 * MSAL configuration for Azure AD authentication
 * Supports dual-environment token acquisition (source + destination)
 */

import { Configuration, LogLevel } from '@azure/msal-browser';

const CLIENT_ID = import.meta.env.VITE_CLIENT_ID || '';
const TENANT_ID = import.meta.env.VITE_TENANT_ID || '';

if (!CLIENT_ID) {
  console.warn('AuthConfig: VITE_CLIENT_ID is not set. Check your .env file.');
}

export const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level: LogLevel, message: string, containsPii: boolean) => {
        if (containsPii) return;
        switch (level) {
          case LogLevel.Error:
            console.error('MSAL:', message);
            break;
          case LogLevel.Warning:
            console.warn('MSAL:', message);
            break;
          case LogLevel.Info:
            console.log('MSAL:', message);
            break;
          case LogLevel.Verbose:
            console.debug('MSAL:', message);
            break;
        }
      },
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
    },
  },
};

/**
 * Login request scopes — request consent for both environments upfront
 */
export const loginRequest = {
  scopes: ['user.read'],
};
