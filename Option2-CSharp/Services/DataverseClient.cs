using Microsoft.Identity.Client;
using Newtonsoft.Json.Linq;
using Serilog;
using System.Net.Http.Json;

namespace ProjectMigration.Services;

/// <summary>
/// Wrapper around Dataverse Web API for authenticated communication with D365 environments.
/// Handles OAuth2 authentication, token refresh, retry logic, and rate limiting.
/// </summary>
public class DataverseClient : IDisposable
{
    private readonly string _environmentUrl;
    private readonly string _tenantId;
    private readonly string _clientId;
    private readonly string _clientSecret;
    private readonly RetryPolicyConfig _retryPolicy;
    private readonly HttpClient _httpClient;
    private string? _accessToken;
    private DateTime _tokenExpiry = DateTime.MinValue;
    private readonly IConfidentialClientApplication _msal;
    private readonly ILogger _logger;

    /// <summary>
    /// Initializes a new instance of the DataverseClient.
    /// </summary>
    public DataverseClient(
        string environmentUrl,
        string tenantId,
        string clientId,
        string clientSecret,
        RetryPolicyConfig retryPolicy,
        ILogger logger)
    {
        _environmentUrl = environmentUrl.TrimEnd('/');
        _tenantId = tenantId;
        _clientId = clientId;
        _clientSecret = clientSecret;
        _retryPolicy = retryPolicy;
        _logger = logger;
        _httpClient = new HttpClient();

        _msal = ConfidentialClientApplicationBuilder
            .Create(_clientId)
            .WithAuthority($"https://login.microsoftonline.com/{_tenantId}")
            .WithClientSecret(_clientSecret)
            .Build();
    }

    /// <summary>
    /// Gets a valid access token, refreshing if necessary.
    /// </summary>
    private async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
    {
        if (!string.IsNullOrEmpty(_accessToken) && DateTime.UtcNow < _tokenExpiry.AddMinutes(-5))
        {
            return _accessToken;
        }

        _logger.Debug("Acquiring new access token for {EnvironmentUrl}", _environmentUrl);

        try
        {
            var result = await _msal.AcquireTokenForClient(new[] { $"{_environmentUrl}/.default" })
                .ExecuteAsync(cancellationToken)
                .ConfigureAwait(false);

            _accessToken = result.AccessToken;
            _tokenExpiry = result.ExpiresOn.UtcDateTime;

            _logger.Debug("Token acquired successfully, expires at {ExpiryTime}", _tokenExpiry);

            return _accessToken;
        }
        catch (MsalServiceException ex)
        {
            _logger.Error(ex, "Failed to acquire access token: {ErrorCode}", ex.ErrorCode);
            throw;
        }
    }

