#!/usr/bin/env node

/**
 * grapher.js - Generate dependency visualizations from technology definitions
 * 
 * Usage: node grapher.js [path-to-definitions.yml] [output-file.dot]
 * 
 * Generates GraphViz DOT files showing technology dependencies with:
 * - Different colors for dependency types (hard/soft/catalyst/synergistic)  
 * - Node shapes based on technology type (material/social/knowledge)
 * - Era-based clustering and coloring
 * - Critical path highlighting
 */

const fs = require('fs');
const path = require('path');

// Import functions from schema.js
const { loadDefinitions } = require('./schema.js');

// Color schemes for visualization
const COLORS = {
    // Dependency types
    dependencies: {
        hard: '#FF4444',      // Red - absolutely required
        soft: '#44BB44',      // Green - helpful
        catalyst: '#4444FF',  // Blue - accelerates
        synergistic: '#FF8800' // Orange - combines
    },
    
    // Technology types
    types: {
        material: '#8B4513',   // Brown - physical world
        social: '#9932CC',     // Purple - human organization  
        knowledge: '#006400'   // Dark green - abstract understanding
    },
    
    // Historical eras
    eras: {
        prehistoric: '#2F4F4F',
        ancient: '#8B4513',
        medieval: '#4682B4',
        'early-modern': '#9932CC',
        industrial: '#FF6347',
        information: '#32CD32',
        contemporary: '#FF1493',
        future: '#7B68EE'
    }
};

// Node shapes by technology type
const SHAPES = {
    material: 'box',
    social: 'ellipse', 
    knowledge: 'diamond'
};

