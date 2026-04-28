/**
 * ID Mapping Service
 * Manages source GUID → target GUID mappings for all entity types
 * Pre-generates target IDs client-side and stores the mapping for audit
 */

import { EntityType, IdMapping, IdMappingTable } from '../types/migration';

export class IdMappingService {
  private mappings: Map<string, string> = new Map();
  private entries: IdMapping[] = [];
  private projectId: string;
  private projectName: string;

  constructor(projectId: string, projectName: string) {
    this.projectId = projectId;
    this.projectName = projectName;
  }

  /**
   * Generate a new target GUID for a source entity and store the mapping
   */
  createMapping(entityType: EntityType, sourceId: string, sourceName?: string): string {
    const targetId = crypto.randomUUID();
    this.mappings.set(sourceId, targetId);
    this.entries.push({
      entityType,
      sourceId,
      targetId,
      sourceName,
    });
    return targetId;
  }

  /**
   * Register an externally-created mapping (e.g., from CreateProjectV1 response)
   */
  registerMapping(entityType: EntityType, sourceId: string, targetId: string, sourceName?: string): void {
    this.mappings.set(sourceId, targetId);
    this.entries.push({
      entityType,
      sourceId,
      targetId,
      sourceName,
    });
  }

  /**
   * Look up a target ID by source ID
   */
  getTargetId(sourceId: string): string | undefined {
    return this.mappings.get(sourceId);
  }

  /**
   * Get a Map of source → target IDs for a specific entity type
   */
  getMapForType(entityType: EntityType): Map<string, string> {
    const map = new Map<string, string>();
    for (const entry of this.entries) {
      if (entry.entityType === entityType) {
        map.set(entry.sourceId, entry.targetId);
      }
    }
    return map;
  }

  /**
   * Get the full mapping table for export
   */
  toMappingTable(): IdMappingTable {
    return {
      projectId: this.projectId,
      projectName: this.projectName,
      mappings: [...this.entries],
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Export mapping table as downloadable JSON
   */
  toJSON(): string {
    return JSON.stringify(this.toMappingTable(), null, 2);
  }
}
