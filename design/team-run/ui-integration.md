# UI Integration Plan for Team Execution Engine

## Executive Summary

The UI layer is **70% complete** with well-structured components. Integration requires:
1. Connect existing UI to backend execution engine
2. Implement real-time state synchronization
3. Add missing interaction flows
4. Enhance error handling and feedback

---

## Current UI Assessment

### ✅ Completed Components

#### 1. **TeamTaskHub** (`src/components/conversations/team-task-hub.tsx`)
- **Status**: 90% complete, production-ready
- **Features**:
  - Task/Team/Agent catalog views with tabs
  - Create team from template
  - Create custom agent presets
  - Filter and search functionality
  - Polling for status updates (2s interval)
- **Missing**: Integration with actual execution engine APIs

#### 2. **TeamRunDetailView** (`src/components/conversations/team-run-detail-view.tsx`)
- **Status**: 85% complete
- **Features**:
  - Team overview with status badges
  - Role hierarchy display
  - Stage/artifact progress tracking
  - Output collection display
  - Workspace panel integration
  - Auto-polling when running (2s interval)
- **Missing**: Real-time WebSocket updates, error recovery UI

#### 3. **TeamPlanCard** (`src/components/chat/TeamPlanCard.tsx`)
- **Status**: 100% complete
- **Features**:
  - Plan visualization with roles/tasks/risks
  - Approval/rejection actions
  - Status badges and progress indicators
  - Dependency visualization
- **Ready**: No changes needed

#### 4. **TeamModeBanner** (`src/components/chat/TeamModeBanner.tsx`)
- **Status**: 95% complete
- **Features**:
  - Inline plan approval in chat
  - Recent team runs display
  - Quick navigation to tasks/teams
  - Auto-refresh on approval status change
- **Missing**: Better loading states

#### 5. **TeamWorkspacePanel** (`src/components/chat/TeamWorkspacePanel.tsx`)
- **Status**: 90% complete
- **Features**:
  - Phase result editing
  - Status management per phase
  - Context summary editing
  - Resume/publish actions
  - Budget and hierarchy display
- **Missing**: Optimistic updates, conflict resolution

### ⚠️ Partially Complete

#### 6. **Page Routes**
- `/tasks` - Wrapper only, delegates to TaskHubView ✅
- `/team` - Wrapper only, delegates to TeamHubView ✅
- `/main-agent` - Redirects to latest session ✅
- `/main-agent/[id]` - Not reviewed yet ⚠️

---

## State Management Architecture

### Current Approach: Polling + Local State
```typescript
// Pattern used across components
const [data, setData] = useState<T>();

useEffect(() => {
  const interval = setInterval(() => {
    fetch('/api/...').then(setData);
  }, 2000);
  return () => clearInterval(interval);
}, [shouldPoll]);
```

**Issues**:
- High API load (every 2s per component)
- Stale data between polls
- No optimistic updates
- Race conditions on concurrent edits

### Recommended: Hybrid Approach

```typescript
// 1. Server-Sent Events for real-time updates
const useTeamRunUpdates = (teamId: string) => {
  const [data, setData] = useState<TeamRun>();

  useEffect(() => {
    const eventSource = new EventSource(`/api/team-runs/${teamId}/stream`);
    eventSource.onmessage = (e) => setData(JSON.parse(e.data));
    return () => eventSource.close();
  }, [teamId]);

  return data;
};

// 2. Optimistic updates with SWR/React Query
const useUpdatePhase = () => {
  const { mutate } = useSWRConfig();

  return async (phaseId: string, updates: Partial<Phase>) => {
    // Optimistic update
    mutate(`/api/phases/${phaseId}`, (current) => ({
      ...current,
      ...updates
    }), false);

    // Actual API call
    await fetch(`/api/phases/${phaseId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });

    // Revalidate
    mutate(`/api/phases/${phaseId}`);
  };
};
```

---

## Real-Time Update Mechanism

### Option A: Server-Sent Events (Recommended)
**Pros**: Simple, built-in reconnection, one-way push
**Cons**: HTTP/1.1 connection limit (6 per domain)

```typescript
// Backend: src/app/api/team-runs/[id]/stream/route.ts
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const interval = setInterval(() => {
        const data = getTeamRunState(params.id);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }, 1000);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
