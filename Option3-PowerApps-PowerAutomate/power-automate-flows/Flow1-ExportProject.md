# Power Automate Flow 1: Export Project

## Flow Overview

**Flow Name**: Flow1_ExportProject

**Purpose**: Extract all data from a source Dynamics 365 Project Operations project and prepare it for import into the target environment.

**Trigger Type**: Automated (triggered when cr_projectmigration record is created with status = "Pending")

**Duration**: 30 seconds to 5 minutes per project (depending on task count)

**Estimated Actions**: 25-30 actions per flow run

---

## Flow Trigger Configuration

### Trigger Type: When a row is added

Configure the trigger to fire when a new migration tracker record is created:

```
Connector:        Dataverse
Action:           When a row is added
Table:            cr_projectmigrations
Scope:            Organization
Wait for validation: Yes
```

### Trigger Condition (Optional)

Add a condition to only process rows with status = "Pending":

```
Field:            cr_status
Operator:         equals
Value:            100000000  (Pending option value)
```

**Note**: Alternatively, canvas app can call this flow via HTTP trigger. See "Alternative Trigger" section below.

---

## Complete Flow Actions

### Action 1: Set Status to Exporting

Update the migration tracker record to show that export has started.

```
Connector:        Dataverse
Action:           Update a row
Table:            cr_projectmigrations
Row ID:           cr_projectmigrationid (from trigger)
Columns:
  cr_status:      100000001  (Exporting)
  cr_exportedon:  Leave blank (will populate when done)
```

**Configuration Steps in Power Automate**:
1. Click "+ New step"
2. Search for "Dataverse"
3. Select "Update a row"
4. Fill in:
   - Environment: Select cr_SourceDataverse
   - Table Name: cr_projectmigrations
   - Row ID: cr_projectmigrationid (dynamic content from trigger)
5. Click "Edit in advanced mode" and paste:

```json
{
  "cr_status": 100000001,
  "msdyn_name": "@{concat('Export_', utcNow('yyyyMMdd_HHmmss'))}"
}
```

---

### Action 2: Get Project Record from Source

Retrieve the complete project record with all fields from the source environment.

```
Connector:        Dataverse
Action:           Get a row
Table:            msdyn_projects (in cr_SourceDataverse connection)
Row ID:           cr_sourceprojectid (from trigger)
Column Selection: All columns
```

**Configuration Steps**:
1. Click "+ New step"
2. Search for "Dataverse"
3. Select "Get a row"
4. Environment: cr_SourceDataverse
5. Table Name: msdyn_projects
6. Row ID: Select "cr_sourceprojectid" from dynamic content
7. Click "Show advanced options"
8. Select Columns: Leave empty to get all (or list specific 50+ custom fields)

**Store in Variable**:
```
Variable Name: varSourceProject
Value: [Entire row from Action 2]
```

Add this action:
```
Connector:        Variables
Action:           Initialize variable
Name:             varSourceProject
Type:             Object
Value:            [Select the output from "Get a row" action]
```

---

### Action 3: Get Team Members (List rows)

Retrieve all team members assigned to the source project.

```
Connector:        Dataverse
Action:           List rows
Table:            msdyn_projectteams (in cr_SourceDataverse)
Filter:           msdyn_projectid eq '<PROJECT_ID>'
Select Columns:   msdyn_projectteamid, msdyn_projectid, msdyn_teamid, msdyn_resourceid, msdyn_role, etc.
Pagination:       No (typically <100 team members)
```

**Configuration Steps**:
1. Click "+ New step"
2. Search for "Dataverse"
3. Select "List rows"
4. Environment: cr_SourceDataverse
5. Table Name: msdyn_projectteams
6. Filter Query:
```
msdyn_projectid eq '@{body('Get_project_record')?['msdyn_projectid']}'
```
7. Click "Show advanced options"
8. Order By: msdyn_createdon asc
9. Select Columns: msdyn_projectteamid,msdyn_projectid,msdyn_teamid,msdyn_resourceid,msdyn_role,msdyn_name

**Store in Variable**:
```
Connector:        Variables
Action:           Initialize variable
Name:             varTeamMembers
Type:             Array
Value:            value (from list rows output)
```

---

### Action 4: Get Tasks with Pagination

