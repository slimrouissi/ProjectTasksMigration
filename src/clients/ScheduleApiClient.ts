/**
 * Project schedule API client (msdyn_* custom actions in Project Operations).
 *
 * Verified against Project Operations 1.0.0.87 (Oct 2026):
 * - OperationSet status: 192350000 Open, 192350001 Pending, 192350002 Abandoned, 192350003 Completed, 192350004 Failed
 * - Tasks created through PssCreate need msdyn_LinkStatus, msdyn_project, msdyn_projectbucket and msdyn_subject
 * - Resource assignments are created without dates/hours; hours are set with msdyn_PssUpdateResourceAssignmentContourV1
 * - Only users with a Project license can call these actions (not application users)
 */

import { DataverseClient, DataverseHttpError } from './DataverseClient';
import { OPERATION_SET_TIMEOUT, POLL_INTERVAL, OPERATION_SET_MAX_WAIT, MAX_OPERATIONS_PER_SET } from '../config/appConfig';
import type { ServiceResult } from '../types/migration';
import type { ContourSlice } from '../utils/plannedWork';
import { extractDataverseErrorMessage } from '../utils/dataverseErrors';

export const OPERATION_SET_STATUS = {
  Open: 192350000,
  Pending: 192350001,
  Abandoned: 192350002,
  Completed: 192350003,
  Failed: 192350004,
} as const;

const STATUS_LABEL: Record<number, string> = {
  192350000: 'Open',
  192350001: 'Pending',
  192350002: 'Abandoned',
  192350003: 'Completed',
  192350004: 'Failed',
};

/** Value for msdyn_projecttask.msdyn_LinkStatus required by PssCreate */
export const TASK_LINK_STATUS_NOT_LINKED = 192350000;

export interface PssEntity {
  '@odata.type': string;
  [key: string]: unknown;
}

export type ScheduleOperation =
  | { kind: 'create'; entity: PssEntity; label?: string }
  | { kind: 'update'; entity: PssEntity; label?: string }
  | { kind: 'contour'; assignmentId: string; contour: ContourSlice[]; label?: string };