```

### Option B: WebSocket
**Pros**: Bi-directional, lower latency
**Cons**: More complex, requires WS server setup

### Option C: Polling with Smart Intervals
**Pros**: Simple, works everywhere
**Cons**: Higher latency, more API calls

**Recommendation**: Start with SSE, fallback to polling if connection fails.

---

## User Interaction Flows

### Flow 1: Create Team from Template
```
[Team Hub] → Select Template → Fill Form → POST /api/tasks/team-templates
  ↓
[Backend] Creates TeamRun with status='pending'
  ↓
[UI] Redirects to /team/{teamId}
  ↓
[Detail View] Shows plan, waits for approval
  ↓
User clicks "Approve" → PATCH /api/tasks/{id} { approvalStatus: 'approved' }
  ↓
[Backend] Starts orchestrator
  ↓
[UI] Polls/streams status updates
```

**Missing**: Loading states between steps, error recovery

### Flow 2: Monitor Running Team
```
[Detail View] Subscribes to SSE /api/team-runs/{id}/stream
  ↓
[Backend] Pushes updates on:
  - Phase status change
  - Role assignment
  - Error occurrence
  - Completion
  ↓
[UI] Updates badges, progress bars, logs in real-time
```

**Missing**: Notification system for critical events

### Flow 3: Manual Intervention
```
[Workspace Panel] User edits phase result
  ↓
User clicks "Save Phase" → PATCH /api/tasks/{id} { phaseId, phaseStatus, phaseLatestResult }
  ↓
[Backend] Updates state, triggers dependency check
  ↓
[UI] Shows success toast, refreshes dependent phases
```

**Missing**: Conflict detection (if backend updated same phase)

---

## Component Modifications Needed

### 1. Add SSE Hook
**File**: `src/hooks/useTeamRunStream.ts` (NEW)
```typescript
export function useTeamRunStream(teamId: string | null) {
  const [data, setData] = useState<TeamRun | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!teamId) return;

    const eventSource = new EventSource(`/api/team-runs/${teamId}/stream`);

    eventSource.onmessage = (e) => {
      setData(JSON.parse(e.data));
      setError(null);
    };

    eventSource.onerror = () => {
      setError(new Error('Connection lost'));
      eventSource.close();
    };

    return () => eventSource.close();
  }, [teamId]);

  return { data, error };
}
```

### 2. Update TeamRunDetailView
**File**: `src/components/conversations/team-run-detail-view.tsx`
**Changes**:
- Replace polling with `useTeamRunStream`
- Add error boundary
- Add reconnection UI

```typescript
// Replace lines 86-114
const { data: liveData, error } = useTeamRunStream(team.id);

useEffect(() => {
  if (liveData) setTeamState(liveData);
}, [liveData]);

if (error) {
  return <ErrorBanner message={error.message} onRetry={reconnect} />;
}
```

### 3. Add Toast Notifications
**File**: `src/components/ui/toast.tsx` (use shadcn/ui)
**Usage**: Show success/error feedback for actions

### 4. Add Loading Skeletons
**File**: `src/components/ui/skeleton.tsx` (use shadcn/ui)
**Usage**: Show during initial load and transitions

### 5. Add Error Boundary
**File**: `src/components/error-boundary.tsx` (NEW)
```typescript
export class TeamRunErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
```

---

## API Integration Points

### Required Backend Endpoints

#### 1. Stream Team Run State
```
GET /api/team-runs/{id}/stream
Response: text/event-stream
```

#### 2. Update Phase
```
PATCH /api/team-runs/{id}/phases/{phaseId}
Body: { status, latestResult }
```

#### 3. Resume Team Run
```
POST /api/team-runs/{id}/resume
```

#### 4. Publish Summary
```
POST /api/team-runs/{id}/publish
Body: { summary }
```

### Existing Endpoints to Enhance

#### `/api/tasks/{id}` (PATCH)
**Current**: Updates task description (JSON blob)
**Needed**: Parse and validate team-plan structure, trigger orchestrator actions

#### `/api/tasks/catalog` (GET)
**Current**: Returns tasks/teams/agents
**Needed**: Add filtering, pagination, sorting

---

## Performance Optimizations

### 1. Lazy Load Detail Views
```typescript
const TeamRunDetailView = lazy(() => import('./team-run-detail-view'));

