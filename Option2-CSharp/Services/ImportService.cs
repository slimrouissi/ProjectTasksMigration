using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Serilog;

namespace ProjectMigration.Services;

/// <summary>
/// Imports projects into the target Dynamics 365 environment using the Schedule API.
/// Manages OperationSet creation, execution, and polling for completion.
/// </summary>
public class ImportService
{
    private readonly DataverseClient _targetClient;
    private readonly GuidMappingService _guidMappingService;
    private readonly MigrationConfig _migrationConfig;
    private readonly ILogger _logger;

    public ImportService(
        DataverseClient targetClient,
        GuidMappingService guidMappingService,
        MigrationConfig migrationConfig,
        ILogger logger)
    {
        _targetClient = targetClient;
        _guidMappingService = guidMappingService;
        _migrationConfig = migrationConfig;
        _logger = logger;
    }

    /// <summary>
    /// Imports a project and all its related entities into the target environment.
    /// </summary>
    public async Task<MigrationResult> ImportProjectAsync(
        ProjectExport export,
        IProgress<string>? progress = null,
        CancellationToken cancellationToken = default)
    {
        var result = new MigrationResult
        {
            SourceProjectId = export.Project.msdyn_projectid,
            ProjectName = export.Project.msdyn_projectname,
            StartTime = DateTime.UtcNow
        };

        try
        {
            progress?.Report($"Creating project: {export.Project.msdyn_projectname}");
            _logger.Information("Importing project: {ProjectName} ({ProjectId})",
                export.Project.msdyn_projectname, export.Project.msdyn_projectid);

            // 1. Create the project entity directly
            var newProjectId = await CreateProjectAsync(export.Project, cancellationToken)
                .ConfigureAwait(false);
            result.TargetProjectId = newProjectId;
            _guidMappingService.AddMapping(export.Project.msdyn_projectid, newProjectId);

            // Update all references to the old project ID in related entities
            var oldProjectId = export.Project.msdyn_projectid;
            foreach (var task in export.Tasks)
                task.msdyn_project = newProjectId;
            foreach (var team in export.TeamMembers)
                team.msdyn_project = newProjectId;
            foreach (var bucket in export.Buckets)
                bucket.msdyn_project = newProjectId;

            // 2. Import scheduling entities (tasks, team members, buckets) via OperationSet
            if (export.Tasks.Count > 0 || export.TeamMembers.Count > 0 || export.Buckets.Count > 0)
            {
                progress?.Report($"Creating scheduling entities (tasks, team members)");
                var (tasksCreated, teamCreated) = await ImportSchedulingEntitiesAsync(
                    newProjectId, export, cancellationToken).ConfigureAwait(false);
                result.TasksCreated = tasksCreated;
                result.TeamMembersCreated = teamCreated;
            }

            // 3. Import dependencies and assignments via OperationSet
            if (export.Dependencies.Count > 0 || export.Assignments.Count > 0)
            {
                progress?.Report($"Creating task dependencies and assignments");
                var (depsCreated, assignCreated) = await ImportDependenciesAndAssignmentsAsync(
                    export, cancellationToken).ConfigureAwait(false);
                result.DependenciesCreated = depsCreated;
                result.AssignmentsCreated = assignCreated;
            }

            result.Success = true;
            _logger.Information(
                "Successfully imported project {ProjectName}: {TaskCount} tasks, {TeamCount} team members, {DependencyCount} dependencies, {AssignmentCount} assignments",
                export.Project.msdyn_projectname, result.TasksCreated, result.TeamMembersCreated,
                result.DependenciesCreated, result.AssignmentsCreated);
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.ErrorMessage = ex.Message;
            _logger.Error(ex, "Failed to import project {ProjectName}", export.Project.msdyn_projectname);
        }

        result.EndTime = DateTime.UtcNow;
        return result;
    }

