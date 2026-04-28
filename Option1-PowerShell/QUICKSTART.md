# Quick Start Guide - 15 Minutes

Get your migration running in 15 minutes with this streamlined guide.

## Prerequisites Checklist

Before starting, you need:

```
✓ Access to Azure Portal as Global Admin
✓ Access to source D365 Project Operations environment
✓ Access to target D365 Project Operations environment
✓ PowerShell 7.0+ installed
✓ This folder with all scripts
✓ 30-45 minutes for setup, 2-3 hours for migration
```

If you don't have all of these, see README.md for detailed setup.

---

## Step 1: Get Your App Registration Credentials (10-15 min)

### For Source Environment:

1. Go to https://portal.azure.com
2. Search for "App registrations" → "New registration"
3. Name: `D365-ProjectMigration-Source`
4. Register
5. Copy and save:
   - **Application (client) ID**
   - **Directory (tenant) ID**
6. Go to "Certificates & secrets" → "New client secret"
   - Copy the **Value** (the blue secret, not the ID)
7. Go to "API permissions" → "Add a permission" → "Dynamics CRM"
   - Select `user_impersonation`
   - Grant admin consent

**Repeat for Target Environment** (name it `D365-ProjectMigration-Target`)

**Result**: 6 pieces of info saved
```
Source:
  Tenant ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  Client ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  Secret:    [secret-value]

Target:
  Tenant ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  Client ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  Secret:    [secret-value]
```

---

## Step 2: Create Application Users in D365 (5 min)

### In Source D365:

1. Go to **Settings** → **Security** → **Users**
2. **+ New** → **Application User**
3. Fill in:
   - Application ID: [Use source App Registration Client ID from Step 1]
   - First Name: `Migration`
   - Last Name: `Tool`
4. **Save**
5. In same record, click **Manage Roles**
6. Assign: `Project Manager` role
7. **Save**

### In Target D365:

Repeat with target App Registration Client ID

---

## Step 3: Create and Edit config.json (2 min)

```powershell
# In this folder, run:
Copy-Item config.example.json config.json
```

Edit `config.json` and fill in:

```json
{
  "sourceEnvironment": {
    "organizationUrl": "https://your-source.crm.dynamics.com",
    "tenantId": "[source tenant ID from Step 1]",
    "clientId": "[source client ID from Step 1]",
    "clientSecret": "[source secret from Step 1]"
  },
  "targetEnvironment": {
    "organizationUrl": "https://your-target.crm.dynamics.com",
    "tenantId": "[target tenant ID from Step 1]",
    "clientId": "[target client ID from Step 1]",
    "clientSecret": "[target secret from Step 1]"
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

**Only required fields to edit:**
- `organizationUrl` (both)
- `tenantId` (both)
- `clientId` (both)
- `clientSecret` (both)

Keep everything else as-is for now.

---

## Step 4: Validate Configuration (1 min)

```powershell
./Validate-Config.ps1 -ConfigPath "./config.json"
```

Expected output:
```
Configuration Validation Complete
Summary:
  Source Environment: https://your-source.crm.dynamics.com
  Target Environment: https://your-target.crm.dynamics.com
  Configuration Status: VALID
```

**If validation fails:**
- Check config.json syntax (must be valid JSON)
- Check organization URLs are correct
- Check App Registration credentials match
- Check application users exist in both D365 environments with Project Manager role

---

## Step 5: Test Export (15-30 min)

```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ExportOnly
```

This:
- Exports all projects to JSON files
- Shows progress on screen
- Doesn't import anything
- Creates `./exports/export_YYYY-MM-DD_HH-MM-SS/` folder

**Expected output:**
```
Found 190 projects to export.
[1/190] Exporting project: Project A
[2/190] Exporting project: Project B
...
[190/190] Exporting project: Project Z

Export completed successfully!
Export path: ./exports/export_2024-01-15_10-30-45
Total projects exported: 190
```

**Check logs:**
```powershell
# Watch for errors
Get-ChildItem "./logs/"
```

---

## Step 6: Run Full Migration (1-3 hours)

When ready, run:

```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json"
```

This:
- Exports all projects (15-30 min)
- Imports all projects (1-2.5 hours)
- Generates summary report

**Progress Indicator:**
- Console shows each project as it's imported
- Logs are created in `./logs/`
- Final summary shows success rate

**Expected output:**
```
[1/190] Importing project: Project A
  Exported: 5 team members, 20 tasks, 10 dependencies, 15 assignments, 2 buckets
  Successfully imported: Project A

