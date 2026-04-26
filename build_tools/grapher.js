#!/usr/bin/env node

/**
 * grapher.js — render the v2 tech tree as GraphViz DOT.
 *
 * Visual encoding:
 *   - Shape by layer: nature=cylinder, material=box, social=ellipse,
 *                     knowledge=diamond, scenario=octagon.
 *   - Color by layer.
 *   - Fill opacity by effective confidence:
 *       certain (=1.0)        → solid
 *       anchor (>=0.50)       → 75% alpha
 *       probable (>=0.20)     → 47% alpha
 *       speculative (<0.20)   → 20% alpha
 *   - Edge style by dep type: hard=solid red, soft=dashed gray, catalyst=dotted blue.
 *   - Layout buckets nodes by year (era mapping below). Nature nodes pinned leftmost.
 *
 * Usage: node grapher.js [path-to-definitions] [output.dot]
 */

const fs = require('fs');
const { spawn } = require('child_process');
const { loadDefinitions, effectiveConfidence } = require('./schema.js');

const LAYER_COLOR = {
    nature:    '#5D4037',
    material:  '#8B4513',
    social:    '#9932CC',
    knowledge: '#006400',
    scenario:  '#C71585',
};

const LAYER_SHAPE = {
    nature:    'cylinder',
    material:  'box',
    social:    'ellipse',
    knowledge: 'diamond',
    scenario:  'octagon',
};

const DEP_STYLE = {
    hard:     { color: '#D62828', style: 'solid',  penwidth: 1.5 },
    soft:     { color: '#888888', style: 'dashed', penwidth: 0.7 },
    catalyst: { color: '#1F77B4', style: 'dotted', penwidth: 0.7 },
};

// year → era bucket (left-to-right layout)
const ERA_BUCKETS = [
    { name: 'nature',        test: (t) => t.layer === 'nature' },
    { name: 'prehistoric',   test: (t) => typeof t.year === 'number' && t.year < -3000 },
    { name: 'ancient',       test: (t) => typeof t.year === 'number' && t.year >= -3000 && t.year < 500 },
    { name: 'medieval',      test: (t) => typeof t.year === 'number' && t.year >= 500 && t.year < 1450 },
    { name: 'early-modern',  test: (t) => typeof t.year === 'number' && t.year >= 1450 && t.year < 1750 },
    { name: 'industrial',    test: (t) => typeof t.year === 'number' && t.year >= 1750 && t.year < 1950 },
    { name: 'information',   test: (t) => typeof t.year === 'number' && t.year >= 1950 && t.year < 2000 },
    { name: 'contemporary',  test: (t) => typeof t.year === 'number' && t.year >= 2000 && t.year < 2030 },
    { name: 'near-future',   test: (t) => typeof t.year === 'number' && t.year >= 2030 && t.year < 2050 },
    { name: 'mid-future',    test: (t) => typeof t.year === 'number' && t.year >= 2050 && t.year < 2070 },
    { name: 'far-future',    test: (t) => typeof t.year === 'number' && t.year >= 2070 },
    { name: 'undated',       test: () => true },
];

function bucketOf(tech) {
    for (const b of ERA_BUCKETS) if (b.test(tech)) return b.name;
    return 'undated';
}

function alphaForConfidence(c) {
    if (c >= 1.0) return 'FF';
    if (c >= 0.5) return 'BB';
    if (c >= 0.2) return '77';
    return '33';
}

