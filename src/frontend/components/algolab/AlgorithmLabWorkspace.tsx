import { Braces, Code2, Gauge, ListChecks, Pause, Play, RotateCcw, Shuffle, SkipBack, SkipForward, Sparkles } from "lucide-react";
import { createPortal } from "react-dom";
import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";
import { api, type AlgorithmInstrumentationResponse } from "../../api";
import { ALGORITHM_DEFINITIONS, findAlgorithmDefinition, SORTING_PRESETS } from "./algorithms";
import { runInstrumentedTrace } from "./customTrace";
import { deriveTraceFrame, getLaneValues } from "./trace";
import type { AlgorithmId, AlgorithmTrace, LaneId, TraceEvent, TreeNodeState, VisualItem, VisualState } from "./types";

const SPEED_MIN_MS = 180;
const SPEED_MAX_MS = 1400;
const CALL_TREE_NODE_WIDTH = 190;
const CALL_TREE_NODE_HEIGHT = 58;
const CALL_TREE_LEVEL_GAP = 74;
const CALL_TREE_SIBLING_GAP = 28;
const CALL_TREE_ROOT_GAP = 44;
const CALL_TREE_PADDING = 28;
const CALL_TREE_FIT_ZOOM_MIN = 0.24;
const CALL_TREE_FIT_ZOOM_MAX = 1.35;
const CALL_TREE_WINDOW_MIN_WIDTH = 280;
const CALL_TREE_WINDOW_MIN_HEIGHT = 220;
const TREE_NODE_RADIUS = 28;
const TREE_LEVEL_GAP = 96;
const TREE_TOP_PAD = 64;
const TREE_SIDE_PAD = 86;
const TREE_VISIT_Y_OFFSET = 84;
const DEFAULT_LEARNER_PROGRAM = `function bubbleSort(a) {
  for (let pass = 0; pass < a.length - 1; pass += 1) {
    for (let i = 0; i < a.length - pass - 1; i += 1) {
      if (a[i] > a[i + 1]) {
        const temp = a[i];
        a[i] = a[i + 1];
        a[i + 1] = temp;
      }
    }
  }
  return a;
}`;

type ParsedInput = {
  values: number[];
  error: string;
};

type CallTreeLayoutNode = {
  frame: VisualState["callFrames"][string];
  children: CallTreeLayoutNode[];
  x: number;
  y: number;
};

type CallTreeLayout = {
  roots: CallTreeLayoutNode[];
  nodes: CallTreeLayoutNode[];
  width: number;
  height: number;
};

type CallTreeWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CallTreeWindowInteraction = {
  mode: "move" | "resize";
  startX: number;
  startY: number;
  startBounds: CallTreeWindowBounds;
};

type VisualItemPosition = {
  item: VisualState["items"][number];
  lane: LaneId;
  index: number;
  x: number;
  y: number;
};

type TreeNodePosition = {
  node: TreeNodeState;
  item: VisualItem;
  x: number;
  y: number;
};

