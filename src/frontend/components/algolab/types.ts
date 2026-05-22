export type AlgorithmId = "quicksort" | "insertion-sort" | "merge-sort" | "tree-preorder" | "custom";

export type LaneId = "array" | "aux";

export type VisualItem = {
  id: string;
  value: number;
  color: string;
};

export type LanePosition = {
  lane: LaneId;
  index: number;
};

export type PointerState = LanePosition & {
  label: string;
  color: string;
};

export type RangeState = {
  lane: LaneId;
  start: number;
  end: number;
  label: string;
  color: string;
};

export type LoopProgressState = {
  id: string;
  label: string;
  current: number;
  total: number;
  depth: number;
  color: string;
  detail?: string;
};

export type CallFrameState = {
  id: string;
  parentId: string | null;
  label: string;
  detail?: string;
  depth: number;
  color: string;
  status: "open" | "complete";
  range?: {
    start: number;
    end: number;
  };
};

export type TreeNodeState = {
  id: string;
  itemId: string;
  label: string;
  parentId: string | null;
  depth: number;
  order: number;
  x: number;
  y: number;
  color: string;
};

export type TreeEdgeState = {
  id: string;
  from: string;
  to: string;
};

export type TreeVisualState = {
  nodes: Record<string, TreeNodeState>;
  edges: TreeEdgeState[];
  rootId: string | null;
  activeNodeId: string | null;
  visitedNodeIds: string[];
  queuedNodeIds: string[];
  traversalLabel: string;
};

export type VisualState = {
  items: VisualItem[];
  lanes: Record<LaneId, Array<string | null>>;
  pointers: Record<string, PointerState>;
  ranges: Record<string, RangeState>;
  loops: Record<string, LoopProgressState>;
  callFrames: Record<string, CallFrameState>;
  activeCallId: string | null;
  activeCompare: string[];
  activeMoved: string[];
  sortedIds: string[];
  tree?: TreeVisualState;
  message: string;
  codeLine: number | null;
};

export type TraceEvent =
  | {
      type: "explain";
      message: string;
      codeLine?: number;
    }
  | {
      type: "compare";
      itemIds: [string, string];
      indices?: [number, number];
      message: string;
      codeLine?: number;
    }
  | {
      type: "swap";
      lane?: LaneId;
      indices: [number, number];
      message: string;
      codeLine?: number;
    }
  | {
      type: "move";
      from: LanePosition;
      to: LanePosition;
      itemId?: string;
      message: string;
      codeLine?: number;
    }
  | {
      type: "setPointer";
      name: string;
      pointer: PointerState | null;
      message?: string;
      codeLine?: number;
    }
  | {
      type: "setRange";
      name: string;
      range: RangeState | null;
      message?: string;
      codeLine?: number;
    }
  | {
      type: "setLoop";
      id: string;
      loop: Omit<LoopProgressState, "id"> | null;
      message?: string;
      codeLine?: number;
    }
  | {
      type: "enterCall";
      frame: Omit<CallFrameState, "status">;
      message?: string;
      codeLine?: number;
    }
  | {
      type: "exitCall";
      id: string;
      message?: string;
      codeLine?: number;
    }
  | {
      type: "setTreeFocus";
      nodeId: string | null;
      message?: string;
      codeLine?: number;
    }
  | {
      type: "visitTreeNode";
      nodeId: string;
      message: string;
      codeLine?: number;
    }
  | {
      type: "markSorted";
      itemIds: string[];
      message?: string;
      codeLine?: number;
    };

export type AlgorithmTrace = {
  algorithmId: AlgorithmId;
  title: string;
  description: string;
  sampleProgram: string;
  initialState: VisualState;
  events: TraceEvent[];
};

export type AlgorithmDefinition = {
  id: AlgorithmId;
  title: string;
  description: string;
  defaultInput: number[];
  sampleProgram: string;
  generateTrace: (input: number[]) => AlgorithmTrace;
};
