#!/usr/bin/env node

/**
 * builder.js - Generates folder structure from YAML technology definitions
 * 
 * Usage: node builder.js [path-to-definitions.yml] [output-directory]
 * 
 * Creates:
 * - Technology folders in tree/technologies/
 * - README.md templates for each technology
 * - metadata.yml files
 * - Basic directory structure
 */

const fs = require('fs');
const path = require('path');

// Import YAML parser from schema.js
const { parseYAML } = require('./schema.js');

// README template for technologies
function generateReadme(tech) {
    return `# ${tech.name}

## Overview
${tech.description}

## Type
${tech.type.charAt(0).toUpperCase() + tech.type.slice(1)} Technology

## Prerequisites

### Hard Requirements
${tech.prerequisites?.hard?.length ? tech.prerequisites.hard.map(p => `- **${p}**: [Why absolutely necessary]`).join('\n') : '- None'}

### Soft Requirements
${tech.prerequisites?.soft?.length ? tech.prerequisites.soft.map(p => `- **${p}**: [How it helps but isn't essential]`).join('\n') : '- None'}

### Catalysts
${tech.prerequisites?.catalyst?.length ? tech.prerequisites.catalyst.map(p => `- **${p}**: [How it accelerates development]`).join('\n') : '- None'}

### Synergistic
${tech.prerequisites?.synergistic?.length ? tech.prerequisites.synergistic.map(p => `- **${p}**: [How they combine for greater effect]`).join('\n') : '- None'}

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

---
*Generated from definitions.yml - Last updated: ${new Date().toISOString().split('T')[0]}*
`;
}

// Generate metadata.yml for each technology
function generateMetadata(tech) {
    return `# Metadata for ${tech.name}
id: ${tech.id}
name: "${tech.name}"
type: ${tech.type}
era: ${tech.era}
complexity: ${tech.complexity}

# Auto-generated on ${new Date().toISOString()}
# Do not edit manually - regenerate with builder.js
`;
}

function buildTree(definitionsPath, outputDir = 'tree/technologies') {
    try {
        console.log(`Building technology tree from ${definitionsPath}...`);
        
        // Parse definitions
        const content = fs.readFileSync(definitionsPath, 'utf8');
        const data = parseYAML(content);
        
        if (!data.technologies) {
            throw new Error('No technologies section found');
        }
        
        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        let created = 0;
        let updated = 0;
        
        // Generate folders and files for each technology
        for (const [id, tech] of Object.entries(data.technologies)) {
            const techDir = path.join(outputDir, id);
            const readmePath = path.join(techDir, 'README.md');
            const metadataPath = path.join(techDir, 'metadata.yml');
            const prereqDir = path.join(techDir, 'prerequisites');
            
            // Create technology directory
            if (!fs.existsSync(techDir)) {
                fs.mkdirSync(techDir, { recursive: true });
                console.log(`📁 Created ${techDir}`);
                created++;
            } else {
                updated++;
            }
            
            // Create prerequisites directory structure
            if (!fs.existsSync(prereqDir)) {
                fs.mkdirSync(prereqDir, { recursive: true });
                
                // Create subdirectories for each dependency type
                const depTypes = ['hard', 'soft', 'catalyst', 'synergistic'];
                for (const depType of depTypes) {
                    const depDir = path.join(prereqDir, depType);
                    fs.mkdirSync(depDir, { recursive: true });
                }
            }
            
            // Generate README if it doesn't exist or if --force flag is used
            const forceRegenerate = process.argv.includes('--force');
            if (!fs.existsSync(readmePath) || forceRegenerate) {
                const readme = generateReadme(tech);
                fs.writeFileSync(readmePath, readme);
                console.log(`📄 ${forceRegenerate ? 'Updated' : 'Created'} ${readmePath}`);
            }
            
            // Always update metadata (it's auto-generated)
            const metadata = generateMetadata(tech);
            fs.writeFileSync(metadataPath, metadata);
            
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
- \`README.md\` - Full documentation
- \`metadata.yml\` - Machine-readable data
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
    const definitionsPath = process.argv[2] || 'tree/definitions.yml';
    const outputDir = process.argv[3] || 'tree/technologies';
    
    if (!fs.existsSync(definitionsPath)) {
        console.error(`❌ Definitions file not found: ${definitionsPath}`);
        process.exit(1);
    }
    
    const success = buildTree(definitionsPath, outputDir);
    process.exit(success ? 0 : 1);
}

module.exports = { buildTree, generateReadme, generateMetadata };