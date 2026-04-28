using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Serilog;

namespace ProjectMigration.Services;

/// <summary>
/// Exports projects and related entities from the source Dynamics 365 environment.
/// Handles pagination, custom fields, and hierarchical relationships.
/// </summary>
public class ExportService
{
    private readonly DataverseClient _sourceClient;
    private readonly CustomFieldMapper _customFieldMapper;
    private readonly ILogger _logger;
    private readonly string _exportPath;

    public ExportService(
        DataverseClient sourceClient,
        CustomFieldMapper customFieldMapper,
        string exportPath,
        ILogger logger)
    {
        _sourceClient = sourceClient;
        _customFieldMapper = customFieldMapper;
        _exportPath = exportPath;
        _logger = logger;

        if (!Directory.Exists(_exportPath))
        {
            Directory.CreateDirectory(_exportPath);
        }
    }

    /// <summary>
    /// Exports all projects or a filtered set of projects.
    /// </summary>
    public async Task<List<ProjectExport>> ExportProjectsAsync(
        string? projectFilter = null,
        IProgress<string>? progress = null,
        CancellationToken cancellationToken = default)
    {
        _logger.Information("Starting project export");
        var exports = new List<ProjectExport>();

        try
        {
            // Query for projects
            string fetchXml = string.IsNullOrEmpty(projectFilter)
                ? GetProjectsFetchXml()
                : GetProjectsFetchXml(projectFilter);

            var projects = await _sourceClient.QueryAsync("msdyn_projects", fetchXml, 5000, cancellationToken)
                .ConfigureAwait(false);

            _logger.Information("Found {ProjectCount} projects to export", projects.Count);

            for (int i = 0; i < projects.Count; i++)
            {
                var projectRecord = projects[i];
                var projectId = projectRecord["msdyn_projectid"]?.Value<Guid>() ?? Guid.Empty;
                var projectName = projectRecord["msdyn_projectname"]?.Value<string>() ?? "Unknown";

                progress?.Report($"Exporting project {i + 1}/{projects.Count}: {projectName}");
                _logger.Information("Exporting project {ProjectId}: {ProjectName}", projectId, projectName);

                try
                {
                    var export = await ExportProjectAsync(projectId, projectRecord, cancellationToken)
                        .ConfigureAwait(false);
                    exports.Add(export);

                    // Save individual project export
                    await SaveProjectExportAsync(export, cancellationToken).ConfigureAwait(false);

                    _logger.Information(
                        "Successfully exported project {ProjectName}: {TaskCount} tasks, {TeamCount} team members, {DependencyCount} dependencies, {AssignmentCount} assignments",
                        projectName, export.Tasks.Count, export.TeamMembers.Count,
                        export.Dependencies.Count, export.Assignments.Count);
                }
                catch (Exception ex)
                {
                    _logger.Error(ex, "Failed to export project {ProjectId}: {ProjectName}", projectId, projectName);
                }
            }

            _logger.Information("Project export complete: {SuccessCount}/{TotalCount} projects",
                exports.Count, projects.Count);

            return exports;
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Project export failed");
            throw;
        }
    }

    /// <summary>
    /// Exports a single project with all its related entities.
    /// </summary>
    private async Task<ProjectExport> ExportProjectAsync(
        Guid projectId,
        JObject projectRecord,
        CancellationToken cancellationToken = default)
    {
        var export = new ProjectExport();

        // Map project entity
        export.Project = MapProjectEntity(projectRecord);

        // Export related entities in parallel for performance
        var tasksTasks = ExportTasksAsync(projectId, cancellationToken);
        var teamTasks = ExportTeamMembersAsync(projectId, cancellationToken);
        var bucketsTasks = ExportBucketsAsync(projectId, cancellationToken);

        await Task.WhenAll(tasksTasks, teamTasks, bucketsTasks).ConfigureAwait(false);

        export.Tasks = await tasksTasks.ConfigureAwait(false);
        export.TeamMembers = await teamTasks.ConfigureAwait(false);
        export.Buckets = await bucketsTasks.ConfigureAwait(false);

        // Export dependencies (requires tasks to be loaded first)
        export.Dependencies = await ExportDependenciesAsync(projectId, export.Tasks, cancellationToken)
            .ConfigureAwait(false);

        // Export assignments
        export.Assignments = await ExportAssignmentsAsync(projectId, export.Tasks, cancellationToken)
            .ConfigureAwait(false);

        return export;
    }

