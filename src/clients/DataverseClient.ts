/**
 * Dataverse Web API client
 * - token per call (MSAL in the browser, any provider in Node)
 * - automatic paging, retries on throttling (429) and transient errors (502/503/504)
 * - request log kept in memory for the diagnostics report
 */

import type { EnvironmentConfig } from '../config/environments';
import { READ_TIMEOUT, WRITE_TIMEOUT, PAGE_SIZE } from '../config/appConfig';
import type { ServiceResult } from '../types/migration';
import { extractDataverseErrorMessage } from '../utils/dataverseErrors';

export type TokenProvider = (env: EnvironmentConfig) => Promise<string>;

export interface RequestLogEntry {
  at: string;
  env: string;
  method: string;
  url: string;
  status?: number;
  ms: number;
  error?: string;
}

export interface QueryOptions {
  select?: string[];
  filter?: string;
  expand?: string;
  orderBy?: string;
  top?: number;
  /** Stop paging after this many records */
  maxRecords?: number;
}

const MAX_RETRIES = 4;
const RETRYABLE = new Set([429, 502, 503, 504]);
const LOG_LIMIT = 400;

export class DataverseHttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body}`);
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class DataverseClient {
  readonly env: EnvironmentConfig;
  private getToken: TokenProvider;
  private static log: RequestLogEntry[] = [];

  constructor(env: EnvironmentConfig, getToken: TokenProvider) {
    this.env = env;
    this.getToken = getToken;
  }

  /** Recent requests across all clients (for the diagnostics report) */
  static getRequestLog(): RequestLogEntry[] {
    return [...DataverseClient.log];
  }

  static clearRequestLog(): void {
    DataverseClient.log = [];
  }

  private static record(entry: RequestLogEntry) {
    DataverseClient.log.push(entry);
    if (DataverseClient.log.length > LOG_LIMIT) DataverseClient.log.splice(0, DataverseClient.log.length - LOG_LIMIT);
  }

  private async headers(extra?: Record<string, string>): Promise<Record<string, string>> {
    const token = await this.getToken(this.env);
    return {
      Authorization: `Bearer ${token}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      Prefer: `odata.include-annotations="*",odata.maxpagesize=${PAGE_SIZE}`,
      ...extra,
    };
  }

  private url(path: string): string {
    return path.startsWith('http') ? path : `${this.env.apiBase}/${path.replace(/^\//, '')}`;
  }

  /**
   * Send a request with timeout and retries. Throws DataverseHttpError for non-2xx responses.
   */
  async request<T = unknown>(method: string, path: string, body?: unknown, timeout?: number): Promise<{ status: number; data?: T }> {
    const url = this.url(path);
    let attempt = 0;
    for (;;) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout || (method === 'GET' ? READ_TIMEOUT : WRITE_TIMEOUT));
      try {
        const response = await fetch(url, {
          method,
          headers: await this.headers(),
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (RETRYABLE.has(response.status) && attempt < MAX_RETRIES) {
          const retryAfter = Number(response.headers.get('Retry-After'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
          DataverseClient.record({ at: new Date().toISOString(), env: this.env.name, method, url, status: response.status, ms: Date.now() - started, error: `retry in ${wait}ms` });
          attempt++;
          await sleep(Math.min(wait, 30000));
          continue;
        }

        const text = await response.text();
        if (!response.ok) {
          DataverseClient.record({ at: new Date().toISOString(), env: this.env.name, method, url, status: response.status, ms: Date.now() - started, error: extractDataverseErrorMessage(`HTTP ${response.status}: ${text}`) });
          throw new DataverseHttpError(response.status, text);
        }
        DataverseClient.record({ at: new Date().toISOString(), env: this.env.name, method, url, status: response.status, ms: Date.now() - started });
        return { status: response.status, data: text ? (JSON.parse(text) as T) : undefined };
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof DataverseHttpError) throw error;
        const aborted = (error as Error)?.name === 'AbortError';
        const message = aborted ? `Request timed out after ${timeout || (method === 'GET' ? READ_TIMEOUT : WRITE_TIMEOUT)}ms` : (error as Error)?.message || 'Network error';
        DataverseClient.record({ at: new Date().toISOString(), env: this.env.name, method, url, ms: Date.now() - started, error: message });
        // Network errors on reads are retried; writes are not (they may have been applied)
        if (method === 'GET' && attempt < MAX_RETRIES) {
          attempt++;
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new Error(message);
      }
    }
  }

  private wrap<T>(promise: Promise<T>): Promise<ServiceResult<T>> {
    return promise.then(
      data => ({ success: true, data, isLiveData: true }),
      error => ({ success: false, error: error instanceof Error ? error.message : String(error), isLiveData: true })
    );
  }

  /** GET a raw path (functions, metadata, single records) */
  async get<T>(path: string): Promise<ServiceResult<T>> {
    return this.wrap(this.request<T>('GET', path).then(r => r.data as T));
  }

  /** GET all records from an entity set, following paging links */
  async query<T>(entitySet: string, options: QueryOptions = {}): Promise<ServiceResult<T[]>> {
    const params: string[] = [];
    if (options.select?.length) params.push(`$select=${options.select.join(',')}`);
    if (options.filter) params.push(`$filter=${encodeURIComponent(options.filter)}`);
    if (options.expand) params.push(`$expand=${encodeURIComponent(options.expand)}`);
    if (options.orderBy) params.push(`$orderby=${encodeURIComponent(options.orderBy)}`);
    if (options.top) params.push(`$top=${options.top}`);

    const run = async () => {
      let next: string | undefined = `${entitySet}${params.length ? `?${params.join('&')}` : ''}`;
      const all: T[] = [];
      while (next) {
        const { data } = await this.request<{ value: T[]; '@odata.nextLink'?: string }>('GET', next);
        all.push(...(data?.value || []));
        if (options.maxRecords && all.length >= options.maxRecords) return all.slice(0, options.maxRecords);
        next = data?.['@odata.nextLink'];
      }
      return all;
    };
    return this.wrap(run());
  }

  /** Back-compat wrapper used by older code paths */
  async getAll<T>(entitySet: string, select?: string[], filter?: string, expand?: string): Promise<ServiceResult<T[]>> {
    const result = await this.query<T>(entitySet, { select, filter, expand });
    return result.success ? result : { ...result, data: [] };
  }

  async getById<T>(entitySet: string, id: string, select?: string[]): Promise<ServiceResult<T>> {
    return this.get<T>(`${entitySet}(${id})${select?.length ? `?$select=${select.join(',')}` : ''}`);
  }

  /** POST to create a record or call an action */
  async post<TRequest, TResponse>(path: string, body: TRequest, timeout?: number): Promise<ServiceResult<TResponse>> {
    return this.wrap(this.request<TResponse>('POST', path, body, timeout).then(r => r.data as TResponse));
  }

  async patch<TRequest>(entitySet: string, id: string, body: TRequest): Promise<ServiceResult<void>> {
    return this.wrap(this.request<void>('PATCH', `${entitySet}(${id})`, body).then(() => undefined));
  }

  async delete(entitySet: string, id: string): Promise<ServiceResult<void>> {
    return this.wrap(this.request<void>('DELETE', `${entitySet}(${id})`).then(() => undefined));
  }

  async whoAmI(): Promise<ServiceResult<{ UserId: string; OrganizationId: string; BusinessUnitId: string }>> {
    return this.get('WhoAmI');
  }
}
