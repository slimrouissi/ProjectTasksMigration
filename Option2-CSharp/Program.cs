using System.CommandLine;
using System.CommandLine.Invocation;
using Newtonsoft.Json;
using Serilog;
using Serilog.Events;

namespace ProjectMigration;

/// <summary>
/// Main entry point for the Project Operations Migration Tool.
/// Provides CLI commands for export, import, and full migration.
/// </summary>
internal class Program
{
    private static AppConfiguration? _config;

    static async Task<int> Main(string[] args)
    {
        try
        {
            // Parse configuration
            var configPath = FindConfigFile(args);
            _config = LoadConfiguration(configPath);

            // Configure Serilog
            ConfigureLogging(_config.Logging);

            Log.Information("Project Migration Tool started");

            // Build command structure
            var rootCommand = new RootCommand("Dynamics 365 Project Operations Migration Tool");

            // Global options
            var configOption = new Option<string>(
                new[] { "--config", "-c" },
                () => "appsettings.json",
                "Path to configuration file");

            var projectFilterOption = new Option<string?>(
                new[] { "--project-filter", "-p" },
                "Filter projects by name (partial match)");

            var dryRunOption = new Option<bool>(
                new[] { "--dry-run" },
                "Perform validation without making changes");

            var resumeOption = new Option<bool>(
                new[] { "--resume" },
                "Resume migration from last checkpoint");

            rootCommand.AddGlobalOption(configOption);
            rootCommand.AddGlobalOption(projectFilterOption);
            rootCommand.AddGlobalOption(dryRunOption);
            rootCommand.AddGlobalOption(resumeOption);

            // Export command
            var exportCommand = new Command("export", "Export projects from source environment")
            {
                configOption,
                projectFilterOption
            };
            exportCommand.SetHandler(HandleExportCommand);
            rootCommand.AddCommand(exportCommand);

            // Import command
            var importCommand = new Command("import", "Import projects to target environment")
            {
                configOption,
                dryRunOption,
                resumeOption
            };
            importCommand.SetHandler(HandleImportCommand);
            rootCommand.AddCommand(importCommand);

            // Migrate command (full export + import)
            var migrateCommand = new Command("migrate", "Export from source and import to target")
            {
                configOption,
                projectFilterOption,
                dryRunOption,
                resumeOption
            };
            migrateCommand.SetHandler(HandleMigrateCommand);
            rootCommand.AddCommand(migrateCommand);

            // Validate command
            var validateCommand = new Command("validate", "Validate configuration and connectivity")
            {
                configOption
            };
            validateCommand.SetHandler(HandleValidateCommand);
            rootCommand.AddCommand(validateCommand);

            // Parse and invoke
            return await rootCommand.InvokeAsync(args);
        }
        catch (Exception ex)
        {
            Log.Fatal(ex, "Application terminated with error");
            return 1;
        }
    }

    /// <summary>
    /// Handles the export command.
    /// </summary>
    private static async Task<int> HandleExportCommand(
        InvocationContext context)
    {
        try
        {
            var config = _config ?? throw new InvalidOperationException("Configuration not loaded");
            var projectFilter = context.ParseResult.GetValueForOption<string?>(
                new Option<string?>(new[] { "--project-filter", "-p" }));

            using var sourceClient = new DataverseClient(
                config.SourceEnvironment.Url,
                config.SourceEnvironment.TenantId,
                config.SourceEnvironment.ClientId,
                config.SourceEnvironment.ClientSecret,
                config.RetryPolicy,
                Log.Logger);

            var customFieldMapper = new CustomFieldMapper(
                config.CustomFieldMappings,
                new GuidMappingService(config.Migration.ExportPath, Log.Logger),
                Log.Logger);

            var exportService = new ExportService(
                sourceClient,
                customFieldMapper,
                config.Migration.ExportPath,
                Log.Logger);

            var progress = new Progress<string>(msg => Log.Information(msg));
            var exports = await exportService.ExportProjectsAsync(projectFilter, progress)
                .ConfigureAwait(false);

            Log.Information("Export completed: {ProjectCount} projects exported", exports.Count);
            return 0;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Export failed");
            return 1;
        }
    }

