#!/usr/bin/env node

/**
 * builder.js - Generates folder structure from YAML technology definitions
 * 
 * Usage: node builder.js [path-to-definitions.yml] [output-directory]
 * 
 * Creates:
 * - Technology folders in tree/technologies/
 * - README.md templates for each technology
 * - Prerequisites directory structure
 * - Basic directory structure
 * 
 * WARNING: Does NOT create metadata.yml files - all data comes from definitions!
 */

const fs = require('fs');
const path = require('path');

// Import functions from schema.js
const { loadDefinitions } = require('./schema.js');

// README template for technologies with embedded prerequisites and content preservation
function generateReadme(tech, preservedContent = null) {
    const header = `# ${tech.name}

## Overview
${tech.description}

## Type
${tech.type.charAt(0).toUpperCase() + tech.type.slice(1)} Technology

## Prerequisites

${generatePrerequisitesSection(tech.prerequisites)}

## Historical Development

### First Emergence
${tech.historical?.first_occurrence ? `First appeared ${tech.historical.first_occurrence}` : '[When, where, and under what circumstances]'}

${tech.historical?.locations?.length ? `### Locations\n${tech.historical.locations.map(l => `- ${l}`).join('\n')}` : ''}

${tech.historical?.key_figures?.length ? `### Key Innovators\n${tech.historical.key_figures.map(f => `- ${f}`).join('\n')}` : ''}

### Parallel Invention
${tech.historical?.parallel_invention === true ? 'This technology was invented independently in multiple locations.' : 
  tech.historical?.parallel_invention === false ? 'This technology appears to have a single point of origin.' : 
  '[If developed independently multiple times]'}

### Evolution
[How the technology changed over time]

## Technical Details

### How It Works
[Explanation suitable for educated non-specialist]

### Materials & Resources
${tech.resources?.materials?.length ? `**Materials needed:**\n${tech.resources.materials.map(m => `- ${m}`).join('\n')}` : '[What\'s physically needed to implement]'}

${tech.resources?.knowledge?.length ? `\n**Knowledge requirements:**\n${tech.resources.knowledge.map(k => `- ${k}`).join('\n')}` : ''}

${tech.resources?.social?.length ? `\n**Social requirements:**\n${tech.resources.social.map(s => `- ${s}`).join('\n')}` : ''}

## Impact & Consequences

### Immediate Effects
[What changed right away]

### Long-term Consequences
[Unforeseen impacts over time]

### Technologies Unlocked
${tech.unlocks?.technologies?.length ? tech.unlocks.technologies.map(t => `- **${t}**: [How this enables it]`).join('\n') : '[What this directly enables]'}

### New Capabilities
${tech.unlocks?.capabilities?.length ? tech.unlocks.capabilities.map(c => `- **${c}**: [Description]`).join('\n') : '[New human abilities this provides]'}

### Synergies
[Technologies that combine well with this]

## Alternative Approaches
${tech.alternate_solutions?.length ? tech.alternate_solutions.map(s => `- **${s}**: Different solution to same problem`).join('\n') : '[Different solutions to the same problem]'}

## Modern Context
[How we use or have superseded this technology today]

## Lost Knowledge
[If applicable, what we no longer know about this technology]

## Sources & Further Reading
[Academic sources and accessible explanations]

## Implementation Notes
[For someone trying to recreate this technology]

## Description

${preservedContent || `[This is where detailed, enhanced content should be added. Everything after "## Description" is preserved during rebuilds.]`}

---
*Generated from technical definitions - Last updated: ${new Date().toISOString().split('T')[0]}*
`;

    return header;
}

// Generate prerequisites section with embedded markdown links
function generatePrerequisitesSection(prerequisites) {
    if (!prerequisites) {
        return `### Hard Requirements
- None

### Soft Requirements  
- None

### Catalysts
- None

### Synergistic
- None`;
    }

    const sections = [];
    
    // Hard Requirements
    sections.push('### Hard Requirements');
    if (prerequisites.hard?.length) {
        sections.push(prerequisites.hard.map(p => `- **[${p}](../${p}/README.md)**: [Why absolutely necessary]`).join('\n'));
    } else {
        sections.push('- None');
    }
    
    // Soft Requirements
    sections.push('\n### Soft Requirements');
    if (prerequisites.soft?.length) {
        sections.push(prerequisites.soft.map(p => `- **[${p}](../${p}/README.md)**: [How it helps but isn\'t essential]`).join('\n'));
    } else {
        sections.push('- None');
    }
    
    // Catalysts
    sections.push('\n### Catalysts');
    if (prerequisites.catalyst?.length) {
        sections.push(prerequisites.catalyst.map(p => `- **[${p}](../${p}/README.md)**: [How it accelerates development]`).join('\n'));
    } else {
        sections.push('- None');
    }
    
    // Synergistic
    sections.push('\n### Synergistic');
    if (prerequisites.synergistic?.length) {
        sections.push(prerequisites.synergistic.map(p => `- **[${p}](../${p}/README.md)**: [How they combine for greater effect]`).join('\n'));
    } else {
        sections.push('- None');
    }
    
    return sections.join('\n');
}

