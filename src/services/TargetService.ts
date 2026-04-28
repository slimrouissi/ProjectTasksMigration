/**
 * Target Service — writes entities to destination environment via Schedule API
 * Uses ScheduleApiClient for all write operations
 */

import { ScheduleApiClient } from '../clients/ScheduleApiClient';
import { OPERATION_SET_DELAY } from '../config/appConfig';
import { ServiceResult, SourceProjectData } from '../types/migration';
import { PssEntity } from '../types/operationSet';
import { MigrationConfig, MigrationStage } from '../types/ui';
import { IdMappingService } from './IdMappingService';
import { sortTasksTopologically } from '../utils/taskSorter';
import { batchEntities, getBatchDescription } from '../utils/operationSetBatcher';
import {
  mapProject,
  mapTeamMember,
  mapTask,
  mapDependency,
  mapAssignment,
  mapBucket,
  mapSprint,
  calculateDateOffset,
} from '../utils/entityMapper';

export type StageCallback = (stage: MigrationStage, message: string, progress?: number) => void;

export class TargetService {
  private scheduleApi: ScheduleApiClient;

  constructor(scheduleApi: ScheduleApiClient) {
    this.scheduleApi = scheduleApi;
  }

  /**
   * Migrate a single project with all its entities
   */
  async migrateProject(
    data: SourceProjectData,
    config: MigrationConfig,
    onStage: StageCallback
  ): Promise<ServiceResult<IdMappingService>> {
    const method = `TargetService.migrateProject(${data.project.msdyn_subject})`;
    console.log(`${method}: Starting migration`);
    console.time(method);

    const idMap = new IdMappingService(data.project.msdyn_projectid, data.project.msdyn_subject);

    // Calculate date offset if shifting dates
    const dateOffset = config.dateHandling === 'shift' && data.project.msdyn_scheduledstart
      ? calculateDateOffset(data.project.msdyn_scheduledstart)
      : undefined;

    try {
      // Stage 1: Create project
      onStage('creating-project', `Creating project "${data.project.msdyn_subject}"...`);
      const targetProjectId = idMap.createMapping('project', data.project.msdyn_projectid, data.project.msdyn_subject);

      const projectPayload = mapProject(data.project, targetProjectId, config, dateOffset);
      const projectResult = await this.scheduleApi.createProject(projectPayload);
      if (!projectResult.success) {
        throw new Error(`Failed to create project: ${projectResult.error}`);
      }
      console.log(`${method}: Project created with ID ${targetProjectId}`);

      // Stage 2: Create team members
      if (data.teamMembers.length > 0 && config.teamMembers !== 'skip') {
        onStage('creating-team', `Creating ${data.teamMembers.length} team members...`);

        for (let i = 0; i < data.teamMembers.length; i++) {
          const tm = data.teamMembers[i];
          const targetTmId = idMap.createMapping('teamMember', tm.msdyn_projectteamid, tm.msdyn_name);

          const tmPayload = mapTeamMember(tm, targetTmId, targetProjectId, dateOffset);
          const tmResult = await this.scheduleApi.createTeamMember(tmPayload);
          if (!tmResult.success) {
            console.error(`${method}: Failed to create team member "${tm.msdyn_name}": ${tmResult.error}`);
            // Continue with other team members
          }
          onStage('creating-team', `Created team member "${tm.msdyn_name}" (${i + 1}/${data.teamMembers.length})`, ((i + 1) / data.teamMembers.length) * 100);
        }
      }

      // Stage 3: Create custom buckets via OperationSet
      if (data.buckets.length > 0) {
        onStage('creating-buckets', `Creating ${data.buckets.length} buckets...`);

        const bucketEntities: PssEntity[] = [];
        for (const bucket of data.buckets) {
          const targetBucketId = idMap.createMapping('bucket', bucket.msdyn_projectbucketid, bucket.msdyn_name);
          bucketEntities.push(mapBucket(bucket, targetBucketId, targetProjectId));
        }

        const bucketBatches = batchEntities(bucketEntities);
        for (let i = 0; i < bucketBatches.length; i++) {
          const desc = getBatchDescription('Buckets', i, bucketBatches.length, bucketBatches[i].length);
          onStage('creating-buckets', desc, ((i + 1) / bucketBatches.length) * 100);

          const result = await this.scheduleApi.executeOperationBatch(
            targetProjectId, desc, bucketBatches[i]
          );
          if (!result.success) {
            console.error(`${method}: Bucket batch ${i + 1} failed: ${result.error}`);
          }
          if (i < bucketBatches.length - 1) await this.delay();
        }
      }

      // Stage 4: Create tasks via OperationSet (topologically sorted)
      if (data.tasks.length > 0) {
        onStage('creating-tasks', `Creating ${data.tasks.length} tasks...`);

        const sortedTasks = sortTasksTopologically(data.tasks);
        const taskIdMap = new Map<string, string>();
        const bucketIdMap = idMap.getMapForType('bucket');

        // Pre-generate all task IDs
        for (const task of sortedTasks) {
          const targetTaskId = idMap.createMapping('task', task.msdyn_projecttaskid, task.msdyn_subject);
          taskIdMap.set(task.msdyn_projecttaskid, targetTaskId);
        }

        // Map to PssEntity payloads
        const taskEntities: PssEntity[] = sortedTasks.map(task =>
          mapTask(task, taskIdMap.get(task.msdyn_projecttaskid)!, targetProjectId, taskIdMap, bucketIdMap, dateOffset)
        );

        const taskBatches = batchEntities(taskEntities);
        for (let i = 0; i < taskBatches.length; i++) {
          const desc = getBatchDescription('Tasks', i, taskBatches.length, taskBatches[i].length);
          onStage('creating-tasks', desc, ((i + 1) / taskBatches.length) * 100);

          const result = await this.scheduleApi.executeOperationBatch(
            targetProjectId, desc, taskBatches[i]
          );
          if (!result.success) {
            console.error(`${method}: Task batch ${i + 1} failed: ${result.error}`);
          }
          if (i < taskBatches.length - 1) await this.delay();
        }
      }

      // Stage 5: Create dependencies via OperationSet
      if (data.dependencies.length > 0) {
        onStage('creating-dependencies', `Creating ${data.dependencies.length} dependencies...`);

        const taskIdMap = idMap.getMapForType('task');
        const depEntities: PssEntity[] = [];

        for (const dep of data.dependencies) {
          const targetDepId = idMap.createMapping('dependency', dep.msdyn_projecttaskdependencyid);
          const mapped = mapDependency(dep, targetDepId, targetProjectId, taskIdMap);
          if (mapped) depEntities.push(mapped);
        }

        if (depEntities.length > 0) {
          const depBatches = batchEntities(depEntities);
          for (let i = 0; i < depBatches.length; i++) {
            const desc = getBatchDescription('Dependencies', i, depBatches.length, depBatches[i].length);
            onStage('creating-dependencies', desc, ((i + 1) / depBatches.length) * 100);

            const result = await this.scheduleApi.executeOperationBatch(
              targetProjectId, desc, depBatches[i]
            );
            if (!result.success) {
              console.error(`${method}: Dependency batch ${i + 1} failed: ${result.error}`);
            }
            if (i < depBatches.length - 1) await this.delay();
          }
        }
      }

      // Stage 6: Create assignments via OperationSet
      if (data.assignments.length > 0) {
        onStage('creating-assignments', `Creating ${data.assignments.length} assignments...`);

        const taskIdMap = idMap.getMapForType('task');
        const teamMemberIdMap = idMap.getMapForType('teamMember');
        const assignEntities: PssEntity[] = [];

        for (const assignment of data.assignments) {
          const targetAssignId = idMap.createMapping('assignment', assignment.msdyn_resourceassignmentid, assignment.msdyn_name);
          const mapped = mapAssignment(assignment, targetAssignId, targetProjectId, taskIdMap, teamMemberIdMap, dateOffset);
          if (mapped) assignEntities.push(mapped);
        }

        if (assignEntities.length > 0) {
          const assignBatches = batchEntities(assignEntities);
          for (let i = 0; i < assignBatches.length; i++) {
            const desc = getBatchDescription('Assignments', i, assignBatches.length, assignBatches[i].length);
            onStage('creating-assignments', desc, ((i + 1) / assignBatches.length) * 100);

            const result = await this.scheduleApi.executeOperationBatch(
              targetProjectId, desc, assignBatches[i]
            );
            if (!result.success) {
              console.error(`${method}: Assignment batch ${i + 1} failed: ${result.error}`);
            }
            if (i < assignBatches.length - 1) await this.delay();
          }
        }
      }

      // Stage 7: Create sprints via OperationSet
      if (data.sprints.length > 0) {
        onStage('creating-sprints', `Creating ${data.sprints.length} sprints...`);

        const sprintEntities: PssEntity[] = [];
        for (const sprint of data.sprints) {
          const targetSprintId = idMap.createMapping('sprint', sprint.msdyn_projectsprintid, sprint.msdyn_name);
          sprintEntities.push(mapSprint(sprint, targetSprintId, targetProjectId, dateOffset));
        }

        const sprintBatches = batchEntities(sprintEntities);
        for (let i = 0; i < sprintBatches.length; i++) {
          const desc = getBatchDescription('Sprints', i, sprintBatches.length, sprintBatches[i].length);
          onStage('creating-sprints', desc, ((i + 1) / sprintBatches.length) * 100);

          const result = await this.scheduleApi.executeOperationBatch(
            targetProjectId, desc, sprintBatches[i]
          );
          if (!result.success) {
            console.error(`${method}: Sprint batch ${i + 1} failed: ${result.error}`);
          }
          if (i < sprintBatches.length - 1) await this.delay();
        }
      }

      onStage('completed', `Migration of "${data.project.msdyn_subject}" completed successfully`, 100);
      console.log(`${method}: Migration completed successfully`);
      console.timeEnd(method);

      return { success: true, data: idMap, isLiveData: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`${method}: Migration failed`, error);
      console.timeEnd(method);
      onStage('failed', errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  private delay(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, OPERATION_SET_DELAY));
  }
}