    /// <summary>
    /// Exports all tasks for a project.
    /// </summary>
    private async Task<List<TaskEntity>> ExportTasksAsync(
        Guid projectId,
        CancellationToken cancellationToken = default)
    {
        var tasks = new List<TaskEntity>();

        var fetchXml = $@"
            <fetch version='1.0' output-format='xml-platform' mapping='logical' distinct='false'>
              <entity name='msdyn_projecttask'>
                <attribute name='*' />
                <filter type='and'>
                  <condition attribute='msdyn_project' operator='eq' value='{projectId}' />
                </filter>
                <order attribute='msdyn_outlinelevel' descending='false' />
                <order attribute='msdyn_sequencenumber' descending='false' />
              </entity>
            </fetch>";

        var records = await _sourceClient.QueryAsync("msdyn_projecttasks", fetchXml, 5000, cancellationToken)
            .ConfigureAwait(false);

        foreach (var record in records)
        {
            tasks.Add(MapTaskEntity(record));
        }

        _logger.Debug("Exported {TaskCount} tasks for project {ProjectId}", tasks.Count, projectId);
        return tasks;
    }

    /// <summary>
    /// Exports all team members for a project.
    /// </summary>
    private async Task<List<TeamMemberEntity>> ExportTeamMembersAsync(
        Guid projectId,
        CancellationToken cancellationToken = default)
    {
        var teamMembers = new List<TeamMemberEntity>();

        var fetchXml = $@"
            <fetch version='1.0' output-format='xml-platform' mapping='logical' distinct='false'>
              <entity name='msdyn_projectteam'>
                <attribute name='*' />
                <filter type='and'>
                  <condition attribute='msdyn_project' operator='eq' value='{projectId}' />
                </filter>
              </entity>
            </fetch>";

        var records = await _sourceClient.QueryAsync("msdyn_projectteams", fetchXml, 5000, cancellationToken)
            .ConfigureAwait(false);

        foreach (var record in records)
        {
            teamMembers.Add(MapTeamMemberEntity(record));
        }

        _logger.Debug("Exported {TeamMemberCount} team members for project {ProjectId}", teamMembers.Count, projectId);
        return teamMembers;
    }

    /// <summary>
    /// Exports all task dependencies for a project.
    /// </summary>
    private async Task<List<DependencyEntity>> ExportDependenciesAsync(
        Guid projectId,
        List<TaskEntity> tasks,
        CancellationToken cancellationToken = default)
    {
        var dependencies = new List<DependencyEntity>();

        if (tasks.Count == 0)
            return dependencies;

        var taskIds = string.Join("' or '", tasks.Select(t => t.msdyn_projecttaskid));

        var fetchXml = $@"
            <fetch version='1.0' output-format='xml-platform' mapping='logical' distinct='false'>
              <entity name='msdyn_projecttaskdependency'>
                <attribute name='*' />
                <filter type='and'>
                  <condition attribute='msdyn_predecessortask' operator='in'>
                    <value>'{taskIds}'</value>
                  </condition>
                </filter>
              </entity>
            </fetch>";

        var records = await _sourceClient.QueryAsync("msdyn_projecttaskdependencies", fetchXml, 5000, cancellationToken)
            .ConfigureAwait(false);

        foreach (var record in records)
        {
            dependencies.Add(MapDependencyEntity(record));
        }

        _logger.Debug("Exported {DependencyCount} task dependencies for project {ProjectId}",
            dependencies.Count, projectId);
        return dependencies;
    }

