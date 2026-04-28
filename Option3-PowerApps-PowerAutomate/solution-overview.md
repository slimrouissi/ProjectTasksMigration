# Dynamics 365 Project Operations Migration Solution Architecture

## Executive Summary

This is a **Power Platform-native solution** designed for citizen developers and low-code architects to migrate ~190 Dynamics 365 Project Operations projects with thousands of tasks, dependencies, assignments, and 50+ custom fields between environments.

**Key Design Decision**: This is NOT a pure canvas app solution. The canvas app is a **thin UI layer** that monitors and triggers migrations. The actual migration engine is **Power Automate Cloud Flows** using the Schedule API (OperationSet pattern).

---

## System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         END USER - POWER APPS                         │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │   Canvas App UI    │
                          │  (Thin Layer)      │
                          └────────┬───────────┘
                                   │
                ┌──────────────────┼──────────────────┐
                │                  │                  │
                ▼                  ▼                  ▼
        ┌─────────────┐   ┌──────────────┐   ┌──────────────┐
        │Environment  │   │   Project    │   │  Migration   │
        │ Config      │   │  Selection   │   │  Dashboard   │
        └─────────────┘   └──────────────┘   └──────────────┘
                │                  │                  │
                └──────────────────┼──────────────────┘
                                   │
                   ┌───────────────┴──────────────┐
                   │  Power Automate Triggers    │
                   │  (Start Migration Button)   │
                   └───────────────┬──────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
        ▼                          ▼                          ▼
┌──────────────────┐   ┌────────────────────┐   ┌──────────────────┐
│ SOURCE DATAVERSE │   │ MIGRATION TRACKER  │   │ TARGET DATAVERSE │
│                  │   │ (Custom Table)     │   │                  │
│ • Projects       │   │                    │   │ • Projects       │
│ • Tasks          │   │ cr_projectmigration│   │ • Tasks          │
│ • Team Members   │   │ - status tracking  │   │ • Team Members   │
│ • Dependencies   │   │ - error logs       │   │ • Dependencies   │
│ • Assignments    │   │ - GUID mappings    │   │ • Assignments    │
│ • Custom Fields  │   │ - task counts      │   │ • Custom Fields  │
└────────┬─────────┘   │ - timestamps       │   └────────┬─────────┘
         │             └────────────────────┘            │
         │                                                │
         └────────────────┬─────────────────────────────┘
                          │
        ┌─────────────────▼──────────────────┐
        │   Power Automate Cloud Flows       │
        │   (Migration Engine)               │
        └─────────────────┬──────────────────┘
                          │
        ┌─────────────────┴───────────────────┐
        │                                     │
        ▼                                     ▼
┌──────────────────────────┐    ┌───────────────────────────┐
│   Flow 1: Export Project │    │  Flow 2: Import Project   │
│                          │    │                           │
│ • Read from Source       │    │ • Create in Target        │
│ • Serialize all data     │    │ • Use Schedule API        │
│ • Store in Migration     │    │ • Manage GUID mappings    │
│   Tracker               │    │ • Execute OperationSets   │
│ • Mark as Exported      │    │ • Update status           │
└──────────────┬───────────┘    └───────────┬───────────────┘
               │                            │
               └────────────┬───────────────┘
                            │
                ┌───────────▼──────────┐
               │ Flow 3 (Optional):    │
               │ Batch Orchestrator    │
               │ - Queue management    │
               │ - Sequential processing
               │ - Overall progress    │
               └───────────────────────┘
```

---

## Data Flow: Detailed Processing Steps

### Phase 1: User Initiates Migration
```
1. User opens Canvas App
2. Logs in with their Dynamics 365 credentials
3. Configures source/target environments
4. Browses and selects projects to migrate
5. Clicks "Start Migration" button
```

### Phase 2: Canvas App Triggers Flows
```
1. Canvas app creates rows in cr_projectmigration table
   - status = "Pending"
   - sourceprojectid = user-selected project
   - sourceprojectname = project name

2. Canvas app calls Power Automate Flow 1 (Export) for each project
   OR Flow 3 (Orchestrator) queues all projects

3. Canvas app shows "Migration in Progress" dashboard
```

### Phase 3: Export Flow Executes (Flow 1)
```
Input: Migration Tracker row with status = "Pending"

