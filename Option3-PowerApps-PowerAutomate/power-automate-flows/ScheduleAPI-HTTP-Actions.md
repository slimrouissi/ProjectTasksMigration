# Schedule API: HTTP Action Reference

## Overview

The Schedule API (msdyn_* actions) is the ONLY supported method for bulk-creating Project Operations entities. This document provides exact configurations for all HTTP actions needed in Flow 2.

---

## Prerequisites

### 1. HTTP with Azure AD Connector (Premium License Required)

Add the "HTTP with Azure AD" connector to your Power Automate flow:

```
Connector Name: HTTP with Azure AD
License Required: Power Automate Premium
Authentication: Service Principal (App Registration in Azure AD)
```

### 2. Azure AD App Registration

Create an app registration in Azure AD for accessing the target environment:

```
Azure Portal > App Registrations > New Registration
  Name: "D365ProjectMigration"
  Supported Account Types: Single tenant
  Redirect URI: https://login.microsoftonline.com/[tenant-id]
```

Grant API permissions:
```
API Permissions > Add Permission
  Dynamics CRM > user_impersonation
  Grant admin consent
```

Create client secret:
```
Certificates & secrets > New client secret
  Save: Client Secret Value (needed for HTTP connector)
```

Note:
- Client ID (Application ID)
- Tenant ID
- Client Secret

---

## HTTP Action Template

All Schedule API calls use this template:

```
Connector:        HTTP with Azure AD
Method:           POST
Base Resource URL: https://[org-name].crm.dynamics.com
URI:              /api/data/v9.2/[Action Name]

Headers:
  Authorization:  Bearer [Automatically added by HTTP with Azure AD]
  Content-Type:   application/json
  OData-Version:  4.0
  OData-MaxVersion: 4.0

Body:             [Action-specific JSON]

Authentication:
  Authority URL:  https://login.microsoftonline.com/[tenant-id]
  Tenant ID:      [from Azure AD app registration]
  Client ID:      [from Azure AD app registration]
  Client Secret:  [from Azure AD app registration]
```

---

## Action 1: msdyn_CreateOperationSetV1

### Purpose
Create a new OperationSet that will hold multiple create/update/delete operations.

### HTTP Configuration

```
Method:    POST
URI:       /api/data/v9.2/msdyn_CreateOperationSetV1

Body:
{
  "displayName": "string (max 100 characters)",
  "operationSetType": 192350000
}

Parameter Definitions:
  displayName: Human-readable name (appears in UI, good for tracking)
  operationSetType: 192350000 = ProjectScheduleSet
```

### Power Automate Configuration

```
Connector:        HTTP with Azure AD
Method:           POST
Base Resource URL: https://[target-org].crm.dynamics.com
URI:              /api/data/v9.2/msdyn_CreateOperationSetV1

Headers:
  Content-Type: application/json
  OData-Version: 4.0
  OData-MaxVersion: 4.0

Body:
{
  "displayName": "ProjectMigration_@{variables('varProjectName')}_Phase1",
  "operationSetType": 192350000
}
```

### Response Parsing

```json
{
  "operationSetId": "00000000-0000-0000-0000-000000000000",
  "msdyn_operationsetid": "00000000-0000-0000-0000-000000000000"
}
```

**Store operationSetId**:
```
Connector: Variables
Action: Initialize variable
Name: varOperationSetId
Type: String
Value: @{body('HTTP_Create_OperationSet')?['operationSetId']}
```

---

## Action 2: msdyn_ExecuteOperationSetV1

### Purpose
Execute all operations in an OperationSet. This submits all pending operations to the Schedule API.

### HTTP Configuration

```
Method:    POST
URI:       /api/data/v9.2/msdyn_ExecuteOperationSetV1

Body:
{
  "operationSetId": "guid",
  "operations": [
    {
      "operation": "Create",
      "entity": "entityName",
      "attributes": {
        "field1": "value1",
        "field2@odata.bind": "/entity(guid)"
      }
    },
    [... more operations ...]
  ]
}

Parameter Definitions:
  operationSetId: GUID returned from msdyn_CreateOperationSetV1
  operations: Array of operation objects
  operation: "Create", "Update", or "Delete"
  entity: Logical name (msdyn_projecttask, msdyn_projectteam, etc.)
  attributes: Entity field values and ODATA relationships
```

### Power Automate Configuration

```
Connector:        HTTP with Azure AD
Method:           POST
Base Resource URL: https://[target-org].crm.dynamics.com
URI:              /api/data/v9.2/msdyn_ExecuteOperationSetV1

Body:
{
  "operationSetId": "@{variables('varOperationSetId')}",
  "operations": @{variables('varOperationSet1Operations')}
}
```

where `varOperationSet1Operations` is an array built by looping through entities:

