/**
 * Application-wide configuration constants
 */

/** Timeout for read operations (GET requests) in milliseconds */
export const READ_TIMEOUT = 60000;

/** Timeout for write operations (POST/PATCH) in milliseconds */
export const WRITE_TIMEOUT = 120000;

/** Timeout for Schedule API actions (CreateProjectV1, ExecuteOperationSet) in milliseconds */
export const OPERATION_SET_TIMEOUT = 180000;

/** Maximum operations per OperationSet (D365 limit is 200) */
export const MAX_OPERATIONS_PER_SET = 200;

/** Delay between OperationSet executions to avoid throttling (ms) */
export const OPERATION_SET_DELAY = 500;

/** Records per page requested from the Web API */
export const PAGE_SIZE = 5000;

/** Polling interval for OperationSet status checks (ms) */
export const POLL_INTERVAL = 2000;

/** How long to wait for an OperationSet to finish before giving up (ms) */
export const OPERATION_SET_MAX_WAIT = 10 * 60 * 1000;

/** Parallel requests when reading per-project data */
export const READ_CONCURRENCY = 4;
