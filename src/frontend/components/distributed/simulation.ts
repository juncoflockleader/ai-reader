import type {
  ChannelFailureMode,
  ClockMode,
  DataSyncPattern,
  DistributedAlgorithmId,
  DistributedChannelState,
  DistributedChannelStatus,
  DistributedDiagnostic,
  DistributedFrame,
  DistributedMessageState,
  DistributedNodeState,
  DistributedRun,
  DistributedRunConfig,
  DistributedRunResult,
  DistributedSharedMemoryCell,
  DistributedStressReport,
  DistributedTopologyId,
  ExecutionSyncMode,
  NodeFailureMode,
  RecoveryMode
} from "./types";

export const DISTRIBUTED_ALGORITHM_DEFINITIONS: Array<{
  id: DistributedAlgorithmId;
  title: string;
  description: string;
}> = [
  {
    id: "flooding-broadcast",
    title: "Flooding Broadcast",
    description: "A source node sends a value to every reachable process over local channels."
  },
  {
    id: "max-consensus",
    title: "Max Consensus",
    description: "Nodes repeatedly share their highest known identifier until the component agrees."
  },
  {
    id: "echo-convergecast",
    title: "Echo Convergecast",
    description: "A root builds a spanning tree with probes, then gathers echo acknowledgements."
  }
];

export const TOPOLOGY_OPTIONS: Array<{ id: DistributedTopologyId; label: string }> = [
  { id: "ring", label: "Ring" },
  { id: "line", label: "Line" },
  { id: "star", label: "Star" },
  { id: "mesh", label: "Mesh" },
  { id: "tree", label: "Tree" }
];

export const SYNC_OPTIONS: Array<{ id: ExecutionSyncMode; label: string }> = [
  { id: "synchronous", label: "Synchronous" },
  { id: "asynchronous", label: "Asynchronous" },
  { id: "hybrid", label: "Hybrid" }
];

export const CLOCK_OPTIONS: Array<{ id: ClockMode; label: string }> = [
  { id: "none", label: "No clock" },
  { id: "logical", label: "Logical" },
  { id: "physical-skew", label: "Skewed" },
  { id: "drift", label: "Drift" }
];

export const DATA_PATTERN_OPTIONS: Array<{ id: DataSyncPattern; label: string }> = [
  { id: "channels", label: "Channels" },
  { id: "shared-memory", label: "Shared memory" },
  { id: "hybrid", label: "Hybrid" }
];

export const NODE_FAILURE_OPTIONS: Array<{ id: NodeFailureMode; label: string }> = [
  { id: "none", label: "None" },
  { id: "crash-stop", label: "Crash stop" },
  { id: "crash-recovery", label: "Crash recovery" },
  { id: "omission", label: "Omission" },
  { id: "byzantine-lite", label: "Byzantine-lite" }
];

export const RECOVERY_OPTIONS: Array<{ id: RecoveryMode; label: string }> = [
  { id: "none", label: "None" },
  { id: "restart", label: "Restart" },
  { id: "stable-storage", label: "Stable storage" },
  { id: "state-transfer", label: "State transfer" }
];

export const CHANNEL_FAILURE_OPTIONS: Array<{ id: ChannelFailureMode; label: string }> = [
  { id: "none", label: "None" },
  { id: "delay", label: "Delay" },
  { id: "drop", label: "Drop" },
  { id: "partition", label: "Partition" },
  { id: "duplicate", label: "Duplicate" }
];

const NODE_COLORS = ["#347f8f", "#d86642", "#6078bf", "#c29a2e", "#5f9b6e", "#a05e9a", "#4d8bcb", "#b66f3f", "#6b7f34"];
const MAX_FRAMES = 72;

type TopologyNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
  priority: number;
};

type TopologyEdge = {
  id: string;
  from: string;
  to: string;
};

type MutableNode = TopologyNode & {
  status: "active" | "failed" | "recovering" | "halted";
  role: string;
  clockValue: number;
  clockOffset: number;
  drift: number;
  delivered: boolean;
  deliveredValue: string;
  knownMax: number;
  parentId: string | null;
  pendingChildren: string[];
  echoCount: number;
  echoComplete: boolean;
  log: string[];
};

type MutableMessage = {
  id: string;
  from: string;
  to: string;
  channelId: string;
  payload: string;
  createdAt: number;
  delay: number;
  status: "queued" | "delivered" | "dropped" | "duplicated";
};

type MutableState = {
  config: DistributedRunConfig;
  rng: () => number;
  time: number;
  round: number;
  messageSerial: number;
  failureNodeId: string | null;
  nodes: MutableNode[];
  edges: TopologyEdge[];
  messages: MutableMessage[];
  eventMessages: MutableMessage[];
  sharedMemory: DistributedSharedMemoryCell[];
  activeNodeIds: string[];
  activeChannelIds: string[];
};

type DeliveryOutcome = {
  title: string;
  detail: string;
  changed: boolean;
};

export function defaultDistributedRunConfig(): DistributedRunConfig {
  return {
    algorithmId: "flooding-broadcast",
    topologyId: "ring",
    nodeCount: 6,
    syncMode: "asynchronous",
    clockMode: "logical",
    dataPattern: "channels",
    nodeFailureMode: "crash-recovery",
    recoveryMode: "stable-storage",
    channelFailureMode: "delay",
    seed: 23117
  };
}

