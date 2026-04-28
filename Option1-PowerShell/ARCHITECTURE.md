# Migration Tool Architecture

Technical architecture and design decisions for the Dynamics 365 Project Operations migration tool.

## Overview

The migration tool uses a modular PowerShell architecture with a clear separation of concerns:

```
┌─────────────────────────────────────────────────────┐
│  Migrate-AllProjects.ps1 (Main Orchestrator)        │
├─────────────────────────────────────────────────────┤
│  Coordinates export, import, and reporting           │
└──────────┬──────────────────┬──────────────────┬─────┘
           │                  │                  │
    ┌──────▼──────┐  ┌────────▼──────┐  ┌───────▼────────┐
    │  Connect-   │  │   Export-     │  │   Import-      │
    │ Environments│  │  Projects.ps1 │  │  Projects.ps1  │
    └─────┬───────┘  └────┬──────────┘  └────┬───────────┘
          │               │                   │
    ┌─────▼───────────────▼───────────────────▼─────────┐
    │  Dataverse Web API (v9.2)                         │
    ├───────────────────────────────────────────────────┤
    │  - OAuth2 Token Endpoint                           │
    │  - GET /api/data/v9.2/msdyn_* (Query)            │
    │  - POST /api/data/v9.2/msdyn_* (Create)          │
    │  - POST /api/data/v9.2/msdyn_*V1 (Schedule API)  │
    └───────────────────────────────────────────────────┘
            │
    ┌───────▼────────────────────────────────────────┐
    │  Dynamics 365 Project Operations                │
    ├────────────────────────────────────────────────┤
    │  Source & Target Environments                   │
    └────────────────────────────────────────────────┘
```

## Module Design

### 1. Connect-Environments.ps1

**Responsibility**: Authentication and HTTP client management

**Key Functions**:
- `Connect-Environments`: Main entry point, authenticates to both environments
- `Get-AuthenticatedClient`: Acquires OAuth2 token and creates HTTP client
- `Refresh-Token`: Refreshes token if expiring
- `Invoke-WebApiRequest`: Makes authenticated HTTP requests with retry logic

**Design Patterns**:
- **Client Object Pattern**: Returns custom PowerShell object with:
  - `HttpClient`: Reusable HTTP client
  - `AccessToken`: Current bearer token
  - `TokenExpiry`: Token expiration time
  - `Config`: Environment configuration
  - `EnvironmentName`: Friendly name for logging

- **Retry Strategy**: Exponential backoff with configurable:
  - Max retries (default 3)
  - Initial delay (default 5 seconds)
  - Exponential multiplier (default 2.0)
  - Max delay cap (default 60 seconds)

**Error Handling**:
- 401 errors trigger token refresh
- 429 (rate limit) errors respect `Retry-After` header
- Other errors retry with exponential backoff
- Final attempt throws exception with full error context

---

### 2. Export-Projects.ps1

**Responsibility**: Extracting data from source environment

**Key Functions**:
- `Export-Projects`: Main export orchestrator
- `Get-Projects`: Queries all projects with pagination
- `Get-ProjectTeamMembers`: Queries team members per project
- `Get-ProjectTasks`: Queries tasks in hierarchical order
- `Get-TaskDependencies`: Queries task dependencies
- `Get-ResourceAssignments`: Queries resource assignments
- `Get-ProjectBuckets`: Queries project buckets

**Design Patterns**:

- **Pagination Handling**:
  ```powershell
  while ($uri) {
    $response = Invoke-WebApiRequest -Uri $uri -Method Get
    # Process results
    $uri = $response.'@odata.nextLink'  # Next page or null
  }
  ```
  Handles OData $top parameter (5000 records max) with automatic pagination

- **Custom Field Mapping**:
  - Dynamically includes custom fields from config
  - Builds `$select` clause at query time
  - Allows selective migration of custom fields

- **Hierarchical Task Ordering**:
  ```powershell
  $tasks | Sort-Object { [int]$_.msdyn_outlinelevel }, { [int]$_.msdyn_sequencenumber }
  ```
  Ensures parent tasks appear before children in export

- **Per-Project JSON Output**:
  ```
  exports/export_2024-01-15_10-30-45/
    ProjectName/
      project_data.json  # Contains all entities
  ```
  Enables:
  - Offline inspection
  - Selective re-import
  - Audit trail
  - Data validation

---

### 3. Import-Projects.ps1

