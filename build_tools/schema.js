#!/usr/bin/env node

/**
 * schema.js - Validates YAML technology definitions against schema
 * 
 * Usage: node schema.js [path-to-yaml-file]
 * 
 * Validates:
 * - Required fields are present
 * - Technology types are valid (material|social|knowledge)
 * - Dependency references exist
 * - Historical data is reasonable
 * - Era classifications are correct
 */

const fs = require('fs');
const path = require('path');

// Simple YAML parser (no dependencies)
function parseYAML(content) {
    try {
        // Very basic YAML parsing - just enough for our needs
        const lines = content.split('\n');
        const result = { technologies: {} };
        let currentTech = null;
        let currentSection = null;
        let indent = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            if (trimmed === '' || trimmed.startsWith('#')) continue;
            
            const currentIndent = line.length - line.trimStart().length;
            
            if (trimmed === 'technologies:') {
                continue;
            }
            
            // Technology definition
            if (currentIndent === 2 && trimmed.endsWith(':') && !trimmed.includes(' ')) {
                currentTech = trimmed.slice(0, -1);
                result.technologies[currentTech] = {};
                currentSection = null;
                continue;
            }
            
            if (!currentTech) continue;
            
            // Field within technology
            if (currentIndent === 4 && trimmed.includes(':')) {
                const [key, ...valueParts] = trimmed.split(':');
                const value = valueParts.join(':').trim();
                
                if (['prerequisites', 'unlocks', 'resources', 'historical'].includes(key)) {
                    result.technologies[currentTech][key] = {};
                    currentSection = key;
                } else {
                    // Handle simple values
                    if (value.startsWith('"') && value.endsWith('"')) {
                        result.technologies[currentTech][key] = value.slice(1, -1);
                    } else if (value.startsWith('[') && value.endsWith(']')) {
                        // Simple array parsing
                        const arrayContent = value.slice(1, -1);
                        if (arrayContent.trim() === '') {
                            result.technologies[currentTech][key] = [];
                        } else {
                            result.technologies[currentTech][key] = arrayContent.split(',').map(s => s.trim().replace(/"/g, ''));
                        }
                    } else if (!isNaN(value) && value !== '') {
                        result.technologies[currentTech][key] = parseFloat(value);
                    } else if (value === 'true' || value === true) {
                        result.technologies[currentTech][key] = true;
                    } else if (value === 'false' || value === false) {
                        result.technologies[currentTech][key] = false;
                    } else {
                        result.technologies[currentTech][key] = value;
                    }
                    currentSection = null;
                }
                continue;
            }
            
            // Subsections within prerequisites, unlocks, etc.
            if (currentSection && currentIndent === 6 && trimmed.includes(':')) {
                const [key, ...valueParts] = trimmed.split(':');
                const value = valueParts.join(':').trim();
                
                if (value.startsWith('[') && value.endsWith(']')) {
                    const arrayContent = value.slice(1, -1);
                    if (arrayContent.trim() === '') {
                        result.technologies[currentTech][currentSection][key] = [];
                    } else {
                        result.technologies[currentTech][currentSection][key] = arrayContent.split(',').map(s => s.trim().replace(/"/g, ''));
                    }
                } else if (value.startsWith('"') && value.endsWith('"')) {
                    result.technologies[currentTech][currentSection][key] = value.slice(1, -1);
                } else if (value.startsWith('[') && !value.endsWith(']')) {
                    // Multi-line array
                    result.technologies[currentTech][currentSection][key] = [];
                } else if (value === 'true' || value === true) {
                    result.technologies[currentTech][currentSection][key] = true;
                } else if (value === 'false' || value === false) {
                    result.technologies[currentTech][currentSection][key] = false;
                } else {
                    result.technologies[currentTech][currentSection][key] = value;
                }
            }
            
            // Array items
            if (currentSection && currentIndent === 8 && trimmed.startsWith('- ')) {
                const item = trimmed.slice(2).replace(/"/g, '');
                const keys = Object.keys(result.technologies[currentTech][currentSection]);
                const lastKey = keys[keys.length - 1];
                if (Array.isArray(result.technologies[currentTech][currentSection][lastKey])) {
                    result.technologies[currentTech][currentSection][lastKey].push(item);
                }
            }
        }
        
        return result;
    } catch (error) {
        throw new Error(`YAML parsing failed: ${error.message}`);
    }
}

// Schema validation
const VALID_TYPES = ['material', 'social', 'knowledge'];
const VALID_ERAS = ['prehistoric', 'ancient', 'medieval', 'early-modern', 'industrial', 'information', 'contemporary', 'future'];
const VALID_COMPLEXITY = ['low', 'medium', 'high', 'extreme'];
const DEPENDENCY_TYPES = ['hard', 'soft', 'catalyst', 'synergistic'];

function validateTechnology(id, tech, allTechIds) {
    const errors = [];
    
    // Required fields
    const requiredFields = ['id', 'name', 'type', 'era', 'description', 'complexity'];
    for (const field of requiredFields) {
        if (!tech[field]) {
            errors.push(`Missing required field: ${field}`);
        }
    }
    
    // ID consistency
    if (tech.id && tech.id !== id) {
        errors.push(`ID mismatch: folder name '${id}' vs id field '${tech.id}'`);
    }
    
    // Type validation
    if (tech.type && !VALID_TYPES.includes(tech.type)) {
        errors.push(`Invalid type '${tech.type}'. Must be one of: ${VALID_TYPES.join(', ')}`);
    }
    
    // Era validation
    if (tech.era && !VALID_ERAS.includes(tech.era)) {
        errors.push(`Invalid era '${tech.era}'. Must be one of: ${VALID_ERAS.join(', ')}`);
    }
    
    // Complexity validation
    if (tech.complexity && !VALID_COMPLEXITY.includes(tech.complexity)) {
        errors.push(`Invalid complexity '${tech.complexity}'. Must be one of: ${VALID_COMPLEXITY.join(', ')}`);
    }
    
    // Prerequisites structure
    if (tech.prerequisites) {
        for (const depType of Object.keys(tech.prerequisites)) {
            if (!DEPENDENCY_TYPES.includes(depType)) {
                errors.push(`Invalid dependency type '${depType}'. Must be one of: ${DEPENDENCY_TYPES.join(', ')}`);
            }
            
            if (!Array.isArray(tech.prerequisites[depType])) {
                errors.push(`Prerequisites.${depType} must be an array`);
            } else {
                // Check that referenced technologies exist
                for (const prereq of tech.prerequisites[depType]) {
                    if (!allTechIds.includes(prereq)) {
                        errors.push(`Unknown prerequisite '${prereq}' in ${depType} dependencies`);
                    }
                }
            }
        }
        
        // Ensure all dependency types are present (can be empty arrays)
        for (const depType of DEPENDENCY_TYPES) {
            if (!tech.prerequisites[depType]) {
                tech.prerequisites[depType] = [];
            }
        }
    }
    
    // Historical data validation
    if (tech.historical) {
        if (tech.historical.parallel_invention !== undefined && 
            typeof tech.historical.parallel_invention !== 'boolean') {
            errors.push('historical.parallel_invention must be true or false');
        }
        
        if (tech.historical.locations && !Array.isArray(tech.historical.locations)) {
            errors.push('historical.locations must be an array');
        }
        
        if (tech.historical.key_figures && !Array.isArray(tech.historical.key_figures)) {
            errors.push('historical.key_figures must be an array');
        }
    }
    
    // Resources structure
    if (tech.resources) {
        const resourceTypes = ['materials', 'knowledge', 'social'];
        for (const resourceType of resourceTypes) {
            if (tech.resources[resourceType] && !Array.isArray(tech.resources[resourceType])) {
                errors.push(`resources.${resourceType} must be an array`);
            }
        }
    }
    
    // Unlocks structure
    if (tech.unlocks) {
        if (tech.unlocks.technologies && !Array.isArray(tech.unlocks.technologies)) {
            errors.push('unlocks.technologies must be an array');
        }
        
        if (tech.unlocks.capabilities && !Array.isArray(tech.unlocks.capabilities)) {
            errors.push('unlocks.capabilities must be an array');
        }
    }
    
    return errors;
}

function validateSchema(yamlPath) {
    try {
        console.log(`Validating ${yamlPath}...`);
        
        const content = fs.readFileSync(yamlPath, 'utf8');
        const data = parseYAML(content);
        
        if (!data.technologies) {
            throw new Error('No technologies section found in YAML file');
        }
        
        const allTechIds = Object.keys(data.technologies);
        let totalErrors = 0;
        
        for (const [id, tech] of Object.entries(data.technologies)) {
            const errors = validateTechnology(id, tech, allTechIds);
            
            if (errors.length > 0) {
                console.error(`\n❌ ${id}:`);
                for (const error of errors) {
                    console.error(`  - ${error}`);
                }
                totalErrors += errors.length;
            }
        }
        
        if (totalErrors === 0) {
            console.log(`\n✅ Schema validation passed for ${allTechIds.length} technologies`);
            return true;
        } else {
            console.error(`\n❌ Schema validation failed with ${totalErrors} errors`);
            return false;
        }
        
    } catch (error) {
        console.error(`❌ Schema validation failed: ${error.message}`);
        return false;
    }
}

// CLI interface
if (require.main === module) {
    const yamlPath = process.argv[2] || 'tree/definitions.yml';
    
    if (!fs.existsSync(yamlPath)) {
        console.error(`❌ File not found: ${yamlPath}`);
        process.exit(1);
    }
    
    const success = validateSchema(yamlPath);
    process.exit(success ? 0 : 1);
}

module.exports = { validateSchema, parseYAML };