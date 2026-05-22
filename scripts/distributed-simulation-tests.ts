import assert from "node:assert/strict";
import { defaultDistributedRunConfig, generateDistributedRun, runDistributedStressTest } from "../src/frontend/components/distributed/simulation";
import type { DistributedAlgorithmId, DistributedRunConfig } from "../src/frontend/components/distributed/types";

const baseConfig: DistributedRunConfig = {
  ...defaultDistributedRunConfig(),
  topologyId: "ring",
  nodeFailureMode: "none",
  recoveryMode: "none",
  channelFailureMode: "none",
  dataPattern: "hybrid",
  seed: 1109
};

const algorithms: DistributedAlgorithmId[] = ["flooding-broadcast", "max-consensus", "echo-convergecast"];

for (const algorithmId of algorithms) {
  const run = generateDistributedRun({ ...baseConfig, algorithmId });
  assert.equal(run.result.status, "completed", `${algorithmId} should complete without injected faults`);
  assert.ok(run.frames.length > 1, `${algorithmId} should produce a multi-step trace`);
  assert.equal(run.result.deadlocks, 0, `${algorithmId} should not deadlock without injected faults`);
}

const partitionedEcho = generateDistributedRun({
  ...baseConfig,
  algorithmId: "echo-convergecast",
  topologyId: "ring",
  channelFailureMode: "partition",
  seed: 2203
});
assert.equal(partitionedEcho.result.status, "failed", "partitioned echo should fail validation");
assert.ok(partitionedEcho.result.deadlocks > 0, "partitioned echo should report no-progress/deadlock");

const corruptConsensus = findFailingByzantineConsensus();
assert.ok(corruptConsensus.result.safetyViolations > 0, "byzantine consensus sample should expose a safety violation");

const stress = runDistributedStressTest(
  {
    ...baseConfig,
    algorithmId: "echo-convergecast",
    topologyId: "ring",
    channelFailureMode: "drop",
    seed: 3301
  },
  12
);
assert.ok(stress.failed > 0, "lossy echo stress test should find failed runs");
assert.ok(stress.deadlocks > 0, "lossy echo stress test should count deadlocks");

console.log("Distributed simulation tests passed.");

function findFailingByzantineConsensus() {
  for (let offset = 0; offset < 40; offset += 1) {
    const run = generateDistributedRun({
      ...baseConfig,
      algorithmId: "max-consensus",
      nodeFailureMode: "byzantine-lite",
      seed: 4409 + offset
    });
    if (run.result.safetyViolations > 0) return run;
  }
  throw new Error("Expected to find a deterministic byzantine-lite safety violation sample.");
}
