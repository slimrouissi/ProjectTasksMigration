<#
.SYNOPSIS
Exports projects and related data from source Dynamics 365 Project Operations environment.

.DESCRIPTION
Queries the source environment for projects, team members, tasks, dependencies, assignments,
and buckets. Exports all data to JSON files for import into target environment.

.PARAMETER SourceClient
Authenticated client for source environment

.PARAMETER Config
Configuration object containing export settings

.PARAMETER ExportPath
Output directory for exported JSON files

.EXAMPLE
Export-Projects -SourceClient $sourceClient -Config $config -ExportPath "./exports"
#>

function Export-Projects {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$SourceClient,

        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$ExportPath
    )

    Write-Host "Starting export from source environment..." -ForegroundColor Cyan

    # Create export directory
    if (-not (Test-Path $ExportPath)) {
        New-Item -ItemType Directory -Path $ExportPath -Force | Out-Null
        Write-Verbose "Created export directory: $ExportPath"
    }

    $exportTimestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $exportRunPath = Join-Path $ExportPath "export_$exportTimestamp"
    New-Item -ItemType Directory -Path $exportRunPath -Force | Out-Null

    try {
        # Step 1: Export all projects
        Write-Host "Exporting projects..." -ForegroundColor Gray
        $projects = Get-Projects -Client $SourceClient -Config $Config
        $projectCount = $projects.Count
        Write-Host "Found $projectCount projects to export." -ForegroundColor Green

        if ($projectCount -eq 0) {
            Write-Warning "No projects found in source environment."
            return
        }

        # Step 2: Process each project
        $processedCount = 0
        foreach ($project in $projects) {
            $processedCount++
            $projectId = $project.msdyn_projectid
            $projectName = $project.msdyn_projectname

            Write-Progress -Activity "Exporting Projects" -Status "Processing: $projectName" -PercentComplete (($processedCount / $projectCount) * 100)
            Write-Host "[$processedCount/$projectCount] Exporting project: $projectName ($projectId)" -ForegroundColor Gray

            try {
                # Create project-specific directory
                $projectDir = Join-Path $exportRunPath $projectName
                New-Item -ItemType Directory -Path $projectDir -Force | Out-Null

                # Export project details
                $projectData = @{
                    project = $project
                    teamMembers = @()
                    tasks = @()
                    taskDependencies = @()
                    resourceAssignments = @()
                    buckets = @()
                    exportTimestamp = $exportTimestamp
                    sourceOrgUrl = $SourceClient.Config.organizationUrl
                }

                # Export team members
                Write-Verbose "Exporting team members for project: $projectName"
                $projectData.teamMembers = Get-ProjectTeamMembers -Client $SourceClient -ProjectId $projectId -Config $Config

                # Export tasks (preserving hierarchy)
                Write-Verbose "Exporting tasks for project: $projectName"
                $projectData.tasks = Get-ProjectTasks -Client $SourceClient -ProjectId $projectId -Config $Config

                # Export task dependencies
                Write-Verbose "Exporting task dependencies for project: $projectName"
                $projectData.taskDependencies = Get-TaskDependencies -Client $SourceClient -ProjectId $projectId -Config $Config

                # Export resource assignments
                Write-Verbose "Exporting resource assignments for project: $projectName"
                $projectData.resourceAssignments = Get-ResourceAssignments -Client $SourceClient -ProjectId $projectId -Config $Config

                # Export project buckets
                Write-Verbose "Exporting buckets for project: $projectName"
                $projectData.buckets = Get-ProjectBuckets -Client $SourceClient -ProjectId $projectId -Config $Config

                # Save to JSON file
                $jsonFile = Join-Path $projectDir "project_data.json"
                $projectData | ConvertTo-Json -Depth 100 | Set-Content -Path $jsonFile -Encoding UTF8
                Write-Verbose "Saved project data to: $jsonFile"

                Write-Host "  Exported: $(($projectData.teamMembers).Count) team members, $(($projectData.tasks).Count) tasks, $(($projectData.taskDependencies).Count) dependencies, $(($projectData.resourceAssignments).Count) assignments, $(($projectData.buckets).Count) buckets" -ForegroundColor Green

            }
            catch {
                Write-Error "Failed to export project $projectName : $_"
                # Continue with next project
            }
        }

        Write-Progress -Activity "Exporting Projects" -Completed

        # Create summary report
        Write-Host "`nExport completed successfully!" -ForegroundColor Green
        Write-Host "Export path: $exportRunPath" -ForegroundColor Cyan
        Write-Host "Total projects exported: $processedCount" -ForegroundColor Green

        return @{
            ExportPath = $exportRunPath
            ProjectCount = $processedCount
            Timestamp = $exportTimestamp
        }
    }
    catch {
        Write-Error "Export failed: $_"
        throw
    }
}

<#
.SYNOPSIS
Retrieves all projects from the source environment with pagination.