<Suspense fallback={<DetailSkeleton />}>
  <TeamRunDetailView team={team} />
</Suspense>
```

### 2. Virtualize Long Lists
Use `react-window` for task/team lists with >100 items

### 3. Debounce User Input
```typescript
const debouncedSave = useMemo(
  () => debounce((value) => savePhase(value), 500),
  []
);
```

### 4. Memoize Expensive Computations
```typescript
const sortedPhases = useMemo(
  () => phases.sort((a, b) => a.order - b.order),
  [phases]
);
```

---

## Testing Strategy

### Unit Tests
- Component rendering with mock data
- Hook behavior (SSE connection, reconnection)
- State transitions

### Integration Tests
- Full user flows (create → approve → monitor)
- API mocking with MSW
- Error scenarios

### E2E Tests (Playwright)
- Critical paths: template → team → completion
- Real-time updates
- Multi-tab synchronization

---

## Migration Plan

### Phase 1: Backend Integration (Week 1)
1. Implement SSE endpoint `/api/team-runs/{id}/stream`
2. Connect orchestrator to state updates
3. Add phase update endpoints
4. Test with existing UI (polling)

### Phase 2: Real-Time Updates (Week 2)
1. Create `useTeamRunStream` hook
2. Update TeamRunDetailView to use SSE
3. Add fallback to polling
4. Add reconnection logic

### Phase 3: UX Enhancements (Week 3)
1. Add toast notifications
2. Add loading skeletons
3. Add error boundaries
4. Implement optimistic updates

### Phase 4: Polish (Week 4)
1. Performance optimizations
2. Accessibility audit
3. Mobile responsiveness
4. Documentation

---

## Risk Mitigation

### Risk 1: SSE Connection Limits
**Mitigation**: Implement connection pooling, fallback to polling

### Risk 2: State Conflicts
**Mitigation**: Add version field, implement last-write-wins or merge strategy

### Risk 3: Large Payload Size
**Mitigation**: Send diffs instead of full state, compress with gzip

### Risk 4: Browser Compatibility
**Mitigation**: Polyfill EventSource for older browsers

---

## Accessibility Checklist

- [ ] Keyboard navigation for all actions
- [ ] ARIA labels for status badges
- [ ] Screen reader announcements for state changes
- [ ] Focus management on modal open/close
- [ ] Color contrast meets WCAG AA
- [ ] Loading states announced to screen readers

---

## Files to Create

1. `src/hooks/useTeamRunStream.ts` - SSE hook
2. `src/components/error-boundary.tsx` - Error boundary
3. `src/app/api/team-runs/[id]/stream/route.ts` - SSE endpoint
4. `src/app/api/team-runs/[id]/phases/[phaseId]/route.ts` - Phase update
5. `src/app/api/team-runs/[id]/resume/route.ts` - Resume endpoint
6. `src/app/api/team-runs/[id]/publish/route.ts` - Publish endpoint

## Files to Modify

1. `src/components/conversations/team-run-detail-view.tsx` - Replace polling with SSE
2. `src/components/chat/TeamWorkspacePanel.tsx` - Add optimistic updates
3. `src/components/conversations/team-task-hub.tsx` - Add error handling
4. `src/app/api/tasks/[id]/route.ts` - Enhance PATCH handler
5. `src/types/index.ts` - Add SSE event types

---

## Success Metrics

- Real-time latency < 500ms
- API calls reduced by 80% (from polling)
- Zero data loss on connection drop
- 100% keyboard accessible
- Mobile responsive on all screens

---

## Next Steps

1. Review this plan with backend team
2. Align on API contracts
3. Create detailed task breakdown
4. Assign ownership
5. Set up monitoring/logging
