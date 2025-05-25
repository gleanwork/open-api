#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Import the auditor from the main script
import OpenAPIObjectAuditor from './audit-object-types.js';

// CSV generator class
class CSVGenerator {
  constructor() {
    this.auditor = new OpenAPIObjectAuditor();
  }

  async generateCSV(dirPath, outputPath = 'openapi-object-audit.csv') {
    console.log('🔍 Running OpenAPI Object Type Audit...');
    
    const files = fs.readdirSync(dirPath).filter(file => 
      file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json')
    );

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      await this.auditor.auditFile(filePath);
    }

    // Generate CSV content
    const csvRows = [];
    
    // Header
    csvRows.push([
      'File',
      'Schema Path',
      'Type',
      'Priority',
      'Has Properties',
      'Properties Count',
      'Has Composition',
      'Has Additional Properties',
      'Additional Properties Value',
      'Recommendation',
      'Reason',
      'Operations Count',
      'Operation IDs'
    ]);

    // Add open objects (HIGH priority)
    this.auditor.results.openObjects.forEach(obj => {
      csvRows.push([
        obj.file,
        obj.path,
        'Open',
        'HIGH',
        obj.hasProperties ? 'Yes' : 'No',
        obj.propertiesCount,
        obj.hasComposition ? 'Yes' : 'No',
        obj.hasAdditionalProperties ? 'Yes' : 'No',
        obj.hasAdditionalProperties ? obj.additionalPropertiesValue : '',
        obj.recommendation,
        obj.reason,
        obj.operations.length,
        obj.operations.map(op => op.operationId).join('; ')
      ]);
    });

    // Add closed objects (MEDIUM priority)
    this.auditor.results.closedObjects.forEach(obj => {
      csvRows.push([
        obj.file,
        obj.path,
        'Closed',
        'MEDIUM',
        obj.hasProperties ? 'Yes' : 'No',
        obj.propertiesCount,
        obj.hasComposition ? 'Yes' : 'No',
        obj.hasAdditionalProperties ? 'Yes' : 'No',
        obj.hasAdditionalProperties ? obj.additionalPropertiesValue : '',
        obj.recommendation,
        obj.reason,
        obj.operations.length,
        obj.operations.map(op => op.operationId).join('; ')
      ]);
    });

    // Convert to CSV format
    const csvContent = csvRows.map(row => 
      row.map(cell => {
        // Handle cells with commas, quotes, or newlines
        const cellStr = String(cell || '');
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',')
    ).join('\n');

    // Write CSV file
    fs.writeFileSync(outputPath, csvContent);
    
    console.log(`\n✅ CSV report generated: ${outputPath}`);
    console.log(`📊 Summary:`);
    console.log(`   - Files processed: ${this.auditor.results.summary.totalFiles}`);
    console.log(`   - Total object schemas: ${this.auditor.results.summary.totalObjectSchemas}`);
    console.log(`   - HIGH priority (open objects): ${this.auditor.results.summary.openObjectsCount}`);
    console.log(`   - MEDIUM priority (closed objects): ${this.auditor.results.summary.closedObjectsCount}`);
    console.log(`   - Objects missing additionalProperties: ${this.auditor.results.summary.objectsMissingAdditionalProps}`);
    console.log(`   - Objects with additionalProperties: ${this.auditor.results.summary.objectsWithAdditionalProps}`);
  }
}

// Main execution
async function main() {
  const generator = new CSVGenerator();
  const specsDir = './generated_specs';
  const outputFile = process.argv[2] || 'openapi-object-audit.csv';
  
  if (!fs.existsSync(specsDir)) {
    console.error(`❌ Directory ${specsDir} does not exist`);
    process.exit(1);
  }
  
  await generator.generateCSV(specsDir, outputFile);
}

// Handle command line execution
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  });
}