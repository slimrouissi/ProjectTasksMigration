/**
 * Schedule API client wrapping D365 Project Operations actions
 * Uses DataverseClient for HTTP calls with proper OperationSet patterns
 */

import { DataverseClient } from './DataverseClient';
import { OPERATION_SET_TIMEOUT, POLL_INTERVAL, MAX_POLL_ATTEMPTS } from '../config/appConfig';
import { ServiceResult } from '../types/migration';
import {
  CreateProjectPayload,
  CreateProjectResponse,
  CreateTeamMemberPayload,
  CreateTeamMemberResponse,
  CreateOperationSetResponse,
  PssEntity,
  ExecuteOperationSetResponse,
  OperationSetDetail,
  OPERATION_SET_STATUS_MAP,
} from '../types/operationSet';

export class ScheduleApiClient {
  private client: DataverseClient;

  constructor(client: DataverseClient) {
    this.client = client;
  }

  /**
   * Create a project via msdyn_CreateProjectV1 (unbound action, outside OperationSet)
   */
  async createProject(payload: CreateProjectPayload): Promise<ServiceResult<CreateProjectResponse>> {
    console.log('ScheduleApiClient: createProject', payload.Project.msdyn_subject);
    console.time('ScheduleApiClient.createProject');

    const result = await this.client.post<CreateProjectPayload, CreateProjectResponse>(
      'msdyn_CreateProjectV1',
      payload,
      OPERATION_SET_TIMEOUT
    );

    console.timeEnd('ScheduleApiClient.createProject');
    return result;
  }

  /**
   * Create a team member via msdyn_CreateTeamMemberV1 (unbound action, outside OperationSet)
   */
  async createTeamMember(payload: CreateTeamMemberPayload): Promise<ServiceResult<CreateTeamMemberResponse>> {
    console.log('ScheduleApiClient: createTeamMember', payload.TeamMember.msdyn_name);
    console.time('ScheduleApiClient.createTeamMember');

    const result = await this.client.post<CreateTeamMemberPayload, CreateTeamMemberResponse>(
      'msdyn_CreateTeamMemberV1',
      payload,
      OPERATION_SET_TIMEOUT
    );

    console.timeEnd('ScheduleApiClient.createTeamMember');
    return result;
  }

  /**
   * Create an OperationSet for batching entity operations
   */
  async createOperationSet(projectId: string, description: string): Promise<ServiceResult<CreateOperationSetResponse>> {
    console.log(`ScheduleApiClient: createOperationSet for project ${projectId}`);
    console.time('ScheduleApiClient.createOperationSet');

    const result = await this.client.post<{ ProjectId: string; Description: string }, CreateOperationSetResponse>(
      'msdyn_CreateOperationSetV1',
      { ProjectId: projectId, Description: description }
    );

    console.timeEnd('ScheduleApiClient.createOperationSet');
    return result;
  }

  /**
   * Add a create operation to an OperationSet via msdyn_PssCreateV1
   */
  async pssCreate(entity: PssEntity, operationSetId: string): Promise<ServiceResult<void>> {
    console.log(`ScheduleApiClient: pssCreate (${entity['@odata.type']}) in opSet ${operationSetId}`);

    const result = await this.client.post<{ Entity: PssEntity; OperationSetId: string }, void>(
      'msdyn_PssCreateV1',
      { Entity: entity, OperationSetId: operationSetId }
    );

    return result;
  }

  /**
   * Execute an OperationSet — triggers all queued operations atomically
   */
  async executeOperationSet(operationSetId: string): Promise<ServiceResult<ExecuteOperationSetResponse>> {
    console.log(`ScheduleApiClient: executeOperationSet ${operationSetId}`);
    console.time(`ScheduleApiClient.executeOperationSet(${operationSetId})`);

    const result = await this.client.post<{ OperationSetId: string }, ExecuteOperationSetResponse>(
      'msdyn_ExecuteOperationSetV1',
      { OperationSetId: operationSetId },
      OPERATION_SET_TIMEOUT
    );

    console.timeEnd(`ScheduleApiClient.executeOperationSet(${operationSetId})`);
    return result;
  }

  /**
   * Poll an OperationSet until it completes or fails
   */
  async pollOperationSet(operationSetId: string): Promise<ServiceResult<OperationSetDetail>> {
    console.log(`ScheduleApiClient: pollOperationSet ${operationSetId}`);

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const result = await this.client.getById<OperationSetDetail>(
        'msdyn_operationsets',
        operationSetId,
        ['msdyn_operationsetid', 'msdyn_status', 'msdyn_statusreason', 'msdyn_completedon', 'msdyn_description']
      );

      if (!result.success || !result.data) {
        return { success: false, error: result.error || 'Failed to poll OperationSet status' };
      }

      const status = OPERATION_SET_STATUS_MAP[result.data.msdyn_status];
      console.log(`ScheduleApiClient: OperationSet ${operationSetId} status = ${status} (attempt ${attempt + 1})`);

      if (status === 'Completed') {
        return { success: true, data: result.data, isLiveData: true };
      }

      if (status === 'Failed') {
        return {
          success: false,
          data: result.data,
          error: result.data.msdyn_statusreason || 'OperationSet failed',
        };
      }

      // Still processing — wait and retry
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    return {
      success: false,
      error: `OperationSet ${operationSetId} did not complete within ${MAX_POLL_ATTEMPTS * POLL_INTERVAL}ms`,
    };
  }

  /**
   * Full OperationSet workflow: create → add operations → execute → poll
   */
  async executeOperationBatch(
    projectId: string,
    description: string,
    entities: PssEntity[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<ServiceResult<OperationSetDetail>> {
    const method = `ScheduleApiClient.executeOperationBatch(${description})`;
    console.log(`${method}: Starting with ${entities.length} entities`);
    console.time(method);

    // 1. Create OperationSet
    const createResult = await this.createOperationSet(projectId, description);
    if (!createResult.success || !createResult.data) {
      console.timeEnd(method);
      return { success: false, error: createResult.error || 'Failed to create OperationSet' };
    }

    const operationSetId = createResult.data.OperationSetId;
    console.log(`${method}: OperationSet created: ${operationSetId}`);

    // 2. Add all entities via PssCreate
    for (let i = 0; i < entities.length; i++) {
      const pssResult = await this.pssCreate(entities[i], operationSetId);
      if (!pssResult.success) {
        console.error(`${method}: PssCreate failed at index ${i}`, pssResult.error);
        console.timeEnd(method);
        return { success: false, error: `PssCreate failed: ${pssResult.error}` };
      }
      onProgress?.(i + 1, entities.length);
    }

    console.log(`${method}: All ${entities.length} entities added, executing...`);

    // 3. Execute
    const execResult = await this.executeOperationSet(operationSetId);
    if (!execResult.success) {
      console.timeEnd(method);
      return { success: false, error: execResult.error || 'Failed to execute OperationSet' };
    }

    // 4. Poll for completion
    const pollResult = await this.pollOperationSet(operationSetId);
    console.timeEnd(method);
    return pollResult;
  }
}