```
Connector: Variables
Action: Initialize variable
Name: varOperationSet1Operations
Type: Array
Value: []

// Inside ForEach loop:
Connector: Variables
Action: Append to array variable
Name: varOperationSet1Operations
Value: @{json(concat('{
  "operation": "Create",
  "entity": "msdyn_projecttask",
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(', variables('varTargetProjectId'), ')",
    "msdyn_taskname": "', items('ForEach_Tasks')?['msdyn_taskname'], '",
    "msdyn_outlinelevel": ', items('ForEach_Tasks')?['msdyn_outlinelevel'], '
  }
}'))}
```

### Response Parsing

```json
{
  "operationSetResultId": "guid",
  "operationResults": [
    {
      "operationIndex": 0,
      "status": 0,
      "statusMessage": "Success",
      "guid": "00000000-0000-0000-0000-000000000000"
    },
    {
      "operationIndex": 1,
      "status": 0,
      "statusMessage": "Success",
      "guid": "00000000-0000-0000-0000-000000000001"
    },
    [... more results ...]
  ]
}

Status Codes:
  0 = Success
  1 = Partial Success
  2 = Failed
```

**Store for GUID mapping**:
```
Connector: Variables
Action: Initialize variable
Name: varOperationResultsPhase1
Type: Array
Value: @{body('HTTP_Execute_OperationSet')?['operationResults']}

// Then parse to extract GUIDs:
ForAll(varOperationResultsPhase1,
  If(
    operationIndex = 0,  // First operation (first team member)
    Set(varTeamMember1TargetGuid, guid),
    ...
  )
)
```

---

## Operation Object Examples

### Create Project Task

```json
{
  "operation": "Create",
  "entity": "msdyn_projecttask",
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(00000000-0000-0000-0000-000000000000)",
    "msdyn_taskname": "Task Name",
    "msdyn_description": "Task description",
    "msdyn_duration": 40,
    "msdyn_durationformat": 192350001,
    "msdyn_scheduledstart": "2024-01-15T09:00:00Z",
    "msdyn_scheduledend": "2024-01-15T17:00:00Z",
    "msdyn_outlinelevel": 1,
    "msdyn_percentcomplete": 0,
    "msdyn_customfield_1": "custom value"
  }
}
```

### Create Child Task (with Parent Reference)

```json
{
  "operation": "Create",
  "entity": "msdyn_projecttask",
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(00000000-0000-0000-0000-000000000000)",
    "msdyn_parenttaskid@odata.bind": "/msdyn_projecttasks(00000000-0000-0000-0000-000000000001)",
    "msdyn_taskname": "Child Task",
    "msdyn_outlinelevel": 2,
    "msdyn_duration": 20
  }
}
```

### Create Project Team Member

```json
{
  "operation": "Create",
  "entity": "msdyn_projectteam",
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(00000000-0000-0000-0000-000000000000)",
    "msdyn_teamid@odata.bind": "/teams(00000000-0000-0000-0000-000000000002)",
    "msdyn_resourceid@odata.bind": "/resources(00000000-0000-0000-0000-000000000003)",
    "msdyn_role": "Developer",
    "msdyn_name": "Team Member Name"
  }
}
```

### Create Task Dependency

```json
{
  "operation": "Create",
  "entity": "msdyn_projecttaskdependency",
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(00000000-0000-0000-0000-000000000000)",
    "msdyn_predecessortaskid@odata.bind": "/msdyn_projecttasks(00000000-0000-0000-0000-000000000001)",
    "msdyn_succeedertaskid@odata.bind": "/msdyn_projecttasks(00000000-0000-0000-0000-000000000002)",
    "msdyn_dependencytype": 192350000,
    "msdyn_lag": 0
  }
}
```

Dependency Types:
```
192350000 = Finish-to-Start (FS)
192350001 = Start-to-Start (SS)
192350002 = Finish-to-Finish (FF)
192350003 = Start-to-Finish (SF)
```

### Create Resource Assignment

```json
{
  "operation": "Create",
  "entity": "msdyn_projectassignment",
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(00000000-0000-0000-0000-000000000000)",
    "msdyn_projecttaskid@odata.bind": "/msdyn_projecttasks(00000000-0000-0000-0000-000000000001)",
    "msdyn_resourceassignmentid@odata.bind": "/msdyn_resourceassignments(00000000-0000-0000-0000-000000000003)",
    "msdyn_allocatedhoursperday": 8,
    "msdyn_billingtype": "Billable",
    "msdyn_effort": 40,
    "msdyn_plannedwork": 40
  }
}
```

### Create Project Bucket

```json
{
  "operation": "Create",
  "entity": "msdyn_projectbucket",
  "attributes": {
    "msdyn_projectid@odata.bind": "/msdyn_projects(00000000-0000-0000-0000-000000000000)",
    "msdyn_name": "Bucket Name",
    "msdyn_description": "Bucket description",
    "msdyn_isarchived": false
  }
}
```

