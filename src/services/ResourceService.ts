/**
 * Resource Service — maps source bookable resources to target bookable resources and validates them.
 *
 * Matching order for each source resource:
 *   1. manual override chosen in the UI
 *   2. same bookable resource ID in the target (environments copied from one another keep IDs)
 *   3. same Entra user (azureactivedirectoryobjectid) — stable across environments in a tenant
 *   4. same email (user or contact)
 *   5. same name, when it's unique in the target
 * Generic resources map to the target's generic resource and keep their role.
 *
 * Each matched target resource is validated: active, linked user enabled, calendar exists.
 */

import { DataverseClient } from '../clients/DataverseClient';
import type {
  ResourceInfo,
  ResourceIssue,
  ResourceMatchMethod,
  RoleInfo,
  ServiceResult,
  SourceAssignment,
  SourceTeamMember,
  TargetProjectState,
  TeamMemberPlan,
} from '../types/migration';
import { RESOURCE_TYPE } from '../types/migration';
import { chunk, inFilter, normalizeGuid, normalizeKey } from '../utils/odata';
import { parsePlannedWork, totalHours } from '../utils/plannedWork';

interface ResourceRow {
  bookableresourceid: string;
  name: string;
  resourcetype: number;
  statecode: number;
  _calendarid_value?: string;
  _userid_value?: string;
  _contactid_value?: string;
  UserId?: { azureactivedirectoryobjectid?: string; internalemailaddress?: string; domainname?: string; isdisabled?: boolean } | null;
  ContactId?: { emailaddress1?: string } | null;
}

const RESOURCE_SELECT = ['bookableresourceid', 'name', 'resourcetype', 'statecode', '_calendarid_value', '_userid_value', '_contactid_value'];
const RESOURCE_EXPAND = 'UserId($select=azureactivedirectoryobjectid,internalemailaddress,domainname,isdisabled),ContactId($select=emailaddress1)';

export interface ResourceMatch {
  source: ResourceInfo;
  target?: ResourceInfo;
  method: ResourceMatchMethod;
  issues: ResourceIssue[];
  /** Target user that exists without a bookable resource */
  targetUserWithoutResource?: { id: string; name?: string };
  userDisabled?: boolean;
}

export interface ResourceResolution {
  matches: Map<string, ResourceMatch>;
  targetResources: ResourceInfo[];
  targetGeneric?: ResourceInfo;
  sourceRoles: Map<string, RoleInfo>;
  targetRoles: RoleInfo[];
}

export interface TeamPlanOptions {
  /** What to do with team members whose resource can't be resolved */
  unresolved: 'generic' | 'skip';
  /** Role used when the source role doesn't exist in the target */
  fallbackRoleId?: string;
  /** Manual role overrides (source role id → target role id) */
  roleOverrides?: Record<string, string>;
}

function toInfo(row: ResourceRow, userDisabled?: boolean): ResourceInfo & { userDisabled?: boolean } {
  return {
    id: row.bookableresourceid,
    name: row.name,
    resourceType: row.resourcetype,
    active: row.statecode === 0,
    calendarId: normalizeGuid(row._calendarid_value),
    userId: row._userid_value,
    contactId: row._contactid_value,
    aadObjectId: normalizeGuid(row.UserId?.azureactivedirectoryobjectid),
    email: (row.UserId?.internalemailaddress || row.UserId?.domainname || row.ContactId?.emailaddress1 || '').toLowerCase() || undefined,
    userDisabled: userDisabled ?? row.UserId?.isdisabled,
  };
}

export const RESOURCE_TYPE_LABEL: Record<number, string> = {
  1: 'Generic', 2: 'Contact', 3: 'User', 4: 'Equipment', 5: 'Account', 6: 'Crew', 7: 'Facility', 8: 'Pool',
};

export class ResourceService {
  constructor(private source: DataverseClient, private target: DataverseClient) {}

  private async loadSourceResources(ids: string[]): Promise<ServiceResult<ResourceInfo[]>> {
    const all: ResourceInfo[] = [];
    for (const group of chunk(ids, 50)) {
      const r = await this.source.query<ResourceRow>('bookableresources', { select: RESOURCE_SELECT, expand: RESOURCE_EXPAND, filter: inFilter('bookableresourceid', group) });
      if (!r.success) return { success: false, error: r.error };
      all.push(...(r.data || []).map(row => toInfo(row)));
    }
    return { success: true, data: all };
  }

  private async loadTargetResources(): Promise<ServiceResult<ResourceInfo[]>> {
    const r = await this.target.query<ResourceRow>('bookableresources', { select: RESOURCE_SELECT, expand: RESOURCE_EXPAND });
    if (!r.success) return { success: false, error: r.error };
    return { success: true, data: (r.data || []).map(row => toInfo(row)) };
  }

