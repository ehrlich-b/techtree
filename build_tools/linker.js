#!/usr/bin/env node

/**
 * linker.js - Manage symlink relationships for technology prerequisites
 * 
 * Usage: node linker.js [technologies-directory]
 * 
 * Creates and maintains symlinks in prerequisites/ directories:
 * - hard/ - Absolutely required technologies
 * - soft/ - Helpful but optional technologies
 * - catalyst/ - Technologies that accelerate development
 * - synergistic/ - Technologies that combine for greater effect
 * 
 * Validates that all symlink targets exist and removes broken links
 */

const fs = require('fs');
const path = require('path');

// Import YAML parser to read definitions
const { loadDefinitions } = require('./schema.js');

function createMarkdownLink(targetTech, linkPath, depType, techName) {
    // Calculate relative path to target README
    const linkDir = path.dirname(linkPath);
    const relativePath = path.relative(linkDir, `tree/technologies/${targetTech}/README.md`);
    
    const content = `# ${targetTech} → ${techName}

**Prerequisite Type**: ${depType}

## Navigate to Technology

**[View ${targetTech}](${relativePath})**

---

This ${depType} prerequisite is required for **${techName}**.

- **Hard**: Absolutely required - cannot proceed without this technology
- **Soft**: Helpful but optional - provides benefits but not essential  
- **Catalyst**: Accelerates development - speeds up progress
- **Synergistic**: Combines for greater effect - multiplies capabilities

Return to [${techName}](../../README.md) or explore the [full technology tree](../../../../README.md).
`;

    try {
        fs.writeFileSync(linkPath, content);
        return { success: true, type: depType };
    } catch (error) {
        return { success: false, error: error.message, type: depType };
    }
}

function validateSymlink(linkPath, expectedTarget) {
    try {
        const stats = fs.lstatSync(linkPath);
        if (!stats.isSymbolicLink()) {
            return { valid: false, reason: 'Not a symlink' };
        }
        
        const actualTarget = fs.readlinkSync(linkPath);
        const resolvedTarget = path.resolve(path.dirname(linkPath), actualTarget);
        const expectedResolved = path.resolve(expectedTarget);
        
        if (resolvedTarget !== expectedResolved) {
            return { valid: false, reason: `Points to wrong target: ${actualTarget}` };
        }
        
        // Check if target exists
        if (!fs.existsSync(resolvedTarget)) {
            return { valid: false, reason: 'Target does not exist' };
        }
        
        return { valid: true };
    } catch (error) {
        return { valid: false, reason: error.message };
    }
}

function cleanOldLinks(prereqDir) {
    const depTypes = ['hard', 'soft', 'catalyst', 'synergistic'];
    let cleaned = 0;
    
    for (const depType of depTypes) {
        const depDir = path.join(prereqDir, depType);
        if (!fs.existsSync(depDir)) continue;
        
        const items = fs.readdirSync(depDir);
        for (const item of items) {
            const itemPath = path.join(depDir, item);
            try {
                const stats = fs.lstatSync(itemPath);
                // Remove both symlinks and old markdown files
                if (stats.isSymbolicLink() || (stats.isFile() && item.endsWith('.md'))) {
                    fs.unlinkSync(itemPath);
                    cleaned++;
                }
            } catch (error) {
                // File might not exist, continue
            }
        }
    }
    
    return cleaned;
}

