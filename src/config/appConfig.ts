/**
 * Application-wide configuration constants
 */

/** Timeout for read operations (GET requests) in milliseconds */
export const READ_TIMEOUT = 15000;

/** Timeout for write operations (POST/PATCH) in milliseconds */
export const WRITE_TIMEOUT = 30000;

/** Timeout for OperationSet execution in milliseconds */
export const OPERATION_SET_TIMEOUT = 60000;

/** Maximum operations per OperationSet (D365 limit) */
export const MAX_OPERATIONS_PER_SET = 200;

/** Maximum concurrent OperationSets per user (D365 limit) */
export const MAX_CONCURRENT_OPERATION_SETS = 10;

/** Delay between OperationSet executions to avoid throttling (ms) */
export const OPERATION_SET_DELAY = 1000;

/** Maximum records per page when fetching from Web API */
export const PAGE_SIZE = 5000;

/** Polling interval for OperationSet status checks (ms) */
export const POLL_INTERVAL = 2000;

/** Maximum polls before giving up on OperationSet completion */
export const MAX_POLL_ATTEMPTS = 30;
