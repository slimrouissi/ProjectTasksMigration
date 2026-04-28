# Architecture and Design

## Project Structure

```
ProjectTasksMigration/Option2-CSharp/
├── ProjectMigration.csproj          # .NET 8 project file with NuGet references
├── Program.cs                        # CLI entry point with System.CommandLine
├── appsettings.example.json         # Configuration template
├── appsettings.json                 # Configuration (created by user, in .gitignore)
├── README.md                         # User guide and documentation
├── MIGRATION-GUIDE.md               # Step-by-step migration walkthrough
├── ARCHITECTURE.md                  # This file
├── .gitignore                       # Git ignore patterns
│
├── Models/
│   └── ProjectData.cs               # All data models and configuration classes
│
├── Services/
│   ├── DataverseClient.cs           # OAuth2 auth, Web API wrapper, retry logic
│   ├── ExportService.cs             # Exports from source environment
│   ├── ImportService.cs             # Imports to target using Schedule API
│   ├── GuidMappingService.cs        # GUID mapping and persistence
│   └── CustomFieldMapper.cs         # Maps custom fields between environments
│
├── exported_data/                   # (Created at runtime)
│   ├── <projectid>_export.json      # One per exported project
│   └── guid_mappings.json           # Persistent GUID mappings
│
├── logs/                            # (Created at runtime)
│   └── migration_YYYY-MM-DD_HH-mm-ss.log
│
└── publish/                         # (Created by dotnet publish)
    └── ProjectMigration.exe
```

## Class Architecture

### Program.cs (Entry Point)

Handles CLI commands using System.CommandLine:

```
Program.Main()
  ├─ validate command
  │   └─ Tests connectivity to both environments
  ├─ export command
  │   ├─ Optional project filter
  │   └─ Calls ExportService
  ├─ import command
  │   ├─ Optional dry-run
  │   ├─ Optional resume from saved mappings
  │   └─ Calls ImportService
  └─ migrate command
      └─ Chains export → import
```

**Responsibilities**:
- Parse command-line arguments
- Load and validate configuration
- Configure Serilog logging
- Orchestrate high-level workflow
- Report summary statistics

### DataverseClient (Services/DataverseClient.cs)

Wrapper around Dataverse Web API with OAuth2 authentication.

```
DataverseClient
  ├─ GetAccessTokenAsync()           # Acquire/refresh JWT token via MSAL
  ├─ GetAsync()                      # GET request with retry
  ├─ PostAsync()                     # POST request with retry
  ├─ PostAsyncString()               # POST returning string (for actions)
  ├─ PatchAsync()                    # PATCH request with retry
  ├─ DeleteAsync()                   # DELETE request with retry
  ├─ QueryAsync()                    # FetchXml query with pagination
  └─ ExecuteWithRetryAsync()         # Exponential backoff retry logic
```

**Features**:
- OAuth2 client credentials flow (MSAL library)
- Automatic token refresh (5-minute buffer)
- Exponential backoff retry (configurable)
- HTTP 429 rate limiting handling
- FetchXml pagination (odata.maxpagesize=5000)

**Example Usage**:
```csharp
var response = await client.PostAsync("msdyn_projects",
  new { msdyn_projectname = "New Project" });
var projectId = response["msdyn_projectid"].Value<Guid>();
```

### ExportService (Services/ExportService.cs)

Reads from source Dynamics 365 environment.

```
ExportService
  ├─ ExportProjectsAsync()           # Main entry point
  │   └─ ExportProjectAsync()        # Per-project export
  │       ├─ ExportTasksAsync()
  │       ├─ ExportTeamMembersAsync()
  │       ├─ ExportBucketsAsync()
  │       ├─ ExportDependenciesAsync()
  │       └─ ExportAssignmentsAsync()
  └─ MapEntityAsync()                # Convert JObject to model
```

**Fetching Strategy**:
- Uses FetchXml for efficient querying
- Pagination: max 5000 records per page
- Parallel task execution for performance
- Maps JObject responses to strongly-typed models

**Ordering**:
- Tasks sorted by `msdyn_outlinelevel` then `msdyn_sequencenumber`
- Ensures parent tasks come before children

**Output**:
- `ProjectExport` object with all related entities
- JSON file per project: `<projectid>_export.json`
- `GuidMappingService` tracks old IDs

### ImportService (Services/ImportService.cs)

Writes to target Dynamics 365 using Schedule API.

```
ImportService
  ├─ ImportProjectAsync()            # Main entry point per project
  │   ├─ CreateProjectAsync()        # Direct POST to create project
  │   ├─ ImportSchedulingEntitiesAsync()
  │   │   └─ ExecuteOperationSetsAsync()
  │   │       ├─ CreateOperationSetAsync()    # msdyn_CreateOperationSetV1
  │   │       ├─ AddOperationToSetAsync()     # msdyn_PssCreateV1
  │   │       ├─ ExecuteOperationSetAsync()   # msdyn_ExecuteOperationSetV1
  │   │       └─ PollOperationSetCompletionAsync()
  │   └─ ImportDependenciesAndAssignmentsAsync()
  │       └─ ExecuteOperationSetsAsync() (second batch)
  └─ Helper methods for creating operations
```