export default function AlgorithmLabWorkspace() {
  const [algorithmId, setAlgorithmId] = useState<AlgorithmId>("quicksort");
  const definition = useMemo(() => findAlgorithmDefinition(algorithmId), [algorithmId]);
  const [inputText, setInputText] = useState(() => definition.defaultInput.join(", "));
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(620);
  const [traceMode, setTraceMode] = useState<"preset" | "custom">("preset");
  const [learnerCode, setLearnerCode] = useState(DEFAULT_LEARNER_PROGRAM);
  const [instrumentedCode, setInstrumentedCode] = useState("");
  const [instrumentationSummary, setInstrumentationSummary] = useState("");
  const [instrumentationWarnings, setInstrumentationWarnings] = useState<string[]>([]);
  const [customTrace, setCustomTrace] = useState<AlgorithmTrace | null>(null);
  const [customStatus, setCustomStatus] = useState("");
  const [instrumenting, setInstrumenting] = useState(false);
  const [runningCustom, setRunningCustom] = useState(false);

  const parsedInput = useMemo(() => parseArrayInput(inputText), [inputText]);
  const presetTrace = useMemo(() => {
    if (parsedInput.error) return null;
    return definition.generateTrace(parsedInput.values);
  }, [definition, parsedInput.error, parsedInput.values]);
  const trace = traceMode === "custom" ? customTrace : presetTrace;
  const maxStep = trace?.events.length ?? 0;
  const frame = useMemo(() => (trace ? deriveTraceFrame(trace, step) : null), [trace, step]);
  const currentEvent = trace && step > 0 ? trace.events[step - 1] : null;
  const stageSummary = frame ? frameValueSummary(frame) : "";
  const activeTitle = traceMode === "custom" ? trace?.title ?? "Custom Trace" : definition.title;
  const activeDescription = traceMode === "custom" ? instrumentationSummary || "Instrument learner code, then generate a trace locally." : definition.description;
  const activeProgram = traceMode === "custom" && instrumentedCode ? instrumentedCode : definition.sampleProgram;

  useEffect(() => {
    setStep(0);
    setPlaying(false);
  }, [trace]);

  useEffect(() => {
    if (step > maxStep) setStep(maxStep);
  }, [maxStep, step]);

  useEffect(() => {
    if (!playing || !trace) return;
    if (step >= maxStep) {
      setPlaying(false);
      return;
    }
    const timeout = window.setTimeout(() => setStep((current) => Math.min(current + 1, maxStep)), speedMs);
    return () => window.clearTimeout(timeout);
  }, [maxStep, playing, speedMs, step, trace]);

  function chooseAlgorithm(nextId: AlgorithmId) {
    const nextDefinition = findAlgorithmDefinition(nextId);
    setAlgorithmId(nextId);
    setInputText(nextDefinition.defaultInput.join(", "));
    setTraceMode("preset");
  }

  function goToStep(nextStep: number) {
    setPlaying(false);
    setStep(Math.max(0, Math.min(nextStep, maxStep)));
  }

  async function instrumentLearnerCode() {
    if (!learnerCode.trim()) {
      setCustomStatus("Add learner code first.");
      return;
    }
    if (parsedInput.error) {
      setCustomStatus(parsedInput.error);
      return;
    }
    setInstrumenting(true);
    setCustomStatus("Asking the LLM to add visual calls...");
    setInstrumentationWarnings([]);
    try {
      const response = await api<AlgorithmInstrumentationResponse>("/api/algolab/instrument", {
        method: "POST",
        body: JSON.stringify({
          source: learnerCode,
          language: "auto"
        })
      });
      setInstrumentedCode(response.instrumentedCode);
      setInstrumentationSummary(response.summary);
      setInstrumentationWarnings(response.warnings);
      await runCustomTrace(response.instrumentedCode, response.summary);
    } catch (err) {
      setCustomTrace(null);
      setTraceMode("custom");
      setCustomStatus(err instanceof Error ? err.message : "Instrumentation failed.");
    } finally {
      setInstrumenting(false);
    }
  }

  async function runCustomTrace(nextCode = instrumentedCode, nextSummary = instrumentationSummary) {
    if (!nextCode.trim()) {
      setCustomStatus("Instrument the code first.");
      return;
    }
    if (parsedInput.error) {
      setCustomStatus(parsedInput.error);
      return;
    }
    setRunningCustom(true);
    setTraceMode("custom");
    setCustomStatus("Generating trace locally...");
    try {
      const result = await runInstrumentedTrace({
        input: parsedInput.values,
        instrumentedCode: nextCode,
        sourceProgram: nextCode,
        summary: nextSummary
      });
      setCustomTrace(result.trace);
      setStep(0);
      setPlaying(false);
      const suffix = result.finalValues.length ? ` Final: ${result.finalValues.join(", ")}` : "";
      setCustomStatus(`Local trace ready: ${result.trace.events.length} steps.${suffix}`);
    } catch (err) {
      setCustomTrace(null);
      setCustomStatus(err instanceof Error ? err.message : "Local trace generation failed.");
    } finally {
      setRunningCustom(false);
    }
  }

  const toolbar = (
    <div className="panel-toolbar app-topbar-toolbar algolab-topbar-toolbar">
      <div className="panel-book-meta" title={definition.title}>
        <span className="topbar-book-label">Algorithm Lab</span>
        <strong>{activeTitle}</strong>
      </div>
      <button className="tool-button" onClick={() => goToStep(0)} disabled={!trace || step === 0} title="Reset trace">
        <RotateCcw size={16} />
      </button>
      <button className="tool-button" onClick={() => goToStep(step - 1)} disabled={!trace || step === 0} title="Previous step">
        <SkipBack size={16} />
      </button>
      <button className={`tool-button ${playing ? "active" : ""}`} onClick={() => setPlaying((current) => !current)} disabled={!trace || maxStep === 0} title={playing ? "Pause" : "Play"}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <button className="tool-button" onClick={() => goToStep(step + 1)} disabled={!trace || step >= maxStep} title="Next step">
        <SkipForward size={16} />
      </button>
      <label className="algolab-speed" title="Playback speed">
        <Gauge size={14} />
        <input
          type="range"
          min={SPEED_MIN_MS}
          max={SPEED_MAX_MS}
          step={80}
          value={SPEED_MAX_MS + SPEED_MIN_MS - speedMs}
          onChange={(event) => setSpeedMs(SPEED_MAX_MS + SPEED_MIN_MS - Number(event.target.value))}
        />
      </label>
      <span className="writer-topbar-stat">step {step}/{maxStep}</span>
      <span className="writer-topbar-stat">{parsedInput.values.length || 0} items</span>
    </div>
  );

  return (
    <section className="algolab-workspace">
      {createPortal(toolbar, document.getElementById("app-topbar-tools") ?? document.body)}
      <aside className="algolab-sidebar">
        <section className="algolab-panel">
          <div className="algolab-panel-title">
            <ListChecks size={17} />
            <strong>Algorithms</strong>
          </div>
          <div className="algolab-mode-switch" aria-label="Trace mode">
            <button className={traceMode === "preset" ? "active" : ""} onClick={() => setTraceMode("preset")}>
              Preset
            </button>
            <button className={traceMode === "custom" ? "active" : ""} onClick={() => setTraceMode("custom")}>
              Custom
            </button>
          </div>
          <div className="algolab-choice-list">
            {ALGORITHM_DEFINITIONS.map((item) => (
              <button key={item.id} className={item.id === algorithmId ? "algolab-choice active" : "algolab-choice"} onClick={() => chooseAlgorithm(item.id)}>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="algolab-panel">
          <div className="algolab-panel-title">
            <Shuffle size={17} />
            <strong>Input</strong>
          </div>
          <textarea className="algolab-input" value={inputText} onChange={(event) => setInputText(event.target.value)} spellCheck={false} />
          <div className="algolab-preset-row">
            {SORTING_PRESETS.map((preset) => (
              <button key={preset.label} onClick={() => setInputText(preset.values.join(", "))}>
                {preset.label}
              </button>
            ))}
          </div>
          {parsedInput.error && <div className="inline-error">{parsedInput.error}</div>}
        </section>

        <section className="algolab-panel algolab-instrument-panel">
          <div className="algolab-panel-title">
            <Sparkles size={17} />
            <strong>Instrument Code</strong>
          </div>
          <textarea className="algolab-code-draft" value={learnerCode} onChange={(event) => setLearnerCode(event.target.value)} spellCheck={false} />
          <div className="algolab-action-row">
            <button onClick={() => void instrumentLearnerCode()} disabled={instrumenting || runningCustom}>
              <Sparkles size={14} />
              {instrumenting ? "Instrumenting" : "Instrument"}
            </button>
            <button onClick={() => void runCustomTrace()} disabled={!instrumentedCode || instrumenting || runningCustom}>
              <Play size={14} />
              {runningCustom ? "Running" : "Run local trace"}
            </button>
          </div>
          {customStatus && <div className="algolab-status">{customStatus}</div>}
          {instrumentationWarnings.length > 0 && (
            <div className="algolab-warning-list">
              {instrumentationWarnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          )}
        </section>

        <section className="algolab-panel algolab-code-panel">
          <div className="algolab-panel-title">
            <Code2 size={17} />
            <strong>{traceMode === "custom" ? "Instrumented Program" : "Guided Sample"}</strong>
          </div>
          <CodeListing source={activeProgram} activeLine={frame?.codeLine ?? null} />
        </section>
      </aside>

      <main className="algolab-stage-panel">
        <div className="algolab-stage-header">
          <div>
            <span className="writer-eyebrow">Trace</span>
            <h1>{activeTitle}</h1>
          </div>
          <div className="writer-editor-metrics">
            <span>{eventTypeLabel(currentEvent)}</span>
            <span>{stageSummary}</span>
          </div>
        </div>
        {frame ? (
          <>
            <AlgorithmVisualizer frame={frame} />
            <input
              className="algolab-scrubber"
              type="range"
              min={0}
              max={maxStep}
              value={step}
              onChange={(event) => goToStep(Number(event.target.value))}
              aria-label="Trace step"
            />
          </>
        ) : (
          <div className="algolab-empty-state">
            <Braces size={36} />
            <h1>{traceMode === "custom" ? "Waiting for local trace" : "Waiting for valid input"}</h1>
            <p>{parsedInput.error || activeDescription}</p>
          </div>
        )}
      </main>

      <aside className="algolab-inspector">
        <section className="algolab-panel algolab-step-panel">
          <div className="algolab-panel-title">
            <Braces size={17} />
            <strong>Current Step</strong>
          </div>
          <div className="algolab-step-message">
            <span>{eventTypeLabel(currentEvent)}</span>
            <p>{frame?.message ?? "No trace frame selected."}</p>
          </div>
          {frame && <FrameDetails frame={frame} />}
        </section>

        {frame && Object.keys(frame.loops).length > 0 && (
          <section className="algolab-panel algolab-execution-panel">
            <div className="algolab-panel-title">
              <Braces size={17} />
              <strong>Execution</strong>
            </div>
            <ExecutionDetails frame={frame} />
          </section>
        )}

        <section className="algolab-panel algolab-timeline-panel">
          <div className="algolab-panel-title">
            <ListChecks size={17} />
            <strong>Timeline</strong>
          </div>
          <div className="algolab-timeline">
            <button className={step === 0 ? "active" : ""} onClick={() => goToStep(0)}>
              <span>0</span>
              <strong>{trace?.initialState.tree ? "Initial tree" : "Initial array"}</strong>
            </button>
            {trace?.events.map((event, index) => (
              <button key={`${event.type}-${index}`} className={step === index + 1 ? "active" : ""} onClick={() => goToStep(index + 1)}>
                <span>{index + 1}</span>
                <strong>{eventTypeLabel(event)}</strong>
                <small>{eventMessage(event)}</small>
              </button>
            ))}
          </div>
        </section>
      </aside>
      {frame && Object.keys(frame.callFrames).length > 0 && <FloatingCallStackWidget frame={frame} />}
    </section>
  );
}

function AlgorithmVisualizer({ frame }: { frame: VisualState }) {
  if (frame.tree) return <TreeVisualizer frame={frame} />;

  const slotCount = frame.lanes.array.length;
  const slotWidth = 72;
  const leftPad = 92;
  const width = Math.max(620, leftPad * 2 + (slotCount - 1) * slotWidth);
  const visualHeight = 430;
  const laneY: Record<LaneId, number> = { array: 178, aux: 326 };
  const slotLineOffset = 64;
  const slotIndexOffset = 88;
  const itemById = new Map(frame.items.map((item) => [item.id, item]));
  const positionById = new Map<string, VisualItemPosition>();
  (["array", "aux"] as LaneId[]).forEach((lane) => {
    frame.lanes[lane].forEach((itemId, index) => {
      if (!itemId) return;
      const item = itemById.get(itemId);
      if (!item) return;
      positionById.set(itemId, {
        item,
        lane,
        index,
        x: leftPad + index * slotWidth,
        y: laneY[lane]
      });
    });
  });
  const sorted = new Set(frame.sortedIds);
  const comparing = new Set(frame.activeCompare);
  const moved = new Set(frame.activeMoved);
  const comparison = buildComparisonAnnotation(frame, positionById);

  return (
    <div className="algolab-visual-wrap">
      <svg className="algolab-visual" viewBox={`0 0 ${width} ${visualHeight}`} role="img" aria-label="Algorithm movement trace">
        {(["array", "aux"] as LaneId[]).map((lane) => (
          <g key={lane}>
            <text className="algolab-lane-label" x={18} y={laneY[lane] + 5}>{lane === "array" ? "array" : "aux"}</text>
            {frame.lanes[lane].map((_itemId, index) => {
              const x = leftPad + index * slotWidth;
              return (
                <g key={`${lane}-slot-${index}`}>
                  <line className="algolab-slot-line" x1={x - 27} x2={x + 27} y1={laneY[lane] + slotLineOffset} y2={laneY[lane] + slotLineOffset} />
                  <text className="algolab-slot-index" x={x} y={laneY[lane] + slotIndexOffset}>{index}</text>
                </g>
              );
            })}
          </g>
        ))}

        {Object.entries(frame.ranges).map(([name, range]) => {
          const x = leftPad + range.start * slotWidth - 34;
          const rectWidth = (range.end - range.start) * slotWidth + 68;
          const y = laneY[range.lane] - 52;
          const labelWidth = Math.max(68, range.label.length * 7 + 18);
          return (
            <g key={name}>
              <rect className="algolab-range" x={x} y={y} width={rectWidth} height={132} rx={8} style={{ stroke: range.color }} />
              <rect className="algolab-range-label-bg" x={x + 8} y={y - 25} width={labelWidth} height={20} rx={10} style={{ stroke: range.color }} />
              <text className="algolab-range-label" x={x + 18} y={y - 11} style={{ fill: range.color }}>{range.label}</text>
            </g>
          );
        })}

        {comparison && <ComparisonArc comparison={comparison} />}

        {Object.entries(frame.pointers).map(([name, pointer]) => {
          const x = leftPad + pointer.index * slotWidth;
          const y = laneY[pointer.lane] - 96;
          return (
            <g key={name} className="algolab-pointer">
              <path d={`M ${x - 8} ${y} L ${x + 8} ${y} L ${x} ${y + 15} Z`} style={{ fill: pointer.color }} />
              <text x={x} y={y - 10} style={{ fill: pointer.color }}>{pointer.label}</text>
            </g>
          );
        })}

        {(["array", "aux"] as LaneId[]).flatMap((lane) =>
          frame.lanes[lane].map((itemId, index) => {
            if (!itemId) return null;
            const item = itemById.get(itemId);
            if (!item) return null;
            const position = positionById.get(itemId);
            if (!position) return null;
            const classes = [
              "algolab-item",
              comparing.has(itemId) ? "comparing" : "",
              moved.has(itemId) ? "moved" : "",
              sorted.has(itemId) ? "sorted" : ""
            ].filter(Boolean).join(" ");
            return (
              <g key={itemId} className={classes} transform={`translate(${position.x} ${position.y})`}>
                <circle r={25} fill={item.color} />
                <text className="algolab-item-value" y={5}>{item.value}</text>
                <text className="algolab-item-id" y={46}>{itemOrdinal(item.id)}</text>
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
}

function TreeVisualizer({ frame }: { frame: VisualState }) {
  const tree = frame.tree;
  if (!tree) return null;

  const nodes = Object.values(tree.nodes).sort((left, right) => left.depth - right.depth || left.order - right.order);
  const itemById = new Map(frame.items.map((item) => [item.id, item]));
  const maxDepth = nodes.reduce((depth, node) => Math.max(depth, node.depth), 0);
  const levelCapacity = 2 ** Math.max(1, maxDepth);
  const width = Math.max(680, Math.min(1160, TREE_SIDE_PAD * 2 + levelCapacity * 118));
  const height = Math.max(360, TREE_TOP_PAD + maxDepth * TREE_LEVEL_GAP + TREE_VISIT_Y_OFFSET + 62);
  const positionById = new Map<string, TreeNodePosition>();

  nodes.forEach((node) => {
    const item = itemById.get(node.itemId);
    if (!item) return;
    positionById.set(node.id, {
      node,
      item,
      x: TREE_SIDE_PAD + node.x * (width - TREE_SIDE_PAD * 2),
      y: TREE_TOP_PAD + node.y * TREE_LEVEL_GAP
    });
  });

  const visited = new Set(tree.visitedNodeIds);
  const activeNode = tree.activeNodeId ? positionById.get(tree.activeNodeId) : null;
  const visitY = TREE_TOP_PAD + maxDepth * TREE_LEVEL_GAP + TREE_VISIT_Y_OFFSET;

  return (
    <div className="algolab-visual-wrap">
      <svg className="algolab-visual algolab-tree-visual" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tree traversal trace">
        <g className="algolab-tree-edges">
          {tree.edges.map((edge) => {
            const parent = positionById.get(edge.from);
            const child = positionById.get(edge.to);
            if (!parent || !child) return null;
            const inVisitedPath = visited.has(parent.node.id) && visited.has(child.node.id);
            return <path key={edge.id} className={inVisitedPath ? "algolab-tree-edge visited" : "algolab-tree-edge"} d={treeEdgePath(parent, child)} />;
          })}
        </g>

        {activeNode && (
          <g className="algolab-tree-focus" transform={`translate(${activeNode.x} ${activeNode.y})`}>
            <circle r={TREE_NODE_RADIUS + 13} />
          </g>
        )}

        <g>
          {nodes.map((node) => {
            const position = positionById.get(node.id);
            if (!position) return null;
            const visitIndex = tree.visitedNodeIds.indexOf(node.id);
            const isVisited = visitIndex >= 0;
            const isActive = tree.activeNodeId === node.id;
            const classes = ["algolab-tree-node", isVisited ? "visited" : "", isActive ? "active" : ""].filter(Boolean).join(" ");
            return (
              <g key={node.id} className={classes} transform={`translate(${position.x} ${position.y})`}>
                <title>{`${node.label}${isVisited ? `, visit ${visitIndex + 1}` : ""}`}</title>
                <circle className="algolab-tree-node-ring" r={TREE_NODE_RADIUS + 5} />
                <circle className="algolab-tree-node-core" r={TREE_NODE_RADIUS} fill={node.color} />
                <text className="algolab-tree-node-value" y={5}>{node.label}</text>
                <text className="algolab-tree-node-id" y={TREE_NODE_RADIUS + 24}>{itemOrdinal(node.itemId)}</text>
                {isVisited && (
                  <g className="algolab-tree-visit-badge" transform={`translate(${TREE_NODE_RADIUS - 4} ${-TREE_NODE_RADIUS + 3})`}>
                    <circle r={11} />
                    <text y={4}>{visitIndex + 1}</text>
                  </g>
                )}
              </g>
            );
          })}
        </g>

        <g className="algolab-tree-visit-order" transform={`translate(${TREE_SIDE_PAD} ${visitY})`}>
          <text className="algolab-tree-order-label" x={0} y={0}>{tree.traversalLabel} visits</text>
          {tree.visitedNodeIds.map((nodeId, index) => {
            const position = positionById.get(nodeId);
            if (!position) return null;
            const x = index * 52;
            return (
              <g key={`${nodeId}-order`} transform={`translate(${x} 34)`}>
                <circle r={18} fill={position.node.color} />
                <text className="algolab-tree-order-value" y={5}>{position.node.label}</text>
              </g>
            );
          })}
          {tree.visitedNodeIds.length === 0 && <text className="algolab-tree-order-empty" x={0} y={38}>waiting for first visit</text>}
        </g>
      </svg>
    </div>
  );
}

function ComparisonArc({
  comparison
}: {
  comparison: {
    left: VisualItemPosition;
    right: VisualItemPosition;
    label: string;
  };
}) {
  const startX = comparison.left.x;
  const endX = comparison.right.x;
  const startY = comparison.left.y - 50;
  const endY = comparison.right.y - 50;
  const horizontalDistance = Math.abs(endX - startX);
  const verticalDistance = Math.abs(endY - startY);
  const lift = Math.max(34, Math.min(92, horizontalDistance * 0.42 + verticalDistance * 0.18));
  const controlX = (startX + endX) / 2;
  const controlY = Math.max(58, Math.min(startY, endY) - lift);
  const labelWidth = Math.max(54, comparison.label.length * 8 + 18);
  const labelY = controlY - 17;

  return (
    <g className="algolab-compare-arc">
      <path d={`M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`} />
      <circle cx={startX} cy={startY} r={4} />
      <circle cx={endX} cy={endY} r={4} />
      <rect x={controlX - labelWidth / 2} y={labelY - 11} width={labelWidth} height={22} rx={11} />
      <text x={controlX} y={labelY + 4}>{comparison.label}</text>
    </g>
  );
}

function buildComparisonAnnotation(frame: VisualState, positionById: Map<string, VisualItemPosition>) {
  if (frame.activeCompare.length < 2) return null;
  const left = positionById.get(frame.activeCompare[0]);
  const right = positionById.get(frame.activeCompare[1]);
  if (!left || !right) return null;
  const operator = left.item.value === right.item.value ? "=" : left.item.value < right.item.value ? "<" : ">";
  return {
    left,
    right,
    label: `${left.item.value} ${operator} ${right.item.value}`
  };
}

function treeEdgePath(parent: TreeNodePosition, child: TreeNodePosition): string {
  const startY = parent.y + TREE_NODE_RADIUS + 7;
  const endY = child.y - TREE_NODE_RADIUS - 7;
  const midY = startY + (endY - startY) * 0.54;
  return `M ${parent.x} ${startY} C ${parent.x} ${midY}, ${child.x} ${midY}, ${child.x} ${endY}`;
}

function CodeListing({ source, activeLine }: { source: string; activeLine: number | null }) {
  return (
    <ol className="algolab-code">
      {source.split("\n").map((line, index) => {
        const lineNumber = index + 1;
        return (
          <li key={lineNumber} className={activeLine === lineNumber ? "active" : ""}>
            <code>{line || " "}</code>
          </li>
        );
      })}
    </ol>
  );
}

function FrameDetails({ frame }: { frame: VisualState }) {
  const pointers = Object.entries(frame.pointers);
  const ranges = Object.entries(frame.ranges);
  const activeLoops = Object.keys(frame.loops).length;
  const openCalls = Object.values(frame.callFrames).filter((callFrame) => callFrame.status === "open").length;
  const visitedCount = frame.tree ? frame.tree.visitedNodeIds.length : frame.sortedIds.length;
  return (
    <div className="algolab-detail-grid">
      <span>
        <strong>{frame.activeCompare.length || 0}</strong>
        <small>compared</small>
      </span>
      <span>
        <strong>{frame.activeMoved.length || 0}</strong>
        <small>{frame.tree ? "focused" : "moving"}</small>
      </span>
      <span>
        <strong>{visitedCount}</strong>
        <small>{frame.tree ? "visited" : "settled"}</small>
      </span>
      <span>
        <strong>{activeLoops}</strong>
        <small>loops</small>
      </span>
      <span>
        <strong>{openCalls}</strong>
        <small>calls</small>
      </span>
      {pointers.map(([name, pointer]) => (
        <span key={name}>
          <strong>{pointer.label}</strong>
          <small>{pointer.lane}[{pointer.index}]</small>
        </span>
      ))}
      {ranges.map(([name, range]) => (
        <span key={name}>
          <strong>{range.label}</strong>
          <small>{range.start}..{range.end}</small>
        </span>
      ))}
    </div>
  );
}

function ExecutionDetails({ frame }: { frame: VisualState }) {
  const loops = Object.values(frame.loops).sort((left, right) => left.depth - right.depth || left.label.localeCompare(right.label));

  return (
    <div className="algolab-execution">
      {loops.length > 0 && (
        <div className="algolab-loop-list">
          {loops.map((loop) => {
            const percent = loop.total > 0 ? Math.max(0, Math.min(100, (loop.current / loop.total) * 100)) : 0;
            return (
              <div key={loop.id} className="algolab-loop-progress" style={{ borderLeftColor: loop.color }}>
                <div className="algolab-loop-row">
                  <strong>{loop.label}</strong>
                  <span>{loop.current}/{loop.total}</span>
                </div>
                <div className="algolab-loop-meter" aria-label={`${loop.label} progress`}>
                  <span style={{ width: `${percent}%`, background: loop.color }} />
                </div>
                {loop.detail && <small>{loop.detail}</small>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FloatingCallStackWidget({ frame }: { frame: VisualState }) {
  const calls = Object.values(frame.callFrames);
  const activePath = activeCallPath(frame);
  const callTree = buildCallTreeLayout(calls);
  const [bounds, setBounds] = useState<CallTreeWindowBounds>(() => initialCallTreeWindowBounds());
  const [interaction, setInteraction] = useState<CallTreeWindowInteraction | null>(null);
  const treeViewportWidth = Math.max(160, bounds.width - 24);
  const treeViewportHeight = Math.max(120, bounds.height - 76);
  const fitZoom = fitCallTreeZoom(callTree, treeViewportWidth, treeViewportHeight);

  useEffect(() => {
    if (!interaction) return;
    const activeInteraction = interaction;

    function handleMouseMove(event: MouseEvent) {
      const dx = event.clientX - activeInteraction.startX;
      const dy = event.clientY - activeInteraction.startY;
      const nextBounds =
        activeInteraction.mode === "move"
          ? {
              ...activeInteraction.startBounds,
              x: activeInteraction.startBounds.x + dx,
              y: activeInteraction.startBounds.y + dy
            }
          : {
              ...activeInteraction.startBounds,
              width: activeInteraction.startBounds.width + dx,
              height: activeInteraction.startBounds.height + dy
            };
      setBounds(clampCallTreeWindowBounds(nextBounds));
    }

    function handleMouseUp() {
      setInteraction(null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [interaction]);

  function startMove(event: ReactMouseEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    setInteraction({
      mode: "move",
      startX: event.clientX,
      startY: event.clientY,
      startBounds: bounds
    });
  }

  function startResize(event: ReactMouseEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setInteraction({
      mode: "resize",
      startX: event.clientX,
      startY: event.clientY,
      startBounds: bounds
    });
  }

  return (
    <section className="algolab-call-window" style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}>
      <div className="algolab-call-window-header" onMouseDown={startMove}>
        <div>
          <Braces size={15} />
          <strong>Call Stack</strong>
        </div>
        <span>auto {Math.round(fitZoom * 100)}%</span>
      </div>
      <CallTreeSvg className="algolab-call-tree-window-canvas" layout={callTree} activeCallId={frame.activeCallId} activePath={activePath} zoom={fitZoom} />
      <button type="button" className="algolab-call-window-resize" onMouseDown={startResize} title="Resize call stack" aria-label="Resize call stack" />
    </section>
  );
}

function CallTreeSvg({
  layout,
  activeCallId,
  activePath,
  zoom,
  className = "algolab-call-tree"
}: {
  layout: CallTreeLayout;
  activeCallId: string | null;
  activePath: Set<string>;
  zoom: number;
  className?: string;
}) {
  const links = layout.nodes.flatMap((node) => node.children.map((child) => ({ parent: node, child })));
  const scaledWidth = layout.width * zoom;
  const scaledHeight = layout.height * zoom;

  return (
    <div className={className}>
      <svg width={scaledWidth} height={scaledHeight} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="Call stack tree">
        <g className="algolab-call-links">
          {links.map(({ parent, child }) => {
            const inStack = activePath.has(parent.frame.id) && activePath.has(child.frame.id);
            return (
              <path
                key={`${parent.frame.id}-${child.frame.id}`}
                className={inStack ? "algolab-call-link in-stack" : "algolab-call-link"}
                d={callLinkPath(parent, child)}
              />
            );
          })}
        </g>
        <g>
          {layout.nodes.map((node) => (
            <CallTreeSvgNode key={node.frame.id} node={node} activeCallId={activeCallId} activePath={activePath} />
          ))}
        </g>
      </svg>
    </div>
  );
}

function CallTreeSvgNode({
  node,
  activeCallId,
  activePath
}: {
  node: CallTreeLayoutNode;
  activeCallId: string | null;
  activePath: Set<string>;
}) {
  const { frame } = node;
  const isActive = frame.id === activeCallId;
  const isInStack = activePath.has(frame.id) && !isActive;
  const statusLabel = isActive ? "active" : frame.status === "complete" ? "done" : "open";
  const detail = frame.detail || (frame.range ? `${frame.range.start}..${frame.range.end}` : "");
  const className = [
    "algolab-call-svg-node",
    isActive ? "active" : "",
    isInStack ? "in-stack" : "",
    frame.status === "complete" ? "complete" : ""
  ].filter(Boolean).join(" ");
  const left = node.x - CALL_TREE_NODE_WIDTH / 2;
  const top = node.y - CALL_TREE_NODE_HEIGHT / 2;

  return (
    <g className={className} transform={`translate(${left} ${top})`}>
      <title>{`${frame.label}${detail ? `: ${detail}` : ""} (${statusLabel})`}</title>
      <rect className="algolab-call-node-shape" width={CALL_TREE_NODE_WIDTH} height={CALL_TREE_NODE_HEIGHT} rx={8} />
      <rect className="algolab-call-node-stripe" width={5} height={CALL_TREE_NODE_HEIGHT - 12} x={8} y={6} rx={2.5} style={{ fill: frame.color }} />
      <text className="algolab-call-node-label" x={22} y={21}>
        {truncateText(frame.label, 18)}
      </text>
      {detail && (
        <text className="algolab-call-node-detail" x={22} y={41}>
          {truncateText(detail, 20)}
        </text>
      )}
      <rect className="algolab-call-node-badge" x={CALL_TREE_NODE_WIDTH - 50} y={8} width={38} height={18} rx={9} />
      <text className="algolab-call-node-status" x={CALL_TREE_NODE_WIDTH - 31} y={21}>
        {statusLabel}
      </text>
    </g>
  );
}

function buildCallTreeLayout(frames: Array<VisualState["callFrames"][string]>): CallTreeLayout {
  const nodeById = new Map<string, CallTreeLayoutNode>();
  frames.forEach((frame) => {
    nodeById.set(frame.id, { frame, children: [], x: 0, y: 0 });
  });

  const roots: CallTreeLayoutNode[] = [];
  frames.forEach((frame) => {
    const node = nodeById.get(frame.id);
    if (!node) return;
    const parent = frame.parentId ? nodeById.get(frame.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  let cursor = 0;
  let maxDepth = 0;

  function assign(node: CallTreeLayoutNode, depth: number): void {
    maxDepth = Math.max(maxDepth, depth);
    if (node.children.length === 0) {
      node.x = CALL_TREE_PADDING + cursor + CALL_TREE_NODE_WIDTH / 2;
      cursor += CALL_TREE_NODE_WIDTH + CALL_TREE_SIBLING_GAP;
    } else {
      node.children.forEach((child) => assign(child, depth + 1));
      const firstChild = node.children[0];
      const lastChild = node.children[node.children.length - 1];
      node.x = (firstChild.x + lastChild.x) / 2;
    }
    node.y = CALL_TREE_PADDING + CALL_TREE_NODE_HEIGHT / 2 + depth * (CALL_TREE_NODE_HEIGHT + CALL_TREE_LEVEL_GAP);
  }

  roots.forEach((root, index) => {
    if (index > 0) cursor += CALL_TREE_ROOT_GAP;
    assign(root, 0);
  });

  const nodes = flattenCallTree(roots);
  const usedWidth = nodes.length > 0 ? Math.max(...nodes.map((node) => node.x + CALL_TREE_NODE_WIDTH / 2)) + CALL_TREE_PADDING : CALL_TREE_NODE_WIDTH + CALL_TREE_PADDING * 2;
  const height = CALL_TREE_PADDING * 2 + CALL_TREE_NODE_HEIGHT + maxDepth * (CALL_TREE_NODE_HEIGHT + CALL_TREE_LEVEL_GAP);

  return {
    roots,
    nodes,
    width: Math.max(usedWidth, CALL_TREE_NODE_WIDTH + CALL_TREE_PADDING * 2),
    height
  };
}

function flattenCallTree(roots: CallTreeLayoutNode[]): CallTreeLayoutNode[] {
  const nodes: CallTreeLayoutNode[] = [];
  const visit = (node: CallTreeLayoutNode) => {
    nodes.push(node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return nodes;
}

function callLinkPath(parent: CallTreeLayoutNode, child: CallTreeLayoutNode): string {
  const startY = parent.y + CALL_TREE_NODE_HEIGHT / 2;
  const endY = child.y - CALL_TREE_NODE_HEIGHT / 2;
  const midY = startY + (endY - startY) * 0.58;
  return `M ${parent.x} ${startY} C ${parent.x} ${midY}, ${child.x} ${midY}, ${child.x} ${endY}`;
}

function initialCallTreeWindowBounds(): CallTreeWindowBounds {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  return clampCallTreeWindowBounds({
    x: Math.max(18, viewportWidth - 458),
    y: 96,
    width: 380,
    height: 320
  });
}

function clampCallTreeWindowBounds(bounds: CallTreeWindowBounds): CallTreeWindowBounds {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const width = Math.max(CALL_TREE_WINDOW_MIN_WIDTH, Math.min(bounds.width, Math.max(CALL_TREE_WINDOW_MIN_WIDTH, viewportWidth - 32)));
  const height = Math.max(CALL_TREE_WINDOW_MIN_HEIGHT, Math.min(bounds.height, Math.max(CALL_TREE_WINDOW_MIN_HEIGHT, viewportHeight - 116)));
  return {
    x: Math.max(12, Math.min(bounds.x, Math.max(12, viewportWidth - 88))),
    y: Math.max(12, Math.min(bounds.y, Math.max(12, viewportHeight - 112))),
    width,
    height
  };
}

function fitCallTreeZoom(layout: CallTreeLayout, viewportWidth: number, viewportHeight: number): number {
  const rawZoom = Math.min(viewportWidth / layout.width, viewportHeight / layout.height);
  return Math.max(CALL_TREE_FIT_ZOOM_MIN, Math.min(CALL_TREE_FIT_ZOOM_MAX, Number(rawZoom.toFixed(2))));
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function activeCallPath(frame: VisualState): Set<string> {
  const path = new Set<string>();
  let currentId = frame.activeCallId;
  while (currentId) {
    const callFrame = frame.callFrames[currentId];
    if (!callFrame) break;
    path.add(currentId);
    currentId = callFrame.parentId;
  }
  return path;
}

function frameValueSummary(frame: VisualState): string {
  if (frame.tree) {
    const itemById = new Map(frame.items.map((item) => [item.id, item.value]));
    const visitedValues = frame.tree.visitedNodeIds.flatMap((nodeId) => {
      const itemId = frame.tree?.nodes[nodeId]?.itemId;
      const value = itemId ? itemById.get(itemId) : undefined;
      return typeof value === "number" ? [value] : [];
    });
    return visitedValues.length > 0 ? `visited ${visitedValues.join(", ")}` : "tree ready";
  }
  return getLaneValues(frame).join(", ");
}

function parseArrayInput(text: string): ParsedInput {
  const tokens = text.split(/[,\s]+/).map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return { values: [], error: "Enter at least two numbers." };
  if (tokens.length < 2) return { values: [], error: "Use at least two numbers for a trace." };
  if (tokens.length > 12) return { values: [], error: "Use 12 or fewer numbers so the movement stays readable." };

  const values = tokens.map((token) => Number(token));
  if (values.some((value) => !Number.isFinite(value) || !Number.isInteger(value))) {
    return { values: [], error: "Only whole numbers are supported in this first version." };
  }
  if (values.some((value) => Math.abs(value) > 99)) {
    return { values: [], error: "Keep values between -99 and 99." };
  }
  return { values, error: "" };
}

function eventTypeLabel(event: TraceEvent | null): string {
  if (!event) return "Ready";
  switch (event.type) {
    case "setPointer":
      return "Pointer";
    case "setRange":
      return "Range";
    case "markSorted":
      return "Sorted";
    case "setLoop":
      return event.loop ? "Loop" : "Loop done";
    case "enterCall":
      return "Call";
    case "exitCall":
      return "Return";
    case "setTreeFocus":
      return "Tree focus";
    case "visitTreeNode":
      return "Visit";
    default:
      return event.type[0].toUpperCase() + event.type.slice(1);
  }
}

function eventMessage(event: TraceEvent): string {
  if ("message" in event && typeof event.message === "string") return event.message;
  return eventTypeLabel(event);
}

function itemOrdinal(itemId: string): string {
  const [, index] = itemId.split("-");
  const numericIndex = Number(index);
  return Number.isFinite(numericIndex) ? `id ${numericIndex + 1}` : itemId;
}
