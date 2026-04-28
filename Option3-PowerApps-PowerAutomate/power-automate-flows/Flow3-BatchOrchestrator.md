# Power Automate Flow 3: Batch Orchestrator (Optional)

## Flow Overview

**Flow Name**: Flow3_BatchOrchestrator

**Purpose**: Manage sequential migration of multiple projects, preventing concurrent imports to the target environment which could cause throttling or overload.

**Trigger Type**: Manual (button in canvas app) or scheduled (nightly)

**Duration**: Varies (total time = sum of all project migrations)

**Use Case**: When migrating 190 projects, running all in parallel can overwhelm the target environment. This orchestrator processes one project at a time.

---

## Architecture: Sequential vs. Parallel

### Without Orchestrator (Current)
```
Canvas App → For Each Selected Project → Trigger Flow1
All Flow1 instances run in PARALLEL
When all Flow1 complete → Flow2 instances start in PARALLEL
Result: All imports hit target environment simultaneously → THROTTLING
```

### With Orchestrator (Recommended for 190 projects)
```
Canvas App → Trigger Orchestrator
Orchestrator queues all pending projects
Orchestrator Loop:
  - Take first pending project
  - Trigger Flow1 (wait for completion)
  - Trigger Flow2 (wait for completion)
  - Move to next project
Result: One project being imported at a time → NO THROTTLING
```

---

## Flow Trigger Configuration

### Trigger Type: Manual (Button)

```
Connector:        Power Automate
Action:           Manual trigger
Inputs:           Optional - can accept parameters
```

### Alternative: Scheduled Trigger

```
Connector:        Schedule
Action:           Recurrence
Frequency:        Daily
Time:             11:00 PM (after business hours)
Condition:        Only run if pending projects exist
```

---

## Complete Flow Actions

### Action 1: Query Pending Projects

Get all migration tracker records with status = "Pending".

```
Connector:        Dataverse
Action:           List rows
Table:            cr_projectmigrations
Filter:           cr_status eq 100000000 (Pending)
Order By:         cr_migrationstarteddate asc
Top Count:        250
```

**Configuration**:
```
Connector: Dataverse (cr_SourceDataverse)
Action: List rows
Table Name: cr_projectmigrations
Filter Query: cr_status eq 100000000
Order By: cr_migrationstarteddate asc
```

**Store in Variable**:
```
Connector: Variables
Action: Initialize variable
Name: varPendingProjects
Type: Array
Value: value (from list rows)
```

---

### Action 2: Check if Any Pending Projects

Add a condition to only proceed if there are pending projects.

```
Connector:        Control
Action:           Condition
Expression:       @{not(empty(variables('varPendingProjects')))}

True Branch:      Continue with orchestration
False Branch:     Terminate (no projects to migrate)
```

---

### Action 3: Initialize Counters

Track progress through the migration queue.

```
Connector:        Variables
Action:           Initialize variable
Name:             varCurrentProjectIndex
Type:             Integer
Value:            0

Connector:        Variables
Action:           Initialize variable
Name:             varTotalProjects
Type:             Integer
Value:            @{length(variables('varPendingProjects'))}

Connector:        Variables
Action:           Initialize variable
Name:             varCompletedProjects
Type:             Integer
Value:            0

Connector:        Variables
Action:           Initialize variable
Name:             varFailedProjects
Type:             Integer
Value:            0
```

---

### Action 4: Main Loop - Process Projects Sequentially

Loop through each pending project.

```
Connector:        Control
Action:           Do until
Property:         varCurrentProjectIndex
Operator:         is greater than or equal to
Value:            varTotalProjects
Timeout:          24 hours (to allow 190 projects × 80 min each)

Actions inside loop:
  [Orchestrate Flow1 and Flow2 for current project]
```

---

### Action 5A: Get Current Project (inside loop)

Get the details of the project being processed.

```
Connector:        Data Operations
Action:           Compose
Inputs:           @{variables('varPendingProjects')[variables('varCurrentProjectIndex')]}

Store in Variable:
Name:             varCurrentProjectRecord
Type:             Object
Value:            @{outputs('Compose_current_project')}
```

