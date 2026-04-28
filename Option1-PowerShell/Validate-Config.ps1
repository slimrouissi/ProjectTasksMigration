<#
.SYNOPSIS
Validates configuration and connectivity before migration.

.DESCRIPTION
Checks configuration format, validates credentials, and tests connectivity
to both environments.

.PARAMETER ConfigPath
Path to config.json file

.EXAMPLE
./Validate-Config.ps1 -ConfigPath "./config.json"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path $_ })]
    [string]$ConfigPath
)

$ErrorActionPreference = "Continue"

Write-Host "Configuration Validation Tool" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan

# Step 1: Load and validate JSON
Write-Host "`nStep 1: Loading configuration file..." -ForegroundColor Gray
try {
    $config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
    Write-Host "Configuration file loaded successfully" -ForegroundColor Green
}
catch {
    Write-Error "Failed to parse configuration JSON: $_"
    exit 1
}

# Step 2: Validate required fields
Write-Host "`nStep 2: Validating required configuration fields..." -ForegroundColor Gray

$requiredFields = @(
    "sourceEnvironment.organizationUrl",
    "sourceEnvironment.tenantId",
    "sourceEnvironment.clientId",
    "sourceEnvironment.clientSecret",
    "targetEnvironment.organizationUrl",
    "targetEnvironment.tenantId",
    "targetEnvironment.clientId",
    "targetEnvironment.clientSecret"
)

$missingFields = @()
foreach ($field in $requiredFields) {
    $parts = $field.Split('.')
    $obj = $config
    foreach ($part in $parts) {
        if (-not ($obj.PSObject.Properties.Name -contains $part)) {
            $missingFields += $field
            break
        }
        $obj = $obj.$part
    }
}

if ($missingFields.Count -gt 0) {
    Write-Error "Missing required configuration fields:"
    $missingFields | ForEach-Object { Write-Error "  - $_" }
    exit 1
}

Write-Host "All required fields present" -ForegroundColor Green

# Step 3: Validate URL formats
Write-Host "`nStep 3: Validating URL formats..." -ForegroundColor Gray

$sourceUrl = $config.sourceEnvironment.organizationUrl
$targetUrl = $config.targetEnvironment.organizationUrl

if (-not ($sourceUrl -match "^https:\/\/.+\.crm\.dynamics\.com$")) {
    Write-Warning "Source URL may be invalid: $sourceUrl"
}
else {
    Write-Host "Source URL valid: $sourceUrl" -ForegroundColor Green
}

if (-not ($targetUrl -match "^https:\/\/.+\.crm\.dynamics\.com$")) {
    Write-Warning "Target URL may be invalid: $targetUrl"
}
else {
    Write-Host "Target URL valid: $targetUrl" -ForegroundColor Green
}

# Step 4: Validate GUIDs
Write-Host "`nStep 4: Validating GUID formats..." -ForegroundColor Gray

$guidPattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"

if ($config.sourceEnvironment.tenantId -notmatch $guidPattern) {
    Write-Error "Invalid source tenantId format"
    exit 1
}
Write-Host "Source tenantId format valid" -ForegroundColor Green

if ($config.sourceEnvironment.clientId -notmatch $guidPattern) {
    Write-Error "Invalid source clientId format"
    exit 1
}
Write-Host "Source clientId format valid" -ForegroundColor Green

if ($config.targetEnvironment.tenantId -notmatch $guidPattern) {
    Write-Error "Invalid target tenantId format"
    exit 1
}
Write-Host "Target tenantId format valid" -ForegroundColor Green

if ($config.targetEnvironment.clientId -notmatch $guidPattern) {
    Write-Error "Invalid target clientId format"
    exit 1
}
Write-Host "Target clientId format valid" -ForegroundColor Green

# Step 5: Test source environment connectivity
Write-Host "`nStep 5: Testing source environment connectivity..." -ForegroundColor Gray

try {
    $tokenUri = "https://login.microsoftonline.com/$($config.sourceEnvironment.tenantId)/oauth2/v2.0/token"

    $tokenBody = @{
        client_id     = $config.sourceEnvironment.clientId
        client_secret = $config.sourceEnvironment.clientSecret
        scope         = "$($config.sourceEnvironment.organizationUrl)/.default"
        grant_type    = "client_credentials"
    }

    $response = Invoke-RestMethod -Uri $tokenUri -Method Post -Body $tokenBody -ContentType "application/x-www-form-urlencoded" -ErrorAction Stop

    if ($response.access_token) {
        Write-Host "Successfully authenticated to source environment" -ForegroundColor Green

        # Test API access
        $orgUri = "$($config.sourceEnvironment.organizationUrl)/api/data/v9.2/organizations"
        $headers = @{
            "Authorization" = "Bearer $($response.access_token)"
            "Accept"        = "application/json"
        }

        $apiResponse = Invoke-RestMethod -Uri $orgUri -Method Get -Headers $headers -ErrorAction Stop
        Write-Host "Source API accessible" -ForegroundColor Green
    }
    else {
        throw "No access token in response"
    }
}
catch {
    Write-Error "Failed to authenticate to source environment: $_"
    exit 1
}

