# Config Reference — bifrost

Explanatory context for `global/config.json`. Does not duplicate the values themselves.

---

## Feature Flags

Four sections configure four independent tools. None of them triggers another, and no skill or tool reads any of the four `enabled` flags: a tool runs when something invokes it, and runs the same with its flag set to `false`.

| Section | Read by | Keys it reads |
|---------|---------|---------------|
| `self_heal` | `tools/self_healer.ts` (suggests or applies the fix for one named pattern from `scripts/healer_patterns.json`) and `tools/healer_canary.ts` (promotes a pattern into `auto_patterns`, or demotes it) | `circuit_breaker_threshold` trips a pattern's circuit after that many consecutive failures. `auto_patterns` lists the patterns whose `--mode auto` is honored; any other pattern is downgraded to suggest. The mode itself comes from the `--mode` flag (default `suggest`), not from `mode`, and `max_auto_retries` and `patterns_file` are read by nothing. The canary's promotion gate also reads `min_successful_suggests`, `abort_window_days` and `circuit_open_hours` when set. Authentication patterns are never auto-applied. |
| `validation_gate` | `tools/validation_gate.ts`, which runs a repo's lint/typecheck/test commands and reports the results | `per_repo_commands` (a repo's commands, else `_default`, else commands discovered from marker files) and `timeout_seconds` per check. `run_on` and `skip_domains` are read by nothing. |
| `skill_activation` | `tools/skill_router.ts`, which `/stark-session start` calls for its briefing's skill suggestions | `max_suggestions` caps the list, `cooldown_hours` skips a skill used that recently, and `suppressed_skills` are never suggested. `suggest_after_review_rounds` is echoed in the output only. |
| `context_compaction` | `tools/context_compactor.ts`, which `/stark-session end` runs once to write a session checkpoint | `max_checkpoint_size_kb` caps the checkpoint and `include_file_summaries` adds file summaries to it. Nothing writes checkpoints on a timer, so `checkpoint_interval_minutes` is read by nothing. |

---

## Cost Thresholds

`cost.weekly_budget_usd`, `cost.daily_alert_usd`, `cost.hard_stop_usd` and `cost.track_rolling_7d` are config defaults only. `tools/stark_config_lib.ts` carries their default values, and no skill or tool reads them: crossing one sends no alert, stops no run and blocks no start.