// Extract content after "## Description" marker for preservation
function extractPreservedContent(readmePath) {
    if (!fs.existsSync(readmePath)) {
        return null;
    }
    
    try {
        const content = fs.readFileSync(readmePath, 'utf8');
        const descriptionIndex = content.indexOf('## Description');
        
        if (descriptionIndex === -1) {
            return null; // No description marker found
        }
        
        // Find the start of content after "## Description"
        const afterDescription = content.substring(descriptionIndex);
        const firstNewlineIndex = afterDescription.indexOf('\n');
        
        if (firstNewlineIndex === -1) {
            return null;
        }
        
        // Get everything after the "## Description" line
        let preservedContent = afterDescription.substring(firstNewlineIndex + 1);
        
        // Remove the generation timestamp footer if it exists
        const footerIndex = preservedContent.lastIndexOf('\n---\n*Generated from');
        if (footerIndex !== -1) {
            preservedContent = preservedContent.substring(0, footerIndex);
        }
        
        // Trim trailing whitespace but preserve internal formatting
        preservedContent = preservedContent.replace(/\s+$/, '');
        
        return preservedContent.length > 0 ? preservedContent : null;
        
    } catch (error) {
        console.warn(`⚠️  Could not read ${readmePath}: ${error.message}`);
        return null;
    }
}