export function generateDistributedRun(config: DistributedRunConfig): DistributedRun {
  const normalized = normalizeConfig(config);
  const rng = createSeededRng(normalized.seed);
  const topology = buildTopology(normalized.topologyId, normalized.nodeCount);
  const state = createMutableState(normalized, topology.nodes, topology.edges, rng);
  const frames: DistributedFrame[] = [];

  const capture = (title: string, detail: string, eventKind: string) => {
    frames.push(createFrame(state, frames.length, title, detail, eventKind));
    state.eventMessages = [];
  };

  if (normalized.algorithmId === "flooding-broadcast") {
    initializeFloodingBroadcast(state);
    capture("Initial broadcast", "Node n1 has the value and schedules sends to every neighbor.", "initialize");
  } else if (normalized.algorithmId === "max-consensus") {
    initializeMaxConsensus(state);
    capture("Initial proposals", "Each node starts with its own identifier and sends that proposal to its neighbors.", "initialize");
  } else {
    initializeEchoConvergecast(state);
    capture("Initial probe wave", "Root n1 sends probes to build a spanning tree before echoes return.", "initialize");
  }

  let lastProgressAt = 0;
  while (frames.length < MAX_FRAMES) {
    const faultEvent = applyFaultSchedule(state, frames.length);
    if (faultEvent) capture(faultEvent.title, faultEvent.detail, "fault");

    const ready = readyMessages(state);
    if (ready.length === 0) {
      if (state.messages.length === 0) break;
      state.time += 1;
      updatePhysicalClocks(state);
      markWaitingMessages(state);
      capture("Waiting on channels", "No deliverable message is ready at this instant; delayed channels advance time.", "wait");
      if (frames.length - lastProgressAt > Math.max(8, normalized.nodeCount * 2)) break;
      continue;
    }

    const batch = selectDeliveryBatch(state, ready);
    const outcomes = batch.map((message) => deliverMessage(state, message));
    const changed = outcomes.some((outcome) => outcome.changed);
    if (changed) lastProgressAt = frames.length;
    const title = batch.length === 1 ? outcomes[0].title : `Deliver ${batch.length} messages`;
    const detail = batch.length === 1 ? outcomes[0].detail : outcomes.map((outcome) => outcome.detail).join(" ");
    capture(title, detail, batch.length === 1 ? "deliver" : "round");
    removeSettledMessages(state);

    if (isRunTerminal(state)) break;
    state.time += normalized.syncMode === "synchronous" ? 1 : normalized.syncMode === "hybrid" ? 2 : 1;
    if (normalized.syncMode === "synchronous" || frames.length % 4 === 0) state.round += 1;
    updatePhysicalClocks(state);
  }

  const result = buildRunResult(state);
  if (!isTerminalFrame(frames[frames.length - 1], result)) {
    state.activeNodeIds = [];
    state.activeChannelIds = [];
    capture(result.status === "completed" ? "Run complete" : "Run stopped", result.summary, "result");
  }

  return {
    id: `dist-${normalized.seed}-${Date.now().toString(36)}`,
    name: `${algorithmTitle(normalized.algorithmId)} on ${topologyTitle(normalized.topologyId)} seed ${normalized.seed}`,
    createdAt: new Date().toISOString(),
    config: normalized,
    frames,
    result
  };
}

export function generateRandomDistributedConfig(base: DistributedRunConfig): DistributedRunConfig {
  const seed = Math.floor(Math.random() * 900_000) + 10_000;
  return {
    ...base,
    algorithmId: pick(DISTRIBUTED_ALGORITHM_DEFINITIONS).id,
    topologyId: pick(TOPOLOGY_OPTIONS).id,
    nodeCount: 5 + Math.floor(Math.random() * 5),
    syncMode: pick(SYNC_OPTIONS).id,
    clockMode: pick(CLOCK_OPTIONS).id,
    dataPattern: pick(DATA_PATTERN_OPTIONS).id,
    nodeFailureMode: pick(NODE_FAILURE_OPTIONS).id,
    recoveryMode: pick(RECOVERY_OPTIONS).id,
    channelFailureMode: pick(CHANNEL_FAILURE_OPTIONS).id,
    seed
  };
}

export function runDistributedStressTest(config: DistributedRunConfig, runCount = 80): DistributedStressReport {
  const report: DistributedStressReport = {
    generatedAt: new Date().toISOString(),
    runCount,
    completed: 0,
    failed: 0,
    stalled: 0,
    safetyViolations: 0,
    livenessWarnings: 0,
    agreementSplits: 0,
    deadlocks: 0,
    noProgressWarnings: 0,
    examples: []
  };

  for (let index = 0; index < runCount; index += 1) {
    const run = generateDistributedRun({
      ...config,
      seed: config.seed + 17 + index * 7919
    });
    report[run.result.status] += 1;
    report.safetyViolations += run.result.safetyViolations;
    report.livenessWarnings += run.result.livenessWarnings;
    report.agreementSplits += run.result.agreementSplits;
    report.deadlocks += run.result.deadlocks;
    report.noProgressWarnings += run.result.noProgressWarnings;
    if (run.result.status !== "completed" && report.examples.length < 5) {
      report.examples.push({
        seed: run.config.seed,
        status: run.result.status,
        summary: run.result.summary
      });
    }
  }

  return report;
}

export function algorithmTitle(id: DistributedAlgorithmId): string {
  return DISTRIBUTED_ALGORITHM_DEFINITIONS.find((definition) => definition.id === id)?.title ?? "Distributed Algorithm";
}

export function topologyTitle(id: DistributedTopologyId): string {
  return TOPOLOGY_OPTIONS.find((option) => option.id === id)?.label ?? "Topology";
}

function normalizeConfig(config: DistributedRunConfig): DistributedRunConfig {
  return {
    ...config,
    nodeCount: Math.max(3, Math.min(9, Math.round(config.nodeCount))),
    seed: Number.isFinite(config.seed) ? Math.max(1, Math.floor(config.seed)) : 1,
    recoveryMode: config.nodeFailureMode === "crash-recovery" ? config.recoveryMode : "none"
  };
}