.DESCRIPTION
Queries msdyn_projects table with all standard and custom fields defined in the config.
Handles pagination (5000 records per page) to retrieve all projects.
#>
function Get-Projects {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Client,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    Write-Verbose "Retrieving projects from source environment..."

    # Build select clause with custom fields
    $selectFields = @(
        'msdyn_projectid',
        'msdyn_projectname',
        'msdyn_description',
        'msdyn_startdate',
        'msdyn_enddate',
        'msdyn_status',
        'msdyn_projecttemplateid',
        'statecode',
        'statuscode',
        'createdon',
        'modifiedon',
        'createdonbehalfby',
        'modifiedonbehalfby'
    )

    # Add custom field mappings
    if ($Config.customFieldMappings) {
        foreach ($mapping in $Config.customFieldMappings | Where-Object { $_.isMapped -eq $true }) {
            $selectFields += $mapping.sourceFieldName
        }
    }

    $selectClause = ($selectFields | Sort-Object -Unique) -join ','

    $projectFilter = ""
    if ($Config.migration.projectFilter) {
        $projectFilter = "&`$filter=contains(msdyn_projectname,'$($Config.migration.projectFilter)')"
    }

    # Skip certain projects if configured
    if ($Config.migration.skipProjects -and $Config.migration.skipProjects.Count -gt 0) {
        $skipFilter = ($Config.migration.skipProjects | ForEach-Object { "msdyn_projectname ne '$_'" }) -join " and "
        $projectFilter += if ($projectFilter) { " and $skipFilter" } else { "&`$filter=$skipFilter" }
    }

    $uri = "$($Client.Config.organizationUrl)/api/data/v9.2/msdyn_projects?`$select=$selectClause&`$top=$($Config.batchSettings.pageSize)&`$orderby=msdyn_projectname$projectFilter"

    $allProjects = @()
    $pageCount = 0

    try {
        while ($uri) {
            $pageCount++
            Write-Verbose "Fetching projects page $pageCount..."

            $response = Invoke-WebApiRequest -Client $Client -Uri $uri -Method Get -RetryPolicy $Config.retrySettings

            if ($response.value) {
                $allProjects += $response.value
                Write-Verbose "Retrieved $($response.value.Count) projects in page $pageCount"
            }

            # Check for next page link
            $uri = $response.'@odata.nextLink'
        }

        Write-Host "Retrieved $($allProjects.Count) total projects from source environment." -ForegroundColor Green
        return $allProjects
    }
    catch {
        Write-Error "Failed to retrieve projects: $_"
        throw
    }
}

<#
.SYNOPSIS
Retrieves project team members for a specific project.
#>
function Get-ProjectTeamMembers {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Client,

        [Parameter(Mandatory = $true)]
        [string]$ProjectId,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    Write-Verbose "Retrieving team members for project: $ProjectId"

    $selectFields = 'msdyn_projectteamid,msdyn_projectid,msdyn_name,msdyn_resourceid,msdyn_projectteammembershipid,msdyn_role,statecode,statuscode'

    $uri = "$($Client.Config.organizationUrl)/api/data/v9.2/msdyn_projectteams?`$select=$selectFields&`$filter=_msdyn_projectid_value eq '$ProjectId'&`$top=$($Config.batchSettings.pageSize)"

    $teamMembers = @()

    try {
        while ($uri) {
            $response = Invoke-WebApiRequest -Client $Client -Uri $uri -Method Get -RetryPolicy $Config.retrySettings

            if ($response.value) {
                $teamMembers += $response.value
            }

            $uri = $response.'@odata.nextLink'
        }

        Write-Verbose "Retrieved $($teamMembers.Count) team members for project: $ProjectId"
        return $teamMembers
    }
    catch {
        Write-Error "Failed to retrieve team members for project $ProjectId : $_"
        return @()
    }
}

<#
.SYNOPSIS
Retrieves all tasks for a project, preserving parent task hierarchy.

.DESCRIPTION
Queries tasks in hierarchical order (roots first, then children) to enable
proper parent-child relationship reconstruction during import.
#>
function Get-ProjectTasks {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Client,

        [Parameter(Mandatory = $true)]
        [string]$ProjectId,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    Write-Verbose "Retrieving tasks for project: $ProjectId"

    # Build select clause with custom fields
    $selectFields = @(
        'msdyn_projecttaskid',
        'msdyn_projectid',
        'msdyn_subject',
        'msdyn_description',
        'msdyn_startdate',
        'msdyn_enddate',
        'msdyn_effort',
        'msdyn_effortcontoured',
        'msdyn_status',
        'msdyn_parenttaskid',
        'msdyn_sequencenumber',
        'msdyn_ismilestone',
        'msdyn_wbsid',
        'msdyn_outlinelevel',
        'statecode',
        'statuscode',
        'createdon',
        'modifiedon'
    )

    # Add custom field mappings
    if ($Config.customFieldMappings) {
        foreach ($mapping in $Config.customFieldMappings | Where-Object { $_.isMapped -eq $true }) {
            $selectFields += $mapping.sourceFieldName
        }
    }

    $selectClause = ($selectFields | Sort-Object -Unique) -join ','

    # Order by outline level and sequence to get hierarchy correct
    $uri = "$($Client.Config.organizationUrl)/api/data/v9.2/msdyn_projecttasks?`$select=$selectClause&`$filter=_msdyn_projectid_value eq '$ProjectId'&`$orderby=msdyn_outlinelevel,msdyn_sequencenumber&`$top=$($Config.batchSettings.pageSize)"

    $tasks = @()

    try {
        while ($uri) {
            $response = Invoke-WebApiRequest -Client $Client -Uri $uri -Method Get -RetryPolicy $Config.retrySettings

            if ($response.value) {
                $tasks += $response.value
            }

            $uri = $response.'@odata.nextLink'
        }

        Write-Verbose "Retrieved $($tasks.Count) tasks for project: $ProjectId"
        return $tasks
    }
    catch {
        Write-Error "Failed to retrieve tasks for project $ProjectId : $_"
        return @()
    }
}