Retrieve all tasks assigned to the source project, handling pagination for >1000 tasks.

**Part A: Initialize Pagination Variables**

```
Connector:        Variables
Action:           Initialize variable
Name:             varAllTasks
Type:             Array
Value:            []

Connector:        Variables
Action:           Initialize variable
Name:             varTaskPageNumber
Type:             Integer
Value:            1
```

**Part B: Do Until Loop for Pagination**

```
Connector:        Control
Action:           Do until
Property:         varTaskPageNumber
Operator:         is greater than or equal to
Value:            varTaskMaxPages

Actions inside loop:
1. List rows (tasks)
2. Append to varAllTasks array
3. Increment varTaskPageNumber
```

**Part B1: List Tasks (inside loop)**

```
Connector:        Dataverse
Action:           List rows
Table:            msdyn_projecttasks (in cr_SourceDataverse)
Filter:           msdyn_projectid eq '<PROJECT_ID>'
Select Columns:   All task fields
Top Count:        250
Skip:             @{mul(sub(variables('varTaskPageNumber'), 1), 250)}
```

**Configuration**:
```
Environment: cr_SourceDataverse
Table Name: msdyn_projecttasks
Filter Query:
  msdyn_projectid eq '@{body('Get_project_record')?['msdyn_projectid']}'
Top Count: 250
Skip: @{mul(sub(variables('varTaskPageNumber'), 1), 250)}
Order By: msdyn_outlinelevel asc, msdyn_orderindex asc
Select Columns: msdyn_projecttaskid,msdyn_projectid,msdyn_parenttaskid,
                msdyn_taskname,msdyn_outlinelevel,msdyn_orderindex,
                msdyn_duration,msdyn_durationformat,msdyn_scheduledstart,
                msdyn_scheduledend,msdyn_actualstart,msdyn_actualend,
                msdyn_percentcomplete,msdyn_description,
                [all 50+ custom fields]
```

**Part B2: Append to Array (inside loop)**

```
Connector:        Variables
Action:           Append to array variable
Name:             varAllTasks
Value:            @{body('List_tasks')?['value']}
```

**Part B3: Increment Counter (inside loop)**

```
Connector:        Variables
Action:           Increment variable
Name:             varTaskPageNumber
Increment value:  1
```

**Part C: Set varAllTasks if pagination needed**

If task count > 250, need to handle pagination. Set variable:

```
Connector:        Variables
Action:           Initialize variable
Name:             varTaskMaxPages
Type:             Integer
Value:            @{add(div(length(body('List_tasks')?['value']), 250), 1)}
```

---

### Action 5: Get Dependencies (List rows)

Retrieve all task dependency relationships.

```
Connector:        Dataverse
Action:           List rows
Table:            msdyn_projecttaskdependencies (in cr_SourceDataverse)
Filter:           (Dependency record contains tasks from this project)
Select Columns:   All dependency fields
Pagination:       Yes (Do until loop if >250)
```

**Configuration**:
```
Environment: cr_SourceDataverse
Table Name: msdyn_projecttaskdependencies
Filter Query:
  msdyn_projectid eq '@{body('Get_project_record')?['msdyn_projectid']}'
Top Count: 250
Order By: msdyn_createdon asc
Select Columns: msdyn_projecttaskdependencyid,msdyn_projectid,
                msdyn_predecessortaskid,msdyn_succeedertaskid,
                msdyn_dependencytype,msdyn_lag,msdyn_lagformat
```

**Store in Variable**:
```
Connector:        Variables
Action:           Initialize variable
Name:             varDependencies
Type:             Array
Value:            value (from list rows)
```

---

### Action 6: Get Assignments (List rows)

Retrieve all resource assignments to tasks.

```
Connector:        Dataverse
Action:           List rows
Table:            msdyn_projectassignments (in cr_SourceDataverse)
Filter:           (Assignment belongs to this project's tasks)
Select Columns:   All assignment fields
Pagination:       Yes (Do until loop if >250)
```

