# Lumos Claude Memory Runtime

This document describes the memory system shipped in Lumos for Claude Agent SDK conversations.

## Goals

- Persist user memory instructions across sessions.
- Inject relevant memory into future prompts automatically.
- Keep user-level Claude config isolated by default.
- Allow optional project-level `CLAUDE.md` / `.claude/rules` loading.

## Runtime Flow

1. User sends a message in Lumos chat.
2. Lumos detects explicit memory intents (`记住...`, `always...`, `never...`, etc.).
3. Extracted memory is upserted into SQLite table `memories`.
4. For implicit memory, Lumos can trigger an LLM memory pipeline (Claude):
   - Trigger sources: session switch, post-reply idle timeout, weak emotion/confusion signals.
   - Stage A (`ShouldRemember`): decide if this turn should be remembered.
   - Stage B (`ExtractMemory`): output structured memory candidates.
   - Safety gates: confidence threshold, sensitive-content filter, dedupe, daily budget, cooldown.
5. During model execution, `UserPromptSubmit` hook fetches relevant memories and injects:
   - `<lumos_memory> ... </lumos_memory>`

## Storage

- DB table: `memories` (project/global/session scope, category, tags, usage stats)
- DB table: `memory_intelligence_events` (trigger/outcome/cost observability)

## Settings (General)

- `memory_system_enabled`
  - `true` (default): capture + inject memories
  - `false`: disable memory runtime
- `claude_project_settings_enabled`
  - `false` (default): SDK `settingSources = []` (isolation mode)
  - `true`: SDK `settingSources = ['project']` (load project `CLAUDE.md` and `.claude` rules/settings)
- Memory intelligence settings
  - `memory_intelligence_enabled`
  - `memory_intelligence_trigger_session_switch_enabled`
  - `memory_intelligence_trigger_idle_enabled`
  - `memory_intelligence_trigger_weak_signal_enabled`
  - `memory_intelligence_idle_timeout_ms`
  - `memory_intelligence_should_model`
  - `memory_intelligence_extract_model`
  - `memory_intelligence_should_prompt`
  - `memory_intelligence_extract_prompt`
  - `memory_intelligence_confidence_threshold`
  - `memory_intelligence_cooldown_seconds`
  - `memory_intelligence_daily_budget`
  - `memory_intelligence_max_items_per_run`
  - `memory_intelligence_window_messages`

## Security Notes

- User/global `~/.claude` config is still isolated.
- Enabling project settings means repo-local hooks/rules may execute commands.
- Keep this enabled only for trusted repositories.
