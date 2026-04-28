<#
.SYNOPSIS
Orchestrates complete project migration from source to target environment.

.DESCRIPTION
Main entry point for the migration tool. Loads configuration, authenticates to both
environments, exports projects from source, and imports them to target.

Supports export-only and import-only modes for flexibility.

.PARAMETER ConfigPath
Path to config.json file

.PARAMETER ExportOnly
If specified, only exports projects without importing

.PARAMETER ImportOnly
If specified, only imports projects from previous export

.PARAMETER ExportPath
Path to export directory (required if ImportOnly is specified)

.PARAMETER ProjectFilter
Optional filter to migrate only specific projects by name

.EXAMPLE
./Migrate-AllProjects.ps1 -ConfigPath "./config.json"

.EXAMPLE
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ExportOnly

.EXAMPLE
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ImportOnly -ExportPath "./exports/export_2024-01-15_10-30-45"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path $_ })]
    [string]$ConfigPath,

    [Parameter(Mandatory = $false)]
    [switch]$ExportOnly,

    [Parameter(Mandatory = $false)]
    [switch]$ImportOnly,

    [Parameter(Mandatory = $false)]
    [string]$ExportPath,

    [Parameter(Mandatory = $false)]
    [string]$ProjectFilter
)

# Enable error handling
$ErrorActionPreference = "Continue"
$WarningPreference = "Continue"

Write-Host "Project Operations Migration Tool" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""

try {
    # Step 1: Load configuration
    Write-Host "Step 1: Loading configuration..." -ForegroundColor Gray
    $config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
    Write-Host "Configuration loaded from: $ConfigPath" -ForegroundColor Green

    # Override project filter if provided
    if ($ProjectFilter) {
        $config.migration.projectFilter = $ProjectFilter
        Write-Host "Project filter applied: $ProjectFilter" -ForegroundColor Yellow
    }

    # Create logging directory
    if (-not (Test-Path $config.logging.logPath)) {
        New-Item -ItemType Directory -Path $config.logging.logPath -Force | Out-Null
    }

    # Setup logging
    $logFile = Join-Path $config.logging.logPath "migration_$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss').log"
    Write-Host "Logging to: $logFile" -ForegroundColor Green

    # Step 2: Import required modules
    Write-Host "`nStep 2: Importing modules..." -ForegroundColor Gray

    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

    # Import authentication module
    . "$scriptDir/Connect-Environments.ps1"
    Write-Host "Imported Connect-Environments module" -ForegroundColor Green

    # Import export module
    . "$scriptDir/Export-Projects.ps1"
    Write-Host "Imported Export-Projects module" -ForegroundColor Green

    # Import import module
    . "$scriptDir/Import-Projects.ps1"
    Write-Host "Imported Import-Projects module" -ForegroundColor Green

    # Step 3: Authenticate to environments (unless ImportOnly)
    if (-not $ImportOnly) {
        Write-Host "`nStep 3: Authenticating to environments..." -ForegroundColor Gray

        $clients = Connect-Environments `
            -SourceConfig $config.sourceEnvironment `
            -TargetConfig $config.targetEnvironment

        Write-Host "Successfully authenticated to both environments" -ForegroundColor Green
    }

    # Step 4: Export projects (unless ImportOnly)
    if (-not $ImportOnly) {
        Write-Host "`nStep 4: Exporting projects from source environment..." -ForegroundColor Gray

        $exportResult = Export-Projects `
            -SourceClient $clients.Source `
            -Config $config `
            -ExportPath "./exports"

        $ExportPath = $exportResult.ExportPath
        Write-Host "Export completed. Path: $ExportPath" -ForegroundColor Green
        Write-Host "Projects exported: $($exportResult.ProjectCount)" -ForegroundColor Green

        # If ExportOnly mode, exit here
        if ($ExportOnly) {
            Write-Host "`nExport-only mode completed successfully!" -ForegroundColor Green
            Write-Host "To import these projects, run:" -ForegroundColor Cyan
            Write-Host "  .\Migrate-AllProjects.ps1 -ConfigPath `"$ConfigPath`" -ImportOnly -ExportPath `"$ExportPath`"" -ForegroundColor Cyan
            exit 0
        }
    }
    else {
        # Validate export path for ImportOnly mode
        if (-not $ExportPath -or -not (Test-Path $ExportPath)) {
            throw "ExportPath must be specified and valid for ImportOnly mode"
        }

        # Re-authenticate for import
        Write-Host "`nStep 3: Authenticating to target environment..." -ForegroundColor Gray
        $clients = @{
            Target = Get-AuthenticatedClient -Config $config.targetEnvironment -EnvironmentName "Target"
            TargetConfig = $config.targetEnvironment
        }
        Write-Host "Successfully authenticated to target environment" -ForegroundColor Green
    }

    # Step 5: Import projects
    Write-Host "`nStep 5: Importing projects to target environment..." -ForegroundColor Gray

    $importResult = Import-Projects `
        -TargetClient $clients.Target `
        -Config $config `
        -ExportPath $ExportPath

    Write-Host "Import completed" -ForegroundColor Green
    Write-Host "Successful imports: $($importResult.SuccessfulProjects)" -ForegroundColor Green
    Write-Host "Failed imports: $($importResult.FailedProjects.Count)" -ForegroundColor $(if ($importResult.FailedProjects.Count -gt 0) { "Red" } else { "Green" })

    # Step 6: Generate summary report
    Write-Host "`nStep 6: Generating summary report..." -ForegroundColor Gray

    $summaryReport = @{
        MigrationTimestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        SourceEnvironment = $config.sourceEnvironment.organizationUrl
        TargetEnvironment = $config.targetEnvironment.organizationUrl
        ExportPath = $ExportPath
        ImportLogPath = $importResult.LogPath
        TotalProjects = $importResult.TotalProjects
        SuccessfulProjects = $importResult.SuccessfulProjects
        FailedProjects = $importResult.FailedProjects
        SuccessRate = [math]::Round(($importResult.SuccessfulProjects / $importResult.TotalProjects) * 100, 2)
    }

    $summaryPath = Join-Path $config.logging.logPath "migration_summary_$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss').json"
    $summaryReport | ConvertTo-Json | Set-Content -Path $summaryPath
    Write-Host "Summary report saved to: $summaryPath" -ForegroundColor Green

    # Final summary
    Write-Host "`n===================================" -ForegroundColor Cyan
    Write-Host "Migration Summary" -ForegroundColor Cyan
    Write-Host "===================================" -ForegroundColor Cyan
    Write-Host "Total Projects: $($summaryReport.TotalProjects)" -ForegroundColor White
    Write-Host "Successful: $($summaryReport.SuccessfulProjects)" -ForegroundColor Green
    Write-Host "Failed: $($summaryReport.FailedProjects.Count)" -ForegroundColor Red
    Write-Host "Success Rate: $($summaryReport.SuccessRate)%" -ForegroundColor Yellow
    Write-Host "Source Environment: $($summaryReport.SourceEnvironment)" -ForegroundColor White
    Write-Host "Target Environment: $($summaryReport.TargetEnvironment)" -ForegroundColor White
    Write-Host "===================================" -ForegroundColor Cyan

    Write-Host "`nMigration completed successfully!" -ForegroundColor Green
    Write-Host "Log path: $($config.logging.logPath)" -ForegroundColor Cyan
}
catch {
    Write-Error "Migration failed: $_"
    Write-Host "`nFor troubleshooting, check the logs in: $($config.logging.logPath)" -ForegroundColor Red
    exit 1
}
