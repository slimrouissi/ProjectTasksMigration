/**
 * Related Record Service — copies rows of tables that hang off a project (risks, issues, changes,
 * status reports, notes, custom RAID tables) into the matched target project.
 *
 * - Only columns that exist and are createable in the target are copied
 * - The project lookup is re-pointed to the target project; task lookups use the task ID map;
 *   user lookups are matched by Entra object ID; other lookups by same ID, then by primary name
 * - Rows keep their source ID, and rows already in the target (same ID, or same name on the
 *   target project) are skipped, so re-runs don't duplicate
 */

import { DataverseClient } from '../clients/DataverseClient';
import { MetadataService, TableSchema, ColumnInfo } from './MetadataService';
import type { RelatedTableInfo } from '../types/migration';
import { chunk, inFilter, normalizeGuid, normalizeKey } from '../utils/odata';
import { extractDataverseErrorMessage } from '../utils/dataverseErrors';

export interface RelatedCopyContext {
  sourceProjectId: string;
  targetProjectId: string;
  taskIdMap: Map<string, string>;
}

export interface RelatedCopyResult {
  table: string;
  displayName: string;
  created: number;
  existing: number;
  failed: number;
  errors: string[];
  warnings: string[];
}

type Row = Record<string, unknown>;

const LOOKUP_ENTITY = (row: Row, column: string) => row[`_${column}_value@Microsoft.Dynamics.CRM.lookuplogicalname`] as string | undefined;

export class RelatedRecordService {
  private userMap = new Map<string, Promise<string | undefined>>();
  private lookupCache = new Map<string, Promise<string | undefined>>();
  private skippedColumns = new Map<string, Set<string>>();

  constructor(
    private source: DataverseClient,
    private target: DataverseClient,
    private sourceMeta: MetadataService,
    private targetMeta: MetadataService
  ) {}

  /** Map a source systemuser to the target user with the same Entra object ID */
  mapUser(sourceUserId: string): Promise<string | undefined> {
    if (!this.userMap.has(sourceUserId)) {
      this.userMap.set(sourceUserId, (async () => {
        const src = await this.source.get<{ azureactivedirectoryobjectid?: string }>(`systemusers(${sourceUserId})?$select=azureactivedirectoryobjectid`);
        const aad = normalizeGuid(src.data?.azureactivedirectoryobjectid);
        if (!aad) return undefined;
        const tgt = await this.target.query<{ systemuserid: string }>('systemusers', { select: ['systemuserid'], filter: `azureactivedirectoryobjectid eq ${aad} and isdisabled eq false`, top: 1 });
        return tgt.data?.[0]?.systemuserid;
      })());
    }
    return this.userMap.get(sourceUserId)!;
  }

  /** Resolve a lookup to another table: same ID in target, else same primary name */
  private resolveLookup(entity: string, sourceId: string, sourceName?: string): Promise<string | undefined> {
    const key = `${entity}:${sourceId}`;
    if (!this.lookupCache.has(key)) {
      this.lookupCache.set(key, (async () => {
        const meta = await this.targetMeta.getEntity(entity);
        if (!meta) return undefined;
        const same = await this.target.query<Row>(meta.EntitySetName, { select: [meta.PrimaryIdAttribute], filter: `${meta.PrimaryIdAttribute} eq ${sourceId}`, top: 1 });
        if (same.data?.length) return sourceId;
        if (sourceName && meta.PrimaryNameAttribute) {
          const byName = await this.target.query<Row>(meta.EntitySetName, {
            select: [meta.PrimaryIdAttribute],
            filter: `${meta.PrimaryNameAttribute} eq '${sourceName.replace(/'/g, "''")}'`,
            top: 2,
          });
          if (byName.data?.length === 1) return byName.data[0][meta.PrimaryIdAttribute] as string;
        }
        return undefined;
      })());
    }
    return this.lookupCache.get(key)!;
  }