**Configuration**:
```
Environment: cr_SourceDataverse
Table Name: msdyn_projectassignments
Filter Query:
  msdyn_projectid eq '@{body('Get_project_record')?['msdyn_projectid']}'
Top Count: 250
Order By: msdyn_createdon asc
Select Columns: msdyn_projectassignmentid,msdyn_projectid,
                msdyn_projecttaskid,msdyn_resourceassignmentid,
                msdyn_assignedresourceid,msdyn_allocatedhoursperday,
                msdyn_billingtype,msdyn_effort,msdyn_plannedwork,
                msdyn_actualwork,msdyn_remainingwork
```

**Store in Variable**:
```
Connector:        Variables
Action:           Initialize variable
Name:             varAssignments
Type:             Array
Value:            value (from list rows)
```

---

### Action 7: Get Buckets (List rows)

Retrieve project buckets (if using bucket-based organization).

```
Connector:        Dataverse
Action:           List rows
Table:            msdyn_projectbuckets (in cr_SourceDataverse)
Filter:           msdyn_projectid eq '<PROJECT_ID>'
```

**Configuration**:
```
Environment: cr_SourceDataverse
Table Name: msdyn_projectbuckets
Filter Query:
  msdyn_projectid eq '@{body('Get_project_record')?['msdyn_projectid']}'
Select Columns: msdyn_projectbucketid,msdyn_projectid,msdyn_name,
                msdyn_description,msdyn_isarchived
```

**Store in Variable**:
```
Connector:        Variables
Action:           Initialize variable
Name:             varBuckets
Type:             Array
Value:            value (from list rows)
```

---

### Action 8: Compose Exported JSON

Combine all extracted data into a single JSON object for export.

```
Connector:        Data Operations
Action:           Compose
Inputs:
{
  "project": {
    "msdyn_projectid": "[source project GUID]",
    "msdyn_projectname": "[project name]",
    "msdyn_description": "[description]",
    "[all 50+ custom fields]": "[values]"
  },
  "teamMembers": [
    {
      "msdyn_projectteamid": "[GUID]",
      "msdyn_teamid": "[GUID]",
      "msdyn_role": "[role]"
    }
  ],
  "tasks": [
    {
      "msdyn_projecttaskid": "[GUID]",
      "msdyn_projectid": "[GUID]",
      "msdyn_taskname": "[name]",
      "msdyn_outlinelevel": [level],
      "msdyn_parenttaskid": "[parent GUID]",
      "[all 50+ custom fields]": "[values]"
    }
  ],
  "dependencies": [
    {
      "msdyn_projecttaskdependencyid": "[GUID]",
      "msdyn_predecessortaskid": "[GUID]",
      "msdyn_succeedertaskid": "[GUID]",
      "msdyn_dependencytype": "[type]",
      "msdyn_lag": [lag value]
    }
  ],
  "assignments": [
    {
      "msdyn_projectassignmentid": "[GUID]",
      "msdyn_projecttaskid": "[GUID]",
      "msdyn_resourceassignmentid": "[GUID]",
      "msdyn_allocatedhoursperday": [hours]
    }
  ],
  "buckets": [
    {
      "msdyn_projectbucketid": "[GUID]",
      "msdyn_name": "[name]"
    }
  ]
}
```

**Power Automate Configuration**:
```
Connector:        Data Operations
Action:           Compose
Inputs:
@{json(concat('{
  "project": ', string(variables('varSourceProject')), ',
  "teamMembers": ', string(variables('varTeamMembers')), ',
  "tasks": ', string(variables('varAllTasks')), ',
  "dependencies": ', string(variables('varDependencies')), ',
  "assignments": ', string(variables('varAssignments')), ',
  "buckets": ', string(variables('varBuckets')), '
}'))}
```

**Store in Variable**:
```
Connector:        Variables
Action:           Initialize variable
Name:             varExportedJSON
Type:             String
Value:            outputs('Compose_exported_data')
```

---

### Action 9: Create File in Migration Tracker

Store the exported JSON in the migration tracker record (as file attachment).

```
Connector:        Dataverse
Action:           Create a new row
Table:            Notes (cr_projectmigrations)
Columns:
  notestext:      varExportedJSON
  objectid_cr_projectmigration: cr_projectmigrationid
  subject:        "Exported project data for: [project name]"
```

OR (alternative): Store in multiline text field instead of file:

```
Connector:        Dataverse
Action:           Update a row
Table:            cr_projectmigrations
Row ID:           cr_projectmigrationid
Columns:
  cr_exportedjson: varExportedJSON (if field exists)
```

