# OpenAPI Object Type Audit Tool

This tool audits OpenAPI specifications for object typing compatibility with Speakeasy tools. It identifies objects that are missing the `additionalProperties` attribute and categorizes them by priority.

## Overview

Speakeasy requires that all object schemas explicitly define their `additionalProperties` behavior:

- **Open objects** (no properties defined): Should have `additionalProperties: true` to allow arbitrary key-value pairs
- **Closed objects** (properties defined): Should have `additionalProperties: false` to restrict to defined properties only

## Files

- **`audit-object-types.js`** - Main audit script with detailed console output
- **`generate-csv-report.js`** - CSV generator for easier data processing
- **`AUDIT_USAGE.md`** - This documentation file

## Usage

### 1. Run the Full Audit Report

```bash
node audit-object-types.js
```

This provides a comprehensive colored console report with:
- Summary statistics
- Detailed list of open objects (HIGH priority)
- Detailed list of closed objects (MEDIUM priority) 
- Operations table showing affected endpoints
- Recommendations and next steps

### 2. Generate CSV Report

```bash
node generate-csv-report.js [output-filename.csv]
```

Default output: `openapi-object-audit.csv`

The CSV contains columns:
- File, Schema Path, Type, Priority
- Has Properties, Properties Count, Has Composition
- Has Additional Properties, Additional Properties Value
- Recommendation, Reason
- Operations Count, Operation IDs

### 3. Filter High Priority Issues

To focus only on HIGH priority open objects:

```bash
# Run audit and grep for high priority
node audit-object-types.js | grep -A 5 "HIGH PRIORITY"

# Or filter CSV
head -1 openapi-object-audit.csv > high-priority.csv
grep ",HIGH," openapi-object-audit.csv >> high-priority.csv
```

## Understanding the Results

### Priority Levels

**🔴 HIGH PRIORITY - Open Objects**
- Objects with `type: object` but no `properties` defined
- Missing `additionalProperties` attribute
- Likely intended to accept arbitrary key-value pairs
- Risk: High - may break client generation

**🟡 MEDIUM PRIORITY - Closed Objects** 
- Objects with defined `properties` or composition schemas
- Missing `additionalProperties` attribute  
- Should be restricted to defined properties only
- Risk: Medium - may cause stricter validation than expected

### Common Patterns

1. **Metadata objects** - Often need `additionalProperties: true`
2. **Request/Response objects** - Usually need `additionalProperties: false`
3. **Configuration objects** - Usually need `additionalProperties: false`
4. **Dynamic property objects** - Often need `additionalProperties: true`

## Audit Results Summary

Based on the current scan of `generated_specs/`:

- **Total Files:** 3 (admin_rest.yaml, client_rest.yaml, indexing.yaml)
- **Total Object Schemas:** 205
- **Missing additionalProperties:** 189 (92%)
- **HIGH Priority (Open):** 33 objects
- **MEDIUM Priority (Closed):** 172 objects

### Key Findings

**Most Critical Issues (HIGH Priority):**
- 33 open objects need `additionalProperties: true`
- Found in: client_rest.yaml (25), indexing.yaml (8)
- Common patterns: metadata fields, parameter objects, debug info

**Objects Already Correctly Configured:**
- 16 objects already have `additionalProperties` set
- Some already use `additionalProperties: true` for open schemas

## Recommended Workflow

1. **Start with HIGH priority issues** - Fix open objects first
2. **Review business requirements** - Understand if each object should be open or closed
3. **Update systematically** - Use the provided paths to locate schemas
4. **Test with Speakeasy** - Validate client generation after changes
5. **Validate functionality** - Ensure API behavior remains correct

## Example Fixes

### Open Object (needs additionalProperties: true)
```yaml
# Before
components:
  schemas:
    Metadata:
      type: object
      # No properties defined, no additionalProperties

# After  
components:
  schemas:
    Metadata:
      type: object
      additionalProperties: true  # Allow arbitrary properties
```

### Closed Object (needs additionalProperties: false)
```yaml
# Before
components:
  schemas:
    User:
      type: object
      properties:
        id: 
          type: string
        name:
          type: string
      # Missing additionalProperties

# After
components:
  schemas:
    User:
      type: object
      properties:
        id: 
          type: string
        name:
          type: string
      additionalProperties: false  # Only allow defined properties
```

## Notes

- The audit runs against `generated_specs/` directory
- Handles YAML, YML, and JSON OpenAPI files  
- Detects objects in nested schemas, compositions (allOf/oneOf/anyOf)
- Maps schemas to operations that use them
- Provides exact schema paths for easy location