**Why Schedule API?**

The Schedule API (OperationSet) is required because:
- Direct Web API cannot create scheduling entities correctly
- It handles task hierarchy and constraints properly
- Batches operations for atomic transactions
- Manages scheduling engine consistency

**OperationSet Flow**:

```
1. msdyn_CreateOperationSetV1
   └─ Returns: { operationsetid: <guid> }

2. Loop: msdyn_PssCreateV1 (add each operation)
   ├─ Entity: msdyn_projecttask
   ├─ Entity: msdyn_projectteam
   ├─ Entity: msdyn_projectbucket
   └─ Up to BatchSize operations

3. msdyn_ExecuteOperationSetV1
   └─ Triggers execution

4. Poll msdyn_operationsets
   └─ Check statuscode: 1=Pending, 2=Completed, 3=Failed
```

**Two-Phase Import**:

Phase 1: Tasks, Team Members, Buckets
- Requires project to exist first
- Must handle task hierarchy (parents before children)

Phase 2: Dependencies, Assignments
- Requires tasks to exist first
- Uses remapped GUIDs from Phase 1

### GuidMappingService (Services/GuidMappingService.cs)

Tracks mapping of source GUIDs to target GUIDs.

```
GuidMappingService
  ├─ AddMapping(oldGuid, newGuid)    # Record a mapping
  ├─ GetNewGuid(oldGuid)             # Lookup mapped GUID
  ├─ IsMapped(oldGuid)               # Check if exists
  ├─ GetAllMappings()                # Get all mappings
  ├─ SaveMappingsAsync()             # Persist to JSON
  └─ LoadMappings()                  # Load from JSON
```

**Persistence**:
- File: `guid_mappings.json`
- Format: `{ "<oldGuid>": "<newGuid>" }`
- Auto-loaded on initialization
- Auto-saved after successful import

**Use Cases**:
- Remap parent task IDs in child tasks
- Remap lookup field references
- Remap team member IDs in assignments
- Resume capability: load previous mappings

### CustomFieldMapper (Services/CustomFieldMapper.cs)

Maps custom fields from source to target environment.

```
CustomFieldMapper
  ├─ MapCustomFields(sourceEntity, entityType)
  │   └─ MapFieldValue(fieldName, value, mapping)
  │       ├─ Text/Number: Direct copy
  │       ├─ Lookup: Remap GUID via GuidMappingService
  │       └─ OptionSet: Value mapping via dictionary
  └─ IsSystemField(fieldName) # Filter built-in fields
```

**Configuration** (from `appsettings.json`):

```json
"CustomFieldMappings": [
  {
    "SourceFieldLogicalName": "msdyn_customfield1",
    "TargetFieldLogicalName": "msdyn_customfield1",
    "FieldType": "Text",
    "ValueMappings": {}
  }
]
```

**Field Types**:
- `Text`: Copied directly
- `Number`, `Double`, `Integer`: Type conversion
- `DateTime`: Passed through
- `Boolean`: Converted to bool
- `Lookup`: GUID remapped
- `OptionSet`: Value mapped via dictionary

**Unmapped Fields**:
- Logged as warning (once per field)
- Not included in target
- Migration continues

### Models (Models/ProjectData.cs)

Strongly-typed data models.

**Entity Models**:
- `ProjectEntity`
- `TaskEntity`
- `TeamMemberEntity`
- `DependencyEntity`
- `AssignmentEntity`
- `BucketEntity`

**Container Model**:
- `ProjectExport` (groups all entities)

**Operation Models**:
- `OperationSetOperation` (for Schedule API)
- `OperationSetResponse`
- `ExecuteOperationSetResponse`

**Configuration Models**:
- `AppConfiguration` (root)
- `EnvironmentConfig`
- `MigrationConfig`
- `RetryPolicyConfig`
- `CustomFieldMapping`
- `LoggingConfig`

**Result Models**:
- `MigrationResult` (single project)
- `MigrationSummary` (all projects)

## Data Flow Diagrams

### Export Data Flow

```
Source D365 (Web API)
       ↓
DataverseClient
       ↓
ExportService
       ├─ QueryAsync (projects, tasks, teams, etc.)
       └─ MapEntity methods
       ↓
ProjectExport objects
       ↓
CustomFieldMapper
       ├─ Filter unmapped fields
       ├─ Remap lookup GUIDs
       └─ Map optionset values
       ↓
JSON serialization
       ↓
exported_data/<projectid>_export.json
       ↓
GuidMappingService
       └─ guid_mappings.json (empty at this point)
```

### Import Data Flow