**Configuration**: If using file column:
```
Environment: cr_SourceDataverse
Table Name: cr_projectmigrations
Row ID: @{triggerBody()?['cr_projectmigrationid']}
Columns:
  cr_exportedjson: [File from Compose action - need to convert to base64]
```

---

### Action 10: Update Migration Tracker - Status Exported

Mark the export as complete.

```
Connector:        Dataverse
Action:           Update a row
Table:            cr_projectmigrations
Row ID:           cr_projectmigrationid (from trigger)
Columns:
  cr_status:      100000002  (Exported)
  cr_exportedon:  utcNow()
  cr_taskcount:   length(varAllTasks)
```

**Power Automate Configuration**:
```
Environment: cr_SourceDataverse
Table Name: cr_projectmigrations
Row ID: @{triggerBody()?['cr_projectmigrationid']}

Click "Edit in advanced mode" and paste:
{
  "cr_status": 100000002,
  "cr_exportedon": "@{utcNow()}",
  "cr_taskcount": @{length(variables('varAllTasks'))}
}
```

---

### Action 11: Trigger Flow 2 (Import)

When export completes successfully, trigger Flow 2 to import into target.

```
Connector:        Power Automate
Action:           Trigger flow
Flow:             Flow2_ImportProject
Input:
  projectMigrationId: cr_projectmigrationid
  sourceProjectId:    cr_sourceprojectid
  sourceProjectName:  cr_sourceprojectname
  exportedJSON:       varExportedJSON
```

**Configuration**:
```
Connector: Power Automate Management
Action: Trigger a flow action
Flow: Select "Flow2_ImportProject"

Input parameters (create these in Flow2 first):
  projectMigrationId: @{triggerBody()?['cr_projectmigrationid']}
  sourceProjectId: @{triggerBody()?['cr_sourceprojectid']}
  exportedJSON: @{variables('varExportedJSON')}
```

---

## Error Handling: Try/Catch Scopes

Wrap all critical actions in error handling.

### Scope 1: Data Retrieval (Try)

```
Scope Name: Try_GetSourceData
Actions:
  - Action 1: Set Status to Exporting
  - Action 2: Get Project Record
  - Action 3: Get Team Members
  - Action 4: Get Tasks
  - Action 5: Get Dependencies
  - Action 6: Get Assignments
  - Action 7: Get Buckets
  - Action 8: Compose Exported JSON
```

### Scope 1: Data Retrieval (Catch)

```
Scope Name: Catch_GetSourceData
Runs after: Scope "Try_GetSourceData" is unsuccessful

Actions:
  1. Update Migration Tracker - Status Failed
     - cr_status: 100000005 (Failed)
     - cr_errordetails: "Export failed during data retrieval: " +
                        actions('Try_GetSourceData')?['error']?['message']

  2. Send notification to admin
     Connector: Office 365 Mail
     Action: Send an email
     To: admin@company.com
     Subject: "Migration Export Failed - @{triggerBody()?['cr_sourceprojectname']}"
     Body: "Error: [error details]"

  3. Terminate flow with failure
```

**Power Automate Configuration**:

In Try scope, select "Run after":
- Previous action is successful

In Catch scope (after Try), select "Run after":
- Previous action has failed

---

### Scope 2: Data Storage (Try)

```
Scope Name: Try_StoreExportedData
Actions:
  - Action 9: Create File/Store JSON
  - Action 10: Update Status to Exported
```

### Scope 2: Data Storage (Catch)

```
Scope Name: Catch_StoreExportedData
Actions:
  1. Update Migration Tracker - Status Failed
     - cr_errordetails: "Export failed while storing data: [error]"

  2. Send admin email (same as above)

  3. Terminate with failure
```

---

### Scope 3: Flow Triggering (Try)

```
Scope Name: Try_TriggerFlow2
Actions:
  - Action 11: Trigger Flow 2
```

### Scope 3: Flow Triggering (Catch)

```
Scope Name: Catch_TriggerFlow2
Actions:
  1. Update Migration Tracker - Status Exported (even though trigger failed)
     - Note: Export succeeded, only trigger failed
     - cr_errordetails: "Export successful but Flow 2 trigger failed: [error]"
     - This allows manual retry of Flow 2

  2. Send admin email (optional)
```