function generateDOT(technologies, options = {}) {
    const { 
        showEras = true,
        groupByType = false,
        highlightCriticalPath = false,
        includeCapabilities = false
    } = options;
    
    const eraOrder = ['prehistoric', 'ancient', 'medieval', 'early-modern', 'industrial', 'information', 'contemporary', 'future'];
    
    let dot = 'digraph TechTree {\n';
    dot += '  rankdir=LR;\n';
    dot += '  ranksep=1.2;\n';  // Good horizontal spacing
    dot += '  nodesep=0.02;\n';  // ULTRA MINIMAL vertical spacing 
    dot += '  node [fontsize=7 width=1.0 height=0.15 margin="0.01,0.01"];\n';  // Very flat nodes
    dot += '  edge [arrowsize=0.3];\n';
    dot += '  concentrate=true;\n';
    dot += '  overlap=false;\n';
    dot += '  splines=polyline;\n\n';  // Polyline for more compact routing
    
    // Smart approach - spread technologies horizontally by grouping them
    if (showEras) {
        const byEra = {};
        
        // Group technologies by era
        for (const [id, tech] of Object.entries(technologies)) {
            if (!byEra[tech.era]) byEra[tech.era] = [];
            byEra[tech.era].push({ id, tech });
        }
        
        // Split each era into multiple columns to reduce height
        const MAX_PER_COLUMN = 5; // Maximum technologies per vertical column
        
        // Function to calculate connectivity score for smart positioning
        function getConnectivityScore(techId, allTechs, targetEra) {
            let score = 0;
            const tech = allTechs[techId];
            
            // Score based on incoming connections (what depends on this)
            for (const [otherId, otherTech] of Object.entries(allTechs)) {
                if (!otherTech.prerequisites) continue;
                for (const deps of Object.values(otherTech.prerequisites)) {
                    if (Array.isArray(deps) && deps.includes(techId)) {
                        // Higher score if the dependent is in a later era
                        const eraIndex = eraOrder.indexOf(otherTech.era);
                        const targetIndex = eraOrder.indexOf(targetEra);
                        if (eraIndex > targetIndex) {
                            score += 10; // Cross-era dependency
                        } else if (eraIndex === targetIndex) {
                            score += 5;  // Same-era dependency
                        }
                    }
                }
            }
            
            // Score based on outgoing connections (what this depends on)
            if (tech.prerequisites) {
                for (const deps of Object.values(tech.prerequisites)) {
                    if (Array.isArray(deps)) {
                        score += deps.length * 2;
                    }
                }
            }
            
            return score;
        }
        
        for (const era of eraOrder) {
            if (!byEra[era]) continue;
            
            const eraTechs = byEra[era];
            
            // Sort technologies by connectivity score for better positioning
            eraTechs.sort((a, b) => {
                const scoreA = getConnectivityScore(a.id, technologies, era);
                const scoreB = getConnectivityScore(b.id, technologies, era);
                return scoreB - scoreA; // Higher connectivity first
            });
            
            // Group by type for even better organization
            const byType = {
                knowledge: [],
                material: [],
                social: []
            };
            
            for (const item of eraTechs) {
                byType[item.tech.type].push(item);
            }
            
            // Interleave types for better distribution
            const organized = [];
            const types = ['knowledge', 'material', 'social'];
            let maxLen = Math.max(...types.map(t => byType[t].length));
            
            for (let i = 0; i < maxLen; i++) {
                for (const type of types) {
                    if (i < byType[type].length) {
                        organized.push(byType[type][i]);
                    }
                }
            }
            
            const numColumns = Math.ceil(organized.length / MAX_PER_COLUMN);
            
            // Split technologies into columns
            for (let col = 0; col < numColumns; col++) {
                const startIdx = col * MAX_PER_COLUMN;
                const endIdx = Math.min(startIdx + MAX_PER_COLUMN, organized.length);
                const columnTechs = organized.slice(startIdx, endIdx).map(item => item.id);
                
                if (columnTechs.length > 0) {
                    dot += `  { rank=same; ${columnTechs.map(id => `"${id}"`).join('; ')}; }\n`;
                }
            }
        }
        
        // Add era headers in a clean bottom row
        dot += '\n  // Era labels at bottom\n';
        const eraLabelsRow = [];
        for (const era of eraOrder) {
            if (byEra[era]) {
                const eraLabel = era.charAt(0).toUpperCase() + era.slice(1).replace(/-/g, ' ');
                const color = COLORS.eras[era] || '#666666';
                dot += `  "${era}_era" [label="${eraLabel}" shape=plaintext fontsize=10 fontcolor="${color}" fontweight=bold];\n`;
                eraLabelsRow.push(`"${era}_era"`);
            }
        }
        // Put all era labels in same bottom rank
        dot += `  { rank=max; ${eraLabelsRow.join('; ')}; }\n`;
        
        // Add all technology nodes
        for (const [id, tech] of Object.entries(technologies)) {
            const shape = SHAPES[tech.type] || 'box';
            const color = COLORS.types[tech.type] || '#888888';
            const shortName = tech.name.length > 15 ? tech.name.substring(0, 15) + '...' : tech.name;
            dot += `  "${id}" [label="${shortName}" shape=${shape} color="${color}" fillcolor="${color}22" style=filled];\n`;
        }
    } else {
        // Simple node definitions without era organization
        for (const [id, tech] of Object.entries(technologies)) {
            const shape = SHAPES[tech.type] || 'box';
            const color = COLORS.types[tech.type] || '#888888';
            dot += `  "${id}" [label="${tech.name}" shape=${shape} color="${color}" fillcolor="${color}22" style=filled];\n`;
        }
    }
    
    dot += '\n  // Dependencies (hard only for clarity)\n';
    
    // Add dependency edges with smart weighting
    for (const [id, tech] of Object.entries(technologies)) {
        if (!tech.prerequisites) continue;
        
        const targetEra = tech.era;
        
        // Hard dependencies with weight based on era distance
        const hardDeps = tech.prerequisites.hard;
        if (hardDeps && Array.isArray(hardDeps)) {
            for (const dep of hardDeps) {
                const depTech = technologies[dep];
                if (depTech) {
                    const sourceEra = depTech.era;
                    const eraDistance = Math.abs(eraOrder.indexOf(targetEra) - eraOrder.indexOf(sourceEra));
                    
                    // Closer era connections get higher weight (shorter edges)
                    const weight = eraDistance === 0 ? 10 : Math.max(1, 5 - eraDistance);
                    dot += `  "${dep}" -> "${id}" [color="#FF4444" style=solid penwidth=1.5 weight=${weight}];\n`;
                }
            }
        }
        
        // Soft dependencies - very subtle
        const softDeps = tech.prerequisites.soft;
        if (softDeps && Array.isArray(softDeps)) {
            for (const dep of softDeps) {
                dot += `  "${dep}" -> "${id}" [color="#CCCCCC" style=dashed penwidth=0.5 arrowsize=0.3 weight=0.5];\n`;
            }
        }
    }
    
    // Add capability unlocks if requested
    if (includeCapabilities) {
        dot += '\n  // Capabilities (gray nodes)\n';
        const capabilities = new Set();
        
        for (const [id, tech] of Object.entries(technologies)) {
            if (tech.unlocks?.capabilities) {
                for (const cap of tech.unlocks.capabilities) {
                    capabilities.add(cap);
                    dot += `  "${cap}" [shape=note style=filled fillcolor="#EEEEEE" color="#888888"];\n`;
                    dot += `  "${id}" -> "${cap}" [style=dashed color="#888888" label="enables"];\n`;
                }
            }
        }
    }
    
    // Simple legend  
    dot += '\n  // Legend\n';
    dot += '  legend [label="◆=Knowledge\\n◻=Material\\n◯=Social\\n\\nSolid Red=Required\\nDashed Gray=Helpful" shape=plaintext fontsize=8];\n';
    dot += '  { rank=min; legend; }\n';
    
    dot += '}\n';
    return dot;
}