**Responsibility**: Creating entities in target environment using Schedule API

**Key Functions**:
- `Import-Projects`: Main import orchestrator
- `Import-SingleProject`: Imports one project with all related entities
- `Create-Project`: Creates project via direct Dataverse API
- `Create-Buckets`: Creates buckets via OperationSet
- `Create-TeamMembers`: Creates team members via OperationSet
- `Create-Tasks`: Creates tasks in hierarchical order via OperationSet
- `Create-TaskDependencies`: Creates dependencies via OperationSet
- `Create-ResourceAssignments`: Creates assignments via OperationSet
- `Create-OperationSet`: Initializes OperationSet batch
- `Add-OperationToSet`: Adds operation to batch
- `Execute-OperationSet`: Submits batch for execution
- `Poll-OperationSetCompletion`: Waits for async completion

**Schedule API Integration**:

The Schedule API (OperationSet) is mandatory for scheduling entities because:
- Direct Dataverse writes to `msdyn_projecttask`, `msdyn_projecttaskdependency`, `msdyn_resourceassignment` bypass Project Scheduling Service
- This causes data inconsistency and calculation errors
- Schedule API ensures all business logic runs correctly

**OperationSet Workflow**:

1. **Create OperationSet**: `msdyn_CreateOperationSetV1` action
   ```
   Request: POST /api/data/v9.2/msdyn_CreateOperationSetV1
   Response: { OperationSetId: "guid" }
   ```

2. **Add Operations**: `msdyn_PssCreateV1` action (max 200 per set)
   ```
   Request: POST /api/data/v9.2/msdyn_PssCreateV1
   Body: {
     OperationSetId: "guid",
     Operation: {
       Operation: 1,  // Create
       Entity: {
         LogicalName: "msdyn_projecttask",
         KeyProperties: [],
         Data: { /* entity payload */ }
       }
     }
   }
   ```

3. **Execute**: `msdyn_ExecuteOperationSetV1` action (ASYNC)
   ```
   Request: POST /api/data/v9.2/msdyn_ExecuteOperationSetV1
   Body: { OperationSetId: "guid" }
   ```
   Returns immediately; execution happens asynchronously

4. **Poll Status**: Query `msdyn_operationset` entity
   ```
   Request: GET /api/data/v9.2/msdyn_operationsets('guid')?$select=msdyn_status
   Response: { msdyn_status: 2 }  // 2 = Completed
   ```
   Poll every 10 seconds (configurable) until complete

**GUID Mapping Strategy**:

Maintains hashtable of old GUID → new GUID:
```powershell
$guidMappings = @{
  "old-project-id" = "new-project-id"
  "old-task-id-1"  = "new-task-id-1"
  "old-task-id-2"  = "new-task-id-2"
}
```

Used for:
- Parent task references: `msdyn_parenttaskid`
- Task dependency links: `msdyn_predecessortaskid`, `msdyn_successortaskid`
- Resource assignments: `msdyn_projecttaskid`

**Batching Strategy**:

Operations are batched in groups of max 200:
```
Batch 1 (200 ops) → Execute → Poll
Batch 2 (200 ops) → Execute → Poll
Batch 3 (remaining) → Execute → Poll
```

This allows migrations of 1000+ tasks efficiently.

**Task Hierarchy Handling**:

Tasks are ordered by outline level before creation:
```powershell
$sortedTasks = $Tasks | Sort-Object msdyn_outlinelevel, msdyn_sequencenumber
```

This ensures:
1. Root tasks (level 0) created first
2. Level 1 tasks can reference parents (now created)
3. Level 2 tasks can reference parents
4. And so on...

---

## Data Flow

### Export Flow

```
config.json
    ↓
[Export-Projects.ps1]
    ├─→ Query msdyn_projects → Filter, paginate
    ├─→ Per project:
    │   ├─→ Query msdyn_projectteams
    │   ├─→ Query msdyn_projecttasks (ordered by outline level)
    │   ├─→ Query msdyn_projecttaskdependencies
    │   ├─→ Query msdyn_resourceassignments
    │   └─→ Query msdyn_projectbuckets
    └─→ Save as JSON per project

./exports/export_*/
    ├─→ ProjectA/project_data.json
    ├─→ ProjectB/project_data.json
    └─→ ProjectC/project_data.json
```

### Import Flow

