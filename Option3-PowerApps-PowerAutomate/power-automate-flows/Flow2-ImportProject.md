# Power Automate Flow 2: Import Project using Schedule API

## Flow Overview

**Flow Name**: Flow2_ImportProject

**Purpose**: Create a new project in the target environment using the Schedule API (OperationSet pattern), migrate all tasks, team members, dependencies, and assignments with GUID mapping.

**Trigger Type**: Automated (when cr_projectmigration.cr_status = "Exported") OR manual from Flow 1

**Duration**: 5-30 minutes per project (depending on task count and Schedule API processing)

**Estimated Actions**: 40-50 actions per flow run

**Critical**: Uses the Schedule API (msdyn_CreateOperationSetV1, msdyn_PssCreateV1, msdyn_ExecuteOperationSetV1) which is the ONLY supported way to bulk-create tasks.

---

## Flow Trigger Configuration

### Trigger Type: When a row is modified

Configure to fire when migration tracker status changes to "Exported":

```
Connector:        Dataverse
Action:           When a row is modified
Table:            cr_projectmigrations
Scope:            Organization
Select Columns:   cr_status, cr_guidmappingjson, cr_exportedjson
```

### Trigger Condition (Critical)

Add a condition to only process when status = "Exported":

```
Field:            cr_status
Operator:         equals
Value:            100000002  (Exported option value)
```

---

## Complete Flow Actions - Phase 1: Create Project

### Action 1: Update Migration Tracker - Status Importing

Mark that import has started.

```
Connector:        Dataverse
Action:           Update a row
Table:            cr_projectmigrations
Row ID:           cr_projectmigrationid (from trigger)
Columns:
  cr_status:      100000003  (Importing)
```

---

### Action 2: Parse Exported JSON

Parse the JSON data from Flow 1 into variables.

```
Connector:        Data Operations
Action:           Parse JSON
Content:          cr_exportedjson (multiline text field value)
Schema:
{
  "type": "object",
  "properties": {
    "project": {
      "type": "object",
      "properties": {
        "msdyn_projectid": { "type": "string" },
        "msdyn_projectname": { "type": "string" },
        "msdyn_description": { "type": "string" },
        "msdyn_customfield1": { "type": "string" },
        "[all 50+ custom field schemas]": { "type": "string" }
      }
    },
    "teamMembers": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "msdyn_projectteamid": { "type": "string" },
          "msdyn_teamid": { "type": "string" },
          "msdyn_role": { "type": "string" }
        }
      }
    },
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "msdyn_projecttaskid": { "type": "string" },
          "msdyn_taskname": { "type": "string" },
          "msdyn_parenttaskid": { "type": "string" },
          "msdyn_outlinelevel": { "type": "integer" }
        }
      }
    },
    "dependencies": {
      "type": "array"
    },
    "assignments": {
      "type": "array"
    }
  }
}
```

**Configuration in Power Automate**:
```
Connector: Data Operations
Action: Parse JSON
Content: @{triggerBody()?['cr_exportedjson']}
Schema: [Paste schema above]
```

**Store parsed project data**:
```
Connector: Variables
Action: Initialize variable
Name: varParsedProject
Type: Object
Value: @{body('Parse_exported_JSON')?['project']}
```

---

### Action 3: Create Project in Target Environment

Create the project record in the target environment (NOT via Schedule API - direct creation).

```
Connector:        Dataverse (cr_TargetDataverse connection)
Action:           Create a new row
Table:            msdyn_projects
Columns:
  msdyn_projectname:   varParsedProject.msdyn_projectname
  msdyn_description:   varParsedProject.msdyn_description
  msdyn_projectstatus: varParsedProject.msdyn_projectstatus
  msdyn_projectowner:  varParsedProject.msdyn_projectowner
  [all 50+ custom fields]: [mapped from varParsedProject]
```

**Power Automate Configuration**:
```
Connector: Dataverse (select cr_TargetDataverse)
Action: Create a new row
Table Name: msdyn_projects
Columns:
  msdyn_projectname: @{body('Parse_exported_JSON')?['project']?['msdyn_projectname']}
  msdyn_description: @{body('Parse_exported_JSON')?['project']?['msdyn_description']}
  msdyn_projectstatus: @{body('Parse_exported_JSON')?['project']?['msdyn_projectstatus']}
  [Continue for all fields...]
```

