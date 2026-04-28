<#
.SYNOPSIS
Imports projects into target environment using Schedule API (OperationSet).

.DESCRIPTION
Reads exported JSON files and imports projects using the Schedule API for scheduling entities.
Projects are created directly via Dataverse API, then OperationSets are used for team members,
tasks, dependencies, assignments, and buckets.

.PARAMETER TargetClient
Authenticated client for target environment

.PARAMETER Config
Configuration object with import settings

.PARAMETER ExportPath
Path containing exported project JSON files

.EXAMPLE
Import-Projects -TargetClient $targetClient -Config $config -ExportPath "./exports/export_2024-01-15_10-30-45"
#>

function Import-Projects {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$ExportPath
    )

    Write-Host "Starting import to target environment..." -ForegroundColor Cyan

    # Validate export path
    if (-not (Test-Path $ExportPath)) {
        throw "Export path not found: $ExportPath"
    }

    # Create import log directory
    $logPath = Join-Path $Config.logging.logPath "import_$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')"
    New-Item -ItemType Directory -Path $logPath -Force | Out-Null

    # Track GUID mappings (old GUID -> new GUID)
    $guidMappings = @{}

    # Get all project directories
    $projectDirs = Get-ChildItem -Path $ExportPath -Directory | Where-Object { Test-Path (Join-Path $_.FullName "project_data.json") }
    $projectCount = $projectDirs.Count

    Write-Host "Found $projectCount projects to import." -ForegroundColor Green

    if ($projectCount -eq 0) {
        Write-Warning "No projects found to import."
        return
    }

    $processedCount = 0
    $successCount = 0
    $failedProjects = @()

    foreach ($projectDir in $projectDirs) {
        $processedCount++
        $projectName = $projectDir.Name

        Write-Progress -Activity "Importing Projects" -Status "Processing: $projectName" -PercentComplete (($processedCount / $projectCount) * 100)
        Write-Host "[$processedCount/$projectCount] Importing project: $projectName" -ForegroundColor Gray

        try {
            # Load project data from JSON
            $jsonPath = Join-Path $projectDir.FullName "project_data.json"
            $projectData = Get-Content -Path $jsonPath -Raw | ConvertFrom-Json

            # Import the project
            $projectLogPath = Join-Path $logPath $projectName
            New-Item -ItemType Directory -Path $projectLogPath -Force | Out-Null

            $result = Import-SingleProject -TargetClient $TargetClient -ProjectData $projectData -Config $Config -LogPath $projectLogPath -GuidMappings $guidMappings

            if ($result.Success) {
                $successCount++
                Write-Host "  Successfully imported: $projectName" -ForegroundColor Green
            }
            else {
                $failedProjects += @{
                    ProjectName = $projectName
                    Error = $result.Error
                }
                Write-Host "  Failed to import: $projectName - $($result.Error)" -ForegroundColor Red
            }
        }
        catch {
            $failedProjects += @{
                ProjectName = $projectName
                Error = $_
            }
            Write-Error "Failed to process project $projectName : $_"
        }
    }

    Write-Progress -Activity "Importing Projects" -Completed

    # Create summary report
    Write-Host "`nImport completed!" -ForegroundColor Green
    Write-Host "Successful imports: $successCount / $projectCount" -ForegroundColor Green
    Write-Host "Failed imports: $($failedProjects.Count)" -ForegroundColor $(if ($failedProjects.Count -gt 0) { "Red" } else { "Green" })

    if ($failedProjects.Count -gt 0) {
        Write-Host "`nFailed Projects:" -ForegroundColor Red
        foreach ($failed in $failedProjects) {
            Write-Host "  - $($failed.ProjectName): $($failed.Error)" -ForegroundColor Red
        }
    }

    Write-Host "Import log path: $logPath" -ForegroundColor Cyan

    return @{
        LogPath = $logPath
        TotalProjects = $projectCount
        SuccessfulProjects = $successCount
        FailedProjects = $failedProjects
        GuidMappings = $guidMappings
    }
}