function findCriticalPath(technologies, startTech, endTech) {
    // Simple BFS to find shortest dependency path
    const queue = [{ tech: startTech, path: [startTech] }];
    const visited = new Set();
    
    while (queue.length > 0) {
        const { tech, path } = queue.shift();
        
        if (tech === endTech) {
            return path;
        }
        
        if (visited.has(tech)) continue;
        visited.add(tech);
        
        const techData = technologies[tech];
        if (!techData || !techData.prerequisites) continue;
        
        // Follow hard dependencies primarily
        const hardDeps = techData.prerequisites.hard || [];
        for (const dep of hardDeps) {
            if (!visited.has(dep)) {
                queue.push({ tech: dep, path: [...path, dep] });
            }
        }
    }
    
    return null; // No path found
}

function analyzeGraph(technologies) {
    console.log('📊 Technology Graph Analysis');
    console.log('============================');
    
    const stats = {
        total: Object.keys(technologies).length,
        byType: {},
        byEra: {},
        dependencies: { hard: 0, soft: 0, catalyst: 0, synergistic: 0 },
        orphans: [],
        roots: [],
        complexity: {}
    };
    
    // Basic counts
    for (const [id, tech] of Object.entries(technologies)) {
        stats.byType[tech.type] = (stats.byType[tech.type] || 0) + 1;
        stats.byEra[tech.era] = (stats.byEra[tech.era] || 0) + 1;
        
        // Count dependencies
        if (tech.prerequisites) {
            for (const [depType, deps] of Object.entries(tech.prerequisites)) {
                if (Array.isArray(deps)) {
                    stats.dependencies[depType] += deps.length;
                }
            }
        }
        
        // Find orphans (no prerequisites) and roots (nothing depends on them)
        const hasPrereqs = tech.prerequisites && 
            Object.values(tech.prerequisites).some(deps => Array.isArray(deps) && deps.length > 0);
        
        if (!hasPrereqs) {
            stats.roots.push(id);
        }
        
        // Complexity scoring
        let complexity = 0;
        if (tech.prerequisites) {
            complexity += (tech.prerequisites.hard?.length || 0) * 3;
            complexity += (tech.prerequisites.soft?.length || 0) * 1;
            complexity += (tech.prerequisites.catalyst?.length || 0) * 1;
            complexity += (tech.prerequisites.synergistic?.length || 0) * 2;
        }
        stats.complexity[id] = complexity;
    }
    
    // Find technologies that nothing depends on
    const dependedUpon = new Set();
    for (const tech of Object.values(technologies)) {
        if (tech.prerequisites) {
            for (const deps of Object.values(tech.prerequisites)) {
                if (Array.isArray(deps)) {
                    deps.forEach(dep => dependedUpon.add(dep));
                }
            }
        }
    }
    
    stats.orphans = Object.keys(technologies).filter(id => !dependedUpon.has(id));
    
    // Output analysis
    console.log(`Total Technologies: ${stats.total}`);
    console.log(`\nBy Type:`);
    for (const [type, count] of Object.entries(stats.byType)) {
        console.log(`  ${type}: ${count}`);
    }
    
    console.log(`\nBy Era:`);
    for (const [era, count] of Object.entries(stats.byEra)) {
        console.log(`  ${era}: ${count}`);
    }
    
    console.log(`\nDependencies:`);
    for (const [depType, count] of Object.entries(stats.dependencies)) {
        console.log(`  ${depType}: ${count}`);
    }
    
    console.log(`\nRoot Technologies (no prerequisites): ${stats.roots.length}`);
    if (stats.roots.length <= 10) {
        console.log(`  ${stats.roots.join(', ')}`);
    }
    
    console.log(`\nLeaf Technologies (nothing depends on them): ${stats.orphans.length}`);
    if (stats.orphans.length <= 10) {
        console.log(`  ${stats.orphans.join(', ')}`);
    }
    
    // Most complex technologies
    const complexTechs = Object.entries(stats.complexity)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5);
    
    console.log(`\nMost Complex Technologies:`);
    for (const [id, complexity] of complexTechs) {
        console.log(`  ${id}: ${complexity} complexity points`);
    }
    
    return stats;
}

