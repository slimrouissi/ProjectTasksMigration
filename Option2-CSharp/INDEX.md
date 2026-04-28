# Project Index and Quick Reference

## Getting Started (Pick Your Path)

### Path 1: I Have 5 Minutes
1. Read: **QUICKSTART.md** - Get running in 5 minutes
2. Run: `dotnet run -- validate`
3. Test: Export and import a sample project

### Path 2: I Have 30 Minutes
1. Read: **OVERVIEW.md** - Understand what this does
2. Read: **QUICKSTART.md** - Set it up
3. Follow README.md prerequisites and setup sections
4. Run: `dotnet run -- validate`

### Path 3: I'm Implementing This
1. Read: **README.md** - Complete setup guide
2. Follow: **MIGRATION-GUIDE.md** - Step-by-step (12 days)
3. Reference: **ARCHITECTURE.md** - How it works
4. Execute: Your migration plan

### Path 4: I'm Understanding the Code
1. Read: **ARCHITECTURE.md** - System design
2. Review: `Program.cs` - CLI entry point
3. Review: `Services/*.cs` - Core services
4. Reference: Inline code comments

---

## File Descriptions

### Documentation Files

| File | Purpose | Read Time |
|------|---------|-----------|
| **OVERVIEW.md** | High-level overview, features, architecture | 10 min |
| **QUICKSTART.md** | 5-minute setup and first run | 5 min |
| **README.md** | Complete user guide and reference | 30 min |
| **MIGRATION-GUIDE.md** | 12-day step-by-step migration | 60 min |
| **ARCHITECTURE.md** | System design, data flows, internals | 30 min |
| **FILE-SUMMARY.txt** | Comprehensive file manifest | 20 min |
| **INDEX.md** | This file - navigation guide | 5 min |

### Source Code Files

| File | Lines | Purpose |
|------|-------|---------|
| **Program.cs** | 550 | CLI entry point with commands |
| **Services/DataverseClient.cs** | 600 | OAuth2 + Web API wrapper |
| **Services/ExportService.cs** | 450 | Export from source D365 |
| **Services/ImportService.cs** | 700 | Import to target via Schedule API |
| **Services/GuidMappingService.cs** | 150 | GUID mapping and persistence |
| **Services/CustomFieldMapper.cs** | 250 | Custom field mapping logic |
| **Models/ProjectData.cs** | 400 | 50+ data model classes |

### Configuration Files

| File | Purpose |
|------|---------|
| **ProjectMigration.csproj** | .NET 8 project file with NuGet refs |
| **appsettings.example.json** | Configuration template (copy to appsettings.json) |
| **.gitignore** | Git ignore patterns for secrets |

---

## Common Tasks

### "I want to get it running ASAP"
1. `cp appsettings.example.json appsettings.json`
2. Edit with your environment details
3. `dotnet build`
4. `dotnet run -- validate`
5. See QUICKSTART.md for next steps

### "I need step-by-step guidance"
Follow MIGRATION-GUIDE.md - it's organized by days with clear instructions.

### "I need to configure custom fields"
See README.md section "Custom Field Mapping"

### "It's failing, I need help"
1. Check the log file: `./logs/migration_*.log`
2. See README.md section "Troubleshooting"
3. Common issues are documented there

### "I want to understand how it works"
Read ARCHITECTURE.md - it has:
- Class diagrams
- Data flow diagrams
- Error handling strategy
- Security architecture

### "I need to customize the code"
1. Read ARCHITECTURE.md for system design
2. Review relevant service file (see table above)
3. Check inline code comments
4. Reference XML doc comments

---

## Configuration Checklist

### Required
- [ ] Source environment URL
- [ ] Source TenantId
- [ ] Source ClientId
- [ ] Source ClientSecret
- [ ] Target environment URL
- [ ] Target TenantId
- [ ] Target ClientId
- [ ] Target ClientSecret

### Optional (with defaults)
- [ ] BatchSize (default: 200)
- [ ] PollingIntervalSeconds (default: 5)
- [ ] PollingMaxAttemptsPerOperationSet (default: 120)
- [ ] ExportPath (default: ./exported_data)
- [ ] LogPath (default: ./logs)
- [ ] ContinueOnProjectError (default: true)
- [ ] CustomFieldMappings (none by default)

See appsettings.example.json for all options.

---

## Commands Reference

```bash
# Test connectivity
dotnet run -- validate

# Export projects
dotnet run -- export
dotnet run -- export --project-filter "ACME"

# Import projects
dotnet run -- import
dotnet run -- import --dry-run
dotnet run -- import --resume

# Full migration
dotnet run -- migrate
dotnet run -- migrate --project-filter "TEST"
dotnet run -- migrate --dry-run

# Using custom config
dotnet run -- validate --config ./my-config.json

# Show help
dotnet run -- --help
```