<#
.SYNOPSIS
Imports a single project with all related entities.

.DESCRIPTION
Creates the project, then uses OperationSet API to create team members, tasks,
dependencies, assignments, and buckets. Handles GUID mapping for references.
#>
function Import-SingleProject {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [object]$ProjectData,

        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$LogPath,

        [Parameter(Mandatory = $true)]
        [hashtable]$GuidMappings
    )

    $projectId = $ProjectData.project.msdyn_projectid
    $projectName = $ProjectData.project.msdyn_projectname

    try {
        Write-Verbose "Starting import of project: $projectName"

        # Step 1: Create the project in target environment
        Write-Verbose "Creating project in target environment..."
        $newProjectId = Create-Project -TargetClient $TargetClient -ProjectData $ProjectData.project -Config $Config

        # Track GUID mapping
        $GuidMappings[$projectId] = $newProjectId
        Write-Verbose "Created project. Old ID: $projectId, New ID: $newProjectId"

        # Log the mapping
        Add-Content -Path "$LogPath/guid_mappings.txt" -Value "$projectId -> $newProjectId"

        # Step 2: Create buckets in OperationSet
        if ($ProjectData.buckets.Count -gt 0) {
            Write-Verbose "Creating buckets via OperationSet..."
            $bucketMappings = Create-Buckets -TargetClient $TargetClient -TargetProjectId $newProjectId -Buckets $ProjectData.buckets -Config $Config -LogPath $LogPath
            $GuidMappings += $bucketMappings
            Write-Verbose "Created $($bucketMappings.Count) bucket mappings"
        }

        # Step 3: Create team members via OperationSet
        if ($ProjectData.teamMembers.Count -gt 0) {
            Write-Verbose "Creating team members via OperationSet..."
            Create-TeamMembers -TargetClient $TargetClient -TargetProjectId $newProjectId -TeamMembers $ProjectData.teamMembers -Config $Config -LogPath $LogPath
            Write-Verbose "Created $($ProjectData.teamMembers.Count) team members"
        }

        # Step 4: Create tasks via OperationSet (in hierarchical order)
        if ($ProjectData.tasks.Count -gt 0) {
            Write-Verbose "Creating tasks via OperationSet..."
            $taskMappings = Create-Tasks -TargetClient $TargetClient -TargetProjectId $newProjectId -Tasks $ProjectData.tasks -Config $Config -GuidMappings $GuidMappings -LogPath $LogPath
            $GuidMappings += $taskMappings
            Write-Verbose "Created $($taskMappings.Count) task mappings"
        }

        # Step 5: Create task dependencies via OperationSet
        if ($ProjectData.taskDependencies.Count -gt 0 -and $taskMappings.Count -gt 0) {
            Write-Verbose "Creating task dependencies via OperationSet..."
            Create-TaskDependencies -TargetClient $TargetClient -TargetProjectId $newProjectId -TaskDependencies $ProjectData.taskDependencies -GuidMappings $GuidMappings -Config $Config -LogPath $LogPath
            Write-Verbose "Created $($ProjectData.taskDependencies.Count) task dependencies"
        }

        # Step 6: Create resource assignments via OperationSet
        if ($ProjectData.resourceAssignments.Count -gt 0 -and $taskMappings.Count -gt 0) {
            Write-Verbose "Creating resource assignments via OperationSet..."
            Create-ResourceAssignments -TargetClient $TargetClient -TargetProjectId $newProjectId -Assignments $ProjectData.resourceAssignments -GuidMappings $GuidMappings -Config $Config -LogPath $LogPath
            Write-Verbose "Created $($ProjectData.resourceAssignments.Count) resource assignments"
        }

        # Log project summary
        $summary = @{
            ProjectName = $projectName
            SourceProjectId = $projectId
            TargetProjectId = $newProjectId
            TeamMembersCount = $ProjectData.teamMembers.Count
            TasksCount = $ProjectData.tasks.Count
            DependenciesCount = $ProjectData.taskDependencies.Count
            AssignmentsCount = $ProjectData.resourceAssignments.Count
            BucketsCount = $ProjectData.buckets.Count
            Status = "Success"
        }

        Add-Content -Path "$LogPath/summary.json" -Value ($summary | ConvertTo-Json)

        return @{ Success = $true; ProjectId = $newProjectId }
    }
    catch {
        Write-Error "Failed to import project $projectName : $_"

        # Log failure
        $failureSummary = @{
            ProjectName = $projectName
            Status = "Failed"
            Error = $_.ToString()
        }
        Add-Content -Path "$LogPath/error.json" -Value ($failureSummary | ConvertTo-Json)

        return @{ Success = $false; Error = $_ }
    }
}

