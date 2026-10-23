/**
 * Target Calendar Service — inspects work hour (calendar) templates in the destination environment
 *
 * msdyn_CreateProjectV1 builds each new project's calendar by copying the calendar of a work hour
 * template (the one passed on the project, or the Default Work Template from Project Parameters).
 * If that calendar doesn't exist in the target, project creation fails with 0x80040265:
 * "The calendar for the specified work hour template cannot be found."
 */

import { DataverseClient } from '../clients/DataverseClient';
import { extractDataverseErrorMessage } from '../utils/dataverseErrors';
import {
  ServiceResult,
  WorkHourTemplateCheck,
  WorkHourTemplateInfo,
  WorkHourTemplateStatus,
} from '../types/migration';

interface WorkHourTemplateRecord {
  msdyn_workhourtemplateid: string;
  msdyn_name: string;
  msdyn_calendarid?: string | null;
  _msdyn_bookableresourceid_value?: string | null;
}

interface ProjectParameterRecord {
  msdyn_projectparameterid: string;
  _msdyn_defaultworktemplate_value?: string | null;
}

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Normalize a GUID string (msdyn_calendarid is free text and may be upper case or wrapped in braces)
 */
function normalizeGuid(value?: string | null): string | undefined {
  if (!value) return undefined;
  const guid = value.trim().replace(/^\{|\}$/g, '').toLowerCase();
  return GUID_PATTERN.test(guid) ? guid : undefined;
}

/**
 * A template can be used when its calendar was found, or when it couldn't be verified
 */
export function isUsableTemplate(template: WorkHourTemplateInfo): boolean {
  return template.status === 'valid' || template.status === 'unknown';
}

/**
 * Pick the template to preselect: the target default if usable, otherwise the first valid one
 */
export function pickPreferredTemplate(check: WorkHourTemplateCheck): WorkHourTemplateInfo | undefined {
  const defaultTemplate = check.templates.find(t => t.isDefault);
  if (defaultTemplate && isUsableTemplate(defaultTemplate)) return defaultTemplate;
  return check.templates.find(t => t.status === 'valid') || check.templates.find(isUsableTemplate);
}

const STATUS_ORDER: Record<WorkHourTemplateStatus, number> = {
  valid: 0,
  unknown: 1,
  'no-work-hours': 2,
  'missing-calendar': 3,
};

export class TargetCalendarService {
  private client: DataverseClient;

  constructor(client: DataverseClient) {
    this.client = client;
  }

  /**
   * List active work hour templates in the target and check that each template's calendar exists
   */
  async getWorkHourTemplates(): Promise<ServiceResult<WorkHourTemplateCheck>> {
    const method = 'TargetCalendarService.getWorkHourTemplates';
    console.log(`${method}: Starting`);
    console.time(method);

    const [templatesResult, parametersResult] = await Promise.all([
      this.client.getAll<WorkHourTemplateRecord>(
        'msdyn_workhourtemplates',
        ['msdyn_workhourtemplateid', 'msdyn_name', 'msdyn_calendarid', '_msdyn_bookableresourceid_value'],
        'statecode eq 0'
      ),
      this.client.getAll<ProjectParameterRecord>(
        'msdyn_projectparameters',
        ['msdyn_projectparameterid', '_msdyn_defaultworktemplate_value']
      ),
    ]);

    if (!templatesResult.success) {
      console.timeEnd(method);
      return { success: false, error: extractDataverseErrorMessage(templatesResult.error) };
    }

    if (!parametersResult.success) {
      console.warn(`${method}: Could not read Project Parameters, default template unknown`, parametersResult.error);
    }
    const defaultTemplateId = normalizeGuid(parametersResult.data?.[0]?._msdyn_defaultworktemplate_value);

    const templates = await Promise.all(
      (templatesResult.data || []).map(async (record): Promise<WorkHourTemplateInfo> => {
        const id = normalizeGuid(record.msdyn_workhourtemplateid) || record.msdyn_workhourtemplateid;
        const calendarId = normalizeGuid(record.msdyn_calendarid);
        const { status, detail } = await this.checkCalendar(record.msdyn_calendarid, calendarId);

        return {
          id,
          name: record.msdyn_name,
          calendarId,
          templateResourceId: normalizeGuid(record._msdyn_bookableresourceid_value),
          isDefault: id === defaultTemplateId,
          status,
          statusDetail: detail,
        };
      })
    );

    templates.sort((a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.name.localeCompare(b.name)
    );

    const usableCount = templates.filter(isUsableTemplate).length;
    console.log(`${method}: ${templates.length} active templates, ${usableCount} usable, default = ${defaultTemplateId || 'none'}`);
    console.timeEnd(method);

    return { success: true, data: { templates, defaultTemplateId }, isLiveData: true };
  }

  /**
   * Verify that a template calendar exists and defines work hours (best effort)
   */
  private async checkCalendar(
    rawCalendarId: string | null | undefined,
    calendarId: string | undefined
  ): Promise<{ status: WorkHourTemplateStatus; detail?: string }> {
    if (!calendarId) {
      return {
        status: 'missing-calendar',
        detail: rawCalendarId ? `Calendar ID "${rawCalendarId}" is not a valid GUID` : 'Template has no calendar',
      };
    }

    const calendarResult = await this.client.getAll<{ calendarid: string }>(
      'calendars',
      ['calendarid'],
      `calendarid eq ${calendarId}`
    );
    if (!calendarResult.success) {
      return { status: 'unknown', detail: `Calendar could not be verified: ${extractDataverseErrorMessage(calendarResult.error)}` };
    }
    if (!calendarResult.data?.length) {
      return { status: 'missing-calendar', detail: `Calendar ${calendarId} does not exist in the target environment` };
    }

    // Rules hold the work hours; a failed read here is not treated as a problem
    const rulesResult = await this.client.getAll<{ calendarruleid: string }>(
      'calendarrules',
      ['calendarruleid'],
      `_calendarid_value eq ${calendarId}`
    );
    if (rulesResult.success && rulesResult.data?.length === 0) {
      return { status: 'no-work-hours', detail: `Calendar ${calendarId} has no work hours defined` };
    }

    return { status: 'valid' };
  }
}
