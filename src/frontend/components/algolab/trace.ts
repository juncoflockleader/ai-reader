import type { AlgorithmId, AlgorithmTrace, LaneId, TraceEvent, TreeVisualState, VisualItem, VisualState } from "./types";

const ITEM_COLORS = ["#347f8f", "#d86642", "#6078bf", "#c29a2e", "#5f9b6e", "#a05e9a", "#4d8bcb", "#b66f3f", "#6b7f34", "#8f6dcc", "#2f8f75", "#bf5f73"];

export function createInitialState(values: number[]): VisualState {
  const items = values.map<VisualItem>((value, index) => ({
    id: `item-${index}-${value}`,
    value,
    color: ITEM_COLORS[index % ITEM_COLORS.length]
  }));
  return {
    items,
    lanes: {
      array: items.map((item) => item.id),
      aux: Array.from({ length: items.length }, () => null)
    },
    pointers: {},
    ranges: {},
    loops: {},
    callFrames: {},
    activeCallId: null,
    activeCompare: [],
    activeMoved: [],
    sortedIds: [],
    message: "Ready to trace the algorithm.",
    codeLine: null
  };
}

export function createTraceShell(algorithmId: AlgorithmId, title: string, description: string, sampleProgram: string, input: number[]): AlgorithmTrace {
  return {
    algorithmId,
    title,
    description,
    sampleProgram,
    initialState: createInitialState(input),
    events: []
  };
}

export function deriveTraceFrame(trace: AlgorithmTrace, step: number): VisualState {
  const frame = cloneState(trace.initialState);
  const boundedStep = Math.max(0, Math.min(step, trace.events.length));
  for (let index = 0; index < boundedStep; index += 1) {
    applyTraceEvent(frame, trace.events[index]);
  }
  return frame;
}

export function applyTraceEvent(state: VisualState, event: TraceEvent): void {
  state.activeCompare = [];
  state.activeMoved = [];
  state.codeLine = "codeLine" in event && typeof event.codeLine === "number" ? event.codeLine : state.codeLine;

  switch (event.type) {
    case "explain":
      state.message = event.message;
      return;
    case "compare":
      state.activeCompare = [...event.itemIds];
      state.message = event.message;
      return;
    case "swap": {
      const lane = event.lane ?? "array";
      const [left, right] = event.indices;
      const leftId = state.lanes[lane][left] ?? null;
      const rightId = state.lanes[lane][right] ?? null;
      state.lanes[lane][left] = rightId;
      state.lanes[lane][right] = leftId;
      state.activeMoved = [leftId, rightId].filter(isString);
      state.message = event.message;
      return;
    }
    case "move": {
      const itemId = state.lanes[event.from.lane][event.from.index];
      state.lanes[event.from.lane][event.from.index] = null;
      state.lanes[event.to.lane][event.to.index] = itemId;
      state.activeMoved = itemId ? [itemId] : [];
      state.message = event.message;
      return;
    }
    case "setPointer":
      if (event.pointer) {
        state.pointers[event.name] = event.pointer;
      } else {
        delete state.pointers[event.name];
      }
      if (event.message) state.message = event.message;
      return;
    case "setRange":
      if (event.range) {
        state.ranges[event.name] = event.range;
      } else {
        delete state.ranges[event.name];
      }
      if (event.message) state.message = event.message;
      return;
    case "setLoop":
      if (event.loop) {
        state.loops[event.id] = { id: event.id, ...event.loop };
      } else {
        delete state.loops[event.id];
      }
      if (event.message) state.message = event.message;
      return;
    case "enterCall":
      state.callFrames[event.frame.id] = { ...event.frame, status: "open" };
      state.activeCallId = event.frame.id;
      if (event.message) state.message = event.message;
      return;
    case "exitCall": {
      const frame = state.callFrames[event.id];
      if (frame) {
        frame.status = "complete";
        state.activeCallId = frame.parentId;
      }
      if (event.message) state.message = event.message;
      return;
    }
    case "setTreeFocus": {
      if (state.tree) {
        state.tree.activeNodeId = event.nodeId;
        const itemId = event.nodeId ? state.tree.nodes[event.nodeId]?.itemId : null;
        state.activeMoved = itemId ? [itemId] : [];
      }
      if (event.message) state.message = event.message;
      return;
    }
    case "visitTreeNode": {
      if (state.tree) {
        const node = state.tree.nodes[event.nodeId];
        if (node) {
          state.tree.activeNodeId = event.nodeId;
          if (!state.tree.visitedNodeIds.includes(event.nodeId)) {
            state.tree.visitedNodeIds = [...state.tree.visitedNodeIds, event.nodeId];
          }
          if (!state.sortedIds.includes(node.itemId)) {
            state.sortedIds = [...state.sortedIds, node.itemId];
          }
          state.activeMoved = [node.itemId];
        }
      }
      state.message = event.message;
      return;
    }
    case "markSorted": {
      const sorted = new Set(state.sortedIds);
      event.itemIds.forEach((itemId) => sorted.add(itemId));
      state.sortedIds = Array.from(sorted);
      state.activeMoved = event.itemIds;
      if (event.message) state.message = event.message;
      return;
    }
  }
}

export function itemValueMap(items: VisualItem[]): Record<string, number> {
  return Object.fromEntries(items.map((item) => [item.id, item.value]));
}

export function getLaneValues(state: VisualState, lane: LaneId = "array"): number[] {
  const values = itemValueMap(state.items);
  return state.lanes[lane].flatMap((itemId) => (itemId ? [values[itemId]] : []));
}

export function cloneState(state: VisualState): VisualState {
  const clone: VisualState = {
    items: state.items.map((item) => ({ ...item })),
    lanes: {
      array: [...state.lanes.array],
      aux: [...state.lanes.aux]
    },
    pointers: Object.fromEntries(Object.entries(state.pointers).map(([name, pointer]) => [name, { ...pointer }])),
    ranges: Object.fromEntries(Object.entries(state.ranges).map(([name, range]) => [name, { ...range }])),
    loops: Object.fromEntries(Object.entries(state.loops).map(([id, loop]) => [id, { ...loop }])),
    callFrames: Object.fromEntries(
      Object.entries(state.callFrames).map(([id, frame]) => [
        id,
        {
          ...frame,
          range: frame.range ? { ...frame.range } : undefined
        }
      ])
    ),
    activeCallId: state.activeCallId,
    activeCompare: [...state.activeCompare],
    activeMoved: [...state.activeMoved],
    sortedIds: [...state.sortedIds],
    message: state.message,
    codeLine: state.codeLine
  };
  if (state.tree) clone.tree = cloneTreeState(state.tree);
  return clone;
}

function cloneTreeState(tree: TreeVisualState): TreeVisualState {
  return {
    nodes: Object.fromEntries(Object.entries(tree.nodes).map(([id, node]) => [id, { ...node }])),
    edges: tree.edges.map((edge) => ({ ...edge })),
    rootId: tree.rootId,
    activeNodeId: tree.activeNodeId,
    visitedNodeIds: [...tree.visitedNodeIds],
    queuedNodeIds: [...tree.queuedNodeIds],
    traversalLabel: tree.traversalLabel
  };
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}
