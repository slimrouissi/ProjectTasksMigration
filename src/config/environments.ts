/**
 * Environment configuration for source and destination environments
 */

export interface EnvironmentConfig {
  name: string;
  url: string;
  scope: string;                   // MSAL scope for token acquisition
  apiBase: string;                 // Full Web API base URL
}

const SOURCE_URL = import.meta.env.VITE_SOURCE_URL || '';
const TARGET_URL = import.meta.env.VITE_TARGET_URL || '';

export const SOURCE_ENV: EnvironmentConfig = {
  name: 'Source Environment',
  url: SOURCE_URL,
  scope: `${SOURCE_URL}/.default`,
  apiBase: `${SOURCE_URL}/api/data/v9.2`,
};

export const TARGET_ENV: EnvironmentConfig = {
  name: 'Destination Environment',
  url: TARGET_URL,
  scope: `${TARGET_URL}/.default`,
  apiBase: `${TARGET_URL}/api/data/v9.2`,
};
