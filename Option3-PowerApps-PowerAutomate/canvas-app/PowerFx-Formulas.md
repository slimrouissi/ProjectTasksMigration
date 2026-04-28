# Power Apps Canvas App - Power FX Formulas Complete Reference

This document contains all Power FX formulas used in the Project Migration Manager canvas app, organized by screen and control.

---

## App Startup: OnStart Event

This formula runs when the app first loads, initializing all global variables and collections.

```powerapps
// Initialize status option set values (must match Dataverse optionset)
Set(varStatusPending, 100000000);
Set(varStatusExporting, 100000001);
Set(varStatusExported, 100000002);
Set(varStatusImporting, 100000003);
Set(varStatusCompleted, 100000004);
Set(varStatusFailed, 100000005);

// Initialize environment URLs
Set(varSourceEnvURL, "https://source-org.crm.dynamics.com");
Set(varTargetEnvURL, "https://target-org.crm.dynamics.com");

// Initialize migration state
Set(varMigrationActive, false);
Set(varLastRefresh, Now());
Set(varMigrationStartTime, Now());
Set(varTotalProjectsCount, 0);
Set(varCompletedCount, 0);
Set(varFailedCount, 0);

// Initialize connection test results
Set(varSourceConnTest, "Not tested");
Set(varTargetConnTest, "Not tested");

// Initialize UI state
Set(varSelectedErrorRecord, Blank());
Set(varShowGUIDMapping, false);
Set(varSelectedMappingRecord, Blank());
Set(varFilterStatus, Blank());
Set(varFilterDateFrom, Blank());
Set(varFilterDateTo, Blank());
Set(varSearchText, "");

// Initialize collections
ClearCollect(colSelectedProjects);
ClearCollect(colMigrationTracker);
ClearCollect(colSourceProjects);
ClearCollect(colErrorLog);

// Log app startup (optional)
Trace("Project Migration Manager app started successfully")
```

---

## Screen 1: Environment Configuration

### Screen1: OnVisible Event

Loads configuration and displays environment details.

```powerapps
// Display current configuration
Set(varSourceEnvURL, "https://source-org.crm.dynamics.com");
Set(varTargetEnvURL, "https://target-org.crm.dynamics.com");

// Parse org ID from URL
Set(varSourceOrgID,
  Trim(
    Left(
      Right(varSourceEnvURL,
            Len(varSourceEnvURL) -
            Find(".crm.dynamics.com", varSourceEnvURL) - 18),
      Find("-",
        Right(varSourceEnvURL,
              Len(varSourceEnvURL) -
              Find(".crm.dynamics.com", varSourceEnvURL) - 18)) - 1
    )
  )
);

// Similar parsing for target
Set(varTargetOrgID,
  Trim(
    Left(
      Right(varTargetEnvURL,
            Len(varTargetEnvURL) -
            Find(".crm.dynamics.com", varTargetEnvURL) - 18),
      Find("-",
        Right(varTargetEnvURL,
              Len(varTargetEnvURL) -
              Find(".crm.dynamics.com", varTargetEnvURL) - 18)) - 1
    )
  )
)
```

### TextBox: txtSourceURL - OnChange Event

Updates source environment URL and extracts org ID.

```powerapps
// Validate URL format
If(
  Not(StartsWith(Trim(Self.Value), "https://")),
  Set(varSourceConnTest, "Invalid format - must start with https://"),

  If(
    Not(FindFirst(Trim(Self.Value), ".crm.dynamics.com") > 0),
    Set(varSourceConnTest, "Invalid format - must contain .crm.dynamics.com"),

    Set(varSourceEnvURL, Trim(Self.Value))
  )
)
```

### Button: btnTestSourceConnection - OnSelect Event

Tests connection to source environment.

```powerapps
Set(varSourceConnTest, "Testing connection...");

IfError(
  First(
    'Dataverse (cr_SourceDataverse)'.Items('msdyn_projects',
      {
        $top: 1,
        $select: "msdyn_projectid,msdyn_projectname"
      }
    )
  ),
  (
    Set(varSourceConnTest, "Failed - Check URL and permissions");
    Trace("Source connection test failed: " & Error().Message)
  ),
  (
    Set(varSourceConnTest, "Connected ✓");
    Trace("Source connection test passed")
  )
)
```

### Button: btnTestTargetConnection - OnSelect Event

Tests connection to target environment.

