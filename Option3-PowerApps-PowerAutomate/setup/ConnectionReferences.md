# Connection References Setup Guide

## Overview

This solution requires multiple connections to Dataverse environments. This guide covers creating and configuring them properly so the solution is portable between environments.

---

## Prerequisites

### Software & Licensing

- Power Apps Premium License (for canvas app)
- Power Automate Premium License (for HTTP with Azure AD connector)
- Azure AD Tenant Admin access (to create App Registrations)
- Dynamics 365 Project Operations (Source & Target environments)

### Roles & Permissions

**User creating the solution**:
- System Administrator in both source and target D365 environments
- Azure AD Application Administrator (or Application Developer)
- Power Apps admin in your tenant

---

## Connection Types Needed

| Connection | Type | Purpose | Authentication | Environment |
|-----------|------|---------|-----------------|-------------|
| cr_SourceDataverse | Dataverse | Read-only data export | User account | SOURCE |
| cr_TargetDataverse | Dataverse | Create entities via Schedule API | Service Principal | TARGET |
| HTTP with Azure AD | HTTP | Schedule API calls | Service Principal | TARGET |

---

## Step 1: Create Dataverse Connection to SOURCE Environment

### 1A: In Power Automate / Power Apps

Navigate to **Connections**:

```
Power Apps portal > My apps > [Your App] > Edit
  OR
Power Automate portal > Connections
```

### 1B: Create New Dataverse Connection

```
Click "+ Create connection"
Search for: "Dataverse"
Select: "Dataverse" connector
```

### 1C: Authenticate as Source Environment User

```
Sign in with: Your source environment user account
  (This user must have read permissions on:
   - msdyn_projects
   - msdyn_projecttasks
   - msdyn_projectteams
   - msdyn_projectdependencies
   - msdyn_projectassignments
   - cr_projectmigration (custom table))

Dataverse Environment: Select source environment
  E.g., "Contoso - Source" (https://source-org.crm.dynamics.com)
```

### 1D: Rename Connection to cr_SourceDataverse

```
After creation, rename the connection:
1. Go to Power Automate > Connections
2. Find the newly created Dataverse connection
3. Click [...] > Rename
4. Enter: cr_SourceDataverse
5. Save
```

---

## Step 2: Create Dataverse Connection to TARGET Environment (Service Principal)

### 2A: Create Azure AD App Registration

**Goal**: Create a service principal that can programmatically create entities in the target environment.

```
Azure Portal > Azure Active Directory > App Registrations
Click: "+ New registration"

Name: D365ProjectMigration
Supported account types: Single tenant (default is fine)
Redirect URI: Leave blank for now
Click: Register
```