---

## Complete Try/Catch Implementation

Here's the full structure in Power Automate syntax:

```json
{
  "actions": {
    "Initialize_varSourceProject": {
      "runAfter": {},
      "type": "InitializeVariable",
      "inputs": {
        "variables": [
          {
            "name": "varSourceProject",
            "type": "object"
          }
        ]
      }
    },
    "Try_GetSourceData": {
      "runAfter": {
        "Initialize_varSourceProject": ["Succeeded"]
      },
      "type": "Scope",
      "actions": {
        "Set_status_to_Exporting": {
          "runAfter": {},
          "type": "OpenApiConnection",
          "inputs": {
            "host": {
              "connectionName": "shared_commondataserviceforapps",
              "operationId": "UpdateRecord"
            },
            "parameters": {
              "entityLogicalName": "cr_projectmigrations",
              "recordId": "@triggerBody()['cr_projectmigrationid']",
              "item": {
                "cr_status": 100000001
              }
            }
          }
        }
      }
    },
    "Catch_GetSourceData": {
      "runAfter": {
        "Try_GetSourceData": ["Failed"]
      },
      "type": "Scope",
      "actions": {
        "Update_status_to_Failed": {
          "runAfter": {},
          "type": "OpenApiConnection",
          "inputs": {
            "host": {
              "connectionName": "shared_commondataserviceforapps",
              "operationId": "UpdateRecord"
            },
            "parameters": {
              "entityLogicalName": "cr_projectmigrations",
              "recordId": "@triggerBody()['cr_projectmigrationid']",
              "item": {
                "cr_status": 100000005,
                "cr_errordetails": "@{concat('Export failed during data retrieval: ', last(body('Try_GetSourceData')['actions']).error.message)}"
              }
            }
          }
        }
      }
    }
  }
}
```

---

## Alternative Trigger: HTTP Request (Canvas App)

If triggering from canvas app instead of automated flow:

```
Trigger Type: When a HTTP request is received
Method: POST
Schema:
{
  "type": "object",
  "properties": {
    "projectId": {
      "type": "string"
    },
    "projectName": {
      "type": "string"
    }
  }
}
```

Then in first action, query for the migration tracker record:

```
Connector: Dataverse
Action: List rows
Table: cr_projectmigrations
Filter: cr_sourceprojectid eq 'projectId'
Take first result: @{first(outputs('List_migration_records')['value'])}
Store as varMigrationRecord
```

---

## Testing Checklist

- [ ] Test with single project (1-2 tasks)
- [ ] Test with medium project (50-100 tasks)
- [ ] Test with large project (500+ tasks)
- [ ] Verify pagination works (test with >250 tasks)
- [ ] Verify all 50+ custom fields are exported
- [ ] Verify exported JSON is valid
- [ ] Verify migration tracker record updates correctly
- [ ] Verify error handling triggers on invalid data
- [ ] Verify Flow 2 is triggered after export completes
- [ ] Check Power Automate run history for errors
- [ ] Monitor Power Automate action count (should stay under 500)

---

## Performance Considerations

### Estimated Action Counts Per Run

- Set status: 1 action
- Get project: 1 action
- Get team members: 1 action
- Initialize pagination variables: 2 actions
- List tasks (with loop): 3-5 actions (depending on pagination)
- Get dependencies: 1 action
- Get assignments: 1 action
- Get buckets: 1 action
- Compose JSON: 1 action
- Store exported data: 1 action
- Update status: 1 action
- Trigger Flow 2: 1 action
- Error handling (Try/Catch): 2 scopes

**Total: ~20-30 actions per run**

### Power Automate Limits

- Connector calls: 6000 per 5 minutes (no issue for 190 projects)
- Flow duration: 60 minutes (no issue for export)
- Action timeout: 120 seconds per action (should complete in <30 seconds typically)

---

## Monitoring & Logging

### Enable Flow Run Details

In Power Automate:
1. Go to Flow > Details
2. Enable Analytics
3. Monitor run duration and action counts

### Create Alerts

Set up notifications for failed exports:
```
Connector: Power Automate Management
Trigger: When a flow run is created
Condition: Flow name = Flow1_ExportProject AND Status = Failed
Action: Send email to admin@company.com
```

