# Dynamics 365 Project Operations Migration Tool - File Index

Complete PowerShell-based migration tool for moving D365 Project Operations projects between environments using the Schedule API.

## Quick Start

1. **First Time?** → Read `README.md` (full guide)
2. **Need Setup Help?** → Run `Setup-AzureAD.ps1` (interactive guide)
3. **Configure Tool** → Edit `config.json` (copy from `config.example.json`)
4. **Validate Setup** → Run `Validate-Config.ps1` (test connectivity)
5. **Run Migration** → Run `Migrate-AllProjects.ps1` (main orchestrator)

## Files Overview

### Core Scripts (Run These)

| File | Size | Purpose | Run Time |
|------|------|---------|----------|
| **Migrate-AllProjects.ps1** | 7.7 KB | Main orchestrator - coordinates export and import | 2-4 hours |
| **Validate-Config.ps1** | 8.7 KB | Validates configuration and tests connectivity | 30-60 sec |
| **Setup-AzureAD.ps1** | 8.9 KB | Interactive guide for Azure AD setup | 30-45 min |

### Module Scripts (Imported Automatically)

| File | Size | Purpose | Functions |
|------|------|---------|-----------|
| **Connect-Environments.ps1** | 13 KB | OAuth2 authentication and HTTP client | 4 functions |
| **Export-Projects.ps1** | 16 KB | Export from source environment | 7 functions |
| **Import-Projects.ps1** | 36 KB | Import to target using Schedule API | 15 functions |

### Configuration

| File | Purpose | Action |
|------|---------|--------|
| **config.example.json** | Template with all options | Copy to config.json, edit |
| **config.json** | Your actual configuration | Create by copying example |

### Documentation

| File | Audience | Read Time | Key Content |
|------|----------|-----------|-------------|
| **README.md** | Everyone | 20 min | Complete guide, troubleshooting, API ref |
| **IMPLEMENTATION_GUIDE.md** | Operators | 10 min | Quick reference, scenarios, checklist |
| **ARCHITECTURE.md** | Developers | 15 min | Technical design, data flow, decisions |
| **INDEX.md** | Everyone | 5 min | This file - navigation guide |

## Execution Flow

### Typical Migration

```
1. Run: Setup-AzureAD.ps1
   └─→ Creates Azure AD App Registrations
   └─→ Creates D365 application users
   └─→ Documents credentials

2. Edit: config.json
   └─→ Add credentials from Setup
   └─→ Configure batch sizes
   └─→ Configure custom field mappings

3. Run: Validate-Config.ps1
   └─→ Validates JSON format
   └─→ Tests authentication
   └─→ Tests API connectivity

4. Run: Migrate-AllProjects.ps1 -ExportOnly
   └─→ Exports all projects to JSON
   └─→ Allows inspection before import

5. Run: Migrate-AllProjects.ps1
   └─→ Full migration: export + import
   └─→ Generates summary report
   └─→ Creates detailed logs
```

## File Descriptions

### Migrate-AllProjects.ps1
**Main Entry Point**

The orchestrator script that coordinates the entire migration.

**Usage:**
```powershell
# Full migration (export + import)
./Migrate-AllProjects.ps1 -ConfigPath "./config.json"

# Export only (for validation)
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ExportOnly

# Import only (from previous export)
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ImportOnly -ExportPath "./exports/export_YYYY-MM-DD_HH-MM-SS"

# Filter by project name
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ProjectFilter "ProjectNamePart"
```

**Does:**
- Loads configuration
- Imports modules
- Authenticates to environments
- Calls Export-Projects (unless ImportOnly)
- Calls Import-Projects
- Generates summary report

**Outputs:**
- `./exports/export_YYYY-MM-DD_HH-MM-SS/` (exported JSON files)
- `./logs/migration_*.log` (main log)
- `./logs/migration_summary_*.json` (statistics)
- `./logs/import_*/` (per-import session logs)

---

### Connect-Environments.ps1
**Authentication Module**

Handles OAuth2 authentication to both source and target environments.

**Key Functions:**
```powershell
# Authenticate to both environments
$clients = Connect-Environments -SourceConfig $config.source -TargetConfig $config.target

# Get authentication to specific environment
$client = Get-AuthenticatedClient -Config $config.source -EnvironmentName "Source"

# Refresh token if expiring
Refresh-Token -Client $client

# Make authenticated request with retry
$response = Invoke-WebApiRequest -Client $client -Uri $uri -Method Get -Body $body
```

**Features:**
- OAuth2 client credentials flow
- Automatic token refresh
- Exponential backoff retry (3x, 5s initial, 60s max)
- Handles rate limiting (429 errors)
- Validates connectivity

**Used By:**
- Migrate-AllProjects.ps1
- Export-Projects.ps1
- Import-Projects.ps1

---

### Export-Projects.ps1
**Data Extraction Module**

Exports projects and related entities from source environment.

