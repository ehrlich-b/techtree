# DESIGN.md - Core Design Philosophy & Taxonomy

## The Fundamental Question: What is "Technology"?

### Technology vs Cultural Practice vs Knowledge

We need to carefully distinguish between:

1. **Technologies** - Reproducible methods for manipulating the physical world
   - Fire control, metallurgy, electronics
   - Has clear inputs/outputs and measurable effects
   - Can be taught through instruction
   - Often requires physical artifacts/tools

2. **Cultural Practices** - Social behaviors and organizational methods
   - Marriage, governance, trade systems
   - Emerges from group dynamics
   - Transmitted through participation
   - May enable technologies but aren't technologies themselves

3. **Knowledge Systems** - Abstract understanding and mental models
   - Mathematics, scientific method, philosophy
   - Pure information that can be recorded
   - Prerequisites for many technologies
   - Can exist without implementation

4. **Skills** - Individual capabilities developed through practice
   - Hunting, craftsmanship, navigation
   - Bridge between knowledge and technology
   - Required to implement technologies
   - Can be taught but must be practiced

## The Three-Layer Model

### Layer 1: Material Technologies (Core Tree)
The main tech tree focuses on physical, reproducible technologies:
- **Definition**: Can be built, demonstrated, and replicated
- **Examples**: Tools, machines, processes, materials
- **Prerequisites**: Other technologies + required knowledge
- **Unlocks**: New material capabilities

### Layer 2: Social Technologies (Enablers)
Social structures that enable material progress:
- **Definition**: Organizational methods that coordinate human effort
- **Examples**: Division of labor, markets, universities
- **Prerequisites**: Population density, communication, trust
- **Effects**: Multiply effectiveness of material technologies

### Layer 3: Knowledge Technologies (Foundations)
Abstract systems for understanding and manipulating information:
- **Definition**: Methods for thinking, reasoning, and recording
- **Examples**: Writing, mathematics, scientific method
- **Prerequisites**: Language, observation, logic
- **Effects**: Enable entire branches of material technology

## Anthropological Considerations

### Cultural Evolution Patterns

#### Convergent Development
Some technologies appear independently across cultures:
- Agriculture (12+ independent inventions)
- Writing (4+ independent systems)
- Metallurgy (3+ independent discoveries)
- **Design Implication**: These should have multiple prerequisite paths

#### Divergent Paths
Different cultures solve same problems differently:
- Navigation: Polynesian wayfinding vs European instruments
- Medicine: Traditional Chinese vs Greek humoral theory
- Architecture: Tensile structures vs compression structures
- **Design Implication**: Alternative tech branches with different strengths

#### Technology Packages
Technologies rarely develop in isolation:
- Agriculture → Sedentism → Property → Government
- Writing → Record keeping → Bureaucracy → Empire
- Steam → Railways → Urbanization → Labor movements
- **Design Implication**: Technology clusters with synergistic effects

### Environmental Determinism vs Agency

Technologies are shaped by:
1. **Geography**: Island cultures develop navigation
2. **Resources**: No iron? Skip to bronze or stay with obsidian
3. **Climate**: Cold regions develop preservation techniques
4. **Population**: High density drives sanitation innovation
5. **Conflict**: Military pressure accelerates certain branches

**Design Implication**: Starting conditions affect available paths

## Sociological Framework

### Technology Adoption Curves

#### Innovation Triggers
- **Necessity**: Population pressure, resource scarcity
- **Opportunity**: New resources, trade connections
- **Crisis**: War, disease, climate change
- **Curiosity**: Pure research, tinkering

#### Adoption Barriers
- **Cultural**: Conflicts with existing practices
- **Economic**: High switching costs
- **Political**: Threatens power structures
- **Practical**: Lacks supporting infrastructure

**Design Implication**: Technologies need "readiness" factors beyond prerequisites

### Network Effects

Some technologies become more valuable as adoption spreads:
- Standards (weights, measures, time)
- Communications (writing, telegraph, internet)
- Platforms (roads, railways, power grids)

**Design Implication**: Some techs should provide civilization-wide bonuses

### Technology Lifecycles

1. **Emergence**: Crude but functional
2. **Refinement**: Optimization and standardization
3. **Maturity**: Widespread adoption
4. **Obsolescence**: Replaced by superior alternative
5. **Legacy**: Influences descendant technologies