```
./exports/export_*/
    ↓
[Import-Projects.ps1]
    ├─→ Per project JSON:
    │   ├─→ POST /msdyn_projects (direct API) → Create project
    │   │
    │   ├─→ msdyn_CreateOperationSetV1 → Create OperationSet ID
    │   ├─→ Loop: msdyn_PssCreateV1 (buckets) → Add operations
    │   ├─→ msdyn_ExecuteOperationSetV1 → Submit
    │   ├─→ Poll until msdyn_operationset.status = Completed
    │   │
    │   ├─→ msdyn_CreateOperationSetV1 → New OperationSet ID
    │   ├─→ Loop: msdyn_PssCreateV1 (team members) → Add operations
    │   ├─→ msdyn_ExecuteOperationSetV1 → Submit
    │   ├─→ Poll until complete
    │   │
    │   ├─→ msdyn_CreateOperationSetV1 → New OperationSet ID
    │   ├─→ Loop: msdyn_PssCreateV1 (tasks ordered by outline level)
    │   ├─→ msdyn_ExecuteOperationSetV1 → Submit
    │   ├─→ Poll until complete
    │   ├─→ Query created tasks to build GUID mappings
    │   │
    │   ├─→ msdyn_CreateOperationSetV1 → New OperationSet ID
    │   ├─→ Loop: msdyn_PssCreateV1 (dependencies with mapped GUIDs)
    │   ├─→ msdyn_ExecuteOperationSetV1 → Submit
    │   ├─→ Poll until complete
    │   │
    │   ├─→ msdyn_CreateOperationSetV1 → New OperationSet ID
    │   ├─→ Loop: msdyn_PssCreateV1 (assignments with mapped task GUIDs)
    │   ├─→ msdyn_ExecuteOperationSetV1 → Submit
    │   ├─→ Poll until complete
    │   │
    │   └─→ Log: GUID mappings, summary, errors
    │
    └─→ ./logs/import_*/
         ├─→ ProjectA/guid_mappings.txt
         ├─→ ProjectA/summary.json
         ├─→ ProjectB/guid_mappings.txt
         └─→ ...
```

---

## Error Handling Strategy

### Retry Levels

1. **HTTP Client Level** (`Invoke-WebApiRequest`):
   - Retries transient failures (5xx, 429, timeouts)
   - Exponential backoff with cap
   - Max 3 retries by default

2. **OperationSet Polling Level** (`Poll-OperationSetCompletion`):
   - Retries polling if status query fails
   - Polls until status = 2 (Completed) or timeout
   - Timeout: 30 minutes (configurable)

3. **Project Level** (`Import-SingleProject`):
   - Catches exceptions per project
   - Logs error and continues to next project
   - Returns success/failure status

4. **Summary Level** (`Import-Projects`):
   - Tracks failed projects
   - Reports summary statistics
   - Allows selective remediation

### Error Categories

| Error | Root Cause | Retry | Solution |
|-------|-----------|-------|----------|
| 401 | Invalid token | Yes | Refresh token |
| 403 | Insufficient permissions | No | Add security role |
| 404 | Entity not found | No | Check GUID mapping |
| 429 | Rate limited | Yes | Exponential backoff |
| 500+ | Server error | Yes | Retry with backoff |
| Timeout | Network/slow API | Yes | Increase delay |
| OperationSet failed | Schedule API error | No | Check logs, retry |
| Parent task missing | Creation failed | No | Manual remediation |

---

## Performance Characteristics

### Scalability

For 190 projects with ~1000+ tasks:

| Phase | Time | Bottleneck |
|-------|------|-----------|
| Export | 15-30 min | API query rate |
| Import (projects) | 1-5 min | Direct API calls |
| Import (OperationSets) | 1-2.5 hours | Async execution + polling |
| Validation | 30-60 min | Manual review |

**Total**: ~2-4 hours

### Optimization Levers

1. **Batch Size**: Increase `operationSetMaxSize` (max 200)
   - Risk: Some operations may fail silently
   - Benefit: Fewer execution cycles

2. **Polling Interval**: Decrease `operationSetPollingIntervalSeconds`
   - Risk: More API calls, potential rate limiting
   - Benefit: Faster completion detection

3. **Parallelization**: Run multiple projects concurrently
   - Risk: Rate limiting, connection pool exhaustion
   - Benefit: Potential 3-5x speedup
   - Not yet implemented (future enhancement)

---

## Security Model

### Authentication