<#
.SYNOPSIS
Retrieves task dependencies for a project.
#>
function Get-TaskDependencies {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Client,

        [Parameter(Mandatory = $true)]
        [string]$ProjectId,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    Write-Verbose "Retrieving task dependencies for project: $ProjectId"

    $selectFields = 'msdyn_projecttaskdependencyid,msdyn_projectid,msdyn_predecessortaskid,msdyn_successortaskid,msdyn_dependencytype,msdyn_linklag,statecode,statuscode'

    $uri = "$($Client.Config.organizationUrl)/api/data/v9.2/msdyn_projecttaskdependencies?`$select=$selectFields&`$filter=_msdyn_projectid_value eq '$ProjectId'&`$top=$($Config.batchSettings.pageSize)"

    $dependencies = @()

    try {
        while ($uri) {
            $response = Invoke-WebApiRequest -Client $Client -Uri $uri -Method Get -RetryPolicy $Config.retrySettings

            if ($response.value) {
                $dependencies += $response.value
            }

            $uri = $response.'@odata.nextLink'
        }

        Write-Verbose "Retrieved $($dependencies.Count) task dependencies for project: $ProjectId"
        return $dependencies
    }
    catch {
        Write-Error "Failed to retrieve task dependencies for project $ProjectId : $_"
        return @()
    }
}

<#
.SYNOPSIS
Retrieves resource assignments for a project.
#>
function Get-ResourceAssignments {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Client,

        [Parameter(Mandatory = $true)]
        [string]$ProjectId,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    Write-Verbose "Retrieving resource assignments for project: $ProjectId"

    $selectFields = 'msdyn_resourceassignmentid,msdyn_projectid,msdyn_projecttaskid,msdyn_resourceid,msdyn_assignedduration,msdyn_assigneddurationformula,msdyn_startdate,msdyn_enddate,msdyn_assignmentcontour,msdyn_assignmentcontourjson,statecode,statuscode'

    $uri = "$($Client.Config.organizationUrl)/api/data/v9.2/msdyn_resourceassignments?`$select=$selectFields&`$filter=_msdyn_projectid_value eq '$ProjectId'&`$top=$($Config.batchSettings.pageSize)"

    $assignments = @()

    try {
        while ($uri) {
            $response = Invoke-WebApiRequest -Client $Client -Uri $uri -Method Get -RetryPolicy $Config.retrySettings

            if ($response.value) {
                $assignments += $response.value
            }

            $uri = $response.'@odata.nextLink'
        }

        Write-Verbose "Retrieved $($assignments.Count) resource assignments for project: $ProjectId"
        return $assignments
    }
    catch {
        Write-Error "Failed to retrieve resource assignments for project $ProjectId : $_"
        return @()
    }
}

<#
.SYNOPSIS
Retrieves project buckets (swim lanes).
#>
function Get-ProjectBuckets {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Client,

        [Parameter(Mandatory = $true)]
        [string]$ProjectId,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    Write-Verbose "Retrieving buckets for project: $ProjectId"

    $selectFields = 'msdyn_projectbucketid,msdyn_projectid,msdyn_name,msdyn_description,msdyn_sequencenumber,statecode,statuscode'

    $uri = "$($Client.Config.organizationUrl)/api/data/v9.2/msdyn_projectbuckets?`$select=$selectFields&`$filter=_msdyn_projectid_value eq '$ProjectId'&`$orderby=msdyn_sequencenumber&`$top=$($Config.batchSettings.pageSize)"

    $buckets = @()

    try {
        while ($uri) {
            $response = Invoke-WebApiRequest -Client $Client -Uri $uri -Method Get -RetryPolicy $Config.retrySettings

            if ($response.value) {
                $buckets += $response.value
            }

            $uri = $response.'@odata.nextLink'
        }

        Write-Verbose "Retrieved $($buckets.Count) buckets for project: $ProjectId"
        return $buckets
    }
    catch {
        Write-Error "Failed to retrieve buckets for project $ProjectId : $_"
        return @()
    }
}

# Export public functions
Export-ModuleMember -Function @(
    'Export-Projects',
    'Get-Projects',
    'Get-ProjectTeamMembers',
    'Get-ProjectTasks',
    'Get-TaskDependencies',
    'Get-ResourceAssignments',
    'Get-ProjectBuckets'
)