**Store Target Project ID**:
```
Connector: Variables
Action: Initialize variable
Name: varTargetProjectId
Type: String
Value: @{body('Create_project_in_target')?['msdyn_projectid']}
```

**Also store the entire created project record**:
```
Connector: Variables
Action: Initialize variable
Name: varTargetProject
Type: Object
Value: @{body('Create_project_in_target')}
```

---

### Action 4: Initialize GUID Mapping Variable

Create a JSON object that will track source GUIDs → target GUIDs for all entities.

```
Connector:        Variables
Action:           Initialize variable
Name:             varGUIDMapping
Type:             Object
Value:
{
  "projectMapping": {
    "[source project GUID]": "[target project GUID]"
  },
  "taskMapping": {},
  "teamMemberMapping": {},
  "assignmentMapping": {}
}
```

**Configuration**:
```
Connector: Variables
Action: Initialize variable
Name: varGUIDMapping
Type: Object
Value: @{json(concat('{
  "projectMapping": {
    "', body('Parse_exported_JSON')?['project']?['msdyn_projectid'], '": "', variables('varTargetProjectId'), '"
  },
  "taskMapping": {},
  "teamMemberMapping": {},
  "assignmentMapping": {}
}'))}
```

---

## Phase 2A: Create OperationSet for Team Members & Tasks

### Action 5: Create OperationSet (Phase 1)

Call the Schedule API to create an OperationSet that will hold team member and task operations.

```
Connector:        HTTP
Action:           HTTP
Method:           POST
URI:              https://[target-org].dynamics.com/api/data/v9.2/msdyn_CreateOperationSetV1
Headers:
  Authorization:  Bearer [Access Token from Azure AD]
  Content-Type:   application/json
  OData-MaxVersion: 4.0
  OData-Version:  4.0
Body:
{
  "input": {
    "displayName": "ProjectMigration_[SourceProjectName]_Phase1",
    "operationSetType": 192350000
  }
}
```

**Power Automate Configuration**:

First, add an "HTTP with Azure AD" action (requires Premium license):

```
Connector: HTTP with Azure AD
Action: HTTP with Azure AD
Method: POST
Base Resource URL: https://[target-org].crm.dynamics.com
URI: /api/data/v9.2/msdyn_CreateOperationSetV1

Body:
{
  "displayName": "ProjectMigration_@{body('Parse_exported_JSON')?['project']?['msdyn_projectname']}_Phase1",
  "operationSetType": 192350000
}
```

**Store OperationSet ID**:
```
Connector: Variables
Action: Initialize variable
Name: varOperationSet1Id
Type: String
Value: @{body('HTTP_Create_OperationSet')?['operationSetId']}
```

---

### Action 6: Initialize OperationSet1 Operations Array

Create an array to hold all operations for Phase 1.

```
Connector:        Variables
Action:           Initialize variable
Name:             varOperationSet1Operations
Type:             Array
Value:            []
```

---

### Action 7: Loop Through Team Members - Build Operations

For each team member, create a PSS_Create operation and add to OperationSet1.

```
Connector:        Control
Action:           Apply to each
Input:            body('Parse_exported_JSON')?['teamMembers']
Actions:
  [Build operation for each team member]
```

**Inside Loop - Create Team Member Operation**:

```
Connector:        Data Operations
Action:           Compose
Inputs:
{
  "operation": "Create",
  "entity": "msdyn_projectteam",
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(@{variables('varTargetProjectId')})",
    "msdyn_teamid@odata.bind": "/teams(@{items('Apply_to_each_TeamMembers')?['msdyn_teamid']})",
    "msdyn_role": "@{items('Apply_to_each_TeamMembers')?['msdyn_role']}",
    "msdyn_name": "@{items('Apply_to_each_TeamMembers')?['msdyn_name']}"
  }
}
```

**Add to Operations Array**:
```
Connector: Variables
Action: Append to array variable
Name: varOperationSet1Operations
Value: @{outputs('Compose_team_member_operation')}
```

---

### Action 8: Loop Through Tasks - Build Operations

For each task (sorted by OutlineLevel, parents first), create a PSS_Create operation.

```
Connector:        Control
Action:           Apply to each
Input:
  @{body('Parse_exported_JSON')?['tasks']}
  (pre-sorted by msdyn_outlinelevel asc in Query)
Actions:
  [Build operation for each task]
```

**Critical: Tasks must be sorted by OutlineLevel ascending** to ensure parent tasks are created before child tasks.

**Inside Loop - Determine if Root or Child Task**:

