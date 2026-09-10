# Orchestration protocol v2

The current agent (normally Luna) owns the full state machine. Advisor and worker providers are configuration details, not orchestration roles.

## State

Maintain an internal record equivalent to:

```text
specDir
integrationHead
requirements[]
tasks[] = {
  executionId,
  specTaskIds[],
  summary,
  dependencies[],
  predictedWrites[],
  actualWrites[],
  state: pending | ready | active | review | blocked | done,
  blockerType,
  workerId,
  workerAdapter,
  worktree,
  resultArtifact,
  commit
}
advisor = {
  id,
  adapter,
  command
}
workers[] = {
  id,
  adapter,
  command,
  state: available | active | unavailable,
  taskId
}
decisions[] = {
  id,
  question,
  status,
  answer,
  affectedTasks[]
}
```

## Preflight state machine

```text
READ_SPEC
  -> LOAD_CONFIG
  -> LOCAL_REVIEW
  -> ADVISOR_PREFLIGHT
  -> RECONCILE
       -> optional ADVISOR_REBUTTAL
  -> DECISION_TRIAGE
       -> HUMAN_DECISION_GATE if needed
  -> BUILD_EXECUTION_DAG
  -> PRESENT_PLAN
  -> WAIT_FOR_APPROVAL
```

No write-capable worker may run before approval.

## Execution state machine

```text
APPROVED
  -> SCHEDULE_READY
  -> ACTIVE_RUNS
  -> REVIEW_FINISHED_AS_THEY_ARRIVE
       -> REWORK_SAME_TASK
       -> BLOCK_AFFECTED_TASKS
       -> LAND_VERIFIED_TASK
  -> UPDATE_DAG
  -> SCHEDULE_READY
  -> ...
  -> INTEGRATED_GATES
  -> LUNA_CANDIDATE_COMPLETION_AUDIT
  -> ADVISOR_FINAL_CERTIFICATION
       -> COMPLIANT -> DONE
       -> GAPS_FOUND -> VALIDATE_GAPS -> FIX_GAPS -> INTEGRATED_GATES -> ADVISOR_FINAL_CERTIFICATION
```

## DAG and collision model

Do not blindly trust SpecKit `[P]` markers. Derive dependencies from semantics and repository structure.

Strong dependency signals:

- schema/migration before consumers;
- shared contract before independent consumers;
- API before UI integration that consumes it;
- generated client after source schema;
- backfill before constraints that reject legacy rows;
- implementation before integration/e2e tests.

High-risk shared resources:

- migrations/schema directories;
- manifests and lockfiles;
- route/module registries;
- generated clients/types;
- root config;
- shared-domain types;
- central fixtures;
- files already touched by active workers.

If two ready tasks likely write the same hotspot, serialize the shared foundation first, then fan out.

## Worktrees

Default to one disposable worktree per active execution unit from current integration HEAD. The orchestrator creates/removes worktrees and commits/cherry-picks only after review. Workers must not perform Git integration.

If the primary checkout contains user-owned dirty state, do not stash/reset/commit it without authorization.

## Dynamic scheduling

```text
safeConcurrency = min(configured limit, enabled available workers, collision-free ready tasks)
```

A free worker is not tied to its previous subsystem or provider. Choose the next task by:

1. critical-path unblocking;
2. collision risk;
3. already-landed foundations;
4. task size/reviewability;
5. worker capability only when profiles materially differ.

Do not split tightly coupled work merely to keep every account busy.

## Provider failure

If a worker command is unavailable, times out, exhausts quota, or fails:

- mark that worker unavailable for the current run;
- inspect partial work before reuse;
- return the task to ready/blocked state as appropriate;
- reassign to any compatible available worker, even from a different adapter.

If the **advisor** is unavailable, preflight/final certification cannot be completed. You may still explain the configuration issue, but do not fabricate advisor approval or declare `DONE`.

## Blockers

When a worker/advisor reports a blocker, inspect it yourself.

- Technical/reversible -> decide and continue.
- Dependency not landed -> block that node and give the worker other ready work.
- Human decision -> pause affected subgraph only and ask the human.
- Provider/account failure -> reschedule capacity.

Human decision card:

```text
BLOCKER — USER DECISION REQUIRED
Issue: ...
Why it matters: ...
Options: A / B / C
Advisor recommends: ...
I recommend: ...
Blocks: ...
Can continue meanwhile: ...
Decision needed: ...
```

## Final certification loop

Map each original requirement to evidence:

```text
Requirement -> implementation -> tests/gates -> status
```

When locally clean, state is `candidate-complete`, never `done`.

```text
LUNA_CANDIDATE_COMPLETE
  -> ADVISOR_FINAL_CERTIFICATION
       -> COMPLIANT -> LUNA_SANITY_CHECK -> DONE
       -> GAPS_FOUND -> VALIDATE
            -> real gap -> FIX -> GATES -> ADVISOR_FINAL_CERTIFICATION
            -> human decision -> ask human / keep unaffected work moving
            -> false positive -> focused advisor rebuttal -> ADVISOR_FINAL_CERTIFICATION
```

Every repository change after a final audit invalidates it. Re-run the configured advisor on the new integrated HEAD.
