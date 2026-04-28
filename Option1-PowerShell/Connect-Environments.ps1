<#
.SYNOPSIS
Authenticates to both source and target Dynamics 365 Project Operations environments.

.DESCRIPTION
This module handles OAuth2 authentication to both environments using Azure AD App Registration
credentials. It supports token refresh and provides authenticated HTTP clients for Web API calls.

.PARAMETER SourceConfig
The source environment configuration object containing organizationUrl, tenantId, clientId, clientSecret

.PARAMETER TargetConfig
The target environment configuration object containing organizationUrl, tenantId, clientId, clientSecret

.EXAMPLE
$clients = Connect-Environments -SourceConfig $sourceConfig -TargetConfig $targetConfig
#>

function Connect-Environments {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$SourceConfig,

        [Parameter(Mandatory = $true)]
        [object]$TargetConfig
    )

    Write-Host "Authenticating to source and target environments..." -ForegroundColor Cyan

    try {
        # Authenticate to source environment
        Write-Host "Connecting to source environment: $($SourceConfig.organizationUrl)" -ForegroundColor Gray
        $sourceClient = Get-AuthenticatedClient -Config $SourceConfig -EnvironmentName "Source"

        # Authenticate to target environment
        Write-Host "Connecting to target environment: $($TargetConfig.organizationUrl)" -ForegroundColor Gray
        $targetClient = Get-AuthenticatedClient -Config $TargetConfig -EnvironmentName "Target"

        Write-Host "Successfully authenticated to both environments." -ForegroundColor Green

        # Return hashtable with both clients
        return @{
            Source = $sourceClient
            Target = $targetClient
            SourceConfig = $SourceConfig
            TargetConfig = $TargetConfig
        }
    }
    catch {
        Write-Error "Failed to authenticate to environments: $_"
        throw
    }
}

<#
.SYNOPSIS
Gets an authenticated HTTP client for a specific environment using OAuth2 client credentials flow.

.DESCRIPTION
This function acquires an OAuth2 bearer token from Azure AD using the client credentials flow
and creates an authenticated HTTP client configured for Dynamics 365 Web API calls.

.PARAMETER Config
Configuration object containing tenantId, clientId, clientSecret, and organizationUrl

.PARAMETER EnvironmentName
Friendly name of the environment (for logging purposes)
#>
function Get-AuthenticatedClient {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$EnvironmentName
    )

    # Step 1: Acquire OAuth2 token from Azure AD
    Write-Verbose "Acquiring OAuth2 token for $EnvironmentName environment..."

    $tokenUri = "https://login.microsoftonline.com/$($Config.tenantId)/oauth2/v2.0/token"

    # Prepare token request body
    $tokenBody = @{
        client_id     = $Config.clientId
        client_secret = $Config.clientSecret
        scope         = "$($Config.organizationUrl)/.default"
        grant_type    = "client_credentials"
    }

    try {
        # Request token from Azure AD
        $tokenResponse = Invoke-RestMethod -Uri $tokenUri -Method Post -Body $tokenBody -ContentType "application/x-www-form-urlencoded"

        if (-not $tokenResponse.access_token) {
            throw "Failed to acquire access token. Response: $($tokenResponse | ConvertTo-Json)"
        }

        $accessToken = $tokenResponse.access_token
        Write-Verbose "Token acquired successfully for $EnvironmentName environment. Token expires in: $($tokenResponse.expires_in) seconds"

    }
    catch {
        Write-Error "Failed to acquire token from Azure AD for $EnvironmentName environment: $_"
        throw
    }

    # Step 2: Create authenticated HTTP client
    Write-Verbose "Creating authenticated HTTP client for $EnvironmentName environment..."

    $httpClient = [System.Net.Http.HttpClient]::new()

    # Add authorization header with Bearer token
    $httpClient.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $accessToken)

    # Add common headers for Dynamics 365 Web API
    $httpClient.DefaultRequestHeaders.Add("Accept", "application/json")
    $httpClient.DefaultRequestHeaders.Add("OData-Version", "4.0")
    $httpClient.DefaultRequestHeaders.Add("OData-MaxVersion", "4.0")
    $httpClient.DefaultRequestHeaders.Add("User-Agent", "D365-ProjectMigration-Tool/1.0")

    # Set timeout to 10 minutes (API calls can be long-running)
    $httpClient.Timeout = [timespan]::FromMinutes(10)

    # Step 3: Validate connection by querying organization
    try {
        Write-Verbose "Validating connection to $EnvironmentName environment..."

        $orgUri = "$($Config.organizationUrl)/api/data/v9.2/organizations"
        $response = $httpClient.GetAsync($orgUri).Result

        if (-not $response.IsSuccessStatusCode) {
            throw "Failed to validate connection. HTTP Status: $($response.StatusCode)"
        }

        Write-Verbose "Successfully validated connection to $EnvironmentName environment."
    }
    catch {
        Write-Error "Failed to validate connection to $EnvironmentName environment: $_"
        throw
    }

    # Step 4: Create custom object to track token and client
    $clientObject = [PSCustomObject]@{
        HttpClient = $httpClient
        AccessToken = $accessToken
        TokenExpiry = (Get-Date).AddSeconds($tokenResponse.expires_in)
        Config = $Config
        EnvironmentName = $EnvironmentName
    }

    return $clientObject
}