**Key Functions:**
```powershell
# Main export function
$result = Export-Projects -SourceClient $client -Config $config -ExportPath "./exports"

# Export individual entity types
$projects = Get-Projects -Client $client -Config $config
$tasks = Get-ProjectTasks -Client $client -ProjectId $id -Config $config
$deps = Get-TaskDependencies -Client $client -ProjectId $id -Config $config
$assign = Get-ResourceAssignments -Client $client -ProjectId $id -Config $config
$team = Get-ProjectTeamMembers -Client $client -ProjectId $id -Config $config
$buckets = Get-ProjectBuckets -Client $client -ProjectId $id -Config $config
```

**Features:**
- Queries with pagination (5000 records per page)
- Preserves task hierarchy (sorted by outline level)
- Exports custom fields (configured in config.json)
- Per-project JSON files
- Progress indication
- Detailed logging

**Output Structure:**
```
exports/export_2024-01-15_10-30-45/
  ProjectA/
    project_data.json  # Contains all entities
  ProjectB/
    project_data.json
  ...
```

---

### Import-Projects.ps1
**Data Import Module Using Schedule API**

Imports projects to target environment using Schedule API (OperationSet).

**Key Functions:**
```powershell
# Main import function
$result = Import-Projects -TargetClient $client -Config $config -ExportPath $exportPath

# Import single project
$result = Import-SingleProject -TargetClient $client -ProjectData $data -Config $config

# Schedule API operations
$opSetId = Create-OperationSet -TargetClient $client -Config $config
Add-OperationToSet -TargetClient $client -OperationSetId $opSetId -Operation $op
Execute-OperationSet -TargetClient $client -OperationSetId $opSetId -Config $config
Poll-OperationSetCompletion -TargetClient $client -OperationSetId $opSetId -Config $config
```

**Features:**
- Creates projects directly (no Schedule API needed)
- Creates all scheduling entities via OperationSet (mandatory)
- Batches operations (max 200 per OperationSet)
- Preserves task hierarchy (parents before children)
- Maintains GUID mappings for references
- Async polling for OperationSet completion
- Per-project error logging

**Workflow:**
1. Create project (direct API)
2. Create OperationSet
3. Add buckets, team, tasks (OperationSet)
4. Execute → Poll
5. Create new OperationSet
6. Add dependencies (OperationSet)
7. Execute → Poll
8. Create new OperationSet
9. Add assignments (OperationSet)
10. Execute → Poll
11. Log results

---

### Validate-Config.ps1
**Configuration Validation Tool**

Tests configuration file and connectivity to both environments.

**Usage:**
```powershell
./Validate-Config.ps1 -ConfigPath "./config.json"
```

**Checks:**
- JSON format validity
- Required fields present
- GUID format validity
- URL format validity
- Source environment connectivity
- Target environment connectivity
- Batch settings reasonableness
- Custom field mappings syntax

**Output:**
- "VALID" if all checks pass
- Specific errors if any checks fail
- Actionable remediation suggestions

---

### Setup-AzureAD.ps1
**Interactive Setup Guide**

Step-by-step guide for creating Azure AD App Registrations and D365 application users.

**Usage:**
```powershell
./Setup-AzureAD.ps1
```

**Guides You Through:**
1. Creating source App Registration
2. Creating target App Registration
3. Creating source application user
4. Creating target application user
5. Configuring config.json
6. Running migration

**Outputs:**
- Interactive prompts with detailed instructions
- Links to Azure Portal
- Credential placeholders to fill in

---

### config.example.json
**Configuration Template**

Example configuration with all possible settings documented.

**Contains:**
- Source and target environment URLs
- Azure AD tenant IDs
- App Registration client IDs and secrets
- Batch settings (OperationSet max, page size)
- Retry settings (max retries, exponential backoff)
- Polling settings (OperationSet completion timeout)
- Custom field mappings array
- Logging configuration
- Migration options

**Copy to config.json and edit:**
```powershell
Copy-Item config.example.json config.json
# Edit config.json with your actual values
```

---

### README.md
**Complete Technical Documentation**

Comprehensive guide for users and operators.

**Sections:**
- Overview and features
- Prerequisites and requirements
- Step-by-step setup instructions
- How to execute different scenarios
- Custom field mapping guide
- Migration process explanation
- GUID mapping details
- Comprehensive troubleshooting
- Best practices
- Performance optimization
- API reference
- Limitations and known issues
- Version history

**Read Time:** ~20 minutes
**Best For:** First-time users, troubleshooting

---

### IMPLEMENTATION_GUIDE.md
**Quick Reference for Operators**

Fast reference guide for running the migration.

**Sections:**
- 5-step quick start
- File structure overview
- Configuration reference
- Common scenarios with exact commands
- Monitoring and troubleshooting
- Log file locations
- Data validation procedures
- Rollback plan
- Security best practices
- Timeline estimate
- Success criteria
- Validation checklist

**Read Time:** ~10 minutes
**Best For:** Operators, day-of-migration reference

---

### ARCHITECTURE.md
**Technical Design Document**

Deep dive into tool architecture and design decisions.

