export type DistributedAlgorithmId = "flooding-broadcast" | "max-consensus" | "echo-convergecast";

export type DistributedTopologyId = "ring" | "line" | "star" | "mesh" | "tree";

export type ExecutionSyncMode = "synchronous" | "asynchronous" | "hybrid";

export type ClockMode = "none" | "logical" | "physical-skew" | "drift";

export type DataSyncPattern = "channels" | "shared-memory" | "hybrid";

export type NodeFailureMode = "none" | "crash-stop" | "crash-recovery" | "omission" | "byzantine-lite";

export type RecoveryMode = "none" | "restart" | "stable-storage" | "state-transfer";

export type ChannelFailureMode = "none" | "delay" | "drop" | "partition" | "duplicate";

export type DistributedRunConfig = {
  algorithmId: DistributedAlgorithmId;
  topologyId: DistributedTopologyId;
  nodeCount: number;
  syncMode: ExecutionSyncMode;
  clockMode: ClockMode;
  dataPattern: DataSyncPattern;
  nodeFailureMode: NodeFailureMode;
  recoveryMode: RecoveryMode;
  channelFailureMode: ChannelFailureMode;
  seed: number;
};

export type DistributedNodeStatus = "active" | "failed" | "recovering" | "halted";

export type DistributedChannelStatus = "healthy" | "delayed" | "dropping" | "partitioned" | "duplicating";

export type DistributedMessageStatus = "queued" | "delivered" | "dropped" | "duplicated" | "delayed";

export type DistributedDiagnosticSeverity = "ok" | "warning" | "failure";

export type DistributedLocalState = {
  label: string;
  value: string;
};

export type DistributedNodeState = {
  id: string;
  label: string;
  x: number;
  y: number;
  status: DistributedNodeStatus;
  role: string;
  color: string;
  clock: string;
  localState: DistributedLocalState[];
  log: string[];
};

export type DistributedChannelState = {
  id: string;
  from: string;
  to: string;
  status: DistributedChannelStatus;
  label: string;
  queueSize: number;
};

export type DistributedMessageState = {
  id: string;
  from: string;
  to: string;
  channelId: string;
  payload: string;
  status: DistributedMessageStatus;
  progress: number;
};

export type DistributedSharedMemoryCell = {
  key: string;
  value: string;
  writer: string;
  stale: boolean;
};

export type DistributedDiagnostic = {
  kind: "safety" | "liveness" | "agreement" | "termination" | "progress" | "clock" | "fault";
  severity: DistributedDiagnosticSeverity;
  label: string;
  detail: string;
};

export type DistributedFrame = {
  step: number;
  time: number;
  round: number;
  title: string;
  detail: string;
  eventKind: string;
  activeNodeIds: string[];
  activeChannelIds: string[];
  nodes: DistributedNodeState[];
  channels: DistributedChannelState[];
  messages: DistributedMessageState[];
  sharedMemory: DistributedSharedMemoryCell[];
  diagnostics: DistributedDiagnostic[];
};

export type DistributedRunResult = {
  status: "completed" | "failed" | "stalled";
  summary: string;
  deliveredCount: number;
  activeNodeCount: number;
  safetyViolations: number;
  livenessWarnings: number;
  agreementSplits: number;
  deadlocks: number;
  noProgressWarnings: number;
};

export type DistributedRun = {
  id: string;
  name: string;
  createdAt: string;
  config: DistributedRunConfig;
  frames: DistributedFrame[];
  result: DistributedRunResult;
};

export type DistributedStressReport = {
  generatedAt: string;
  runCount: number;
  completed: number;
  failed: number;
  stalled: number;
  safetyViolations: number;
  livenessWarnings: number;
  agreementSplits: number;
  deadlocks: number;
  noProgressWarnings: number;
  examples: Array<{
    seed: number;
    status: DistributedRunResult["status"];
    summary: string;
  }>;
};
