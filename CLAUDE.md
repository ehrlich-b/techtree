# CLAUDE.md - Working Conventions for TechTree Development

## Project Understanding

This is a historically grounded exploration of human technological development, modeled as a directed acyclic graph using git's filesystem and symlinks. The project aims to be anthropologically informed, educationally valuable, and intellectually engaging.

## Core Design Philosophy

### The Three-Layer Model
Always categorize technologies into one of three layers:

1. **Material Technologies**: Physical, reproducible methods (tools, processes, materials)
2. **Social Technologies**: Organizational structures that coordinate human effort  
3. **Knowledge Technologies**: Abstract systems for understanding and recording

### Dependency Types
When defining prerequisites, specify the type:
- **Hard**: Absolutely required (can't make steel without iron)
- **Soft**: Helpful but not essential (telegraph assists railways but isn't required)
- **Catalyst**: Accelerates development (mathematics speeds engineering)
- **Synergistic**: Combine for multiplied effect (printing + universities)

## Working Principles

### 1. Historical Accuracy First
- Every technology must have real historical basis
- Document uncertainties and debates
- Include multiple invention points where they occurred
- Acknowledge lost technologies

### 2. Cultural Sensitivity
- Avoid "primitive" vs "advanced" framing
- Recognize all civilizations' contributions
- Show how environment and culture shape technology
- Include non-Western innovation paths

### 3. Systematic Documentation
- Define technologies in YAML before creating folders
- Build structure programmatically from definitions
- Validate continuously
- Use symlinks to represent all prerequisite types

## Technology Documentation Standards

### YAML Definition Schema
```yaml
technology-id:
  # Identity & Classification
  id: unique-lowercase-hyphenated
  name: "Display Name"
  type: material|social|knowledge
  era: prehistoric|ancient|medieval|early-modern|industrial|information|contemporary|future
  
  # Dependencies (specify type!)
  prerequisites:
    hard: [absolutely-required]
    soft: [helpful-but-optional]
    catalyst: [speeds-development]
    synergistic: [combines-for-bonus]
  
  # What it enables
  unlocks:
    technologies: [directly-enabled-techs]
    capabilities: [new-human-abilities]
    
  # Requirements
  resources:
    materials: [physical-stuff-needed]
    knowledge: [concepts-required]
    social: [organizational-prerequisites]
    
  # Historical Data
  historical:
    first_occurrence: "~12000 BCE"
    locations: ["Mesopotamia", "China", "Mesoamerica"]  
    key_figures: ["Ibn al-Haytham", "Galileo"]
    parallel_invention: true|false
    
  # Characteristics
  complexity: low|medium|high|extreme
  description: "One-paragraph explanation"
  
  # Alternative Paths
  alternate_paths:
    - [different-prerequisite-combo]
  alternate_solutions:
    - "Polynesian navigation vs compass"
```

### README Template
Every technology folder must contain a README with these sections:

```markdown
# [Technology Name]

## Overview
What this technology is and why it matters to human development.

## Type
[Material|Social|Knowledge] Technology

## Prerequisites

### Hard Requirements
- **technology-name**: Why absolutely necessary

### Soft Requirements  
- **technology-name**: How it helps but isn't essential

### Catalysts
- **technology-name**: How it accelerates development

## Historical Development

### First Emergence
When, where, and under what circumstances

### Parallel Invention
If developed independently multiple times

### Key Innovators
People and civilizations who contributed

### Evolution
How the technology changed over time

## Technical Details

### How It Works
Explanation suitable for educated non-specialist

### Materials & Resources
What's physically needed to implement

### Knowledge Requirements
Concepts that must be understood

## Impact & Consequences

### Immediate Effects
What changed right away

### Long-term Consequences
Unforeseen impacts over time

### Technologies Unlocked
What this directly enables

### Synergies
Technologies that combine well with this

## Alternative Approaches
Different solutions to the same problem (e.g., Roman numerals vs Arabic)

## Modern Context
How we use or have superseded this technology today

## Lost Knowledge
If applicable, what we no longer know about this technology

## Sources & Further Reading
Academic sources and accessible explanations

## Implementation Notes
For someone trying to recreate this technology
```

## File Organization

### Directory Structure
```
tree/
├── definitions/           # YAML files organized by type
│   ├── material/         # Physical technologies
│   │   ├── prehistoric.yml
│   │   ├── ancient.yml
│   │   └── ...
│   ├── social/           # Organizational technologies
│   │   └── ...
│   └── knowledge/        # Information technologies
│       └── ...
├── technologies/         # Generated folders with symlinks
│   ├── fire-control/
│   │   ├── README.md
│   │   ├── prerequisites/ # Symlinks by type
│   │   │   ├── hard/
│   │   │   ├── soft/
│   │   │   └── catalyst/
│   │   └── metadata.yml
│   └── ...
└── NAVIGATION.md        # Guide to exploring the tree
```

### Naming Conventions
- Technology IDs: `lowercase-with-hyphens`
- No spaces or underscores
- Descriptive but concise
- Examples: `fire-control`, `writing-systems`, `steam-engine`

## Build Tools Usage

### Validation Workflow
```bash
# Before making changes
make validate    # Check current state

# After editing definitions
make schema     # Validate YAML structure
make build      # Generate folders
make links      # Create symlinks
make check      # Verify prerequisites

# Before committing
make test       # Run all validations
make graph      # Visualize changes
```

### Tool Descriptions

**schema.js**: Validates YAML against technology schema
- Checks required fields
- Validates dependency references
- Ensures historical accuracy

**builder.js**: Generates folder structure from definitions
- Creates technology directories
- Generates README templates
- Copies metadata

**validator.js**: Checks README completeness
- Verifies all sections present
- Checks for placeholder text
- Validates cross-references

**grapher.js**: Creates dependency visualizations
- Generates DOT files for GraphViz
- Shows different dependency types
- Highlights critical paths

**linker.js**: Manages symlink relationships
- Creates prerequisite symlinks
- Validates link targets exist
- Maintains link consistency

**analyzer.js**: Provides tree statistics
- Technology counts by era/type
- Dependency complexity metrics
- Missing prerequisite detection
- Alternative path analysis

## Quality Checklist

Before marking any technology complete:

### Historical Accuracy
- [ ] First occurrence is documented
- [ ] Key figures are credited
- [ ] Parallel inventions noted
- [ ] Sources are academic or primary

### Technical Completeness
- [ ] Prerequisites are necessary and sufficient
- [ ] Alternative paths reflect history
- [ ] Resources are accurately listed
- [ ] Implementation is explained

### Cultural Sensitivity
- [ ] Multiple cultural contributions acknowledged
- [ ] No value judgments about "advancement"
- [ ] Environmental factors considered
- [ ] Social context included

### Documentation Quality
- [ ] README has all required sections
- [ ] Description is clear to non-specialists
- [ ] Sources provided for claims
- [ ] Cross-references are accurate

### Structural Integrity
- [ ] YAML validates against schema
- [ ] Symlinks resolve correctly
- [ ] No circular dependencies
- [ ] Fits within Three-Layer Model

## Common Patterns to Recognize

### Technology Clusters
Groups that develop together:
- Agriculture → Property → Government
- Writing → Mathematics → Astronomy
- Steam → Railways → Telegraphs

### Convergent Evolution
Same solution found independently:
- Agriculture (12+ times)
- Writing (4+ times)
- Pyramids (3+ times)

### Revolutionary Combinations
Technologies that transform when combined:
- Printing + Paper = Knowledge Revolution
- Electricity + Magnetism = Generators
- Transistor + Boolean Logic = Computers

### Environmental Determinism
Geography shapes technology:
- Islands → Navigation
- Rivers → Irrigation
- Mountains → Terracing

## Pitfalls to Avoid

### Historical Inaccuracies
- Don't assume linear progression
- Avoid "great man" history
- Question Eurocentric narratives
- Verify claimed "firsts"

### Oversimplification
- Real development is messy
- Multiple factors contribute
- Unintended consequences matter
- Context is crucial

### Missing Connections
- Social factors enable technology
- Knowledge prerequisites matter
- Resource availability constrains
- Cultural acceptance varies

## Git Workflow

### Branch Strategy
- `main`: Stable, validated tree
- `design/[topic]`: Design discussions
- `era/[name]`: Adding technologies from specific era
- `type/[name]`: Adding specific technology type
- `fix/[issue]`: Corrections and improvements

### Commit Messages
```
Add [technology-name] to [type]/[era]
Link [technology] prerequisites (hard/soft/catalyst)
Document [technology] alternative paths
Fix [issue] in [technology]
Refactor [era] definitions for clarity
```

### Pull Request Template
```markdown
## Technology Additions
- List new technologies added

## Dependency Changes
- New prerequisites identified
- Alternative paths documented

## Historical Corrections
- Inaccuracies fixed
- Sources updated

## Validation Results
- [ ] Schema validation passes
- [ ] Prerequisites resolve
- [ ] No circular dependencies
- [ ] READMEs complete
```

## Testing Strategy

### Path Validation
Verify multiple valid paths:
1. Historical progression paths
2. Alternative civilization routes
3. Technology leapfrogging
4. Parallel development

### Completeness Testing
- All folders have valid READMEs
- All symlinks resolve
- No orphaned technologies
- All eras represented

### Balance Testing
- Multiple paths to modern tech
- No dominant strategies
- Interesting decision points
- Historical alternatives work

## Remember

We're documenting humanity's greatest achievement: the accumulated knowledge and ingenuity of thousands of generations. Every technology represents countless experiments, failures, and eventual breakthroughs. 

Treat each technology with respect for the human creativity it represents. This isn't just a data structure - it's a monument to human problem-solving.

**CRITICAL**: Always update TODO.md to track progress. Do NOT use the TodoWrite tool for project tasks - that's for separate work tracking. The project's canonical todo list is in TODO.md and must be kept current by editing that file directly.

When in doubt:
1. Check historical sources
2. Consider multiple perspectives
3. Document uncertainty
4. Show your work
5. Iterate based on feedback
6. **Update TODO.md with actual progress**

The tree will teach us as we build it.
- at times I will ask you to "reanchor" - this means to re-read CLAUDE.md, DESIGN.md, README.md, TODO.md so that you don't get lost or forget where you are