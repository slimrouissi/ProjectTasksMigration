/**
 * OData / Dataverse helpers shared by the services
 */

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Normalize a GUID (strip braces, trim, lower-case). Returns undefined when not a GUID. */
export function normalizeGuid(value?: string | null): string | undefined {
  if (!value) return undefined;
  const guid = String(value).trim().replace(/^\{|\}$/g, '').toLowerCase();
  return GUID_PATTERN.test(guid) ? guid : undefined;
}

export function isGuid(value?: string | null): boolean {
  return !!normalizeGuid(value);
}

/** Escape a value for use inside a single-quoted OData string literal */
export function odataString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Read the formatted-value annotation Dataverse returns for lookups and option sets */
export function formatted(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[`${field}@OData.Community.Display.V1.FormattedValue`];
  return typeof value === 'string' ? value : undefined;
}

/** Case- and whitespace-insensitive key for matching names and identifiers */
export function normalizeKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Split an array into chunks of `size` */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Build a filter that matches any of the given GUIDs, using the Dataverse In() query function
 * (works for both attributes and lookup properties).
 */
export function inFilter(property: string, guids: string[]): string {
  const values = guids.map(g => `'${g}'`).join(',');
  return `Microsoft.Dynamics.CRM.In(PropertyName='${property}',PropertyValues=[${values}])`;
}

/** Run async work over items with a concurrency limit, preserving order */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Random GUID that works in browsers and Node */
export function newGuid(): string {
  return crypto.randomUUID();
}
