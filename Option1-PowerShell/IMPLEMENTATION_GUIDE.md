# Dynamics 365 Project Operations Migration - Implementation Guide

Quick reference guide for executing the migration tool for BDO's ~190 projects scenario.

## Quick Start (5 Steps)

### 1. Gather Credentials

You'll need the following information for each environment (source and target):

```
Source Environment:
  - Organization URL (e.g., https://sourceorg.crm.dynamics.com)
  - Azure AD Tenant ID
  - App Registration Client ID
  - App Registration Client Secret

Target Environment:
  - Organization URL (e.g., https://targetorg.crm.dynamics.com)
  - Azure AD Tenant ID
  - App Registration Client ID
  - App Registration Client Secret
```

Don't have these yet? Run:
```powershell
./Setup-AzureAD.ps1
```

### 2. Create Configuration

```powershell
Copy-Item config.example.json config.json
# Edit config.json with your credentials and settings
```

### 3. Validate Configuration

```powershell
./Validate-Config.ps1 -ConfigPath "./config.json"
```

Expected output:
```
Configuration Validation Complete
Summary:
  Source Environment: https://source.crm.dynamics.com
  Target Environment: https://target.crm.dynamics.com
  Configuration Status: VALID
```

### 4. Test with Export Only

```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ExportOnly
```

This exports all projects to JSON for inspection. Location: `./exports/export_YYYY-MM-DD_HH-MM-SS/`

### 5. Run Full Migration

```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json"
```

## File Structure

```
ProjectTasksMigration/Option1-PowerShell/
├── config.example.json              # Configuration template
├── config.json                       # Your actual config (create this)
├── Migrate-AllProjects.ps1          # Main orchestrator (run this)
├── Connect-Environments.ps1         # Authentication module
├── Export-Projects.ps1              # Export module
├── Import-Projects.ps1              # Import module
├── Validate-Config.ps1              # Configuration validator
├── Setup-AzureAD.ps1                # Azure AD setup guide
├── README.md                         # Full documentation
└── IMPLEMENTATION_GUIDE.md          # This file
```

## Configuration Reference

### Minimal config.json

```json
{
  "sourceEnvironment": {
    "organizationUrl": "https://source.crm.dynamics.com",
    "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "clientSecret": "your-secret-here"
  },
  "targetEnvironment": {
    "organizationUrl": "https://target.crm.dynamics.com",
    "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "clientSecret": "your-secret-here"
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
  "customFieldMappings": [],
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

## Common Scenarios

### Scenario 1: Migrate All Projects

```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json"
```

**Duration**: ~1-3 hours for 190 projects
**Output**: Logs in `./logs/`

### Scenario 2: Test Migration with Subset

```powershell
# Migrate only projects with "TEST" in name
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ProjectFilter "TEST"
```

### Scenario 3: Export for Inspection

```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ExportOnly
```

**Output**: `./exports/export_[timestamp]/`

Then inspect the JSON files before importing.

### Scenario 4: Reimport from Previous Export

```powershell
# Use the export from Scenario 3
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ImportOnly -ExportPath "./exports/export_2024-01-15_10-30-45"
```

### Scenario 5: Skip Specific Projects

Edit `config.json`:

```json
"migration": {
  "skipProjects": ["Legacy Project", "Test Project", "Project X"]
}
```

Then run migration normally.

## Monitoring & Troubleshooting

### Watch Progress

Migration runs with real-time console output showing:
- Current project being processed
- Progress percentage
- Entity counts (tasks, dependencies, etc.)
- Success/failure status

### Check Logs During Migration

While migration runs:
```powershell
Get-Content -Path "./logs/migration_*.log" -Wait
```

### After Migration

Check summary:
```powershell
Get-Content "./logs/migration_summary_*.json" | ConvertFrom-Json
```

### Common Issues

#### Error: "401 Unauthorized"

**Cause**: Invalid App Registration credentials

**Solution**:
1. Verify `clientId`, `clientSecret`, `tenantId` in config.json
2. Check App Registration hasn't expired
3. Confirm OAuth2 token endpoint is reachable

```powershell
# Validate directly
./Validate-Config.ps1 -ConfigPath "./config.json"
```

#### Error: "OperationSet polling timeout"

**Cause**: OperationSet execution took too long

**Solution**: Increase polling timeout in config.json:
```json
"pollingSettings": {
  "maxPollingWaitMinutes": 60
}
```

#### Error: "Parent task not found"

**Cause**: Parent task creation failed

**Solution**:
1. Check task hierarchy in export JSON
2. Look for task creation failures in logs
3. Verify no custom validation rules are blocking tasks

#### Progress Stuck

**Solution**:
1. Check for network issues
2. Look at logs for specific error
3. Consider reducing `operationSetMaxSize` to 100 or 50:
   ```json
   "batchSettings": {
     "operationSetMaxSize": 100
   }
   ```

## Performance Tuning

For 190 projects (~1000+ tasks):

### Recommended Settings

```json
{
  "batchSettings": {
    "operationSetMaxSize": 200,    # Max for Schedule API
    "pageSize": 5000,              # Max for Dataverse
    "maxConcurrentProjects": 1     # Sequential for stability
  },
  "retrySettings": {
    "maxRetries": 3,
    "initialDelaySeconds": 5,
    "maxDelaySeconds": 60,
    "exponentialBackoffMultiplier": 2.0
  },
  "pollingSettings": {
    "operationSetPollingIntervalSeconds": 10,
    "maxPollingWaitMinutes": 30
  }
}
```

### If Migration is Slow

1. Increase polling interval:
   ```json
   "operationSetPollingIntervalSeconds": 5
   ```

2. Reduce batch size if errors increase:
   ```json
   "operationSetMaxSize": 100
   ```

### If Errors Increase

1. Reduce batch size:
   ```json
   "operationSetMaxSize": 100
   ```

2. Increase retry delays:
   ```json
   "initialDelaySeconds": 10,
   "maxDelaySeconds": 120
   ```

## Validation Checklist

Before running migration:

- [ ] Both source and target D365 environments are online
- [ ] App Registrations created in Azure AD
- [ ] Application users created in both D365 environments
- [ ] Application users have Project Manager role assigned
- [ ] config.json created with correct credentials
- [ ] Validate-Config.ps1 passes all checks
- [ ] Export-only mode runs successfully
- [ ] Tested with small project subset
- [ ] Backups of both environments created
- [ ] No users making changes to projects in either environment

## Post-Migration Checklist

After successful migration:

- [ ] Verify entity counts match between source and target
- [ ] Spot-check 10-15 projects for data accuracy
- [ ] Verify task hierarchies (parents, children)
- [ ] Check task dependencies are correct
- [ ] Verify resource assignments
- [ ] Test project scheduling calculations
- [ ] Confirm custom fields migrated correctly
- [ ] Check any outlook integration still works
- [ ] Archive export JSON files
- [ ] Update documentation

## Log Files

Logs are saved to the path specified in config.json (default: `./logs/`)

### Main Log Files

- `migration_YYYY-MM-DD_HH-MM-SS.log` - Main migration log
- `migration_summary_YYYY-MM-DD_HH-MM-SS.json` - Summary statistics

### Per-Project Logs

Located in `import_[timestamp]/[ProjectName]/`:
- `guid_mappings.txt` - Old GUID → New GUID mappings
- `summary.json` - Project import summary
- `error.json` - Any errors encountered

## Data Validation

### Export Data Structure

Each project's JSON contains:
```json
{
  "project": { /* project data */ },
  "teamMembers": [ /* team members */ ],
  "tasks": [ /* tasks with parent references */ ],
  "taskDependencies": [ /* predecessor -> successor */ ],
  "resourceAssignments": [ /* task -> resource */ ],
  "buckets": [ /* swim lanes */ ],
  "exportTimestamp": "2024-01-15T10:30:45Z",
  "sourceOrgUrl": "https://source.crm.dynamics.com"
}
```

### Verify Export Integrity

```powershell
# Count projects exported
(Get-ChildItem "./exports/export_*/*/project_data.json").Count

