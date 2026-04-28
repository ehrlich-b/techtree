# TechTree build system

NODE        = node
DEFINITIONS = tree/definitions
TOOLS       = build_tools

.PHONY: help validate graph report all clean

help:
	@echo "TechTree"
	@echo ""
	@echo "Targets:"
	@echo "  validate   Schema check; cycle detection; confidence rollup."
	@echo "  graph      Render dependencies.{dot,svg} (requires GraphViz)."
	@echo "  report     Confidence-banded view of the future window."
	@echo "  all        validate + graph + report."
	@echo "  clean      Remove generated graph artifacts."

validate:
	@$(NODE) $(TOOLS)/schema.js $(DEFINITIONS)

graph:
	@$(NODE) $(TOOLS)/grapher.js $(DEFINITIONS) dependencies.dot
	@if command -v dot >/dev/null 2>&1; then \
		dot -Tsvg dependencies.dot -o dependencies.svg; \
		echo "Wrote dependencies.svg"; \
	else \
		echo "GraphViz not installed (brew install graphviz); kept dependencies.dot only"; \
	fi

report:
	@$(NODE) $(TOOLS)/report.js $(DEFINITIONS)

all: validate graph report

clean:
	@rm -f dependencies.dot dependencies.svg
