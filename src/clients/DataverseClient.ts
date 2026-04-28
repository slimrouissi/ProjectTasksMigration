/**
 * Generic Dataverse Web API client
 * Handles GET/POST/PATCH with MSAL token acquisition, timeout, and logging
 */

import { EnvironmentConfig } from '../config/environments';
import { READ_TIMEOUT, WRITE_TIMEOUT, PAGE_SIZE } from '../config/appConfig';
import { ServiceResult } from '../types/migration';

type TokenProvider = (env: EnvironmentConfig) => Promise<string>;

function createTimeout<T>(ms: number): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
  });
}

export class DataverseClient {
  private env: EnvironmentConfig;
  private getToken: TokenProvider;

  constructor(env: EnvironmentConfig, getToken: TokenProvider) {
    this.env = env;
    this.getToken = getToken;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken(this.env);
    return {
      Authorization: `Bearer ${token}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'odata.include-annotations="*"',
    };
  }

  /**
   * GET all records from an entity set, handling pagination
   */
  async getAll<T>(entitySet: string, select?: string[], filter?: string, expand?: string): Promise<ServiceResult<T[]>> {
    const method = `DataverseClient[${this.env.name}].getAll(${entitySet})`;
    console.log(`${method}: Starting`);
    console.time(method);

    try {
      const params = new URLSearchParams();
      if (select?.length) params.set('$select', select.join(','));
      if (filter) params.set('$filter', filter);
      if (expand) params.set('$expand', expand);
      params.set('$top', String(PAGE_SIZE));

      const url = `${this.env.apiBase}/${entitySet}?${params.toString()}`;
      const headers = await this.getHeaders();

      let allRecords: T[] = [];
      let nextLink: string | undefined = url;

      while (nextLink) {
        const response = await Promise.race([
          fetch(nextLink, { method: 'GET', headers }),
          createTimeout<Response>(READ_TIMEOUT),
        ]);

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorBody}`);
        }

        const data = await response.json();
        const records = (data.value || []) as T[];
        allRecords = allRecords.concat(records);
        nextLink = data['@odata.nextLink'];
      }

      console.log(`${method}: Successfully retrieved ${allRecords.length} records`);
      console.timeEnd(method);
      return { success: true, data: allRecords, isLiveData: true };
    } catch (error) {
      console.error(`${method}: Error`, error);
      console.timeEnd(method);
      return {
        success: false,
        data: [],
        isLiveData: true,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * GET a single record by ID
   */
  async getById<T>(entitySet: string, id: string, select?: string[]): Promise<ServiceResult<T>> {
    const method = `DataverseClient[${this.env.name}].getById(${entitySet}, ${id})`;
    console.log(`${method}: Starting`);
    console.time(method);

    try {
      const params = new URLSearchParams();
      if (select?.length) params.set('$select', select.join(','));

      const url = `${this.env.apiBase}/${entitySet}(${id})?${params.toString()}`;
      const headers = await this.getHeaders();

      const response = await Promise.race([
        fetch(url, { method: 'GET', headers }),
        createTimeout<Response>(READ_TIMEOUT),
      ]);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as T;
      console.log(`${method}: Successfully retrieved record`);
      console.timeEnd(method);
      return { success: true, data, isLiveData: true };
    } catch (error) {
      console.error(`${method}: Error`, error);
      console.timeEnd(method);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * POST to create a record or execute an action
   */
  async post<TRequest, TResponse>(path: string, body: TRequest, timeout?: number): Promise<ServiceResult<TResponse>> {
    const method = `DataverseClient[${this.env.name}].post(${path})`;
    console.log(`${method}: Starting`);
    console.time(method);

    try {
      const url = path.startsWith('http') ? path : `${this.env.apiBase}/${path}`;
      const headers = await this.getHeaders();

      const response = await Promise.race([
        fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }),
        createTimeout<Response>(timeout || WRITE_TIMEOUT),
      ]);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }

      // Some actions return 204 No Content
      let data: TResponse | undefined;
      const contentType = response.headers.get('content-type');
      if (response.status !== 204 && contentType?.includes('application/json')) {
        data = (await response.json()) as TResponse;
      }

      console.log(`${method}: Success (${response.status})`);
      console.timeEnd(method);
      return { success: true, data, isLiveData: true };
    } catch (error) {
      console.error(`${method}: Error`, error);
      console.timeEnd(method);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * PATCH to update a record
   */
  async patch<TRequest>(entitySet: string, id: string, body: TRequest): Promise<ServiceResult<void>> {
    const method = `DataverseClient[${this.env.name}].patch(${entitySet}, ${id})`;
    console.log(`${method}: Starting`);
    console.time(method);

    try {
      const url = `${this.env.apiBase}/${entitySet}(${id})`;
      const headers = await this.getHeaders();

      const response = await Promise.race([
        fetch(url, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(body),
        }),
        createTimeout<Response>(WRITE_TIMEOUT),
      ]);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }

      console.log(`${method}: Success`);
      console.timeEnd(method);
      return { success: true, isLiveData: true };
    } catch (error) {
      console.error(`${method}: Error`, error);
      console.timeEnd(method);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute a WhoAmI request to validate connectivity
   */
  async whoAmI(): Promise<ServiceResult<{ UserId: string; OrganizationId: string }>> {
    const method = `DataverseClient[${this.env.name}].whoAmI`;
    console.log(`${method}: Starting`);
    console.time(method);

    try {
      const url = `${this.env.apiBase}/WhoAmI`;
      const headers = await this.getHeaders();

      const response = await Promise.race([
        fetch(url, { method: 'GET', headers }),
        createTimeout<Response>(READ_TIMEOUT),
      ]);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }

      const data = await response.json();
      console.log(`${method}: Connected as user ${data.UserId}`);
      console.timeEnd(method);
      return { success: true, data, isLiveData: true };
    } catch (error) {
      console.error(`${method}: Error`, error);
      console.timeEnd(method);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
