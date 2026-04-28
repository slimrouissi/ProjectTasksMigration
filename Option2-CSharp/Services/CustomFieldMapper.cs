using Newtonsoft.Json.Linq;
using Serilog;

namespace ProjectMigration.Services;

/// <summary>
/// Handles mapping of custom fields between source and target environments.
/// Supports text, number, lookup, and optionset field types.
/// </summary>
public class CustomFieldMapper
{
    private readonly List<CustomFieldMapping> _mappings;
    private readonly GuidMappingService _guidMappingService;
    private readonly ILogger _logger;
    private readonly HashSet<string> _warnedUnmappedFields = new();

    public CustomFieldMapper(
        List<CustomFieldMapping> mappings,
        GuidMappingService guidMappingService,
        ILogger logger)
    {
        _mappings = mappings;
        _guidMappingService = guidMappingService;
        _logger = logger;
    }

    /// <summary>
    /// Maps custom fields from source entity to target entity.
    /// </summary>
    public Dictionary<string, object> MapCustomFields(
        JObject sourceEntity,
        string entityType)
    {
        var mappedFields = new Dictionary<string, object>();
        var unmappedFields = new HashSet<string>();

        foreach (var property in sourceEntity.Properties())
        {
            var fieldName = property.Name;

            // Skip system fields
            if (IsSystemField(fieldName) || fieldName.StartsWith("odata") || fieldName == "value")
                continue;

            // Look for mapping
            var mapping = _mappings.FirstOrDefault(m =>
                m.SourceFieldLogicalName.Equals(fieldName, StringComparison.OrdinalIgnoreCase));

            if (mapping != null)
            {
                try
                {
                    var mappedValue = MapFieldValue(fieldName, property.Value, mapping);
                    mappedFields[mapping.TargetFieldLogicalName] = mappedValue;
                    _logger.Verbose("Mapped {SourceField} to {TargetField} ({FieldType})",
                        fieldName, mapping.TargetFieldLogicalName, mapping.FieldType);
                }
                catch (Exception ex)
                {
                    _logger.Warning(ex, "Failed to map field {FieldName} ({FieldType})",
                        fieldName, mapping.FieldType);
                }
            }
            else
            {
                unmappedFields.Add(fieldName);
            }
        }

        // Log unmapped fields once per field
        foreach (var field in unmappedFields)
        {
            var key = $"{entityType}:{field}";
            if (!_warnedUnmappedFields.Contains(key))
            {
                _logger.Debug("Unmapped custom field in {EntityType}: {FieldName}", entityType, field);
                _warnedUnmappedFields.Add(key);
            }
        }

        return mappedFields;
    }

    /// <summary>
    /// Maps a single field value based on its type.
    /// </summary>
    private object MapFieldValue(string fieldName, JToken value, CustomFieldMapping mapping)
    {
        if (value.Type == JTokenType.Null)
            return null!;

        return mapping.FieldType.ToLower() switch
        {
            "text" => value.Value<string>() ?? string.Empty,
            "number" => value.Value<decimal>() ?? 0,
            "integer" => value.Value<int>() ?? 0,
            "double" => value.Value<double>() ?? 0.0,
            "boolean" => value.Value<bool>() ?? false,
            "datetime" => value.Value<DateTime>() ?? DateTime.MinValue,
            "lookup" => MapLookupField(fieldName, value),
            "optionset" => MapOptionSetField(fieldName, value, mapping),
            _ => value.ToString()
        };
    }

    /// <summary>
    /// Maps a lookup field, remapping the GUID reference if possible.
    /// </summary>
    private object MapLookupField(string fieldName, JToken value)
    {
        var guidString = value.Value<string>();

        if (string.IsNullOrEmpty(guidString) || !Guid.TryParse(guidString, out var oldGuid))
        {
            _logger.Debug("Invalid GUID in lookup field {FieldName}: {Value}", fieldName, value);
            return guidString ?? string.Empty;
        }

        var newGuid = _guidMappingService.GetNewGuid(oldGuid);
        _logger.Verbose("Remapped lookup field {FieldName}: {OldGuid} -> {NewGuid}",
            fieldName, oldGuid, newGuid);

        return newGuid;
    }

    /// <summary>
    /// Maps an optionset field value using the configured value mappings.
    /// </summary>
    private object MapOptionSetField(string fieldName, JToken value, CustomFieldMapping mapping)
    {
        var sourceValue = value.Value<int?>() ?? value.Value<string>();

        if (sourceValue == null)
            return 0;

        var sourceKey = sourceValue.ToString()!;

        if (mapping.ValueMappings.TryGetValue(sourceKey, out var targetValue))
        {
            if (int.TryParse(targetValue, out var intValue))
            {
                _logger.Verbose("Mapped optionset field {FieldName}: {SourceValue} -> {TargetValue}",
                    fieldName, sourceValue, targetValue);
                return intValue;
            }
        }

        _logger.Warning("No optionset value mapping found for {FieldName}: {SourceValue}",
            fieldName, sourceValue);

        return sourceValue;
    }

    /// <summary>
    /// Checks if a field is a system field that should not be mapped.
    /// </summary>
    private static bool IsSystemField(string fieldName)
    {
        var systemFields = new[]
        {
            "statecode", "statuscode", "versionnumber", "modifiedon", "createdon",
            "modifiedby", "createdby", "ownerId", "owninguser", "owningteam",
            "modifiedonbehalfby", "createdonbehalfby", "_msdyn_project_value",
            "msdyn_projectid", "msdyn_projecttaskid", "msdyn_projectteamid",
            "msdyn_projecttaskdependencyid", "msdyn_resourceassignmentid",
            "msdyn_projectbucketid", "parenttaskidref"
        };

        return systemFields.Contains(fieldName, StringComparer.OrdinalIgnoreCase);
    }
}