  private noteSkipped(table: string, column: string) {
    const set = this.skippedColumns.get(table) || new Set<string>();
    set.add(column);
    this.skippedColumns.set(table, set);
  }

  private async buildPayload(table: RelatedTableInfo, schema: TableSchema, row: Row, ctx: RelatedCopyContext): Promise<Row> {
    const payload: Row = {};
    for (const col of schema.createable) {
      if (col.lookup) {
        await this.applyLookup(table, col, row, ctx, payload);
        continue;
      }
      const value = row[col.logicalName];
      if (value === undefined || value === null) continue;
      payload[col.logicalName] = value;
    }
    // Notes: objectid is polymorphic; point it at the target project
    if (table.logicalName === 'annotation') {
      payload['objectid_msdyn_project@odata.bind'] = `/msdyn_projects(${ctx.targetProjectId})`;
    }
    return payload;
  }

  private async applyLookup(table: RelatedTableInfo, col: ColumnInfo, row: Row, ctx: RelatedCopyContext, payload: Row) {
    if (table.logicalName === 'annotation' && col.logicalName === 'objectid') return;
    const sourceId = row[`_${col.logicalName}_value`] as string | undefined;
    if (!sourceId) return;
    const entity = LOOKUP_ENTITY(row, col.logicalName) || col.lookup!.targets[0].entity;

    // Owner is polymorphic (user or team): keep the owner when the same person exists in the target
    if (col.type === 'Owner' || col.logicalName === 'ownerid') {
      if (entity !== 'systemuser') return;
      const userId = await this.mapUser(sourceId);
      if (userId) payload['ownerid@odata.bind'] = `/systemusers(${userId})`;
      else this.noteSkipped(table.displayName, 'ownerid');
      return;
    }

    const target = col.lookup!.targets.find(t => t.entity === entity);
    if (!target) return;
    const sourceName = row[`_${col.logicalName}_value@OData.Community.Display.V1.FormattedValue`] as string | undefined;

    let targetId: string | undefined;
    if (col.logicalName === table.projectLookup || entity === 'msdyn_project') {
      targetId = sourceId === ctx.sourceProjectId ? ctx.targetProjectId : undefined;
    } else if (entity === 'msdyn_projecttask') {
      targetId = ctx.taskIdMap.get(sourceId);
    } else if (entity === 'systemuser') {
      targetId = await this.mapUser(sourceId);
    } else if (entity === 'team' || entity === 'businessunit' || entity === 'organization') {
      return;
    } else {
      targetId = await this.resolveLookup(entity, sourceId, sourceName);
    }

    if (!targetId) {
      this.noteSkipped(table.displayName, col.logicalName);
      return;
    }
    const meta = await this.targetMeta.getEntity(entity);
    if (!meta) return;
    payload[`${target.navigation}@odata.bind`] = `/${meta.EntitySetName}(${targetId})`;
  }

