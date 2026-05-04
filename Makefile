# TechTree build system

NODE = node
DATA = data
ENGINE = engine
CLI = cli

.PHONY: help validate play clean

help:
	@echo "TechTree"
	@echo ""
	@echo "Targets:"
	@echo "  validate   Check data integrity (refs resolve, no tech cycles)."
	@echo "  play       Start the CLI play loop."
	@echo "  clean      Remove save.json."

validate:
	@$(NODE) $(ENGINE)/schema.js $(DATA)

play:
	@$(NODE) $(CLI)/play.js $(DATA)

clean:
	@rm -f save.json