```powerapps
Set(varTargetConnTest, "Testing connection...");

IfError(
  First(
    'Dataverse (cr_TargetDataverse)'.Items('msdyn_projects',
      {
        $top: 1,
        $select: "msdyn_projectid,msdyn_projectname"
      }
    )
  ),
  (
    Set(varTargetConnTest, "Failed - Check URL and permissions");
    Trace("Target connection test failed: " & Error().Message)
  ),
  (
    Set(varTargetConnTest, "Connected ✓");
    Trace("Target connection test passed")
  )
)
```

### Button: btnSaveConfig - OnSelect Event

Saves configuration (for future use if environment URLs are user-configurable).

```powerapps
// Validate both URLs
If(
  Or(
    IsBlank(varSourceEnvURL),
    IsBlank(varTargetEnvURL),
    varSourceConnTest <> "Connected ✓",
    varTargetConnTest <> "Connected ✓"
  ),
  Notify("Please validate both connections before proceeding",
         NotificationType.Warning),

  (
    // In production, you could save these to a settings table
    // For now, they're just global variables
    Notify("Configuration saved", NotificationType.Success);
    Trace("Environment configuration saved")
  )
)
```

### Button: btnProceedToSelection - OnSelect Event

Navigates to project selection screen.

```powerapps
If(
  And(
    varSourceConnTest = "Connected ✓",
    varTargetConnTest = "Connected ✓"
  ),
  Navigate(Screen2_ProjectSelection),
  Notify("Please test both connections first", NotificationType.Warning)
)
```

---

## Screen 2: Project Selection

### Screen2: OnVisible Event

Loads all projects from source environment.

```powerapps
// Initialize selected projects collection
Clear(colSelectedProjects);
Set(varSearchText, "");

// Load all projects from source (with delegation)
IfError(
  ClearCollect(colSourceProjects,
    'Dataverse (cr_SourceDataverse)'.Items('msdyn_projects',
      {
        $orderby: "msdyn_projectname asc",
        $select: "msdyn_projectid,msdyn_projectname,msdyn_projectstatus,msdyn_projectowner,statecode"
      }
    )
  ),
  (
    Notify("Failed to load projects from source environment",
           NotificationType.Error);
    Trace("Project load failed: " & Error().Message)
  ),
  (
    Trace("Successfully loaded " & CountRows(colSourceProjects) & " projects");
    Notify(Text(CountRows(colSourceProjects), "0") & " projects loaded from source",
           NotificationType.Information)
  )
)
```

### Gallery: galProjects - Items Formula

Filters projects based on search text.

```powerapps
// Delegate filtering to Dataverse for performance
Filter(
  'Dataverse (cr_SourceDataverse)'.Items('msdyn_projects',
    {
      $orderby: "msdyn_projectname asc",
      $select: "msdyn_projectid,msdyn_projectname,msdyn_projectstatus,msdyn_projectowner",
      $filter: If(
        IsBlank(txtSearchProjects.Value),
        "statecode eq 0",  // Only active projects
        "startswith(msdyn_projectname, '" &
          Substitute(Trim(txtSearchProjects.Value), "'", "''") &
          "') and statecode eq 0"
      ),
      $top: 500
    }
  ),
  // Client-side filtering as fallback
  Or(
    IsBlank(txtSearchProjects.Value),
    StartsWith(msdyn_projectname, Trim(txtSearchProjects.Value))
  )
)
```

### TextBox: txtSearchProjects - OnChange Event

Clears gallery selection when search text changes.

```powerapps
// Refresh gallery with new filter
Set(varSearchText, Trim(Self.Value));

// Note: Gallery's Items formula will automatically requery Dataverse
// No explicit action needed here
```

### Checkbox: chkSelectProject - OnCheck Event (in gallery template)

When checkbox is checked, adds project to selection collection.

```powerapps
Collect(colSelectedProjects,
  {
    projectid: ThisItem.msdyn_projectid,
    projectname: ThisItem.msdyn_projectname,
    owner: ThisItem.msdyn_projectowner,
    status: ThisItem.msdyn_projectstatus,
    taskcount: 0  // Will be calculated later if needed
  }
);

Trace("Project selected: " & ThisItem.msdyn_projectname)
```

### Checkbox: chkSelectProject - OnUncheck Event (in gallery template)

When checkbox is unchecked, removes project from selection collection.

