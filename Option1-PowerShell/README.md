# Dynamics 365 Project Operations Migration Tool

A UAT-grade PowerShell-based migration tool for migrating Dynamics 365 Project Operations projects, tasks, dependencies, and resource assignments between environments using the Schedule API.

## Overview

This tool is designed specifically for large-scale migrations (BDO's ~190 projects scenario) with:

- **Schedule API Integration**: Uses the official Schedule API (OperationSet) for all scheduling entities
- **Comprehensive Entity Support**: Projects, tasks, dependencies, team members, resource assignments, buckets
- **Hierarchical Task Handling**: Preserves parent-child task relationships
- **Custom Field Mapping**: Maps custom fields between source and target
- **GUID Tracking**: Maintains old-to-new GUID mappings for entity references
- **Batch Processing**: Optimized batching (max 200 operations per OperationSet)
- **Retry Logic**: Exponential backoff retry handling for resilience
- **Async Polling**: Handles asynchronous OperationSet execution with polling
- **Comprehensive Logging**: Detailed logs for audit trail and troubleshooting

## Prerequisites

### System Requirements

- **PowerShell 7.0 or higher** (Windows PowerShell 5.1+ may work, but PS 7+ is recommended)
- **.NET Framework 4.7.2 or higher** (for HTTP client)
- **Windows, Linux, or macOS** (cross-platform support)

### Dynamics 365 Project Operations Requirements

- Both source and target environments must be Dynamics 365 Project Operations instances
- Access to create **App Registrations** in Azure AD for both environments
- At least **two security roles** available in each environment:
  - One with sufficient permissions for application user (Project Manager or custom role with Schedule API access)
  - Note: Direct Dataverse writes to scheduling tables don't work; Schedule API is mandatory

### PowerShell Modules

The tool uses only standard PowerShell (no external modules required for core functionality):
- Built-in `Invoke-RestMethod` for HTTP calls
- Built-in `ConvertFrom-Json` / `ConvertTo-Json` for JSON handling

If you prefer, you can optionally install the **MSAL.PS** module for token acquisition, but the tool also supports direct REST API token endpoint calls.

## Setup Instructions

### Step 1: Create Azure AD App Registrations

You need to create **two separate App Registrations** in Azure AD (one for source environment, one for target).

#### For Source Environment:

1. Go to **Azure Portal** > **Azure Active Directory** > **App registrations** > **New registration**
2. Enter:
   - Name: `D365-ProjectMigration-Source`
   - Supported account types: `Accounts in this organizational directory only (Single tenant)`
3. Click **Register**
4. In the app overview, note the **Application (client) ID** and **Directory (tenant) ID**
5. Go to **Certificates & secrets** > **New client secret**
   - Description: `Migration Tool Secret`
   - Expires: Select appropriate duration
   - Copy the **Value** (secret) immediately - you won't see it again
6. Go to **API permissions** > **Add a permission** > **Dynamics CRM**
   - Select **user_impersonation**
   - Click **Add permissions**
7. Click **Grant admin consent for [Organization]**

#### For Target Environment:

Repeat the same steps above but name it `D365-ProjectMigration-Target`

### Step 2: Create Application Users in Dynamics 365

You must create application users in **both** source and target D365 environments.

#### In Source Environment:

1. Go to **Settings** > **Security** > **Users**
2. New > **Application User**
3. Fill in:
   - **Application ID**: Use the Application ID from your source App Registration
   - **First Name**: `Migration`
   - **Last Name**: `Tool`
   - **Primary Email**: Leave blank or use a placeholder
4. Save
5. Assign **Security Role**: `Project Manager` (or custom role with Schedule API permissions)
6. Save again

#### In Target Environment:

Repeat the same steps with the target App Registration's Application ID

### Step 3: Configure the Tool

1. Copy `config.example.json` to `config.json`:
   ```powershell
   Copy-Item config.example.json config.json
   ```

2. Edit `config.json` with your values:
   ```json
   {
     "sourceEnvironment": {
       "organizationUrl": "https://your-source-org.crm.dynamics.com",
       "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
       "clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
       "clientSecret": "your-source-app-secret-value"
     },
     "targetEnvironment": {
       "organizationUrl": "https://your-target-org.crm.dynamics.com",
       "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
       "clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
       "clientSecret": "your-target-app-secret-value"
     },
     "batchSettings": {
       "operationSetMaxSize": 200,
       "pageSize": 5000,
       "maxConcurrentProjects": 1
     },
     "retrySettings": {
       "maxRetries": 3,
       "initialDelaySeconds": 5,
       "maxDelaySeconds": 60,
       "exponentialBackoffMultiplier": 2.0
     },
     "pollingSettings": {
       "operationSetPollingIntervalSeconds": 10,
       "maxPollingWaitMinutes": 30,
       "statusCheckRetries": 5
     },
     "customFieldMappings": [
       {
         "sourceFieldName": "msdyn_custom_field_1",
         "targetFieldName": "msdyn_custom_field_1",
         "fieldType": "string",
         "isMapped": true
       }
     ],
     "logging": {
       "logPath": "./logs",
       "logLevel": "Information",
       "logToConsole": true,
       "logToFile": true
     },
     "migration": {
       "exportOnlyMode": false,
       "importOnlyMode": false,
       "resumeFromLastProject": true,
       "projectFilter": null,
       "skipProjects": []
     }
   }
   ```

3. **Key Configuration Explanations**:
   - `operationSetMaxSize`: Maximum operations per OperationSet (max 200)
   - `pageSize`: Records per query page (max 5000)
   - `projectFilter`: Filter projects by name substring (e.g., "BDO" to only migrate projects with "BDO" in name)
   - `skipProjects`: Array of project names to skip
   - `maxPollingWaitMinutes`: Timeout for waiting on OperationSet completion
   - `customFieldMappings`: Maps custom fields between environments

## Execution

### Full Migration (Export + Import)

```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json"
```

This will:
1. Export all projects from source environment
2. Import them to target environment
3. Generate summary report

### Export Only

Useful for validation, backup, or manual review before import:

```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ExportOnly
```

Exports to `./exports/export_YYYY-MM-DD_HH-MM-SS/`

### Import Only

For re-importing from a previous export:

```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ImportOnly -ExportPath "./exports/export_2024-01-15_10-30-45"
```

### Filter by Project

Migrate only specific projects:

```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ProjectFilter "ProjectName"
```

## Custom Field Mapping

The tool supports migrating custom fields defined in your organization.

### Setup Custom Field Mapping

1. Identify your custom fields in both environments
2. In `config.json`, add entries to `customFieldMappings`:

```json
"customFieldMappings": [
  {
    "sourceFieldName": "msdyn_custom_budget",
    "targetFieldName": "msdyn_custom_budget",
    "fieldType": "decimal",
    "isMapped": true
  },
  {
    "sourceFieldName": "msdyn_custom_status_code",
    "targetFieldName": "msdyn_custom_status_code",
    "fieldType": "optionset",
    "isMapped": true
  },
  {
    "sourceFieldName": "msdyn_legacy_field",
    "targetFieldName": "msdyn_new_field",
    "fieldType": "string",
    "isMapped": true
  }
]
```

- Set `isMapped: false` to skip fields you don't want migrated
- The tool will include mapped fields in both export and import
- Field type is informational only

## Understanding the Migration Process

### Export Phase

1. **Queries Projects**: Retrieves all projects (with filters applied)
2. **Exports Team Members**: Project team assignments
3. **Exports Tasks**: In hierarchical order (outline level + sequence)
4. **Exports Dependencies**: Predecessor/successor relationships
5. **Exports Assignments**: Resource allocations
6. **Exports Buckets**: Swim lanes/groupings
7. **Saves to JSON**: Per-project JSON files with all related data

Output structure:
```
exports/
  export_2024-01-15_10-30-45/
    Project A/
      project_data.json
    Project B/
      project_data.json
```

### Import Phase

The import process uses the Schedule API's OperationSet mechanism:

1. **Creates Project**: Direct Dataverse API (projects don't need OperationSet)
2. **Creates OperationSet**: Initializes a batch container via `msdyn_CreateOperationSetV1`
3. **Adds Operations**: For each entity:
   - Adds create operations via `msdyn_PssCreateV1`
   - Tracks GUID mappings (old ID → new ID)
   - Batches operations (max 200)
4. **Executes OperationSet**: Submits batch via `msdyn_ExecuteOperationSetV1` (async)
5. **Polls Completion**: Checks status until complete
6. **Creates Dependencies**: Second OperationSet batch for task dependencies
7. **Creates Assignments**: Third OperationSet batch for resource assignments

**Important**: Task parents must be created before children. The tool orders tasks by outline level to ensure this.

## GUID Mapping

The tool maintains a mapping of old GUIDs (source) to new GUIDs (target) to ensure:
- Task parent references point to correct new parent tasks
- Dependencies link correct task pairs
- Assignments target correct tasks

This mapping is stored in `logs/import_[timestamp]/[projectname]/guid_mappings.txt`

## Troubleshooting

### Error: "Failed to acquire access token"

**Cause**: Invalid credentials or Azure AD configuration

**Solution**:
1. Verify `clientId`, `clientSecret`, `tenantId` in config
2. Confirm App Registration exists in Azure AD
3. Check App Registration hasn't expired
4. Verify OAuth2 token endpoint is accessible from your network

### Error: "401 Unauthorized"

**Cause**: Application user not created in D365 or insufficient permissions

**Solution**:
1. Verify application user exists in both D365 environments
2. Check security role is assigned to application user
3. Ensure "Project Manager" role or custom role has Schedule API permissions
4. Wait a few minutes for role assignments to sync

### Error: "403 Forbidden"

**Cause**: Application user lacks necessary permissions

**Solution**:
1. In D365, go to **Settings** > **Security** > **Users**
2. Find the application user (named "Migration Tool")
3. Ensure **Project Manager** security role is assigned
4. Assign additional roles if needed for custom fields

### Error: "OperationSet polling timeout"

**Cause**: OperationSet took longer than expected to complete

**Solution**:
1. Increase `maxPollingWaitMinutes` in config (default 30)
2. Check D365 system health (may be under heavy load)
3. Review logs for specific entity creation failures
4. Try resuming with `-ImportOnly` mode to retry failed projects

### Error: "Parent task not found"

**Cause**: Parent task creation failed, but child task attempted to reference it

**Solution**:
1. Check previous operations in logs
2. Verify parent task was successfully created
3. Look for GUID mapping issues in logs
4. Run import with verbose logging: `$VerbosePreference = "Continue"`

### Error: "Task dependency reference not mapped"

**Cause**: Predecessor or successor task wasn't created

**Solution**:
1. Check logs for task creation failures
2. Verify both task IDs exist in `guid_mappings.txt`
3. Dependencies with missing tasks are skipped with a warning
4. Re-export and verify source data integrity

### Error: "Rate Limited (429)"

**Cause**: Too many requests to D365 in short time

**Solution**:
1. Reduce `pageSize` in config (default 5000)
2. Reduce `operationSetMaxSize` in config (default 200)
3. The tool has automatic exponential backoff, but increasing delays helps:
   ```json
   "retrySettings": {
     "initialDelaySeconds": 10,
     "maxDelaySeconds": 120
   }
   ```

### Logs Show "Task mappings not updated"

**Cause**: Query to get newly created task IDs failed

**Solution**:
1. Check network connectivity
2. Verify target project was created successfully
3. Check target environment isn't under maintenance
4. Review API response in logs

## Best Practices

### Before Migration

1. **Backup Both Environments**: Create manual backups of both source and target
2. **Test with Small Subset**: Use `projectFilter` to test with 5-10 projects first
3. **Validate Custom Fields**: Verify custom fields exist in target before adding to config
4. **Review Security Roles**: Ensure application users have correct permissions
5. **Check Capacity**: Ensure target environment has sufficient storage

### During Migration

1. **Monitor Logs**: Watch logs for errors or warnings
2. **Avoid Manual Changes**: Don't modify projects in either environment during migration
3. **Keep Config Backed Up**: Save your config.json in version control
4. **Document Mappings**: Keep GUID mappings for reference

### After Migration

1. **Validate Data**: Spot-check projects, tasks, and dependencies in target
2. **Verify Counts**: Compare entity counts between source and target
3. **Test Functionality**: Run project scheduling, assignments, etc.
4. **Archive Exports**: Keep export JSON files for audit trail
5. **Update Documentation**: Document any field mapping decisions

## Performance Optimization

For ~190 projects with thousands of tasks:

1. **Increase Batch Size**: Set `operationSetMaxSize` to 200 (if stable)
2. **Increase Page Size**: Set `pageSize` to 5000 (maximum)
3. **Parallel Execution**: Currently serial; contact support for parallel batching
4. **Network**: Ensure low-latency connection to D365 environments
5. **Timing**: Run during off-hours to minimize impact on concurrent users

Estimated migration time:
- ~1-3 hours for 190 projects depending on complexity
- Varies by task count, custom fields, and network latency

## Support and Debugging

### Enable Verbose Logging

In PowerShell:
```powershell
$VerbosePreference = "Continue"
./Migrate-AllProjects.ps1 -ConfigPath "./config.json"
```

This outputs detailed information about each API call.

### Export-Only Validation

Always run export-only first:
```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ExportOnly
```

Inspect JSON files to verify data before import.

### Check Logs

Logs are saved to path specified in `config.json` (`./logs` by default):
- `migration_YYYY-MM-DD_HH-MM-SS.log`: Main migration log
- `migration_summary_YYYY-MM-DD_HH-MM-SS.json`: Summary statistics
- `import_YYYY-MM-DD_HH-MM-SS/`: Per-import session logs
  - `[ProjectName]/guid_mappings.txt`: GUID mappings
  - `[ProjectName]/summary.json`: Project-specific summary
  - `[ProjectName]/error.json`: Any import errors

## Limitations and Known Issues

### Current Limitations

1. **Sequential Processing**: Projects are migrated one at a time (can be parallelized in future)
2. **No Data Transformation**: Field values are migrated as-is (no business logic transforms)
3. **User References**: Resource assignments migrate by user ID; cross-tenant scenarios require mapping
4. **Resource Calendars**: Calendar configurations not migrated (manual sync required)
5. **Project Templates**: Uses project name, not template (template IDs may differ)

### Known Issues

1. **Outlook Sync**: Outlook tasks may not sync immediately; can take 15-30 minutes
2. **Schedule Recalculation**: Project schedules may need manual recalculation post-import
3. **Custom Lookup Fields**: Lookup field references may require manual mapping if GUIDs differ
4. **Locale-Specific Fields**: Date/number formatting must match target environment locale

## API Reference

### Schedule API Actions Used

- **`msdyn_CreateOperationSetV1`**: Creates an OperationSet for batch processing
- **`msdyn_PssCreateV1`**: Adds a create operation to an OperationSet
- **`msdyn_ExecuteOperationSetV1`**: Executes all operations in a set (async)
- **`msdyn_operationset` entity**: Query status of execution

### Web API Endpoints Used

- `GET /api/data/v9.2/msdyn_projects`: Query projects
- `GET /api/data/v9.2/msdyn_projecttasks`: Query tasks
- `GET /api/data/v9.2/msdyn_projecttaskdependencies`: Query dependencies
- `GET /api/data/v9.2/msdyn_projectteams`: Query team members
- `GET /api/data/v9.2/msdyn_resourceassignments`: Query assignments
- `GET /api/data/v9.2/msdyn_projectbuckets`: Query buckets
- `POST /api/data/v9.2/msdyn_projects`: Create project

## Contact and Support

For issues, questions, or enhancements:
1. Check logs in `./logs/` directory
2. Review troubleshooting section above
3. Run export-only mode to validate data
4. Contact Dynamics 365 support if Schedule API issues persist

## License

Internal use only. Part of BDO Dynamics 365 Project Operations migration initiative.

## Version History

### v1.0 (Initial Release)
- Export: projects, tasks, dependencies, team members, assignments, buckets
- Import via Schedule API OperationSet
- Custom field mapping
- GUID tracking
- Retry logic with exponential backoff
- Async polling for OperationSet completion
- Comprehensive logging

---

**Last Updated**: 2024-01-15
**PowerShell Version**: 7.0+
**D365 Version**: Tested on Project Operations 4.0+