function createMutableState(
  config: DistributedRunConfig,
  topologyNodes: TopologyNode[],
  edges: TopologyEdge[],
  rng: () => number
): MutableState {
  const failureNodeIndex = config.nodeCount > 2 ? 1 + Math.floor(rng() * (config.nodeCount - 1)) : 1;
  const nodes = topologyNodes.map<MutableNode>((node) => ({
    ...node,
    status: "active",
    role: node.id === "n0" ? "source" : "participant",
    clockValue: 0,
    clockOffset: Math.floor(rng() * 7) - 3,
    drift: 0.88 + rng() * 0.24,
    delivered: false,
    deliveredValue: "-",
    knownMax: node.priority,
    parentId: null,
    pendingChildren: [],
    echoCount: 0,
    echoComplete: false,
    log: ["boot"]
  }));

  if (config.nodeFailureMode === "omission") nodes[failureNodeIndex].role = "omits sends";
  if (config.nodeFailureMode === "byzantine-lite") nodes[failureNodeIndex].role = "faulty";

  return {
    config,
    rng,
    time: 0,
    round: 0,
    messageSerial: 0,
    failureNodeId: config.nodeFailureMode === "none" ? null : nodes[failureNodeIndex].id,
    nodes,
    edges,
    messages: [],
    eventMessages: [],
    sharedMemory: [],
    activeNodeIds: [],
    activeChannelIds: []
  };
}

function initializeFloodingBroadcast(state: MutableState) {
  const source = state.nodes[0];
  source.delivered = true;
  source.deliveredValue = "value A";
  source.log.unshift("broadcast value A");
  updateSharedMemory(state, "source", "value A", source.id);
  updateSharedMemory(state, "delivered", "1", source.id);
  neighborsOf(state, source.id).forEach((neighborId) => enqueueMessage(state, source.id, neighborId, "value A"));
  state.activeNodeIds = [source.id];
  state.activeChannelIds = state.messages.map((message) => message.channelId);
}

function initializeMaxConsensus(state: MutableState) {
  state.nodes.forEach((node) => {
    updateSharedMemory(state, `max:${node.id}`, String(node.knownMax), node.id);
    neighborsOf(state, node.id).forEach((neighborId) => enqueueMessage(state, node.id, neighborId, `max:${node.knownMax}`));
  });
  state.activeNodeIds = state.nodes.map((node) => node.id);
  state.activeChannelIds = state.messages.map((message) => message.channelId);
}

function initializeEchoConvergecast(state: MutableState) {
  const root = state.nodes[0];
  root.role = "root";
  root.parentId = null;
  root.pendingChildren = neighborsOf(state, root.id);
  root.echoCount = 0;
  root.log.unshift(`probe ${root.pendingChildren.length} neighbor(s)`);
  updateSharedMemory(state, "root", root.id, root.id);
  updateSharedMemory(state, `pending:${root.id}`, String(root.pendingChildren.length), root.id);
  root.pendingChildren.forEach((neighborId) => enqueueMessage(state, root.id, neighborId, "probe:1"));
  state.activeNodeIds = [root.id];
  state.activeChannelIds = state.messages.map((message) => message.channelId);
}

function applyFaultSchedule(state: MutableState, frameCount: number): { title: string; detail: string } | null {
  const failureNode = state.failureNodeId ? nodeById(state, state.failureNodeId) : null;
  if (!failureNode) return null;

  if (state.config.nodeFailureMode === "crash-stop" && frameCount === 3) {
    failureNode.status = "failed";
    failureNode.role = "crashed";
    failureNode.log.unshift("crash-stop");
    state.activeNodeIds = [failureNode.id];
    state.activeChannelIds = [];
    return { title: `${failureNode.label} crashes`, detail: "The process stops and will not send or receive future messages." };
  }

  if (state.config.nodeFailureMode === "crash-recovery" && frameCount === 3) {
    failureNode.status = "failed";
    failureNode.role = "crashed";
    failureNode.log.unshift("crash");
    state.activeNodeIds = [failureNode.id];
    state.activeChannelIds = [];
    return { title: `${failureNode.label} crashes`, detail: "The process is unavailable until the configured recovery policy runs." };
  }

  if (state.config.nodeFailureMode === "crash-recovery" && frameCount === 8) {
    recoverNode(state, failureNode);
    state.activeNodeIds = [failureNode.id];
    state.activeChannelIds = [];
    return { title: `${failureNode.label} recovers`, detail: recoveryDetail(state.config.recoveryMode) };
  }

  return null;
}

function recoverNode(state: MutableState, node: MutableNode) {
  node.status = "recovering";
  node.role = "recovering";
  node.log.unshift(`recover:${state.config.recoveryMode}`);
  if (state.config.recoveryMode === "restart") {
    node.delivered = false;
    node.deliveredValue = "-";
    node.knownMax = node.priority;
    node.parentId = null;
    node.pendingChildren = [];
    node.echoCount = 0;
    node.echoComplete = false;
  }
  if (state.config.recoveryMode === "state-transfer") {
    const neighborMax = Math.max(node.knownMax, ...neighborsOf(state, node.id).map((neighborId) => nodeById(state, neighborId)?.knownMax ?? node.knownMax));
    node.knownMax = neighborMax;
    if (neighborsOf(state, node.id).some((neighborId) => nodeById(state, neighborId)?.delivered)) {
      node.delivered = true;
      node.deliveredValue = "value A";
    }
  }
  node.status = "active";
  neighborsOf(state, node.id).forEach((neighborId) => {
    const payload =
      state.config.algorithmId === "max-consensus"
        ? `max:${node.knownMax}`
        : state.config.algorithmId === "echo-convergecast"
          ? node.parentId ? "probe:recovery" : "recover?"
          : node.delivered ? node.deliveredValue : "recover?";
    enqueueMessage(state, node.id, neighborId, payload);
  });
}