```powerapps
Remove(colSelectedProjects,
  LookUp(colSelectedProjects,
    projectid = ThisItem.msdyn_projectid)
);

Trace("Project deselected: " & ThisItem.msdyn_projectname)
```

### Button: btnSelectAll - OnSelect Event

Selects all visible projects in gallery.

```powerapps
ForAll(galProjects.AllItems,
  If(
    Not(chkSelectProject.Value),
    Set(chkSelectProject.Value, true)
  )
);

Notify(Text(CountRows(colSelectedProjects), "0") & " projects selected",
       NotificationType.Information)
```

### Button: btnDeselectAll - OnSelect Event

Deselects all projects.

```powerapps
Clear(colSelectedProjects);

ForAll(galProjects.AllItems,
  Set(chkSelectProject.Value, false)
);

Notify("All projects deselected", NotificationType.Information)
```

### Label: lblSelectedCount - Text Property

Displays number of selected projects.

```powerapps
Text(CountRows(colSelectedProjects), "0") &
" project(s) selected " &
If(CountRows(colSelectedProjects) > 0,
  "(" & Sum(colSelectedProjects, taskcount) & " tasks estimated)",
  "")
```

### Label: lblEstimatedTime - Text Property

Shows estimated migration time.

```powerapps
If(
  CountRows(colSelectedProjects) = 0,
  "Select projects to see estimate",

  "Estimated time: " &
  Text(CountRows(colSelectedProjects) * 35, "0") &
  " minutes (" &
  Text(CountRows(colSelectedProjects), "0") &
  " projects × 35 min/project)"
)
```

### Button: btnStartMigrationNow - OnSelect Event

Creates migration tracker records and starts the migration process.

```powerapps
If(
  CountRows(colSelectedProjects) = 0,
  Notify("Please select at least one project", NotificationType.Error),

  IfError(
    (
      // Record start time
      Set(varMigrationStartTime, Now());

      // Create migration tracker record for each selected project
      ForAll(colSelectedProjects,
        Patch(
          'Dataverse (cr_SourceDataverse)'.'cr_projectmigrations',
          Defaults('Dataverse (cr_SourceDataverse)'.'cr_projectmigrations'),
          {
            cr_sourceprojectid: projectid,
            cr_sourceprojectname: projectname,
            cr_status: varStatusPending,
            cr_migrationstartedby: User(),
            cr_migrationstarteddate: Now(),
            cr_taskcount: 0,
            cr_tasksimported: 0,
            cr_retrycount: 0
          }
        );

        // Trigger Power Automate Flow 1 for each project
        'Flow1_ExportProject'(
          {
            projectId: projectid,
            projectName: projectname
          }
        )
      );

      // Clear selection
      Clear(colSelectedProjects);

      // Update app state
      Set(varMigrationActive, true);

      // Show success message
      Notify("Migration started for " &
             Text(CountRows(colSelectedProjects), "0") &
             " projects. Check dashboard for progress.",
             NotificationType.Success);

      // Navigate to dashboard
      Navigate(Screen3_MigrationDashboard)
    ),
    (
      // Error handling
      Notify("Error starting migration: " & Error().Message,
             NotificationType.Error);
      Trace("Migration start error: " & Error().Message)
    )
  )
)
```

### Button: btnGoBackFromSelection - OnSelect Event

Returns to environment configuration screen.

```powerapps
Clear(colSelectedProjects);
Navigate(Screen1_EnvironmentConfig)
```

---

## Screen 3: Migration Dashboard

### Screen3: OnVisible Event

Loads migration tracker records and initializes the dashboard.

```powerapps
// Load migration tracker records
IfError(
  ClearCollect(colMigrationTracker,
    'Dataverse (cr_SourceDataverse)'.Items('cr_projectmigrations',
      {
        $orderby: "cr_migrationstarteddate desc",
        $select: "cr_projectmigrationid,cr_sourceprojectname,cr_sourceprojectid,cr_targetprojectid,cr_status,cr_taskcount,cr_tasksimported,cr_errordetails,cr_exportedon,cr_importedon,cr_retrycount,cr_guidmappingjson"
      }
    )
  ),
  (
    Notify("Failed to load migration status", NotificationType.Error);
    Trace("Migration tracker load failed: " & Error().Message)
  ),
  (
    Set(varMigrationActive, true);
    Set(varLastRefresh, Now());
    Trace("Loaded " & CountRows(colMigrationTracker) & " migration records")
  )
);

// Calculate summary statistics
Set(varTotalProjectsCount, CountRows(colMigrationTracker));
Set(varCompletedCount,
  CountIf(colMigrationTracker, cr_status = varStatusCompleted));
Set(varFailedCount,
  CountIf(colMigrationTracker, cr_status = varStatusFailed));
Set(varInProgressCount,
  CountIf(colMigrationTracker,
    Or(
      cr_status = varStatusPending,
      cr_status = varStatusExporting,
      cr_status = varStatusExported,
      cr_status = varStatusImporting
    )
  )
)
```

