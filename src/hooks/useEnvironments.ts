/**
 * Connects to both environments, identifies them (friendly name, version, user) and creates the services
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { DataverseClient } from '../clients/DataverseClient';
import { MigrationPlanner } from '../services/MigrationPlanner';
import { MigrationEngine } from '../services/MigrationEngine';
import { EnvironmentService } from '../services/EnvironmentService';
import { TargetCalendarService } from '../services/TargetCalendarService';
import { SOURCE_ENV, TARGET_ENV, EnvironmentConfig } from '../config/environments';
import type { OrganizationInfo } from '../types/migration';
import type { EnvironmentStatus } from '../types/ui';
import { useAuth } from '../auth/useAuth';
import { extractDataverseErrorMessage } from '../utils/dataverseErrors';

export interface UseEnvironmentsReturn {
  source: EnvironmentStatus;
  target: EnvironmentStatus;
  sourceInfo?: OrganizationInfo;
  targetInfo?: OrganizationInfo;
  sourceClient: DataverseClient | null;
  targetClient: DataverseClient | null;
  planner: MigrationPlanner | null;
  engine: MigrationEngine | null;
  calendars: TargetCalendarService | null;
  checkConnections: () => Promise<void>;
  isReady: boolean;
  isChecking: boolean;
}

/** Turn the most common connection failures into plain guidance */
export function explainConnectionError(raw: string, envName: string): string {
  const message = extractDataverseErrorMessage(raw);
  if (/0x80072560|not a member of the organization|notMemberOfOrg/i.test(raw)) {
    return `${message} — the signed-in account isn't a user of ${envName}. Add it to the environment's security group (an Entra group), or add the user in Power Platform admin center > Environments > ${envName} > Settings > Users.`;
  }
  if (/AADSTS9002326/i.test(raw)) {
    return `${message} — the app registration needs a "Single-page application" platform with redirect URI ${window.location.origin}.`;
  }
  if (/AADSTS65001|consent/i.test(raw)) {
    return `${message} — an admin must grant consent for the Dynamics CRM (user_impersonation) permission on the app registration.`;
  }
  if (/HTTP 401/i.test(raw)) return `${message} — the token was rejected. Sign out and back in.`;
  if (/HTTP 403/i.test(raw)) return `${message} — the account can sign in but lacks a security role in ${envName}.`;
  if (/Failed to fetch|NetworkError/i.test(raw)) return `${message} — check the environment URL (${envName}) and your network.`;
  return message;
}

const initial = (role: 'source' | 'target', env: EnvironmentConfig): EnvironmentStatus => ({ role, url: env.url, status: 'disconnected' });

export function useEnvironments(): UseEnvironmentsReturn {
  const { getToken, isAuthenticated } = useAuth();
  const [source, setSource] = useState<EnvironmentStatus>(initial('source', SOURCE_ENV));
  const [target, setTarget] = useState<EnvironmentStatus>(initial('target', TARGET_ENV));
  const [sourceInfo, setSourceInfo] = useState<OrganizationInfo>();
  const [targetInfo, setTargetInfo] = useState<OrganizationInfo>();
  const [isChecking, setIsChecking] = useState(false);

  const sourceClient = useMemo(() => (SOURCE_ENV.url ? new DataverseClient(SOURCE_ENV, getToken) : null), [getToken]);
  const targetClient = useMemo(() => (TARGET_ENV.url ? new DataverseClient(TARGET_ENV, getToken) : null), [getToken]);

  const connect = useCallback(async (
    role: 'source' | 'target',
    env: EnvironmentConfig,
    client: DataverseClient | null,
    setStatus: (s: EnvironmentStatus) => void,
    setInfo: (i: OrganizationInfo | undefined) => void
  ) => {
    if (!client) {
      setStatus({ role, url: '', status: 'error', error: `VITE_${role.toUpperCase()}_URL is not set in the .env file.` });
      return;
    }
    setStatus({ role, url: env.url, status: 'connecting' });
    const info = await new EnvironmentService(client).getOrganizationInfo();
    if (info.success && info.data) {
      setInfo(info.data);
      setStatus({
        role,
        url: env.url,
        status: 'connected',
        friendlyName: info.data.friendlyName,
        userId: info.data.userId,
        userName: info.data.userName,
        projectOperationsVersion: info.data.projectOperationsVersion,
        environmentId: info.data.environmentId,
      });
    } else {
      setInfo(undefined);
      setStatus({ role, url: env.url, status: 'error', error: explainConnectionError(info.error || 'Connection failed', env.url) });
    }
  }, []);

  const checkConnections = useCallback(async () => {
    setIsChecking(true);
    await Promise.all([
      connect('source', SOURCE_ENV, sourceClient, setSource, setSourceInfo),
      connect('target', TARGET_ENV, targetClient, setTarget, setTargetInfo),
    ]);
    setIsChecking(false);
  }, [connect, sourceClient, targetClient]);

  useEffect(() => {
    if (isAuthenticated) checkConnections();
  }, [isAuthenticated, checkConnections]);

  const isReady = source.status === 'connected' && target.status === 'connected';
  const planner = useMemo(() => (isReady && sourceClient && targetClient ? new MigrationPlanner(sourceClient, targetClient) : null), [isReady, sourceClient, targetClient]);
  const engine = useMemo(() => (isReady && sourceClient && targetClient ? new MigrationEngine(sourceClient, targetClient) : null), [isReady, sourceClient, targetClient]);
  const calendars = useMemo(() => (targetClient ? new TargetCalendarService(targetClient) : null), [targetClient]);

  return { source, target, sourceInfo, targetInfo, sourceClient, targetClient, planner, engine, calendars, checkConnections, isReady, isChecking };
}
