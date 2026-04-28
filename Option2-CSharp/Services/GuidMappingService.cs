using Newtonsoft.Json;
using Serilog;

namespace ProjectMigration.Services;

/// <summary>
/// Manages mapping of old GUIDs to new GUIDs during migration.
/// Provides persistence to enable resume capability.
/// </summary>
public class GuidMappingService
{
    private readonly Dictionary<Guid, Guid> _mappings = new();
    private readonly string _mappingsPath;
    private readonly ILogger _logger;

    public GuidMappingService(string basePath, ILogger logger)
    {
        _logger = logger;
        _mappingsPath = Path.Combine(basePath, "guid_mappings.json");
        LoadMappings();
    }

    /// <summary>
    /// Adds a mapping from old GUID to new GUID.
    /// </summary>
    public void AddMapping(Guid oldGuid, Guid newGuid)
    {
        _mappings[oldGuid] = newGuid;
        _logger.Verbose("Added GUID mapping: {OldGuid} -> {NewGuid}", oldGuid, newGuid);
    }

    /// <summary>
    /// Gets the new GUID for an old GUID, or returns the old GUID if not mapped.
    /// </summary>
    public Guid GetNewGuid(Guid oldGuid)
    {
        if (_mappings.TryGetValue(oldGuid, out var newGuid))
        {
            return newGuid;
        }

        _logger.Warning("No mapping found for GUID {OldGuid}", oldGuid);
        return oldGuid;
    }

    /// <summary>
    /// Checks if a GUID has been mapped.
    /// </summary>
    public bool IsMapped(Guid oldGuid)
    {
        return _mappings.ContainsKey(oldGuid);
    }

    /// <summary>
    /// Gets all current mappings.
    /// </summary>
    public IReadOnlyDictionary<Guid, Guid> GetAllMappings()
    {
        return _mappings.AsReadOnly();
    }

    /// <summary>
    /// Saves all mappings to a JSON file for persistence.
    /// </summary>
    public async Task SaveMappingsAsync()
    {
        try
        {
            var directory = Path.GetDirectoryName(_mappingsPath);
            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory!);
            }

            var json = JsonConvert.SerializeObject(
                _mappings.ToDictionary(k => k.Key.ToString(), v => v.Value.ToString()),
                Formatting.Indented);

            await File.WriteAllTextAsync(_mappingsPath, json).ConfigureAwait(false);
            _logger.Information("Saved {MappingCount} GUID mappings to {Path}", _mappings.Count, _mappingsPath);
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Failed to save GUID mappings");
            throw;
        }
    }

    /// <summary>
    /// Loads mappings from the JSON file if it exists.
    /// </summary>
    private void LoadMappings()
    {
        try
        {
            if (!File.Exists(_mappingsPath))
            {
                _logger.Debug("No existing GUID mappings found at {Path}", _mappingsPath);
                return;
            }

            var json = File.ReadAllText(_mappingsPath);
            var loadedMappings = JsonConvert.DeserializeObject<Dictionary<string, string>>(json);

            if (loadedMappings != null)
            {
                foreach (var kvp in loadedMappings)
                {
                    if (Guid.TryParse(kvp.Key, out var oldGuid) && Guid.TryParse(kvp.Value, out var newGuid))
                    {
                        _mappings[oldGuid] = newGuid;
                    }
                }

                _logger.Information("Loaded {MappingCount} GUID mappings from {Path}", _mappings.Count, _mappingsPath);
            }
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Failed to load GUID mappings from {Path}", _mappingsPath);
            throw;
        }
    }

    /// <summary>
    /// Clears all mappings.
    /// </summary>
    public void Clear()
    {
        _mappings.Clear();
        _logger.Information("Cleared all GUID mappings");
    }
}
