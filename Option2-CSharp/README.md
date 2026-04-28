# Dynamics 365 Project Operations Migration Tool

A production-ready C# console application for migrating projects, tasks, dependencies, assignments, and custom fields between Dynamics 365 Project Operations environments using the Schedule API.

## Overview

This tool is designed to handle large-scale migrations of project data. It is built specifically for the Microsoft Schedule API (OperationSet) which is the only supported method for programmatic creation of scheduling entities in Dynamics 365 Project Operations.

### Key Features

- Export projects and all related entities from source environment
- Import with full Schedule API support for proper task hierarchy handling
- Custom field mapping with support for text, number, lookup, and optionset fields
- GUID mapping and tracking for entity references
- Comprehensive error handling and retry logic with exponential backoff
- Resume capability for interrupted migrations
- Dry-run mode for validation
- Structured logging to console and file
- Batch processing with configurable operation set sizes
- Support for ~190 projects with thousands of tasks

## Prerequisites

### System Requirements

- .NET 8.0 SDK or higher
- Windows, Linux, or macOS
- Network access to source and target Dynamics 365 environments

### Dynamics 365 Requirements

- Dynamics 365 Project Operations (both source and target environments)
- Administrator access to both environments
- Permissions to create Application Users

### Azure AD Requirements

- Access to Azure AD tenant
- Permissions to create Application Registrations
- Ability to grant API permissions

## Installation

### 1. Clone or Download the Project

```bash
git clone <repository-url>
cd ProjectTasksMigration/Option2-CSharp
```

### 2. Restore NuGet Packages

```bash
dotnet restore
```

### 3. Build the Project

```bash
dotnet build --configuration Release
```

### 4. Publish for Distribution (Optional)

```bash
dotnet publish --configuration Release --output ./publish
```

## Configuration

### Step 1: Create Application Registrations in Azure AD

You need to create **two separate Application Registrations** in Azure AD: one for the source environment and one for the target environment.

#### For Source Environment:

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations**
3. Click **New registration**
4. Fill in the details:
   - **Name**: `D365ProjectMigration-Source`
   - **Supported account types**: Single tenant (accounts in this organizational directory only)
5. Click **Register**
6. On the app's overview page, note the following:
   - **Application (client) ID** - save this as `ClientId`
   - **Directory (tenant) ID** - save this as `TenantId`

#### Create a Client Secret:

1. Under **Manage**, click **Certificates & secrets**
2. Click **New client secret**
3. Add description: `Migration Tool`
4. Set expiration: `24 months` (or as required by your policy)
5. Click **Add**
6. **Immediately copy the secret value** - you won't be able to see it again
7. Save this as `ClientSecret`

#### Grant API Permissions:

1. Under **Manage**, click **API permissions**
2. Click **Add a permission**
3. Select **Dynamics CRM**
4. Select **Delegated permissions**
5. Check `user_impersonation`
6. Click **Add permissions**
7. Click **Grant admin consent for [Your Organization]** and confirm

#### Repeat for Target Environment:

Create another Application Registration with the same steps, naming it `D365ProjectMigration-Target`.

### Step 2: Create Application Users in Dynamics 365

For **both source and target environments**:

1. Open Dynamics 365 as an administrator
2. Navigate to **Settings** → **Security** → **Users**
3. Click **New**
4. Set **User Type** to `Application user`
5. Fill in:
   - **User Name**: Use the Application ID from Azure AD (format: `00000000-0000-0000-0000-000000000000`)
   - **Email**: Any valid email address
6. Click **Save**
7. Assign security roles:
   - Click **Manage roles** (after saving)
   - Assign roles that grant access to project-related entities (typically: **Project Manager** or **Project Lead**)
   - For bulk operations, consider **System Administrator** (if allowed by policy)
8. Click **Save and Close**

### Step 3: Configure appsettings.json

1. Copy `appsettings.example.json` to `appsettings.json`:
   ```bash
   cp appsettings.example.json appsettings.json
   ```

2. Edit `appsettings.json` with your environment details:

```json
{
  "SourceEnvironment": {
    "Url": "https://your-source-org.crm.dynamics.com",
    "TenantId": "00000000-0000-0000-0000-000000000000",
    "ClientId": "00000000-0000-0000-0000-000000000000",
    "ClientSecret": "your-source-client-secret"
  },
  "TargetEnvironment": {
    "Url": "https://your-target-org.crm.dynamics.com",
    "TenantId": "00000000-0000-0000-0000-000000000000",
    "ClientId": "00000000-0000-0000-0000-000000000000",
    "ClientSecret": "your-target-client-secret"
  },
  "Migration": {
    "BatchSize": 200,
    "PollingIntervalSeconds": 5,
    "PollingMaxAttemptsPerOperationSet": 120,
    "ExportPath": "./exported_data",
    "LogPath": "./logs",
    "ContinueOnProjectError": true,
    "PreserveProjectCustomFields": true,
    "PreserveTaskCustomFields": true,
    "PreserveTeamMemberCustomFields": true
  },
  "RetryPolicy": {
    "MaxRetries": 3,
    "BaseDelaySeconds": 1,
    "MaxDelaySeconds": 30,
    "BackoffMultiplier": 2.0
  },
  "CustomFieldMappings": [
    {
      "SourceFieldLogicalName": "msdyn_customfield1",
      "TargetFieldLogicalName": "msdyn_customfield1",
      "FieldType": "Text"
    }
  ],
  "Logging": {
    "LogLevel": "Information",
    "IncludeTimestamps": true,
    "OutputTemplate": "{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level:u3}] {Message:lj}{NewLine}{Exception}"
  }
}
```

### Step 4: Configure Custom Field Mappings

If source and target environments have different custom field structures, map them in the `CustomFieldMappings` array:

#### Text/Number Fields:
```json
{
  "SourceFieldLogicalName": "msdyn_customfield1",
  "TargetFieldLogicalName": "msdyn_customfield1",
  "FieldType": "Text",
  "Description": "Customer name"
}
```

#### Lookup Fields (remaps GUIDs):
```json
{
  "SourceFieldLogicalName": "msdyn_lookupfield1",
  "TargetFieldLogicalName": "msdyn_lookupfield1",
  "FieldType": "Lookup",
  "Description": "Reference to customer"
}
```

#### OptionSet Fields (maps values):
```json
{
  "SourceFieldLogicalName": "msdyn_statusfield",
  "TargetFieldLogicalName": "msdyn_statusfield",
  "FieldType": "OptionSet",
  "ValueMappings": {
    "1": "1",
    "2": "3",
    "3": "2"
  },
  "Description": "Status with value remapping"
}
```

## Usage

### Validate Configuration and Connectivity

Test that the tool can connect to both environments:

```bash
dotnet run -- validate
```

Output will confirm connectivity to both source and target environments.

### Export Projects from Source

Export all projects:

```bash
dotnet run -- export
```

Export projects matching a filter (partial name match):

```bash
dotnet run -- export --project-filter "ACME"
```

This creates JSON files in `./exported_data/` with all project data.

### Import Projects to Target

Import all exported projects:

```bash
dotnet run -- import
```

Import in dry-run mode (validation without changes):

```bash
dotnet run -- import --dry-run
```

Resume after interruption (uses saved GUID mappings):

```bash
dotnet run -- import --resume
```

### Full Migration (Export + Import)

Complete migration in one command:

```bash
dotnet run -- migrate
```

With options:

```bash
dotnet run -- migrate --project-filter "ACME" --dry-run
```

Resume a full migration:

```bash
dotnet run -- migrate --resume
```

## How It Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Program.cs (CLI Entry Point)                                │
├─────────────────────────────────────────────────────────────┤
│ Handles: validate, export, import, migrate commands         │
└──────────┬──────────────────────────────────────────────────┘
           │
      ┌────┴────────────────────────────────────┐
      │                                          │
      v                                          v
┌─────────────────┐                    ┌──────────────────┐
│ ExportService   │                    │ ImportService    │
├─────────────────┤                    ├──────────────────┤
│ Reads from      │                    │ Writes to target │
│ source D365     │                    │ using Schedule   │
│ via Dataverse   │                    │ API (Operations) │
│ Web API         │                    │                  │
└────────┬────────┘                    └────────┬─────────┘
         │                                      │
         v                                      v
    ┌──────────────┐                   ┌─────────────────┐
    │ DataverseC   │                   │ GuidMappingServ │
    │ Client       │                   │ ice             │
    │ (Handles     │                   │ (Tracks old →   │
    │ auth, retry, │                   │ new GUIDs)      │
    │ rate limit)  │                   │                 │
    └──────┬───────┘                   └────────┬────────┘
           │                                    │
           v                                    v
    ┌──────────────┐                   ┌─────────────────┐
    │ CustomField  │                   │ JSON Files      │
    │ Mapper       │                   │ (export & guid  │
    │ (Maps 50+    │                   │ mappings for    │
    │ custom fields)                   │ resume)         │
    └──────────────┘                   └─────────────────┘