<#
.SYNOPSIS
Creates a project in the target environment via direct Dataverse API.

.DESCRIPTION
Projects can be created directly without OperationSet. Only scheduling entities
(tasks, dependencies, assignments) require OperationSet.
#>
function Create-Project {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [object]$ProjectData,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    Write-Verbose "Creating project: $($ProjectData.msdyn_projectname)"

    # Build project payload with standard and custom fields
    $projectPayload = @{
        msdyn_projectname = $ProjectData.msdyn_projectname
        msdyn_description = $ProjectData.msdyn_description
    }

    # Add optional fields if present
    if ($ProjectData.msdyn_startdate) {
        $projectPayload.msdyn_startdate = $ProjectData.msdyn_startdate
    }
    if ($ProjectData.msdyn_enddate) {
        $projectPayload.msdyn_enddate = $ProjectData.msdyn_enddate
    }

    # Add custom fields from config mapping
    if ($Config.customFieldMappings) {
        foreach ($mapping in $Config.customFieldMappings | Where-Object { $_.isMapped -eq $true }) {
            if ($ProjectData.PSObject.Properties.Name -contains $mapping.sourceFieldName) {
                $value = $ProjectData.$($mapping.sourceFieldName)
                if ($null -ne $value) {
                    $projectPayload[$mapping.targetFieldName] = $value
                }
            }
        }
    }

    $uri = "$($TargetClient.Config.organizationUrl)/api/data/v9.2/msdyn_projects"
    $body = $projectPayload | ConvertTo-Json

    try {
        $response = Invoke-WebApiRequest -Client $TargetClient -Uri $uri -Method Post -Body $body -RetryPolicy $Config.retrySettings

        # Extract the created project ID from location header
        # For POST requests, we need to get the ID from the response
        $newProjectId = if ($response.msdyn_projectid) {
            $response.msdyn_projectid
        }
        else {
            # If ID not in response, query the created record
            $createdProject = Get-CreatedProjectId -TargetClient $TargetClient -ProjectName $ProjectData.msdyn_projectname -Config $Config
            $createdProject.msdyn_projectid
        }

        Write-Verbose "Project created with ID: $newProjectId"
        return $newProjectId
    }
    catch {
        Write-Error "Failed to create project: $_"
        throw
    }
}

<#
.SYNOPSIS
Queries for the most recently created project by name.
#>
function Get-CreatedProjectId {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [string]$ProjectName,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    $uri = "$($TargetClient.Config.organizationUrl)/api/data/v9.2/msdyn_projects?`$filter=msdyn_projectname eq '$ProjectName'&`$orderby=createdon desc&`$top=1"

    $response = Invoke-WebApiRequest -Client $TargetClient -Uri $uri -Method Get -RetryPolicy $Config.retrySettings

    if ($response.value.Count -gt 0) {
        return $response.value[0]
    }

    throw "Could not find created project: $ProjectName"
}