<#
.SYNOPSIS
Refreshes the OAuth2 token if it has expired or is about to expire.

.DESCRIPTION
Checks if the token is within 5 minutes of expiry. If so, requests a new token
and updates the HTTP client's authorization header.

.PARAMETER Client
The authenticated client object returned by Get-AuthenticatedClient
#>
function Refresh-Token {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Client
    )

    $timeUntilExpiry = $Client.TokenExpiry - (Get-Date)

    # Refresh if token expires in less than 5 minutes
    if ($timeUntilExpiry.TotalMinutes -lt 5) {
        Write-Verbose "Token for $($Client.EnvironmentName) environment expiring soon. Refreshing..."

        try {
            $tokenUri = "https://login.microsoftonline.com/$($Client.Config.tenantId)/oauth2/v2.0/token"

            $tokenBody = @{
                client_id     = $Client.Config.clientId
                client_secret = $Client.Config.clientSecret
                scope         = "$($Client.Config.organizationUrl)/.default"
                grant_type    = "client_credentials"
            }

            $tokenResponse = Invoke-RestMethod -Uri $tokenUri -Method Post -Body $tokenBody -ContentType "application/x-www-form-urlencoded"

            if (-not $tokenResponse.access_token) {
                throw "Failed to refresh token. Response: $($tokenResponse | ConvertTo-Json)"
            }

            # Update the client with new token
            $Client.AccessToken = $tokenResponse.access_token
            $Client.TokenExpiry = (Get-Date).AddSeconds($tokenResponse.expires_in)
            $Client.HttpClient.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $tokenResponse.access_token)

            Write-Verbose "Token refreshed successfully for $($Client.EnvironmentName) environment."
        }
        catch {
            Write-Error "Failed to refresh token for $($Client.EnvironmentName) environment: $_"
            throw
        }
    }
}

<#
.SYNOPSIS
Makes an authenticated Web API request with retry logic.

.DESCRIPTION
Executes a Web API request with automatic token refresh and configurable retry logic
with exponential backoff.

.PARAMETER Client
The authenticated client object

.PARAMETER Uri
The full API request URI

.PARAMETER Method
HTTP method (Get, Post, Patch, Delete)

.PARAMETER Body
Request body (for Post/Patch requests)

