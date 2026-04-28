/**
 * Splits entities into batches respecting OperationSet size limits
 * Max 200 operations per OperationSet
 */

import { MAX_OPERATIONS_PER_SET } from '../config/appConfig';
import { PssEntity } from '../types/operationSet';

/**
 * Split an array of PssEntity into batches of MAX_OPERATIONS_PER_SET
 */
export function batchEntities<T extends PssEntity>(entities: T[], batchSize?: number): T[][] {
  const size = batchSize || MAX_OPERATIONS_PER_SET;
  const batches: T[][] = [];

  for (let i = 0; i < entities.length; i += size) {
    batches.push(entities.slice(i, i + size));
  }

  console.log(`operationSetBatcher: Split ${entities.length} entities into ${batches.length} batches (max ${size}/batch)`);
  return batches;
}

/**
 * Create batch descriptions for logging
 */
export function getBatchDescription(entityType: string, batchIndex: number, totalBatches: number, batchSize: number): string {
  return `${entityType} batch ${batchIndex + 1}/${totalBatches} (${batchSize} ops)`;
}