    /// <summary>
    /// Performs a GET request to the Dataverse Web API with retry logic.
    /// </summary>
    public async Task<JObject> GetAsync(
        string path,
        CancellationToken cancellationToken = default)
    {
        var url = $"{_environmentUrl}/api/data/v9.2/{path.TrimStart('/')}";
        return await ExecuteWithRetryAsync(async () =>
        {
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            return await SendRequestAsync(request, cancellationToken).ConfigureAwait(false);
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Performs a POST request to the Dataverse Web API with retry logic.
    /// </summary>
    public async Task<JObject> PostAsync(
        string path,
        object data,
        CancellationToken cancellationToken = default)
    {
        var url = $"{_environmentUrl}/api/data/v9.2/{path.TrimStart('/')}";
        return await ExecuteWithRetryAsync(async () =>
        {
            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = JsonContent.Create(data)
            };
            return await SendRequestAsync(request, cancellationToken).ConfigureAwait(false);
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Performs a POST request that returns a string response (for actions).
    /// </summary>
    public async Task<string> PostAsyncString(
        string path,
        object data,
        CancellationToken cancellationToken = default)
    {
        var url = $"{_environmentUrl}/api/data/v9.2/{path.TrimStart('/')}";
        return await ExecuteWithRetryAsync(async () =>
        {
            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = JsonContent.Create(data)
            };
            var response = await SendHttpRequestAsync(request, cancellationToken).ConfigureAwait(false);
            return await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Performs a PATCH request to the Dataverse Web API with retry logic.
    /// </summary>
    public async Task PatchAsync(
        string path,
        object data,
        CancellationToken cancellationToken = default)
    {
        var url = $"{_environmentUrl}/api/data/v9.2/{path.TrimStart('/')}";
        await ExecuteWithRetryAsync(async () =>
        {
            var request = new HttpRequestMessage(HttpMethod.Patch, url)
            {
                Content = JsonContent.Create(data)
            };
            await SendHttpRequestAsync(request, cancellationToken).ConfigureAwait(false);
            return new JObject();
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Performs a DELETE request to the Dataverse Web API with retry logic.
    /// </summary>
    public async Task DeleteAsync(
        string path,
        CancellationToken cancellationToken = default)
    {
        var url = $"{_environmentUrl}/api/data/v9.2/{path.TrimStart('/')}";
        await ExecuteWithRetryAsync(async () =>
        {
            var request = new HttpRequestMessage(HttpMethod.Delete, url);
            await SendHttpRequestAsync(request, cancellationToken).ConfigureAwait(false);
            return new JObject();
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Sends an HTTP request with authentication and handles rate limiting.
    /// </summary>
    private async Task<HttpResponseMessage> SendHttpRequestAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken = default)
    {
        var token = await GetAccessTokenAsync(cancellationToken).ConfigureAwait(false);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        request.Headers.Add("Accept", "application/json");

        if (request.Content != null && request.Method != HttpMethod.Get && request.Method != HttpMethod.Delete)
        {
            request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
        }

        var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);

        if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            var retryAfter = response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(5);
            _logger.Warning("Rate limited. Waiting {RetryAfter} seconds", retryAfter.TotalSeconds);
            await Task.Delay(retryAfter, cancellationToken).ConfigureAwait(false);
            response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        }

        return response;
    }

    /// <summary>
    /// Sends a request and parses the response as JSON.
    /// </summary>
    private async Task<JObject> SendRequestAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken = default)
    {
        var response = await SendHttpRequestAsync(request, cancellationToken).ConfigureAwait(false);
        var content = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            _logger.Error("API request failed: {StatusCode} {Content}", response.StatusCode, content);
            throw new HttpRequestException($"API request failed with status {response.StatusCode}: {content}");
        }

        return JObject.Parse(content);
    }

    /// <summary>
    /// Executes an operation with exponential backoff retry logic.
    /// </summary>
    private async Task<T> ExecuteWithRetryAsync<T>(
        Func<Task<T>> operation,
        CancellationToken cancellationToken = default)
    {
        int attempt = 0;
        int delay = _retryPolicy.BaseDelaySeconds;

        while (true)
        {
            try
            {
                return await operation().ConfigureAwait(false);
            }
            catch (HttpRequestException ex) when (attempt < _retryPolicy.MaxRetries)
            {
                attempt++;
                var waitTime = Math.Min(delay, _retryPolicy.MaxDelaySeconds);
                _logger.Warning(ex, "Request failed (attempt {Attempt}/{MaxRetries}). Retrying in {WaitTime} seconds",
                    attempt, _retryPolicy.MaxRetries, waitTime);

                await Task.Delay(TimeSpan.FromSeconds(waitTime), cancellationToken).ConfigureAwait(false);
                delay = (int)(delay * _retryPolicy.BackoffMultiplier);
            }
        }
    }

    /// <summary>
    /// Performs a FetchXml query against the Dataverse Web API.
    /// </summary>
    public async Task<List<JObject>> QueryAsync(
        string entityLogicalName,
        string? fetchXml = null,
        int? pageSize = null,
        CancellationToken cancellationToken = default)
    {
        var results = new List<JObject>();
        var cookie = string.Empty;
        int page = 1;

        while (true)
        {
            var queryString = fetchXml != null
                ? $"{entityLogicalName}?fetchXml={Uri.EscapeDataString(fetchXml)}&$count=true"
                : entityLogicalName;

            if (pageSize.HasValue)
                queryString += $"&$top={pageSize.Value}";

            if (!string.IsNullOrEmpty(cookie))
                queryString += $"&$skiptoken={Uri.EscapeDataString(cookie)}";

            _logger.Debug("Querying {EntityLogicalName} (page {Page})", entityLogicalName, page);

            var response = await GetAsync(queryString, cancellationToken).ConfigureAwait(false);
            var records = response["value"]?.Children<JObject>().ToList() ?? new List<JObject>();

            results.AddRange(records);

            cookie = response["@Microsoft.Dynamics.CRM.fetchxmlpagingcookie"]?.Value<string>() ?? string.Empty;

            if (string.IsNullOrEmpty(cookie) || records.Count == 0)
                break;

            page++;
        }

        _logger.Debug("Retrieved {RecordCount} records from {EntityLogicalName}", results.Count, entityLogicalName);
        return results;
    }

    public void Dispose()
    {
        _httpClient?.Dispose();
        GC.SuppressFinalize(this);
    }
}
