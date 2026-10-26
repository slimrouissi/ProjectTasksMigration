/**
 * Helpers that turn raw Dataverse Web API errors into readable migration log messages
 */

interface ScheduleBatchError {
  ErrorMessage?: string;
  errorKey?: string;
  failedBatchRequestIndex?: number;
  failedBatchRequestError?: { ErrorMessage?: string; errorKey?: string; field?: string; element?: string };
}

/** The schedule engine nests its own JSON inside error.message; turn it into one sentence */
function describeScheduleError(message: string): string | undefined {
  const start = message.indexOf('{');
  if (start < 0) return undefined;
  try {
    const inner = JSON.parse(message.slice(start)) as ScheduleBatchError;
    const failed = inner.failedBatchRequestError;
    if (failed?.ErrorMessage) {
      const where = inner.failedBatchRequestIndex != null ? ` (item ${inner.failedBatchRequestIndex + 1} in the batch` : ' (';
      const field = failed.field ? `${where.endsWith('(') ? '' : ', '}field ${failed.field}` : '';
      const suffix = where === ' (' && !field ? '' : `${where}${field})`;
      return `Schedule engine rejected the batch: ${failed.ErrorMessage}${suffix}`;
    }
    if (inner.ErrorMessage) return `Schedule engine: ${inner.ErrorMessage}`;
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Extract the message from a DataverseClient error ("HTTP 400: {json body}"), dropping plugin
 * traces and annotations. Returns the input unchanged when it isn't a JSON error body.
 */
export function extractDataverseErrorMessage(rawError?: string): string {
  if (!rawError) return 'Unknown error';

  const match = /^([\s\S]*?)HTTP (\d{3}): ([\s\S]+)$/.exec(rawError);
  if (!match) return rawError;

  try {
    const message = JSON.parse(match[3])?.error?.message;
    if (typeof message === 'string' && message) {
      return `${match[1]}HTTP ${match[2]}: ${describeScheduleError(message) || message}`;
    }
    return rawError;
  } catch {
    return rawError;
  }
}

/** True when project creation failed because the work hour template's calendar is missing or invalid */
export function isWorkHourTemplateCalendarError(rawError?: string): boolean {
  return !!rawError && /work hour template/i.test(rawError) && /calendar/i.test(rawError);
}

/** How to create a calendar template with valid work hours in the target (Project Operations UI) */
export const CALENDAR_TEMPLATE_FIX_STEPS =
  'In the target Project Operations app, go to Settings > Calendar Templates and create a new template: ' +
  'select a Template Resource that has work hours, or save the template and add work hours on its Calendar tab.';

export const WORK_HOUR_TEMPLATE_FIX =
  'The calendar template (work hour template) used for new projects has no valid calendar in the target environment. ' +
  `${CALENDAR_TEMPLATE_FIX_STEPS} ` +
  'Then select it under "Calendar template" in Options, or make it the Default Work Template in Settings > Parameters. ' +
  'To add into projects that already exist instead, choose "Add to existing projects".';