```
Connector:        Control
Action:           Condition
Expression:       @{empty(items('Apply_to_each_Task')?['msdyn_parenttaskid'])}

True branch (Root task - no parent):
  [Compose root task operation]

False branch (Child task - has parent):
  [Compose child task operation with parent reference]
```

**True Branch - Compose Root Task Operation**:

```
Connector:        Data Operations
Action:           Compose
Inputs:
{
  "operation": "Create",
  "entity": "msdyn_projecttask",
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(@{variables('varTargetProjectId')})",
    "msdyn_taskname": "@{items('Apply_to_each_Task')?['msdyn_taskname']}",
    "msdyn_description": "@{items('Apply_to_each_Task')?['msdyn_description']}",
    "msdyn_duration": @{items('Apply_to_each_Task')?['msdyn_duration']},
    "msdyn_durationformat": "@{items('Apply_to_each_Task')?['msdyn_durationformat']}",
    "msdyn_scheduledstart": "@{items('Apply_to_each_Task')?['msdyn_scheduledstart']}",
    "msdyn_scheduledend": "@{items('Apply_to_each_Task')?['msdyn_scheduledend']}",
    "msdyn_percentcomplete": @{items('Apply_to_each_Task')?['msdyn_percentcomplete']},
    "msdyn_outlinelevel": @{items('Apply_to_each_Task')?['msdyn_outlinelevel']},
    "[all 50+ custom fields]": "[values]"
  }
}
```

**False Branch - Compose Child Task Operation**:

```
Connector:        Data Operations
Action:           Compose
Inputs:
{
  "operation": "Create",
  "entity": "msdyn_projecttask",
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(@{variables('varTargetProjectId')})",
    "msdyn_parenttaskid@odata.bind": "/msdyn_projecttasks(??)",
    "msdyn_taskname": "@{items('Apply_to_each_Task')?['msdyn_taskname']}",
    "[other fields]": "[values]"
  }
}
```

**Problem**: Child task operation needs the TARGET parent task ID, but we don't have it yet because all tasks are created in one OperationSet.

**Solution**: Use a GUID reference approach. When OperationSet returns, it provides guids for all created records. We'll use a placeholder and update after OperationSet execution.

**Alternative Solution**: Create tasks in ORDER, and after each OperationSet execution, update the mapping. This requires 2 OperationSets - one per parent level.

**For simplicity**: Create Phase 1 OperationSet with only ROOT tasks, then create child tasks in a separate Phase 1B OperationSet after we have parent GUIDs.

---

### Action 9A: Execute OperationSet Phase 1 (Root Tasks Only)

Call the Schedule API to execute the OperationSet containing team members and root tasks.

```
Connector:        HTTP
Action:           HTTP with Azure AD
Method:           POST
URI:              https://[target-org].crm.dynamics.com/api/data/v9.2/msdyn_ExecuteOperationSetV1
Headers:
  Authorization:  Bearer [Access Token]
  Content-Type:   application/json
Body:
{
  "operationSetId": "[varOperationSet1Id]",
  "operations": [varOperationSet1Operations array]
}
```

**Configuration**:
```
Connector: HTTP with Azure AD
Method: POST
Base Resource URL: https://[target-org].crm.dynamics.com
URI: /api/data/v9.2/msdyn_ExecuteOperationSetV1

Headers:
  Content-Type: application/json
  OData-Version: 4.0
  OData-MaxVersion: 4.0

Body:
{
  "operationSetId": "@{variables('varOperationSet1Id')}",
  "operations": @{variables('varOperationSet1Operations')}
}
```

**Store Response**:
```
Connector: Variables
Action: Initialize variable
Name: varOperationSet1Response
Type: Object
Value: @{body('Execute_OperationSet_Phase1')}
```

---

### Action 10: Poll OperationSet Completion

The OperationSet executes asynchronously. Poll until it completes.

```
Connector:        Control
Action:           Do until
Property:         varOperationSet1Status
Operator:         equals
Value:            "Completed"
Timeout:          30 minutes (1800 seconds)

Actions inside:
  1. Query msdyn_operationset record
  2. Get statecode field
  3. If statecode = 200000001 (Completed), set varOperationSet1Status = "Completed"
  4. Else wait 10 seconds
  5. Increment attempt counter
```