    /// <summary>
    /// Creates a project entity in the target environment.
    /// </summary>
    private async Task<Guid> CreateProjectAsync(
        ProjectEntity project,
        CancellationToken cancellationToken = default)
    {
        var payload = new Dictionary<string, object>
        {
            { "msdyn_projectname", project.msdyn_projectname },
            { "msdyn_description", project.msdyn_description }
        };

        if (project.statecode.HasValue)
            payload["statecode"] = project.statecode.Value;

        if (project.statuscode.HasValue)
            payload["statuscode"] = project.statuscode.Value;

        if (project.msdyn_contractlineid.HasValue)
            payload["msdyn_contractlineid@odata.bind"] = $"/msdyn_contractlines({project.msdyn_contractlineid:D})";

        // Add mapped custom fields
        foreach (var customField in project.CustomFields)
        {
            payload[customField.Key] = customField.Value;
        }

        var response = await _targetClient.PostAsync("msdyn_projects", payload, cancellationToken)
            .ConfigureAwait(false);

        var projectId = response["msdyn_projectid"]?.Value<Guid>();
        if (!projectId.HasValue || projectId.Value == Guid.Empty)
        {
            // Try to extract from response headers or response
            throw new InvalidOperationException("Failed to get new project ID from response");
        }

        _logger.Debug("Created project with ID {ProjectId}", projectId.Value);
        return projectId.Value;
    }

    /// <summary>
    /// Imports scheduling entities (tasks, team members, buckets) using the Schedule API.
    /// </summary>
    private async Task<(int tasksCreated, int teamCreated)> ImportSchedulingEntitiesAsync(
        Guid projectId,
        ProjectExport export,
        CancellationToken cancellationToken = default)
    {
        int tasksCreated = 0;
        int teamCreated = 0;

        // Batch operations
        var allOperations = new List<OperationSetOperation>();

        // Create bucket operations first
        foreach (var bucket in export.Buckets)
        {
            allOperations.Add(CreateBucketOperation(bucket));
        }

        // Create team member operations
        foreach (var teamMember in export.TeamMembers)
        {
            allOperations.Add(CreateTeamMemberOperation(teamMember));
            teamCreated++;
        }

        // Create task operations in hierarchical order (parents first)
        var sortedTasks = SortTasksByHierarchy(export.Tasks);
        foreach (var task in sortedTasks)
        {
            var taskOp = CreateTaskOperation(task);
            allOperations.Add(taskOp);
            tasksCreated++;
            _guidMappingService.AddMapping(task.msdyn_projecttaskid, Guid.NewGuid()); // Placeholder
        }

        // Execute in batches
        await ExecuteOperationSetsAsync(allOperations, cancellationToken).ConfigureAwait(false);

        _logger.Information("Created {TaskCount} tasks and {TeamCount} team members via OperationSet",
            tasksCreated, teamCreated);

        return (tasksCreated, teamCreated);
    }

    /// <summary>
    /// Imports dependencies and assignments using the Schedule API.
    /// </summary>
    private async Task<(int depsCreated, int assignCreated)> ImportDependenciesAndAssignmentsAsync(
        ProjectExport export,
        CancellationToken cancellationToken = default)
    {
        int depsCreated = 0;
        int assignCreated = 0;

        var allOperations = new List<OperationSetOperation>();

        // Create dependency operations
        foreach (var dependency in export.Dependencies)
        {
            var predTaskId = _guidMappingService.GetNewGuid(dependency.msdyn_predecessortask);
            var succTaskId = _guidMappingService.GetNewGuid(dependency.msdyn_successortask);

            allOperations.Add(CreateDependencyOperation(dependency, predTaskId, succTaskId));
            depsCreated++;
        }

        // Create assignment operations
        foreach (var assignment in export.Assignments)
        {
            var taskId = _guidMappingService.GetNewGuid(assignment.msdyn_projecttask);
            var resourceId = _guidMappingService.GetNewGuid(assignment.msdyn_resource);

            allOperations.Add(CreateAssignmentOperation(assignment, taskId, resourceId));
            assignCreated++;
        }

        // Execute in batches
        await ExecuteOperationSetsAsync(allOperations, cancellationToken).ConfigureAwait(false);

        _logger.Information("Created {DependencyCount} dependencies and {AssignmentCount} assignments via OperationSet",
            depsCreated, assignCreated);

        return (depsCreated, assignCreated);
    }

