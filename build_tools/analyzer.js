#!/usr/bin/env node

/**
 * analyzer.js - Provides tree statistics and complexity metrics
 * 
 * Usage: node analyzer.js [definitions-file] [technologies-directory]
 * 
 * Analyzes the technology tree for:
 * - Basic statistics (counts by type/era)  
 * - Dependency complexity metrics
 * - Missing prerequisite detection
 * - Alternative path analysis
 * - Critical path identification
 * - Circular dependency detection
 * - Balance and completeness metrics
 */

const fs = require('fs');
const path = require('path');

// Import functions from schema.js
const { loadDefinitions } = require('./schema.js');

class TechTreeAnalyzer {
    constructor(technologies, technologiesDir = null) {
        this.technologies = technologies;
        this.technologiesDir = technologiesDir;
        this.stats = this.calculateBasicStats();
        this.dependencyGraph = this.buildDependencyGraph();
    }
    
    calculateBasicStats() {
        const stats = {
            total: Object.keys(this.technologies).length,
            byType: { material: 0, social: 0, knowledge: 0 },
            byEra: {},
            byComplexity: { low: 0, medium: 0, high: 0, extreme: 0 },
            dependencies: { 
                total: 0,
                hard: 0, 
                soft: 0, 
                catalyst: 0, 
                synergistic: 0 
            },
            roots: [],
            leaves: [],
            averagePrereqs: 0
        };
        
        // Count technologies by various attributes
        let totalPrereqs = 0;
        
        for (const [id, tech] of Object.entries(this.technologies)) {
            // By type
            stats.byType[tech.type] = (stats.byType[tech.type] || 0) + 1;
            
            // By era
            stats.byEra[tech.era] = (stats.byEra[tech.era] || 0) + 1;
            
            // By complexity
            stats.byComplexity[tech.complexity] = (stats.byComplexity[tech.complexity] || 0) + 1;
            
            // Count prerequisites
            let techPrereqs = 0;
            if (tech.prerequisites) {
                for (const [depType, deps] of Object.entries(tech.prerequisites)) {
                    if (Array.isArray(deps)) {
                        const count = deps.length;
                        stats.dependencies[depType] += count;
                        stats.dependencies.total += count;
                        techPrereqs += count;
                    }
                }
            }
            
            totalPrereqs += techPrereqs;
            
            // Find root technologies (no prerequisites)
            if (techPrereqs === 0) {
                stats.roots.push(id);
            }
        }
        
        // Calculate average prerequisites
        stats.averagePrereqs = totalPrereqs / stats.total;
        
        // Find leaf technologies (nothing depends on them)
        const dependedUpon = new Set();
        for (const tech of Object.values(this.technologies)) {
            if (tech.prerequisites) {
                for (const deps of Object.values(tech.prerequisites)) {
                    if (Array.isArray(deps)) {
                        deps.forEach(dep => dependedUpon.add(dep));
                    }
                }
            }
        }
        
        stats.leaves = Object.keys(this.technologies)
            .filter(id => !dependedUpon.has(id));
        
        return stats;
    }
    
    buildDependencyGraph() {
        const graph = { forward: {}, reverse: {} };
        
        // Initialize empty adjacency lists
        for (const id of Object.keys(this.technologies)) {
            graph.forward[id] = { hard: [], soft: [], catalyst: [], synergistic: [] };
            graph.reverse[id] = { hard: [], soft: [], catalyst: [], synergistic: [] };
        }
        
        // Build adjacency lists
        for (const [id, tech] of Object.entries(this.technologies)) {
            if (tech.prerequisites) {
                for (const [depType, deps] of Object.entries(tech.prerequisites)) {
                    if (Array.isArray(deps)) {
                        for (const dep of deps) {
                            if (graph.forward[dep]) {
                                graph.forward[dep][depType].push(id);
                            }
                            if (graph.reverse[id]) {
                                graph.reverse[id][depType].push(dep);
                            }
                        }
                    }
                }
            }
        }
        
        return graph;
    }
    
    findMissingPrerequisites() {
        const missing = [];
        
        for (const [id, tech] of Object.entries(this.technologies)) {
            if (tech.prerequisites) {
                for (const [depType, deps] of Object.entries(tech.prerequisites)) {
                    if (Array.isArray(deps)) {
                        for (const dep of deps) {
                            if (!this.technologies[dep]) {
                                missing.push({
                                    technology: id,
                                    missingPrereq: dep,
                                    dependencyType: depType
                                });
                            }
                        }
                    }
                }
            }
        }
        
        return missing;
    }
    
    detectCircularDependencies() {
        const visiting = new Set();
        const visited = new Set();
        const cycles = [];
        
        const dfs = (node, path = []) => {
            if (visiting.has(node)) {
                // Found cycle
                const cycleStart = path.indexOf(node);
                cycles.push(path.slice(cycleStart).concat([node]));
                return;
            }
            
            if (visited.has(node)) return;
            
            visiting.add(node);
            path.push(node);
            
            // Follow hard dependencies only for cycle detection
            const tech = this.technologies[node];
            if (tech?.prerequisites?.hard) {
                for (const dep of tech.prerequisites.hard) {
                    if (this.technologies[dep]) {
                        dfs(dep, [...path]);
                    }
                }
            }
            
            visiting.delete(node);
            visited.add(node);
            path.pop();
        };
        
        for (const techId of Object.keys(this.technologies)) {
            if (!visited.has(techId)) {
                dfs(techId);
            }
        }
        
        return cycles;
    }
    
