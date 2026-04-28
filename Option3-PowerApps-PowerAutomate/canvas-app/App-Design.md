# Power Apps Canvas App: Project Migration Manager

## Overview

This Power Apps canvas app provides the **user interface layer** for the project migration solution. The app is responsible for:
- Displaying source projects
- Allowing users to select projects for migration
- Triggering Power Automate flows
- Showing real-time migration status

**IMPORTANT**: The canvas app does NOT perform the actual migration. It only displays status and triggers cloud flows. The Power Automate flows do all the heavy lifting.

---

## App Information

| Property | Value |
|----------|-------|
| **App Name** | Project Migration Manager |
| **Canvas Version** | Power Apps Canvas (Web & Mobile) |
| **Orientation** | Landscape (recommended 1920x1080 for desktop) |
| **Connection References** | 2 Dataverse connections (source & target) |
| **Theme** | Default modern theme with custom colors |
| **Accessibility** | WCAG 2.1 AA compliant (labels, alt text, keyboard navigation) |

---

## Connection References Setup

### Connection Reference 1: Source Environment (cr_SourceDataverse)
**Purpose**: Read-only access to source environment projects and tasks

```
Name:                    cr_SourceDataverse
Connector Type:          Dataverse
Target Environment URL:  https://[source-org].crm.dynamics.com
Shared As:              User account (authenticated user)
Permissions:            Read (msdyn_project, msdyn_projecttask, cr_projectmigration)
```

### Connection Reference 2: Target Environment (cr_TargetDataverse)
**Purpose**: Used by Power Automate flows to create projects in target

```
Name:                    cr_TargetDataverse
Connector Type:          Dataverse
Target Environment URL:  https://[target-org].crm.dynamics.com
Shared As:              Service Principal (App Registration)
Permissions:            Create/Update/Delete (msdyn_project, msdyn_projecttask, etc.)
Credentials:            App ID, Tenant ID, Client Secret (stored securely)
```

See setup/ConnectionReferences.md for detailed setup instructions.

---

## App Navigation Structure

```
┌─────────────────────────────────────────────────────┐
│              App Home Screen                         │
│  (Navigation Menu on Left Side)                      │
└─────────────────────────────────────────────────────┘
         │
         ├─ Screen1_EnvironmentConfig
         │  ├─ Source environment URL input
         │  ├─ Target environment URL input
         │  ├─ Connection test button
         │  └─ Save button
         │
         ├─ Screen2_ProjectSelection
         │  ├─ Project gallery with checkboxes
         │  ├─ Search/filter textbox
         │  ├─ Select All / Deselect All buttons
         │  └─ Start Migration button
         │
         ├─ Screen3_MigrationDashboard (DEFAULT)
         │  ├─ Migration tracker gallery
         │  ├─ Status indicators (color-coded)
         │  ├─ Progress bars
         │  ├─ Error detail viewer
         │  └─ Retry buttons
         │
         └─ Screen4_MigrationLog
            ├─ Detailed log table
            ├─ Filter by date/status
            └─ Export log button
```

---

## Screen 1: Environment Configuration

### Purpose
Allow administrators to specify source and target Dynamics 365 environments without code changes.

### Layout
```
┌─────────────────────────────────────────────────────┐
│  ENVIRONMENT CONFIGURATION                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Source Environment Setup                          │
│  ┌──────────────────────────────────────────────┐  │
│  │ Environment URL:  [         textbox        ] │  │
│  │ Organization ID:  [Populated after input]    │  │
│  │ Connection Test:  [ Test ] Status: ✓ Ready  │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  Target Environment Setup                          │
│  ┌──────────────────────────────────────────────┐  │
│  │ Environment URL:  [         textbox        ] │  │
│  │ Organization ID:  [Populated after input]    │  │
│  │ Connection Test:  [ Test ] Status: ✓ Ready  │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ [Save Configuration] [Next: Select Projects] │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Controls

#### TextBox: txtSourceURL
```
Properties:
  HintText:     "https://[yourorg].crm.dynamics.com"
  MaxLength:    255
  OnChange:     Extract org ID from URL
