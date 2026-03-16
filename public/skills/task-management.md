---
name: task-management
description: Create and manage complex tasks through the Task Management system
trigger: When user requests a complex task that requires multi-step execution, resource coordination, or extended time
---

# Task Management Skill

**IMPORTANT: You MUST use the task-management MCP tools (createTask, listTasks, getTaskDetail, cancelTask) for complex tasks. Do NOT attempt to implement complex tasks directly.**

## Purpose

This skill enables the Main Agent to delegate complex tasks to the Task Management system. Use this when:
- Task requires multiple steps or phases
- Task needs resource coordination (multiple agents, external services)
- Task will take extended time (>2 minutes)
- Task complexity exceeds Main Agent's direct handling capability

## Decision Criteria

**MUST Create Task When:**
- User requests implementing a complete system/feature (e.g., "实现用户管理系统")
- Task involves multiple file modifications across different modules
- Task requires external API integration or data processing
- Task needs background execution while user continues other work
- User says "帮我实现", "帮我开发", "帮我构建" followed by a complex feature

**Handle Directly When:**
- Simple question answering
- Single file read/edit
- Quick information lookup
- Immediate response expected

## Usage

### Create Task

Use the `createTask` tool to create a new task:

```
createTask({
  taskSummary: "Implement user authentication with JWT",
  requirements: [
    "Add JWT token generation on login",
    "Create middleware for token validation",
    "Add protected route examples",
    "Write unit tests for auth flow"
  ],
  sessionId: "<current_session_id>"
})
```

**IMPORTANT**:
- `taskSummary` must be third-person description (e.g., "Implement X", not "Help me implement X")
- `requirements` should be specific, actionable items
- Do NOT include raw conversation history - only summarized requirements

### Query Tasks

Use the `listTasks` tool to check task status:

```
listTasks({
  sessionId: "<session_id>",
  status: ["running", "pending"]
})
```

Use the `getTaskDetail` tool to get task details:

```
getTaskDetail({
  taskId: "<task_id>"
})
```

### Cancel Task

Use the `cancelTask` tool if user requests cancellation:

```
cancelTask({
  taskId: "<task_id>",
  reason: "User requested cancellation"
})
```

## Task Completion Notification

When a task completes, you will receive a notification in the chat. Generate a user-friendly message like:

```
✅ Task completed: [Task Summary]

Results:
- [Key achievement 1]
- [Key achievement 2]

You can view details at /tasks/<task_id>
```

## Validation

The system will reject tasks with:
- First-person descriptions ("帮我", "我想")
- Missing requirements
- Invalid session context

## Example Flow

**User**: "Help me build a complete user management system with CRUD operations, authentication, and role-based access control"

**Your Decision**: This is complex → Create task

**Your Response**:
```
I'll create a task for this complex feature. This involves multiple components:
- Database schema design
- API endpoints (CRUD + auth)
- Authentication middleware
- Role-based authorization
- Frontend integration
- Testing

Creating task...
```

Then call API and confirm:
```
✅ Task created (ID: task_xxx)

The Scheduling Layer will coordinate the implementation. I'll notify you when it's complete.

You can check progress at /tasks/task_xxx
```
