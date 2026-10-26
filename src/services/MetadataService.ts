/**
 * Metadata Service — reads table/column metadata so the tool can:
 * - offer the project key fields (e.g. "Oracle Project Number" → "Project ID") in dropdowns
 * - discover tables that hang off a project (risks, issues, changes, status reports, custom RAID tables)
 * - copy related records generically, including only columns that exist in the target
 */

import { DataverseClient } from '../clients/DataverseClient';
import type { FieldOption, RelatedTableInfo, ServiceResult } from '../types/migration';

interface LocalizedLabel {
  UserLocalizedLabel?: { Label?: string } | null;
}

interface AttributeMetadata {
  LogicalName: string;
  AttributeType: string;
  AttributeTypeName?: { Value?: string };
  IsCustomAttribute?: boolean;
  AttributeOf?: string | null;
  IsValidForRead?: boolean;
  IsValidForCreate?: boolean;
  IsValidForUpdate?: boolean;
  IsPrimaryId?: boolean;
  DisplayName?: LocalizedLabel;
}

interface RelationshipMetadata {
  SchemaName: string;
  ReferencingEntity: string;
  ReferencingAttribute: string;
  ReferencedEntity: string;
  ReferencingEntityNavigationPropertyName: string;
  IsCustomRelationship?: boolean;
}

interface EntityMetadata {
  LogicalName: string;
  EntitySetName: string;
  PrimaryIdAttribute: string;
  PrimaryNameAttribute: string;
  IsCustomEntity?: boolean;
  IsBPFEntity?: boolean;
  IsIntersect?: boolean;
  IsActivity?: boolean;
  DisplayName?: LocalizedLabel;
  DisplayCollectionName?: LocalizedLabel;
}

export interface ColumnInfo {
  logicalName: string;
  type: string;
  isCustom: boolean;
  /** Lookup targets and navigation property (for @odata.bind) */
  lookup?: { navigation: string; targets: { entity: string; navigation: string }[] };
}

export interface TableSchema {
  logicalName: string;
  entitySetName: string;
  primaryIdAttribute: string;
  primaryNameAttribute: string;
  createable: ColumnInfo[];
}

/** Standard Project Operations tables that make up the "project file" beyond the schedule */
export const STANDARD_RELATED_TABLES: Record<string, string> = {
  msdyn_projectrisk: 'Risks',
  msdyn_projectissue: 'Issues',
  msdyn_projectchange: 'Changes',
  msdyn_projectstatusreport: 'Status reports',
  annotation: 'Notes and attachments',
};

/** Tables managed by the schedule engine or financial processes — never copied as plain records */
const EXCLUDED_TABLES = new Set([
  'msdyn_projecttask', 'msdyn_projectteam', 'msdyn_resourceassignment', 'msdyn_projecttaskdependency',
  'msdyn_projectbucket', 'msdyn_projectsprint', 'msdyn_projectlabel', 'msdyn_projecttasktolabel', 'msdyn_projectchecklist',
  'msdyn_projectgoal', 'msdyn_projecttasktogoal', 'msdyn_operationset', 'msdyn_psserrorlog', 'msdyn_projectbaselinedata',
  'msdyn_actual', 'msdyn_fact', 'msdyn_journal', 'msdyn_journalline', 'msdyn_timeentry', 'msdyn_expense', 'msdyn_estimate',
  'msdyn_estimateline', 'msdyn_budget', 'msdyn_budgetline', 'msdyn_budgetperiod', 'msdyn_budgetmatchpriority',
  'bookableresourcebooking', 'bookableresourcebookingheader', 'msdyn_resourcerequirement', 'msdyn_projectapproval',
  'msdyn_approvalset', 'msdyn_projectpricelist', 'msdyn_projecthistory', 'msdyn_pinnedproject', 'msdyn_projectimportstaging',
  'msdyn_projectteamschannelmapping', 'msdyn_replaylogsection', 'msdyn_reconciliationoperationlog', 'msdyn_subscription',
]);

/** Columns never copied on create */
const SKIPPED_COLUMNS = new Set([
  'statecode', 'statuscode', 'importsequencenumber', 'overriddencreatedon', 'timezoneruleversionnumber',
  'utcconversiontimezonecode', 'processid', 'stageid', 'traversedpath', 'exchangerate', 'owningbusinessunit',
]);

const SIMPLE_TYPES = new Set(['String', 'Memo', 'Integer', 'BigInt', 'Decimal', 'Double', 'Money', 'Boolean', 'DateTime', 'Picklist', 'Uniqueidentifier']);
const LOOKUP_TYPES = new Set(['Lookup', 'Customer', 'Owner']);