**Query OperationSet Status**:
```
Connector: Dataverse (cr_TargetDataverse)
Action: Get a row
Table: msdyn_operationsets (or msdyn_projectschedulevalidation records)
Row ID: @{variables('varOperationSet1Id')}
Column Selection: statecode,statuscode,msdyn_errormessage,msdyn_operationcount,msdyn_completedcount
```

**Initialize Status Variable**:
```
Connector: Variables
Action: Initialize variable
Name: varOperationSet1Status
Type: String
Value: "InProgress"
```

**Inside Loop - Check Status**:
```
Connector: Control
Action: Condition
Expression: @{equals(body('Get_OperationSet_status')?['statecode'], 1)}
  // statecode 1 = Completed

True: Set varOperationSet1Status = "Completed"
False: [continue waiting]
```

**Delay between checks**:
```
Connector: Control
Action: Delay
Duration: 10 (seconds)
```

---

### Action 11: Extract GUID Mappings from OperationSet Response

After OperationSet completes, extract the new GUIDs for all created tasks and team members.

```
Connector:        Data Operations
Action:           Compose
Inputs:
  Parse the response from varOperationSet1Response
  For each created task:
    varGUIDMapping["taskMapping"]["source-task-guid"] = "target-task-guid"
  For each created team member:
    varGUIDMapping["teamMemberMapping"]["source-member-guid"] = "target-member-guid"
```

**Configuration**:
```
Connector: Data Operations
Action: Compose
Inputs: @{concat('{
  "taskMapping": {',
    string(forall(
      items('Apply_to_each_Task'),
      concat(
        '"', items('Apply_to_each_Task')?['msdyn_projecttaskid'], '": "',
        [lookup in response for new GUID],
        '"'
      )
    )),
  '},
  "teamMemberMapping": {',
    [similar for team members],
  '}'
}')}
```

This is complex because the OperationSet response format needs to be parsed to extract the guid mappings. Check Schedule API documentation for exact response format.

---

## Phase 2B: Create OperationSet for Dependencies & Assignments

### Action 12: Create OperationSet (Phase 2)

Create a second OperationSet for dependencies and assignments (which reference created tasks).

```
Connector:        HTTP with Azure AD
Method:           POST
URI:              /api/data/v9.2/msdyn_CreateOperationSetV1

Body:
{
  "displayName": "ProjectMigration_@{body('Parse_exported_JSON')?['project']?['msdyn_projectname']}_Phase2",
  "operationSetType": 192350000
}
```

**Store ID**:
```
Connector: Variables
Action: Initialize variable
Name: varOperationSet2Id
Type: String
Value: @{body('HTTP_Create_OperationSet_Phase2')?['operationSetId']}
```

---

### Action 13: Initialize OperationSet2 Operations Array

```
Connector:        Variables
Action:           Initialize variable
Name:             varOperationSet2Operations
Type:             Array
Value:            []
```

---

### Action 14: Loop Through Dependencies - Build Operations

For each dependency, create a PSS_Create operation with REMAPPED task GUIDs.

```
Connector:        Control
Action:           Apply to each
Input:            body('Parse_exported_JSON')?['dependencies']
Actions:
  [Build dependency operation with GUID mapping]
```

**Inside Loop - Compose Dependency Operation**:

```
Connector:        Data Operations
Action:           Compose
Inputs:
{
  "operation": "Create",
  "entity": "msdyn_projecttaskdependency",
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(@{variables('varTargetProjectId')})",
    "msdyn_predecessortaskid@odata.bind":
      "/msdyn_projecttasks(@{
        body('Parse_exported_JSON')?['dependencies'][0]?['msdyn_predecessortaskid']
        lookup in varGUIDMapping
      })",
    "msdyn_succeedertaskid@odata.bind":
      "/msdyn_projecttasks(@{
        [lookup successor in mapping]
      })",
    "msdyn_dependencytype": "@{items('Apply_to_each_Dependency')?['msdyn_dependencytype']}",
    "msdyn_lag": @{items('Apply_to_each_Dependency')?['msdyn_lag']}
  }
}
```

**Add to Operations Array**:
```
Connector: Variables
Action: Append to array variable
Name: varOperationSet2Operations
Value: @{outputs('Compose_dependency_operation')}
```

---

### Action 15: Loop Through Assignments - Build Operations

For each assignment, create a PSS_Create operation with REMAPPED task and resource GUIDs.

```
Connector:        Control
Action:           Apply to each
Input:            body('Parse_exported_JSON')?['assignments']
Actions:
  [Build assignment operation with GUID mapping]
```