---

## ODATA Binding Syntax

### Reference Fields (Lookups)

Use `@odata.bind` for all lookup fields:

```json
{
  "fieldname@odata.bind": "/entityname(guid)"
}
```

Examples:
```json
{
  "msdyn_projectid@odata.bind": "/msdyn_projects(11111111-1111-1111-1111-111111111111)",
  "msdyn_parenttaskid@odata.bind": "/msdyn_projecttasks(22222222-2222-2222-2222-222222222222)",
  "msdyn_teamid@odata.bind": "/teams(33333333-3333-3333-3333-333333333333)",
  "msdyn_ownerid@odata.bind": "/systemusers(44444444-4444-4444-4444-444444444444)"
}
```

### Special Characters in Values

If field values contain quotes or special characters, escape them:

```json
{
  "msdyn_taskname": "Task Name with \"quotes\" and special chars"
}
```

Or use dynamic content in Power Automate:
```
@{replace(items('ForEach_Tasks')?['msdyn_taskname'], '"', '\\"')}
```

---

## Error Handling in HTTP Responses

### Success Response (Status 0)

```json
{
  "operationSetResultId": "00000000-0000-0000-0000-000000000000",
  "operationResults": [
    {
      "operationIndex": 0,
      "status": 0,
      "statusMessage": "Success",
      "guid": "00000000-0000-0000-0000-000000000001"
    }
  ]
}
```

### Partial Success Response (Status 1)

Some operations succeeded, others failed:

```json
{
  "operationSetResultId": "00000000-0000-0000-0000-000000000000",
  "operationResults": [
    {
      "operationIndex": 0,
      "status": 0,
      "statusMessage": "Success",
      "guid": "00000000-0000-0000-0000-000000000001"
    },
    {
      "operationIndex": 1,
      "status": 2,
      "statusMessage": "Invalid parent task GUID",
      "errorCode": "0x80040402"
    }
  ]
}
```

### Error Response (HTTP 400/500)

```json
{
  "error": {
    "code": "0x80040402",
    "message": "Operation Set execution failed: Invalid operation index 2. Parent task GUID does not exist."
  }
}
```

**Power Automate Error Handling**:

```
Connector: Control
Action: Condition
Expression: @{empty(body('HTTP_Execute_OperationSet')?['operationResults'])}

True:
  // HTTP Error occurred
  Set varErrorDetails to: @{body('HTTP_Execute_OperationSet')?['error']?['message']}

False:
  // Check for partial failures
  ForAll(body('HTTP_Execute_OperationSet')?['operationResults'],
    If(status > 0,
      // Operation failed
      Append(varFailedOperations, [operation details])
    )
  )
```

---

## Polling OperationSet Status

After executing an OperationSet, poll until it completes.

### Query OperationSet Record

```
Connector:        Dataverse (cr_TargetDataverse)
Action:           Get a row
Table:            msdyn_operationsets
Row ID:           varOperationSetId
Select Columns:   msdyn_operationsetid,
                  statecode,
                  statuscode,
                  msdyn_operationcount,
                  msdyn_completedcount,
                  msdyn_failurecount,
                  msdyn_errormessage,
                  createdon,
                  modifiedon
```

### Status Codes

```
msdyn_operationset.statecode:
  0 = Active
  1 = Completed
  2 = Failed

msdyn_operationset.statuscode:
  192350000 = New
  192350001 = In Progress
  192350002 = Completed
  192350003 = Completed with Errors
  192350004 = Failed
```

### Polling Loop in Power Automate

```
Connector: Control
Action: Do until
Property: varOperationSetStatus
Operator: equals
Value: "Completed"
Timeout: 30 minutes

Actions inside:
  1. Query OperationSet record
  2. Check statecode
  3. If statecode = 1 (Completed), set varOperationSetStatus = "Completed"
  4. Else delay 10 seconds
```

**Full Configuration**:

```
Connector: Control
Action: Do until
Property: @{variables('varOperationSetStatus')}
Operator: is equal to
Value: Completed
Timeout: 30

Inside loop:
  1. Get OperationSet row
     Connector: Dataverse
     Action: Get a row
     Table: msdyn_operationsets
     Row ID: @{variables('varOperationSetId')}

  2. Compose current status
     Connector: Data Operations
     Action: Compose
     Inputs: @{body('Get_OperationSet_Status')?['statuscode']}

  3. Condition: Check if completed
     Expression: @{equals(body('Get_OperationSet_Status')?['statecode'], 1)}

     True:
       Set varOperationSetStatus = "Completed"

     False:
       Condition: Check if failed
       Expression: @{equals(body('Get_OperationSet_Status')?['statecode'], 2)}

       True:
         Set varOperationSetStatus = "Failed"
         Set varOperationSetError = @{body('Get_OperationSet_Status')?['msdyn_errormessage']}

       False:
         Delay 10 seconds
```