    findAlternativePaths(fromTech, toTech, maxDepth = 10) {
        const paths = [];
        
        const dfs = (current, target, path, visited, depth) => {
            if (depth > maxDepth) return;
            if (current === target) {
                paths.push([...path]);
                return;
            }
            
            const tech = this.technologies[current];
            if (!tech?.prerequisites) return;
            
            // Try different dependency types
            for (const [depType, deps] of Object.entries(tech.prerequisites)) {
                if (Array.isArray(deps)) {
                    for (const dep of deps) {
                        if (!visited.has(dep) && this.technologies[dep]) {
                            visited.add(dep);
                            path.push({ tech: dep, depType, from: current });
                            dfs(dep, target, path, visited, depth + 1);
                            path.pop();
                            visited.delete(dep);
                        }
                    }
                }
            }
        };
        
        const visited = new Set([fromTech]);
        dfs(fromTech, toTech, [], visited, 0);
        
        return paths;
    }
    
    calculateComplexityScores() {
        const scores = {};
        
        for (const [id, tech] of Object.entries(this.technologies)) {
            let score = 0;
            
            // Base complexity from prerequisites
            if (tech.prerequisites) {
                score += (tech.prerequisites.hard?.length || 0) * 5;
                score += (tech.prerequisites.soft?.length || 0) * 2;
                score += (tech.prerequisites.catalyst?.length || 0) * 3;
                score += (tech.prerequisites.synergistic?.length || 0) * 4;
            }
            
            // Bonus for era (later = more complex)
            const eraMultipliers = {
                prehistoric: 1.0,
                ancient: 1.2,
                medieval: 1.4,
                'early-modern': 1.6,
                industrial: 1.8,
                information: 2.0,
                contemporary: 2.2,
                future: 2.5
            };
            
            score *= (eraMultipliers[tech.era] || 1.0);
            
            // Type modifier
            const typeMultipliers = {
                material: 1.0,
                social: 1.3,     // Social tech often more complex
                knowledge: 1.1
            };
            
            score *= (typeMultipliers[tech.type] || 1.0);
            
            scores[id] = Math.round(score * 100) / 100;
        }
        
        return scores;
    }
    
    checkDocumentationCompleteness() {
        if (!this.technologiesDir) {
            return { message: 'Technologies directory not provided' };
        }
        
        const completeness = {};
        let totalScore = 0;
        let techCount = 0;
        
        for (const techId of Object.keys(this.technologies)) {
            const readmePath = path.join(this.technologiesDir, techId, 'README.md');
            
            if (!fs.existsSync(readmePath)) {
                completeness[techId] = { score: 0, issues: ['README.md missing'] };
                continue;
            }
            
            try {
                const content = fs.readFileSync(readmePath, 'utf8');
                const score = this.scoreReadmeCompleteness(content);
                completeness[techId] = score;
                totalScore += score.score;
                techCount++;
            } catch (error) {
                completeness[techId] = { score: 0, issues: ['Failed to read README.md'] };
            }
        }
        
        return {
            byTechnology: completeness,
            averageScore: techCount > 0 ? Math.round(totalScore / techCount) : 0,
            totalTechnologies: techCount
        };
    }
    
    scoreReadmeCompleteness(content) {
        let score = 0;
        const issues = [];
        
        // Required sections
        const requiredSections = [
            'Overview', 'Type', 'Prerequisites', 'Historical Development',
            'Technical Details', 'Impact & Consequences', 'Sources & Further Reading'
        ];
        
        for (const section of requiredSections) {
            if (content.includes(`## ${section}`)) {
                score += 10;
            } else {
                issues.push(`Missing ${section} section`);
            }
        }
        
        // Check for placeholder text
        const placeholders = [
            '[Why absolutely necessary]',
            '[How the technology changed over time]',
            '[Explanation suitable for educated non-specialist]',
            '[Academic sources and accessible explanations]'
        ];
        
        let placeholderCount = 0;
        for (const placeholder of placeholders) {
            if (content.includes(placeholder)) {
                placeholderCount++;
            }
        }
        
        if (placeholderCount > 0) {
            issues.push(`${placeholderCount} placeholder(s) not filled`);
            score -= placeholderCount * 5;
        }
        
        // Bonus for good content
        if (content.length > 2000) score += 10;
        if (content.includes('###')) score += 5; // Has subsections
        
        return { score: Math.max(0, score), issues };
    }
    