function readyMessages(state: MutableState): MutableMessage[] {
  return state.messages.filter((message) => {
    if (message.status !== "queued") return false;
    const from = nodeById(state, message.from);
    const to = nodeById(state, message.to);
    if (!from || !to || from.status === "failed" || to.status === "failed") return false;
    return state.time - message.createdAt >= message.delay;
  });
}

function selectDeliveryBatch(state: MutableState, ready: MutableMessage[]): MutableMessage[] {
  if (state.config.syncMode === "synchronous") return ready;
  if (state.config.syncMode === "hybrid") {
    const count = Math.max(1, Math.min(3, Math.ceil(ready.length / 2)));
    return shuffle([...ready], state.rng).slice(0, count);
  }
  return [ready[Math.floor(state.rng() * ready.length)]];
}

function deliverMessage(state: MutableState, message: MutableMessage): DeliveryOutcome {
  const channelStatus = getChannelStatus(state, message.channelId);
  state.activeNodeIds = [message.from, message.to];
  state.activeChannelIds = [message.channelId];
  bumpLogicalClock(state, message.from);
  bumpLogicalClock(state, message.to);

  if (channelStatus === "partitioned") {
    message.status = "dropped";
    state.eventMessages = [message];
    return {
      title: "Message blocked",
      detail: `${message.payload} from ${message.from} to ${message.to} hits a partitioned channel.`,
      changed: false
    };
  }

  if (channelStatus === "dropping" && state.rng() < 0.38) {
    message.status = "dropped";
    state.eventMessages = [message];
    return {
      title: "Message dropped",
      detail: `${message.payload} from ${message.from} to ${message.to} is lost by the channel.`,
      changed: false
    };
  }

  message.status = "delivered";
  state.eventMessages = [message];
  if (state.config.algorithmId === "max-consensus") return deliverMaxConsensus(state, message);
  if (state.config.algorithmId === "echo-convergecast") return deliverEchoConvergecast(state, message);
  return deliverFloodingBroadcast(state, message);
}

function deliverFloodingBroadcast(state: MutableState, message: MutableMessage): DeliveryOutcome {
  const receiver = nodeById(state, message.to);
  if (!receiver) {
    return { title: "Unknown receiver", detail: "The message receiver no longer exists.", changed: false };
  }

  if (message.payload.startsWith("corrupt")) {
    receiver.delivered = true;
    receiver.deliveredValue = message.payload;
    receiver.log.unshift(`accepted ${message.payload}`);
    return {
      title: `${receiver.label} accepts corrupt value`,
      detail: `${receiver.label} delivered ${message.payload}; the safety diagnostic should fail.`,
      changed: true
    };
  }

  if (receiver.delivered) {
    receiver.log.unshift("duplicate ignored");
    return {
      title: `${receiver.label} ignores duplicate`,
      detail: `${receiver.label} already delivered the broadcast value, so the duplicate is ignored.`,
      changed: false
    };
  }

  receiver.delivered = true;
  receiver.deliveredValue = message.payload;
  receiver.log.unshift(`deliver ${message.payload}`);
  updateSharedMemory(state, `delivered:${receiver.id}`, message.payload, receiver.id);
  updateSharedMemory(state, "delivered", String(state.nodes.filter((node) => node.delivered).length), receiver.id);

  neighborsOf(state, receiver.id)
    .filter((neighborId) => neighborId !== message.from)
    .forEach((neighborId) => enqueueMessage(state, receiver.id, neighborId, message.payload));

  return {
    title: `${receiver.label} delivers`,
    detail: `${receiver.label} records ${message.payload} and forwards it to neighbors that have not just sent it.`,
    changed: true
  };
}

function deliverMaxConsensus(state: MutableState, message: MutableMessage): DeliveryOutcome {
  const receiver = nodeById(state, message.to);
  if (!receiver) {
    return { title: "Unknown receiver", detail: "The message receiver no longer exists.", changed: false };
  }

  const parsed = Number(message.payload.replace(/^max:/, ""));
  if (!Number.isFinite(parsed)) {
    receiver.knownMax = Number.MAX_SAFE_INTEGER;
    receiver.log.unshift("accepted corrupt max");
    return {
      title: `${receiver.label} accepts corrupt proposal`,
      detail: `${receiver.label} accepted a non-numeric proposal; consensus safety is now invalid.`,
      changed: true
    };
  }

  if (parsed <= receiver.knownMax) {
    receiver.log.unshift(`ignore ${parsed}`);
    return {
      title: `${receiver.label} ignores stale max`,
      detail: `${receiver.label} already knows ${receiver.knownMax}, so ${parsed} does not change local state.`,
      changed: false
    };
  }

  receiver.knownMax = parsed;
  receiver.log.unshift(`adopt ${parsed}`);
  updateSharedMemory(state, `max:${receiver.id}`, String(parsed), receiver.id);
  neighborsOf(state, receiver.id)
    .filter((neighborId) => neighborId !== message.from)
    .forEach((neighborId) => enqueueMessage(state, receiver.id, neighborId, `max:${parsed}`));

  return {
    title: `${receiver.label} raises max`,
    detail: `${receiver.label} adopts ${parsed} and forwards the better proposal to its neighbors.`,
    changed: true
  };
}