    /// <summary>
    /// Executes a list of operations in batches using the OperationSet API.
    /// </summary>
    private async Task ExecuteOperationSetsAsync(
        List<OperationSetOperation> allOperations,
        CancellationToken cancellationToken = default)
    {
        if (allOperations.Count == 0)
            return;

        // Split into batches
        var batches = SplitIntoBatches(allOperations, _migrationConfig.BatchSize);

        for (int i = 0; i < batches.Count; i++)
        {
            _logger.Information("Executing OperationSet batch {BatchNumber}/{TotalBatches} with {OperationCount} operations",
                i + 1, batches.Count, batches[i].Count);

            // Create OperationSet
            var operationSetId = await CreateOperationSetAsync(cancellationToken).ConfigureAwait(false);
            _logger.Debug("Created OperationSet {OperationSetId}", operationSetId);

            // Add all operations to the set
            foreach (var operation in batches[i])
            {
                await AddOperationToSetAsync(operationSetId, operation, cancellationToken)
                    .ConfigureAwait(false);
            }

            // Execute the set
            await ExecuteOperationSetAsync(operationSetId, cancellationToken).ConfigureAwait(false);

            // Poll for completion
            await PollOperationSetCompletionAsync(operationSetId, cancellationToken)
                .ConfigureAwait(false);

            _logger.Information("OperationSet batch {BatchNumber} completed successfully", i + 1);
        }
    }

    /// <summary>
    /// Creates a new OperationSet for scheduling operations.
    /// </summary>
    private async Task<Guid> CreateOperationSetAsync(CancellationToken cancellationToken = default)
    {
        var payload = new { };
        var response = await _targetClient.PostAsync("msdyn_CreateOperationSetV1", payload, cancellationToken)
            .ConfigureAwait(false);

        var operationSetId = response["operationsetid"]?.Value<Guid>();
        if (!operationSetId.HasValue || operationSetId.Value == Guid.Empty)
        {
            throw new InvalidOperationException("Failed to create OperationSet");
        }

        return operationSetId.Value;
    }

    /// <summary>
    /// Adds an operation to an OperationSet.
    /// </summary>
    private async Task AddOperationToSetAsync(
        Guid operationSetId,
        OperationSetOperation operation,
        CancellationToken cancellationToken = default)
    {
        var payload = new
        {
            operationsetid = operationSetId,
            operation = operation.operation,
            logicalname = operation.logicalname,
            attributes = operation.attributes
        };

        try
        {
            await _targetClient.PostAsync("msdyn_PssCreateV1", payload, cancellationToken)
                .ConfigureAwait(false);
            _logger.Verbose("Added operation to OperationSet {OperationSetId}: {EntityLogicalName}",
                operationSetId, operation.logicalname);
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Failed to add operation to OperationSet {OperationSetId}", operationSetId);
            throw;
        }
    }

    /// <summary>
    /// Executes an OperationSet.
    /// </summary>
    private async Task ExecuteOperationSetAsync(
        Guid operationSetId,
        CancellationToken cancellationToken = default)
    {
        var payload = new { operationsetid = operationSetId };

        try
        {
            await _targetClient.PostAsyncString("msdyn_ExecuteOperationSetV1", payload, cancellationToken)
                .ConfigureAwait(false);
            _logger.Debug("Executed OperationSet {OperationSetId}", operationSetId);
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Failed to execute OperationSet {OperationSetId}", operationSetId);
            throw;
        }
    }