    /// <summary>
    /// Handles the import command.
    /// </summary>
    private static async Task<int> HandleImportCommand(
        InvocationContext context)
    {
        try
        {
            var config = _config ?? throw new InvalidOperationException("Configuration not loaded");
            var dryRun = context.ParseResult.GetValueForOption<bool>(
                new Option<bool>(new[] { "--dry-run" }));
            var resume = context.ParseResult.GetValueForOption<bool>(
                new Option<bool>(new[] { "--resume" }));

            if (dryRun)
            {
                Log.Information("Running in DRY RUN mode - no changes will be made");
            }

            using var targetClient = new DataverseClient(
                config.TargetEnvironment.Url,
                config.TargetEnvironment.TenantId,
                config.TargetEnvironment.ClientId,
                config.TargetEnvironment.ClientSecret,
                config.RetryPolicy,
                Log.Logger);

            var guidMappingService = new GuidMappingService(config.Migration.ExportPath, Log.Logger);

            if (resume)
            {
                Log.Information("Resuming migration from saved GUID mappings");
            }
            else
            {
                guidMappingService.Clear();
            }

            var importService = new ImportService(
                targetClient,
                guidMappingService,
                config.Migration,
                Log.Logger);

            var summary = await ImportProjectsFromFilesAsync(importService, config, guidMappingService, dryRun)
                .ConfigureAwait(false);

            LogMigrationSummary(summary);
            await guidMappingService.SaveMappingsAsync().ConfigureAwait(false);

            return summary.FailedProjects == 0 ? 0 : 1;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Import failed");
            return 1;
        }
    }