**Inside Loop - Compose Assignment Operation**:

```
Connector:        Data Operations
Action:           Compose
Inputs:
{
  "operation": "Create",
  "entity": "msdyn_projectassignment",
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(@{variables('varTargetProjectId')})",
    "msdyn_projecttaskid@odata.bind":
      "/msdyn_projecttasks(@{[lookup task GUID in mapping]})",
    "msdyn_resourceassignmentid@odata.bind":
      "/msdyn_resourceassignments(@{
        items('Apply_to_each_Assignment')?['msdyn_resourceassignmentid']
      })",
    "msdyn_allocatedhoursperday": @{items('Apply_to_each_Assignment')?['msdyn_allocatedhoursperday']},
    "msdyn_billingtype": "@{items('Apply_to_each_Assignment')?['msdyn_billingtype']}",
    "msdyn_effort": @{items('Apply_to_each_Assignment')?['msdyn_effort']},
    "msdyn_plannedwork": @{items('Apply_to_each_Assignment')?['msdyn_plannedwork']}
  }
}
```

**Add to Operations Array**:
```
Connector: Variables
Action: Append to array variable
Name: varOperationSet2Operations
Value: @{outputs('Compose_assignment_operation')}
```

---

### Action 16: Execute OperationSet Phase 2

Execute the second OperationSet containing dependencies and assignments.

```
Connector:        HTTP with Azure AD
Method:           POST
URI:              /api/data/v9.2/msdyn_ExecuteOperationSetV1

Body:
{
  "operationSetId": "@{variables('varOperationSet2Id')}",
  "operations": @{variables('varOperationSet2Operations')}
}
```

**Store Response**:
```
Connector: Variables
Action: Initialize variable
Name: varOperationSet2Response
Type: Object
Value: @{body('Execute_OperationSet_Phase2')}
```

---

### Action 17: Poll OperationSet 2 Completion

Poll until Phase 2 OperationSet completes.

```
Connector:        Control
Action:           Do until
Property:         varOperationSet2Status
Operator:         equals
Value:            "Completed"
Timeout:          30 minutes

Actions:
  [Same as Action 10 but for OperationSet2]
```

---

## Phase 3: Finalization

### Action 18: Update Migration Tracker - Final Status

Mark migration as completed and store GUID mappings.

```
Connector:        Dataverse (cr_SourceDataverse)
Action:           Update a row
Table:            cr_projectmigrations
Row ID:           cr_projectmigrationid
Columns:
  cr_status:      100000004  (Completed)
  cr_targetprojectid: varTargetProjectId
  cr_guidmappingjson: [JSON-stringified varGUIDMapping]
  cr_importedon:  utcNow()
  cr_tasksimported: [count from OperationSet response]
  cr_operationsetid: varOperationSet1Id
  cr_operationset2id: varOperationSet2Id
```

**Configuration**:
```
Connector: Dataverse
Action: Update a row
Environment: cr_SourceDataverse
Table Name: cr_projectmigrations
Row ID: @{triggerBody()?['cr_projectmigrationid']}

Click "Edit in advanced mode":
{
  "cr_status": 100000004,
  "cr_targetprojectid": "@{variables('varTargetProjectId')}",
  "cr_guidmappingjson": "@{string(variables('varGUIDMapping'))}",
  "cr_importedon": "@{utcNow()}",
  "cr_tasksimported": @{length(body('Parse_exported_JSON')?['tasks'])},
  "cr_operationsetid": "@{variables('varOperationSet1Id')}",
  "cr_operationset2id": "@{variables('varOperationSet2Id')}"
}
```

---

### Action 19: Send Success Notification

Send email to project owner confirming migration completed.

```
Connector:        Office 365 Mail
Action:           Send an email
To:               admin@company.com
Subject:          "Project Migration Completed: [Project Name]"
Body:
"Project Migration Successfully Completed

Source Project ID: [source GUID]
Target Project ID: [target GUID]
Source Tasks: [count]
Imported Tasks: [count]
Status: Completed
Timestamp: [timestamp]

Project is now available in target environment.
Please verify all data has been migrated correctly.
"
```

---

## Error Handling: Try/Catch Scopes

Wrap critical sections in error handling.

### Scope 1: Project Creation (Try)

```
Scope Name: Try_CreateProject
Actions:
  - Action 3: Create Project in Target
```

### Scope 1: Project Creation (Catch)

