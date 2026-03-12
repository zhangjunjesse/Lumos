# User Experience Evaluation - Main Agent/Team/Task Module

**Evaluator:** UX Expert
**Date:** 2026-03-11
**Module:** Main Agent, Team Mode, Task Management

---

## Overall Score: 6.5/10

The Main Agent/Team/Task functionality demonstrates solid technical implementation but suffers from significant UX challenges that create friction in the user journey. The core concept is powerful, but execution needs refinement.

---

## Strengths

### 1. Clear Visual Hierarchy
- Status badges use consistent color coding (pending/running/done/failed)
- Card-based layouts provide good information grouping
- Typography hierarchy (titles, descriptions, metadata) is well-structured

### 2. Real-time Feedback
- Auto-polling (2s intervals) keeps status current during team runs
- Immediate visual updates when approval actions occur
- Loading states prevent user confusion during async operations

### 3. Comprehensive Information Architecture
- Task detail view provides complete context (goal, executor, progress, subtasks, outputs)
- Team workspace exposes internal state for debugging/monitoring
- Breadcrumb navigation (back to tasks/teams) helps orientation

### 4. Flexible Control
- Manual workspace editing allows intervention when automation fails
- Resume run capability provides recovery mechanism
- Publish summary gives explicit control over chat integration

---

## Critical Issues (Severity: High)

### 1. **Cognitive Overload - Concept Complexity**
**Problem:** Users must understand 4 overlapping concepts:
- Main Agent (conversational AI)
- Team Plan (proposed multi-agent workflow)
- Team Run (execution of approved plan)
- Task (user-facing work item)

**Impact:** New users face steep learning curve. Relationship between concepts unclear.

**Evidence:**
- `TeamModeBanner` shows "Team Mode is off" but doesn't explain what it does
- Task detail shows both "team" and "manual" sources without explaining difference
- Workspace panel exposes internal concepts (hierarchy, budget, phases) without context

**Recommendation:**
- Add onboarding flow explaining Main Agent → Team Plan → Team Run progression
- Provide contextual help tooltips on first use
- Simplify terminology (e.g., "Team Plan" → "Collaboration Plan")

### 2. **Approval Flow Friction**
**Problem:** Team plan approval requires multiple steps with unclear consequences:
1. Review plan in banner (collapsed by default)
2. Click "Review Plan" to expand
3. Read roles/tasks/risks
4. Choose "Stay in Main Agent" vs "Approve Team Plan"

**Impact:** Users may approve without understanding, or reject due to uncertainty.

**Evidence:**
- `TeamModeBanner.tsx` line 175: "Review Plan" button suggests optional action
- `TeamPlanCard.tsx` line 221: Approval note buried at bottom
- No preview of what happens after approval