---

### Action 5B: Update Status to "Exporting"

Set the project status to "Exporting" to indicate processing has started.

```
Connector:        Dataverse
Action:           Update a row
Table:            cr_projectmigrations
Row ID:           @{variables('varCurrentProjectRecord')?['cr_projectmigrationid']}
Columns:
  cr_status:      100000001 (Exporting)
```

---

### Action 6: Trigger Flow1 (Export)

Call Flow 1 to export the project.

```
Connector:        Power Automate Management
Action:           Trigger a flow action
Flow:             Flow1_ExportProject
Inputs:
  projectMigrationId: @{variables('varCurrentProjectRecord')?['cr_projectmigrationid']}
  sourceProjectId: @{variables('varCurrentProjectRecord')?['cr_sourceprojectid']}
```

**Store Flow1 Result**:
```
Connector: Variables
Action: Initialize variable
Name: varFlow1Result
Type: Object
Value: @{body('Trigger_Flow1')}
```

---

### Action 7: Wait for Flow1 Completion

Wait for Flow 1 to complete (until status = "Exported").

```
Connector:        Control
Action:           Do until
Property:         varExportStatus
Operator:         equals
Value:            "Exported"
Timeout:          10 minutes

Actions inside:
  1. Query migration tracker for current project
  2. Get cr_status field
  3. If status = 100000002 (Exported), set varExportStatus = "Exported"
  4. Else if status = 100000005 (Failed), set varExportStatus = "Failed"
  5. Else wait 30 seconds
```

**Query Status**:
```
Connector: Dataverse
Action: Get a row
Table: cr_projectmigrations
Row ID: @{variables('varCurrentProjectRecord')?['cr_projectmigrationid']}
Select Columns: cr_status, cr_errordetails
```

**Check Status**:
```
Connector: Control
Action: Condition
Expression: @{equals(body('Get_project_status')?['cr_status'], 100000002)}

True: Set varExportStatus = "Exported"
False:
  Condition: status = 100000005
  True: Set varExportStatus = "Failed"
  False: Wait 30 seconds
```

---

### Action 8: Handle Export Failure (Optional)

Check if export failed and decide whether to continue or abort.

```
Connector:        Control
Action:           Condition
Expression:       @{equals(variables('varExportStatus'), 'Failed')}

True Branch:
  - Increment varFailedProjects
  - Log error: "Export failed for project [name]"
  - Continue to next project (don't attempt import)

False Branch:
  - Continue with import
```

---

### Action 9: Trigger Flow2 (Import)

Call Flow 2 to import the project into target environment.

```
Connector:        Power Automate Management
Action:           Trigger a flow action
Flow:             Flow2_ImportProject
Inputs:
  projectMigrationId: @{variables('varCurrentProjectRecord')?['cr_projectmigrationid']}
  sourceProjectId: @{variables('varCurrentProjectRecord')?['cr_sourceprojectid']}
  targetEnvironmentURL: https://[target-org].crm.dynamics.com
```

---

### Action 10: Wait for Flow2 Completion

Wait for Flow 2 to complete (until status = "Completed" or "Failed").

```
Connector:        Control
Action:           Do until
Property:         varImportStatus
Operator:         is not empty
Value:            ""
Timeout:          60 minutes

Actions inside:
  1. Query migration tracker for current project
  2. Get cr_status field
  3. If status = 100000004 (Completed), set varImportStatus = "Completed"
  4. If status = 100000005 (Failed), set varImportStatus = "Failed"
  5. Else wait 30 seconds
```

---

### Action 11: Update Progress Counters

Update the completion counters based on import result.

```
Connector:        Control
Action:           Condition
Expression:       @{equals(variables('varImportStatus'), 'Completed')}

True:
  - Increment varCompletedProjects
  - Optional: Send success email

False:
  - Increment varFailedProjects
  - Optional: Send failure email
```

