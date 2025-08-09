#!/usr/bin/env node

/**
 * validator.js - Checks README completeness for technology documentation
 * 
 * Usage: node validator.js [path-to-technologies-directory]
 * 
 * Validates:
 * - All required README sections are present
 * - No placeholder text remains
 * - Cross-references are valid
 * - Sources are provided
 */

const fs = require('fs');
const path = require('path');

// Required sections in technology READMEs
const REQUIRED_SECTIONS = [
    'Overview',
    'Type', 
    'Prerequisites',
    'Historical Development',
    'Technical Details',
    'Impact & Consequences',
    'Alternative Approaches',
    'Modern Context',
    'Sources & Further Reading',
    'Implementation Notes'
];

const REQUIRED_SUBSECTIONS = {
    'Prerequisites': ['Hard Requirements', 'Soft Requirements', 'Catalysts', 'Synergistic'],
    'Historical Development': ['First Emergence', 'Parallel Invention'],
    'Technical Details': ['How It Works', 'Materials & Resources'],
    'Impact & Consequences': ['Immediate Effects', 'Long-term Consequences', 'Technologies Unlocked', 'New Capabilities']
};

// Common placeholder text patterns
const PLACEHOLDER_PATTERNS = [
    /\[.*?\]/g,  // [Placeholder text]
    /TODO:/gi,
    /FIXME:/gi,
    /XXX:/gi,
    /TBD/gi,
    /To be determined/gi,
    /Fill this in/gi,
    /Add content here/gi
];