function deliverEchoConvergecast(state: MutableState, message: MutableMessage): DeliveryOutcome {
  const receiver = nodeById(state, message.to);
  if (!receiver) {
    return { title: "Unknown receiver", detail: "The message receiver no longer exists.", changed: false };
  }

  if (message.payload.startsWith("corrupt")) {
    receiver.deliveredValue = "corrupt echo";
    receiver.log.unshift("accepted corrupt echo");
    return {
      title: `${receiver.label} accepts corrupt echo`,
      detail: `${receiver.label} accepted a malformed echo payload; the validator should flag safety.`,
      changed: true
    };
  }

  if (message.payload.startsWith("probe")) {
    if (receiver.id === "n0" || receiver.parentId) {
      receiver.log.unshift(`reject probe from ${message.from}`);
      enqueueMessage(state, receiver.id, message.from, "echo:0");
      return {
        title: `${receiver.label} rejects duplicate probe`,
        detail: `${receiver.label} already belongs to the echo tree, so it sends a zero echo back to ${message.from}.`,
        changed: false
      };
    }

    receiver.parentId = message.from;
    receiver.role = "tree node";
    receiver.pendingChildren = neighborsOf(state, receiver.id).filter((neighborId) => neighborId !== message.from);
    receiver.echoCount = 0;
    receiver.log.unshift(`parent ${message.from}`);
    updateSharedMemory(state, `parent:${receiver.id}`, message.from, receiver.id);
    updateSharedMemory(state, `pending:${receiver.id}`, String(receiver.pendingChildren.length), receiver.id);

    if (receiver.pendingChildren.length === 0) {
      receiver.echoComplete = true;
      receiver.delivered = true;
      receiver.deliveredValue = "echo 1";
      receiver.role = "leaf echoed";
      enqueueMessage(state, receiver.id, message.from, "echo:1");
      return {
        title: `${receiver.label} becomes a leaf`,
        detail: `${receiver.label} has no unexplored neighbors, so it immediately echoes count 1 to its parent.`,
        changed: true
      };
    }

    receiver.pendingChildren.forEach((neighborId) => enqueueMessage(state, receiver.id, neighborId, "probe:1"));
    return {
      title: `${receiver.label} joins tree`,
      detail: `${receiver.label} sets ${message.from} as parent and probes ${receiver.pendingChildren.length} neighbor(s).`,
      changed: true
    };
  }

  if (message.payload.startsWith("echo:")) {
    const echoValue = Number(message.payload.replace(/^echo:/, ""));
    if (!Number.isFinite(echoValue)) {
      receiver.deliveredValue = "corrupt echo";
      receiver.log.unshift("bad echo count");
      return {
        title: `${receiver.label} sees malformed echo`,
        detail: `${receiver.label} received a malformed echo count from ${message.from}.`,
        changed: true
      };
    }

    receiver.pendingChildren = receiver.pendingChildren.filter((childId) => childId !== message.from);
    receiver.echoCount += echoValue;
    receiver.log.unshift(`echo ${echoValue} from ${message.from}`);
    updateSharedMemory(state, `pending:${receiver.id}`, String(receiver.pendingChildren.length), receiver.id);
    updateSharedMemory(state, `echo:${receiver.id}`, String(receiver.echoCount), receiver.id);

    if (receiver.pendingChildren.length > 0) {
      return {
        title: `${receiver.label} waits for echoes`,
        detail: `${receiver.label} accepted ${message.from}'s echo and still waits for ${receiver.pendingChildren.length} child response(s).`,
        changed: true
      };
    }

    receiver.echoComplete = true;
    receiver.delivered = true;
    receiver.deliveredValue = `size ${receiver.echoCount + 1}`;
    if (receiver.id === "n0") {
      receiver.role = "complete";
      updateSharedMemory(state, "tree-size", String(receiver.echoCount + 1), receiver.id);
      return {
        title: `${receiver.label} completes convergecast`,
        detail: `${receiver.label} collected all echoes and reports a tree size of ${receiver.echoCount + 1}.`,
        changed: true
      };
    }

    receiver.role = "echoed";
    if (receiver.parentId) enqueueMessage(state, receiver.id, receiver.parentId, `echo:${receiver.echoCount + 1}`);
    return {
      title: `${receiver.label} echoes to parent`,
      detail: `${receiver.label} has all child responses and sends aggregate ${receiver.echoCount + 1} to ${receiver.parentId}.`,
      changed: true
    };
  }

  receiver.log.unshift(`ignore ${message.payload}`);
  return {
    title: `${receiver.label} ignores payload`,
    detail: `${receiver.label} received an echo-protocol payload it cannot interpret.`,
    changed: false
  };
}

function enqueueMessage(state: MutableState, from: string, to: string, payload: string) {
  const sender = nodeById(state, from);
  if (!sender || sender.status === "failed") return;
  if (state.config.nodeFailureMode === "omission" && state.failureNodeId === from && state.rng() < 0.5) {
    sender.log.unshift(`omit send to ${to}`);
    return;
  }

  const channelId = channelIdFor(from, to);
  const status = getChannelStatus(state, channelId);
  let nextPayload = payload;
  if (state.config.nodeFailureMode === "byzantine-lite" && state.failureNodeId === from && state.rng() < 0.52) {
    nextPayload = state.config.algorithmId === "max-consensus" ? "max:not-a-number" : state.config.algorithmId === "echo-convergecast" ? "corrupt echo" : "corrupt value";
    sender.log.unshift(`corrupt send to ${to}`);
  }

  const baseDelay = state.config.syncMode === "synchronous" ? 1 : state.config.syncMode === "hybrid" ? 1 + Math.floor(state.rng() * 2) : 1 + Math.floor(state.rng() * 3);
  const extraDelay = status === "delayed" ? 2 + Math.floor(state.rng() * 4) : 0;
  const message: MutableMessage = {
    id: `m${state.messageSerial += 1}`,
    from,
    to,
    channelId,
    payload: nextPayload,
    createdAt: state.time,
    delay: baseDelay + extraDelay,
    status: "queued"
  };
  state.messages.push(message);

  if (status === "duplicating" && state.rng() < 0.45) {
    state.messages.push({
      ...message,
      id: `m${state.messageSerial += 1}`,
      status: "queued",
      delay: message.delay + 1
    });
  }
}