**Recommendation:**
- Show plan summary inline (don't require expansion)
- Add "What happens next?" section before approval buttons
- Provide "Approve with changes" option for iteration

### 3. **Error Recovery Gaps**
**Problem:** When team runs fail or block, recovery path unclear:
- Blocked reason shown but no suggested actions
- "Resume Run" button appears but doesn't explain what it does
- Manual workspace editing requires technical knowledge

**Impact:** Users get stuck when automation fails, leading to frustration.

**Evidence:**
- `TeamWorkspacePanel.tsx` line 349: Errors shown in red box without guidance
- `task-detail-view.tsx` line 268: "No outputs" message doesn't explain why
- No "Cancel team run" or "Return to main agent" escape hatch

**Recommendation:**
- Add contextual help for each error type
- Provide "Troubleshoot" button with common fixes
- Allow easy fallback to main agent mode

---

## Moderate Issues (Severity: Medium)

### 4. **Navigation Confusion**
**Problem:** Multiple entry points to same information:
- Task hub (`/tasks`) vs Team hub (`/team`)
- Task detail vs Team detail (both show similar info)
- Banner links vs sidebar navigation

**Impact:** Users unsure which view to use, leading to redundant clicks.

**Recommendation:**
- Merge task/team hubs into unified "Work" view with tabs
- Consolidate task/team detail into single view with mode toggle
- Add breadcrumb showing current location in hierarchy

### 5. **Status Ambiguity**
**Problem:** Status labels lack context:
- "Waiting" vs "Blocked" distinction unclear
- "Ready" vs "Pending" difference not obvious
- "Done" doesn't indicate success/failure of work

**Impact:** Users can't assess progress without reading full details.

**Recommendation:**
- Add status descriptions on hover
- Use icons alongside text (⏸️ waiting, 🚫 blocked, ✅ done)
- Show substatus (e.g., "Waiting: dependency not ready")

### 6. **Workspace Complexity**
**Problem:** Team workspace exposes too many technical details:
- Budget (workers/retries/minutes) requires understanding of internals
- Hierarchy guardrails (main_agent → orchestrator → lead → worker) is implementation detail
- Phase status dropdown allows invalid state transitions

**Impact:** Non-technical users intimidated, risk of breaking runs.

**Recommendation:**
- Hide advanced controls behind "Advanced" toggle
- Add validation to prevent invalid status changes
- Provide "Simple view" showing only progress and outputs

---

## Minor Issues (Severity: Low)

### 7. **Inconsistent Terminology**
- "Team Plan" vs "Team Run" vs "Team Task" used interchangeably
- "Phase" vs "Stage" vs "Subtask" refer to similar concepts
- "Executor" vs "Owner" vs "Agent" for role assignment

**Recommendation:** Create glossary and enforce consistent terms across UI.

### 8. **Visual Density**
- Task detail page shows 5+ cards stacked vertically
- Team workspace has 10+ input fields on one screen
- Banner can expand to 50% of viewport height

**Recommendation:** Use progressive disclosure, show summary first with "Show more" links.

### 9. **Polling Performance**
- 2-second polling interval may cause unnecessary load
- No indication that auto-refresh is happening
- Polling continues even when tab not visible

**Recommendation:** Use WebSocket for real-time updates, or increase interval to 5s with manual refresh button.

---

## User Journey Analysis

### Journey 1: First-time Team Plan Creation
**Steps:**
1. User asks Main Agent complex question
2. Agent proposes team plan (appears in banner)
3. User clicks "Review Plan" to expand
4. User reads roles/tasks (10+ items)
5. User clicks "Approve Team Plan"
6. Team run starts (status changes to "running")
7. User waits for completion (no ETA shown)

**Pain Points:**
- No explanation of why team mode was triggered
- Plan review requires scrolling through dense information
- No way to estimate completion time
- User unsure if they should wait or continue chatting

**Satisfaction:** 4/10

### Journey 2: Monitoring Team Run Progress
**Steps:**
1. User opens task detail from banner link
2. User sees status badge and progress (3/5 complete)
3. User clicks "Show Workspace" to see details
4. User sees phase results updating in real-time
5. User waits for "done" status

**Pain Points:**
- No notifications when status changes
- Progress percentage not shown (only count)
- Can't see what each phase is doing in real-time
- No way to pause or cancel run

**Satisfaction:** 5/10

### Journey 3: Recovering from Failed Team Run
**Steps:**
1. User sees "failed" status in banner
2. User clicks "Open Task" to investigate
3. User sees error message in outputs section
4. User opens workspace to check phase results
5. User manually edits phase status to "pending"
6. User clicks "Resume Run"
7. Run restarts from failed phase

**Pain Points:**
- Error messages too technical (stack traces)
- No guided recovery wizard
- Manual editing risky (can break run)
- Unclear if resume will retry or skip failed phase

**Satisfaction:** 3/10

---

## Emotional Experience Assessment

### Positive Emotions
- **Curiosity:** Team plan proposal feels like AI collaboration
- **Control:** Manual workspace editing provides safety net
- **Accomplishment:** Seeing "done" status after complex work

### Negative Emotions
- **Confusion:** Too many concepts to learn upfront
- **Anxiety:** Approval feels high-stakes without preview
- **Frustration:** Errors block progress without clear recovery
- **Overwhelm:** Workspace panel has too many fields

**Net Emotional Score:** -1 (slightly negative)

---

## Recommendations by Priority

### P0 (Must Fix)
1. **Add onboarding tutorial** - 5-step walkthrough explaining Main Agent → Team Mode flow
2. **Simplify approval UI** - Show plan summary inline, add "What happens next?" section
3. **Improve error recovery** - Add contextual help and "Troubleshoot" button for each error type

### P1 (Should Fix)
4. **Consolidate navigation** - Merge task/team hubs into unified "Work" view
5. **Add status tooltips** - Explain what each status means on hover
6. **Hide advanced workspace controls** - Show simple view by default

### P2 (Nice to Have)
7. **Add progress indicators** - Show percentage and ETA for team runs
8. **Implement notifications** - Alert user when team run completes
9. **Provide plan templates** - Pre-built team structures for common tasks

---

## Conclusion

The Main Agent/Team/Task module has strong technical foundations but needs UX refinement to be accessible to non-technical users. The primary issues are cognitive overload (too many concepts), approval friction (unclear consequences), and poor error recovery (users get stuck).

**Key Insight:** The feature tries to expose too much internal complexity. Users don't need to understand team hierarchies, budget constraints, or phase dependencies - they just want their work done efficiently.

**Recommended Approach:** Implement progressive disclosure - show simple view by default (status, progress, outputs), hide advanced controls behind "Advanced" toggle. Add onboarding and contextual help to reduce learning curve.

With these improvements, the score could increase from 6.5/10 to 8.5/10.