```

#### TextBox: txtTargetURL
```
Properties:
  HintText:     "https://[yourorg].crm.dynamics.com"
  MaxLength:    255
  OnChange:     Extract org ID from URL
```

#### Button: btnTestSourceConnection
```
Properties:
  Text:         "Test Connection"
  OnSelect:
    Set(varSourceConnTest, "Testing...");
    ForAll(First(
      'Dataverse (Current Environment)'.'Items',
      {cr_name: "dummy"}
    ),
      Set(varSourceConnTest, "Connected ✓")
    );
    If(
      IsError(varSourceConnTest),
      Set(varSourceConnTest, "Failed ✗"),
      Set(varSourceConnTest, "Connected ✓")
    )
```

#### Button: btnStartMigration (Navigate to Screen 2)
```
Properties:
  Text:         "Next: Select Projects"
  OnSelect:     Navigate(Screen2_ProjectSelection)
```

**Important Note**: In early deployments, you may hardcode the environment URLs instead of allowing users to change them. Move this configuration to setup/deployment time.

---

## Screen 2: Project Selection

### Purpose
Display all projects from source environment in a gallery with checkboxes, allowing users to select which projects to migrate.

### Layout
```
┌─────────────────────────────────────────────────────┐
│  SELECT PROJECTS TO MIGRATE                         │
├─────────────────────────────────────────────────────┤
│  Search Projects: [         textbox              ]  │
│  [ Select All ] [ Deselect All ] (status: 0 selected)
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ ☐ Project Alpha          (125 tasks)        │   │
│  │   Status: Active | Owner: John Smith        │   │
│  │ ─────────────────────────────────────────── │   │
│  │ ☐ Project Beta           (89 tasks)         │   │
│  │   Status: Completed | Owner: Jane Doe       │   │
│  │ ─────────────────────────────────────────── │   │
│  │ ☑ Project Gamma          (256 tasks)        │   │
│  │   Status: Active | Owner: Bob Johnson       │   │
│  │ ─────────────────────────────────────────── │   │
│  │ ☑ Project Delta          (67 tasks)         │   │
│  │   Status: Planning | Owner: Alice Williams  │   │
│  │ ─────────────────────────────────────────── │   │
│  │ [Gallery continues, scrollable]             │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Selected: 2 projects, Total Tasks: 323            │
│  Estimated Migration Time: ~2 hours                │
│                                                     │
│  [ Go Back ] [ Start Migration ] [ Dashboard ]     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Controls

#### TextBox: txtSearchProjects
```
Properties:
  HintText:     "Search project name..."
  MaxLength:    100
  OnChange:     Filter gallery based on text
```

#### Gallery: galProjects
```
Properties:
  Items:        Filter(
                  'Dataverse (cr_SourceDataverse)'.
                  Items('msdyn_projects'),
                  Or(
                    IsBlank(txtSearchProjects.Value),
                    StartsWith(msdyn_projectname,
                               txtSearchProjects.Value)
                  )
                )
  Layout:       Vertical (wrap)
  SelectMultiple: false
  TemplateFillColor: White
  TemplateHeight: 120px
  Items Per Page: 5 (virtual scrolling)

Template Fields:
  Checkbox (left):     chkSelectProject
  Project Name:        lblProjectName
  Status:              lblProjectStatus
  Owner:               lblProjectOwner
  Task Count:          lblTaskCount
```

#### Checkbox: chkSelectProject (in gallery template)
```
Properties:
  Default:      false
  OnCheck:      Set(varSelectedProject, ThisItem);
                Collect(colSelectedProjects,
                  {projectid: ThisItem.msdyn_projectid,
                   projectname: ThisItem.msdyn_projectname,
                   taskcount: 0})
  OnUncheck:    Remove(colSelectedProjects,
                  LookUp(colSelectedProjects,
                    projectid = ThisItem.msdyn_projectid))
```

#### Label: lblSelectedCount
```
Formula:       Text(CountRows(colSelectedProjects), "0") & " projects selected"
```

#### Label: lblEstimatedTime
```
Formula:       If(
                 CountRows(colSelectedProjects) = 0,
                 "Select projects to see estimate",
                 Text(CountRows(colSelectedProjects) * 35, "0 minutes")
               )
```