function createFrame(state: MutableState, step: number, title: string, detail: string, eventKind: string): DistributedFrame {
  return {
    step,
    time: state.time,
    round: state.round,
    title,
    detail,
    eventKind,
    activeNodeIds: [...new Set(state.activeNodeIds)],
    activeChannelIds: [...new Set(state.activeChannelIds)],
    nodes: state.nodes.map((node) => createNodeState(state, node)),
    channels: state.edges.map((edge) => createChannelState(state, edge)),
    messages: createMessageStates(state),
    sharedMemory: state.config.dataPattern === "channels" ? [] : state.sharedMemory.map((cell) => ({ ...cell })),
    diagnostics: buildDiagnostics(state)
  };
}

function createNodeState(state: MutableState, node: MutableNode): DistributedNodeState {
  let localState: DistributedNodeState["localState"];
  if (state.config.algorithmId === "max-consensus") {
    localState = [
      { label: "known max", value: String(node.knownMax) },
      { label: "node id", value: String(node.priority) }
    ];
  } else if (state.config.algorithmId === "echo-convergecast") {
    localState = [
      { label: "parent", value: node.parentId ?? (node.id === "n0" ? "root" : "-") },
      { label: "pending", value: String(node.pendingChildren.length) },
      { label: "echo count", value: String(node.echoCount) },
      { label: "echoed", value: node.echoComplete ? "yes" : "no" }
    ];
  } else {
    localState = [
      { label: "delivered", value: node.delivered ? "yes" : "no" },
      { label: "value", value: node.deliveredValue }
    ];
  }
  return {
    id: node.id,
    label: node.label,
    x: node.x,
    y: node.y,
    status: node.status,
    role: node.role,
    color: node.color,
    clock: formatClock(state, node),
    localState,
    log: node.log.slice(0, 4)
  };
}

function createChannelState(state: MutableState, edge: TopologyEdge): DistributedChannelState {
  const queueSize = state.messages.filter((message) => message.channelId === edge.id && message.status === "queued").length;
  const status = getChannelStatus(state, edge.id);
  return {
    ...edge,
    status,
    queueSize,
    label: channelLabel(status, queueSize)
  };
}

function createMessageStates(state: MutableState): DistributedMessageState[] {
  const queued = state.messages.filter((message) => message.status === "queued").map((message) => {
    const rawProgress = message.delay <= 0 ? 1 : (state.time - message.createdAt + 0.35) / message.delay;
    const progress = Math.max(0.08, Math.min(message.status === "queued" ? 0.9 : 1, rawProgress));
    const delayed = message.status === "queued" && progress < 0.9 && getChannelStatus(state, message.channelId) === "delayed";
    return {
      id: message.id,
      from: message.from,
      to: message.to,
      channelId: message.channelId,
      payload: message.payload,
      status: delayed ? "delayed" : message.status,
      progress
    } satisfies DistributedMessageState;
  });
  const events = state.eventMessages.map((message) => ({
    id: message.id,
    from: message.from,
    to: message.to,
    channelId: message.channelId,
    payload: message.payload,
    status: message.status,
    progress: message.status === "dropped" ? 0.52 : 1
  } satisfies DistributedMessageState));
  return [...queued, ...events];
}

function buildDiagnostics(state: MutableState): DistributedDiagnostic[] {
  const activeNodes = state.nodes.filter((node) => node.status !== "failed");
  const queuedCount = state.messages.filter((message) => message.status === "queued").length;
  const corruptDeliveries = state.nodes.filter((node) => node.deliveredValue.startsWith("corrupt") || node.knownMax === Number.MAX_SAFE_INTEGER).length;
  const complete = isAlgorithmGoalComplete(state);
  const diagnostics: DistributedDiagnostic[] = [
    {
      kind: "safety",
      severity: corruptDeliveries > 0 ? "failure" : "ok",
      label: corruptDeliveries > 0 ? "Safety violation" : "Safety holds",
      detail: corruptDeliveries > 0 ? `${corruptDeliveries} node(s) accepted corrupt state.` : "No node has accepted a malformed value."
    },
    {
      kind: "termination",
      severity: queuedCount === 0 ? "ok" : "warning",
      label: queuedCount === 0 ? "Quiescent" : "Messages in flight",
      detail: queuedCount === 0 ? "The current state has no queued channel messages." : `${queuedCount} message(s) remain queued.`
    }
  ];

  if (state.config.algorithmId === "max-consensus") {
    const knownValues = new Set(activeNodes.map((node) => node.knownMax));
    diagnostics.push({
      kind: "agreement",
      severity: knownValues.size <= 1 ? "ok" : queuedCount === 0 ? "failure" : "warning",
      label: knownValues.size <= 1 ? "Agreement" : "Split proposal",
      detail: knownValues.size <= 1 ? "Active nodes agree on the maximum identifier." : `${knownValues.size} different max values are visible.`
    });
  } else if (state.config.algorithmId === "echo-convergecast") {
    const root = state.nodes[0];
    const joinedCount = state.nodes.filter((node) => node.id === "n0" || node.parentId).length;
    diagnostics.push({
      kind: "liveness",
      severity: root.echoComplete ? "ok" : queuedCount === 0 ? "failure" : "warning",
      label: root.echoComplete ? "Echo complete" : "Echo pending",
      detail: root.echoComplete ? `Root collected a tree size of ${root.echoCount + 1}.` : `${joinedCount}/${activeNodes.length} active node(s) have joined the echo tree.`
    });
  } else {
    const deliveredCount = activeNodes.filter((node) => node.delivered).length;
    diagnostics.push({
      kind: "liveness",
      severity: deliveredCount === activeNodes.length ? "ok" : queuedCount === 0 ? "failure" : "warning",
      label: deliveredCount === activeNodes.length ? "All reached" : "Delivery pending",
      detail: `${deliveredCount}/${activeNodes.length} active node(s) have delivered the broadcast.`
    });
  }

  if (!complete && queuedCount === 0) {
    diagnostics.push({
      kind: "progress",
      severity: "failure",
      label: "No-progress halt",
      detail: "The run has no queued messages, but the algorithm-specific goal is not satisfied."
    });
  } else if (!complete && readyMessages(state).length === 0 && queuedCount > 0) {
    diagnostics.push({
      kind: "progress",
      severity: "warning",
      label: "Blocked progress",
      detail: "Messages remain queued, but none are deliverable in the current failure and timing state."
    });
  } else {
    diagnostics.push({
      kind: "progress",
      severity: "ok",
      label: complete ? "Goal reached" : "Progress possible",
      detail: complete ? "The algorithm-specific completion condition is satisfied." : "At least one future delivery can advance the execution."
    });
  }

  diagnostics.push({
    kind: "clock",
    severity: state.config.clockMode === "physical-skew" || state.config.clockMode === "drift" ? "warning" : "ok",
    label: state.config.clockMode === "none" ? "No clock assumptions" : "Clock model active",
    detail: clockDiagnosticDetail(state.config.clockMode)
  });

  if (state.config.nodeFailureMode !== "none" || state.config.channelFailureMode !== "none") {
    diagnostics.push({
      kind: "fault",
      severity: state.nodes.some((node) => node.status === "failed") || state.config.channelFailureMode === "partition" ? "warning" : "ok",
      label: "Fault model",
      detail: `${state.config.nodeFailureMode} nodes, ${state.config.channelFailureMode} channels.`
    });
  }

  return diagnostics;
}