<#
.SYNOPSIS
Creates project buckets via OperationSet.
#>
function Create-Buckets {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [string]$TargetProjectId,

        [Parameter(Mandatory = $true)]
        [array]$Buckets,

        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$LogPath
    )

    if ($Buckets.Count -eq 0) {
        return @{}
    }

    Write-Verbose "Creating $($Buckets.Count) buckets in target project"

    # Create OperationSet
    $operationSetId = Create-OperationSet -TargetClient $TargetClient -Config $Config

    try {
        $bucketMappings = @{}
        $batchCount = 0
        $operationCount = 0

        foreach ($bucket in $Buckets) {
            $batchCount++

            # Create bucket payload
            $bucketPayload = @{
                msdyn_name = $bucket.msdyn_name
                msdyn_projectid = @{ msdyn_projectid = $TargetProjectId }
            }

            if ($bucket.msdyn_description) {
                $bucketPayload.msdyn_description = $bucket.msdyn_description
            }
            if ($bucket.msdyn_sequencenumber) {
                $bucketPayload.msdyn_sequencenumber = $bucket.msdyn_sequencenumber
            }

            # Create operation for this bucket
            $operation = @{
                Operation = 1  # Create operation
                Entity = @{
                    LogicalName = "msdyn_projectbucket"
                    KeyProperties = @()
                    Data = $bucketPayload
                }
            }

            # Add to OperationSet
            Add-OperationToSet -TargetClient $TargetClient -OperationSetId $operationSetId -Operation $operation -Config $Config
            $operationCount++

            # If we reach max operations, execute and create new set
            if ($operationCount -ge $Config.batchSettings.operationSetMaxSize) {
                Execute-OperationSet -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
                Poll-OperationSetCompletion -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config

                $operationSetId = Create-OperationSet -TargetClient $TargetClient -Config $Config
                $operationCount = 0
            }
        }

        # Execute remaining operations
        if ($operationCount -gt 0) {
            Execute-OperationSet -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
            Poll-OperationSetCompletion -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
        }

        Write-Verbose "Successfully created buckets"
        return $bucketMappings
    }
    catch {
        Write-Error "Failed to create buckets: $_"
        throw
    }
}

<#
.SYNOPSIS
Creates team members via OperationSet.
#>
function Create-TeamMembers {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [string]$TargetProjectId,

        [Parameter(Mandatory = $true)]
        [array]$TeamMembers,

        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$LogPath
    )

    if ($TeamMembers.Count -eq 0) {
        return
    }

    Write-Verbose "Creating $($TeamMembers.Count) team members in target project"

    # Create OperationSet
    $operationSetId = Create-OperationSet -TargetClient $TargetClient -Config $Config

    try {
        $operationCount = 0

        foreach ($member in $TeamMembers) {
            # Create team member payload
            $memberPayload = @{
                msdyn_projectid = @{ msdyn_projectid = $TargetProjectId }
            }

            if ($member.msdyn_resourceid) {
                $memberPayload.msdyn_resourceid = @{ systemuserid = $member.msdyn_resourceid }
            }
            if ($member.msdyn_name) {
                $memberPayload.msdyn_name = $member.msdyn_name
            }

            # Create operation
            $operation = @{
                Operation = 1
                Entity = @{
                    LogicalName = "msdyn_projectteam"
                    KeyProperties = @()
                    Data = $memberPayload
                }
            }

            Add-OperationToSet -TargetClient $TargetClient -OperationSetId $operationSetId -Operation $operation -Config $Config
            $operationCount++

            if ($operationCount -ge $Config.batchSettings.operationSetMaxSize) {
                Execute-OperationSet -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
                Poll-OperationSetCompletion -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config

                $operationSetId = Create-OperationSet -TargetClient $TargetClient -Config $Config
                $operationCount = 0
            }
        }

        if ($operationCount -gt 0) {
            Execute-OperationSet -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
            Poll-OperationSetCompletion -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
        }

        Write-Verbose "Successfully created team members"
    }
    catch {
        Write-Error "Failed to create team members: $_"
        throw
    }
}