**Design Implication**: Technologies can have versions/upgrades

## Video Game Design Principles

### Player Decision Points

#### Meaningful Choices
Every technology decision should involve tradeoffs:
- **Time vs Benefit**: Rush to advanced tech or build foundation?
- **Breadth vs Depth**: Generalist or specialist civilization?
- **Risk vs Reward**: Proven path or experimental branch?
- **Short vs Long**: Immediate gains or future potential?

#### Strategic Archetypes
Support different playstyles:
1. **The Rusher**: Minimum prerequisites to advanced tech
2. **The Perfectionist**: Complete every technology
3. **The Specialist**: Deep focus on one branch
4. **The Innovator**: Find alternative paths
5. **The Trader**: Leverage others' technologies

### Progression Mechanics

#### Pacing Systems
- **Research Points**: Accumulate over time
- **Eureka Moments**: Discover through action
- **Technology Trading**: Learn from others
- **Reverse Engineering**: Deduce from artifacts
- **Parallel Discovery**: Multiple simultaneous researchers

#### Gating Mechanisms
- **Hard Gates**: Absolute prerequisites
- **Soft Gates**: Can bypass with penalty
- **Resource Gates**: Require specific materials
- **Knowledge Gates**: Need theoretical understanding
- **Cultural Gates**: Require social development

### Balance Considerations

#### No Dominant Strategy
- Multiple viable paths to victory
- Rock-paper-scissors dynamics
- Situational advantages
- Comeback mechanics

#### Interesting Tensions
- **Guns vs Butter**: Military vs civilian tech
- **Innovation vs Infrastructure**: New tech vs improving existing
- **Independence vs Trade**: Self-sufficiency vs specialization
- **Exploration vs Exploitation**: New branches vs current branch

## Implementation Strategy

### Technology Classification

#### Primary Categories
1. **Survival**: Food, shelter, clothing
2. **Production**: Tools, energy, materials
3. **Knowledge**: Recording, calculation, observation
4. **Movement**: Transportation, navigation, logistics
5. **Communication**: Language, signals, networks
6. **Conflict**: Weapons, defense, strategy
7. **Health**: Medicine, sanitation, nutrition
8. **Organization**: Governance, economics, education

#### Cross-Cutting Themes
- **Energy**: Human → Animal → Water → Steam → Electric → Nuclear
- **Information**: Oral → Written → Printed → Digital → Quantum
- **Materials**: Stone → Copper → Bronze → Iron → Steel → Silicon
- **Scale**: Individual → Family → Tribe → City → Nation → Global

### Dependency Types

#### Hard Dependencies (Required)
- Cannot proceed without these
- Example: Steel requires Iron Working

#### Soft Dependencies (Beneficial)
- Can proceed but with penalties
- Example: Railways work better with Telegraph

#### Catalyst Dependencies (Accelerators)
- Speed up development
- Example: Mathematics accelerates Engineering

#### Synergistic Dependencies (Multipliers)
- Combine for greater effect
- Example: Printing + University = Knowledge Explosion

### Technology Attributes

```yaml
technology:
  # Identity
  id: unique-identifier
  name: Display Name
  category: primary-category
  era: historical-period
  
  # Requirements
  prerequisites:
    hard: [required-tech-ids]
    soft: [beneficial-tech-ids]
    catalyst: [accelerator-tech-ids]
  
  # Resources & Constraints
  resources:
    required: [must-have-materials]
    optional: [nice-to-have-materials]
  
  knowledge:
    theories: [required-understanding]
    skills: [required-abilities]
  
  social:
    population: minimum-size
    organization: required-structures
    culture: compatible-values
  
  # Effects
  unlocks:
    technologies: [enabled-tech-ids]
    capabilities: [new-abilities]
    resources: [new-materials]
  
  modifiers:
    production: multiplier
    research: multiplier
    military: multiplier
    culture: multiplier
  
  # Gameplay
  cost:
    research: points-required
    resources: materials-consumed
    time: turns-to-complete
  
  complexity: low|medium|high|extreme
  
  # Flavor
  description: brief-explanation
  historical:
    period: when-developed
    location: where-developed
    figures: key-people
  
  gameplay:
    tips: strategic-advice
    counters: what-defeats-this
    synergies: works-well-with
```