function escapeLabel(s) {
    return String(s).replace(/"/g, '\\"');
}

function generateDOT(techs) {
    const eff = effectiveConfidence(techs);

    // Group by bucket for rank=same constraints
    const buckets = {};
    for (const [id, tech] of Object.entries(techs)) {
        const b = bucketOf(tech);
        (buckets[b] ||= []).push(id);
    }

    let dot = 'digraph TechTree {\n';
    dot += '  rankdir=LR;\n';
    dot += '  ranksep=1.0;\n';
    dot += '  nodesep=0.15;\n';
    dot += '  node [fontsize=8 fontname="Helvetica"];\n';
    dot += '  edge [arrowsize=0.5];\n';
    dot += '  concentrate=true;\n';
    dot += '  splines=spline;\n\n';

    // Per-bucket clusters with rank=same — split if a bucket gets too tall.
    const MAX_PER_COLUMN = 14;
    for (const b of ERA_BUCKETS) {
        const ids = buckets[b.name];
        if (!ids || ids.length === 0) continue;
        // Sort within bucket: by year (or 0), then by id for stability.
        ids.sort((a, c) => ((techs[a].year ?? 0) - (techs[c].year ?? 0)) || a.localeCompare(c));
        for (let col = 0; col < ids.length; col += MAX_PER_COLUMN) {
            const slice = ids.slice(col, col + MAX_PER_COLUMN);
            dot += `  { rank=same; ${slice.map(id => `"${id}"`).join('; ')}; }\n`;
        }
    }

    dot += '\n  // Nodes\n';
    for (const [id, tech] of Object.entries(techs)) {
        const layer = tech.layer || 'material';
        const shape = LAYER_SHAPE[layer] || 'box';
        const color = LAYER_COLOR[layer] || '#888888';
        const alpha = alphaForConfidence(eff[id] ?? 1.0);
        const fill = `${color}${alpha}`;
        const label = tech.name.length > 22 ? tech.name.slice(0, 21) + '…' : tech.name;
        dot += `  "${id}" [label="${escapeLabel(label)}" shape=${shape} color="${color}" fillcolor="${fill}" style=filled];\n`;
    }

    dot += '\n  // Edges\n';
    for (const [id, tech] of Object.entries(techs)) {
        if (!tech.prerequisites) continue;
        for (const dt of ['hard', 'soft', 'catalyst']) {
            const list = tech.prerequisites[dt];
            if (!Array.isArray(list)) continue;
            const s = DEP_STYLE[dt];
            for (const dep of list) {
                if (!techs[dep]) continue;
                dot += `  "${dep}" -> "${id}" [color="${s.color}" style=${s.style} penwidth=${s.penwidth}];\n`;
            }
        }
    }

    // Legend
    dot += '\n  // Legend\n';
    const legendLines = [
        'cylinder = nature substrate',
        'box = material',
        'ellipse = social',
        'diamond = knowledge',
        'octagon = scenario gate',
        '',
        'red solid = hard prereq',
        'gray dashed = soft prereq',
        'blue dotted = catalyst',
        '',
        'opacity = effective confidence',
    ].join('\\n');
    dot += `  legend [label="${legendLines}" shape=note style=filled fillcolor="#FFFFE0" fontsize=9];\n`;
    dot += '  { rank=min; legend; }\n';

    dot += '}\n';
    return dot;
}

function findCriticalPath(techs, startId, endId) {
    const queue = [{ id: startId, path: [startId] }];
    const visited = new Set();
    while (queue.length) {
        const { id, path } = queue.shift();
        if (id === endId) return path;
        if (visited.has(id)) continue;
        visited.add(id);
        const t = techs[id];
        if (!t || !t.prerequisites) continue;
        for (const dep of (t.prerequisites.hard || [])) {
            if (!visited.has(dep)) queue.push({ id: dep, path: [...path, dep] });
        }
    }
    return null;
}

function main() {
    const definitionsPath = process.argv[2] || 'tree/definitions';
    const outputPath = process.argv[3] || 'dependencies.dot';

    if (!fs.existsSync(definitionsPath)) {
        console.error(`❌ Definitions directory not found: ${definitionsPath}`);
        process.exit(1);
    }

    console.log(`📈 Generating dependency graph from ${definitionsPath}...`);
    const data = loadDefinitions(definitionsPath);
    if (!data.technologies) {
        console.error('❌ No technologies loaded');
        process.exit(1);
    }

    const dot = generateDOT(data.technologies);
    fs.writeFileSync(outputPath, dot);
    console.log(`📊 DOT saved to ${outputPath} (${Object.keys(data.technologies).length} nodes)`);

    const svgPath = outputPath.replace(/\.dot$/, '.svg');
    const proc = spawn('dot', ['-Tsvg', outputPath, '-o', svgPath], { stdio: 'inherit' });
    proc.on('close', (code) => {
        if (code === 0) console.log(`📈 SVG saved to ${svgPath}`);
        else console.log(`⚠️  GraphViz unavailable; .dot written but not rendered.`);
    });
    proc.on('error', () => {
        console.log(`⚠️  GraphViz unavailable; .dot written but not rendered.`);
    });
}

if (require.main === module) main();

module.exports = { generateDOT, findCriticalPath };