const label = (l?: LocalizedLabel) => l?.UserLocalizedLabel?.Label || '';

/**
 * Customer customizations use the customer's publisher prefix. IsCustomAttribute/IsCustomEntity are also
 * true for Microsoft's own msdyn_ components, so the prefix is the reliable signal.
 */
const MICROSOFT_PREFIXES = /^(msdyn_|msdynce_|msdynmkt_|mspp_|msfp_|adx_|bot_|cdm_|msft_)/;
export function isCustomerCustomization(logicalName: string): boolean {
  return logicalName.includes('_') && !MICROSOFT_PREFIXES.test(logicalName);
}

export class MetadataService {
  private entityCache = new Map<string, Promise<EntityMetadata | undefined>>();
  private schemaCache = new Map<string, Promise<TableSchema | undefined>>();

  constructor(private client: DataverseClient) {}

  getEntity(logicalName: string): Promise<EntityMetadata | undefined> {
    if (!this.entityCache.has(logicalName)) {
      this.entityCache.set(
        logicalName,
        this.client
          .get<EntityMetadata>(`EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,IsCustomEntity,IsBPFEntity,IsIntersect,IsActivity,DisplayName,DisplayCollectionName`)
          .then(r => (r.success ? r.data : undefined))
      );
    }
    return this.entityCache.get(logicalName)!;
  }