Steps:
1. Update status → "Exporting"
2. Query Source Dataverse for:
   - msdyn_project record (all fields, 50+ custom fields)
   - msdyn_projectteam members
   - msdyn_projecttask records (WITH pagination for >1000 tasks)
   - msdyn_projecttaskdependency records
   - msdyn_projectassignment records
   - msdyn_projectbucket records
   - Any custom field values
3. Serialize all data into a single JSON object
4. Store JSON in migration tracker (large text field)
5. Store task count in cr_taskcount
6. Update status → "Exported"
7. If error: status → "Failed", populate cr_errordetails

Output: Migration Tracker row with status = "Exported"
         Exported data stored in JSON field
```

### Phase 4: Import Flow Executes (Flow 2)
```
Input: Migration Tracker row with status = "Exported"

Steps (Phase 2A - Create Project):
1. Update status → "Importing"
2. Parse exported JSON
3. Create msdyn_project in target Dataverse
   - Copy all field values from exported data
   - Record new project GUID in mapping table
4. Create GUID mapping variable: sourceGUID → targetGUID

Steps (Phase 2B - Schedule API Operations):
5. Create first OperationSet for Team Members & Tasks
6. Loop through Team Members:
   - Call Schedule API msdyn_PssCreateV1
   - Add each to OperationSet
7. Loop through Tasks (sorted by OutlineLevel, parents first):
   - Call Schedule API msdyn_PssCreateV1
   - Remap parent task GUIDs using mapping
   - Add to OperationSet
8. Execute OperationSet
9. Poll for completion (max 30 minutes)
10. Store task GUIDs in mapping from response

Steps (Phase 2C - Schedule API Phase 2):
11. Create second OperationSet for Dependencies & Assignments
12. Loop through Dependencies:
    - Remap predecessor/successor task GUIDs
    - Call Schedule API msdyn_PssCreateV1
13. Loop through Assignments:
    - Remap task GUIDs and resource references
    - Call Schedule API msdyn_PssCreateV1
14. Execute Phase 2 OperationSet
15. Poll for completion

Steps (Phase 2D - Finalize):
16. Update migration tracker:
    - status → "Completed"
    - cr_targetprojectid = new project GUID
    - cr_guidmappingjson = full GUID map
    - cr_importedon = current timestamp
    - cr_tasksimported = count from response
17. If error at any step:
    - Catch exception
    - Update status → "Failed"
    - Populate cr_errordetails with exception info

Output: New project in target environment with all tasks, relationships, and custom fields
```

### Phase 5: Canvas App Monitors Progress
```
Continuous Loop (Timer control):
1. Refresh migration tracker records every 5 seconds
2. Show status for each project:
   - Pending → gray
   - Exporting → blue with progress
   - Exported → light blue
   - Importing → orange with progress bar
   - Completed → green with checkmark
   - Failed → red with error details
3. If user clicks on failed project:
   - Show full error message from cr_errordetails
   - Allow user to retry or investigate