---

### Action 12: Increment Loop Counter

Move to the next project.

```
Connector:        Variables
Action:           Increment variable
Name:             varCurrentProjectIndex
Increment value:  1
```

---

### Action 13: Log Progress

Log the current status (optional, for debugging).

```
Connector:        Data Operations
Action:           Compose
Inputs:
{
  "timestamp": "@{utcNow()}",
  "currentIndex": "@{variables('varCurrentProjectIndex')}",
  "totalProjects": "@{variables('varTotalProjects')}",
  "completedProjects": "@{variables('varCompletedProjects')}",
  "failedProjects": "@{variables('varFailedProjects')}",
  "progressPercent": "@{div(mul(variables('varCompletedProjects'), 100), variables('varTotalProjects'))}"
}
```

**Store Progress**:
```
Connector: Variables
Action: Append to array variable
Name: varProgressLog
Value: @{outputs('Compose_progress')}
```

---

### Action 14: Delay Between Projects (Optional)

Add a delay between projects to avoid API throttling.

```
Connector:        Control
Action:           Delay
Duration:         30 (seconds)
```

---

## End of Loop - Final Summary

After the loop completes, create a summary report.

### Action 15: Generate Final Report

Create a summary of the migration.

```
Connector:        Data Operations
Action:           Compose
Inputs:
{
  "totalProjectsMigrated": @{variables('varTotalProjects')},
  "successfulMigrations": @{variables('varCompletedProjects')},
  "failedMigrations": @{variables('varFailedProjects')},
  "successRate": "@{div(mul(variables('varCompletedProjects'), 100), variables('varTotalProjects'))}%",
  "startTime": "@{variables('varStartTime')}",
  "endTime": "@{utcNow()}",
  "progressLog": @{variables('varProgressLog')}
}
```

---

### Action 16: Send Summary Email

Send a comprehensive summary to project stakeholders.

```
Connector:        Office 365 Mail
Action:           Send an email
To:               migration-team@company.com
Subject:          "Batch Migration Complete: @{variables('varCompletedProjects')} of @{variables('varTotalProjects')} projects"
Body:
Migration Batch Summary
=======================

Total Projects Queued: @{variables('varTotalProjects')}
Successful Migrations: @{variables('varCompletedProjects')}
Failed Migrations: @{variables('varFailedProjects')}
Success Rate: @{div(mul(variables('varCompletedProjects'), 100), variables('varTotalProjects'))}%

Start Time: @{variables('varStartTime')}
End Time: @{utcNow()}
Duration: [calculated from above]

Failed Projects:
@{variables('varProgressLog')[?@.status == 'Failed']}

Next Steps:
- Review failed migrations in the dashboard
- Retry failed projects if appropriate
- Verify all data in target environment
```

---

### Action 17: Store Summary in Custom Record (Optional)

Create a migration summary record for future reference.

```
Connector:        Dataverse
Action:           Create a new row
Table:            [Custom table: cr_migrationsummary]
Columns:
  cr_batchname:   "Batch_@{utcNow('yyyyMMdd_HHmmss')}"
  cr_starttime:   @{variables('varStartTime')}
  cr_endtime:     @{utcNow()}
  cr_totalmigrated: @{variables('varTotalProjects')}
  cr_successcount: @{variables('varCompletedProjects')}
  cr_failurecount: @{variables('varFailedProjects')}
  cr_summary:     @{string(outputs('Compose_final_report'))}
```

---

## Error Handling

### Global Try/Catch

Wrap the entire orchestration in error handling.

```
Scope Name: Try_BatchOrchestration
Actions: [All actions 1-17 above]

Scope Name: Catch_BatchOrchestration
Run after: Try scope fails
Actions:
  1. Log error to migration summary table
  2. Send error email to admin
  3. Terminate with error message
```

### Per-Project Error Recovery