function buildRunResult(state: MutableState): DistributedRunResult {
  const diagnostics = buildDiagnostics(state);
  const activeNodes = state.nodes.filter((node) => node.status !== "failed");
  const deliveredCount = progressCount(state, activeNodes);
  const safetyViolations = diagnostics.filter((diagnostic) => diagnostic.kind === "safety" && diagnostic.severity === "failure").length;
  const livenessWarnings = diagnostics.filter((diagnostic) => diagnostic.kind === "liveness" && diagnostic.severity !== "ok").length;
  const agreementSplits = diagnostics.filter((diagnostic) => diagnostic.kind === "agreement" && diagnostic.severity !== "ok").length;
  const deadlocks = diagnostics.filter((diagnostic) => diagnostic.kind === "progress" && diagnostic.severity === "failure").length;
  const noProgressWarnings = diagnostics.filter((diagnostic) => diagnostic.kind === "progress" && diagnostic.severity === "warning").length;
  const hasFailure = diagnostics.some((diagnostic) => diagnostic.severity === "failure");
  const hasQueuedMessages = state.messages.some((message) => message.status === "queued");
  const status = hasFailure ? "failed" : hasQueuedMessages ? "stalled" : "completed";
  const summary =
    status === "completed"
      ? "The run reached a quiescent state without failed safety diagnostics."
      : status === "failed"
        ? "The validator found a safety, agreement, or liveness failure."
        : "The run stopped with messages still in flight or no recent progress.";

  return {
    status,
    summary,
    deliveredCount,
    activeNodeCount: activeNodes.length,
    safetyViolations,
    livenessWarnings,
    agreementSplits,
    deadlocks,
    noProgressWarnings
  };
}

function isRunTerminal(state: MutableState): boolean {
  if (state.messages.some((message) => message.status === "queued")) return false;
  if (state.config.algorithmId === "max-consensus") {
    const activeNodes = state.nodes.filter((node) => node.status !== "failed");
    return new Set(activeNodes.map((node) => node.knownMax)).size <= 1;
  }
  if (state.config.algorithmId === "echo-convergecast") return state.nodes[0].echoComplete;
  return true;
}

function isAlgorithmGoalComplete(state: MutableState): boolean {
  const activeNodes = state.nodes.filter((node) => node.status !== "failed");
  if (state.config.algorithmId === "max-consensus") {
    return new Set(activeNodes.map((node) => node.knownMax)).size <= 1;
  }
  if (state.config.algorithmId === "echo-convergecast") return state.nodes[0].echoComplete;
  return activeNodes.every((node) => node.delivered);
}

function progressCount(state: MutableState, activeNodes: MutableNode[]): number {
  if (state.config.algorithmId === "max-consensus") {
    const highestKnown = Math.max(...activeNodes.map((item) => item.knownMax));
    return activeNodes.filter((node) => node.knownMax === highestKnown).length;
  }
  if (state.config.algorithmId === "echo-convergecast") {
    return activeNodes.filter((node) => node.id === "n0" || node.parentId).length;
  }
  return activeNodes.filter((node) => node.delivered).length;
}

function isTerminalFrame(frame: DistributedFrame | undefined, result: DistributedRunResult): boolean {
  return Boolean(frame && frame.eventKind === "result" && frame.detail === result.summary);
}

function removeSettledMessages(state: MutableState) {
  state.messages = state.messages.filter((message) => message.status === "queued");
}

function markWaitingMessages(state: MutableState) {
  state.activeNodeIds = [];
  state.activeChannelIds = state.messages.map((message) => message.channelId);
}

function updatePhysicalClocks(state: MutableState) {
  state.nodes.forEach((node) => {
    if (state.config.clockMode === "physical-skew") node.clockValue = Math.round(state.time * 10 + node.clockOffset);
    if (state.config.clockMode === "drift") node.clockValue = Math.round(state.time * 10 * node.drift + node.clockOffset);
  });
}

function bumpLogicalClock(state: MutableState, nodeId: string) {
  if (state.config.clockMode !== "logical") return;
  const node = nodeById(state, nodeId);
  if (node) node.clockValue += 1;
}

function updateSharedMemory(state: MutableState, key: string, value: string, writer: string) {
  if (state.config.dataPattern === "channels") return;
  const existing = state.sharedMemory.find((cell) => cell.key === key);
  if (existing) {
    existing.value = value;
    existing.writer = writer;
    existing.stale = false;
    return;
  }
  state.sharedMemory.push({ key, value, writer, stale: false });
}