    generateReport() {
        console.log('📊 TechTree Analysis Report');
        console.log('==========================\n');
        
        // Basic Statistics
        console.log('📈 Basic Statistics');
        console.log(`Total Technologies: ${this.stats.total}`);
        console.log(`\nBy Type:`);
        for (const [type, count] of Object.entries(this.stats.byType)) {
            console.log(`  ${type}: ${count} (${Math.round(count/this.stats.total*100)}%)`);
        }
        
        console.log(`\nBy Era:`);
        for (const [era, count] of Object.entries(this.stats.byEra)) {
            console.log(`  ${era}: ${count}`);
        }
        
        console.log(`\nBy Complexity:`);
        for (const [complexity, count] of Object.entries(this.stats.byComplexity)) {
            console.log(`  ${complexity}: ${count}`);
        }
        
        // Dependencies
        console.log(`\n🔗 Dependencies`);
        console.log(`Total Dependencies: ${this.stats.dependencies.total}`);
        console.log(`Average Prerequisites per Technology: ${this.stats.averagePrereqs.toFixed(1)}`);
        console.log(`\nBy Type:`);
        for (const [depType, count] of Object.entries(this.stats.dependencies)) {
            if (depType !== 'total') {
                console.log(`  ${depType}: ${count}`);
            }
        }
        
        // Root and Leaf Technologies
        console.log(`\n🌱 Root Technologies (${this.stats.roots.length}):`);
        console.log(`  ${this.stats.roots.slice(0, 10).join(', ')}${this.stats.roots.length > 10 ? '...' : ''}`);
        
        console.log(`\n🍃 Leaf Technologies (${this.stats.leaves.length}):`);
        console.log(`  ${this.stats.leaves.slice(0, 10).join(', ')}${this.stats.leaves.length > 10 ? '...' : ''}`);
        
        // Missing Prerequisites
        const missing = this.findMissingPrerequisites();
        if (missing.length > 0) {
            console.log(`\n❌ Missing Prerequisites (${missing.length}):`);
            for (const miss of missing.slice(0, 5)) {
                console.log(`  ${miss.technology} -> ${miss.missingPrereq} (${miss.dependencyType})`);
            }
            if (missing.length > 5) {
                console.log(`  ... and ${missing.length - 5} more`);
            }
        }
        
        // Circular Dependencies
        const cycles = this.detectCircularDependencies();
        if (cycles.length > 0) {
            console.log(`\n🔄 Circular Dependencies Found (${cycles.length}):`);
            for (const cycle of cycles.slice(0, 3)) {
                console.log(`  ${cycle.join(' -> ')}`);
            }
        } else {
            console.log(`\n✅ No circular dependencies detected`);
        }
        
        // Complexity Analysis
        const complexityScores = this.calculateComplexityScores();
        const topComplex = Object.entries(complexityScores)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5);
            
        console.log(`\n🧮 Most Complex Technologies:`);
        for (const [techId, score] of topComplex) {
            console.log(`  ${techId}: ${score} points`);
        }
        
        // Documentation Completeness
        if (this.technologiesDir) {
            const docAnalysis = this.checkDocumentationCompleteness();
            console.log(`\n📚 Documentation Completeness:`);
            console.log(`Average Score: ${docAnalysis.averageScore}% (${docAnalysis.totalTechnologies} technologies)`);
            
            const incomplete = Object.entries(docAnalysis.byTechnology)
                .filter(([,data]) => data.score < 70)
                .slice(0, 5);
                
            if (incomplete.length > 0) {
                console.log(`\nNeeds Attention:`);
                for (const [techId, data] of incomplete) {
                    console.log(`  ${techId}: ${data.score}% (${data.issues.length} issues)`);
                }
            }
        }
        
        // Recommendations
        console.log(`\n💡 Recommendations:`);
        
        if (this.stats.roots.length < 3) {
            console.log(`  - Consider adding more foundational technologies`);
        }
        
        if (this.stats.leaves.length > this.stats.total * 0.3) {
            console.log(`  - Many leaf technologies - consider what they might enable`);
        }
        
        if (missing.length > 0) {
            console.log(`  - Define missing prerequisite technologies`);
        }
        
        if (this.stats.dependencies.hard / this.stats.dependencies.total < 0.5) {
            console.log(`  - Consider converting some soft dependencies to hard`);
        }
        
        console.log('');
    }
}

function main() {
    const definitionsPath = process.argv[2] || 'tree/definitions';
    const technologiesDir = process.argv[3] || 'tree/technologies';
    
    try {
        console.log(`📊 Analyzing technology tree from ${definitionsPath}...`);
        
        if (!fs.existsSync(definitionsPath)) {
            throw new Error(`Definitions directory not found: ${definitionsPath}`);
        }
        
        // Load definitions
        const data = loadDefinitions(definitionsPath);
        
        if (!data.technologies) {
            throw new Error('No technologies section found');
        }
        
        // Check if technologies directory exists
        const techDirExists = fs.existsSync(technologiesDir);
        
        // Create analyzer and generate report
        const analyzer = new TechTreeAnalyzer(
            data.technologies, 
            techDirExists ? technologiesDir : null
        );
        
        analyzer.generateReport();
        
    } catch (error) {
        console.error(`❌ Analysis failed: ${error.message}`);
        process.exit(1);
    }
}

// CLI interface
if (require.main === module) {
    main();
}

module.exports = { TechTreeAnalyzer };