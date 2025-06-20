# Usage: `make t=some/sub/folder` - will:
# - read plan from `plans/some/sub/folder/plan.yaml`
# - generate spec to `specs/some/sub/folder/spec.yaml`
# - preserve logs to `logs/some/sub/folder/logs.txt`
# - generate readme to `docs/some/sub/folder/README.md`

.PHONY: roar
roar:
	mkdir -p logs/$(t)
	mkdir -p docs/$(t)
	printf "# \`$(t)\`\n\n[_⬅ Back to project_](../README.md)\n\n## Description\n\nTODO: provide description.\n\n## Files\n\n- [Plan](plan.yaml)\n- [Spec](spec.yaml)\n- [Logs](logs.txt)\n\n## Sources\n\nTODO: provide sources.\n\n- \`https://github.com\`\n" > docs/$(t)/README.md
	bun roar --plan plans/$(t)/plan.yaml --spec specs/$(t)/spec.yaml 2>&1 | tee logs/$(t)/logs.txt

.DEFAULT_GOAL := roar