<#
.SYNOPSIS
Creates tasks via OperationSet in hierarchical order (parents before children).
#>
function Create-Tasks {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [string]$TargetProjectId,

        [Parameter(Mandatory = $true)]
        [array]$Tasks,

        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [hashtable]$GuidMappings,

        [Parameter(Mandatory = $true)]
        [string]$LogPath
    )

    if ($Tasks.Count -eq 0) {
        return @{}
    }

    Write-Verbose "Creating $($Tasks.Count) tasks in target project"

    # Sort tasks by outline level to ensure parents are created before children
    $sortedTasks = $Tasks | Sort-Object { [int]$_.msdyn_outlinelevel }, { [int]$_.msdyn_sequencenumber }

    # Create OperationSet
    $operationSetId = Create-OperationSet -TargetClient $TargetClient -Config $Config

    try {
        $taskMappings = @{}
        $operationCount = 0

        foreach ($task in $sortedTasks) {
            # Create task payload
            $taskPayload = @{
                msdyn_subject = $task.msdyn_subject
                msdyn_projectid = @{ msdyn_projectid = $TargetProjectId }
            }

            if ($task.msdyn_description) {
                $taskPayload.msdyn_description = $task.msdyn_description
            }
            if ($task.msdyn_startdate) {
                $taskPayload.msdyn_startdate = $task.msdyn_startdate
            }
            if ($task.msdyn_enddate) {
                $taskPayload.msdyn_enddate = $task.msdyn_enddate
            }
            if ($task.msdyn_effort) {
                $taskPayload.msdyn_effort = $task.msdyn_effort
            }

            # Map parent task ID if present
            if ($task.msdyn_parenttaskid -and $GuidMappings.ContainsKey($task.msdyn_parenttaskid)) {
                $taskPayload.msdyn_parenttaskid = @{ msdyn_projecttaskid = $GuidMappings[$task.msdyn_parenttaskid] }
            }

            if ($task.msdyn_sequencenumber) {
                $taskPayload.msdyn_sequencenumber = $task.msdyn_sequencenumber
            }
            if ($task.msdyn_ismilestone) {
                $taskPayload.msdyn_ismilestone = $task.msdyn_ismilestone
            }

            # Add custom fields
            if ($Config.customFieldMappings) {
                foreach ($mapping in $Config.customFieldMappings | Where-Object { $_.isMapped -eq $true }) {
                    if ($task.PSObject.Properties.Name -contains $mapping.sourceFieldName) {
                        $value = $task.$($mapping.sourceFieldName)
                        if ($null -ne $value) {
                            $taskPayload[$mapping.targetFieldName] = $value
                        }
                    }
                }
            }

            # Create operation
            $operation = @{
                Operation = 1
                Entity = @{
                    LogicalName = "msdyn_projecttask"
                    KeyProperties = @()
                    Data = $taskPayload
                }
            }

            Add-OperationToSet -TargetClient $TargetClient -OperationSetId $operationSetId -Operation $operation -Config $Config
            $operationCount++

            # Track task mapping
            $taskMappings[$task.msdyn_projecttaskid] = "pending_$($task.msdyn_subject)"

            if ($operationCount -ge $Config.batchSettings.operationSetMaxSize) {
                Execute-OperationSet -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
                Poll-OperationSetCompletion -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config

                # Refresh task mappings from database
                $taskMappings = Update-TaskMappings -TargetClient $TargetClient -SourceTaskIds $taskMappings.Keys -TargetProjectId $TargetProjectId -Config $Config

                $operationSetId = Create-OperationSet -TargetClient $TargetClient -Config $Config
                $operationCount = 0
            }
        }

        if ($operationCount -gt 0) {
            Execute-OperationSet -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
            Poll-OperationSetCompletion -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config

            # Refresh task mappings from database
            $taskMappings = Update-TaskMappings -TargetClient $TargetClient -SourceTaskIds $taskMappings.Keys -TargetProjectId $TargetProjectId -Config $Config
        }

        Write-Verbose "Successfully created $($taskMappings.Count) tasks"
        return $taskMappings
    }
    catch {
        Write-Error "Failed to create tasks: $_"
        throw
    }
}

