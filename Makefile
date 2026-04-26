# TechTree Build System
# JavaScript tools for managing the technology dependency graph

# Default paths
DEFINITIONS = tree/definitions
TECHNOLOGIES = tree/technologies
BUILD_TOOLS = build_tools

# Node.js executable
NODE = node

.PHONY: help validate build check graph analyze clean test all

# Show available targets
help:
	@echo "TechTree Build System"
	@echo ""
	@echo "Available targets:"
	@echo "  validate    - Validate YAML definitions against schema"
	@echo "  build       - Generate technology folders with embedded prerequisites"
	@echo "  check       - Validate README completeness"
	@echo "  graph       - Generate dependency visualization (requires GraphViz)"
	@echo "  analyze     - Show tree statistics and metrics"
	@echo "  test        - Run all validations"
	@echo "  clean       - Remove generated files"
	@echo "  clean-metadata - Remove metadata.yml files (architectural fix)"
	@echo "  all         - Complete build: validate → build → check"
	@echo ""
	@echo "Options:"
	@echo "  DEFINITIONS=path  - Path to definitions directory (default: tree/definitions)"
	@echo "  TECHNOLOGIES=path - Path to technologies directory (default: tree/technologies)"
	@echo ""
	@echo "Examples:"
	@echo "  make build                    # Build from default definitions"
	@echo "  make all                      # Complete build with validation"
	@echo "  make validate DEFINITIONS=my.yml  # Validate custom file"
	@echo "  make build --force           # Force rebuild all READMEs"

# Validate YAML definitions
validate:
	@echo "🔍 Validating technology definitions..."
	@$(NODE) $(BUILD_TOOLS)/schema.js $(DEFINITIONS)

# Generate technology folders and READMEs
build:
	@echo "🏗️  Building technology tree..."
	@$(NODE) $(BUILD_TOOLS)/builder.js $(DEFINITIONS) $(TECHNOLOGIES)

# Force rebuild all READMEs
rebuild:
	@echo "🏗️  Force rebuilding all technology READMEs..."
	@$(NODE) $(BUILD_TOOLS)/builder.js $(DEFINITIONS) $(TECHNOLOGIES) --force

# Validate README completeness
check:
	@echo "📋 Checking README completeness..."
	@$(NODE) $(BUILD_TOOLS)/validator.js $(TECHNOLOGIES)

# Generate dependency graph (requires grapher.js)
graph:
	@if [ -f $(BUILD_TOOLS)/grapher.js ]; then \
		echo "📊 Generating dependency graph..."; \
		$(NODE) $(BUILD_TOOLS)/grapher.js $(DEFINITIONS) dependencies.dot; \
		if command -v dot >/dev/null 2>&1; then \
			dot -Tsvg dependencies.dot -o dependencies.svg; \
			echo "📈 Graph saved as dependencies.svg"; \
		else \
			echo "⚠️  GraphViz not installed - saved as dependencies.dot"; \
		fi \
	else \
		echo "❌ grapher.js not implemented yet"; \
		exit 1; \
	fi


# Show tree statistics (requires analyzer.js)
analyze:
	@if [ -f $(BUILD_TOOLS)/analyzer.js ]; then \
		echo "📊 Analyzing technology tree..."; \
		$(NODE) $(BUILD_TOOLS)/analyzer.js $(DEFINITIONS) $(TECHNOLOGIES); \
	else \
		echo "❌ analyzer.js not implemented yet"; \
		exit 1; \
	fi

# Confidence-aware future-tree report (v2)
report:
	@$(NODE) $(BUILD_TOOLS)/report.js $(DEFINITIONS)

# Run all validations
test: validate check
	@echo "✅ All validations passed!"

# Complete build pipeline
all: validate build check
	@echo "🎉 Complete build successful!"

# Clean generated files
clean:
	@echo "🧹 Cleaning generated files..."
	@if [ -d $(TECHNOLOGIES) ]; then \
		echo "Removing $(TECHNOLOGIES)..."; \
		rm -rf $(TECHNOLOGIES); \
	fi
	@if [ -f tree/NAVIGATION.md ]; then \
		echo "Removing tree/NAVIGATION.md..."; \
		rm -f tree/NAVIGATION.md; \
	fi
	@if [ -f dependencies.dot ]; then rm -f dependencies.dot; fi
	@if [ -f dependencies.svg ]; then rm -f dependencies.svg; fi
	@echo "🧹 Clean complete"

# Clean metadata files (architectural error fix)
clean-metadata:
	@echo "🧹 Removing metadata.yml files from technologies directories..."
	@if [ -d $(TECHNOLOGIES) ]; then \
		find $(TECHNOLOGIES) -name "metadata.yml" -type f -delete; \
		echo "✅ Removed all metadata.yml files"; \
	else \
		echo "⚠️  No technologies directory found"; \
	fi

# Development targets
dev-validate:
	@echo "🔄 Watching definitions for changes..."
	@if command -v fswatch >/dev/null 2>&1; then \
		fswatch -o $(DEFINITIONS) | xargs -n1 -I{} make validate; \
	else \
		echo "❌ fswatch not installed - install with: brew install fswatch"; \
	fi

# Show project status
status:
	@echo "📊 TechTree Project Status"
	@echo "========================"
	@echo "Definitions: $(DEFINITIONS)"
	@echo "Technologies: $(TECHNOLOGIES)"
	@echo ""
	@if [ -d $(DEFINITIONS) ]; then \
		def_count=$$(find $(DEFINITIONS) -name "*.yml" | wc -l | xargs); \
		echo "✅ Definitions directory exists ($$def_count YAML files)"; \
	else \
		echo "❌ Definitions directory missing"; \
	fi
	@if [ -d $(TECHNOLOGIES) ]; then \
		tech_count=$$(find $(TECHNOLOGIES) -maxdepth 1 -type d | wc -l | xargs); \
		tech_count=$$((tech_count - 1)); \
		echo "✅ Technologies directory exists ($$tech_count technologies)"; \
	else \
		echo "❌ Technologies directory missing"; \
	fi
	@echo ""
	@echo "Available tools:"
	@for tool in schema.js builder.js validator.js grapher.js analyzer.js; do \
		if [ -f $(BUILD_TOOLS)/$$tool ]; then \
			echo "  ✅ $$tool"; \
		else \
			echo "  ❌ $$tool"; \
		fi \
	done

# Install development dependencies (if needed)
install-deps:
	@echo "📦 Checking development dependencies..."
	@if ! command -v dot >/dev/null 2>&1; then \
		echo "⚠️  GraphViz not found - install with: brew install graphviz"; \
	else \
		echo "✅ GraphViz installed"; \
	fi
	@if ! command -v fswatch >/dev/null 2>&1; then \
		echo "⚠️  fswatch not found - install with: brew install fswatch"; \
	else \
		echo "✅ fswatch installed"; \
	fi