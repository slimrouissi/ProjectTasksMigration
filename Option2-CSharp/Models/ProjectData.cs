namespace ProjectMigration.Models;

/// <summary>
/// Represents a complete project export with all related entities.
/// </summary>
public class ProjectExport
{
    public ProjectEntity Project { get; set; } = new();
    public List<TaskEntity> Tasks { get; set; } = new();
    public List<TeamMemberEntity> TeamMembers { get; set; } = new();
    public List<DependencyEntity> Dependencies { get; set; } = new();
    public List<AssignmentEntity> Assignments { get; set; } = new();
    public List<BucketEntity> Buckets { get; set; } = new();
}

/// <summary>
/// Represents a Dynamics 365 Project entity.
/// </summary>
public class ProjectEntity
{
    public Guid msdyn_projectid { get; set; }
    public string msdyn_projectname { get; set; } = string.Empty;
    public string msdyn_description { get; set; } = string.Empty;
    public int? statecode { get; set; }
    public int? statuscode { get; set; }
    public Guid? msdyn_contractlineid { get; set; }
    public Dictionary<string, object> CustomFields { get; set; } = new();
}

/// <summary>
/// Represents a Project Task entity.
/// </summary>
public class TaskEntity
{
    public Guid msdyn_projecttaskid { get; set; }
    public string msdyn_subject { get; set; } = string.Empty;
    public string msdyn_description { get; set; } = string.Empty;
    public Guid msdyn_project { get; set; }
    public Guid? msdyn_parenttask { get; set; }
    public int? msdyn_outlinelevel { get; set; }
    public int? msdyn_sequencenumber { get; set; }
    public DateTime? msdyn_scheduledstart { get; set; }
    public DateTime? msdyn_scheduledend { get; set; }
    public double? msdyn_duration { get; set; }
    public int? statecode { get; set; }
    public int? statuscode { get; set; }
    public Dictionary<string, object> CustomFields { get; set; } = new();
}

/// <summary>
/// Represents a Project Team Member assignment.
/// </summary>
public class TeamMemberEntity
{
    public Guid msdyn_projectteamid { get; set; }
    public Guid msdyn_project { get; set; }
    public Guid? msdyn_resourcecategoryid { get; set; }
    public Guid? msdyn_resourceid { get; set; }
    public string msdyn_resourcename { get; set; } = string.Empty;
    public int? msdyn_resourcetype { get; set; }
    public DateTime? msdyn_startdate { get; set; }
    public DateTime? msdyn_enddate { get; set; }
    public Dictionary<string, object> CustomFields { get; set; } = new();
}

/// <summary>
/// Represents a Task Dependency.
/// </summary>
public class DependencyEntity
{
    public Guid msdyn_projecttaskdependencyid { get; set; }
    public Guid msdyn_predecessortask { get; set; }
    public Guid msdyn_successortask { get; set; }
    public int? msdyn_dependencytype { get; set; }
    public double? msdyn_lagtime { get; set; }
}

/// <summary>
/// Represents a Resource Assignment to a task.
/// </summary>
public class AssignmentEntity
{
    public Guid msdyn_resourceassignmentid { get; set; }
    public Guid msdyn_projecttask { get; set; }
    public Guid msdyn_resource { get; set; }
    public double? msdyn_assignmentunits { get; set; }
    public DateTime? msdyn_assignmentstart { get; set; }
    public DateTime? msdyn_assignmentend { get; set; }
    public Dictionary<string, object> CustomFields { get; set; } = new();
}

/// <summary>
/// Represents a Project Bucket.
/// </summary>
public class BucketEntity
{
    public Guid msdyn_projectbucketid { get; set; }
    public Guid msdyn_project { get; set; }
    public string msdyn_name { get; set; } = string.Empty;
    public int? msdyn_sequence { get; set; }
}

/// <summary>
/// Represents a response from creating an OperationSet.
/// </summary>
public class OperationSetResponse
{
    public Guid operationsetid { get; set; }
}

/// <summary>
/// Represents a response from executing an OperationSet.
/// </summary>
public class ExecuteOperationSetResponse
{
    public Guid operationSetId { get; set; }
}