```

---

## Component Breakdown

### 1. Canvas App (Thin UI Layer)
**Responsibility**: UI, selection, triggering, status monitoring
**Does NOT do**: The actual data migration

**Screens**:
- Screen 1: Environment Configuration
- Screen 2: Project Selection (with checkbox gallery)
- Screen 3: Migration Dashboard (status tracking)
- Screen 4: Migration Log (detailed viewing)

**Key Connection References**:
- `connSourceDataverse`: Connection to SOURCE environment
- `connTargetDataverse`: Connection to TARGET environment

---

### 2. Power Automate Flow 1: Export Project
**Trigger**: Row added to cr_projectmigration with status = "Pending"
**Duration**: ~30 seconds to 5 minutes (depending on project size)

**Key Actions**:
- List rows from source (with filtering and pagination)
- Compose JSON
- Update migration tracker
- Error handling with Try/Catch

**Output**: Migration tracker row with status = "Exported"

---

### 3. Power Automate Flow 2: Import Project
**Trigger**: Row updated on cr_projectmigration when status = "Exported"
**Duration**: 5-30 minutes (depending on task count and Schedule API processing)

**Key Actions**:
- Parse JSON
- Create project in target
- Build OperationSet JSON
- HTTP POST to Schedule API endpoints
- Poll for OperationSet completion
- Map GUIDs
- Update migration tracker

**Output**: New project in target, mapping stored in tracker

---

### 4. Power Automate Flow 3: Batch Orchestrator (Optional)
**Trigger**: Manual (from canvas app or scheduled)
**Purpose**: Process multiple projects sequentially

**Key Actions**:
- Query pending migration tracker rows
- Loop through each
- Call Flow 1 for each
- Wait for Flow 1 completion
- Call Flow 2 for each
- Manage overall progress

---

### 5. Custom Dataverse Table: cr_projectmigration
**Purpose**: Single source of truth for migration status
**Located in**: SOURCE environment

**Fields** (see MigrationTracker-schema.json):
- cr_sourceprojectid (GUID of source project)
- cr_sourceprojectname (string)
- cr_targetprojectid (GUID of target project, populated after import)
- cr_status (optionset: Pending, Exporting, Exported, Importing, Completed, Failed)
- cr_errordetails (multiline text, up to 4000 chars)
- cr_exportedon (datetime)
- cr_importedon (datetime)
- cr_taskcount (whole number)
- cr_tasksimported (whole number)
- cr_guidmappingjson (multiline text, stores JSON GUID mappings)
- cr_exportedjson (file column, stores exported data)

---

## Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| UI Layer | Power Apps Canvas App | Low-code, responsive, citizen developer friendly |
| Migration Engine | Power Automate Cloud Flows | Native Dataverse connector, Schedule API support |
| Data Storage | Dataverse (custom table) | Native to Dynamics 365, no external DB required |
| API Integration | HTTP Connector + Azure AD | Required for Schedule API calls |
| Connections | App Registration (Service Principal) | For programmatic access to target environment |

---

## Why This Architecture?

### Why NOT Canvas App Alone?
- **Delegation Limits**: Canvas apps have strict limits on bulk operations (~500 rows max in galleries)
- **Timeouts**: Power Apps activities timeout after 5 minutes; migration needs 30+ minutes
- **Memory**: Processing 1000+ tasks in-memory in canvas app causes performance issues
- **API Calls**: Canvas app connectors have lower throttling limits

### Why Power Automate as Engine?
- **Long-running Support**: Flows can run for 60+ minutes per run
- **Better API Limits**: Cloud connector has higher throttling than canvas
- **Background Processing**: Flows run without user interaction
- **Error Handling**: Try/Catch, retry logic, exponential backoff
- **Audit Trail**: Power Automate run history is queryable and auditable
- **Scheduled Support**: Can run on schedule, not just on-demand

### Why Custom Migration Tracker Table?
- **Status Persistence**: Survives app refreshes and user logouts
- **Error Details**: Can store detailed error messages without app UI constraints
- **GUID Mapping**: Essential for linking source and target projects
- **Audit Trail**: Records when export/import occurred
- **Replayability**: If migration fails, user can retry without re-selecting

---

## Key Design Patterns

### Pattern 1: Asynchronous Processing
```
Canvas App                Power Automate Flow
    │                              │
    ├─ Create tracker row          │
    ├─ Trigger Flow 1              │
    │                              │
    └─ Move to Dashboard           Flow 1 Executes (async)
       (Stop waiting)              │
                                   ├─ Export data
                                   ├─ Update tracker
                                   └─ Complete

       Canvas App Timer:
       Every 5 seconds:
       ├─ Query tracker rows
       ├─ Show status
       └─ Refresh UI
```

### Pattern 2: OperationSet Batching
```
Instead of:  Create Task 1 → Create Task 2 → Create Task 3 (3 API calls)

Do:          OperationSet {
               operations: [
                 { operation: "Create", entity: "Task 1" },
                 { operation: "Create", entity: "Task 2" },
                 { operation: "Create", entity: "Task 3" }
               ]
             }
             Execute OperationSet (1 API call, 3 operations)
```

### Pattern 3: GUID Mapping for Relationships
```
Source Project Tasks:
  Task A (GUID: 1111-1111) → Parent
    Task B (GUID: 2222-2222) → Child of A
    Task C (GUID: 3333-3333) → Child of A
  Task D (GUID: 4444-4444) → Parent

During Import:
1. Schedule API creates tasks, returns new GUIDs
2. Store mapping:
   {
     "1111-1111": "aaaa-aaaa",  // Task A old → new
     "2222-2222": "bbbb-bbbb",  // Task B old → new
     ...
   }
