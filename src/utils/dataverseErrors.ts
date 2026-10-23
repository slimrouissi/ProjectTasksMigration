/**
 * Helpers that turn raw Dataverse Web API errors into readable migration log messages
 */

/**
 * Extract the message from a DataverseClient error ("HTTP 400: {json body}"), dropping plugin
 * traces and annotations. Returns the input unchanged when it isn't a JSON error body.
 */
export function extractDataverseErrorMessage(rawError?: string): string {
  if (!rawError) return 'Unknown error';

  const match = /^HTTP (\d{3}): ([\s\S]+)$/.exec(rawError);
  if (!match) return rawError;

  try {
    const message = JSON.parse(match[2])?.error?.message;
    return typeof message === 'string' && message ? `HTTP ${match[1]}: ${message}` : rawError;
  } catch {
    return rawError;
  }
}

/**
 * True when project creation failed because the work hour template's calendar is missing or invalid
 */
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
  'Then select it under "Project Calendar" in step 3, or make it the Default Work Template in Settings > Parameters.';