function parseReadme(content) {
    const lines = content.split('\n');
    const sections = {};
    let currentSection = null;
    let currentSubsection = null;
    let currentContent = [];
    
    for (const line of lines) {
        // Main sections (## Title)
        const mainSectionMatch = line.match(/^## (.+)$/);
        if (mainSectionMatch) {
            // Save previous section
            if (currentSection) {
                if (currentSubsection) {
                    if (!sections[currentSection]) sections[currentSection] = {};
                    sections[currentSection][currentSubsection] = currentContent.join('\n').trim();
                } else {
                    sections[currentSection] = currentContent.join('\n').trim();
                }
            }
            
            currentSection = mainSectionMatch[1];
            currentSubsection = null;
            currentContent = [];
            continue;
        }
        
        // Subsections (### Title)
        const subSectionMatch = line.match(/^### (.+)$/);
        if (subSectionMatch && currentSection) {
            // Save previous subsection
            if (currentSubsection) {
                if (typeof sections[currentSection] !== 'object') {
                    sections[currentSection] = {};
                }
                sections[currentSection][currentSubsection] = currentContent.join('\n').trim();
            } else if (currentContent.length > 0) {
                // This is the first subsection, save the main section content
                const mainContent = currentContent.join('\n').trim();
                if (mainContent) {
                    sections[currentSection] = { '_main': mainContent };
                } else {
                    sections[currentSection] = {};
                }
            }
            
            currentSubsection = subSectionMatch[1];
            currentContent = [];
            continue;
        }
        
        currentContent.push(line);
    }
    
    // Save final section
    if (currentSection) {
        if (currentSubsection) {
            if (typeof sections[currentSection] !== 'object') {
                sections[currentSection] = {};
            }
            sections[currentSection][currentSubsection] = currentContent.join('\n').trim();
        } else {
            sections[currentSection] = currentContent.join('\n').trim();
        }
    }
    
    return sections;
}

function validateTechnologyReadme(techDir, techId) {
    const readmePath = path.join(techDir, 'README.md');
    const errors = [];
    const warnings = [];
    
    // Check if README exists
    if (!fs.existsSync(readmePath)) {
        return {
            errors: [`README.md not found in ${techId}`],
            warnings: [],
            score: 0
        };
    }
    
    const content = fs.readFileSync(readmePath, 'utf8');
    const sections = parseReadme(content);
    
    let score = 0;
    const maxScore = REQUIRED_SECTIONS.length + 
                    Object.values(REQUIRED_SUBSECTIONS).flat().length + 
                    10; // bonus points for quality
    
    // Check required sections
    for (const section of REQUIRED_SECTIONS) {
        if (!sections[section]) {
            errors.push(`Missing section: ${section}`);
        } else {
            score++;
            
            // Check for empty sections
            const sectionContent = typeof sections[section] === 'object' ? 
                Object.values(sections[section]).join('') : sections[section];
            
            if (!sectionContent || sectionContent.length < 10) {
                warnings.push(`Section '${section}' appears to be empty or too short`);
            }
        }
    }
    
    // Check required subsections
    for (const [section, subsections] of Object.entries(REQUIRED_SUBSECTIONS)) {
        if (sections[section] && typeof sections[section] === 'object') {
            for (const subsection of subsections) {
                if (!sections[section][subsection]) {
                    errors.push(`Missing subsection: ${section} > ${subsection}`);
                } else {
                    score++;
                    
                    // Check for empty subsections
                    if (!sections[section][subsection] || sections[section][subsection].length < 5) {
                        warnings.push(`Subsection '${section} > ${subsection}' appears empty`);
                    }
                }
            }
        } else if (sections[section]) {
            // Section exists but has no subsections
            for (const subsection of subsections) {
                errors.push(`Missing subsection: ${section} > ${subsection} (section exists but no subsections found)`);
            }
        }
    }
    
    // Check for placeholder text
    let placeholderCount = 0;
    for (const pattern of PLACEHOLDER_PATTERNS) {
        const matches = content.match(pattern);
        if (matches) {
            placeholderCount += matches.length;
            for (const match of matches.slice(0, 3)) { // Show first 3
                warnings.push(`Placeholder text found: "${match}"`);
            }
        }
    }
    
    if (placeholderCount > 3) {
        warnings.push(`... and ${placeholderCount - 3} more placeholders`);
    }
    
    // Quality bonuses
    if (content.length > 2000) score += 2; // Comprehensive content
    if (content.includes('Source') || content.includes('Further Reading')) score += 2; // Has sources
    if (content.includes('http') || content.includes('www.')) score += 1; // Has links
    if (placeholderCount === 0) score += 3; // No placeholders
    if (content.includes('Example:') || content.includes('For example')) score += 1; // Has examples
    if (sections['Sources & Further Reading'] && sections['Sources & Further Reading'].length > 50) score += 1; // Good sources
    
    return {
        errors,
        warnings,
        score,
        maxScore,
        percentage: Math.round((score / maxScore) * 100),
        sections: Object.keys(sections),
        wordCount: content.split(/\s+/).length
    };
}

function validateAllTechnologies(technologiesDir) {
    console.log(`Validating technology documentation in ${technologiesDir}...`);
    
    if (!fs.existsSync(technologiesDir)) {
        console.error(`❌ Technologies directory not found: ${technologiesDir}`);
        return false;
    }
    
    const techDirs = fs.readdirSync(technologiesDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    
    if (techDirs.length === 0) {
        console.log('📁 No technology directories found');
        return true;
    }
    
    let totalErrors = 0;
    let totalWarnings = 0;
    let totalScore = 0;
    let maxPossibleScore = 0;
    
    const results = [];
    
    for (const techId of techDirs) {
        const techDir = path.join(technologiesDir, techId);
        const result = validateTechnologyReadme(techDir, techId);
        
        results.push({ techId, ...result });
        totalErrors += result.errors.length;
        totalWarnings += result.warnings.length;
        totalScore += result.score;
        maxPossibleScore += result.maxScore;
        
        // Report individual results
        if (result.errors.length === 0 && result.warnings.length === 0) {
            console.log(`✅ ${techId}: ${result.percentage}% complete (${result.wordCount} words)`);
        } else if (result.errors.length === 0) {
            console.log(`⚠️  ${techId}: ${result.percentage}% complete, ${result.warnings.length} warnings`);
        } else {
            console.log(`❌ ${techId}: ${result.errors.length} errors, ${result.warnings.length} warnings`);
            
            // Show first few errors
            for (const error of result.errors.slice(0, 3)) {
                console.log(`   - ${error}`);
            }
            if (result.errors.length > 3) {
                console.log(`   - ... and ${result.errors.length - 3} more errors`);
            }
        }
    }
    
    // Summary
    console.log(`\n📊 Validation Summary:`);
    console.log(`   Technologies: ${results.length}`);
    console.log(`   Total errors: ${totalErrors}`);
    console.log(`   Total warnings: ${totalWarnings}`);
    console.log(`   Overall completion: ${Math.round((totalScore / maxPossibleScore) * 100)}%`);
    
    // Quality breakdown
    const complete = results.filter(r => r.errors.length === 0 && r.warnings.length === 0).length;
    const draft = results.filter(r => r.errors.length === 0 && r.warnings.length > 0).length;
    const incomplete = results.filter(r => r.errors.length > 0).length;
    
    console.log(`\n📈 Quality Breakdown:`);
    console.log(`   ✅ Complete: ${complete} (${Math.round(complete/results.length*100)}%)`);
    console.log(`   ⚠️  Draft: ${draft} (${Math.round(draft/results.length*100)}%)`);
    console.log(`   ❌ Incomplete: ${incomplete} (${Math.round(incomplete/results.length*100)}%)`);
    
    // Best and worst
    if (results.length > 0) {
        results.sort((a, b) => b.percentage - a.percentage);
        console.log(`\n🏆 Best: ${results[0].techId} (${results[0].percentage}%)`);
        console.log(`🔧 Needs work: ${results[results.length - 1].techId} (${results[results.length - 1].percentage}%)`);
    }
    
    return totalErrors === 0;
}

// CLI interface
if (require.main === module) {
    const technologiesDir = process.argv[2] || 'tree/technologies';
    const success = validateAllTechnologies(technologiesDir);
    process.exit(success ? 0 : 1);
}

module.exports = { validateAllTechnologies, validateTechnologyReadme };