<#
.SYNOPSIS
Updates task GUID mappings by querying the created tasks.
#>
function Update-TaskMappings {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [array]$SourceTaskIds,

        [Parameter(Mandatory = $true)]
        [string]$TargetProjectId,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    $taskMappings = @{}

    # Query all tasks in the project
    $uri = "$($TargetClient.Config.organizationUrl)/api/data/v9.2/msdyn_projecttasks?`$select=msdyn_projecttaskid,msdyn_subject&`$filter=_msdyn_projectid_value eq '$TargetProjectId'&`$top=$($Config.batchSettings.pageSize)"

    try {
        $response = Invoke-WebApiRequest -Client $TargetClient -Uri $uri -Method Get -RetryPolicy $Config.retrySettings

        foreach ($task in $response.value) {
            $taskMappings[$task.msdyn_projecttaskid] = $task.msdyn_subject
        }

        return $taskMappings
    }
    catch {
        Write-Error "Failed to update task mappings: $_"
        return $taskMappings
    }
}

<#
.SYNOPSIS
Creates task dependencies via OperationSet.
#>
function Create-TaskDependencies {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [string]$TargetProjectId,

        [Parameter(Mandatory = $true)]
        [array]$TaskDependencies,

        [Parameter(Mandatory = $true)]
        [hashtable]$GuidMappings,

        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$LogPath
    )

    if ($TaskDependencies.Count -eq 0) {
        return
    }

    Write-Verbose "Creating $($TaskDependencies.Count) task dependencies in target project"

    # Create OperationSet
    $operationSetId = Create-OperationSet -TargetClient $TargetClient -Config $Config

    try {
        $operationCount = 0
        $skippedCount = 0

        foreach ($dependency in $TaskDependencies) {
            # Map predecessor and successor task IDs
            $predecessorId = $GuidMappings[$dependency.msdyn_predecessortaskid]
            $successorId = $GuidMappings[$dependency.msdyn_successortaskid]

            # Skip if either task is missing
            if (-not $predecessorId -or -not $successorId) {
                Write-Verbose "Skipping dependency: predecessor or successor task not found"
                $skippedCount++
                continue
            }

            # Create dependency payload
            $dependencyPayload = @{
                msdyn_projectid = @{ msdyn_projectid = $TargetProjectId }
                msdyn_predecessortaskid = @{ msdyn_projecttaskid = $predecessorId }
                msdyn_successortaskid = @{ msdyn_projecttaskid = $successorId }
            }

            if ($dependency.msdyn_dependencytype) {
                $dependencyPayload.msdyn_dependencytype = $dependency.msdyn_dependencytype
            }
            if ($dependency.msdyn_linklag) {
                $dependencyPayload.msdyn_linklag = $dependency.msdyn_linklag
            }

            # Create operation
            $operation = @{
                Operation = 1
                Entity = @{
                    LogicalName = "msdyn_projecttaskdependency"
                    KeyProperties = @()
                    Data = $dependencyPayload
                }
            }

            Add-OperationToSet -TargetClient $TargetClient -OperationSetId $operationSetId -Operation $operation -Config $Config
            $operationCount++

            if ($operationCount -ge $Config.batchSettings.operationSetMaxSize) {
                Execute-OperationSet -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
                Poll-OperationSetCompletion -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config

                $operationSetId = Create-OperationSet -TargetClient $TargetClient -Config $Config
                $operationCount = 0
            }
        }

        if ($operationCount -gt 0) {
            Execute-OperationSet -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
            Poll-OperationSetCompletion -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
        }

        Write-Verbose "Successfully created task dependencies. Skipped: $skippedCount"
    }
    catch {
        Write-Error "Failed to create task dependencies: $_"
        throw
    }
}