  /** Create a row; when Dataverse rejects a specific column, drop it and retry (up to 5 times) */
  private async createWithRetry(entitySet: string, payload: Row, droppedColumns: string[]): Promise<void> {
    let body = { ...payload };
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await this.target.request('POST', entitySet, body);
        return;
      } catch (error) {
        const message = (error as Error).message || '';
        const property =
          /property named '([^']+)'/i.exec(message)?.[1] ||
          /attribute '?([a-z0-9_]+)'? (?:is not valid|does not exist|cannot be set)/i.exec(message)?.[1] ||
          /'([a-z0-9_]+)' (?:is not a valid|has an invalid)/i.exec(message)?.[1];
        let key = property && Object.keys(body).find(k => k === property || k.toLowerCase().startsWith(`${property.toLowerCase()}@`) || k.toLowerCase() === property.toLowerCase());
        // Assigning another owner needs extra privileges: fall back to the migration user as owner
        if (!key && 'ownerid@odata.bind' in body) key = 'ownerid@odata.bind';
        if (!key || attempt === 5) throw error;
        droppedColumns.push(key.replace(/@odata\.bind$/, ''));
        const { [key]: _removed, ...rest } = body;
        body = rest;
      }
    }
  }

  async copy(table: RelatedTableInfo, rows: Row[], ctx: RelatedCopyContext): Promise<RelatedCopyResult> {
    const result: RelatedCopyResult = { table: table.logicalName, displayName: table.displayName, created: 0, existing: 0, failed: 0, errors: [], warnings: [] };
    if (!rows.length) return result;

    const schema = await this.targetMeta.getTableSchema(table.logicalName);
    if (!schema) {
      result.failed = rows.length;
      result.errors.push(`${table.displayName}: the table "${table.logicalName}" doesn't exist in the target. Import the solution that contains it first.`);
      return result;
    }

    // Rows already in the target: same ID anywhere, or same name on the target project
    const existingIds = new Set<string>();
    for (const group of chunk(rows.map(r => r[table.primaryIdAttribute] as string).filter(Boolean), 50)) {
      const r = await this.target.query<Row>(schema.entitySetName, { select: [schema.primaryIdAttribute], filter: inFilter(schema.primaryIdAttribute, group) });
      (r.data || []).forEach(x => existingIds.add(String(x[schema.primaryIdAttribute]).toLowerCase()));
    }
    const onProject = await this.target.query<Row>(schema.entitySetName, {
      select: [schema.primaryIdAttribute, schema.primaryNameAttribute].filter(Boolean),
      filter: `_${table.projectLookup}_value eq ${ctx.targetProjectId}`,
    });
    const existingNames = new Set((onProject.data || []).map(x => normalizeKey(x[schema.primaryNameAttribute])).filter(Boolean));

    const dropped: string[] = [];
    for (const row of rows) {
      const id = String(row[table.primaryIdAttribute] || '').toLowerCase();
      const name = normalizeKey(row[table.primaryNameAttribute]);
      if ((id && existingIds.has(id)) || (name && existingNames.has(name))) {
        result.existing++;
        continue;
      }
      try {
        const payload = await this.buildPayload(table, schema, row, ctx);
        await this.createWithRetry(schema.entitySetName, payload, dropped);
        result.created++;
        if (name) existingNames.add(name);

        // Closed/resolved rows: set the state after create (can't be set on create)
        const state = row.statecode as number | undefined;
        if (state !== undefined && state !== 0 && id) {
          const patched = await this.target.patch(schema.entitySetName, id, { statecode: state, statuscode: row.statuscode });
          if (!patched.success) result.warnings.push(`${table.displayName} "${row[table.primaryNameAttribute] || id}": created but its status couldn't be set (${extractDataverseErrorMessage(patched.error)}).`);
        }
      } catch (error) {
        result.failed++;
        result.errors.push(`${table.displayName} "${row[table.primaryNameAttribute] || id}": ${extractDataverseErrorMessage((error as Error).message)}`);
      }
    }

    const skipped = this.skippedColumns.get(table.displayName);
    if (skipped?.has('ownerid')) {
      result.warnings.push(`${table.displayName}: some original owners aren't users in the target, so those records are owned by the migration account.`);
      skipped.delete('ownerid');
    }
    if (skipped?.size) result.warnings.push(`${table.displayName}: these lookups had no match in the target and were left empty: ${[...skipped].join(', ')}.`);
    this.skippedColumns.delete(table.displayName);
    if (dropped.length) result.warnings.push(`${table.displayName}: the target rejected these columns, so they weren't copied: ${[...new Set(dropped)].join(', ')}.`);
    return result;
  }

  /** Count rows of a table on a target project (for reconciliation) */
  async countOnTarget(table: RelatedTableInfo, targetProjectId: string): Promise<number> {
    const schema = await this.targetMeta.getTableSchema(table.logicalName);
    if (!schema) return 0;
    const r = await this.target.query<Row>(schema.entitySetName, { select: [schema.primaryIdAttribute], filter: `_${table.projectLookup}_value eq ${targetProjectId}` });
    return r.data?.length || 0;
  }
}