  private async existingCalendars(ids: string[]): Promise<Set<string> | undefined> {
    const found = new Set<string>();
    for (const group of chunk([...new Set(ids)], 50)) {
      const r = await this.target.query<{ calendarid: string }>('calendars', { select: ['calendarid'], filter: inFilter('calendarid', group) });
      if (!r.success) return undefined; // can't verify (privilege) — don't flag
      (r.data || []).forEach(c => found.add(c.calendarid.toLowerCase()));
    }
    return found;
  }

  private async targetUsersByAad(aadIds: string[]): Promise<Map<string, { id: string; name?: string; disabled: boolean }>> {
    const map = new Map<string, { id: string; name?: string; disabled: boolean }>();
    for (const group of chunk([...new Set(aadIds)], 50)) {
      const r = await this.target.query<{ systemuserid: string; fullname?: string; isdisabled?: boolean; azureactivedirectoryobjectid?: string }>('systemusers', {
        select: ['systemuserid', 'fullname', 'isdisabled', 'azureactivedirectoryobjectid'],
        filter: inFilter('azureactivedirectoryobjectid', group),
      });
      for (const u of r.data || []) {
        const aad = normalizeGuid(u.azureactivedirectoryobjectid);
        if (aad) map.set(aad, { id: u.systemuserid, name: u.fullname, disabled: !!u.isdisabled });
      }
    }
    return map;
  }

  private async loadRoles(client: DataverseClient): Promise<RoleInfo[]> {
    const r = await client.query<{ bookableresourcecategoryid: string; name: string }>('bookableresourcecategories', { select: ['bookableresourcecategoryid', 'name'], filter: 'statecode eq 0' });
    return (r.data || []).map(c => ({ id: c.bookableresourcecategoryid, name: c.name }));
  }