```
Scope Name: Catch_CreateProject
Actions:
  1. Update Migration Tracker - Failed
     cr_errordetails: "Failed to create project in target: [error]"
  2. Send admin email
  3. Terminate with error
```

---

### Scope 2: Phase 1 OperationSet (Try)

```
Scope Name: Try_Phase1OperationSet
Actions:
  - Create OperationSet
  - Build operations
  - Execute OperationSet
  - Poll completion
  - Extract GUID mappings
```

### Scope 2: Phase 1 OperationSet (Catch)

```
Scope Name: Catch_Phase1OperationSet
Actions:
  1. Update Migration Tracker - Failed
  2. Log error details
  3. Send admin email
  4. Terminate with error
```

---

### Scope 3: Phase 2 OperationSet (Try)

```
Scope Name: Try_Phase2OperationSet
Actions:
  - Create OperationSet
  - Build operations
  - Execute OperationSet
  - Poll completion
```

### Scope 3: Phase 2 OperationSet (Catch)

```
Scope Name: Catch_Phase2OperationSet
Actions:
  1. Update status to "Completed" with note about Phase 2 failure
  2. Store partial GUID mapping
  3. Send warning email (Phase 1 succeeded, Phase 2 failed)
```

---

## Schedule API Reference

### msdyn_CreateOperationSetV1

Creates a new OperationSet that will hold multiple operations.

```json
POST /api/data/v9.2/msdyn_CreateOperationSetV1

Body:
{
  "displayName": "string (max 100 chars)",
  "operationSetType": 192350000  (192350000 = ProjectSchedule)
}

Response:
{
  "operationSetId": "guid",
  "msdyn_operationsetid": "guid"
}
```

### msdyn_PssCreateV1

Adds a "Create" operation to an OperationSet. (Note: In Flow, we build operations manually and pass as array to ExecuteOperationSet)

Operation object format:
```json
{
  "operation": "Create",
  "entity": "msdyn_projecttask",  // or msdyn_projectteam, msdyn_projecttaskdependency, etc.
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(guid)",
    "msdyn_taskname": "Task Name",
    "msdyn_parenttaskid@odata.bind": "/msdyn_projecttasks(parent-guid)",
    "[field]@odata.bind": "/[entity](guid)"  // For lookups
  }
}
```

### msdyn_ExecuteOperationSetV1

Executes all operations in an OperationSet.

```json
POST /api/data/v9.2/msdyn_ExecuteOperationSetV1

Body:
{
  "operationSetId": "guid",
  "operations": [
    { "operation": "Create", "entity": "...", "attributes": {...} },
    { "operation": "Create", "entity": "...", "attributes": {...} }
  ]
}

Response:
{
  "operationSetResultId": "guid",
  "operationResults": [
    {
      "operationIndex": 0,
      "status": 0,
      "guid": "new-entity-guid"
    }
  ]
}
```

---

## Testing Checklist

- [ ] Test with single project (1-2 tasks, no dependencies)
- [ ] Test with medium project (50-100 tasks, some dependencies)
- [ ] Test with large project (500+ tasks, complex dependencies)
- [ ] Verify OperationSet creation succeeds
- [ ] Verify operations are added correctly
- [ ] Verify OperationSet execution completes without timeout
- [ ] Verify GUID mappings are stored correctly
- [ ] Verify target project exists with correct field values
- [ ] Verify target tasks exist with correct parent relationships
- [ ] Verify target dependencies created correctly
- [ ] Verify target assignments created correctly
- [ ] Verify migration tracker updated with correct status
- [ ] Test error handling (invalid GUID, throttled API, timeout)
- [ ] Check Power Automate run history for action counts

---

## Performance Considerations

### OperationSet Size Limits

- Maximum operations per OperationSet: ~100-200 (depending on payload size)
- Maximum operation payload size: ~10MB per request
- For 1000+ tasks, may need to split into multiple OperationSets

### Flow Duration

- Phase 1 (team members + root tasks): ~5-10 minutes
- Polling Phase 1: 5-30 minutes (depends on Schedule API processing)
- Phase 2 (dependencies + assignments): ~5-10 minutes
- Polling Phase 2: 5-30 minutes

**Total**: 20-80 minutes per project

### Power Automate Limits

- Action count: ~40-50 per run (within 500 limit)
- Duration: 60 minutes max (may need to increase if polling takes >50 min)
- HTTP timeout: 120 seconds per action (adequate for API calls)