```

### Export Flow

1. Connect to source D365 environment via OAuth2
2. Query all projects using FetchXml with pagination
3. For each project:
   - Fetch project entity with custom fields
   - Fetch all tasks (sorted by outline level)
   - Fetch team members
   - Fetch task dependencies
   - Fetch resource assignments
   - Fetch project buckets
4. Map custom fields using configured mappings
5. Serialize all data to JSON files (one per project)
6. Save GUID mappings for import phase

### Import Flow

```
For each project:
  1. Create project entity (direct POST)
     ↓
  2. Open OperationSet #1
     ↓
  3. Add team members via msdyn_PssCreateV1
     ↓
  4. Add tasks in hierarchical order via msdyn_PssCreateV1
     ↓
  5. Execute OperationSet #1
     ↓
  6. Poll msdyn_operationsets until completed
     ↓
  7. Open OperationSet #2
     ↓
  8. Add task dependencies via msdyn_PssCreateV1
     ↓
  9. Add resource assignments via msdyn_PssCreateV1
     ↓
  10. Execute OperationSet #2
     ↓
  11. Poll msdyn_operationsets until completed
     ↓
  12. GUID mappings saved for next project
```

### Why Schedule API?

The Dataverse Web API alone cannot create scheduling entities correctly. The Schedule API (OperationSet) is the officially supported method because it:

- Handles task hierarchy (parent-child relationships) correctly
- Manages task sequencing and outline levels
- Prevents constraint violations in the scheduling engine
- Batches operations for performance
- Provides atomic transactions for related entities

Operations used:
- `msdyn_CreateOperationSetV1` - Create a new OperationSet
- `msdyn_PssCreateV1` - Add an operation to the set
- `msdyn_ExecuteOperationSetV1` - Execute all operations
- `msdyn_operationsets` - Query status via Web API

## Custom Field Mapping Details

### Text and Number Fields

These are copied directly without transformation:

```json
{
  "SourceFieldLogicalName": "new_customer_name",
  "TargetFieldLogicalName": "new_customer_name",
  "FieldType": "Text"
}
```

### Lookup Fields

If lookup targets exist in both environments but with different GUIDs, the tool remaps them:

```json
{
  "SourceFieldLogicalName": "new_account",
  "TargetFieldLogicalName": "new_account",
  "FieldType": "Lookup"
}
```

The tool:
1. Reads the source GUID
2. Looks up the new GUID from `GuidMappingService`
3. Uses the new GUID in the target environment

**Note**: This only works if you've migrated the referenced entities first.

### OptionSet Fields

Maps option values between environments (useful if option sets differ):

```json
{
  "SourceFieldLogicalName": "new_status",
  "TargetFieldLogicalName": "new_status",
  "FieldType": "OptionSet",
  "ValueMappings": {
    "100000000": "100000001",
    "100000001": "100000002",
    "100000002": "100000000"
  }
}
```

Unmapped fields are logged as warnings but don't stop the migration.

## Error Handling and Recovery

### Automatic Retry

The tool retries failed API calls with exponential backoff:
- First retry: 1 second delay
- Second retry: 2 seconds (backoff multiplier = 2.0)
- Third retry: 4 seconds
- Max delay: 30 seconds

Configure in `appsettings.json`:

```json
"RetryPolicy": {
  "MaxRetries": 3,
  "BaseDelaySeconds": 1,
  "MaxDelaySeconds": 30,
  "BackoffMultiplier": 2.0
}
```

### Rate Limiting (429 Responses)

The tool automatically handles HTTP 429 (Too Many Requests) by:
- Reading the `Retry-After` header from the response
- Waiting the recommended time
- Retrying the request

### Per-Project Error Handling

If a single project fails, the tool:
- Logs the error with details
- Continues with the next project (if `ContinueOnProjectError: true`)
- Reports failed projects in the summary

To stop on first error:

```json
"Migration": {
  "ContinueOnProjectError": false
}
```

### Resume After Interruption

If the migration is interrupted:

1. Check the log file to see which projects failed
2. Fix any issues (e.g., auth problems, quota exceeded)
3. Re-run with the `--resume` flag:

```bash
dotnet run -- migrate --resume
```

The resume flag:
- Loads previously saved GUID mappings
- Skips re-exporting (uses existing JSON files)
- Avoids re-creating projects that were successful
- Continues from where it left off

## Performance Tuning

### Batch Size

The `BatchSize` setting controls how many operations are in each OperationSet:

```json
"Migration": {
  "BatchSize": 200
}
```

- **Increase** for faster migrations (but may hit size limits)
- **Decrease** for stability if you get timeout errors

### Polling Interval

How often to check OperationSet completion:

```json
"Migration": {
  "PollingIntervalSeconds": 5,
  "PollingMaxAttemptsPerOperationSet": 120
}
```

Max wait time per OperationSet = 5 * 120 = 600 seconds (10 minutes)

For large batches, consider increasing `PollingIntervalSeconds` to 10-15.

### Logging Level

For production, use "Information" level:

```json
"Logging": {
  "LogLevel": "Information"
}
```

For debugging, use "Debug" or "Verbose" (generates large log files).

### Parallel Fetching

The export service fetches team members, tasks, and buckets in parallel:

```csharp
await Task.WhenAll(tasksTasks, teamTasks, bucketsTasks);
```

This is automatic and optimized per project.

## Troubleshooting

### "Failed to acquire access token"

**Cause**: Authentication credentials are incorrect or permissions are missing.

**Solution**:
1. Verify `ClientId` and `ClientSecret` in `appsettings.json`
2. Check that the Application Registration hasn't expired
3. Ensure the Application User exists in D365 (Settings → Security → Users)
4. Verify API permissions are granted (Dynamics CRM > user_impersonation)
5. Test with the `validate` command

### "OperationSet failed" or "statuscode: 3"

**Cause**: The OperationSet encountered a constraint violation or invalid data.

**Solution**:
1. Check the migration logs for detailed error messages
2. Verify custom field mappings are correct
3. Check that lookup field values exist in the target environment
4. Verify resource IDs and other references are valid
5. Reduce `BatchSize` to isolate the problematic operation
6. Try importing a smaller subset first

### "Did not complete within timeout"

**Cause**: The target environment is slow or the batch is too large.

**Solution**:
1. Increase `PollingMaxAttemptsPerOperationSet` or `PollingIntervalSeconds`
2. Reduce `BatchSize` to 100 or 50
3. Check target environment for performance issues
4. Run migration during off-peak hours
5. Check network connectivity

### "Invalid lookup field reference"

**Cause**: A lookup field points to a GUID that doesn't exist in the target environment.

**Solution**:
1. Ensure referenced entities are migrated first
2. Check that the GUID mapping is correct
3. Verify the lookup field configuration in custom field mappings
4. Consider excluding the field if it's not critical

### "File not found: appsettings.json"

**Cause**: Configuration file is missing.

**Solution**:
```bash
cp appsettings.example.json appsettings.json
# Edit with your environment details
```

### "Connection refused" or "timeout"

**Cause**: Cannot reach the Dynamics 365 environment.

**Solution**:
1. Verify the environment URL is correct and accessible
2. Check firewall and network policies
3. Ensure the application user has network access
4. Try connecting via a web browser to confirm the URL works
5. Check that the tenancy ID is correct

## Logging

All operations are logged to:
- **Console**: Real-time output
- **File**: `./logs/migration_YYYY-MM-DD_HH-mm-ss.log`

Log levels:
- `Verbose`: Ultra-detailed debugging information
- `Debug`: Detailed diagnostic data
- `Information`: General operational events
- `Warning`: Warning messages and potential issues
- `Error`: Errors with details
- `Fatal`: Unrecoverable errors

## Security Considerations

1. **Client Secrets**: Store in secure location, never commit to source control
2. **Configuration Files**: Don't share `appsettings.json` with secrets
3. **Log Files**: May contain sensitive data; store securely
4. **Application Users**: Use minimal required security roles
5. **Audit Trail**: D365 audit logs all activities by the application user

## Limitations

- Supports ~190 projects and thousands of tasks per migration
- Custom fields must be created in target environment before import
- Resource and team member references must exist in target environment
- Does not migrate attachments or notes by default
- Does not migrate historical data (completed projects, archived tasks)

## Support and Troubleshooting

For issues:
1. Check the log files in `./logs/`
2. Run `validate` command to test connectivity
3. Use `--dry-run` to test without making changes
4. Check D365 audit logs for rejected operations
5. Verify all prerequisites are met

## License

Copyright BDO. All rights reserved.

## Version

Version 1.0.0 - .NET 8.0