  /**
   * Resolve every source resource used by the given team members.
   * `overrides` maps source bookable resource ID → target bookable resource ID.
   */
  async resolve(teamMembers: SourceTeamMember[], overrides: Record<string, string> = {}): Promise<ServiceResult<ResourceResolution>> {
    const sourceIds = [...new Set(teamMembers.map(t => t._msdyn_bookableresourceid_value).filter(Boolean) as string[])];
    const [sourceRes, targetRes, sourceRolesList, targetRoles] = await Promise.all([
      sourceIds.length ? this.loadSourceResources(sourceIds) : Promise.resolve({ success: true, data: [] } as ServiceResult<ResourceInfo[]>),
      this.loadTargetResources(),
      this.loadRoles(this.source),
      this.loadRoles(this.target),
    ]);
    if (!sourceRes.success) return { success: false, error: `Could not read source bookable resources: ${sourceRes.error}` };
    if (!targetRes.success) return { success: false, error: `Could not read target bookable resources: ${targetRes.error}` };

    const targets = targetRes.data || [];
    const byId = new Map(targets.map(t => [t.id, t]));
    const byAad = new Map<string, ResourceInfo[]>();
    const byEmail = new Map<string, ResourceInfo[]>();
    const byName = new Map<string, ResourceInfo[]>();
    const add = (m: Map<string, ResourceInfo[]>, k: string | undefined, r: ResourceInfo) => { if (k) m.set(k, [...(m.get(k) || []), r]); };
    for (const t of targets) {
      add(byAad, t.aadObjectId, t);
      add(byEmail, t.email, t);
      add(byName, normalizeKey(t.name), t);
    }
    const prefer = (list: ResourceInfo[] | undefined): ResourceInfo | undefined => {
      if (!list?.length) return undefined;
      const active = list.filter(r => r.active);
      return (active.length ? active : list)[0];
    };
    const targetGeneric = targets.find(t => t.resourceType === RESOURCE_TYPE.Generic && t.active) || targets.find(t => t.resourceType === RESOURCE_TYPE.Generic);

    const matches = new Map<string, ResourceMatch>();
    for (const src of sourceRes.data || []) {
      let target: ResourceInfo | undefined;
      let method: ResourceMatchMethod = 'none';
      const issues: ResourceIssue[] = [];

      if (overrides[src.id] && byId.has(overrides[src.id])) {
        target = byId.get(overrides[src.id]);
        method = 'manual';
      } else if (src.resourceType === RESOURCE_TYPE.Generic) {
        target = targets.find(t => t.resourceType === RESOURCE_TYPE.Generic && normalizeKey(t.name) === normalizeKey(src.name)) || targetGeneric;
        method = target ? 'generic' : 'none';
      } else if (byId.has(src.id)) {
        target = byId.get(src.id);
        method = 'same-id';
      } else if (src.aadObjectId && byAad.has(src.aadObjectId)) {
        target = prefer(byAad.get(src.aadObjectId));
        method = 'entra-user';
      } else if (src.email && byEmail.has(src.email)) {
        target = prefer(byEmail.get(src.email));
        method = 'email';
      } else {
        const named = byName.get(normalizeKey(src.name)) || [];
        const sameType = named.filter(n => n.resourceType === src.resourceType);
        const pool = sameType.length ? sameType : named;
        if (pool.length === 1) {
          target = pool[0];
          method = 'name';
        } else if (pool.length > 1) {
          issues.push({
            code: 'ambiguous',
            severity: 'error',
            message: `${pool.length} target resources are named "${src.name}".`,
            fix: 'Pick the right one in the resource table, or rename the duplicates in the target.',
          });
        }
      }

      matches.set(src.id, { source: src, target, method, issues });
    }

    // Users that exist in the target but have no bookable resource
    const unresolvedAad = [...matches.values()].filter(m => !m.target && m.source.aadObjectId).map(m => m.source.aadObjectId!) ;
    const usersByAad = unresolvedAad.length ? await this.targetUsersByAad(unresolvedAad) : new Map();

    const calendars = await this.existingCalendars([...matches.values()].map(m => m.target?.calendarId).filter(Boolean) as string[]);

    for (const m of matches.values()) {
      const src = m.source;
      if (!m.target) {
        if (m.issues.some(i => i.code === 'ambiguous')) continue;
        const user = src.aadObjectId ? usersByAad.get(src.aadObjectId) : undefined;
        if (user) {
          m.targetUserWithoutResource = { id: user.id, name: user.name };
          m.issues.push({
            code: 'user-without-resource',
            severity: 'error',
            message: `${src.name} is a user in the target but has no bookable resource.`,
            fix: `In the target, go to Resources > Resources > New, select user "${user.name || src.name}", set Work Hours and save.`,
          });
        } else {
          m.issues.push({
            code: 'not-found',
            severity: 'error',
            message: `${src.name} (${RESOURCE_TYPE_LABEL[src.resourceType] || 'resource'}) doesn't exist in the target.`,
            fix: src.resourceType === RESOURCE_TYPE.User
              ? `Add ${src.email || src.name} to the target environment, create a bookable resource for them, then re-check. Or pick another resource in the table.`
              : `Create a bookable resource named "${src.name}" in the target, then re-check. Or pick another resource in the table.`,
          });
        }
        continue;
      }
      const t = m.target as ResourceInfo & { userDisabled?: boolean };
      if (!t.active) {
        m.issues.push({ code: 'inactive', severity: 'error', message: `Target resource "${t.name}" is inactive.`, fix: `Activate "${t.name}" under Resources > Resources in the target.` });
      }
      if (t.userDisabled) {
        m.userDisabled = true;
        m.issues.push({ code: 'inactive', severity: 'warning', message: `The user behind "${t.name}" is disabled in the target.`, fix: 'Enable the user or assign a licence so they can be scheduled.' });
      }
      if (!t.calendarId || (calendars && !calendars.has(t.calendarId))) {
        m.issues.push({
          code: 'no-calendar',
          severity: 'error',
          message: `Target resource "${t.name}" has no valid calendar (work hours).`,
          fix: `Open "${t.name}" under Resources > Resources in the target and set its Work Hours.`,
        });
      }
    }

    const sourceRoles = new Map<string, RoleInfo>();
    for (const r of sourceRolesList) sourceRoles.set(r.id, r);
    for (const tm of teamMembers) {
      const id = tm._msdyn_resourcecategory_value;
      if (id && !sourceRoles.has(id)) sourceRoles.set(id, { id, name: tm.roleName || id });
    }

    return {
      success: true,
      data: { matches, targetResources: targets, targetGeneric, sourceRoles, targetRoles },
    };
  }