---

## Key Concepts

### Schedule API vs Web API
- **Web API**: Direct REST API, cannot create scheduling entities correctly
- **Schedule API**: Proper way via OperationSet (msdyn_CreateOperationSetV1, msdyn_PssCreateV1)
- This tool uses Schedule API as required

### Two-Phase Import
1. **Phase 1**: Projects, Tasks, Team Members (via OperationSet #1)
2. **Phase 2**: Dependencies, Assignments (via OperationSet #2)
- Separate phases because dependencies need tasks first

### GUID Mapping
- Old project GUID → New project GUID (tracked)
- Used for remapping references in dependent entities
- Saved to `guid_mappings.json` for resume capability

### Custom Field Mapping
- Text/Number: Direct copy
- Lookup: GUID remapped if mapped
- OptionSet: Value mapped via dictionary
- Unmapped fields: Logged as warnings, not included

---

## Performance Tips

### For Faster Migrations
- Increase BatchSize (try 250, max 200 so it won't work)
- Run during off-peak hours
- Ensure target environment is healthy

### For More Stable Migrations
- Decrease BatchSize (try 100 or 75)
- Increase PollingIntervalSeconds (try 10-15)
- Check target environment performance

### For Debugging Failures
- Use `--dry-run` first
- Check logs in `./logs/migration_*.log`
- Test with `--project-filter` on specific projects

---

## Directory Structure

```
Option2-CSharp/
├── Program.cs                    # CLI entry point
├── ProjectMigration.csproj       # Project file
├── appsettings.example.json      # Config template
├── .gitignore                    # Git ignore
├── Services/
│   ├── DataverseClient.cs        # API wrapper
│   ├── ExportService.cs          # Export logic
│   ├── ImportService.cs          # Import logic
│   ├── GuidMappingService.cs     # GUID tracking
│   └── CustomFieldMapper.cs      # Field mapping
├── Models/
│   └── ProjectData.cs            # Data models
├── exported_data/                # (Created at runtime)
│   ├── {projectid}_export.json   # JSON exports
│   └── guid_mappings.json        # Mappings
├── logs/                         # (Created at runtime)
│   └── migration_*.log           # Log files
├── README.md                     # Full guide
├── QUICKSTART.md                 # 5-min setup
├── MIGRATION-GUIDE.md            # Step-by-step
├── ARCHITECTURE.md               # Design details
├── OVERVIEW.md                   # High-level overview
├── FILE-SUMMARY.txt              # File manifest
└── INDEX.md                      # This file
```

---

## Support Resources

### Documentation
- **README.md**: Comprehensive user guide
- **QUICKSTART.md**: Get running in 5 minutes
- **MIGRATION-GUIDE.md**: Detailed 12-day walkthrough
- **ARCHITECTURE.md**: System design and internals

### In Your Code
- XML doc comments on all public methods
- Inline comments on key algorithms
- Error messages point to README troubleshooting

### Logs
- Console output shows real-time progress
- File logs in `./logs/migration_*.log`
- Configure level in appsettings.json

### Examples
- See QUICKSTART.md for basic usage
- See MIGRATION-GUIDE.md for complex scenarios
- See README.md for all CLI commands

---

## Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| "Failed to acquire token" | Check ClientId, ClientSecret, TenantId |
| "OperationSet failed" | Check custom field mappings, reduce BatchSize |
| "Timeout" | Increase PollingMaxAttemptsPerOperationSet |
| "Connection refused" | Verify URLs are correct and accessible |
| "Missing custom field" | Create field in target first, then map |

More help: See README.md Troubleshooting section.

---

## Next Steps

1. **Start**: QUICKSTART.md (5 minutes)
2. **Setup**: README.md prerequisites section (30 minutes)
3. **Execute**: MIGRATION-GUIDE.md (follow the plan)
4. **Reference**: ARCHITECTURE.md as needed

---

## Document Reading Order

For maximum clarity, read in this order:

1. **OVERVIEW.md** (2 pages) - What is this?
2. **QUICKSTART.md** (2 pages) - Get running now
3. **README.md** (20 pages) - Setup and configuration
4. **MIGRATION-GUIDE.md** (15 pages) - Execute the plan
5. **ARCHITECTURE.md** (15 pages) - Understand internals
6. **FILE-SUMMARY.txt** (reference) - Details and specs

---

**Ready? Start with QUICKSTART.md or OVERVIEW.md**