#### Button: btnSelectAll
```
Properties:
  Text:         "Select All"
  OnSelect:     ForAll(galProjects.AllItems,
                  If(Not(chkSelectProject.Value),
                    Select(chkSelectProject)
                  )
                )
```

#### Button: btnDeselectAll
```
Properties:
  Text:         "Deselect All"
  OnSelect:     Clear(colSelectedProjects)
```

#### Button: btnStartMigrationNow
```
Properties:
  Text:         "Start Migration"
  OnSelect:
    If(
      CountRows(colSelectedProjects) = 0,
      Notify("Please select at least one project",
             NotificationType.Error),

      Set(varMigrationStartTime, Now());
      ForAll(colSelectedProjects,
        Patch(
          'Dataverse (cr_SourceDataverse)'.'cr_projectmigrations',
          Defaults('Dataverse (cr_SourceDataverse)'.'cr_projectmigrations'),
          {
            cr_sourceprojectid: projectid,
            cr_sourceprojectname: projectname,
            cr_status: 100000000,  // Pending
            cr_migrationstartedby: User(),
            cr_migrationstarteddate: Now()
          }
        );
        // Trigger Power Automate Flow 1
        'Trigger Flow1-ExportProject'(
          projectId: projectid,
          projectName: projectname
        )
      );

      Clear(colSelectedProjects);
      Set(varMigrationActive, true);
      Navigate(Screen3_MigrationDashboard);
      Notify("Migration started! Check dashboard for progress.",
             NotificationType.Success)
    )
```

**Important Note on Flow Triggering**:
- The "Trigger Flow1-ExportProject" is a Power Automate cloud flow that must be created as a manual trigger flow
- Add the flow connection to your canvas app: Insert > Cloud flows > Select the flow
- The flow will be triggered for each selected project

---

## Screen 3: Migration Dashboard (DEFAULT SCREEN)

### Purpose
Real-time monitoring of migration progress with status indicators, progress bars, and error details.

### Layout
```
┌────────────────────────────────────────────────────────┐
│  MIGRATION DASHBOARD (Real-time Status)                │
├────────────────────────────────────────────────────────┤
│ Refresh: [Auto] Last updated: 2024-01-15 14:23:45     │
│                                                        │
│ Filter: [All] [Pending] [Exporting] [Imported] [Error]│
│                                                        │
│ ┌──────────────────────────────────────────────────┐  │
│ │ Project Alpha                                    │  │
│ │ Status: [████████████          ] 60% Importing   │  │
│ │ Tasks: 125 source → ? imported                   │  │
│ │ Started: 2024-01-15 14:00:00                    │  │
│ │ [ View Details ] [ Stop ]                        │  │
│ ├──────────────────────────────────────────────────┤  │
│ │ Project Beta                                     │  │
│ │ Status: [████████████████████] 100% Completed ✓ │  │
│ │ Tasks: 89 source → 89 imported                   │  │
│ │ Completed: 2024-01-15 14:35:20                  │  │
│ │ [ View Details ] [ Verify ]                      │  │
│ ├──────────────────────────────────────────────────┤  │
│ │ Project Gamma                                    │  │
│ │ Status: [   ERROR   ] Failed                     │  │
│ │ Tasks: 256 source → 0 imported                   │  │
│ │ Error: Throttled by Dataverse after 5 actions   │  │
│ │ [ View Error ] [ Retry ]                         │  │
│ └──────────────────────────────────────────────────┘  │
│                                                        │
│ Overall Progress:                                      │
│ [█████████████                 ] 33% (1 of 3 complete)│
│                                                        │
│ [ Go Back ] [ Export Report ] [ Refresh Now ]         │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Controls

#### Timer: timerRefresh
```
Properties:
  Duration:     5000 (milliseconds = 5 seconds)
  Repeat:       true
  AutoStart:    true
  OnTimerEnd:   Refresh(colMigrationTracker);
                Set(varLastRefresh, Now())