**Sections:**
- System architecture diagram
- Module design and patterns
- Data flow (export and import)
- Error handling strategy
- Performance characteristics
- Security model
- Testing strategy
- Future enhancements
- Dependency graph
- Monitoring and observability
- Deployment considerations

**Read Time:** ~15 minutes
**Best For:** Developers, advanced troubleshooting

---

## Key Concepts

### Schedule API (OperationSet)
The Schedule API is mandatory for creating scheduling entities in Project Operations:
- Direct Dataverse writes to `msdyn_projecttask`, `msdyn_projecttaskdependency`, `msdyn_resourceassignment` bypass critical business logic
- Using OperationSet ensures Project Scheduling Service processes all calculations
- Three key actions:
  - `msdyn_CreateOperationSetV1`: Create batch container
  - `msdyn_PssCreateV1`: Add operations to batch
  - `msdyn_ExecuteOperationSetV1`: Execute batch (async)

### GUID Mapping
Maintains old GUID → new GUID mappings to ensure references stay correct:
- Task parent references
- Task dependency links (predecessor/successor)
- Resource assignment task references

### Hierarchical Task Handling
Tasks created in outline-level order to ensure:
- Root tasks created first
- Parent tasks exist before children reference them
- Full hierarchy preserved in target

### Batching Strategy
OperationSets batch operations (max 200) for efficiency:
- Large migrations chunked across multiple OperationSet cycles
- Each cycle: Create Set → Add Ops → Execute → Poll
- Enables 1000+ tasks in single migration

## Common Commands

### Validate Everything
```powershell
./Validate-Config.ps1 -ConfigPath "./config.json"
```

### Export Only (Inspect Before Import)
```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ExportOnly
```

### Full Migration
```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json"
```

### Test with Specific Projects
```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ProjectFilter "BDO"
```

### Reimport from Previous Export
```powershell
./Migrate-AllProjects.ps1 -ConfigPath "./config.json" -ImportOnly -ExportPath "./exports/export_2024-01-15_10-30-45"
```

### Verbose Debugging
```powershell
$VerbosePreference = "Continue"
./Migrate-AllProjects.ps1 -ConfigPath "./config.json"
```

## Troubleshooting Quick Links

| Issue | See Section in |
|-------|---|
| "401 Unauthorized" | README.md → Troubleshooting |
| "OperationSet polling timeout" | README.md → Troubleshooting |
| "Parent task not found" | README.md → Troubleshooting |
| Need to setup Azure AD | Setup-AzureAD.ps1 |
| Config won't validate | Validate-Config.ps1 |
| Want to understand how it works | ARCHITECTURE.md |
| Step-by-step what to do | IMPLEMENTATION_GUIDE.md |
| Complete reference | README.md |

## Size and Performance

### Codebase
- **Total Lines of Code**: ~4,100
- **PowerShell Modules**: 3 (1,920 lines)
- **Main Script**: 198 lines
- **Utility Scripts**: 425 lines
- **Documentation**: ~1,800 lines

### Expected Execution Time for 190 Projects

| Phase | Time |
|-------|------|
| Setup (Azure AD + config) | 45-60 min |
| Validation | 2-3 min |
| Export | 15-30 min |
| Review export | 15-30 min |
| Import | 1-2.5 hours |
| Validation | 30-60 min |
| **Total** | **2.5-5 hours** |

### File Sizes

- Single project JSON: 50-500 KB
- Total export (190 projects): 10-50 MB
- Migration logs: 5-20 MB
- GUID mappings: 1-5 MB

## Support Resources

1. **For Setup Help**: Run `Setup-AzureAD.ps1`
2. **For Validation**: Run `Validate-Config.ps1`
3. **For Detailed Docs**: Read `README.md`
4. **For Operations**: Read `IMPLEMENTATION_GUIDE.md`
5. **For Technical Details**: Read `ARCHITECTURE.md`
6. **For Troubleshooting**: See README.md troubleshooting section

## Important Notes

- **No External Dependencies**: Uses only built-in PowerShell and .NET
- **Cross-Platform**: Works on Windows, Linux, macOS
- **Secure**: Credentials stored in config (not in code)
- **Resumable**: Can re-import from same export
- **Logged**: All operations logged to files
- **Tested**: Designed for ~190 projects scenario
- **Production-Ready**: Error handling, retry logic, validation

## Next Steps

1. ✅ Read README.md (20 min)
2. ✅ Run Setup-AzureAD.ps1 (30-45 min)
3. ✅ Edit config.json (5-10 min)
4. ✅ Run Validate-Config.ps1 (30-60 sec)
5. ✅ Run migration with -ExportOnly (15-30 min)
6. ✅ Review export JSON files (15-30 min)
7. ✅ Run full migration (1-2.5 hours)
8. ✅ Validate in target (30-60 min)

---

**Version**: 1.0
**Last Updated**: 2024-01-15
**Tested With**: Project Operations 4.0+, PowerShell 7.0+, 190 projects with 1000+ tasks
**Author**: BDO Dynamics 365 Migration Team
