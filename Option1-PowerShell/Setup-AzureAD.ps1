<#
.SYNOPSIS
Helper script to guide Azure AD App Registration creation.

.DESCRIPTION
This script provides an interactive guide for creating the required Azure AD App
Registrations and application users in D365 environments.

NOTE: This script is informational and requires manual completion in Azure Portal
and D365 due to permission requirements.

.EXAMPLE
./Setup-AzureAD.ps1
#>

Write-Host "Azure AD App Registration Setup Helper" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "This script guides you through creating Azure AD App Registrations" -ForegroundColor White
Write-Host "and Application Users for the migration tool." -ForegroundColor White
Write-Host ""

Write-Host "PREREQUISITES:" -ForegroundColor Yellow
Write-Host "  - Access to Azure Portal as Global Administrator" -ForegroundColor White
Write-Host "  - Access to both Dynamics 365 environments as System Administrator" -ForegroundColor White
Write-Host "  - Both D365 environments must be running Project Operations" -ForegroundColor White
Write-Host ""

Write-Host "STEP 1: Create Source Environment App Registration" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Go to: https://portal.azure.com" -ForegroundColor White
Write-Host "2. Search for 'App registrations' and click on it" -ForegroundColor White
Write-Host "3. Click '+ New registration'" -ForegroundColor White
Write-Host "4. Fill in the form:" -ForegroundColor White
Write-Host "     - Name: D365-ProjectMigration-Source" -ForegroundColor White
Write-Host "     - Supported account types: Accounts in this organizational directory only" -ForegroundColor White
Write-Host "5. Click 'Register'" -ForegroundColor White
Write-Host ""
Write-Host "6. In the new app's overview page:" -ForegroundColor White
Write-Host "     - COPY and save the 'Application (client) ID'" -ForegroundColor Yellow
Write-Host "     - COPY and save the 'Directory (tenant) ID'" -ForegroundColor Yellow
Write-Host ""
Write-Host "7. In the left sidebar, go to 'Certificates & secrets'" -ForegroundColor White
Write-Host "8. Click '+ New client secret'" -ForegroundColor White
Write-Host "9. Fill in the form:" -ForegroundColor White
Write-Host "     - Description: Migration Tool Secret" -ForegroundColor White
Write-Host "     - Expires: 24 months" -ForegroundColor White
Write-Host "10. Click 'Add'" -ForegroundColor White
Write-Host "11. IMMEDIATELY COPY the secret 'Value' (shown in blue)" -ForegroundColor Yellow
Write-Host "     You won't be able to see it again!" -ForegroundColor Red
Write-Host ""
Write-Host "12. In the left sidebar, go to 'API permissions'" -ForegroundColor White
Write-Host "13. Click '+ Add a permission'" -ForegroundColor White
Write-Host "14. In the 'APIs my organization uses' section, search for 'Dynamics CRM'" -ForegroundColor White
Write-Host "15. Click on 'Dynamics CRM'" -ForegroundColor White
Write-Host "16. Check the box for 'user_impersonation'" -ForegroundColor White
Write-Host "17. Click 'Add permissions'" -ForegroundColor White
Write-Host ""
Write-Host "18. Click 'Grant admin consent for [Your Organization]'" -ForegroundColor White
Write-Host "19. Click 'Yes' to confirm" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter when you've completed the source app registration"
Write-Host ""

Write-Host "STEP 2: Create Target Environment App Registration" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Repeat the same process as Step 1, but name it:" -ForegroundColor White
Write-Host "  - Name: D365-ProjectMigration-Target" -ForegroundColor White
Write-Host ""
Write-Host "Save the credentials:" -ForegroundColor Yellow
Write-Host "  - Client ID (Application ID)" -ForegroundColor White
Write-Host "  - Tenant ID (Directory ID)" -ForegroundColor White
Write-Host "  - Client Secret (the blue value)" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter when you've completed the target app registration"
Write-Host ""