```
exported_data/<projectid>_export.json
       ↓
JSON deserialization
       ↓
ProjectExport object
       ↓
ImportService.ImportProjectAsync()
       │
       ├─ Phase 1: Create project
       │      ↓
       │   CreateProjectAsync (direct POST)
       │      ↓
       │   Target D365 (Web API)
       │      ↓
       │   Project GUID returned
       │      ↓
       │   GuidMappingService.AddMapping()
       │
       ├─ Phase 2: Create scheduling entities
       │      ↓
       │   CreateOperationSetAsync
       │      ↓
       │   OperationSet created
       │      ↓
       │   AddOperationToSetAsync (tasks, teams, buckets)
       │      ↓
       │   Batch up to BatchSize
       │      ↓
       │   ExecuteOperationSetAsync
       │      ↓
       │   Target D365 (Schedule API)
       │      ↓
       │   PollOperationSetCompletionAsync (statuscode=2)
       │
       └─ Phase 3: Create dependencies & assignments
              ↓
           (Same as Phase 2, different entities)
              ↓
           GuidMappingService.SaveMappingsAsync()
              ↓
           guid_mappings.json (updated)
              ↓
           MigrationResult returned
```

## Error Handling Strategy

### Retry Logic

```
ExecuteWithRetryAsync<T>()
  └─ Loop:
     ├─ Attempt operation
     ├─ On success: return result
     ├─ On HttpRequestException:
     │  ├─ attempt < maxRetries?
     │  │  ├─ Yes: wait, double delay, retry
     │  │  └─ No: rethrow
     │  └─ Log warning with backoff info
     └─ Max delay capped at MaxDelaySeconds
```

**Configuration**:
```json
"RetryPolicy": {
  "MaxRetries": 3,
  "BaseDelaySeconds": 1,
  "MaxDelaySeconds": 30,
  "BackoffMultiplier": 2.0
}
```

**Schedule**: 1s → 2s → 4s (all capped at 30s)

### Rate Limiting (HTTP 429)

```
SendHttpRequestAsync()
  └─ response.StatusCode == 429?
     ├─ Yes: read Retry-After header
     │       wait recommended time
     │       retry request
     └─ No: return response
```

### Per-Project Error Handling

```
ImportProjectAsync()
  └─ try
     ├─ Create project
     ├─ Import entities
     └─ Set result.Success = true
  └─ catch Exception ex
     ├─ result.Success = false
     ├─ result.ErrorMessage = ex.Message
     ├─ Log error
     └─ (rethrow or continue based on config)
```

**Configuration**:
```json
"Migration": {
  "ContinueOnProjectError": true
}
```

## Performance Considerations

### Parallel Operations

Export service fetches related entities in parallel:
```csharp
await Task.WhenAll(tasksTasks, teamTasks, bucketsTasks);
```

Import service batches operations to reduce round-trips.

### Pagination

Both export and import use pagination:
- `$top=5000` for export queries
- Batches of up to 200 operations per OperationSet

### Caching

GuidMappingService maintains in-memory dictionary:
- Fast lookups: O(1)
- Saved to file for persistence

### Logging

Uses Serilog with structured logging:
- Minimal overhead in production (Information level)
- Detailed diagnostics available (Debug level)
- File rolling interval: Daily
- File retention: 30 days

## Security Architecture

### Authentication

- **MSAL (Microsoft.Identity.Client)**: OAuth2 client credentials
- **Scope**: `.default` for Dynamics CRM
- **Token**: 60-minute expiration with 5-minute refresh buffer

### Configuration

- Secrets stored in `appsettings.json` (user responsibility)
- Not committed to source control (.gitignore)
- Should be in secure vault in production

### Audit Trail

- D365 logs all API calls by the application user
- Audit enabled for project/task entities
- Operations logged with timestamp and user
- Can review in D365 audit logs

## Testing Strategy

### Unit Testing (Not Included)

Recommended tests:
- DataverseClient retry logic
- CustomFieldMapper field type conversion
- GuidMappingService persistence
- OperationSet operation generation

### Integration Testing

Manual testing approach:
1. Export small project
2. Review JSON output
3. Dry-run import
4. Verify in D365

### Load Testing

For large migrations (190 projects):
1. Test with BatchSize variations
2. Monitor target environment performance
3. Adjust PollingIntervalSeconds

## Deployment

### Development

```bash
dotnet build
dotnet run -- validate
```

### Production

```bash
dotnet publish --configuration Release --output ./publish
cd publish
./ProjectMigration.exe migrate
```

### CI/CD Integration

Tool can be integrated into pipelines:
```yaml
- task: DotNetCoreCLI@2
  inputs:
    command: 'build'
    arguments: '--configuration Release'

- task: DotNetCoreCLI@2
  inputs:
    command: 'run'
    arguments: 'migrate --config $(config_file)'
```

## Extensibility

### Adding New Entity Types

1. Create model in `Models/ProjectData.cs`
2. Add fetch method to `ExportService`
3. Add create operation method to `ImportService`
4. Add to `ProjectExport.cs`

### Adding New Field Types

In `CustomFieldMapper.MapFieldValue()`:
```csharp
return mapping.FieldType.ToLower() switch
{
  "mynewtype" => MapMyNewType(fieldName, value, mapping),
  // ...
};
```

### Custom Error Handling

Extend `ImportService.ImportProjectAsync()`:
```csharp
catch (SpecificException ex)
{
  // Custom handling
}
```

---

**See Also**:
- README.md - User guide
- MIGRATION-GUIDE.md - Step-by-step walkthrough
- appsettings.example.json - Configuration reference