// Check for divergence between definitions and existing folder structure
function checkDivergence(technologies, outputDir) {
    if (!fs.existsSync(outputDir)) {
        return; // No divergence if directory doesn't exist yet
    }
    
    const existingFolders = fs.readdirSync(outputDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    
    const definedTechs = Object.keys(technologies);
    
    // Warn about folders not in definitions
    const orphanFolders = existingFolders.filter(folder => !definedTechs.includes(folder));
    if (orphanFolders.length > 0) {
        console.warn(`⚠️  Found folders not in definitions: ${orphanFolders.join(', ')}`);
        console.warn(`   Consider removing these or adding them to definitions.yml`);
    }
    
    // Check for metadata.yml files (architectural error)
    let metadataFound = [];
    for (const folder of existingFolders) {
        const metadataPath = path.join(outputDir, folder, 'metadata.yml');
        if (fs.existsSync(metadataPath)) {
            metadataFound.push(folder);
        }
    }
    
    if (metadataFound.length > 0) {
        console.error(`❌ ARCHITECTURAL ERROR: Found metadata.yml files in:`);
        console.error(`   ${metadataFound.join(', ')}`);
        console.error(`   These should not exist - all data comes from definitions.yml`);
        console.error(`   Run 'make clean' to remove them, then rebuild.`);
    }
}

function buildTree(definitionsPath, outputDir = 'tree/technologies') {
    try {
        console.log(`Building technology tree from ${definitionsPath}...`);
        
        // Load definitions from directory
        const data = loadDefinitions(definitionsPath);
        
        if (!data.technologies) {
            throw new Error('No technologies section found');
        }
        
        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        let created = 0;
        let updated = 0;
        
        // Check for divergence before building
        checkDivergence(data.technologies, outputDir);
        
        // Generate folders and files for each technology
        for (const [id, tech] of Object.entries(data.technologies)) {
            const techDir = path.join(outputDir, id);
            const readmePath = path.join(techDir, 'README.md');
            
            // Create technology directory
            const isNewTech = !fs.existsSync(techDir);
            if (isNewTech) {
                fs.mkdirSync(techDir, { recursive: true });
                console.log(`📁 Created ${techDir}`);
                created++;
            } else {
                updated++;
            }
            
            // Extract preserved content if README exists
            const preservedContent = extractPreservedContent(readmePath);
            
            // Generate README (always regenerate to update prerequisites and metadata)
            const readme = generateReadme(tech, preservedContent);
            fs.writeFileSync(readmePath, readme);
            
            const status = isNewTech ? 'Created' :
                          preservedContent ? 'Updated (content preserved)' : 'Regenerated';
            console.log(`📄 ${status} ${readmePath}`);
            
            console.log(`✅ ${tech.name} (${tech.type}/${tech.era})`);
        }
        
        console.log(`\n🎉 Build complete!`);
        console.log(`   Created: ${created} new technologies`);
        console.log(`   Updated: ${updated} existing technologies`);
        console.log(`   Total: ${Object.keys(data.technologies).length} technologies`);
        
        // Create navigation file
        createNavigation(data.technologies, outputDir);
        
        return true;
        
    } catch (error) {
        console.error(`❌ Build failed: ${error.message}`);
        return false;
    }
}

function createNavigation(technologies, outputDir) {
    const navPath = path.join(path.dirname(outputDir), 'NAVIGATION.md');
    
    // Group technologies by era and type
    const byEra = {};
    const byType = {};
    
    for (const [id, tech] of Object.entries(technologies)) {
        // By era
        if (!byEra[tech.era]) byEra[tech.era] = [];
        byEra[tech.era].push({ id, tech });
        
        // By type
        if (!byType[tech.type]) byType[tech.type] = [];
        byType[tech.type].push({ id, tech });
    }
    
    const navigation = `# Technology Tree Navigation

## Overview
This technology tree contains ${Object.keys(technologies).length} technologies spanning human history from the first stone tools to speculative future developments.

## How to Explore

### By Historical Era
${Object.entries(byEra).map(([era, techs]) => {
    return `\n#### ${era.charAt(0).toUpperCase() + era.slice(1)} (${techs.length} technologies)
${techs.map(({id, tech}) => `- [${tech.name}](technologies/${id}/) - ${tech.description}`).join('\n')}`;
}).join('\n')}

### By Technology Type

#### Material Technologies (${byType.material?.length || 0})
Physical, reproducible methods for manipulating the world.
${byType.material?.map(({id, tech}) => `- [${tech.name}](technologies/${id}/) - ${tech.description}`).join('\n') || 'None defined yet.'}

#### Social Technologies (${byType.social?.length || 0})
Organizational methods that coordinate human effort.
${byType.social?.map(({id, tech}) => `- [${tech.name}](technologies/${id}/) - ${tech.description}`).join('\n') || 'None defined yet.'}

#### Knowledge Technologies (${byType.knowledge?.length || 0})
Abstract systems for understanding and recording information.
${byType.knowledge?.map(({id, tech}) => `- [${tech.name}](technologies/${id}/) - ${tech.description}`).join('\n') || 'None defined yet.'}

## Dependency Network
Each technology folder contains:
- \`README.md\` - Full documentation (template to be filled in)
- \`prerequisites/\` - Symlinks to required technologies
  - \`hard/\` - Absolutely required
  - \`soft/\` - Helpful but optional
  - \`catalyst/\` - Accelerates development
  - \`synergistic/\` - Combines for greater effect

## Quick Start Paths
- **Stone Age to Space Age**: Follow the longest historical path
- **Alternative Histories**: Explore different technological traditions
- **Modern Prerequisites**: Trace what enabled current technology

---
*Auto-generated from definitions.yml - ${new Date().toISOString().split('T')[0]}*
`;
    
    fs.writeFileSync(navPath, navigation);
    console.log(`🧭 Created ${navPath}`);
}

// CLI interface
if (require.main === module) {
    const definitionsPath = process.argv[2] || 'tree/definitions';
    const outputDir = process.argv[3] || 'tree/technologies';
    
    if (!fs.existsSync(definitionsPath)) {
        console.error(`❌ Definitions directory not found: ${definitionsPath}`);
        process.exit(1);
    }
    
    const success = buildTree(definitionsPath, outputDir);
    process.exit(success ? 0 : 1);
}

module.exports = { buildTree, generateReadme };