### Timer: timerRefresh - Duration Property

```powerapps
5000  // 5 seconds
```

### Timer: timerRefresh - OnTimerEnd Event

Refreshes migration status every 5 seconds.

```powerapps
// Refresh migration tracker records
IfError(
  ClearCollect(colMigrationTracker,
    'Dataverse (cr_SourceDataverse)'.Items('cr_projectmigrations',
      {
        $orderby: "cr_migrationstarteddate desc",
        $select: "cr_projectmigrationid,cr_sourceprojectname,cr_sourceprojectid,cr_targetprojectid,cr_status,cr_taskcount,cr_tasksimported,cr_errordetails,cr_exportedon,cr_importedon,cr_retrycount,cr_guidmappingjson"
      }
    )
  ),
  (
    Trace("Auto-refresh failed: " & Error().Message)
  ),
  (
    // Update statistics
    Set(varTotalProjectsCount, CountRows(colMigrationTracker));
    Set(varCompletedCount,
      CountIf(colMigrationTracker, cr_status = varStatusCompleted));
    Set(varFailedCount,
      CountIf(colMigrationTracker, cr_status = varStatusFailed));
    Set(varInProgressCount,
      CountIf(colMigrationTracker,
        Or(
          cr_status = varStatusPending,
          cr_status = varStatusExporting,
          cr_status = varStatusExported,
          cr_status = varStatusImporting
        )
      )
    );

    Set(varLastRefresh, Now());

    // Notify if all completed
    If(
      And(
        varInProgressCount = 0,
        varTotalProjectsCount > 0,
        varCompletedCount > 0
      ),
      Notify("All migrations have completed!", NotificationType.Success)
    )
  )
)
```

### Gallery: galMigrationStatus - Items Formula

```powerapps
colMigrationTracker
```

### Label: lblStatusIndicator - Text Property (in gallery template)

Displays human-readable status.

```powerapps
Switch(ThisItem.cr_status,
  varStatusPending, "● Pending",
  varStatusExporting, "⟳ Exporting",
  varStatusExported, "⟳ Preparing Import",
  varStatusImporting, "⟳ Importing",
  varStatusCompleted, "✓ Completed",
  varStatusFailed, "✗ Failed",
  "Unknown Status"
)
```

### Progress Bar: prgProgress - Value Property (in gallery template)

Calculates progress percentage.

```powerapps
If(
  ThisItem.cr_taskcount > 0,
  ThisItem.cr_tasksimported / ThisItem.cr_taskcount * 100,
  If(
    ThisItem.cr_status = varStatusCompleted,
    100,
    If(
      ThisItem.cr_status = varStatusFailed,
      0,
      If(
        ThisItem.cr_status = varStatusExporting,
        25,
        If(
          ThisItem.cr_status = varStatusExported,
          50,
          If(
            ThisItem.cr_status = varStatusImporting,
            75,
            0
          )
        )
      )
    )
  )
)
```

### Progress Bar: prgProgress - Fill Property (in gallery template)

Changes color based on status.

```powerapps
Switch(ThisItem.cr_status,
  varStatusPending, Color.Gray,
  varStatusExporting, Color.Blue,
  varStatusExported, Color.Cyan,
  varStatusImporting, RGBA(255, 165, 0, 1),  // Orange
  varStatusCompleted, Color.Green,
  varStatusFailed, Color.Red,
  Color.Gray
)
```

### Label: lblTaskCount - Text Property (in gallery template)

Shows task progress.

```powerapps
Text(ThisItem.cr_taskcount, "0") & " source → " &
Text(ThisItem.cr_tasksimported, "0") & " imported"
```

### Button: btnViewError - Visible Property (in gallery template)

```powerapps
ThisItem.cr_status = varStatusFailed
```

### Button: btnViewError - OnSelect Event (in gallery template)

```powerapps
Set(varSelectedErrorRecord, ThisItem);
Navigate(Screen4_ErrorDetail)
```