3. When creating Task B, use new parent GUID "aaaa-aaaa"
```

### Pattern 4: Phased OperationSets
```
Phase 1 OperationSet: Team Members + Tasks + Buckets
  (Must complete before Phase 2 because Phase 2 references created tasks)

Phase 2 OperationSet: Dependencies + Assignments
  (References task GUIDs from Phase 1 results)

Why? Schedule API requires parents to exist before children.
```

---

## Scalability Considerations

### How Many Projects Can This Handle?
- **Sequential**: 1 project at a time, unlimited total
- **Time per project**: 5 min (export) + 30 min (import) = ~35 min per project
- **For 190 projects**: ~110 hours at sequential (4-5 days continuous)

### Optimization Options
1. **Run multiple concurrent flows**: Power Automate premium plan allows up to 200 cloud flow actions/min
2. **Parallel Flow 1 (Export)**: Multiple projects can export simultaneously
3. **Sequential Flow 2 (Import)**: Keep imports sequential to avoid target environment overload
4. **Batch Orchestrator**: Manages queue, starts next export when current import finishes

---

## Error Handling Strategy

### Errors are Caught at Three Levels

**Level 1: Flow Action Level**
```
Try Scope:
  - List rows from Dataverse
Catch Scope:
  - If throttled, wait 30 seconds and retry
  - If permission denied, fail with error message
```

**Level 2: Flow Scope Level**
```
Try Scope:
  - All Phase 1 operations (export + create)
Catch Scope:
  - Update tracker status → "Failed"
  - Store exception message
  - Stop flow
```

**Level 3: Canvas App Level**
```
Timer:
  - Check for failed projects
  - Display error to user
  - Allow manual retry
