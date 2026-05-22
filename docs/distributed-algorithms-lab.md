# Distributed Algorithms Lab

## North Star

Our North Star is to run, illustrate, validate, and explore the distributed algorithms in Nancy Lynch's _Distributed Algorithms_.

The app should make abstract executions concrete: learners can see process states, communication channels, timing assumptions, failures, recoveries, and validation checks as a distributed algorithm runs. The lab should support both guided study and adversarial exploration, so a learner can step through a clean run, choose a random run, or stress-test many executions to find safety failures, deadlocks, and no-progress states.

## MVP Scope

- Show node states, including process role, local variables, clock state, failure state, and recent local log entries.
- Show communication channels and channel states, including queued, delayed, dropped, duplicated, partitioned, and delivered messages.
- Support different topologies: ring, line, star, mesh, and tree in the first version.
- Support different execution synchronization patterns:
  - Synchronous rounds.
  - Asynchronous message delivery.
  - Hybrid scheduling.
  - Local clock support.
  - No-clock execution.
  - Clock skew and drift/error models.
- Support data synchronization patterns:
  - Message-passing channels.
  - Shared-memory/register views.
  - Hybrid channel plus shared-memory views.
- Support node failures:
  - Crash-stop.
  - Crash-recovery.
  - Omission failures.
  - A bounded Byzantine-lite/corruption mode for early validation work.
- Support recovery modes:
  - No recovery.
  - Restart from volatile state.
  - Stable storage.
  - State transfer from neighbors.
- Support channel failures:
  - Delay.
  - Drop.
  - Partition.
  - Duplicate.
- Support fast simulations of distributed algorithm runs to stress test and find failure modes:
  - Safety violations.
  - Agreement splits.
  - Deadlocks or quiescent no-progress states.
  - Stalled executions with messages still in flight.
- Support learner-controlled random runs.
- Support saved runs that can be replayed and visualized later.

## First Algorithms

- Flooding Broadcast: a source disseminates a value to all reachable nodes.
- Max Consensus: nodes repeatedly exchange their highest known identifier until reachable active nodes agree.
- Echo Convergecast: a root builds a spanning tree with probes, then gathers echo acknowledgements back to the root.

These are intentionally small seed algorithms. They exercise the same primitives needed for richer protocols: process state, channels, scheduling, faults, recovery, clocks, shared state, execution traces, and invariant checks.

## Validation Direction

The validator should grow from lightweight checks into explicit assertions tied to each algorithm:

- Safety: nothing bad happens, such as accepting corrupt state or deciding conflicting values.
- Liveness: something good eventually happens, such as all reachable nodes delivering or deciding.
- Agreement: active nodes that should converge do converge.
- Termination: the run reaches a legitimate quiescent state rather than a silent no-progress state.
- Progress: the run distinguishes legitimate completion from deadlock, blocked progress, and no-message/no-goal states.
- Timing assumptions: the selected clock and synchrony model match the algorithm's requirements.

## Implemented Interaction Notes

- The fourth app is available as Distributed Lab in the app switcher.
- Runs have a scrubber, play controls, and an event timeline for jumping to a specific execution point.
- Stress testing records completed, failed, stalled, safety, liveness, agreement, deadlock, and no-progress counts.
- Stress-test example seeds can be loaded directly into the current run for replay.

## Product Direction

The lab should eventually let a learner choose a theorem, protocol, or execution model from the book, run canonical examples, then mutate assumptions to see where proofs rely on synchrony, reliable channels, failure detectors, atomic registers, stable storage, or fairness.