function createPrerequisiteLinks(technologiesDir, definitionsPath) {
    try {
        console.log(`🔗 Creating prerequisite links...`);
        
        // Load definitions to get prerequisites
        const data = loadDefinitions(definitionsPath);
        
        if (!data.technologies) {
            throw new Error('No technologies section found in definitions');
        }
        
        let totalCreated = 0;
        let totalValidated = 0;
        let totalErrors = 0;
        const results = {};
        
        // Process each technology
        for (const [techId, tech] of Object.entries(data.technologies)) {
            const techDir = path.join(technologiesDir, techId);
            const prereqDir = path.join(techDir, 'prerequisites');
            
            if (!fs.existsSync(techDir)) {
                console.warn(`⚠️  Technology directory not found: ${techDir}`);
                continue;
            }
            
            if (!fs.existsSync(prereqDir)) {
                console.warn(`⚠️  Prerequisites directory not found: ${prereqDir}`);
                continue;
            }
            
            results[techId] = { created: 0, validated: 0, errors: [] };
            
            // Clean old links first
            const cleaned = cleanOldLinks(prereqDir);
            if (cleaned > 0) {
                console.log(`🧹 Cleaned ${cleaned} old links from ${techId}`);
            }
            
            // Process each dependency type
            if (tech.prerequisites) {
                for (const [depType, deps] of Object.entries(tech.prerequisites)) {
                    if (!Array.isArray(deps)) continue;
                    
                    const depDir = path.join(prereqDir, depType);
                    if (!fs.existsSync(depDir)) {
                        fs.mkdirSync(depDir, { recursive: true });
                    }
                    
                    for (const depId of deps) {
                        const targetDir = path.join(technologiesDir, depId);
                        const linkPath = path.join(depDir, `${depId}.md`);
                        
                        // Check if target exists
                        if (!fs.existsSync(targetDir)) {
                            const error = `Target technology not found: ${depId}`;
                            results[techId].errors.push(error);
                            console.error(`❌ ${techId} -> ${depId}: ${error}`);
                            totalErrors++;
                            continue;
                        }
                        
                        // Create markdown link file
                        const result = createMarkdownLink(depId, linkPath, depType, tech.name || techId);
                        if (result.success) {
                            results[techId].created++;
                            totalCreated++;
                            console.log(`📝 ${techId} -> ${depId} (${depType}) - created markdown link`);
                        } else {
                            results[techId].errors.push(result.error);
                            console.error(`❌ ${techId} -> ${depId}: ${result.error}`);
                            totalErrors++;
                        }
                    }
                }
            }
        }
        
        console.log(`\n🎉 Linking complete!`);
        console.log(`   Created: ${totalCreated} markdown links`);
        if (totalErrors > 0) {
            console.log(`   Errors: ${totalErrors} failed links`);
        }
        
        // Summary by technology
        const problemTechs = Object.entries(results)
            .filter(([,result]) => result.errors.length > 0)
            .slice(0, 5);
        
        if (problemTechs.length > 0) {
            console.log(`\nTechnologies with link errors:`);
            for (const [techId, result] of problemTechs) {
                console.log(`  ${techId}: ${result.errors.length} errors`);
                result.errors.slice(0, 2).forEach(error => 
                    console.log(`    - ${error}`)
                );
            }
        }
        
        return { totalCreated, totalErrors, results };
        
    } catch (error) {
        console.error(`❌ Linking failed: ${error.message}`);
        throw error;
    }
}

function listLinks(technologiesDir, techId = null) {
    try {
        const technologies = techId ? [techId] : fs.readdirSync(technologiesDir);
        
        console.log(`🔗 Prerequisite Links Summary`);
        console.log(`============================`);
        
        for (const tech of technologies) {
            const techDir = path.join(technologiesDir, tech);
            const prereqDir = path.join(techDir, 'prerequisites');
            
            if (!fs.existsSync(prereqDir)) continue;
            
            console.log(`\n📁 ${tech}:`);
            
            const depTypes = ['hard', 'soft', 'catalyst', 'synergistic'];
            let hasLinks = false;
            
            for (const depType of depTypes) {
                const depDir = path.join(prereqDir, depType);
                if (!fs.existsSync(depDir)) continue;
                
                const links = fs.readdirSync(depDir);
                if (links.length === 0) continue;
                
                hasLinks = true;
                console.log(`  ${depType}:`);
                
                for (const link of links) {
                    const linkPath = path.join(depDir, link);
                    const validation = validateSymlink(linkPath, path.join(technologiesDir, link));
                    const status = validation.valid ? '✅' : '❌';
                    console.log(`    ${status} ${link}${validation.valid ? '' : ` (${validation.reason})`}`);
                }
            }
            
            if (!hasLinks) {
                console.log(`  (no prerequisites)`);
            }
        }
        
    } catch (error) {
        console.error(`❌ Failed to list links: ${error.message}`);
    }
}

function main() {
    const technologiesDir = process.argv[2] || 'tree/technologies';
    const definitionsPath = process.argv[3] || 'tree/definitions';
    const command = process.argv[4] || 'create';
    
    if (!fs.existsSync(technologiesDir)) {
        console.error(`❌ Technologies directory not found: ${technologiesDir}`);
        process.exit(1);
    }
    
    if (!fs.existsSync(definitionsPath)) {
        console.error(`❌ Definitions directory not found: ${definitionsPath}`);
        process.exit(1);
    }
    
    try {
        switch (command) {
            case 'create':
            case 'update':
                createPrerequisiteLinks(technologiesDir, definitionsPath);
                break;
                
            case 'list':
                listLinks(technologiesDir);
                break;
                
            case 'validate':
                // TODO: Implement validation-only mode
                console.log('Validation mode not yet implemented');
                break;
                
            default:
                console.log('Usage: node linker.js [technologies-dir] [definitions-file] [create|list|validate]');
                process.exit(1);
        }
    } catch (error) {
        process.exit(1);
    }
}

// CLI interface
if (require.main === module) {
    main();
}

module.exports = { 
    createPrerequisiteLinks, 
    createMarkdownLink, 
    listLinks,
    cleanOldLinks 
};