    /// <summary>
    /// Polls an OperationSet for completion.
    /// </summary>
    private async Task PollOperationSetCompletionAsync(
        Guid operationSetId,
        CancellationToken cancellationToken = default)
    {
        var maxAttempts = _migrationConfig.PollingMaxAttemptsPerOperationSet;
        var pollInterval = TimeSpan.FromSeconds(_migrationConfig.PollingIntervalSeconds);
        int attempts = 0;

        while (attempts < maxAttempts)
        {
            attempts++;

            try
            {
                var response = await _targetClient.GetAsync(
                    $"msdyn_operationsets({operationSetId})?$select=statuscode",
                    cancellationToken).ConfigureAwait(false);

                var statusCode = response["statuscode"]?.Value<int>();

                // 1 = Pending, 2 = Completed, 3 = Failed
                if (statusCode == 1)
                {
                    _logger.Verbose("OperationSet {OperationSetId} still pending (attempt {Attempt}/{MaxAttempts})",
                        operationSetId, attempts, maxAttempts);
                    await Task.Delay(pollInterval, cancellationToken).ConfigureAwait(false);
                }
                else if (statusCode == 2)
                {
                    _logger.Information("OperationSet {OperationSetId} completed successfully", operationSetId);
                    return;
                }
                else if (statusCode == 3)
                {
                    throw new InvalidOperationException($"OperationSet {operationSetId} failed");
                }
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Error polling OperationSet {OperationSetId}", operationSetId);
                throw;
            }
        }

        throw new TimeoutException(
            $"OperationSet {operationSetId} did not complete within {maxAttempts * _migrationConfig.PollingIntervalSeconds} seconds");
    }

    /// <summary>
    /// Creates an operation for a task.
    /// </summary>
    private OperationSetOperation CreateTaskOperation(TaskEntity task)
    {
        var attributes = new Dictionary<string, object>
        {
            { "msdyn_projecttaskid", Guid.NewGuid() },
            { "msdyn_subject", task.msdyn_subject },
            { "msdyn_description", task.msdyn_description },
            { "msdyn_project@odata.bind", $"/msdyn_projects({task.msdyn_project:D})" },
            { "msdyn_outlinelevel", task.msdyn_outlinelevel ?? 0 },
            { "msdyn_sequencenumber", task.msdyn_sequencenumber ?? 0 }
        };

        if (task.msdyn_parenttask.HasValue && task.msdyn_parenttask.Value != Guid.Empty)
        {
            var newParentId = _guidMappingService.GetNewGuid(task.msdyn_parenttask.Value);
            attributes["msdyn_parenttask@odata.bind"] = $"/msdyn_projecttasks({newParentId:D})";
        }

        if (task.msdyn_scheduledstart.HasValue)
            attributes["msdyn_scheduledstart"] = task.msdyn_scheduledstart.Value;

        if (task.msdyn_scheduledend.HasValue)
            attributes["msdyn_scheduledend"] = task.msdyn_scheduledend.Value;

        if (task.msdyn_duration.HasValue)
            attributes["msdyn_duration"] = task.msdyn_duration.Value;

        foreach (var customField in task.CustomFields)
            attributes[customField.Key] = customField.Value;

        return new OperationSetOperation
        {
            operation = "Create",
            logicalname = "msdyn_projecttask",
            attributes = attributes
        };
    }

    /// <summary>
    /// Creates an operation for a team member.
    /// </summary>
    private OperationSetOperation CreateTeamMemberOperation(TeamMemberEntity teamMember)
    {
        var attributes = new Dictionary<string, object>
        {
            { "msdyn_projectteamid", Guid.NewGuid() },
            { "msdyn_project@odata.bind", $"/msdyn_projects({teamMember.msdyn_project:D})" },
            { "msdyn_resourcename", teamMember.msdyn_resourcename }
        };

        if (teamMember.msdyn_resourcecategoryid.HasValue)
            attributes["msdyn_resourcecategory@odata.bind"] = $"/msdyn_resourcecategorys({teamMember.msdyn_resourcecategoryid:D})";

        if (teamMember.msdyn_resourceid.HasValue)
            attributes["msdyn_resource@odata.bind"] = $"/resources({teamMember.msdyn_resourceid:D})";

        if (teamMember.msdyn_resourcetype.HasValue)
            attributes["msdyn_resourcetype"] = teamMember.msdyn_resourcetype.Value;

        if (teamMember.msdyn_startdate.HasValue)
            attributes["msdyn_startdate"] = teamMember.msdyn_startdate.Value;

        if (teamMember.msdyn_enddate.HasValue)
            attributes["msdyn_enddate"] = teamMember.msdyn_enddate.Value;

        foreach (var customField in teamMember.CustomFields)
            attributes[customField.Key] = customField.Value;

        return new OperationSetOperation
        {
            operation = "Create",
            logicalname = "msdyn_projectteam",
            attributes = attributes
        };
    }