[2/190] Importing project: Project B
  ...

[190/190] Importing project: Project Z
  Successfully imported: Project Z

Migration completed!
Successful imports: 190 / 190
Failed imports: 0

Migration log path: ./logs/
```

**Watch progress:**
```powershell
# In another terminal, watch logs
Get-Content "./logs/migration_*.log" -Wait
```

---

## Step 7: Validate Results

In target D365 environment:

1. ✓ Count projects (should match source)
2. ✓ Open 5-10 projects and verify:
   - Tasks are present
   - Task hierarchy looks correct (parent-child)
   - Dependencies between tasks
   - Team members assigned
   - Resource assignments showing effort
3. ✓ Check logs for any errors:
   ```powershell
   Get-Content "./logs/migration_summary_*.json" | ConvertFrom-Json
   ```

---

## Troubleshooting in 2 Minutes

### Error: "401 Unauthorized"

```
Cause: Invalid credentials

Fix:
1. Check config.json has correct clientId and clientSecret
2. Verify App Registration exists in Azure Portal
3. Verify application user exists in D365 with Project Manager role
4. Wait 5 minutes for roles to sync
```

### Error: "Cannot find path './Migrate-AllProjects.ps1'"

```
Cause: Wrong directory

Fix:
1. Open PowerShell
2. Change to folder with scripts: cd C:\path\to\ProjectTasksMigration\Option1-PowerShell
3. Then run: ./Migrate-AllProjects.ps1
```

### Error: "OperationSet polling timeout"

```
Cause: API taking too long

Fix:
1. Edit config.json
2. Increase: "maxPollingWaitMinutes": 60
3. Re-run import with: -ImportOnly -ExportPath "./exports/export_YYYY-MM-DD_HH-MM-SS"
```

### Progress seems stuck

```
Fix:
1. Check logs: Get-Content "./logs/migration_*.log" -Tail 20
2. Wait (polling is normal, can take 30+ minutes)
3. If truly stuck, press Ctrl+C to cancel
4. Check what went wrong in logs
5. Fix and re-run
```

---

## What's Next After Migration?

1. Verify counts in target D365
2. Spot-check 10-15 projects
3. Check task hierarchies are correct
4. Test project scheduling
5. Confirm custom fields migrated
6. Archive export JSON files
7. Keep config.json for records (remove secrets first)

---

## Common Options

### Test with Just 5 Projects

```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ProjectFilter "ProjectName"
```

### Skip Certain Projects

Edit `config.json`:
```json
"migration": {
  "skipProjects": ["Legacy Project", "Test Project"]
}
```

Then run normally.

### Reimport from Previous Export

```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ImportOnly -ExportPath "./exports/export_2024-01-15_10-30-45"
```

### Add Custom Field Mapping

Edit `config.json`:
```json
"customFieldMappings": [
  {
    "sourceFieldName": "msdyn_custom_budget",
    "targetFieldName": "msdyn_custom_budget",
    "fieldType": "decimal",
    "isMapped": true
  }
]
```

---

## Success!

When migration completes:

```
Migration completed!
Successful imports: 190 / 190
Success Rate: 100%

Source Environment: https://source.crm.dynamics.com
Target Environment: https://target.crm.dynamics.com
```

You're done! Validate the data in target D365.

---

## Need Help?

| Question | Answer |
|----------|--------|
| How do I set up Azure AD? | Read README.md → Setup Instructions |
| Where are the logs? | Check `./logs/` folder |
| How do I map custom fields? | Read README.md → Custom Field Mapping |
| Migration failed, what do I do? | See README.md → Troubleshooting |
| How does it work technically? | Read ARCHITECTURE.md |
| Is there a more detailed guide? | Read IMPLEMENTATION_GUIDE.md |

---

## Timeline

| Activity | Time |
|----------|------|
| Get App Registration credentials | 10-15 min |
| Create application users in D365 | 5 min |
| Create and edit config.json | 2 min |
| Validate configuration | 1 min |
| Test export | 15-30 min |
| Run full migration | 1-3 hours |
| **Total** | **2-4.5 hours** |

**Total first-time setup: ~4-5 hours**
**Subsequent migrations: ~1-3 hours**

---

**That's it! You're ready to migrate.**

Start with Step 1 and follow through. Each step takes the time listed.

If you get stuck, check the Troubleshooting section or read the full documentation in README.md.

Good luck!

---

**Last Updated**: 2024-01-15
**Version**: 1.0