---

## Rate Limiting & Throttling

### Dataverse API Limits

```
6,000 requests per 5 minutes per environment
= 20 requests per second (average)

For 190 projects × 100 operations each = 19,000 operations
= Estimate 3,000 API calls (data retrieval + OperationSet creation + polling)
= Well within limits
```

### Schedule API Specific Limits

```
OperationSet max operations: ~100-200 per execution
OperationSet max payload: ~10MB per request
OperationSet max duration: 30+ minutes (varies by operation count)
```

### Handling Throttling

If you receive a 429 (Too Many Requests) response:

```
Power Automate Configuration:

  Connector: Control
  Action: Condition
  Expression: @{equals(outputs('HTTP_Execute_OperationSet')?['statusCode'], 429)}

  True:
    Delay 30 seconds (exponential backoff)
    Retry the HTTP action

  False:
    Continue with next action
```

---

## Complete Example: Build and Execute OperationSet

### Step 1: Create OperationSet

```
Connector: HTTP with Azure AD
Method: POST
URI: /api/data/v9.2/msdyn_CreateOperationSetV1
Body:
{
  "displayName": "ProjectMigration_TestProject_Phase1",
  "operationSetType": 192350000
}

Response:
{
  "operationSetId": "12345678-1234-1234-1234-123456789012"
}
```

### Step 2: Build Operations Array

```
Initialize varOperationSet1Operations = []

ForEach teamMember in source.teamMembers:
  Append {
    "operation": "Create",
    "entity": "msdyn_projectteam",
    "attributes": {
      "msdyn_projectid@odata.bind": "/msdyn_projects(target-project-id)",
      "msdyn_teamid@odata.bind": "/teams(team-guid)",
      "msdyn_role": teamMember.role
    }
  }

ForEach task in source.tasks (sorted by outlineLevel):
  If no parent:
    Append {
      "operation": "Create",
      "entity": "msdyn_projecttask",
      "attributes": {
        "msdyn_projectid@odata.bind": "/msdyn_projects(target-project-id)",
        "msdyn_taskname": task.name,
        "msdyn_duration": task.duration,
        "msdyn_outlinelevel": task.outlineLevel
      }
    }
```

### Step 3: Execute OperationSet

```
Connector: HTTP with Azure AD
Method: POST
URI: /api/data/v9.2/msdyn_ExecuteOperationSetV1
Body:
{
  "operationSetId": "12345678-1234-1234-1234-123456789012",
  "operations": [
    {...all operations from varOperationSet1Operations...}
  ]
}

Response:
{
  "operationSetResultId": "87654321-4321-4321-4321-987654321098",
  "operationResults": [
    {
      "operationIndex": 0,
      "status": 0,
      "statusMessage": "Success",
      "guid": "aaaa-aaaa-aaaa-aaaa-aaaa"
    },
    {
      "operationIndex": 1,
      "status": 0,
      "statusMessage": "Success",
      "guid": "bbbb-bbbb-bbbb-bbbb-bbbb"
    }
  ]
}
```

### Step 4: Extract GUID Mappings

```
Initialize varTaskGUIDMapping = {}

ForEach result in operationResults:
  If operationIndex matches a task operation:
    varTaskGUIDMapping[sourceTaskGuid] = result.guid
```

### Step 5: Poll for Completion

```
Do Until varOperationSetStatus = "Completed":
  Get OperationSet record with status
  If statecode = 1:
    Set varOperationSetStatus = "Completed"
  Else:
    Delay 10 seconds
```

---

## Troubleshooting Common Errors

### Error: "Invalid parent task GUID"

**Cause**: Parent task GUID doesn't exist in target environment

**Solution**:
- Ensure tasks are sorted by OutlineLevel (parents created first)
- Verify GUID mapping was stored correctly
- Use child task operations only after parent has been created and GUID captured

### Error: "Operation Set execution failed"

**Cause**: Too many operations in single OperationSet, or invalid field values

**Solution**:
- Reduce operations per OperationSet (max 100)
- Split into multiple smaller OperationSets
- Validate field values (check for NULL where not allowed)

### Error: "Throttled: Too many requests"

**Cause**: Exceeding Dataverse API limits

**Solution**:
- Add delays between OperationSet executions
- Reduce operations per OperationSet
- Spread migrations over longer period

### Error: "Access Denied - User does not have permission"

**Cause**: Service principal (App Registration) doesn't have proper permissions

**Solution**:
- Verify App Registration has "user_impersonation" permission on Dynamics CRM API
- Grant admin consent to the application
- Check that service principal user has proper security role in target environment

