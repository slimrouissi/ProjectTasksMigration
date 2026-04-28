# Step-by-Step Migration Guide

This guide walks through a complete migration of Dynamics 365 Project Operations projects.

## Phase 1: Pre-Migration Preparation

### Day 1: Environment Verification

1. **Verify Source Environment**
   - Log into source Dynamics 365 as an admin
   - Navigate to **Settings** → **Solutions**
   - Confirm **Project Operations** solution is installed
   - Note the exact URL for later configuration

2. **Verify Target Environment**
   - Same steps as source
   - Confirm it's a fresh or empty project structure
   - Note the exact URL for later configuration

3. **Identify Custom Fields**
   - In source, go to **Settings** → **Solutions** → **Default Solution**
   - Find all `msdyn_*` entities (project, projecttask, projectteam, etc.)
   - Document all custom fields:
     - Field logical name (e.g., `new_customfield`)
     - Data type (Text, Number, Lookup, OptionSet, etc.)
     - Whether it exists in target environment

4. **Create Custom Fields in Target**
   - For each custom field that doesn't exist in target:
     - Create it with the SAME logical name and data type
     - This must be done BEFORE migration

### Day 2: Azure AD Configuration

#### For Source Environment:

1. Open [Azure Portal](https://portal.azure.com)
2. Go to **Azure Active Directory** → **App registrations**
3. Click **New registration**
   - Name: `D365ProjectMigration-Source`
   - Account type: Accounts in this organizational directory only
4. Click **Register**
5. Note these values:
   - **Application ID** → `SourceEnvironment.ClientId`
   - **Directory ID** → `SourceEnvironment.TenantId`

6. Create client secret:
   - **Certificates & secrets** → **New client secret**
   - Description: `Migration Tool`
   - Expiration: `24 months`
   - Copy value → `SourceEnvironment.ClientSecret`
   - (Cannot be viewed again after closing!)

7. Grant API permissions:
   - **API permissions** → **Add a permission**
   - Select **Dynamics CRM**
   - Select **Delegated permissions**
   - Check `user_impersonation`
   - **Grant admin consent**

#### For Target Environment:

Repeat the same steps with name `D365ProjectMigration-Target`

### Day 3: Dynamics 365 Application Users

#### In Source Environment:

1. Open Dynamics 365 as an admin
2. **Settings** → **Security** → **Users**
3. **New** user:
   - **User Type**: Application user
   - **User Name**: (Use your source `SourceEnvironment.ClientId`)
   - **Email**: migration-source@yourdomain.com
   - **Full Name**: D365 Migration Source
4. Click **Save**
5. Click **Manage roles** (appears after saving)
6. Assign roles: **Project Manager** (or **System Administrator** for full permissions)
7. Click **Save and Close**

#### In Target Environment:

Same process using target `TargetEnvironment.ClientId`

### Day 4: Configure the Migration Tool

1. **Get the tool**:
   ```bash
   git clone <repo>
   cd ProjectTasksMigration/Option2-CSharp
   dotnet restore
   dotnet build --configuration Release
   ```

2. **Create configuration**:
   ```bash
   cp appsettings.example.json appsettings.json
   ```

3. **Edit appsettings.json** with your values:

   ```json
   {
     "SourceEnvironment": {
       "Url": "https://your-source-org.crm.dynamics.com",
       "TenantId": "<copied from Azure AD>",
       "ClientId": "<copied from Azure AD>",
       "ClientSecret": "<copied and saved securely>"
     },
     "TargetEnvironment": {
       "Url": "https://your-target-org.crm.dynamics.com",
       "TenantId": "<copied from Azure AD>",
       "ClientId": "<copied from Azure AD>",
       "ClientSecret": "<copied and saved securely>"
     },
     ...
   }
   ```

4. **Test connectivity**:
   ```bash
   dotnet run -- validate
   ```

   Expected output:
   ```
   Testing connection to source environment: https://...
   Source environment connection successful
   Testing connection to target environment: https://...
   Target environment connection successful
   All validation checks passed
   ```

## Phase 2: Test Migration

### Day 5: Dry Run with Small Sample

1. **Create test project in source**
   - With 5-10 tasks (2-3 levels deep)
   - 2-3 team members
   - 2-3 dependencies
   - 2-3 resource assignments
   - Some custom field values

2. **Export the project**:
   ```bash
   dotnet run -- export --project-filter "TEST"
   ```

   Check output:
   - Should create `exported_data/<projectid>_export.json`
   - Should log task count, team count, etc.

3. **Review the export file**:
   ```bash
   cat exported_data/<projectid>_export.json | jq '.' | less
   ```

   Verify:
   - Project data looks correct
   - Tasks have correct hierarchy (outline levels)
   - Team members are present
   - Custom fields are included

4. **Dry-run import**:
   ```bash
   dotnet run -- import --dry-run
   ```

   Expected output (no changes):
   ```
   DRY RUN: Would import 10 tasks, 3 team members, 2 dependencies, 3 assignments
   ```

5. **Real import to target**:
   ```bash
   dotnet run -- import
   ```

   Monitor the output:
   - Should create project, tasks, team members
   - Should complete in 1-2 minutes per project

6. **Verify in target Dynamics 365**
   - Navigate to Projects
   - Find the migrated project
   - Open it and verify:
     - All tasks are present
     - Task hierarchy is correct
     - Team members are assigned
     - Custom fields have values

### Day 6: Review and Adjust

1. **Check the logs**:
   ```bash
   tail -100 logs/migration_*.log
   ```

2. **If there are errors**:
   - Read the error message carefully
   - Common issues:
     - Custom field mappings incorrect
     - Lookup field references invalid
     - OptionSet value mappings wrong
   - Update `appsettings.json` and retry

3. **Performance observations**:
   - How long did the import take?
   - Adjust `BatchSize` if needed:
     - Increase for speed (up to 200)
     - Decrease for stability (down to 50)

4. **Clean up test data** (optional):
   - Delete from target to prepare for full run

## Phase 3: Full Migration

### Day 7: Export All Projects

```bash
dotnet run -- export
```

This creates:
- `exported_data/` directory with JSON files
- One file per project: `<projectid>_export.json`
- `guid_mappings.json` (empty at this point)

Typical output:
```
Found 190 projects to export
Exporting project 1/190: Project Alpha
...
Exporting project 190/190: Project Zulu
Export completed: 190 projects exported
```

**Time estimate**: 30-60 minutes for 190 projects (depends on size)

### Day 8: Dry-Run Full Migration

```bash
dotnet run -- import --dry-run
```

This simulates the import without making changes:

```
Found 190 project export files to import
Importing project 1/190: Project Alpha
DRY RUN: Would import 100 tasks, 5 team members, 20 dependencies, 15 assignments
...
Migration completed successfully
```

Review the totals:
- Expected number of projects?
- Expected number of tasks overall?
- Any anomalies?

### Day 9: Full Import

```bash
dotnet run -- import
```

**Do NOT interrupt this process** (or see "Resume After Failure" below)

Typical output:
```
Found 190 project export files to import
Importing project 1/190: Project Alpha
Successfully imported project Project Alpha: 100 tasks, 5 team members, 20 dependencies, 15 assignments
...

================== MIGRATION SUMMARY ==================
Total Duration: 04:32:10
Total Projects: 190
Successful: 190 (100.0%)
Failed: 0

Entities Created:
  - Tasks: 15,234
  - Team Members: 892
  - Dependencies: 4,156
  - Assignments: 8,903
======================================================
```

**Time estimate**: 2-4 hours for 190 projects with 15k+ tasks

## Phase 4: Validation and Cutover

### Day 10-11: Comprehensive Validation

#### In Target Dynamics 365:

1. **Count verification**:
   - Projects: Should match source count
   - Tasks: Check against export summary
   - Team Members: Verify assignments

2. **Spot checks** (select 10 random projects):
   - Open each project
   - Verify task hierarchy (parent-child relationships)
   - Verify task counts and names
   - Verify team member assignments
   - Verify custom field values

3. **Sample complex project**:
   - Select a project with deep hierarchy (5+ levels)
   - Verify outline levels are correct
   - Open Gantt view to verify scheduling

4. **Dependency verification**:
   - Open a few tasks with dependencies
   - Verify predecessor/successor links are correct

5. **Assignment verification**:
   - Open a task with resource assignments
   - Verify resources and dates are correct

#### In logs:

```bash
# Check for warnings
grep "WARNING" logs/migration_*.log

# Check for errors
grep "ERROR" logs/migration_*.log

# Summary
tail -50 logs/migration_*.log
```

### Day 12: Performance and Optimization Testing

If planning to do this repeatedly:

1. **Benchmark current settings**:
   - Note current `BatchSize` and timing

2. **Test variations**:
   - Try `BatchSize: 150` and measure time
   - Try `BatchSize: 250` and measure stability
   - Document optimal settings

3. **Test resume capability** (if applicable):
   - Stop migration mid-way (Ctrl+C)
   - Re-run with `--resume` flag
   - Verify it continues without duplicates

## Phase 5: Production Cutover (if applicable)

### Pre-Cutover Checklist

- [ ] Test migration completed successfully
- [ ] Validation passed on all spot checks
- [ ] Custom fields present in target and values migrated
- [ ] Dependencies correctly established
- [ ] Resource assignments correct
- [ ] GUID mappings saved (`guid_mappings.json`)
- [ ] Logs reviewed for errors
- [ ] Stakeholders notified of migration date
- [ ] Backup of both environments taken

### Cutover Day:

1. **Freeze source projects** (if applicable)
   - Prevent new changes to avoid re-migration

2. **Final incremental migration** (if needed)
   - Export again: `dotnet run -- export`
   - This will overwrite previous exports
   - Import: `dotnet run -- import`

3. **Final validation**
   - Quick spot checks on critical projects
   - Verify user access to target environment

4. **Communication**
   - Notify users that migration is complete
   - Provide target environment URL
   - Direct users to new environment

## Handling Issues

### Problem: Some projects failed to import

Solution:
1. Check the logs for specific error messages
2. Fix the issue (e.g., missing custom field, invalid reference)
3. Use `--resume` flag to continue from where you stopped

```bash
dotnet run -- import --resume
```

The tool will skip already-migrated projects and continue.

### Problem: Custom field values not migrated

Solution:
1. Verify custom field was created in target environment
2. Check custom field mapping configuration
3. Re-export and import with corrected mapping

### Problem: Too slow, migration takes too long

Solution:
1. Increase `BatchSize` in `appsettings.json` (try 150, then 200)
2. Check target environment performance
3. Consider running during off-peak hours

### Problem: Timeout errors on OperationSet execution

Solution:
1. Increase `PollingMaxAttemptsPerOperationSet` (try 180 or 240)
2. Increase `PollingIntervalSeconds` (try 10 seconds)
3. Decrease `BatchSize` (try 100 or 75)

## Post-Migration

### Archive Original Data

Keep the exported JSON files for reference:

```bash
# Compress for archive
tar -czf project_exports_backup.tar.gz exported_data/
```

### Cleanup

- Delete `appsettings.json` (or move to secure location)
- Delete sensitive logs if required
- Keep `guid_mappings.json` for 30 days in case issues arise

### Documentation

Document:
- Migration date and duration
- Number of projects/tasks/entities migrated
- Any issues encountered and resolutions
- Custom field mappings applied
- Baseline performance settings used

## Next Steps

- Consider automating any delta migrations
- Set up audit monitoring in target environment
- Train users on the new environment
- Decommission source environment (after retention period)

---

**Need Help?**

See README.md for troubleshooting section or check logs in `./logs/`