  /** Map a source role to a target role: override → same ID → same name → fallback */
  static mapRole(
    sourceRoleId: string | undefined,
    resolution: Pick<ResourceResolution, 'sourceRoles' | 'targetRoles'>,
    options: Pick<TeamPlanOptions, 'fallbackRoleId' | 'roleOverrides'>
  ): { role?: RoleInfo; usedFallback: boolean } {
    const byId = new Map(resolution.targetRoles.map(r => [r.id, r]));
    if (sourceRoleId) {
      const override = options.roleOverrides?.[sourceRoleId];
      if (override && byId.has(override)) return { role: byId.get(override), usedFallback: false };
      if (byId.has(sourceRoleId)) return { role: byId.get(sourceRoleId), usedFallback: false };
      const name = resolution.sourceRoles.get(sourceRoleId)?.name;
      const byName = name ? resolution.targetRoles.find(r => normalizeKey(r.name) === normalizeKey(name)) : undefined;
      if (byName) return { role: byName, usedFallback: false };
    }
    if (options.fallbackRoleId && byId.has(options.fallbackRoleId)) return { role: byId.get(options.fallbackRoleId), usedFallback: true };
    return { usedFallback: false };
  }

  /** Build the per-project plan for team members (pure; used by readiness and execution) */
  static planTeam(
    teamMembers: SourceTeamMember[],
    assignments: SourceAssignment[],
    resolution: ResourceResolution,
    targetState: TargetProjectState | undefined,
    options: TeamPlanOptions
  ): TeamMemberPlan[] {
    const hoursByMember = new Map<string, { count: number; hours: number }>();
    for (const a of assignments) {
      if (!a._msdyn_projectteamid_value) continue;
      const cur = hoursByMember.get(a._msdyn_projectteamid_value) || { count: 0, hours: 0 };
      cur.count++;
      cur.hours += totalHours(parsePlannedWork(a.msdyn_plannedwork));
      hoursByMember.set(a._msdyn_projectteamid_value, cur);
    }

    return teamMembers.map(tm => {
      const match = tm._msdyn_bookableresourceid_value ? resolution.matches.get(tm._msdyn_bookableresourceid_value) : undefined;
      const sourceRole = tm._msdyn_resourcecategory_value ? resolution.sourceRoles.get(tm._msdyn_resourcecategory_value) || { id: tm._msdyn_resourcecategory_value, name: tm.roleName || 'Unknown role' } : undefined;
      const { role: targetRole, usedFallback } = ResourceService.mapRole(tm._msdyn_resourcecategory_value, resolution, options);
      const stats = hoursByMember.get(tm.msdyn_projectteamid) || { count: 0, hours: 0 };
      const isGeneric = match?.source.resourceType === RESOURCE_TYPE.Generic;
      const displayName = (isGeneric ? tm.msdyn_name || sourceRole?.name : tm.resourceName || tm.msdyn_name) || tm.resourceName || 'Team member';

      const issues: ResourceIssue[] = [...(match?.issues || [])];
      if (!match) {
        issues.push({ code: 'no-source-resource', severity: 'warning', message: `"${displayName}" has no bookable resource in the source.` });
      }
      if (sourceRole && !targetRole) {
        issues.push({
          code: 'role-missing',
          severity: 'error',
          message: `Role "${sourceRole.name}" doesn't exist in the target.`,
          fix: `Create the role "${sourceRole.name}" under Resources > Resource Roles in the target, or choose a fallback role in Options.`,
        });
      } else if (sourceRole && usedFallback) {
        issues.push({ code: 'role-missing', severity: 'warning', message: `Role "${sourceRole.name}" doesn't exist in the target; using "${targetRole!.name}" instead.` });
      }

      const blocking = issues.some(i => i.severity === 'error' && i.code !== 'role-missing') || !match?.target;
      const resourceOk = !!match?.target && !blocking;
      let action: TeamMemberPlan['action'];
      let existingTargetTeamMemberId: string | undefined;

      if (resourceOk && !isGeneric) {
        const existing = targetState?.teamMembers.find(t => t.resourceId && t.resourceId === match!.target!.id);
        if (existing) {
          action = 'reuse';
          existingTargetTeamMemberId = existing.id;
        } else {
          action = targetRole ? 'create' : 'skip';
        }
      } else if (isGeneric || options.unresolved === 'generic') {
        const existingGeneric = targetState?.teamMembers.find(t => normalizeKey(t.name) === normalizeKey(displayName) && (!targetRole || t.roleId === targetRole.id));
        if (existingGeneric) {
          action = 'reuse';
          existingTargetTeamMemberId = existingGeneric.id;
        } else {
          action = targetRole ? 'generic' : 'skip';
        }
      } else {
        action = 'skip';
      }

      return {
        sourceTeamMemberId: tm.msdyn_projectteamid,
        displayName,
        source: match?.source,
        target: resourceOk ? match!.target : undefined,
        method: match?.method || 'none',
        sourceRole,
        targetRole,
        issues,
        action,
        existingTargetTeamMemberId,
        assignmentCount: stats.count,
        plannedHours: Math.round(stats.hours * 100) / 100,
      };
    });
  }
}