# Step 6: Test target environment connectivity
Write-Host "`nStep 6: Testing target environment connectivity..." -ForegroundColor Gray

try {
    $tokenUri = "https://login.microsoftonline.com/$($config.targetEnvironment.tenantId)/oauth2/v2.0/token"

    $tokenBody = @{
        client_id     = $config.targetEnvironment.clientId
        client_secret = $config.targetEnvironment.clientSecret
        scope         = "$($config.targetEnvironment.organizationUrl)/.default"
        grant_type    = "client_credentials"
    }

    $response = Invoke-RestMethod -Uri $tokenUri -Method Post -Body $tokenBody -ContentType "application/x-www-form-urlencoded" -ErrorAction Stop

    if ($response.access_token) {
        Write-Host "Successfully authenticated to target environment" -ForegroundColor Green

        # Test API access
        $orgUri = "$($config.targetEnvironment.organizationUrl)/api/data/v9.2/organizations"
        $headers = @{
            "Authorization" = "Bearer $($response.access_token)"
            "Accept"        = "application/json"
        }

        $apiResponse = Invoke-RestMethod -Uri $orgUri -Method Get -Headers $headers -ErrorAction Stop
        Write-Host "Target API accessible" -ForegroundColor Green
    }
    else {
        throw "No access token in response"
    }
}
catch {
    Write-Error "Failed to authenticate to target environment: $_"
    exit 1
}

# Step 7: Validate batch settings
Write-Host "`nStep 7: Validating batch settings..." -ForegroundColor Gray

if ($config.batchSettings.operationSetMaxSize -gt 200) {
    Write-Warning "OperationSet max size exceeds recommended limit of 200"
}
elseif ($config.batchSettings.operationSetMaxSize -lt 10) {
    Write-Warning "OperationSet max size is very small, may impact performance"
}
else {
    Write-Host "OperationSet max size valid: $($config.batchSettings.operationSetMaxSize)" -ForegroundColor Green
}

if ($config.batchSettings.pageSize -gt 5000) {
    Write-Warning "Page size exceeds recommended limit of 5000"
}
else {
    Write-Host "Page size valid: $($config.batchSettings.pageSize)" -ForegroundColor Green
}

# Step 8: Validate retry settings
Write-Host "`nStep 8: Validating retry settings..." -ForegroundColor Gray

if ($config.retrySettings.maxRetries -lt 1) {
    Write-Warning "Max retries is less than 1, errors may not be handled well"
}
else {
    Write-Host "Max retries valid: $($config.retrySettings.maxRetries)" -ForegroundColor Green
}

# Step 9: Validate custom field mappings
Write-Host "`nStep 9: Validating custom field mappings..." -ForegroundColor Gray

if ($config.customFieldMappings -and $config.customFieldMappings.Count -gt 0) {
    Write-Host "Found $($config.customFieldMappings.Count) custom field mappings"

    foreach ($mapping in $config.customFieldMappings) {
        if (-not $mapping.sourceFieldName -or -not $mapping.targetFieldName) {
            Write-Warning "Mapping with missing source or target field name"
        }
        elseif ($mapping.isMapped -eq $true) {
            Write-Host "  - $($mapping.sourceFieldName) -> $($mapping.targetFieldName)" -ForegroundColor Green
        }
    }
}
else {
    Write-Host "No custom field mappings configured" -ForegroundColor Green
}

# Final summary
Write-Host "`n=============================" -ForegroundColor Cyan
Write-Host "Configuration Validation Complete" -ForegroundColor Green
Write-Host "=============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Summary:" -ForegroundColor White
Write-Host "  Source Environment: $($config.sourceEnvironment.organizationUrl)" -ForegroundColor White
Write-Host "  Target Environment: $($config.targetEnvironment.organizationUrl)" -ForegroundColor White
Write-Host "  Configuration Status: VALID" -ForegroundColor Green
Write-Host ""
Write-Host "You can now run migration:" -ForegroundColor Cyan
Write-Host "  ./Migrate-AllProjects.ps1 -ConfigPath `"$ConfigPath`"" -ForegroundColor Cyan