```

#### Gallery: galMigrationStatus
```
Properties:
  Items:        colMigrationTracker
  Layout:       Vertical (wrap)
  TemplateFillColor: RGBA(240, 240, 240, 1)
  TemplateHeight: 180px

Template Structure:
  [Project Name]
  [Status Progress Bar]
  [Task Count Summary]
  [Timestamps]
  [Action Buttons]
```

#### Progress Bar (in gallery template)
```
Label: lblStatusBar
Formula:
  If(ThisItem.cr_status = 100000000,
    "● Pending",
  If(ThisItem.cr_status = 100000001,
    "⟳ Exporting",
  If(ThisItem.cr_status = 100000002,
    "⟳ Preparing Import",
  If(ThisItem.cr_status = 100000003,
    "⟳ Importing",
  If(ThisItem.cr_status = 100000004,
    "✓ Completed",
  If(ThisItem.cr_status = 100000005,
    "✗ Failed",
    "Unknown"))))))

ProgressBar: prg_MigrationProgress
Properties:
  Value:        If(ThisItem.cr_tasksimported > 0,
                  ThisItem.cr_tasksimported /
                  ThisItem.cr_taskcount * 100,
                  0)
  Fill:         If(ThisItem.cr_status = 100000004,
                  Color.Green,
                If(ThisItem.cr_status = 100000005,
                  Color.Red,
                If(ThisItem.cr_status = 100000003,
                  Color.Orange,
                  Color.Blue)))
```

#### Button: btnViewError
```
Properties:
  Text:         "View Error"
  Visible:      ThisItem.cr_status = 100000005
  OnSelect:     Set(varSelectedErrorRecord, ThisItem);
                Navigate(Screen4_ErrorDetail)
```

#### Button: btnRetryMigration
```
Properties:
  Text:         "Retry"
  Visible:      ThisItem.cr_status = 100000005
  OnSelect:     Patch(
                  'Dataverse (cr_SourceDataverse)'.
                  'cr_projectmigrations',
                  ThisItem,
                  {
                    cr_status: 100000000,  // Reset to Pending
                    cr_errordetails: "",
                    cr_retrycount: ThisItem.cr_retrycount + 1
                  }
                );
                'Trigger Flow1-ExportProject'(
                  projectId: ThisItem.cr_sourceprojectid,
                  projectName: ThisItem.cr_sourceprojectname
                );
                Notify("Retry initiated", NotificationType.Success)
```

#### Label: lblOverallProgress
```
Formula:       Text(
                 CountIf(colMigrationTracker,
                   cr_status = 100000004) /
                 CountRows(colMigrationTracker) * 100,
                 "0") & "% Complete"
```

#### Button: btnExportReport
```
Properties:
  Text:         "Export Report"
  OnSelect:
    // Prepare CSV data
    Set(varReportData,
      ForAll(colMigrationTracker,
        Concatenate(cr_sourceprojectname, ",",
                   Text(cr_status), ",",
                   Text(cr_taskcount), ",",
                   Text(cr_tasksimported), ",",
                   Text(cr_importedon))
      )
    );
    // Note: Canvas apps don't have direct file export
    // Export to Excel Online or manually copy to clipboard
    Notify("Copy the data from the log view and paste into Excel",
           NotificationType.Information)
```

### OnVisible Formula (for Screen 3)

```
Set(varMigrationActive, true);

// Load migration tracker records from source
ClearCollect(colMigrationTracker,
  'Dataverse (cr_SourceDataverse)'.
  Items('cr_projectmigrations',
    {
      $filter: "cr_status in (100000000, 100000001, 100000002, 100000003, 100000004, 100000005)"
    }
  )
);

// Start refresh timer
Set(varLastRefresh, Now());