```

### Specific Error Handling Cases

| Error | Action |
|-------|--------|
| Dataverse throttled | Retry after 30 sec (3 attempts) |
| Source project not found | Fail, log to tracker |
| Target environment unreachable | Fail with network error |
| Permission denied on target | Fail, check user permissions |
| Task count exceeds limit | Automatically paginate, retry |
| OperationSet fails | Log response, mark tracker as failed |
| GUID mapping corruption | Manual investigation required |

---

## Data Transformation Rules

### Fields Copied "As-Is"
- msdyn_projectname
- msdyn_description
- All 50+ custom fields (assuming same schema in target)
- msdyn_projectstatus
- msdyn_projectowner
- msdyn_customercountry

### Fields Requiring Transformation
- **msdyn_projectteamid** (GUID): Remapped via mapping table
- **msdyn_taskid** (GUID): Remapped via mapping table
- **msdyn_parenttaskid** (GUID): Remapped via mapping variable
- **msdyn_predecessortaskid** (GUID): Remapped via mapping variable
- **msdyn_succeedertaskid** (GUID): Remapped via mapping variable
- **msdyn_resourceassignmentid** (GUID): Remapped via mapping variable

### Fields to Skip
- **createdby, modifiedby** (System fields, don't copy)
- **createdon, modifiedon** (System fields, don't copy)
- **Record IDs** (System fields, don't copy)

---

## Security & Permissions

### Required Permissions - Source Environment
- Read: msdyn_project, msdyn_projecttask, msdyn_projectteam, msdyn_projectdependency, msdyn_projectassignment
- Read/Write: cr_projectmigration (custom table)

### Required Permissions - Target Environment
- Create: msdyn_project, msdyn_projecttask, msdyn_projectteam, msdyn_projectdependency, msdyn_projectassignment
- Execute: Schedule API actions (msdyn_CreateOperationSetV1, msdyn_PssCreateV1, msdyn_ExecuteOperationSetV1)

### Connection References
- User-based (canvas app, interactive flows): Use licensed user account
- System-based (Flow 2, Schedule API calls): Use App Registration service principal
  - Requires Power Automate premium license
  - Requires "HTTP with Azure AD" connector

---

## Limitations & Constraints

### Power Automate Limits
- **Flow run duration**: 60 minutes max (hard limit)
- **Actions per flow**: 500 actions max per run
- **HTTP request timeout**: 120 seconds
- **Dataverse API calls**: 6000 requests per 5 minutes (throttle window)

### Dynamics 365 Project Operations Limits
- **OperationSet payload**: Max ~100 operations per execution (to avoid timeout)
- **Task depth**: Unlimited, but sorted by OutlineLevel in export
- **Custom fields**: All supported, but must exist in target schema

### Power Apps Canvas App Limits
- **Gallery**: Max ~500 items displayed without virtualizing
- **Data load**: ~100MB per app load
- **Timeout**: 5 minutes for actions

### Data Size Limits
- **Exported JSON field**: Stored in Dataverse multiline text (4000 char limit) or file column (unlimited)
- **GUID mapping JSON**: Multiline text (4000 char limit per project)

---

## Monitoring & Observability

### Canvas App Monitoring
- Real-time status dashboard
- Error detail viewer
- Task count progress bars
- Timestamps (exported/imported)

### Power Automate Monitoring
- Power Automate run history (each flow shows status)
- Failed flow notifications (email to admin)
- Duration tracking

### Dataverse Monitoring
- Query cr_projectmigration records
- Filter by status and date
- Export migration audit trail

### Recommended KPIs
- Total projects migrated per day
- Average export time per project
- Average import time per project
- Success rate (%)
- Failed projects count
- Total tasks migrated

---

## Migration Workflow Summary

```
START
  │
  ├─ User opens Canvas App
  │
  ├─ User selects 5 projects (checkboxes)
  │
  ├─ User clicks "Start Migration"
  │
  ├─ Canvas app FOR EACH project:
  │   ├─ Create cr_projectmigration row (status=Pending)
  │   ├─ Trigger Flow 1 (Export)
  │   └─ Move to Dashboard screen
  │
  ├─ [Background] Flow 1 executes for each project:
  │   ├─ Update status → Exporting
  │   ├─ Query source environment
  │   ├─ Compose JSON
  │   ├─ Update status → Exported
  │   └─ Trigger Flow 2
  │
  ├─ [Background] Flow 2 executes for each project:
  │   ├─ Update status → Importing
  │   ├─ Create project in target
  │   ├─ Create OperationSet 1
  │   ├─ Loop: Add team members & tasks
  │   ├─ Execute OperationSet 1
  │   ├─ Poll for completion
  │   ├─ Create OperationSet 2
  │   ├─ Loop: Add dependencies & assignments
  │   ├─ Execute OperationSet 2
  │   ├─ Poll for completion
  │   ├─ Update status → Completed
  │   └─ Store GUID mapping
  │
  ├─ Canvas app timer:
  │   ├─ Every 5 seconds: Refresh tracker query
  │   ├─ Update status indicators
  │   ├─ Show error details if failed
  │   └─ Show progress bars
  │
  ├─ [Manual] User monitors dashboard
  │   ├─ Can click on failed projects
  │   ├─ Can view error details
  │   ├─ Can retry failed projects
  │   └─ Can export migration report
  │
  └─ END (all projects completed or failed)
```

---

## File Structure

```
/ProjectTasksMigration/Option3-PowerApps-PowerAutomate/
│
├─ solution-overview.md                        (THIS FILE)
│
├─ README.md                                   (Setup guide)
│
├─ dataverse-tables/
│  └─ MigrationTracker-schema.json             (Custom table definition)
│
├─ canvas-app/
│  ├─ App-Design.md                            (Visual design + screens)
│  └─ PowerFx-Formulas.md                      (All Power Fx code)
│
├─ power-automate-flows/
│  ├─ Flow1-ExportProject.md                   (Export flow spec)
│  ├─ Flow2-ImportProject.md                   (Import flow spec)
│  ├─ Flow3-BatchOrchestrator.md               (Orchestrator flow spec)
│  └─ ScheduleAPI-HTTP-Actions.md              (Schedule API reference)
│
└─ setup/
   └─ ConnectionReferences.md                  (Connection setup guide)
```

---

## Next Steps

1. **Review this document** with your team
2. **Create the custom Dataverse table** (see MigrationTracker-schema.json)
3. **Set up connection references** (see setup/ConnectionReferences.md)
4. **Build Power Automate flows** (see power-automate-flows/)
5. **Build canvas app** (see canvas-app/)
6. **Test with 1-2 projects** before full migration
7. **Monitor and troubleshoot** using the dashboard

For detailed step-by-step instructions, see README.md.