.PARAMETER RetryPolicy
Retry configuration object with maxRetries, initialDelaySeconds, exponentialBackoffMultiplier
#>
function Invoke-WebApiRequest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Client,

        [Parameter(Mandatory = $true)]
        [string]$Uri,

        [Parameter(Mandatory = $true)]
        [ValidateSet("Get", "Post", "Patch", "Delete")]
        [string]$Method,

        [Parameter(Mandatory = $false)]
        [string]$Body,

        [Parameter(Mandatory = $false)]
        [object]$RetryPolicy
    )

    # Refresh token if needed
    Refresh-Token -Client $Client

    # Default retry policy
    if (-not $RetryPolicy) {
        $RetryPolicy = @{
            maxRetries = 3
            initialDelaySeconds = 5
            exponentialBackoffMultiplier = 2.0
        }
    }

    $attempt = 0
    $delaySeconds = $RetryPolicy.initialDelaySeconds

    while ($attempt -le $RetryPolicy.maxRetries) {
        try {
            Write-Verbose "Invoking $Method request to: $Uri (Attempt: $($attempt + 1))"

            # Create content if body is provided
            $content = $null
            if ($Body) {
                $content = [System.Net.Http.StringContent]::new($Body, [System.Text.Encoding]::UTF8, "application/json")
            }

            # Execute request based on method
            $response = switch ($Method) {
                "Get" { $Client.HttpClient.GetAsync($Uri).Result }
                "Post" { $Client.HttpClient.PostAsync($Uri, $content).Result }
                "Patch" {
                    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new("PATCH"), $Uri)
                    $request.Content = $content
                    $Client.HttpClient.SendAsync($request).Result
                }
                "Delete" { $Client.HttpClient.DeleteAsync($Uri).Result }
            }

            # Check for success
            if ($response.IsSuccessStatusCode) {
                $responseContent = $response.Content.ReadAsStringAsync().Result
                Write-Verbose "Request succeeded with status: $($response.StatusCode)"

                # Parse JSON response if available
                if ($responseContent) {
                    return $responseContent | ConvertFrom-Json
                }
                return $response
            }

            # Handle specific error codes
            if ($response.StatusCode -eq 401) {
                Write-Verbose "Received 401 Unauthorized. Refreshing token..."
                Refresh-Token -Client $Client
            }
            elseif ($response.StatusCode -eq 429) {
                # Rate limiting - wait longer
                $retryAfter = $response.Headers | Where-Object { $_.Key -eq "Retry-After" } | Select-Object -ExpandProperty Value
                $delaySeconds = if ($retryAfter) { [int]$retryAfter[0] } else { $delaySeconds * $RetryPolicy.exponentialBackoffMultiplier }
                Write-Verbose "Rate limited. Waiting $delaySeconds seconds before retry..."
            }

            # Log error response
            $errorContent = $response.Content.ReadAsStringAsync().Result
            Write-Verbose "Request failed with status $($response.StatusCode): $errorContent"

            # If we haven't exceeded max retries, wait and retry
            if ($attempt -lt $RetryPolicy.maxRetries) {
                Write-Verbose "Waiting $delaySeconds seconds before retry..."
                Start-Sleep -Seconds $delaySeconds
                $delaySeconds = [math]::Min($delaySeconds * $RetryPolicy.exponentialBackoffMultiplier, 60)
                $attempt++
            }
            else {
                # Max retries exceeded
                throw "Request failed after $($attempt + 1) attempts. Final status: $($response.StatusCode). Response: $errorContent"
            }
        }
        catch [System.Exception] {
            if ($attempt -lt $RetryPolicy.maxRetries) {
                Write-Verbose "Error during request (Attempt $($attempt + 1)): $_. Retrying..."
                Start-Sleep -Seconds $delaySeconds
                $delaySeconds = [math]::Min($delaySeconds * $RetryPolicy.exponentialBackoffMultiplier, 60)
                $attempt++
            }
            else {
                throw
            }
        }
    }
}

# Export public functions
Export-ModuleMember -Function @(
    'Connect-Environments',
    'Get-AuthenticatedClient',
    'Refresh-Token',
    'Invoke-WebApiRequest'
)
