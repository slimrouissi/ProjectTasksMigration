/**
 * Environment Service — identifies an environment (friendly name, versions, signed-in user)
 * and checks the migration user's setup. Showing the friendly name next to the URL avoids
 * pointing the tool at the wrong environment (e.g. Test vs Prod with similar org IDs).
 */

import { DataverseClient } from '../clients/DataverseClient';
import type { OrganizationInfo, ReadinessCheck, ServiceResult } from '../types/migration';
import { extractDataverseErrorMessage } from '../utils/dataverseErrors';

interface OrgDetail {
  Detail?: {
    FriendlyName?: string;
    UniqueName?: string;
    UrlName?: string;
    EnvironmentId?: string;
    OrganizationVersion?: string;
  };
}

export interface MigrationUserProfile {
  userId: string;
  fullName?: string;
  aadObjectId?: string;
  isApplicationUser: boolean;
  isDisabled: boolean;
  bookableResource?: { id: string; name: string; calendarId?: string; active: boolean; calendarExists?: boolean };
}

export class EnvironmentService {
  constructor(private client: DataverseClient) {}

  async getOrganizationInfo(): Promise<ServiceResult<OrganizationInfo>> {
    const who = await this.client.whoAmI();
    if (!who.success || !who.data) return { success: false, error: extractDataverseErrorMessage(who.error) };

    const [org, solutions, user] = await Promise.all([
      this.client.get<OrgDetail>("RetrieveCurrentOrganization(AccessType=@p)?@p=Microsoft.Dynamics.CRM.EndpointAccessType'Default'"),
      this.client.query<{ uniquename: string; version: string }>('solutions', {
        select: ['uniquename', 'version'],
        filter: "uniquename eq 'msdyn_ProjectServiceCore' or uniquename eq 'msdyn_ProjectOperations'",
      }),
      this.client.get<{ fullname?: string }>(`systemusers(${who.data.UserId})?$select=fullname`),
    ]);

    const detail = org.data?.Detail || {};
    const poVersion = solutions.data?.find(s => s.uniquename === 'msdyn_ProjectServiceCore')?.version;
    const host = new URL(this.client.env.url || 'https://unknown').host;

    return {
      success: true,
      data: {
        friendlyName: detail.FriendlyName || host,
        uniqueName: detail.UniqueName || '',
        urlName: detail.UrlName || host.split('.')[0],
        environmentId: detail.EnvironmentId,
        version: detail.OrganizationVersion,
        projectOperationsVersion: poVersion,
        userId: who.data.UserId,
        userName: user.data?.fullname,
      },
    };
  }

  /** Who is running the migration in this environment, and do they have a usable bookable resource */
  async getMigrationUser(userId: string): Promise<ServiceResult<MigrationUserProfile>> {
    const user = await this.client.get<{ fullname?: string; applicationid?: string; azureactivedirectoryobjectid?: string; isdisabled?: boolean }>(
      `systemusers(${userId})?$select=fullname,applicationid,azureactivedirectoryobjectid,isdisabled`
    );
    if (!user.success || !user.data) return { success: false, error: extractDataverseErrorMessage(user.error) };

    const resources = await this.client.query<{ bookableresourceid: string; name: string; _calendarid_value?: string; statecode: number }>('bookableresources', {
      select: ['bookableresourceid', 'name', '_calendarid_value', 'statecode'],
      filter: `_userid_value eq ${userId}`,
    });
    const resource = resources.data?.[0];
    let calendarExists: boolean | undefined;
    if (resource?._calendarid_value) {
      const cal = await this.client.query<{ calendarid: string }>('calendars', { select: ['calendarid'], filter: `calendarid eq ${resource._calendarid_value}` });
      calendarExists = cal.success ? (cal.data?.length || 0) > 0 : undefined;
    }

    return {
      success: true,
      data: {
        userId,
        fullName: user.data.fullname,
        aadObjectId: user.data.azureactivedirectoryobjectid,
        isApplicationUser: !!user.data.applicationid,
        isDisabled: !!user.data.isdisabled,
        bookableResource: resource
          ? { id: resource.bookableresourceid, name: resource.name, calendarId: resource._calendarid_value, active: resource.statecode === 0, calendarExists }
          : undefined,
      },
    };
  }

  /** Readiness checks for the user running the migration in the target */
  static migrationUserChecks(profile: MigrationUserProfile | undefined, envName: string, createsProjects: boolean): ReadinessCheck[] {
    const checks: ReadinessCheck[] = [];
    if (!profile) return checks;

    checks.push(
      profile.isApplicationUser
        ? {
            id: 'user-license',
            area: 'environment',
            title: 'Migration account can use the Project schedule APIs',
            status: 'fail',
            detail: `${profile.fullName || 'This account'} is an application user. Microsoft only allows licensed users to create tasks and assignments.`,
            fix: 'Sign in with a named user account that has a Project Operations (or Project Plan) licence.',
          }
        : {
            id: 'user-license',
            area: 'environment',
            title: 'Migration account can use the Project schedule APIs',
            status: 'info',
            detail: `Signed in as ${profile.fullName || profile.userId}. This account needs a Project Operations or Project Plan licence; the tool can't read licences, so confirm it in the Microsoft 365 admin center.`,
          }
    );

    const res = profile.bookableResource;
    const severity = createsProjects ? 'fail' : 'warn';
    if (!res) {
      checks.push({
        id: 'user-resource',
        area: 'calendar',
        title: `Migration account has a bookable resource in ${envName}`,
        status: severity,
        detail: `No bookable resource is linked to ${profile.fullName || 'the migration account'}. Project Operations adds the person who creates a project as its project manager, which needs a bookable resource with work hours.`,
        fix: 'In the target, go to Resources > Resources > New, select the migration user, set its Work Hours, and save.',
      });
    } else if (!res.active || res.calendarExists === false || !res.calendarId) {
      checks.push({
        id: 'user-resource',
        area: 'calendar',
        title: `Migration account's bookable resource in ${envName} has work hours`,
        status: severity,
        detail: !res.active
          ? `Bookable resource "${res.name}" is inactive.`
          : `Bookable resource "${res.name}" points to a calendar that doesn't exist. This is a common cause of "The calendar for the specified work hour template cannot be found".`,
        fix: `Open Resources > "${res.name}" in the target, activate it if needed, and set its Work Hours.`,
      });
    } else {
      checks.push({
        id: 'user-resource',
        area: 'calendar',
        title: `Migration account has a bookable resource in ${envName}`,
        status: 'pass',
        detail: `"${res.name}" is active and has a calendar.`,
      });
    }
    return checks;
  }
}
