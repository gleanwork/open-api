#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

class OpenAPIObjectAuditor {
  constructor() {
    this.results = {
      files: [],
      openObjects: [],      // Objects without properties (need additionalProperties: true)
      closedObjects: [],    // Objects with properties (need additionalProperties: false)
      summary: {
        totalFiles: 0,
        totalObjectSchemas: 0,
        openObjectsCount: 0,
        closedObjectsCount: 0,
        objectsWithAdditionalProps: 0,
        objectsMissingAdditionalProps: 0
      }
    };
    this.operationMappings = new Map(); // Map schema paths to operations that use them
  }

  async auditDirectory(dirPath) {
    console.log(`${colors.cyan}🔍 Starting OpenAPI Object Type Audit${colors.reset}`);
    console.log(`${colors.blue}Auditing directory: ${dirPath}${colors.reset}\n`);

    const files = fs.readdirSync(dirPath).filter(file => 
      file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json')
    );

    this.results.summary.totalFiles = files.length;

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      console.log(`${colors.yellow}📄 Processing: ${file}${colors.reset}`);
      await this.auditFile(filePath);
    }

    this.generateReport();
  }

  async auditFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const spec = filePath.endsWith('.json') ? JSON.parse(content) : yaml.load(content);
      
      const fileResult = {
        filename: path.basename(filePath),
        path: filePath,
        openObjects: [],
        closedObjects: [],
        operationsTable: []
      };

      // First pass: collect operation mappings
      this.collectOperationMappings(spec, filePath);

      // Second pass: audit object schemas
      this.auditObjectSchemas(spec, '', fileResult, filePath);

      this.results.files.push(fileResult);
      
      console.log(`   ✅ Found ${fileResult.openObjects.length} open objects, ${fileResult.closedObjects.length} closed objects`);
      
    } catch (error) {
      console.error(`${colors.red}❌ Error processing ${filePath}: ${error.message}${colors.reset}`);
    }
  }

  collectOperationMappings(obj, filePath, currentPath = '') {
    if (!obj || typeof obj !== 'object') return;

    // Look for paths and operations
    if (obj.paths) {
      for (const [pathKey, pathObj] of Object.entries(obj.paths)) {
        if (pathObj && typeof pathObj === 'object') {
          for (const [method, operation] of Object.entries(pathObj)) {
            if (operation && typeof operation === 'object' && 
                ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(method.toLowerCase())) {
              
              const operationId = operation.operationId || `${method.toUpperCase()} ${pathKey}`;
              
              // Map schemas used in this operation
              this.mapSchemasInOperation(operation, operationId, filePath, `paths.${pathKey}.${method}`);
            }
          }
        }
      }
    }

    // Recursively process other parts
    for (const [key, value] of Object.entries(obj)) {
      if (key !== 'paths' && value && typeof value === 'object') {
        this.collectOperationMappings(value, filePath, currentPath ? `${currentPath}.${key}` : key);
      }
    }
  }

  mapSchemasInOperation(operation, operationId, filePath, operationPath) {
    this.findSchemaReferences(operation, (schemaPath) => {
      const key = `${filePath}:${schemaPath}`;
      if (!this.operationMappings.has(key)) {
        this.operationMappings.set(key, []);
      }
      this.operationMappings.get(key).push({
        operationId,
        operationPath,
        method: operationPath.split('.').pop().toUpperCase(),
        path: operationPath.split('.').slice(1, -1).join('.')
      });
    });
  }

  findSchemaReferences(obj, callback, currentPath = '') {
    if (!obj || typeof obj !== 'object') return;

    for (const [key, value] of Object.entries(obj)) {
      const newPath = currentPath ? `${currentPath}.${key}` : key;
      
      if (key === '$ref' && typeof value === 'string') {
        if (value.startsWith('#/')) {
          callback(value.substring(2).replace(/\//g, '.'));
        }
      } else if (value && typeof value === 'object') {
        this.findSchemaReferences(value, callback, newPath);
      }
    }
  }

  auditObjectSchemas(obj, currentPath, fileResult, filePath) {
    if (!obj || typeof obj !== 'object') return;

    try {
      // Check if this is an object schema
      if (obj.type === 'object') {
        this.results.summary.totalObjectSchemas++;
        
        const hasAdditionalProperties = obj.hasOwnProperty('additionalProperties');
        const hasProperties = obj.properties && Object.keys(obj.properties).length > 0;
        const hasAllOf = obj.allOf && obj.allOf.length > 0;
        const hasOneOf = obj.oneOf && obj.oneOf.length > 0;
        const hasAnyOf = obj.anyOf && obj.anyOf.length > 0;
        
        if (hasAdditionalProperties) {
          this.results.summary.objectsWithAdditionalProps++;
        } else {
          this.results.summary.objectsMissingAdditionalProps++;
        }

        const hasComposition = hasAllOf || hasOneOf || hasAnyOf;

        const schemaInfo = {
          path: currentPath,
          hasAdditionalProperties,
          additionalPropertiesValue: obj.additionalProperties,
          hasProperties,
          propertiesCount: hasProperties ? Object.keys(obj.properties).length : 0,
          hasComposition,
          compositionTypes: [
            hasAllOf && 'allOf',
            hasOneOf && 'oneOf', 
            hasAnyOf && 'anyOf'
          ].filter(Boolean),
          operations: this.getOperationsForSchema(filePath, currentPath)
        };

        // Determine if this should be "open" or "closed"
        if (!hasProperties && !hasComposition) {
          // No properties defined - likely should be "open"
          this.results.openObjects.push({
            file: fileResult.filename,
            ...schemaInfo,
            recommendation: 'Add additionalProperties: true',
            priority: 'HIGH',
            reason: 'Object has no properties defined, likely intended to accept arbitrary key-value pairs'
          });
          fileResult.openObjects.push(schemaInfo);
          this.results.summary.openObjectsCount++;
        } else {
          // Has properties or composition - likely should be "closed"
          this.results.closedObjects.push({
            file: fileResult.filename,
            ...schemaInfo,
            recommendation: hasAdditionalProperties ? 'Consider setting additionalProperties: false' : 'Add additionalProperties: false',
            priority: 'MEDIUM',
            reason: hasProperties ? 
              `Object has ${schemaInfo.propertiesCount} defined properties` :
              `Object uses composition (${schemaInfo.compositionTypes.join(', ')})`
          });
          fileResult.closedObjects.push(schemaInfo);
          this.results.summary.closedObjectsCount++;
        }
      }

      // Handle composition schemas (allOf, oneOf, anyOf)
      ['allOf', 'oneOf', 'anyOf'].forEach(compositionType => {
        if (obj[compositionType] && Array.isArray(obj[compositionType])) {
          obj[compositionType].forEach((schema, index) => {
            this.auditObjectSchemas(
              schema, 
              `${currentPath}.${compositionType}[${index}]`, 
              fileResult, 
              filePath
            );
          });
        }
      });

      // Recursively check all nested objects
      for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === 'object' && 
            !['allOf', 'oneOf', 'anyOf'].includes(key)) {
          const newPath = currentPath ? `${currentPath}.${key}` : key;
          this.auditObjectSchemas(value, newPath, fileResult, filePath);
        }
      }
    } catch (error) {
      console.error(`${colors.red}❌ Error in auditObjectSchemas at path ${currentPath}: ${error.message}${colors.reset}`);
      console.error(error.stack);
      throw error;
    }
  }

  getOperationsForSchema(filePath, schemaPath) {
    const key = `${filePath}:${schemaPath}`;
    return this.operationMappings.get(key) || [];
  }

  generateReport() {
    console.log(`\n${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}                           OPENAPI OBJECT TYPE AUDIT REPORT                           ${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════════════════════${colors.reset}\n`);

    this.printSummary();
    this.printOpenObjects();
    this.printClosedObjects();
    this.printOperationsTable();
    this.printRecommendations();
  }

  printSummary() {
    const { summary } = this.results;
    
    console.log(`${colors.bright}📊 SUMMARY${colors.reset}`);
    console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`Files processed: ${summary.totalFiles}`);
    console.log(`Total object schemas found: ${summary.totalObjectSchemas}`);
    console.log(`Objects missing additionalProperties: ${colors.red}${summary.objectsMissingAdditionalProps}${colors.reset}`);
    console.log(`Objects with additionalProperties: ${colors.green}${summary.objectsWithAdditionalProps}${colors.reset}`);
    console.log(`Open objects (no properties): ${colors.yellow}${summary.openObjectsCount}${colors.reset} ${colors.red}[HIGH PRIORITY]${colors.reset}`);
    console.log(`Closed objects (with properties): ${colors.blue}${summary.closedObjectsCount}${colors.reset} ${colors.yellow}[MEDIUM PRIORITY]${colors.reset}\n`);
  }

  printOpenObjects() {
    if (this.results.openObjects.length === 0) {
      console.log(`${colors.green}✅ No open objects found - all objects without properties have been properly configured!${colors.reset}\n`);
      return;
    }

    console.log(`${colors.bright}🔓 OPEN OBJECTS (HIGH PRIORITY)${colors.reset}`);
    console.log(`${colors.red}These objects have no properties defined and likely need additionalProperties: true${colors.reset}`);
    console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    
    this.results.openObjects.forEach((obj, index) => {
      console.log(`${colors.yellow}${index + 1}.${colors.reset} ${colors.bright}${obj.file}${colors.reset}`);
      console.log(`   Path: ${obj.path}`);
      console.log(`   Status: ${obj.hasAdditionalProperties ? 
        `${colors.green}Has additionalProperties: ${obj.additionalPropertiesValue}${colors.reset}` : 
        `${colors.red}Missing additionalProperties${colors.reset}`}`);
      console.log(`   ${colors.magenta}Recommendation: ${obj.recommendation}${colors.reset}`);
      console.log(`   Reason: ${obj.reason}`);
      
      if (obj.operations && obj.operations.length > 0) {
        console.log(`   Used in operations: ${obj.operations.map(op => op.operationId).join(', ')}`);
      }
      console.log('');
    });
  }

  printClosedObjects() {
    if (this.results.closedObjects.length === 0) {
      console.log(`${colors.green}✅ No closed objects found - all objects with properties have been properly configured!${colors.reset}\n`);
      return;
    }

    console.log(`${colors.bright}🔒 CLOSED OBJECTS (MEDIUM PRIORITY)${colors.reset}`);
    console.log(`${colors.blue}These objects have properties defined and likely need additionalProperties: false${colors.reset}`);
    console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    
    this.results.closedObjects.forEach((obj, index) => {
      console.log(`${colors.blue}${index + 1}.${colors.reset} ${colors.bright}${obj.file}${colors.reset}`);
      console.log(`   Path: ${obj.path}`);
      console.log(`   Properties: ${obj.propertiesCount} defined${obj.hasComposition ? ` + composition (${obj.compositionTypes.join(', ')})` : ''}`);
      console.log(`   Status: ${obj.hasAdditionalProperties ? 
        `${colors.green}Has additionalProperties: ${obj.additionalPropertiesValue}${colors.reset}` : 
        `${colors.yellow}Missing additionalProperties${colors.reset}`}`);
      console.log(`   ${colors.magenta}Recommendation: ${obj.recommendation}${colors.reset}`);
      console.log(`   Reason: ${obj.reason}`);
      
      if (obj.operations && obj.operations.length > 0) {
        console.log(`   Used in operations: ${obj.operations.map(op => op.operationId).join(', ')}`);
      }
      console.log('');
    });
  }

  printOperationsTable() {
    console.log(`${colors.bright}📋 OPERATIONS AFFECTED BY OBJECT TYPE ISSUES${colors.reset}`);
    console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    
    const operationsMap = new Map();
    
    // Collect all operations from both open and closed objects
    [...this.results.openObjects, ...this.results.closedObjects].forEach(obj => {
      obj.operations.forEach(operation => {
        const key = `${operation.operationId}`;
        if (!operationsMap.has(key)) {
          operationsMap.set(key, {
            operationId: operation.operationId,
            method: operation.method,
            path: operation.path,
            affectedSchemas: [],
            priority: 'MEDIUM'
          });
        }
        
        const isOpen = !obj.hasProperties && !obj.hasComposition;
        operationsMap.get(key).affectedSchemas.push({
          file: obj.file,
          schemaPath: obj.path,
          type: isOpen ? 'open' : 'closed',
          hasAdditionalProperties: obj.hasAdditionalProperties
        });
        
        // Set priority to HIGH if any open objects are involved
        if (isOpen) {
          operationsMap.get(key).priority = 'HIGH';
        }
      });
    });

    if (operationsMap.size === 0) {
      console.log(`${colors.green}✅ No operations are affected by object type issues!${colors.reset}\n`);
      return;
    }

    // Sort by priority (HIGH first) then by operationId
    const sortedOperations = Array.from(operationsMap.values()).sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority === 'HIGH' ? -1 : 1;
      }
      return a.operationId.localeCompare(b.operationId);
    });

    console.log(`${'Operation ID'.padEnd(50)} ${'Method'.padEnd(8)} ${'Priority'.padEnd(10)} ${'Issues'.padEnd(10)}`);
    console.log(`${'-'.repeat(50)} ${'-'.repeat(8)} ${'-'.repeat(10)} ${'-'.repeat(10)}`);
    
    sortedOperations.forEach(operation => {
      const priorityColor = operation.priority === 'HIGH' ? colors.red : colors.yellow;
      const openIssues = operation.affectedSchemas.filter(s => s.type === 'open').length;
      const closedIssues = operation.affectedSchemas.filter(s => s.type === 'closed').length;
      
      console.log(`${operation.operationId.padEnd(50)} ${operation.method.padEnd(8)} ${priorityColor}${operation.priority.padEnd(10)}${colors.reset} ${openIssues}/${closedIssues}`);
    });

    console.log(`\nLegend: Issues column shows "Open Objects"/"Closed Objects"`);
    console.log('');
  }

  printRecommendations() {
    console.log(`${colors.bright}💡 RECOMMENDATIONS${colors.reset}`);
    console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    
    if (this.results.summary.openObjectsCount > 0) {
      console.log(`${colors.red}🔴 HIGH PRIORITY: ${this.results.summary.openObjectsCount} open objects${colors.reset}`);
      console.log(`   Action: Add "additionalProperties: true" to schemas with no properties`);
      console.log(`   Impact: These objects are likely intended to accept arbitrary key-value pairs`);
      console.log(`   Risk: High - may break client generation if not addressed\n`);
    }
    
    if (this.results.summary.closedObjectsCount > 0) {
      console.log(`${colors.yellow}🟡 MEDIUM PRIORITY: ${this.results.summary.closedObjectsCount} closed objects${colors.reset}`);
      console.log(`   Action: Add "additionalProperties: false" to schemas with defined properties`);
      console.log(`   Impact: Ensures type safety and prevents unexpected properties`);
      console.log(`   Risk: Medium - may cause stricter validation than expected\n`);
    }
    
    console.log(`${colors.bright}Next Steps:${colors.reset}`);
    console.log(`1. Review and fix HIGH priority open objects first`);
    console.log(`2. Consider business requirements for each schema`);
    console.log(`3. Update schemas systematically using the paths provided`);
    console.log(`4. Test with Speakeasy tools after changes`);
    console.log(`5. Validate that client code generation works as expected\n`);
    
    if (this.results.summary.objectsMissingAdditionalProps === 0) {
      console.log(`${colors.green}🎉 Congratulations! All object schemas have explicit additionalProperties settings!${colors.reset}`);
    }
  }
}

// Main execution
async function main() {
  const auditor = new OpenAPIObjectAuditor();
  const specsDir = './generated_specs';
  
  if (!fs.existsSync(specsDir)) {
    console.error(`${colors.red}❌ Directory ${specsDir} does not exist${colors.reset}`);
    process.exit(1);
  }
  
  await auditor.auditDirectory(specsDir);
}

// Handle command line execution
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`${colors.red}❌ Error: ${error.message}${colors.reset}`);
    process.exit(1);
  });
}

export default OpenAPIObjectAuditor;