    /// <summary>
    /// Creates an operation for a bucket.
    /// </summary>
    private OperationSetOperation CreateBucketOperation(BucketEntity bucket)
    {
        return new OperationSetOperation
        {
            operation = "Create",
            logicalname = "msdyn_projectbucket",
            attributes = new Dictionary<string, object>
            {
                { "msdyn_projectbucketid", Guid.NewGuid() },
                { "msdyn_project@odata.bind", $"/msdyn_projects({bucket.msdyn_project:D})" },
                { "msdyn_name", bucket.msdyn_name },
                { "msdyn_sequence", bucket.msdyn_sequence ?? 0 }
            }
        };
    }

    /// <summary>
    /// Creates an operation for a dependency.
    /// </summary>
    private OperationSetOperation CreateDependencyOperation(
        DependencyEntity dependency,
        Guid predTaskId,
        Guid succTaskId)
    {
        return new OperationSetOperation
        {
            operation = "Create",
            logicalname = "msdyn_projecttaskdependency",
            attributes = new Dictionary<string, object>
            {
                { "msdyn_projecttaskdependencyid", Guid.NewGuid() },
                { "msdyn_predecessortask@odata.bind", $"/msdyn_projecttasks({predTaskId:D})" },
                { "msdyn_successortask@odata.bind", $"/msdyn_projecttasks({succTaskId:D})" },
                { "msdyn_dependencytype", dependency.msdyn_dependencytype ?? 0 },
                { "msdyn_lagtime", dependency.msdyn_lagtime ?? 0.0 }
            }
        };
    }

    /// <summary>
    /// Creates an operation for an assignment.
    /// </summary>
    private OperationSetOperation CreateAssignmentOperation(
        AssignmentEntity assignment,
        Guid taskId,
        Guid resourceId)
    {
        var attributes = new Dictionary<string, object>
        {
            { "msdyn_resourceassignmentid", Guid.NewGuid() },
            { "msdyn_projecttask@odata.bind", $"/msdyn_projecttasks({taskId:D})" },
            { "msdyn_resource@odata.bind", $"/resources({resourceId:D})" },
            { "msdyn_assignmentunits", assignment.msdyn_assignmentunits ?? 0.0 }
        };

        if (assignment.msdyn_assignmentstart.HasValue)
            attributes["msdyn_assignmentstart"] = assignment.msdyn_assignmentstart.Value;

        if (assignment.msdyn_assignmentend.HasValue)
            attributes["msdyn_assignmentend"] = assignment.msdyn_assignmentend.Value;

        foreach (var customField in assignment.CustomFields)
            attributes[customField.Key] = customField.Value;

        return new OperationSetOperation
        {
            operation = "Create",
            logicalname = "msdyn_resourceassignment",
            attributes = attributes
        };
    }

    /// <summary>
    /// Sorts tasks by hierarchy (outline level and sequence).
    /// </summary>
    private List<TaskEntity> SortTasksByHierarchy(List<TaskEntity> tasks)
    {
        return tasks
            .OrderBy(t => t.msdyn_outlinelevel ?? 0)
            .ThenBy(t => t.msdyn_sequencenumber ?? 0)
            .ToList();
    }

    /// <summary>
    /// Splits operations into batches based on batch size.
    /// </summary>
    private List<List<OperationSetOperation>> SplitIntoBatches(
        List<OperationSetOperation> operations,
        int batchSize)
    {
        return operations
            .Select((item, index) => new { item, index })
            .GroupBy(x => x.index / batchSize)
            .Select(g => g.Select(x => x.item).ToList())
            .ToList();
    }
}