Write-Host "STEP 3: Create Application User in Source D365 Environment" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Go to your source D365 environment" -ForegroundColor White
Write-Host "2. Navigate to: Settings -> Security -> Users" -ForegroundColor White
Write-Host "3. Click '+ New' button" -ForegroundColor White
Write-Host "4. Select 'Application User'" -ForegroundColor White
Write-Host "5. Fill in the form:" -ForegroundColor White
Write-Host "     - Application ID: <Use the source App Registration Client ID>" -ForegroundColor White
Write-Host "     - First Name: Migration" -ForegroundColor White
Write-Host "     - Last Name: Tool" -ForegroundColor White
Write-Host "     - Primary Email: Leave blank" -ForegroundColor White
Write-Host "6. Click 'Save'" -ForegroundColor White
Write-Host ""
Write-Host "7. In the user record, click 'Manage Roles'" -ForegroundColor White
Write-Host "8. Assign the 'Project Manager' role" -ForegroundColor White
Write-Host "9. Click 'OK'" -ForegroundColor White
Write-Host "10. Click 'Save'" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter when you've created the source application user"
Write-Host ""

Write-Host "STEP 4: Create Application User in Target D365 Environment" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Repeat the same process as Step 3, but:" -ForegroundColor White
Write-Host "  - Use the target App Registration Client ID" -ForegroundColor White
Write-Host "  - Assign to the target D365 environment" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter when you've created the target application user"
Write-Host ""

Write-Host "STEP 5: Configure Migration Tool" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Copy config.example.json to config.json:" -ForegroundColor White
Write-Host "     Copy-Item config.example.json config.json" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Edit config.json with your saved credentials:" -ForegroundColor White
Write-Host "     - sourceEnvironment.organizationUrl: Your source D365 URL" -ForegroundColor White
Write-Host "     - sourceEnvironment.tenantId: Source Azure AD Tenant ID" -ForegroundColor White
Write-Host "     - sourceEnvironment.clientId: Source App Registration Client ID" -ForegroundColor White
Write-Host "     - sourceEnvironment.clientSecret: Source App Registration Secret" -ForegroundColor White
Write-Host ""
Write-Host "     - targetEnvironment.organizationUrl: Your target D365 URL" -ForegroundColor White
Write-Host "     - targetEnvironment.tenantId: Target Azure AD Tenant ID" -ForegroundColor White
Write-Host "     - targetEnvironment.clientId: Target App Registration Client ID" -ForegroundColor White
Write-Host "     - targetEnvironment.clientSecret: Target App Registration Secret" -ForegroundColor White
Write-Host ""
Write-Host "3. Configure other settings as needed (batch sizes, logging, etc.)" -ForegroundColor White
Write-Host ""

Write-Host "STEP 6: Validate Configuration" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Run the validation script to test connectivity:" -ForegroundColor White
Write-Host "  ./Validate-Config.ps1 -ConfigPath './config.json'" -ForegroundColor Gray
Write-Host ""
Write-Host "This will:" -ForegroundColor White
Write-Host "  - Validate config.json format" -ForegroundColor White
Write-Host "  - Test authentication to both environments" -ForegroundColor White
Write-Host "  - Verify API connectivity" -ForegroundColor White
Write-Host "  - Check application user permissions" -ForegroundColor White
Write-Host ""

Write-Host "STEP 7: Run Migration" -ForegroundColor Cyan
Write-Host "====================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Start the migration:" -ForegroundColor White
Write-Host "  ./Migrate-AllProjects.ps1 -ConfigPath './config.json'" -ForegroundColor Gray
Write-Host ""
Write-Host "Or export first to verify data:" -ForegroundColor White
Write-Host "  ./Migrate-AllProjects.ps1 -ConfigPath './config.json' -ExportOnly" -ForegroundColor Gray
Write-Host ""

Write-Host "TROUBLESHOOTING:" -ForegroundColor Yellow
Write-Host "  - 401 Unauthorized: Check application user exists in D365 with correct role" -ForegroundColor White
Write-Host "  - 403 Forbidden: Verify Project Manager role is assigned to app user" -ForegroundColor White
Write-Host "  - Token error: Check App Registration secret hasn't expired" -ForegroundColor White
Write-Host "  - API errors: Check D365 environment URL is correct" -ForegroundColor White
Write-Host ""

Write-Host "For more help, see README.md" -ForegroundColor Cyan
