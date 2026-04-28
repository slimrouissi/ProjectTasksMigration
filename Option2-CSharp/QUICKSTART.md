# Quick Start Guide

Get up and running in 15 minutes.

## Prerequisites Checklist

- [ ] .NET 8.0 SDK installed
- [ ] Source Dynamics 365 environment access
- [ ] Target Dynamics 365 environment access
- [ ] Azure AD admin access
- [ ] Dynamics 365 admin access

## 5-Minute Setup

### 1. Clone and Build

```bash
git clone <repository-url>
cd ProjectTasksMigration/Option2-CSharp
dotnet restore
dotnet build
```

### 2. Create Configuration

```bash
cp appsettings.example.json appsettings.json
```

Edit `appsettings.json`:
- Replace `SourceEnvironment.Url` with your source org URL
- Replace `TargetEnvironment.Url` with your target org URL
- Fill in TenantId, ClientId, ClientSecret from Azure AD

### 3. Test Connection

```bash
dotnet run -- validate
```

Should output:
```
Source environment connection successful
Target environment connection successful
All validation checks passed
```

## First Run: Test with Sample Project

### Export

```bash
dotnet run -- export --project-filter "TEST"
```

Creates `exported_data/` with JSON files.

### Import

```bash
dotnet run -- import --dry-run
```

Dry run shows what would be imported.

```bash
dotnet run -- import
```

Actual import to target environment.

### Verify

In target D365, navigate to Projects and find the migrated project.

## Full Migration

```bash
# Export all projects
dotnet run -- export

# Check dry run
dotnet run -- import --dry-run

# Run full import
dotnet run -- import
```

Total time: 2-4 hours for 190 projects with 15k+ tasks.

## Common Commands

| Command | Purpose |
|---------|---------|
| `dotnet run -- validate` | Test connectivity |
| `dotnet run -- export` | Export all projects |
| `dotnet run -- export -p "ACME"` | Export projects matching name |
| `dotnet run -- import --dry-run` | Preview import |
| `dotnet run -- import` | Import to target |
| `dotnet run -- import --resume` | Resume failed import |
| `dotnet run -- migrate` | Export then import (full) |

## Monitoring

Check logs while running:
```bash
tail -f logs/migration_*.log
```

## What Gets Migrated

- [ ] Projects
- [ ] Tasks (with hierarchy)
- [ ] Team members
- [ ] Resource assignments
- [ ] Task dependencies
- [ ] Custom fields (50+)

## What Doesn't Get Migrated

- Attachments and notes (not in scope)
- Historical data (archived projects)
- Activity feeds

## Troubleshooting

### "Failed to acquire access token"
- Check ClientId and ClientSecret
- Verify Application User exists in D365

### "OperationSet failed"
- Check custom field mappings
- Verify lookup field values exist in target
- Reduce BatchSize in config

### "Timeout"
- Increase PollingMaxAttemptsPerOperationSet
- Check target environment performance

See README.md for detailed troubleshooting.

## Next Steps

1. **Verify Azure AD setup**: See README.md "Create Application Registrations"
2. **Verify D365 Application Users**: See README.md "Create Application Users"
3. **Full migration**: Run `dotnet run -- migrate`
4. **Detailed guide**: See MIGRATION-GUIDE.md for step-by-step walkthrough

---

**Pro Tips**:
- Use `--dry-run` before real import
- Save `guid_mappings.json` for resume capability
- Check logs in `./logs/` for details
- Test with small project first

Need help? See README.md or MIGRATION-GUIDE.md