  /** Text/number columns on msdyn_project that can identify a project across environments */
  async getProjectKeyFields(): Promise<ServiceResult<FieldOption[]>> {
    const result = await this.client.query<AttributeMetadata>("EntityDefinitions(LogicalName='msdyn_project')/Attributes", {
      select: ['LogicalName', 'AttributeType', 'IsCustomAttribute', 'AttributeOf', 'IsValidForRead', 'DisplayName'],
    });
    if (!result.success) return { success: false, error: result.error };

    const technical = /(token|correlation|session|jobid|replication|traversedpath|calendarid|linkeddocumenturl|versionnumber|importsequence|timezone|exchangerate)/;
    const fields = (result.data || [])
      .filter(a => a.IsValidForRead && !a.AttributeOf && ['String', 'Integer', 'BigInt'].includes(a.AttributeType) && !technical.test(a.LogicalName))
      .map(a => ({ logicalName: a.LogicalName, displayName: label(a.DisplayName) || a.LogicalName, isCustom: isCustomerCustomization(a.LogicalName) }))
      .sort((a, b) => {
        const rank = (f: FieldOption) => (f.logicalName === 'msdyn_projectnumber' ? 0 : f.logicalName === 'msdyn_subject' ? 1 : f.isCustom ? 2 : 3);
        return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName);
      });
    return { success: true, data: fields };
  }

  /** Tables with a lookup to msdyn_project that are worth copying (RAID log, status reports, custom tables) */
  async getProjectRelatedTables(): Promise<ServiceResult<Omit<RelatedTableInfo, 'existsInTarget' | 'sourceCount'>[]>> {
    const rel = await this.client.query<RelationshipMetadata>("EntityDefinitions(LogicalName='msdyn_project')/OneToManyRelationships", {
      select: ['SchemaName', 'ReferencingEntity', 'ReferencingAttribute', 'ReferencedEntity', 'ReferencingEntityNavigationPropertyName', 'IsCustomRelationship'],
    });
    if (!rel.success) return { success: false, error: rel.error };

    const candidates = (rel.data || []).filter(r =>
      !EXCLUDED_TABLES.has(r.ReferencingEntity) &&
      (STANDARD_RELATED_TABLES[r.ReferencingEntity] || isCustomerCustomization(r.ReferencingEntity))
    );
    // Tables that point to two projects (e.g. cross-project dependencies) can't be re-pointed to one target project
    const projectLookups = new Map<string, number>();
    for (const r of candidates) if (r.ReferencingEntity !== 'annotation') projectLookups.set(r.ReferencingEntity, (projectLookups.get(r.ReferencingEntity) || 0) + 1);

    const tables: Omit<RelatedTableInfo, 'existsInTarget' | 'sourceCount'>[] = [];
    const seen = new Set<string>();
    for (const r of candidates) {
      const key = `${r.ReferencingEntity}.${r.ReferencingAttribute}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if ((projectLookups.get(r.ReferencingEntity) || 0) > 1) continue;
      const entity = await this.getEntity(r.ReferencingEntity);
      if (!entity || entity.IsBPFEntity || entity.IsIntersect || entity.IsActivity) continue;
      if (r.ReferencingEntity === 'annotation' && r.ReferencingAttribute !== 'objectid') continue;
      if (!STANDARD_RELATED_TABLES[r.ReferencingEntity] && !entity.IsCustomEntity) continue;
      tables.push({
        logicalName: entity.LogicalName,
        entitySetName: entity.EntitySetName,
        displayName: STANDARD_RELATED_TABLES[entity.LogicalName] || label(entity.DisplayCollectionName) || label(entity.DisplayName) || entity.LogicalName,
        primaryIdAttribute: entity.PrimaryIdAttribute,
        primaryNameAttribute: entity.PrimaryNameAttribute,
        projectLookup: r.ReferencingAttribute,
        projectNavigation: r.ReferencingEntityNavigationPropertyName,
        isCustom: isCustomerCustomization(entity.LogicalName),
      });
    }
    const order = Object.keys(STANDARD_RELATED_TABLES);
    tables.sort((a, b) => {
      const ia = order.indexOf(a.logicalName);
      const ib = order.indexOf(b.logicalName);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.displayName.localeCompare(b.displayName);
    });
    return { success: true, data: tables };
  }

  /** Createable columns of a table, with lookup navigation properties, for generic record copy */
  getTableSchema(logicalName: string): Promise<TableSchema | undefined> {
    if (!this.schemaCache.has(logicalName)) {
      this.schemaCache.set(logicalName, this.loadTableSchema(logicalName));
    }
    return this.schemaCache.get(logicalName)!;
  }

  private async loadTableSchema(logicalName: string): Promise<TableSchema | undefined> {
    const entity = await this.getEntity(logicalName);
    if (!entity) return undefined;

    const [attrs, rels] = await Promise.all([
      this.client.query<AttributeMetadata>(`EntityDefinitions(LogicalName='${logicalName}')/Attributes`, {
        select: ['LogicalName', 'AttributeType', 'IsCustomAttribute', 'AttributeOf', 'IsValidForCreate', 'IsPrimaryId'],
      }),
      this.client.query<RelationshipMetadata>(`EntityDefinitions(LogicalName='${logicalName}')/ManyToOneRelationships`, {
        select: ['SchemaName', 'ReferencingAttribute', 'ReferencedEntity', 'ReferencingEntityNavigationPropertyName'],
      }),
    ]);
    if (!attrs.success) return undefined;

    const navByAttribute = new Map<string, { entity: string; navigation: string }[]>();
    for (const r of rels.data || []) {
      const list = navByAttribute.get(r.ReferencingAttribute) || [];
      list.push({ entity: r.ReferencedEntity, navigation: r.ReferencingEntityNavigationPropertyName });
      navByAttribute.set(r.ReferencingAttribute, list);
    }

    const createable: ColumnInfo[] = [];
    for (const a of attrs.data || []) {
      if (!a.IsValidForCreate || a.AttributeOf || SKIPPED_COLUMNS.has(a.LogicalName)) continue;
      if (a.IsPrimaryId) {
        createable.push({ logicalName: a.LogicalName, type: 'Uniqueidentifier', isCustom: false });
        continue;
      }
      if (SIMPLE_TYPES.has(a.AttributeType)) {
        createable.push({ logicalName: a.LogicalName, type: a.AttributeType, isCustom: isCustomerCustomization(a.LogicalName) });
      } else if (LOOKUP_TYPES.has(a.AttributeType)) {
        const targets = navByAttribute.get(a.LogicalName) || [];
        if (targets.length) {
          createable.push({
            logicalName: a.LogicalName,
            type: a.AttributeType,
            isCustom: isCustomerCustomization(a.LogicalName),
            lookup: { navigation: targets[0].navigation, targets },
          });
        }
      }
    }

    return {
      logicalName,
      entitySetName: entity.EntitySetName,
      primaryIdAttribute: entity.PrimaryIdAttribute,
      primaryNameAttribute: entity.PrimaryNameAttribute,
      createable,
    };
  }

  /** Custom simple columns on msdyn_projecttask (copied with tasks when present in both environments) */
  async getCustomTaskColumns(): Promise<string[]> {
    const schema = await this.getTableSchema('msdyn_projecttask');
    return (schema?.createable || []).filter(c => c.isCustom && !c.lookup && c.type !== 'Uniqueidentifier').map(c => c.logicalName);
  }
}