    /// <summary>
    /// Exports all resource assignments for a project.
    /// </summary>
    private async Task<List<AssignmentEntity>> ExportAssignmentsAsync(
        Guid projectId,
        List<TaskEntity> tasks,
        CancellationToken cancellationToken = default)
    {
        var assignments = new List<AssignmentEntity>();

        if (tasks.Count == 0)
            return assignments;

        var taskIds = string.Join("' or '", tasks.Select(t => t.msdyn_projecttaskid));

        var fetchXml = $@"
            <fetch version='1.0' output-format='xml-platform' mapping='logical' distinct='false'>
              <entity name='msdyn_resourceassignment'>
                <attribute name='*' />
                <filter type='and'>
                  <condition attribute='msdyn_projecttask' operator='in'>
                    <value>'{taskIds}'</value>
                  </condition>
                </filter>
              </entity>
            </fetch>";

        var records = await _sourceClient.QueryAsync("msdyn_resourceassignments", fetchXml, 5000, cancellationToken)
            .ConfigureAwait(false);

        foreach (var record in records)
        {
            assignments.Add(MapAssignmentEntity(record));
        }

        _logger.Debug("Exported {AssignmentCount} resource assignments for project {ProjectId}",
            assignments.Count, projectId);
        return assignments;
    }

    /// <summary>
    /// Exports all buckets for a project.
    /// </summary>
    private async Task<List<BucketEntity>> ExportBucketsAsync(
        Guid projectId,
        CancellationToken cancellationToken = default)
    {
        var buckets = new List<BucketEntity>();

        var fetchXml = $@"
            <fetch version='1.0' output-format='xml-platform' mapping='logical' distinct='false'>
              <entity name='msdyn_projectbucket'>
                <attribute name='*' />
                <filter type='and'>
                  <condition attribute='msdyn_project' operator='eq' value='{projectId}' />
                </filter>
              </entity>
            </fetch>";

        var records = await _sourceClient.QueryAsync("msdyn_projectbuckets", fetchXml, 5000, cancellationToken)
            .ConfigureAwait(false);

        foreach (var record in records)
        {
            buckets.Add(MapBucketEntity(record));
        }

        _logger.Debug("Exported {BucketCount} buckets for project {ProjectId}", buckets.Count, projectId);
        return buckets;
    }