// If all completed, show notification
If(
  CountIf(colMigrationTracker,
    Or(cr_status = 100000000, cr_status = 100000001, cr_status = 100000002, cr_status = 100000003)) = 0,
  Notify("All migrations have completed", NotificationType.Success)
)
```

---

## Screen 4: Migration Log

### Purpose
Detailed log viewer for troubleshooting and auditing migrations.

### Layout
```
┌──────────────────────────────────────────────────────┐
│  MIGRATION LOG (Detailed View)                        │
├──────────────────────────────────────────────────────┤
│ Filter by Status: [All] [Failed] [Completed]         │
│ Filter by Date:   [From: __/__] [To: __/__]          │
│                                                      │
│ ┌────────────────────────────────────────────────┐  │
│ │ Project Name  │ Status   │ Tasks  │ Completed │  │
│ ├────────────────────────────────────────────────┤  │
│ │ Project Alpha │ Complete │ 125/89 │ 2024-01-15│  │
│ │ Project Beta  │ Failed   │ 89/0   │ N/A       │  │
│ │ Project Gamma │ Pending  │ 256/0  │ N/A       │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ Selected Record Details:                             │
│ ┌────────────────────────────────────────────────┐  │
│ │ Source Project ID: [GUID]                      │  │
│ │ Target Project ID: [GUID]                      │  │
│ │ Error Details: [Multiline Text]                │  │
│ │ GUID Mapping: [JSON View]                      │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ [ Back ] [ Download Log CSV ] [ Clear Old Logs ]    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Controls

#### Table: tblMigrationLog
```
Properties:
  Items:        Filter(colMigrationTracker,
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

Columns:
  - cr_sourceprojectname
  - cr_status (formatted as text)
  - cr_taskcount & cr_tasksimported (concatenated)
  - cr_importedon (formatted as date)
  - cr_errordetails (preview, click to expand)
```

#### Button: btnViewGUIDMapping
```
Properties:
  Text:         "View GUID Mapping"
  OnSelect:     Set(varShowGUIDMapping, true);
                Set(varSelectedMappingRecord, Selected(tblMigrationLog))
```

#### Dialog: dlgGUIDMapping
```
Title:        "GUID Mapping for Selected Project"
Content:      Label showing formatted JSON from cr_guidmappingjson
Actions:      [ Close ] [ Copy to Clipboard ]

Example display:
{
  "projectMapping": {
    "source-project-guid": "target-project-guid"
  },
  "taskMapping": {
    "source-task-1": "target-task-1",
    "source-task-2": "target-task-2"
  },
  "teamMemberMapping": {
    "source-member-1": "target-member-1"
  }
}
```

---

## App Variables & Collections

### Global Variables

```powerapps
// App startup (OnStart event)
Set(varSourceEnvURL, "");
Set(varTargetEnvURL, "");
Set(varMigrationActive, false);
Set(varLastRefresh, Now());
Set(varSelectedErrorRecord, Blank());
Set(varShowGUIDMapping, false);
Set(varSelectedMappingRecord, Blank());
Set(varMigrationStartTime, Now());

// Status option values (must match Dataverse picklist)
Set(varStatusPending, 100000000);
Set(varStatusExporting, 100000001);
Set(varStatusExported, 100000002);
Set(varStatusImporting, 100000003);
Set(varStatusCompleted, 100000004);
Set(varStatusFailed, 100000005);
```

### Collections

```powerapps
// Collection: Selected projects before migration starts
ClearCollect(colSelectedProjects);
// Schema: { projectid, projectname, taskcount }

// Collection: Migration tracker records
ClearCollect(colMigrationTracker);
// Schema: Copy of cr_projectmigration table rows

// Collection: Error details (for log view)
ClearCollect(colErrorLog);
// Schema: { projectname, status, errordetails, timestamp }
```

---

## Power FX Formulas - Complete

### Screen1: OnVisible
```powerapps
// Set default environment URLs (can be modified later)
Set(varSourceEnvURL, "https://source-org.crm.dynamics.com");
Set(varTargetEnvURL, "https://target-org.crm.dynamics.com");
Set(varSourceConnTest, "Not tested");
Set(varTargetConnTest, "Not tested")
```

### Button: Test Source Connection
```powerapps
Set(varSourceConnTest, "Testing...");
IfError(
  First(
    'Dataverse (cr_SourceDataverse)'.Items('msdyn_projects', {$top: 1})
  ),
  Set(varSourceConnTest, "Failed - Check URL and permissions"),
  Set(varSourceConnTest, "Connected ✓ - Ready to use")
)
```

