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

// Import YAML parser from schema.js
const { parseYAML } = require('./schema.js');

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
    
    let dot = 'digraph TechTree {\n';
    dot += '  rankdir=TB;\n';
    dot += '  splines=ortho;\n';
    dot += '  node [fontsize=10];\n';
    dot += '  edge [fontsize=8];\n\n';
    
    // Define era subgraphs
    if (showEras) {
        const byEra = {};
        for (const [id, tech] of Object.entries(technologies)) {
            if (!byEra[tech.era]) byEra[tech.era] = [];
            byEra[tech.era].push({ id, tech });
        }
        
        for (const [era, techs] of Object.entries(byEra)) {
            dot += `  subgraph cluster_${era} {\n`;
            dot += `    label="${era.charAt(0).toUpperCase() + era.slice(1)}";\n`;
            dot += `    color="${COLORS.eras[era] || '#666666'}";\n`;
            dot += `    style=dashed;\n`;
            
            for (const { id, tech } of techs) {
                const shape = SHAPES[tech.type] || 'box';
                const color = COLORS.types[tech.type] || '#888888';
                dot += `    "${id}" [label="${tech.name}\\n(${tech.type})" shape=${shape} color="${color}" fillcolor="${color}22" style=filled];\n`;
            }
            
            dot += '  }\n\n';
        }
    } else {
        // Simple node definitions without clustering
        for (const [id, tech] of Object.entries(technologies)) {
            const shape = SHAPES[tech.type] || 'box';
            const color = COLORS.types[tech.type] || '#888888';
            dot += `  "${id}" [label="${tech.name}\\n(${tech.type})" shape=${shape} color="${color}" fillcolor="${color}22" style=filled];\n`;
        }
    }
    
    dot += '\n  // Dependencies\n';
    
    // Add dependency edges
    for (const [id, tech] of Object.entries(technologies)) {
        if (!tech.prerequisites) continue;
        
        for (const [depType, deps] of Object.entries(tech.prerequisites)) {
            if (!deps || !Array.isArray(deps)) continue;
            
            const color = COLORS.dependencies[depType] || '#888888';
            const style = depType === 'hard' ? 'solid' : 
                         depType === 'soft' ? 'dashed' :
                         depType === 'catalyst' ? 'dotted' : 'bold';
            
            for (const dep of deps) {
                dot += `  "${dep}" -> "${id}" [color="${color}" style=${style} label="${depType}"];\n`;
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
    
    // Legend
    dot += '\n  // Legend\n';
    dot += '  subgraph cluster_legend {\n';
    dot += '    label="Legend";\n';
    dot += '    style=filled;\n';
    dot += '    fillcolor="#F0F0F0";\n';
    dot += '    \n';
    dot += '    "Material" [shape=box color="#8B4513" fillcolor="#8B451322" style=filled];\n';
    dot += '    "Social" [shape=ellipse color="#9932CC" fillcolor="#9932CC22" style=filled];\n';
    dot += '    "Knowledge" [shape=diamond color="#006400" fillcolor="#00640022" style=filled];\n';
    dot += '    \n';
    dot += '    "Hard" -> "Soft" [color="#FF4444" style=solid label="required"];\n';
    dot += '    "Soft" -> "Catalyst" [color="#44BB44" style=dashed label="helpful"];\n';
    dot += '    "Catalyst" -> "Synergistic" [color="#4444FF" style=dotted label="accelerates"];\n';
    dot += '    "Synergistic" -> "End" [color="#FF8800" style=bold label="combines"];\n';
    dot += '  }\n';
    
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
    const definitionsPath = process.argv[2] || 'tree/definitions.yml';
    const outputPath = process.argv[3] || 'dependencies.dot';
    
    try {
        console.log(`📈 Generating dependency graph from ${definitionsPath}...`);
        
        if (!fs.existsSync(definitionsPath)) {
            throw new Error(`Definitions file not found: ${definitionsPath}`);
        }
        
        // Parse definitions
        const content = fs.readFileSync(definitionsPath, 'utf8');
        const data = parseYAML(content);
        
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