### Button: btnRetryMigration - Visible Property (in gallery template)

```powerapps
ThisItem.cr_status = varStatusFailed
```

### Button: btnRetryMigration - OnSelect Event (in gallery template)

```powerapps
IfError(
  Patch(
    'Dataverse (cr_SourceDataverse)'.'cr_projectmigrations',
    ThisItem,
    {
      cr_status: varStatusPending,
      cr_errordetails: "",
      cr_retrycount: ThisItem.cr_retrycount + 1
    }
  ),
  (
    Notify("Error resetting migration: " & Error().Message,
           NotificationType.Error)
  ),
  (
    // Trigger export flow again
    'Flow1_ExportProject'(
      {
        projectId: ThisItem.cr_sourceprojectid,
        projectName: ThisItem.cr_sourceprojectname
      }
    );

    Notify("Retry initiated for " & ThisItem.cr_sourceprojectname,
           NotificationType.Success);
    Trace("Migration retry initiated: " & ThisItem.cr_sourceprojectname)
  )
)
```

### Label: lblOverallProgress - Text Property

```powerapps
If(
  varTotalProjectsCount = 0,
  "No migrations in progress",

  Text(
    varCompletedCount / varTotalProjectsCount * 100,
    "0"
  ) & "% Complete (" &
  Text(varCompletedCount, "0") & " of " &
  Text(varTotalProjectsCount, "0") & " projects)"
)
```

### Label: lblOverallStatus - Text Property

```powerapps
Text(varCompletedCount, "0") & " Completed | " &
Text(varInProgressCount, "0") & " In Progress | " &
Text(varFailedCount, "0") & " Failed"
```

### Button: btnExportReport - OnSelect Event

```powerapps
// Note: Canvas apps don't have native file export
// This creates a notification instructing user to export manually

Notify("To export the migration report:" &
       Char(10) & "1. Go to Screen 4: Migration Log" &
       Char(10) & "2. Select all rows (Ctrl+A)" &
       Char(10) & "3. Copy to clipboard (Ctrl+C)" &
       Char(10) & "4. Paste into Excel spreadsheet",
       NotificationType.Information)
```

### Button: btnGoBackFromDashboard - OnSelect Event

```powerapps
Navigate(Screen2_ProjectSelection)
```

---

## Screen 4: Migration Log (Optional)

### Screen4: OnVisible Event

Loads full migration history.

```powerapps
// Load all migration records with history
IfError(
  ClearCollect(colMigrationTracker,
    'Dataverse (cr_SourceDataverse)'.Items('cr_projectmigrations',
      {
        $orderby: "cr_migrationstarteddate desc",
        $select: "*"
      }
    )
  ),
  Notify("Failed to load migration history", NotificationType.Error),
  Notify(Text(CountRows(colMigrationTracker), "0") &
         " migration records loaded",
         NotificationType.Information)
);

// Initialize filters
Set(varFilterStatus, Blank());
Set(varFilterDateFrom, Blank());
Set(varFilterDateTo, Blank())
```

### Table: tblMigrationLog - Items Formula

```powerapps
Filter(
  colMigrationTracker,
  And(
    If(IsBlank(varFilterStatus),
      true,
      cr_status = varFilterStatus),

    If(IsBlank(varFilterDateFrom),
      true,
      cr_migrationstarteddate >= varFilterDateFrom),

    If(IsBlank(varFilterDateTo),
      true,
      cr_migrationstarteddate <= varFilterDateTo)
  )
)
```

### Button: btnViewGUIDMapping - OnSelect Event (in table)

```powerapps
Set(varSelectedMappingRecord, Selected(tblMigrationLog));
Set(varShowGUIDMapping, true)
```

### Dialog: dlgGUIDMapping - OnOpen Event

```powerapps
// Format JSON for display
Set(varFormattedJSON,
  varSelectedMappingRecord.cr_guidmappingjson
)
```

---

## Global Helper Formulas

### Function: GetStatusLabel
Returns human-readable status label.

```powerapps
Concatenate(
  Switch(varStatus,
    varStatusPending, "● Pending",
    varStatusExporting, "⟳ Exporting",
    varStatusExported, "⟳ Exported",
    varStatusImporting, "⟳ Importing",
    varStatusCompleted, "✓ Completed",
    varStatusFailed, "✗ Failed",
    "Unknown"
  )
)
```

