/**
 * Environment configuration for source and destination environments
 */

export interface EnvironmentConfig {
  name: string;
  url: string;
  scope: string;                   // MSAL scope for token acquisition
  apiBase: string;                 // Full Web API base URL
}

/** Normalize a Dataverse URL (trim, add https://, drop trailing slash and any path) */
export function normalizeEnvironmentUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return withScheme.replace(/\/+$/, '');
  }
}

export function createEnvironmentConfig(name: string, url: string): EnvironmentConfig {
  const base = normalizeEnvironmentUrl(url);
  return {
    name,
    url: base,
    scope: `${base}/.default`,
    apiBase: `${base}/api/data/v9.2`,
  };
}

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};

export const SOURCE_ENV: EnvironmentConfig = createEnvironmentConfig('Source', env.VITE_SOURCE_URL || '');
export const TARGET_ENV: EnvironmentConfig = createEnvironmentConfig('Target', env.VITE_TARGET_URL || '');