export interface OperationSetOutcome {
  operationSetId: string;
  status: number;
  statusLabel: string;
  error?: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class ScheduleApiClient {
  readonly client: DataverseClient;

  constructor(client: DataverseClient) {
    this.client = client;
  }

  async createProject(project: Record<string, unknown>): Promise<ServiceResult<string>> {
    const result = await this.client.post<{ Project: Record<string, unknown> }, { ProjectId: string }>(
      'msdyn_CreateProjectV1',
      { Project: { '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_project', ...project } },
      OPERATION_SET_TIMEOUT
    );
    return result.success ? { success: true, data: result.data?.ProjectId || (project.msdyn_projectid as string) } : { success: false, error: result.error };
  }

  async createTeamMember(teamMember: Record<string, unknown>): Promise<ServiceResult<string>> {
    const result = await this.client.post<{ TeamMember: Record<string, unknown> }, { TeamMemberId: string }>(
      'msdyn_CreateTeamMemberV1',
      { TeamMember: { '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectteam', ...teamMember } },
      OPERATION_SET_TIMEOUT
    );
    return result.success ? { success: true, data: result.data?.TeamMemberId } : { success: false, error: result.error };
  }

  private async createOperationSet(projectId: string, description: string): Promise<string> {
    const { data } = await this.client.request<{ OperationSetId: string }>('POST', 'msdyn_CreateOperationSetV1', {
      ProjectId: projectId,
      Description: description.slice(0, 200),
    });
    if (!data?.OperationSetId) throw new Error('msdyn_CreateOperationSetV1 did not return an OperationSetId');
    return data.OperationSetId;
  }

  private async abandon(operationSetId: string): Promise<void> {
    try {
      await this.client.request('POST', 'msdyn_AbandonOperationSetV1', { OperationSetId: operationSetId });
    } catch {
      // best effort: an abandoned/failed set frees the per-user limit of 10 open sets
    }
  }

  private async addOperations(operationSetId: string, operations: ScheduleOperation[]): Promise<void> {
    const creates = operations.filter(o => o.kind === 'create') as Extract<ScheduleOperation, { kind: 'create' }>[];
    if (creates.length) {
      await this.client.request('POST', 'msdyn_PssCreateV2', { EntityCollection: creates.map(c => c.entity), OperationSetId: operationSetId }, OPERATION_SET_TIMEOUT);
    }
    for (const op of operations) {
      if (op.kind === 'update') {
        await this.client.request('POST', 'msdyn_PssUpdateV1', { Entity: op.entity, OperationSetId: operationSetId }, OPERATION_SET_TIMEOUT);
      } else if (op.kind === 'contour') {
        await this.client.request('POST', 'msdyn_PssUpdateResourceAssignmentContourV1', {
          OperationSetId: operationSetId,
          ResourceAssignmentId: op.assignmentId,
          UpdatedContours: JSON.stringify(op.contour),
        }, OPERATION_SET_TIMEOUT);
      }
    }
  }

  private async readErrorLog(errorLogId?: string): Promise<string | undefined> {
    if (!errorLogId) return undefined;
    const log = await this.client.get<{ msdyn_log?: string; msdyn_errorcode?: string }>(`msdyn_psserrorlogs(${errorLogId})?$select=msdyn_log,msdyn_errorcode`);
    if (!log.success || !log.data) return undefined;
    const text = log.data.msdyn_log || '';
    const firstLine = text.split(/\r?\n/).find(l => l.trim()) || text;
    return [log.data.msdyn_errorcode, firstLine.slice(0, 600)].filter(Boolean).join(': ');
  }

  private async waitForCompletion(operationSetId: string): Promise<OperationSetOutcome> {
    const deadline = Date.now() + OPERATION_SET_MAX_WAIT;
    while (Date.now() < deadline) {
      const result = await this.client.get<{ msdyn_status: number; _msdyn_psserrorlog_value?: string }>(
        `msdyn_operationsets(${operationSetId})?$select=msdyn_status,_msdyn_psserrorlog_value`
      );
      if (result.success && result.data) {
        const status = result.data.msdyn_status;
        if (status !== OPERATION_SET_STATUS.Open && status !== OPERATION_SET_STATUS.Pending) {
          const outcome: OperationSetOutcome = { operationSetId, status, statusLabel: STATUS_LABEL[status] || String(status) };
          if (status !== OPERATION_SET_STATUS.Completed) {
            outcome.error = (await this.readErrorLog(result.data._msdyn_psserrorlog_value)) || `Operation set ${outcome.statusLabel.toLowerCase()}`;
          }
          return outcome;
        }
      }
      await sleep(POLL_INTERVAL);
    }
    return { operationSetId, status: -1, statusLabel: 'Timed out', error: `Operation set did not finish within ${Math.round(OPERATION_SET_MAX_WAIT / 60000)} minutes. It may still complete; re-run to pick up anything missing.` };
  }

  /**
   * Run operations for one project: create an operation set, queue the operations, execute and wait.
   * Throws with a readable message when the set fails.
   */
  async run(projectId: string, description: string, operations: ScheduleOperation[]): Promise<OperationSetOutcome> {
    if (!operations.length) return { operationSetId: '', status: OPERATION_SET_STATUS.Completed, statusLabel: 'Completed' };
    if (operations.length > MAX_OPERATIONS_PER_SET) throw new Error(`Too many operations in one set (${operations.length} > ${MAX_OPERATIONS_PER_SET})`);

    const operationSetId = await this.createOperationSet(projectId, description);
    try {
      await this.addOperations(operationSetId, operations);
      await this.client.request('POST', 'msdyn_ExecuteOperationSetV1', { OperationSetId: operationSetId }, OPERATION_SET_TIMEOUT);
    } catch (error) {
      await this.abandon(operationSetId);
      const raw = error instanceof DataverseHttpError ? error.message : (error as Error)?.message;
      throw new Error(`${description}: ${extractDataverseErrorMessage(raw)}`);
    }

    const outcome = await this.waitForCompletion(operationSetId);
    if (outcome.status !== OPERATION_SET_STATUS.Completed) {
      throw new Error(`${description}: ${outcome.error}`);
    }
    return outcome;
  }
}