### Function: GetStatusColor
Returns color for status indicator.

```powerapps
Switch(varStatus,
  varStatusPending, Color.Gray,
  varStatusExporting, Color.Blue,
  varStatusExported, RGBA(0, 180, 255, 1),
  varStatusImporting, RGBA(255, 165, 0, 1),
  varStatusCompleted, Color.Green,
  varStatusFailed, Color.Red,
  Color.Gray
)
```

### Function: FormatDuration
Converts seconds to "X hours Y minutes" format.

```powerapps
If(
  varSeconds < 60,
  Text(varSeconds, "0") & " seconds",
  If(
    varSeconds < 3600,
    Text(Int(varSeconds / 60), "0") & " minutes " &
    Text(Mod(varSeconds, 60), "0") & " seconds",
    Text(Int(varSeconds / 3600), "0") & " hours " &
    Text(Mod(Int(varSeconds / 60), 60), "0") & " minutes"
  )
)
```

---

## Error Handling Patterns

### Generic Error Catcher

Used throughout all event handlers:

```powerapps
IfError(
  [Action],
  (
    // Error branch
    Notify("Error: " & Error().Message, NotificationType.Error);
    Trace("Error occurred: " & Error().Message &
          " Kind: " & Error().Kind)
  ),
  (
    // Success branch
    Notify("Action completed successfully", NotificationType.Success)
  )
)
```

### Connection Validation Pattern

Used when connecting to Dataverse:

```powerapps
IfError(
  First('Dataverse...'.Items('Table', {$top: 1})),
  (
    Set(varConnectionStatus, "Failed - " & Error().Message);
    Trace("Connection failed: " & Error().Message)
  ),
  (
    Set(varConnectionStatus, "Connected");
    Trace("Connection successful")
  )
)
```

---

## Common Formulas Reference

### Check if Collection is Empty
```powerapps
CountRows(colCollectionName) = 0
```

### Get First Record
```powerapps
First(colCollectionName)
```

### Sum Column Values
```powerapps
Sum(colCollectionName, columnName)
```

### Count Rows Meeting Condition
```powerapps
CountIf(colCollectionName, columnName = value)
```

### Format DateTime
```powerapps
Text(datetimeValue, "yyyy-mm-dd hh:mm:ss")
```

### Extract Org ID from URL
```powerapps
Mid(varURL,
    FindFirst(varURL, "://") + 3,
    FindFirst(varURL, ".crm") - FindFirst(varURL, "://") - 3
)
```

---

## Testing Formulas

Use these formulas in browsers or buttons to test functionality:

### Test Data Load
```powerapps
// Button: Test
Notify("Projects loaded: " & Text(CountRows(colSourceProjects), "0"),
       NotificationType.Information)
```

### Test Selection
```powerapps
// Button: Test
Notify("Selected: " & Text(CountRows(colSelectedProjects), "0"),
       NotificationType.Information)
```

### Test Migration Status
```powerapps
// Button: Test
Notify("Status - Completed: " & Text(varCompletedCount, "0") &
       ", Failed: " & Text(varFailedCount, "0") &
       ", In Progress: " & Text(varInProgressCount, "0"),
       NotificationType.Information)
```

---

## Performance Considerations

### Avoid
```powerapps
// BAD: Client-side filtering of 190 projects
Filter(AllProjects, Status = "Active")
```

### Prefer
```powerapps
// GOOD: Server-side filtering via Dataverse connector
'Dataverse...'.Items('Table', {$filter: "Status eq 'Active'"})
```

### Avoid
```powerapps
// BAD: ForAll with Patch inside (slow)
ForAll(colItems, Patch(Table, ThisRecord, {field: value}))
```

### Prefer
```powerapps
// GOOD: Use Patch outside loop or batch operations
Patch(Table, colItems, {field: value})
```

---

## Deployment Checklist

- [ ] All connection references configured and tested
- [ ] Environment URLs hardcoded or read from settings
- [ ] All Power Automate flows created and linked
- [ ] Collections cleared on app start
- [ ] Error handling implemented throughout
- [ ] Accessibility labels added to all controls
- [ ] App tested with 1-2 sample projects
- [ ] Performance tested with 190+ projects in gallery
- [ ] Mobile responsive tested (if deployed to mobile)
- [ ] Timer refresh working and updating UI
- [ ] Notifications displaying correctly
- [ ] GUID mapping JSON parsing working