/// <summary>
/// Represents the result of migrating a single project.
/// </summary>
public class MigrationResult
{
    public Guid SourceProjectId { get; set; }
    public Guid? TargetProjectId { get; set; }
    public string ProjectName { get; set; } = string.Empty;
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public int TasksCreated { get; set; }
    public int TeamMembersCreated { get; set; }
    public int DependenciesCreated { get; set; }
    public int AssignmentsCreated { get; set; }
    public DateTime StartTime { get; set; }
    public DateTime EndTime { get; set; }

    public TimeSpan Duration => EndTime - StartTime;
}

/// <summary>
/// Represents a summary of all migrations.
/// </summary>
public class MigrationSummary
{
    public int TotalProjects { get; set; }
    public int SuccessfulProjects { get; set; }
    public int FailedProjects { get; set; }
    public int TotalTasks { get; set; }
    public int TotalTeamMembers { get; set; }
    public int TotalDependencies { get; set; }
    public int TotalAssignments { get; set; }
    public List<MigrationResult> ProjectResults { get; set; } = new();
    public DateTime StartTime { get; set; }
    public DateTime EndTime { get; set; }

    public TimeSpan Duration => EndTime - StartTime;
    public double SuccessPercentage => TotalProjects > 0 ? (SuccessfulProjects / (double)TotalProjects) * 100 : 0;
}

/// <summary>
/// Represents an operation to be executed within an OperationSet.
/// </summary>
public class OperationSetOperation
{
    public string operation { get; set; } = "Create";
    public string logicalname { get; set; } = string.Empty;
    public Guid? stateid { get; set; }
    public Guid? statusid { get; set; }
    public Dictionary<string, object> attributes { get; set; } = new();
}

/// <summary>
/// Configuration for a custom field mapping.
/// </summary>
public class CustomFieldMapping
{
    public string SourceFieldLogicalName { get; set; } = string.Empty;
    public string TargetFieldLogicalName { get; set; } = string.Empty;
    public string FieldType { get; set; } = string.Empty;
    public Dictionary<string, string> ValueMappings { get; set; } = new();
    public string Description { get; set; } = string.Empty;
}

/// <summary>
/// Configuration for environment connection.
/// </summary>
public class EnvironmentConfig
{
    public string Url { get; set; } = string.Empty;
    public string TenantId { get; set; } = string.Empty;
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
}

/// <summary>
/// Configuration for migration settings.
/// </summary>
public class MigrationConfig
{
    public int BatchSize { get; set; } = 200;
    public int PollingIntervalSeconds { get; set; } = 5;
    public int PollingMaxAttemptsPerOperationSet { get; set; } = 120;
    public string ExportPath { get; set; } = "./exported_data";
    public string LogPath { get; set; } = "./logs";
    public bool ContinueOnProjectError { get; set; } = true;
    public bool PreserveProjectCustomFields { get; set; } = true;
    public bool PreserveTaskCustomFields { get; set; } = true;
    public bool PreserveTeamMemberCustomFields { get; set; } = true;
}

/// <summary>
/// Configuration for retry policy.
/// </summary>
public class RetryPolicyConfig
{
    public int MaxRetries { get; set; } = 3;
    public int BaseDelaySeconds { get; set; } = 1;
    public int MaxDelaySeconds { get; set; } = 30;
    public double BackoffMultiplier { get; set; } = 2.0;
}

/// <summary>
/// Root application configuration.
/// </summary>
public class AppConfiguration
{
    public EnvironmentConfig SourceEnvironment { get; set; } = new();
    public EnvironmentConfig TargetEnvironment { get; set; } = new();
    public MigrationConfig Migration { get; set; } = new();
    public RetryPolicyConfig RetryPolicy { get; set; } = new();
    public List<CustomFieldMapping> CustomFieldMappings { get; set; } = new();
    public LoggingConfig Logging { get; set; } = new();
}

/// <summary>
/// Configuration for logging.
/// </summary>
public class LoggingConfig
{
    public string LogLevel { get; set; } = "Information";
    public bool IncludeTimestamps { get; set; } = true;
    public bool IncludeThreadInfo { get; set; } = false;
    public string OutputTemplate { get; set; } = "{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level:u3}] {Message:lj}{NewLine}{Exception}";
}
