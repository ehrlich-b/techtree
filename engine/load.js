/**
 * load.js — YAML loader for the TechTree dialect.
 *
 * Supports: nested maps with 2-space indents, inline arrays [a, b, c],
 * inline maps {} (only `{}` for empty), quoted/unquoted scalars, integers
 * (incl. negative), floats, booleans, null, comments. Single-line scalars
 * only — no multi-line strings, no anchors, no block-list arrays.
 *
 * loadData(dataDir) reads every *.yml file in the directory and returns a
 * merged object keyed by top-level field (items, recipes, tech, buildings,
 * actors). If two files declare the same top-level key, the second wins
 * with a console warning — the convention is one top-level key per file.
 */

const fs = require('fs');
const path = require('path');

function parseScalar(raw) {
    if (raw === undefined) return undefined;
    const s = raw.trim();
    if (s === '' || s === '~' || s === 'null') return null;
    if (s === 'true' || s === 'True') return true;
    if (s === 'false' || s === 'False') return false;
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    if (s.startsWith('[') && s.endsWith(']')) {
        const body = s.slice(1, -1).trim();
        if (body === '') return [];
        return body.split(',').map(x => parseScalar(x));
    }
    if (s.startsWith('{') && s.endsWith('}') && s.slice(1, -1).trim() === '') return {};
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    return s;
}

function stripComment(line) {
    let out = '';
    let inSingle = false, inDouble = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
        else if (c === '#' && !inSingle && !inDouble) break;
        out += c;
    }
    return out.replace(/\s+$/, '');
}

function parseYAML(content) {
    const lines = content.split('\n').map(stripComment)
        .map(l => ({ indent: l.length - l.trimStart().length, trimmed: l.trim() }))
        .filter(x => x.trimmed !== '');

    let i = 0;
    function parseMap(parentIndent) {
        if (i >= lines.length) return null;
        const first = lines[i];
        if (first.indent <= parentIndent) return null;
        const blockIndent = first.indent;
        const obj = {};
        while (i < lines.length && lines[i].indent === blockIndent) {
            const ln = lines[i];
            const colon = ln.trimmed.indexOf(':');
            if (colon === -1) { i++; continue; }
            const key = ln.trimmed.slice(0, colon).trim();
            const after = ln.trimmed.slice(colon + 1).trim();
            i++;
            if (after === '') {
                obj[key] = parseMap(blockIndent);
                if (obj[key] === null) obj[key] = {};
            } else {
                obj[key] = parseScalar(after);
            }
        }
        return obj;
    }

    return parseMap(-1) || {};
}

function loadFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return parseYAML(raw);
}

function loadData(dataDir = 'data') {
    if (!fs.existsSync(dataDir)) throw new Error(`Data directory not found: ${dataDir}`);
    const merged = {};
    for (const entry of fs.readdirSync(dataDir).sort()) {
        if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
        const data = loadFile(path.join(dataDir, entry));
        for (const [key, val] of Object.entries(data)) {
            if (merged[key] !== undefined) {
                console.warn(`warning: ${entry} redefines top-level key '${key}'`);
            }
            merged[key] = val;
        }
    }
    return merged;
}

module.exports = { parseYAML, loadFile, loadData };