- **OAuth2 Client Credentials Flow**:
  - No user interaction required
  - Suitable for automated scenarios
  - Token refreshed automatically
  - Secrets stored in config (MUST be protected)

### Authorization

- **Application Users**:
  - Created in D365 for each environment
  - Assigned Project Manager role (or custom)
  - Has Schedule API permissions
  - Scoped to migration tool use

- **Permissions Required**:
  - Read: All project entities
  - Create: All project entities
  - Execute: Schedule API actions
  - No Delete/Update permissions needed

### Secret Management

**Current**:
- Stored plaintext in config.json
- Should be protected (not in version control)

**Recommended**:
- Use Azure Key Vault
- Use PowerShell credential manager
- Use environment variables

Example with environment variable:
```powershell
$config.sourceEnvironment.clientSecret = $env:SOURCE_CLIENT_SECRET
```

---

## Testing Strategy

### Unit Tests (Manual)

```powershell
# Test authentication
$clients = Connect-Environments -SourceConfig $config.source -TargetConfig $config.target

# Test export
$projects = Get-Projects -Client $clients.Source -Config $config

# Test import
Import-SingleProject -TargetClient $clients.Target -ProjectData $projectData -Config $config
```

### Integration Tests

1. **Small Scale**: 5 projects, 10 tasks each
2. **Medium Scale**: 50 projects, 100 tasks each
3. **Full Scale**: 190 projects, 1000+ tasks

### Validation Tests

- Export/Import round-trip: Export → Import → Export → Compare
- GUID mapping integrity: Verify references point to correct entities
- Data type compatibility: Ensure field values map correctly
- Hierarchy validation: Verify task parent-child relationships

---

## Future Enhancements

### Planned

1. **Parallel Processing**: Process multiple projects concurrently
2. **Data Transformation**: Field mapping with formulas
3. **Validation Report**: Automated post-migration validation
4. **Resume Capability**: Continue from failed project
5. **Incremental Migration**: Update existing entities

### Possible

1. **Template Support**: Migrate project templates
2. **Resource Mapping**: Cross-tenant user mapping
3. **Calendar Sync**: Migrate calendar configurations
4. **Custom Entity Support**: Extend to other entities
5. **Web UI**: Web-based migration dashboard

---

## Dependency Graph

```
PowerShell 7.0+
  ├─→ System.Net.Http (built-in)
  │   └─→ OAuth2 token acquisition
  │   └─→ Web API calls
  │
  └─→ ConvertFrom-Json / ConvertTo-Json (built-in)
      └─→ JSON parsing

Config.json (user-provided)
  └─→ Environment URLs
  └─→ Azure AD credentials
  └─→ Batch settings
  └─→ Custom field mappings

D365 Environments (source + target)
  └─→ Project Operations 4.0+
  └─→ Schedule API enabled
  └─→ Application users configured
```

---

## File Size Estimates

For 190 projects with ~1000+ tasks:

| File | Size | Notes |
|------|------|-------|
| Single project JSON | 50-500 KB | Depends on complexity |
| Total export | 10-50 MB | Depends on project complexity |
| Migration logs | 5-20 MB | Verbose logging |
| GUID mappings | 1-5 MB | One per project |

---

## Monitoring & Observability

### Log Levels

- **Information**: Normal progress (default)
- **Verbose**: Detailed API calls
- **Error**: Failures and exceptions
- **Warning**: Non-fatal issues

Enable verbose:
```powershell
$VerbosePreference = "Continue"
./Migrate-AllProjects.ps1 -ConfigPath "./config.json"
```

### Metrics Tracked

- Projects exported/imported
- Tasks created
- Dependencies created
- Team members added
- Assignments created
- Success rate %
- Execution time
- Errors and failures

---

## Deployment Considerations

### Environment Requirements

- PowerShell 7.0+ (Windows, Linux, macOS)
- .NET Framework 4.7.2+ (Windows) or .NET 6+ (cross-platform)
- Network access to Azure AD and D365 APIs
- No firewall blocking HTTPS port 443

### Access Requirements

- Read access to source D365 environment
- Write access to target D365 environment
- Admin access to Azure AD (for app registration only)

### Change Management

- Approve migration in change control
- Schedule during maintenance window
- Have rollback plan ready
- Communicate to stakeholders

---

**Last Updated**: 2024-01-15
**Version**: 1.0
**Authors**: BDO Dynamics 365 Team