    /// <summary>
    /// Maps a JObject to a ProjectEntity.
    /// </summary>
    private ProjectEntity MapProjectEntity(JObject record)
    {
        var entity = new ProjectEntity
        {
            msdyn_projectid = record["msdyn_projectid"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_projectname = record["msdyn_projectname"]?.Value<string>() ?? string.Empty,
            msdyn_description = record["msdyn_description"]?.Value<string>() ?? string.Empty,
            statecode = record["statecode"]?.Value<int>(),
            statuscode = record["statuscode"]?.Value<int>(),
            msdyn_contractlineid = record["_msdyn_contractline_value"]?.Value<Guid>(),
            CustomFields = _customFieldMapper.MapCustomFields(record, "Project")
        };

        return entity;
    }

    /// <summary>
    /// Maps a JObject to a TaskEntity.
    /// </summary>
    private TaskEntity MapTaskEntity(JObject record)
    {
        var entity = new TaskEntity
        {
            msdyn_projecttaskid = record["msdyn_projecttaskid"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_subject = record["msdyn_subject"]?.Value<string>() ?? string.Empty,
            msdyn_description = record["msdyn_description"]?.Value<string>() ?? string.Empty,
            msdyn_project = record["_msdyn_project_value"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_parenttask = record["_msdyn_parenttask_value"]?.Value<Guid>(),
            msdyn_outlinelevel = record["msdyn_outlinelevel"]?.Value<int>(),
            msdyn_sequencenumber = record["msdyn_sequencenumber"]?.Value<int>(),
            msdyn_scheduledstart = record["msdyn_scheduledstart"]?.Value<DateTime>(),
            msdyn_scheduledend = record["msdyn_scheduledend"]?.Value<DateTime>(),
            msdyn_duration = record["msdyn_duration"]?.Value<double>(),
            statecode = record["statecode"]?.Value<int>(),
            statuscode = record["statuscode"]?.Value<int>(),
            CustomFields = _customFieldMapper.MapCustomFields(record, "Task")
        };

        return entity;
    }

    /// <summary>
    /// Maps a JObject to a TeamMemberEntity.
    /// </summary>
    private TeamMemberEntity MapTeamMemberEntity(JObject record)
    {
        var entity = new TeamMemberEntity
        {
            msdyn_projectteamid = record["msdyn_projectteamid"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_project = record["_msdyn_project_value"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_resourcecategoryid = record["_msdyn_resourcecategory_value"]?.Value<Guid>(),
            msdyn_resourceid = record["_msdyn_resource_value"]?.Value<Guid>(),
            msdyn_resourcename = record["msdyn_resourcename"]?.Value<string>() ?? string.Empty,
            msdyn_resourcetype = record["msdyn_resourcetype"]?.Value<int>(),
            msdyn_startdate = record["msdyn_startdate"]?.Value<DateTime>(),
            msdyn_enddate = record["msdyn_enddate"]?.Value<DateTime>(),
            CustomFields = _customFieldMapper.MapCustomFields(record, "TeamMember")
        };

        return entity;
    }

    /// <summary>
    /// Maps a JObject to a DependencyEntity.
    /// </summary>
    private DependencyEntity MapDependencyEntity(JObject record)
    {
        return new DependencyEntity
        {
            msdyn_projecttaskdependencyid = record["msdyn_projecttaskdependencyid"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_predecessortask = record["_msdyn_predecessortask_value"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_successortask = record["_msdyn_successortask_value"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_dependencytype = record["msdyn_dependencytype"]?.Value<int>(),
            msdyn_lagtime = record["msdyn_lagtime"]?.Value<double>()
        };
    }

    /// <summary>
    /// Maps a JObject to an AssignmentEntity.
    /// </summary>
    private AssignmentEntity MapAssignmentEntity(JObject record)
    {
        return new AssignmentEntity
        {
            msdyn_resourceassignmentid = record["msdyn_resourceassignmentid"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_projecttask = record["_msdyn_projecttask_value"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_resource = record["_msdyn_resource_value"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_assignmentunits = record["msdyn_assignmentunits"]?.Value<double>(),
            msdyn_assignmentstart = record["msdyn_assignmentstart"]?.Value<DateTime>(),
            msdyn_assignmentend = record["msdyn_assignmentend"]?.Value<DateTime>(),
            CustomFields = _customFieldMapper.MapCustomFields(record, "Assignment")
        };
    }

    /// <summary>
    /// Maps a JObject to a BucketEntity.
    /// </summary>
    private BucketEntity MapBucketEntity(JObject record)
    {
        return new BucketEntity
        {
            msdyn_projectbucketid = record["msdyn_projectbucketid"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_project = record["_msdyn_project_value"]?.Value<Guid>() ?? Guid.Empty,
            msdyn_name = record["msdyn_name"]?.Value<string>() ?? string.Empty,
            msdyn_sequence = record["msdyn_sequence"]?.Value<int>()
        };
    }

    /// <summary>
    /// Saves an individual project export to a JSON file.
    /// </summary>
    private async Task SaveProjectExportAsync(ProjectExport export, CancellationToken cancellationToken = default)
    {
        var fileName = Path.Combine(_exportPath, $"{export.Project.msdyn_projectid}_export.json");
        var json = JsonConvert.SerializeObject(export, Formatting.Indented);
        await File.WriteAllTextAsync(fileName, json, cancellationToken).ConfigureAwait(false);
        _logger.Debug("Saved project export to {FileName}", fileName);
    }

    /// <summary>
    /// Gets the FetchXml query for projects.
    /// </summary>
    private static string GetProjectsFetchXml(string? filter = null)
    {
        var filterXml = string.IsNullOrEmpty(filter)
            ? string.Empty
            : $"<condition attribute='msdyn_projectname' operator='like' value='%{filter}%' />";

        return $@"
            <fetch version='1.0' output-format='xml-platform' mapping='logical' distinct='false'>
              <entity name='msdyn_project'>
                <attribute name='*' />
                <filter type='and'>
                  {filterXml}
                </filter>
              </entity>
            </fetch>";
    }
}