function main() {
    const definitionsPath = process.argv[2] || 'tree/definitions';
    const outputPath = process.argv[3] || 'dependencies.dot';
    
    try {
        console.log(`📈 Generating dependency graph from ${definitionsPath}...`);
        
        if (!fs.existsSync(definitionsPath)) {
            throw new Error(`Definitions directory not found: ${definitionsPath}`);
        }
        
        // Load definitions
        const data = loadDefinitions(definitionsPath);
        
        if (!data.technologies) {
            throw new Error('No technologies section found');
        }
        
        // Generate analysis
        analyzeGraph(data.technologies);
        
        // Generate DOT file
        const dot = generateDOT(data.technologies, {
            showEras: true,
            groupByType: false,
            includeCapabilities: false
        });
        
        fs.writeFileSync(outputPath, dot);
        console.log(`\n📊 Graph saved to ${outputPath}`);
        
        // Try to generate SVG if GraphViz is available
        const { spawn } = require('child_process');
        const svgPath = outputPath.replace('.dot', '.svg');
        
        const dot_process = spawn('dot', ['-Tsvg', outputPath, '-o', svgPath], { 
            stdio: 'inherit' 
        });
        
        dot_process.on('close', (code) => {
            if (code === 0) {
                console.log(`📈 SVG visualization saved to ${svgPath}`);
            } else {
                console.log(`⚠️  GraphViz not available - install with: brew install graphviz`);
            }
        });
        
        dot_process.on('error', (err) => {
            console.log(`⚠️  GraphViz not available - install with: brew install graphviz`);
        });
        
    } catch (error) {
        console.error(`❌ Graph generation failed: ${error.message}`);
        process.exit(1);
    }
}

// CLI interface
if (require.main === module) {
    main();
}

module.exports = { generateDOT, analyzeGraph, findCriticalPath };