<#
.SYNOPSIS
Creates resource assignments via OperationSet.
#>
function Create-ResourceAssignments {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [string]$TargetProjectId,

        [Parameter(Mandatory = $true)]
        [array]$Assignments,

        [Parameter(Mandatory = $true)]
        [hashtable]$GuidMappings,

        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$LogPath
    )

    if ($Assignments.Count -eq 0) {
        return
    }

    Write-Verbose "Creating $($Assignments.Count) resource assignments in target project"

    # Create OperationSet
    $operationSetId = Create-OperationSet -TargetClient $TargetClient -Config $Config

    try {
        $operationCount = 0
        $skippedCount = 0

        foreach ($assignment in $Assignments) {
            # Map task ID
            $taskId = $GuidMappings[$assignment.msdyn_projecttaskid]

            # Skip if task is missing
            if (-not $taskId) {
                Write-Verbose "Skipping assignment: task not found"
                $skippedCount++
                continue
            }

            # Create assignment payload
            $assignmentPayload = @{
                msdyn_projectid = @{ msdyn_projectid = $TargetProjectId }
                msdyn_projecttaskid = @{ msdyn_projecttaskid = $taskId }
            }

            if ($assignment.msdyn_resourceid) {
                $assignmentPayload.msdyn_resourceid = @{ bookableresourceid = $assignment.msdyn_resourceid }
            }
            if ($assignment.msdyn_assignedduration) {
                $assignmentPayload.msdyn_assignedduration = $assignment.msdyn_assignedduration
            }
            if ($assignment.msdyn_startdate) {
                $assignmentPayload.msdyn_startdate = $assignment.msdyn_startdate
            }
            if ($assignment.msdyn_enddate) {
                $assignmentPayload.msdyn_enddate = $assignment.msdyn_enddate
            }

            # Create operation
            $operation = @{
                Operation = 1
                Entity = @{
                    LogicalName = "msdyn_resourceassignment"
                    KeyProperties = @()
                    Data = $assignmentPayload
                }
            }

            Add-OperationToSet -TargetClient $TargetClient -OperationSetId $operationSetId -Operation $operation -Config $Config
            $operationCount++

            if ($operationCount -ge $Config.batchSettings.operationSetMaxSize) {
                Execute-OperationSet -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
                Poll-OperationSetCompletion -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config

                $operationSetId = Create-OperationSet -TargetClient $TargetClient -Config $Config
                $operationCount = 0
            }
        }

        if ($operationCount -gt 0) {
            Execute-OperationSet -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
            Poll-OperationSetCompletion -TargetClient $TargetClient -OperationSetId $operationSetId -Config $Config
        }

        Write-Verbose "Successfully created resource assignments. Skipped: $skippedCount"
    }
    catch {
        Write-Error "Failed to create resource assignments: $_"
        throw
    }
}

<#
.SYNOPSIS
Creates a new OperationSet via Schedule API.

.DESCRIPTION
Invokes msdyn_CreateOperationSetV1 action to create an OperationSet record
for batch processing scheduling entities.
#>
function Create-OperationSet {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    Write-Verbose "Creating OperationSet..."

    $uri = "$($TargetClient.Config.organizationUrl)/api/data/v9.2/msdyn_CreateOperationSetV1"

    try {
        $response = Invoke-WebApiRequest -Client $TargetClient -Uri $uri -Method Post -Body "{}" -RetryPolicy $Config.retrySettings

        $operationSetId = $response.OperationSetId

        Write-Verbose "OperationSet created with ID: $operationSetId"
        return $operationSetId
    }
    catch {
        Write-Error "Failed to create OperationSet: $_"
        throw
    }
}

<#
.SYNOPSIS
Adds an operation to an OperationSet.

