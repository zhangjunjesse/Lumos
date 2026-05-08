# Lumos Memory v2: Action Memory MVP

Memory v2 treats memory as an action context system, not a chat-history store.

## Purpose

Lumos should remember only information that improves future work:

- What is the work: background, goal, state, decisions, risks, next steps.
- Who is involved: user identity, expectations, communication style, roles, responsibility.
- What resources are needed: accounts, login state, servers, files, permissions, key parameters.
- What capabilities exist or are missing: tools, MCPs, skills, agents, capability gaps.
- What was learned: failure causes, lessons, and next-time improvements.

Raw module data stays in its owning module. WeChat messages, Goofish chats, workflow logs, app files, and knowledge documents are data sources, not memory records by default.

## Memory Kinds

- `task`: task background, goal, current state, decisions, risks, next action.
- `people`: user/participant roles, expectations, communication preferences, responsibility boundaries.
- `resource`: resources needed to do work, such as login state, server, API, file, parameter, permission.
- `capability`: tools, MCPs, skills, agents, known capability gaps, acquisition notes.
- `reflection`: lessons, failure analysis, next-time improvements.

## Scope Model

Memory v2 is scoped by existing Lumos runtime boundaries:

- `user:default`: stable user collaboration context.
- `main_agent:main`: main-agent continuity that is not project-specific.
- `project:<working_directory>`: project/repo memory bound to a selected working directory.
- `session:<session_id>`: short-term continuity for one conversation.
- `module:<module>`: module-level behavior, such as workflow or wechat-assistant.
- `entity:<id>`: future extension for workflowId, appId, contactId, itemId, etc.

The runtime builds a memory pack from the current user/global scope, current module, current project path, and current session.

## Resource Safety

Resource memory may describe the existence and usage boundary of sensitive resources, but raw secrets must not be stored in ordinary memory.

If a user says something like `password: ...` or provides a token, the runtime automatically encrypts the value into the Memory v2 secret vault, redacts ordinary memory, and keeps only a `secret_ref` pointer such as `secret://memory-v2/...`.

If the user only says a credential will be needed but does not provide the value, the memory is marked `secret_ref_required`. That is a missing-resource signal for the execution path to ask for the credential when the task actually needs it.

## Current MVP

Implemented:

- SQLite tables: `memory_v2_entries`, `memory_v2_usage_log`.
- DAO/runtime for create, list, update, status changes, delete, scoped pack building, usage tracking.
- Explicit capture from chat when the user says "记住..." / "记录一下...".
- Main chat no longer writes or injects legacy `memories`; actual chat memory uses Memory v2.
- Runtime injection as `<lumos_action_memory_v2>`.
- Automatic encrypted storage for explicit sensitive resource values in `memory_v2_secret_values`; prompts and ordinary memory only receive `secret_ref`.
- Management UI at `/memory-v2`.
- Reflection report for duplicates, possible conflicts, missing Vault references, stale records, and pending candidates.
- Default `/memory-v2` UI is display-first; manual write/run controls live under the collapsed advanced/debug area.
- Daily sleep mode: enabled by default, configurable with auto-save, and creates a main-agent `reflection` memory plus sleep history.
- Daily sleep scans newly added user chat messages since the previous scan and automatically extracts high-confidence action memories.
- Daily sleep also scans capability/reflection memory and creates self-improvement candidates for the Capability Builder.

Not implemented yet:

- LLM-based semantic consolidation across long multi-turn conversations.
- Entity-specific integrations for every module, such as `workflow:<id>` or `goofish-item:<id>`.
- Automatic installation of evolved skills/capabilities without Capability Builder review.
