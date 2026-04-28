/**
 * Hook for managing environment connectivity status
 * Validates connection to both source and destination environments via WhoAmI
 */

import { useState, useCallback, useEffect } from 'react';
import { DataverseClient } from '../clients/DataverseClient';
import { ScheduleApiClient } from '../clients/ScheduleApiClient';
import { SourceService } from '../services/SourceService';
import { TargetService } from '../services/TargetService';
import { SOURCE_ENV, TARGET_ENV, EnvironmentConfig } from '../config/environments';
import { EnvironmentStatus, ConnectionStatus } from '../types/ui';
import { useAuth } from '../auth/useAuth';

export interface UseEnvironmentsReturn {
  sourceStatus: EnvironmentStatus;
  targetStatus: EnvironmentStatus;
  sourceClient: DataverseClient | null;
  targetClient: DataverseClient | null;
  sourceService: SourceService | null;
  targetService: TargetService | null;
  scheduleApiClient: ScheduleApiClient | null;
  checkConnections: () => Promise<void>;
  isReady: boolean;
}

export function useEnvironments(): UseEnvironmentsReturn {
  const { getToken, isAuthenticated } = useAuth();

  const [sourceStatus, setSourceStatus] = useState<EnvironmentStatus>({
    name: SOURCE_ENV.name,
    url: SOURCE_ENV.url,
    status: 'disconnected',
  });

  const [targetStatus, setTargetStatus] = useState<EnvironmentStatus>({
    name: TARGET_ENV.name,
    url: TARGET_ENV.url,
    status: 'disconnected',
  });

  const [sourceClient, setSourceClient] = useState<DataverseClient | null>(null);
  const [targetClient, setTargetClient] = useState<DataverseClient | null>(null);
  const [sourceService, setSourceService] = useState<SourceService | null>(null);
  const [targetService, setTargetService] = useState<TargetService | null>(null);
  const [scheduleApiClient, setScheduleApiClient] = useState<ScheduleApiClient | null>(null);

  const checkConnection = useCallback(
    async (
      env: EnvironmentConfig,
      setStatus: (s: EnvironmentStatus) => void
    ): Promise<DataverseClient | null> => {
      setStatus({ name: env.name, url: env.url, status: 'connecting' });

      try {
        const client = new DataverseClient(env, getToken);
        const result = await client.whoAmI();

        if (result.success && result.data) {
          setStatus({
            name: env.name,
            url: env.url,
            status: 'connected',
            userId: result.data.UserId,
          });
          return client;
        } else {
          setStatus({
            name: env.name,
            url: env.url,
            status: 'error',
            error: result.error || 'WhoAmI failed',
          });
          return null;
        }
      } catch (error) {
        setStatus({
          name: env.name,
          url: env.url,
          status: 'error',
          error: error instanceof Error ? error.message : 'Connection failed',
        });
        return null;
      }
    },
    [getToken]
  );

  const checkConnections = useCallback(async () => {
    console.log('useEnvironments: Checking connections to both environments');

    const [src, tgt] = await Promise.all([
      checkConnection(SOURCE_ENV, setSourceStatus),
      checkConnection(TARGET_ENV, setTargetStatus),
    ]);

    setSourceClient(src);
    setTargetClient(tgt);

    if (src) {
      setSourceService(new SourceService(src));
    }
    if (tgt) {
      const schedApi = new ScheduleApiClient(tgt);
      setScheduleApiClient(schedApi);
      setTargetService(new TargetService(schedApi));
    }
  }, [checkConnection]);

  // Auto-check connections when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      checkConnections();
    }
  }, [isAuthenticated, checkConnections]);

  const isReady = sourceStatus.status === 'connected' && targetStatus.status === 'connected';

  return {
    sourceStatus,
    targetStatus,
    sourceClient,
    targetClient,
    sourceService,
    targetService,
    scheduleApiClient,
    checkConnections,
    isReady,
  };
}