.DESCRIPTION
Uses the msdyn_PssCreateV1 action to add a create operation to an OperationSet.
#>
function Add-OperationToSet {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [string]$OperationSetId,

        [Parameter(Mandatory = $true)]
        [object]$Operation,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    Write-Verbose "Adding operation to OperationSet: $OperationSetId"

    $uri = "$($TargetClient.Config.organizationUrl)/api/data/v9.2/msdyn_PssCreateV1"

    $payload = @{
        OperationSetId = $OperationSetId
        Operation = $Operation
    }

    $body = $payload | ConvertTo-Json -Depth 100

    try {
        $response = Invoke-WebApiRequest -Client $TargetClient -Uri $uri -Method Post -Body $body -RetryPolicy $Config.retrySettings
        Write-Verbose "Operation added to OperationSet"
    }
    catch {
        Write-Error "Failed to add operation to OperationSet: $_"
        throw
    }
}

<#
.SYNOPSIS
Executes an OperationSet.

.DESCRIPTION
Invokes msdyn_ExecuteOperationSetV1 action to execute all operations in an OperationSet.
This is an async operation that must be polled for completion.
#>
function Execute-OperationSet {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [string]$OperationSetId,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    Write-Verbose "Executing OperationSet: $OperationSetId"

    $uri = "$($TargetClient.Config.organizationUrl)/api/data/v9.2/msdyn_ExecuteOperationSetV1"

    $payload = @{
        OperationSetId = $OperationSetId
    }

    $body = $payload | ConvertTo-Json

    try {
        $response = Invoke-WebApiRequest -Client $TargetClient -Uri $uri -Method Post -Body $body -RetryPolicy $Config.retrySettings
        Write-Verbose "OperationSet execution initiated"
    }
    catch {
        Write-Error "Failed to execute OperationSet: $_"
        throw
    }
}

<#
.SYNOPSIS
Polls for OperationSet completion.

.DESCRIPTION
Polls the msdyn_operationset record's status until execution is complete.
Must be called after Execute-OperationSet to wait for async completion.
#>
function Poll-OperationSetCompletion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TargetClient,

        [Parameter(Mandatory = $true)]
        [string]$OperationSetId,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    Write-Verbose "Polling OperationSet completion: $OperationSetId"

    $maxWaitSeconds = $Config.pollingSettings.maxPollingWaitMinutes * 60
    $pollingIntervalSeconds = $Config.pollingSettings.operationSetPollingIntervalSeconds
    $elapsedSeconds = 0

    $uri = "$($TargetClient.Config.organizationUrl)/api/data/v9.2/msdyn_operationsets('$OperationSetId')?`$select=msdyn_status"

    try {
        while ($elapsedSeconds -lt $maxWaitSeconds) {
            $response = Invoke-WebApiRequest -Client $TargetClient -Uri $uri -Method Get -RetryPolicy $Config.retrySettings

            $status = $response.msdyn_status

            Write-Verbose "OperationSet status: $status"

            # Status codes: 0 = Not Started, 1 = In Progress, 2 = Completed, 3 = Failed
            if ($status -eq 2) {
                Write-Verbose "OperationSet completed successfully"
                return $true
            }
            elseif ($status -eq 3) {
                throw "OperationSet execution failed. Status: $status"
            }

            # Wait before next poll
            Start-Sleep -Seconds $pollingIntervalSeconds
            $elapsedSeconds += $pollingIntervalSeconds
        }

        throw "OperationSet polling timeout after $maxWaitSeconds seconds"
    }
    catch {
        Write-Error "Failed polling OperationSet: $_"
        throw
    }
}

# Export public functions
Export-ModuleMember -Function @(
    'Import-Projects',
    'Import-SingleProject',
    'Create-OperationSet',
    'Add-OperationToSet',
    'Execute-OperationSet',
    'Poll-OperationSetCompletion'
)