    /// <summary>
    /// Handles the migrate command (full export + import).
    /// </summary>
    private static async Task<int> HandleMigrateCommand(
        InvocationContext context)
    {
        try
        {
            var config = _config ?? throw new InvalidOperationException("Configuration not loaded");
            var projectFilter = context.ParseResult.GetValueForOption<string?>(
                new Option<string?>(new[] { "--project-filter", "-p" }));
            var dryRun = context.ParseResult.GetValueForOption<bool>(
                new Option<bool>(new[] { "--dry-run" }));
            var resume = context.ParseResult.GetValueForOption<bool>(
                new Option<bool>(new[] { "--resume" }));

            if (dryRun)
            {
                Log.Information("Running in DRY RUN mode - no changes will be made");
            }

            Log.Information("Starting full migration (export + import)");

            // Phase 1: Export
            using (var sourceClient = new DataverseClient(
                config.SourceEnvironment.Url,
                config.SourceEnvironment.TenantId,
                config.SourceEnvironment.ClientId,
                config.SourceEnvironment.ClientSecret,
                config.RetryPolicy,
                Log.Logger))
            {
                var customFieldMapper = new CustomFieldMapper(
                    config.CustomFieldMappings,
                    new GuidMappingService(config.Migration.ExportPath, Log.Logger),
                    Log.Logger);

                var exportService = new ExportService(
                    sourceClient,
                    customFieldMapper,
                    config.Migration.ExportPath,
                    Log.Logger);

                var progress = new Progress<string>(msg => Log.Information(msg));
                await exportService.ExportProjectsAsync(projectFilter, progress)
                    .ConfigureAwait(false);
            }

            // Phase 2: Import
            using (var targetClient = new DataverseClient(
                config.TargetEnvironment.Url,
                config.TargetEnvironment.TenantId,
                config.TargetEnvironment.ClientId,
                config.TargetEnvironment.ClientSecret,
                config.RetryPolicy,
                Log.Logger))
            {
                var guidMappingService = new GuidMappingService(config.Migration.ExportPath, Log.Logger);

                if (!resume)
                {
                    guidMappingService.Clear();
                }

                var importService = new ImportService(
                    targetClient,
                    guidMappingService,
                    config.Migration,
                    Log.Logger);

                var summary = await ImportProjectsFromFilesAsync(importService, config, guidMappingService, dryRun)
                    .ConfigureAwait(false);

                LogMigrationSummary(summary);
                await guidMappingService.SaveMappingsAsync().ConfigureAwait(false);

                return summary.FailedProjects == 0 ? 0 : 1;
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Migration failed");
            return 1;
        }
    }

    /// <summary>
    /// Handles the validate command.
    /// </summary>
    private static async Task<int> HandleValidateCommand(
        InvocationContext context)
    {
        try
        {
            var config = _config ?? throw new InvalidOperationException("Configuration not loaded");

            Log.Information("Validating configuration and environment connectivity");

            // Validate source environment
            Log.Information("Testing connection to source environment: {Url}", config.SourceEnvironment.Url);
            using (var sourceClient = new DataverseClient(
                config.SourceEnvironment.Url,
                config.SourceEnvironment.TenantId,
                config.SourceEnvironment.ClientId,
                config.SourceEnvironment.ClientSecret,
                config.RetryPolicy,
                Log.Logger))
            {
                try
                {
                    // Try a simple query to test connectivity
                    var result = await sourceClient.QueryAsync("msdyn_projects", null, 1)
                        .ConfigureAwait(false);
                    Log.Information("Source environment connection successful");
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "Failed to connect to source environment");
                    return 1;
                }
            }

            // Validate target environment
            Log.Information("Testing connection to target environment: {Url}", config.TargetEnvironment.Url);
            using (var targetClient = new DataverseClient(
                config.TargetEnvironment.Url,
                config.TargetEnvironment.TenantId,
                config.TargetEnvironment.ClientId,
                config.TargetEnvironment.ClientSecret,
                config.RetryPolicy,
                Log.Logger))
            {
                try
                {
                    var result = await targetClient.QueryAsync("msdyn_projects", null, 1)
                        .ConfigureAwait(false);
                    Log.Information("Target environment connection successful");
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "Failed to connect to target environment");
                    return 1;
                }
            }

            Log.Information("All validation checks passed");
            return 0;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Validation failed");
            return 1;
        }
    }

    /// <summary>
    /// Imports projects from exported JSON files.
    /// </summary>
    private static async Task<MigrationSummary> ImportProjectsFromFilesAsync(
        ImportService importService,
        AppConfiguration config,
        GuidMappingService guidMappingService,
        bool dryRun)
    {
        var summary = new MigrationSummary
        {
            StartTime = DateTime.UtcNow
        };

        var exportPath = config.Migration.ExportPath;
        var exportFiles = Directory.GetFiles(exportPath, "*_export.json");

        Log.Information("Found {FileCount} project export files to import", exportFiles.Length);
        summary.TotalProjects = exportFiles.Length;

        for (int i = 0; i < exportFiles.Length; i++)
        {
            try
            {
                var filePath = exportFiles[i];
                var json = await File.ReadAllTextAsync(filePath).ConfigureAwait(false);
                var export = JsonConvert.DeserializeObject<ProjectExport>(json)
                    ?? throw new InvalidOperationException("Failed to deserialize project export");

                var projectName = export.Project.msdyn_projectname;
                var progress = new Progress<string>(msg => Log.Information(msg));

                Log.Information("Importing project {ProjectNumber}/{TotalProjects}: {ProjectName}",
                    i + 1, exportFiles.Length, projectName);

                MigrationResult result;
                if (dryRun)
                {
                    result = new MigrationResult
                    {
                        SourceProjectId = export.Project.msdyn_projectid,
                        ProjectName = projectName,
                        Success = true,
                        TasksCreated = export.Tasks.Count,
                        TeamMembersCreated = export.TeamMembers.Count,
                        DependenciesCreated = export.Dependencies.Count,
                        AssignmentsCreated = export.Assignments.Count,
                        StartTime = DateTime.UtcNow,
                        EndTime = DateTime.UtcNow
                    };
                    Log.Information("DRY RUN: Would import {TaskCount} tasks, {TeamCount} team members, {DepCount} dependencies, {AssignCount} assignments",
                        result.TasksCreated, result.TeamMembersCreated, result.DependenciesCreated, result.AssignmentsCreated);
                }
                else
                {
                    result = await importService.ImportProjectAsync(export, progress)
                        .ConfigureAwait(false);
                }

                summary.ProjectResults.Add(result);

                if (result.Success)
                {
                    summary.SuccessfulProjects++;
                    summary.TotalTasks += result.TasksCreated;
                    summary.TotalTeamMembers += result.TeamMembersCreated;
                    summary.TotalDependencies += result.DependenciesCreated;
                    summary.TotalAssignments += result.AssignmentsCreated;
                }
                else
                {
                    summary.FailedProjects++;
                    Log.Error("Project import failed: {ErrorMessage}", result.ErrorMessage);

                    if (!config.Migration.ContinueOnProjectError)
                    {
                        throw new InvalidOperationException($"Project import failed: {result.ErrorMessage}");
                    }
                }
            }
            catch (Exception ex)
            {
                summary.FailedProjects++;
                Log.Error(ex, "Error importing project file {Index}", i);

                if (!config.Migration.ContinueOnProjectError)
                {
                    throw;
                }
            }
        }

        summary.EndTime = DateTime.UtcNow;
        return summary;
    }

    /// <summary>
    /// Logs migration summary to console and log file.
    /// </summary>
    private static void LogMigrationSummary(MigrationSummary summary)
    {
        Log.Information("");
        Log.Information("================== MIGRATION SUMMARY ==================");
        Log.Information("Total Duration: {Duration:hh\\:mm\\:ss}", summary.Duration);
        Log.Information("Total Projects: {TotalProjects}", summary.TotalProjects);
        Log.Information("Successful: {SuccessfulProjects} ({SuccessPercentage:F1}%)",
            summary.SuccessfulProjects, summary.SuccessPercentage);
        Log.Information("Failed: {FailedProjects}", summary.FailedProjects);
        Log.Information("");
        Log.Information("Entities Created:");
        Log.Information("  - Tasks: {TotalTasks}", summary.TotalTasks);
        Log.Information("  - Team Members: {TotalTeamMembers}", summary.TotalTeamMembers);
        Log.Information("  - Dependencies: {TotalDependencies}", summary.TotalDependencies);
        Log.Information("  - Assignments: {TotalAssignments}", summary.TotalAssignments);
        Log.Information("======================================================");
        Log.Information("");
    }

    /// <summary>
    /// Finds the configuration file path.
    /// </summary>
    private static string FindConfigFile(string[] args)
    {
        // Check for explicit config argument
        for (int i = 0; i < args.Length - 1; i++)
        {
            if ((args[i] == "--config" || args[i] == "-c") && i + 1 < args.Length)
            {
                return args[i + 1];
            }
        }

        // Default locations
        if (File.Exists("appsettings.json"))
            return "appsettings.json";

        if (File.Exists("appsettings.example.json"))
            return "appsettings.example.json";

        throw new FileNotFoundException("Configuration file not found. Please create appsettings.json");
    }

    /// <summary>
    /// Loads the configuration from a JSON file.
    /// </summary>
    private static AppConfiguration LoadConfiguration(string configPath)
    {
        if (!File.Exists(configPath))
            throw new FileNotFoundException($"Configuration file not found: {configPath}");

        var json = File.ReadAllText(configPath);
        var config = JsonConvert.DeserializeObject<AppConfiguration>(json)
            ?? throw new InvalidOperationException("Failed to deserialize configuration");

        Log.Information("Configuration loaded from {ConfigPath}", configPath);
        return config;
    }

    /// <summary>
    /// Configures Serilog for logging.
    /// </summary>
    private static void ConfigureLogging(LoggingConfig loggingConfig)
    {
        var logLevel = loggingConfig.LogLevel.ToLower() switch
        {
            "verbose" => LogEventLevel.Verbose,
            "debug" => LogEventLevel.Debug,
            "information" => LogEventLevel.Information,
            "warning" => LogEventLevel.Warning,
            "error" => LogEventLevel.Error,
            "fatal" => LogEventLevel.Fatal,
            _ => LogEventLevel.Information
        };

        var logPath = Path.Combine(loggingConfig.OutputTemplate, "migration_{Date:yyyy-MM-dd_HH-mm-ss}.log");
        var logDir = Path.GetDirectoryName(loggingConfig.OutputTemplate);
        if (!Directory.Exists(logDir))
            Directory.CreateDirectory(logDir ?? "./logs");

        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Is(logLevel)
            .WriteTo.Console(outputTemplate: loggingConfig.OutputTemplate)
            .WriteTo.File(
                logPath,
                outputTemplate: loggingConfig.OutputTemplate,
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 30)
            .CreateLogger();
    }
}
