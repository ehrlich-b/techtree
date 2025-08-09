# TechTree: Modeling Human Innovation as a Graph

## What This Is

TechTree maps humanity's technological journey as a directed acyclic graph (DAG), implemented through git's filesystem and symlinks. Each technology lives in its own folder with comprehensive documentation about how it emerged, what it required, and what it enabled.

This is fundamentally an exploration of human ingenuity - how we progressed from controlling fire to contemplating quantum computers. It's designed to be historically accurate, anthropologically informed, and intellectually engaging.

## Core Philosophy: The Three-Layer Model

### Layer 1: Material Technologies
Physical, reproducible methods for manipulating the world:
- Tools, machines, processes, materials
- Can be built, demonstrated, and replicated
- Examples: fire control, metallurgy, electronics

### Layer 2: Social Technologies
Organizational methods that coordinate human effort:
- Governance, markets, education systems
- Emerge from group dynamics
- Enable and accelerate material progress

### Layer 3: Knowledge Technologies
Abstract systems for understanding and recording:
- Mathematics, writing, scientific method
- Pure information that can be transmitted
- Foundation for entire branches of innovation

## Project Structure

```
techtree/
├── README.md           # This file
├── DESIGN.md          # Core design philosophy & taxonomy
├── CLAUDE.md          # AI assistant working conventions
├── TODO.md            # Implementation roadmap
├── Makefile           # Build and validation orchestration
├── build_tools/       # JavaScript tooling (no npm dependencies)
│   ├── validator.js   # Validates technology documentation
│   ├── builder.js     # Generates folder structure from YAML
│   ├── grapher.js     # Visualizes dependency networks
│   └── linker.js      # Manages prerequisite symlinks
└── tree/              # The technology tree itself
    ├── NAVIGATION.md  # Guide to exploring the tree
    ├── definitions/   # YAML definitions by era
    └── technologies/  # Technology folders with symlinks

```

## How Technologies Connect

### Dependency Types
- **Hard Prerequisites**: Absolutely required (steel needs iron)
- **Soft Prerequisites**: Helpful but not essential (telegraph helps railways)
- **Catalysts**: Accelerate development (mathematics speeds engineering)
- **Synergies**: Combine for greater effect (printing + universities = knowledge explosion)

### Development Patterns
- **Convergent**: Same technology discovered independently (agriculture: 12+ times)
- **Divergent**: Different solutions to same problem (navigation: stars vs instruments)
- **Parallel**: Simultaneous advancement (Darwin & Wallace on evolution)
- **Leapfrog**: Skipping stages (mobile phones without landlines)

## Historical Eras & Key Transitions

### Prehistoric (~3.3 million - 3000 BCE)
**Foundation Technologies**: Tool-making, fire control, language, agriculture
**Transition Marker**: Development of writing systems

### Ancient (3000 BCE - 500 CE)
**Breakthroughs**: Writing, mathematics, metallurgy, philosophy
**Transition Marker**: Collapse of classical civilizations

### Medieval (500 - 1450 CE)
**Innovations**: Optics, mechanical clocks, gunpowder, universities
**Transition Marker**: Printing press revolutionizes knowledge

### Early Modern (1450 - 1750)
**Developments**: Scientific method, global navigation, banking
**Transition Marker**: Steam engine enables industrialization

### Industrial (1750 - 1950)
**Transformations**: Electricity, telecommunications, mass production
**Transition Marker**: Electronic computation

### Information Age (1950 - 2000)
**Revolutions**: Transistors, computers, internet, biotechnology
**Transition Marker**: Ubiquitous connectivity

### Contemporary (2000 - present)
**Emerging**: AI, quantum computing, gene editing, renewable energy
**Next Transition**: Unknown - perhaps AGI or fusion power?

### Speculative Future
**Possibilities**: Fusion energy, brain-computer interfaces, nanotechnology
**Wild Cards**: Technologies we can't yet imagine

## Design Principles

### Anthropological Grounding
- Respect for diverse innovation paths
- No "primitive" vs "advanced" hierarchy
- Cultural context shapes technology adoption
- Environment influences development

### Historical Accuracy
- Based on archaeological and historical evidence
- Multiple invention points for key technologies
- Acknowledgment of lost technologies
- Recognition of all civilizations' contributions

### Systemic Thinking
- Technologies exist in clusters
- Social structures enable technical progress
- Unintended consequences shape history
- Network effects amplify certain innovations

### Educational Value
- Clear cause-and-effect relationships
- Encourages further research
- Challenges linear progress narratives
- Highlights human creativity

## Build System

Core tools (JavaScript, no dependencies):
- `make validate` - Check documentation completeness
- `make build` - Generate structure from YAML definitions
- `make graph` - Visualize the dependency network
- `make check` - Verify all symlinks and prerequisites
- `make stats` - Analyze tree complexity and coverage

## Working with the Tree

### Exploring
1. Start with `tree/NAVIGATION.md` for orientation
2. Follow symlinks to trace dependencies
3. Use `make graph` to visualize connections
4. Read individual technology READMEs for deep dives

### Contributing
1. Understand the Three-Layer Model (see DESIGN.md)
2. Check existing definitions in `tree/definitions/`
3. Add new technologies via YAML first
4. Ensure multiple prerequisite paths where historically accurate
5. Document thoroughly with sources

### Quality Standards
- Every technology must have real historical basis
- Prerequisites must be technically necessary
- Alternative paths should reflect actual history
- Documentation should inspire further learning

## Project Goals

1. **Create an accurate model** of human technological development
2. **Reveal non-obvious connections** between innovations
3. **Celebrate diverse contributions** to human progress
4. **Inspire curiosity** about how we got here
5. **Provide a framework** for thinking about future development

## Philosophical Notes

This project operates on several key assumptions:
- Technology is not inherently progressive (newer isn't always better)
- Multiple valid solutions exist for most problems
- Social and material technologies co-evolve
- Knowledge can be lost and rediscovered
- The future will surprise us, just as the past would surprise our ancestors

## License

MIT License - Knowledge wants to be free.

## Acknowledgments

Standing on the shoulders of giants:
- James Burke's "Connections" for revealing hidden links
- Jared Diamond's work on geography and development
- Joseph Needham's documentation of Chinese science
- Indigenous knowledge keepers worldwide
- Every unnamed inventor whose ideas built our world
