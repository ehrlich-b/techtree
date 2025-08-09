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

function createSymlink(target, linkPath, linkType = 'hard') {
    try {
        // Remove existing symlink if it exists
        if (fs.lstatSync(linkPath).isSymbolicLink()) {
            fs.unlinkSync(linkPath);
        }
    } catch (err) {
        // File doesn't exist, which is fine
    }
    
    try {
        // Calculate relative path from link to target
        const linkDir = path.dirname(linkPath);
        const relativePath = path.relative(linkDir, target);
        
        fs.symlinkSync(relativePath, linkPath);
        return { success: true, type: linkType };
    } catch (error) {
        return { success: false, error: error.message, type: linkType };
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

function cleanBrokenLinks(prereqDir) {
    const depTypes = ['hard', 'soft', 'catalyst', 'synergistic'];
    let cleaned = 0;
    
    for (const depType of depTypes) {
        const depDir = path.join(prereqDir, depType);
        if (!fs.existsSync(depDir)) continue;
        
        const links = fs.readdirSync(depDir);
        for (const link of links) {
            const linkPath = path.join(depDir, link);
            try {
                const stats = fs.lstatSync(linkPath);
                if (stats.isSymbolicLink()) {
                    const target = fs.readlinkSync(linkPath);
                    const resolvedTarget = path.resolve(path.dirname(linkPath), target);
                    
                    if (!fs.existsSync(resolvedTarget)) {
                        fs.unlinkSync(linkPath);
                        console.log(`🧹 Removed broken link: ${linkPath}`);
                        cleaned++;
                    }
                }
            } catch (error) {
                // Link is broken, remove it
                fs.unlinkSync(linkPath);
                console.log(`🧹 Removed broken link: ${linkPath}`);
                cleaned++;
            }
        }
    }
    
    return cleaned;
}

function createPrerequisiteLinks(technologiesDir, definitionsPath) {
    try {
        console.log(`🔗 Creating prerequisite symlinks...`);
        
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
            
            // Clean broken links first
            const cleaned = cleanBrokenLinks(prereqDir);
            if (cleaned > 0) {
                console.log(`🧹 Cleaned ${cleaned} broken links from ${techId}`);
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
                        const linkPath = path.join(depDir, depId);
                        
                        // Check if target exists
                        if (!fs.existsSync(targetDir)) {
                            const error = `Target technology not found: ${depId}`;
                            results[techId].errors.push(error);
                            console.error(`❌ ${techId} -> ${depId}: ${error}`);
                            totalErrors++;
                            continue;
                        }
                        
                        // Create or validate symlink
                        if (fs.existsSync(linkPath)) {
                            // Validate existing symlink
                            const validation = validateSymlink(linkPath, targetDir);
                            if (validation.valid) {
                                results[techId].validated++;
                                totalValidated++;
                                console.log(`✅ ${techId} -> ${depId} (${depType}) - validated`);
                            } else {
                                // Recreate invalid symlink
                                const result = createSymlink(targetDir, linkPath, depType);
                                if (result.success) {
                                    results[techId].created++;
                                    totalCreated++;
                                    console.log(`🔗 ${techId} -> ${depId} (${depType}) - recreated`);
                                } else {
                                    results[techId].errors.push(result.error);
                                    console.error(`❌ ${techId} -> ${depId}: ${result.error}`);
                                    totalErrors++;
                                }
                            }
                        } else {
                            // Create new symlink
                            const result = createSymlink(targetDir, linkPath, depType);
                            if (result.success) {
                                results[techId].created++;
                                totalCreated++;
                                console.log(`🔗 ${techId} -> ${depId} (${depType}) - created`);
                            } else {
                                results[techId].errors.push(result.error);
                                console.error(`❌ ${techId} -> ${depId}: ${result.error}`);
                                totalErrors++;
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`\n🎉 Linking complete!`);
        console.log(`   Created: ${totalCreated} new links`);
        console.log(`   Validated: ${totalValidated} existing links`);
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
        
        return { totalCreated, totalValidated, totalErrors, results };
        
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
    createSymlink, 
    validateSymlink, 
    listLinks,
    cleanBrokenLinks 
};