### Screen2: OnVisible
```powerapps
// Load projects from source
ClearCollect(colSourceProjects,
  'Dataverse (cr_SourceDataverse)'.Items('msdyn_projects',
    {$orderby: "msdyn_projectname asc"}
  )
);

// Initialize selected projects collection
Clear(colSelectedProjects);

// Calculate task counts for each project (optional - adds delay)
ForAll(colSourceProjects,
  Patch(
    colSourceProjects,
    ThisRecord,
    {
      TaskCount: CountIf(
        'Dataverse (cr_SourceDataverse)'.Items('msdyn_projecttasks',
          {$filter: "msdyn_projectid eq '" & msdyn_projectid & "'"}
        )
      )
    }
  )
)
```

### Gallery: galProjects - OnSelect (Checkbox)
```powerapps
// When checkbox selected, add to collection
If(
  chkSelectProject.Value,
  Collect(colSelectedProjects,
    {
      projectid: ThisItem.msdyn_projectid,
      projectname: ThisItem.msdyn_projectname,
      taskcount: CountIf(
        'Dataverse (cr_SourceDataverse)'.Items('msdyn_projecttasks',
          {$filter: "msdyn_projectid eq '" & ThisItem.msdyn_projectid & "'"}
        )
      )
    }
  ),
  Remove(colSelectedProjects,
    LookUp(colSelectedProjects,
      projectid = ThisItem.msdyn_projectid)
  )
)
```

### Button: Start Migration (Screen2)
```powerapps
If(
  CountRows(colSelectedProjects) = 0,
  Notify("Please select at least one project", NotificationType.Error),

  // Create migration tracker records
  ForAll(colSelectedProjects,
    Patch(
      'Dataverse (cr_SourceDataverse)'.'cr_projectmigrations',
      Defaults('Dataverse (cr_SourceDataverse)'.'cr_projectmigrations'),
      {
        cr_sourceprojectid: projectid,
        cr_sourceprojectname: projectname,
        cr_status: 100000000,  // Pending
        cr_migrationstartedby: User(),
        cr_migrationstarteddate: Now(),
        cr_taskcount: taskcount
      }
    )
  );

  // Clear selection and go to dashboard
  Clear(colSelectedProjects);
  Set(varMigrationActive, true);
  Set(varMigrationStartTime, Now());
  Navigate(Screen3_MigrationDashboard)
)
```

### Screen3: OnVisible
```powerapps
// Load migration tracker records
ClearCollect(colMigrationTracker,
  'Dataverse (cr_SourceDataverse)'.Items('cr_projectmigrations',
    {$orderby: "cr_migrationstarteddate desc"}
  )
);

Set(varLastRefresh, Now());
Set(varMigrationActive, true)
```

### Timer: timerRefresh - OnTimerEnd
```powerapps
ClearCollect(colMigrationTracker,
  'Dataverse (cr_SourceDataverse)'.Items('cr_projectmigrations',
    {$orderby: "cr_migrationstarteddate desc"}
  )
);

Set(varLastRefresh, Now());

// Show toast if all completed
If(
  CountIf(colMigrationTracker,
    Or(cr_status = 100000000,
       cr_status = 100000001,
       cr_status = 100000002,
       cr_status = 100000003)) = 0
  And CountRows(colMigrationTracker) > 0,

  Notify("All migrations have completed", NotificationType.Success)
)
```

### Button: Retry Failed Migration
```powerapps
Patch(
  'Dataverse (cr_SourceDataverse)'.'cr_projectmigrations',
  ThisItem,
  {
    cr_status: 100000000,
    cr_errordetails: "",
    cr_retrycount: ThisItem.cr_retrycount + 1
  }
);

Notify("Migration reset to Pending - will retry", NotificationType.Success)
```

### Screen4: OnVisible (Log)
```powerapps
// Load all migration history
ClearCollect(colMigrationTracker,
  'Dataverse (cr_SourceDataverse)'.Items('cr_projectmigrations',
    {$orderby: "cr_migrationstarteddate desc"}
  )
);

Set(varFilterStatus, Blank());
Set(varFilterDateFrom, Blank());
Set(varFilterDateTo, Blank())
```