If Flow 1 or Flow 2 fails for a project:
- Update varFailedProjects counter
- Log error details
- Continue to next project (don't stop entire batch)
- Move failed project to manual review queue

---

## Monitoring Dashboard Updates

The canvas app dashboard should show:
- Progress bar: "X of Y projects completed"
- Current project being migrated: "[Project Name] - Importing..."
- Failed projects list: "(Click to view details)"
- Overall status: "Batch migration in progress" / "Completed"
- Estimated time remaining: "Y hours Z minutes"

---

## Configuration Options

### Sequential (Recommended)
```
Run one project at a time
Advantage: No throttling, predictable
Disadvantage: Slower (190 × 80 min = ~11 days)
```

### Batch Sequential (Compromise)
```
Run 2-3 projects in parallel, queue the rest
Advantage: Faster than single sequential (~4 days for 3 parallel)
Disadvantage: More complex, needs error handling per batch
```

Implementation: Fork the loop into multiple concurrent Flow2 triggers, but limit to N at a time using a semaphore pattern.

---

## Testing Checklist

- [ ] Test with 3 pending projects
- [ ] Verify projects are processed in order
- [ ] Verify counters increment correctly
- [ ] Verify progress log captures each step
- [ ] Verify summary email sends correctly
- [ ] Test error handling (mock a Flow1 failure)
- [ ] Test timeout handling (60+ minute migrations)
- [ ] Verify can be run multiple times without conflicts
- [ ] Check Power Automate action counts per run
- [ ] Test with scheduling trigger (nightly)

---

## Performance Characteristics

### Time Estimates for 190 Projects

- Sequential: 190 × 80 min = ~11 days (non-stop)
- With nightly execution (8 hours/night): 190 / (8×60/80) = ~20 days
- Recommended: Run nightly + manual runs during day = 10-15 days total

### Action Counts

- Per project cycle: ~20 actions
- Total for 190 projects: ~3800 actions (well within monthly Power Automate limits)

---

## Canvas App Integration

### Button to Start Batch Orchestrator

In Screen 2 (Project Selection), add button:

```
Button: btnStartBatchMigration
OnSelect:
  'Flow3_BatchOrchestrator'();
  Notify("Batch orchestrator started. Check dashboard for progress.",
         NotificationType.Success);
  Navigate(Screen3_MigrationDashboard)
```

### Alternative: Let Canvas App Trigger Flow1 Directly

Canvas app creates tracker records and triggers Flow1 for all selected projects.
Orchestrator runs separately (nightly) to handle Flow2 sequentially.

```
Canvas App Flow:
1. User selects projects
2. Canvas app creates tracker records (status = Pending)
3. Canvas app triggers Flow1 for ALL projects in parallel
4. Canvas app navigates to dashboard
5. Nightly Orchestrator runs:
   - Waits for Flow1 to complete on all projects
   - Triggers Flow2 sequentially
```

---

## Alternative: Simple Sequential without Orchestrator

If you don't want to create a separate orchestrator flow, the canvas app can do this:

```powerapps
Button: btnStartMigrationSequential
OnSelect:
  Set(varMigrationRunning, true);
  ForAll(colSelectedProjects,
    (
      // Create tracker record
      Patch(..., {status: 100000000});

      // Trigger Flow1
      'Flow1_ExportProject'(...);

      // WAIT for Flow1 to complete (poll status)
      Set(varExporting, true);
      While(varExporting,
        If(
          LookUp(colMigrationTracker, cr_sourceprojectid = projectid)?['cr_status'] = 100000002,
          Set(varExporting, false),
          Delay(5000)
        )
      );

      // Trigger Flow2
      'Flow2_ImportProject'(...);

      // WAIT for Flow2 to complete
      Set(varImporting, true);
      While(varImporting,
        If(
          LookUp(colMigrationTracker, cr_sourceprojectid = projectid)?['cr_status'] = 100000004,
          Set(varImporting, false),
          Delay(5000)
        )
      )
    )
  );
  Set(varMigrationRunning, false)
```

**Caveat**: Canvas apps have a 5-minute timeout, so this won't work for >3-4 projects. Use the Power Automate orchestrator instead.