**Note the following values** (you'll need them):
- Application (Client) ID
- Directory (Tenant) ID

### 2B: Create Client Secret

```
In the app registration you just created:
Navigate: Certificates & secrets
Click: "+ New client secret"
Description: ProjectMigrationSecret
Expires: 24 months (or 12 months for higher security)
Click: Add

IMPORTANT: Copy the client secret VALUE immediately
(You won't be able to see it again)
Save in secure location (use Azure Key Vault for production)
```

### 2C: Grant API Permissions

```
In the app registration:
Navigate: API permissions
Click: "+ Add a permission"
Select: "Dynamics CRM" (or "Microsoft Dynamics CRM")
Under "Application permissions":
  Check: "user_impersonation"
Click: Add permissions

Click: "Grant admin consent for [Tenant Name]"
Confirm: Yes
Status should show: "Granted for [Tenant Name]"
```

### 2D: Create Dataverse Connection Using Service Principal

Now create the connection in Power Automate:

```
Power Automate > Connections
Click: "+ New connection"
Search for: "Dataverse"
Select: "Dataverse" connector
```

You'll see a dialog:
```
Do you want to connect as:
[ ] Your user account
[x] Service Principal (App Registration)
```

Select **Service Principal**, then fill in:

```
Authenticator: Your preferred auth method
  (For this scenario, select "Use your user account to sign in")

After signing in, you'll be prompted:
  Dataverse Environment URL: https://[target-org].crm.dynamics.com
  (Copy from your target D365 instance URL)

Create new connection:
  Tenant ID: [From Azure AD App Registration]
  Client ID: [Application ID from Azure AD]
  Client Secret: [Secret VALUE from step 2B]
```

### 2E: Test the Connection

```
After creating, test it:
Power Automate > Connections
Find the new connection
Click [...] > Test
Should see: "Connection successful"
```

### 2F: Rename to cr_TargetDataverse

```
Click [...] > Rename
Enter: cr_TargetDataverse
Save
```

---

## Step 3: HTTP with Azure AD Connection (For Schedule API)

### 3A: Create HTTP with Azure AD Connection

```
Power Automate > Connections
Click: "+ New connection"
Search for: "HTTP with Azure AD"
Select: "HTTP with Azure AD" connector
```

### 3B: Configure Service Principal Auth

```
You'll see a prompt:
Base Resource URL: https://[target-org].crm.dynamics.com
Tenant: [Select your tenant from dropdown]
Client ID: [Application ID from Azure AD App Registration]
Client Secret: [Secret VALUE from step 2B]

Click: Create
```

### 3C: Test the Connection

```
After creating, test it in a flow:
Use HTTP with Azure AD action
Method: GET
URI: /api/data/v9.2/msdyn_operationsets?$select=msdyn_operationsetid&$top=1

Should return a 200 response
```

### 3D: Store Connection Name

```
Rename if desired (optional):
cr_TargetHTTPAuth  OR  HTTPAzureAD_TargetEnv
```

---

## Step 4: Using Connection References in Solutions

To make the solution portable between environments, use **Connection References** instead of hardcoding connection names.

### 4A: Create Connection Reference in Power Apps Solution

```
Power Apps > Solutions
Create new solution:
  Name: ProjectTasksMigration_Solution
  Publisher: [Your publisher]
  Version: 1.0.0

In the solution:
  Click: New > Other > Connection Reference
```

### 4B: Configure Connection Reference 1 (Source)

```
Connection Reference Name: cr_SourceDataverse
Display Name: Source Dataverse Connection
Description: Connection to source Dynamics 365 environment (read-only)
Connector: Dataverse
Required: Yes (checked)
```

Leave the connection field empty for now. It will be filled during import.

### 4C: Configure Connection Reference 2 (Target)

```
Connection Reference Name: cr_TargetDataverse
Display Name: Target Dataverse Connection
Description: Connection to target Dynamics 365 environment (service principal)
Connector: Dataverse
Required: Yes (checked)
```

### 4D: Configure Connection Reference 3 (HTTP Auth)

```
Connection Reference Name: cr_TargetHTTPAuth
Display Name: Target HTTP with Azure AD
Description: HTTP connection for Schedule API calls (service principal)
Connector: HTTP with Azure AD
Required: Yes (checked)
```

---

## Step 5: Update Flows to Use Connection References

After creating connection references, update the flows to use them:

### 5A: In Flow 1 (Export)

Every Dataverse action that uses cr_SourceDataverse:

```
Old: Direct connector selection
  Environment: [Dropdown showing "Contoso - Source"]

New: Use connection reference
  Environment: @{variables('varSourceDataverseConnection')}
```

**Power Automate Configuration**:
```
Connector: Dataverse
Action: List rows
Table: msdyn_projects
Environment: [Leave default]
OR in "Connection" field, select:
  cr_SourceDataverse (Connection Reference)
```

### 5B: In Flow 2 (Import)

Every Dataverse action that uses cr_TargetDataverse:

```
Connector: Dataverse
Environment: cr_TargetDataverse (Connection Reference)
```

Every HTTP action that needs Schedule API:

```
Connector: HTTP with Azure AD
Connection: cr_TargetHTTPAuth (Connection Reference)
Base Resource URL: https://[target-org].crm.dynamics.com
```

### 5C: Canvas App Connections

In the canvas app, reference connections:

```
Power Fx Formula:
Set(varSourceConnection, 'Dataverse (cr_SourceDataverse)');
Set(varTargetConnection, 'Dataverse (cr_TargetDataverse)');

Then use in formulas:
'Dataverse (cr_SourceDataverse)'.Items('msdyn_projects')
'Dataverse (cr_TargetDataverse)'.Items('msdyn_projects')
```

---

## Step 6: Export Solution

Once all connection references are created and flows are configured:

```
Power Apps > Solutions
Select: ProjectTasksMigration_Solution
Click: Export
Choose: Managed or Unmanaged
  (Use Unmanaged for development, Managed for production)
Save: ProjectTasksMigration_managed.zip
```

---

## Step 7: Import Solution in Target Environment

To deploy to a different tenant or target environment:

```
Target Power Apps > Solutions
Click: Import
Select: ProjectTasksMigration_managed.zip
Click: Import

During import, you'll see prompts for Connection References:
```

### 7A: Map Source Dataverse Connection

```
Select: cr_SourceDataverse
Dropdown: [Select the source environment connection]
  OR Create new if it doesn't exist

When importing to TARGET environment:
  cr_SourceDataverse = connection to the SOURCE environment
  (Must be created first)
```

### 7B: Map Target Dataverse Connection

```
Select: cr_TargetDataverse
Dropdown: [Select the target environment connection]
  (This should be the cr_TargetDataverse connection you created)
```

### 7C: Map HTTP Auth Connection

```
Select: cr_TargetHTTPAuth
Dropdown: [Select the HTTP with Azure AD connection]
```

---

## Step 8: Verify Connections After Import

After importing the solution:

```
Power Apps > Solutions > [Your Solution]
Click: Cloud flows
For each flow:
  1. Open the flow
  2. Check all Dataverse actions show correct environment
  3. Check all HTTP actions have correct connection
  4. Save if any changes

For Canvas App:
  1. Open app in edit mode
  2. Check App > Connectors
  3. All three connections should be listed
  4. No errors should appear
```

---

## Troubleshooting Connection Issues

### Issue: "The connection has been deleted or is inaccessible"

**Cause**: Connection reference not properly mapped during import

**Solution**:
1. Go to Power Apps > Connections
2. Verify all three connections exist
3. If missing, create them manually
4. In the flow, update the connection references
5. Save the flow

---

### Issue: "Access Denied - User does not have permission"

**Cause**: Service principal (App Registration) doesn't have proper permissions

**Solution**:
1. Verify in Azure AD that the app registration has "user_impersonation" permission
2. Grant admin consent if not done
3. Verify the service principal user exists in the target D365 environment
4. Check that the service principal has the correct security role (Project Manager or System Administrator)

---

### Issue: "Dynamics 365 Environment URL is invalid"

**Cause**: Incorrect environment URL format

**Solution**:
1. Get the correct URL from your D365 environment:
   - Log in to D365 > Settings > Organization Properties
      - Copy the Organization Service URL
   - Remove "/Organization.svc" if present
   - Should be: https://[org-name].crm.dynamics.com

2. Update the connection with correct URL

---

### Issue: "401 Unauthorized" in HTTP with Azure AD

**Cause**: Invalid client secret or tenant ID

**Solution**:
1. Verify Client Secret hasn't expired (check in Azure AD)
2. Re-create the HTTP connection with correct values
3. Test the connection with a simple GET request first

---

## Security Best Practices

### 1. Never Hardcode Secrets

```
WRONG:
  Set(varClientSecret, "my-secret-123");

CORRECT:
  Store in Azure Key Vault
  Retrieve via Key Vault connector
  Pass to HTTP action via dynamic content
```

### 2. Use Least Privilege

```
Service Principal (App Registration):
  - Only grant "user_impersonation" permission
  - Don't grant "admin" roles
  - Create separate app registrations for source and target

Source Environment Connection:
  - Use a service account (not a named user)
  - Grant read-only permissions

Target Environment Connection:
  - Grant Create/Update permissions only for needed entities
  - Don't grant Delete permission unless necessary
```

### 3. Rotate Secrets Regularly

```
Every 6-12 months:
1. Create new client secret in Azure AD
2. Update the connection in Power Automate
3. Delete the old secret in Azure AD
4. Document the rotation in your change log
```

### 4. Monitor Connection Usage

```
Power Automate Analytics:
  - Monitor which flows use each connection
  - Check for failed runs due to permission errors
  - Set up alerts for repeated failures

Azure AD:
  - Monitor service principal sign-in activity
  - Check for suspicious access patterns
```

---

## Reference: Connection Configuration Summary

### cr_SourceDataverse

```
Type:              Dataverse
Authentication:    User Account
Environment:       Source Dynamics 365 Project Operations
Permissions:       Read
Tables:            msdyn_projects, msdyn_projecttasks,
                   msdyn_projectteams, msdyn_projectdependencies,
                   msdyn_projectassignments, cr_projectmigration
Used by:           Flow 1 (Export), Canvas App
```

### cr_TargetDataverse

```
Type:              Dataverse
Authentication:    Service Principal (App Registration)
Environment:       Target Dynamics 365 Project Operations
Permissions:       Create, Update
Tables:            msdyn_projects, msdyn_projecttasks,
                   msdyn_projectteams, msdyn_projectdependencies,
                   msdyn_projectassignments
Used by:           Flow 2 (Import)
Service Principal: D365ProjectMigration (Azure AD)
```

### cr_TargetHTTPAuth

```
Type:              HTTP with Azure AD
Authentication:    Service Principal (App Registration)
Base URL:          https://[target-org].crm.dynamics.com
API Calls:         Schedule API (msdyn_* actions)
Used by:           Flow 2 (Import) - OperationSet execution
Service Principal: D365ProjectMigration (Azure AD)
```

---

## Deployment Checklist

- [ ] Azure AD App Registration created (D365ProjectMigration)
- [ ] Client Secret generated and stored securely
- [ ] API permissions granted and admin consent provided
- [ ] cr_SourceDataverse connection created and tested
- [ ] cr_TargetDataverse connection created and tested
- [ ] cr_TargetHTTPAuth connection created and tested
- [ ] Connection references created in solution
- [ ] All flows updated to use connection references
- [ ] Canvas app updated to use connection references
- [ ] Solution exported (managed)
- [ ] Solution imported to test environment
- [ ] All connections re-mapped after import
- [ ] Test run with single project successful
- [ ] Full migration pilot with 5-10 projects successful

