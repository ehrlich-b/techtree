# TechTree build system

NODE = node
DATA = data
ENGINE = engine
CLI = cli

.PHONY: help validate play harness lengnick lengnick2 clean

help:
	@echo "TechTree"
	@echo ""
	@echo "Targets:"
	@echo "  validate   Check data integrity (refs resolve, no tech cycles)."
	@echo "  play       Start the CLI play loop."
	@echo "  harness    Run the stability stress harness (5k ticks default)."
	@echo "  lengnick   Run the Lengnick baseline ABM (50k ticks default)."
	@echo "  clean      Remove save.json."

validate:
	@$(NODE) $(ENGINE)/schema.js $(DATA)

play:
	@$(NODE) $(CLI)/play.js $(DATA)

harness:
	@$(NODE) $(ENGINE)/harness.js $(ARGS)

lengnick:
	@$(NODE) $(ENGINE)/lengnick.js $(ARGS)

lengnick2:
	@$(NODE) $(ENGINE)/lengnick2.js $(ARGS)

clean:
	@rm -f save.json