---

## Accessibility Features

### Labels
Every input control has an associated label (best practice):
```
Label: "Source Environment URL"
TextBox: txtSourceURL (with AriaLabel: "Enter source environment URL")
```

### Keyboard Navigation
All buttons support Tab key navigation:
```
TabIndex: Sequential (1, 2, 3...)
Visible: Use IsVisible to hide disabled controls
```

### High Contrast
Colors meet WCAG AA contrast standards:
```
Text: Color.Black on Color.White (7:1 ratio)
Buttons: Blue (#0078D4) text on light gray background
Status: Color.Red (#E81123) for errors, Color.Green (#107C10) for success
```

### Screen Reader Support
```
Gallery items have descriptive alt text:
AriaLabel: "Project name: " & ThisItem.cr_sourceprojectname &
           ", Status: " & ThisItem.cr_status
```

---

## Performance Optimization Tips

### 1. Delegated Filtering
Always use Dataverse filters in Items formula:
```
GOOD:   'Dataverse...'.Items('Table', {$filter: "Status eq 'Active'"})
BAD:    Filter(AllItems, Status = "Active") // Client-side filtering
```

### 2. Virtual Galleries
Enable virtual scrolling for large lists:
```
Properties:
  AllowVerticalScroll: true
  AllowHorizontalScroll: false
  Height: Set to specific value (not Fill)
  TemplatePadding: 10
```

### 3. Lazy Loading
Don't load all tasks upfront:
```
// Load on demand when user clicks project details
OnSelect:
  If(
    IsBlank(ThisItem.TaskDetails),
    Set(varSelectedProjectTasks,
      'Dataverse...'.Items('msdyn_projecttasks',
        {$filter: "msdyn_projectid eq '" & ThisItem.msdyn_projectid & "'"}
      )
    )
  )
```

### 4. Caching
Cache migration tracker results:
```
// Refresh every 5 seconds, not every action
Timer: timerRefresh with Duration: 5000
```

---

## Testing Checklist

- [ ] Canvas app loads without errors
- [ ] Source Dataverse connection works
- [ ] Target Dataverse connection works
- [ ] Project gallery displays 190+ projects
- [ ] Search/filter works correctly
- [ ] Checkbox selection and deselection works
- [ ] "Start Migration" button creates tracker records
- [ ] Migration dashboard updates every 5 seconds
- [ ] Status colors update correctly (pending → exporting → completed)
- [ ] Error messages display clearly
- [ ] Retry button resets failed projects
- [ ] Log view shows all historical migrations
- [ ] GUID mapping JSON displays correctly
- [ ] App works on mobile (responsive design)
- [ ] Tab key navigation works throughout
- [ ] Screen reader can read all content

---

## Deployment Considerations

### Before Deploying to Production

1. **Set Connection References**
   - Ensure cr_SourceDataverse points to correct environment
   - Ensure cr_TargetDataverse points to correct environment

2. **Set Environment URLs** (Screen 1)
   - Change from test URLs to production URLs
   - Or set to read-only if standardized

3. **Configure User Permissions**
   - Users need Power Apps license
   - Users need read access to source environment
   - Canvas app can only be used by licensed users

4. **Test with Pilot Group**
   - Start with 1-2 test projects
   - Verify all flows complete successfully
   - Check that target projects have correct data

5. **Document for Users**
   - Create step-by-step guide for selecting projects
   - Document how to check migration status
   - Document what to do if migration fails

---

## Troubleshooting Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Gallery shows no projects | Dataverse connection not authenticated | Go to Screen 1, test connection, wait 10 seconds |
| Checkbox not working | OnSelect formula has error | Check that colSelectedProjects collection exists |
| Start Migration button disabled | No projects selected | Select at least one project with checkbox |
| Dashboard shows no status | Migration tracker records not created | Check Power Automate flow is enabled |
| Timer not refreshing | timerRefresh disabled or stopped | Go to Screen 3, check timer control properties |
| Slow app load | Loading 190 projects + task counts | Remove task count calculation, show in details only |
| Connection timeout | Network issue or environment down | Check environment URL, test connection again |