## Edge Cases and Special Mechanics

### Lost Technologies
Some technologies can be lost and rediscovered:
- Greek Fire (formula lost)
- Roman Concrete (recipe lost)
- Damascus Steel (technique lost)

**Mechanic**: Technologies can decay without maintenance

### Parallel Evolution
Same problem, different solutions:
- Writing: Pictographic vs Alphabetic
- Numbers: Roman vs Arabic vs Binary
- Calendar: Lunar vs Solar vs Lunisolar

**Mechanic**: Mutually exclusive technology branches

### Technology Leaps
Sometimes civilizations skip stages:
- Japan: Feudal → Industrial in 50 years
- Africa: Skipping landlines for mobile
- China: Skipping credit cards for mobile payments

**Mechanic**: Can skip techs with higher costs

### Unintended Consequences
Technologies often enable unexpected developments:
- Printing → Protestant Reformation
- Internet → Social Media → Political upheaval
- Agriculture → Population growth → Warfare

**Mechanic**: Hidden technology triggers

## Cultural Sensitivity

### Avoiding Problematic Narratives

#### Tech Superiority
- No "primitive" vs "advanced" cultures
- Different doesn't mean inferior
- Context matters more than capability

#### Colonial Narratives
- Avoid "bringing civilization"
- Respect indigenous innovations
- Show multiple development paths

#### Determinism
- Technology doesn't determine culture
- Humans make choices about adoption
- Social factors matter as much as technical

### Inclusive Representation

#### Global Contributions
- Chinese: Gunpowder, printing, compass
- Islamic: Algebra, optics, medicine
- African: Metallurgy, architecture, navigation
- American: Agriculture, astronomy, mathematics
- European: Scientific method, industrialization
- Indian: Mathematics, metallurgy, textiles

#### Gender Inclusion
- Women's contributions often erased
- Domestic technologies undervalued
- Include social reproduction technologies

## Success Metrics

### Educational Value
- Historically accurate progressions
- Clear cause-and-effect relationships
- Multiple valid interpretations
- Encourages further research

### Gameplay Engagement
- Interesting decisions every turn
- Multiple viable strategies
- Surprising interactions
- Satisfying progression

### Replayability
- Different starting conditions
- Randomized elements
- Hidden content to discover
- Emergent narratives

### Accessibility
- Clear visual representation
- Intuitive prerequisites
- Helpful documentation
- Progressive complexity

## Open Questions

### Philosophical
1. Is language a technology or prerequisite for technology?
2. Where do we draw the line between tool use and technology?
3. How do we handle technologies with disputed origins?
4. Should magic/supernatural be included as "lost technology"?

### Practical
1. How granular should the tree be?
2. How do we handle regional variations?
3. Should we model technology diffusion?
4. How do we balance accuracy vs gameplay?

### Technical
1. How do we visualize complex dependencies?
2. Can players create custom technologies?
3. How do we handle version control for the tree?
4. Should we support modding?

## Design Principles Summary

1. **Respect Complexity**: Technology development is messy and non-linear
2. **Enable Agency**: Players should feel they're making meaningful choices
3. **Embrace Diversity**: Multiple paths reflect human creativity
4. **Maintain Accuracy**: Educational value requires factual grounding
5. **Encourage Exploration**: Hidden connections reward investigation
6. **Support Narratives**: Technologies tell stories about civilizations
7. **Balance Challenge**: Neither too easy nor impossibly complex
8. **Iterate Constantly**: The tree will need continuous refinement

## Next Steps

1. Define core technology list (100-150 essential nodes)
2. Map primary dependency chains
3. Identify branch points and convergences
4. Design special mechanics and edge cases
5. Create prototype for playtesting
6. Iterate based on feedback
7. Expand to full tree
8. Polish and balance
9. Document thoroughly
10. Release and maintain

## Remember

This is fundamentally about human ingenuity and adaptation. Every technology represents thousands of years of accumulated knowledge, countless failures, occasional breakthroughs, and the dreams of our ancestors made manifest. We're not just building a game - we're creating an interactive monument to human achievement.

The tree should inspire players to think: "How did we get here?" and "Where might we go next?"