# Verify each JSON is valid
Get-ChildItem "./exports/export_*/*/project_data.json" | ForEach-Object {
  Try {
    Get-Content $_.FullName -Raw | ConvertFrom-Json | Out-Null
    Write-Host "✓ $($_.Directory.Parent.Name)" -ForegroundColor Green
  }
  Catch {
    Write-Host "✗ $($_.Directory.Parent.Name) - Invalid JSON" -ForegroundColor Red
  }
}
```

## Rollback Plan

If migration fails:

1. **During Export**: No changes to either environment; safe to re-run
2. **During Import** (incomplete):
   - Target environment has partial projects
   - Can either:
     a. Delete partial projects and re-import (recommended)
     b. Try resuming import with same export
3. **After Successful Import**:
   - If issues found, restore target from backup
   - Re-migrate after fixing source data

## Security Best Practices

1. **Credentials**:
   - Never commit config.json to version control
   - Store secrets in secure vault
   - Delete client secret value after migration

2. **Access**:
   - Only authorized personnel should run migration
   - Application users should be restricted to minimal permissions needed
   - Audit logs should be reviewed post-migration

3. **Environments**:
   - Perform test run in non-production first
   - Ensure target environment is isolated until validation complete
   - Consider running in change window with approval

## Support Resources

1. **README.md** - Full documentation and API reference
2. **Validate-Config.ps1** - Troubleshoot connectivity issues
3. **Setup-AzureAD.ps1** - Interactive setup guide
4. **Log files** - Detailed error messages and audit trail

## Contact Information

For issues or questions:
1. Check README.md troubleshooting section
2. Review error logs in `./logs/` directory
3. Run `Validate-Config.ps1` to diagnose issues
4. Contact Dynamics 365 support if Schedule API issues persist

## Timeline Estimate

For 190 projects with ~1000+ tasks:

| Activity | Duration |
|----------|----------|
| Setup Azure AD | 15-30 min |
| Create App Registrations | 10-15 min |
| Create App Users in D365 | 10-15 min |
| Configure tool | 5-10 min |
| Validate configuration | 5 min |
| Export (ExportOnly mode) | 15-30 min |
| Review export | 15-30 min |
| Full migration (import) | 1-3 hours |
| Post-migration validation | 30-60 min |
| **Total** | **2.5-5 hours** |

## Success Criteria

Migration is successful when:

✓ All projects created in target environment
✓ All tasks created with correct hierarchy
✓ All dependencies linked correctly
✓ All team members assigned
✓ All resource assignments created
✓ Custom fields migrated
✓ Entity counts match source (within expected variance)
✓ No data corruption in target
✓ Project scheduling calculations work
✓ Logs show completion with no critical errors

---

**Version**: 1.0
**Last Updated**: 2024-01-15
**Tested With**: Project Operations 4.0+, PowerShell 7.0+