function getChannelStatus(state: MutableState, channelId: string): DistributedChannelStatus {
  if (state.config.channelFailureMode === "none") return "healthy";
  if (state.config.channelFailureMode === "delay") return "delayed";
  if (state.config.channelFailureMode === "drop") return "dropping";
  if (state.config.channelFailureMode === "duplicate") return "duplicating";
  const edge = state.edges.find((item) => item.id === channelId);
  if (!edge) return "healthy";
  const fromIndex = Number(edge.from.replace("n", ""));
  const toIndex = Number(edge.to.replace("n", ""));
  const split = Math.ceil(state.config.nodeCount / 2);
  return (fromIndex < split && toIndex >= split) || (toIndex < split && fromIndex >= split) ? "partitioned" : "healthy";
}

function channelLabel(status: DistributedChannelStatus, queueSize: number): string {
  if (status === "healthy") return queueSize > 0 ? `${queueSize} queued` : "healthy";
  if (status === "delayed") return queueSize > 0 ? `${queueSize} delayed` : "delay";
  if (status === "dropping") return "lossy";
  if (status === "duplicating") return "duplicate";
  return "partition";
}

function formatClock(state: MutableState, node: MutableNode): string {
  if (state.config.clockMode === "none") return "no clock";
  if (state.config.clockMode === "logical") return `L${node.clockValue}`;
  if (state.config.clockMode === "physical-skew") return `T${node.clockValue}`;
  return `T${node.clockValue} d${node.drift.toFixed(2)}`;
}

function clockDiagnosticDetail(clockMode: ClockMode): string {
  if (clockMode === "none") return "The run validates without clock availability.";
  if (clockMode === "logical") return "Lamport-style logical counters advance on send and receive events.";
  if (clockMode === "physical-skew") return "Physical clocks include static per-node skew.";
  return "Physical clocks include both skew and drift.";
}

function recoveryDetail(recoveryMode: RecoveryMode): string {
  if (recoveryMode === "restart") return "The node restarts with volatile state cleared.";
  if (recoveryMode === "stable-storage") return "The node resumes from stable local state.";
  if (recoveryMode === "state-transfer") return "The node asks neighbors for state before rejoining.";
  return "The node returns with no extra recovery protocol.";
}

function neighborsOf(state: MutableState, nodeId: string): string[] {
  return state.edges.flatMap((edge) => {
    if (edge.from === nodeId) return [edge.to];
    if (edge.to === nodeId) return [edge.from];
    return [];
  });
}

function nodeById(state: MutableState, nodeId: string): MutableNode | undefined {
  return state.nodes.find((node) => node.id === nodeId);
}

function buildTopology(topologyId: DistributedTopologyId, nodeCount: number): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const nodes = createTopologyNodes(topologyId, nodeCount);
  const edgePairs: Array<[number, number]> = [];
  if (topologyId === "ring") {
    for (let index = 0; index < nodeCount; index += 1) edgePairs.push([index, (index + 1) % nodeCount]);
  } else if (topologyId === "line") {
    for (let index = 0; index < nodeCount - 1; index += 1) edgePairs.push([index, index + 1]);
  } else if (topologyId === "star") {
    for (let index = 1; index < nodeCount; index += 1) edgePairs.push([0, index]);
  } else if (topologyId === "mesh") {
    for (let left = 0; left < nodeCount; left += 1) {
      for (let right = left + 1; right < nodeCount; right += 1) edgePairs.push([left, right]);
    }
  } else {
    for (let index = 1; index < nodeCount; index += 1) edgePairs.push([Math.floor((index - 1) / 2), index]);
  }

  return {
    nodes,
    edges: edgePairs.map(([from, to]) => ({
      id: channelIdFor(`n${from}`, `n${to}`),
      from: `n${from}`,
      to: `n${to}`
    }))
  };
}

function createTopologyNodes(topologyId: DistributedTopologyId, nodeCount: number): TopologyNode[] {
  return Array.from({ length: nodeCount }, (_, index) => {
    const position = nodePosition(topologyId, nodeCount, index);
    return {
      id: `n${index}`,
      label: `n${index + 1}`,
      x: position.x,
      y: position.y,
      color: NODE_COLORS[index % NODE_COLORS.length],
      priority: 11 + index * 7 + ((index * 5) % 4)
    };
  });
}

function nodePosition(topologyId: DistributedTopologyId, nodeCount: number, index: number): { x: number; y: number } {
  if (topologyId === "line") {
    return {
      x: nodeCount === 1 ? 0.5 : 0.12 + (index / (nodeCount - 1)) * 0.76,
      y: 0.52 + (index % 2 === 0 ? -0.05 : 0.05)
    };
  }
  if (topologyId === "star" && index === 0) return { x: 0.5, y: 0.5 };
  if (topologyId === "tree") {
    const depth = Math.floor(Math.log2(index + 1));
    const firstAtDepth = 2 ** depth - 1;
    const levelIndex = index - firstAtDepth;
    const levelCount = Math.min(2 ** depth, nodeCount - firstAtDepth);
    return {
      x: 0.14 + ((levelIndex + 0.5) / Math.max(1, levelCount)) * 0.72,
      y: 0.16 + depth * 0.24
    };
  }
  const ringIndex = topologyId === "star" ? index - 1 : index;
  const ringCount = topologyId === "star" ? nodeCount - 1 : nodeCount;
  const angle = -Math.PI / 2 + (ringIndex / ringCount) * Math.PI * 2;
  const radius = topologyId === "mesh" ? 0.34 : 0.36;
  return {
    x: 0.5 + Math.cos(angle) * radius,
    y: 0.5 + Math.sin(angle) * radius
  };
}

function channelIdFor(from: string, to: string): string {
  const [left, right] = [from, to].sort();
  return `ch-${left}-${right}`;
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
