import {
  Activity,
  AlertTriangle,
  Clock3,
  Database,
  Gauge,
  GitBranch,
  ListChecks,
  Network,
  Pause,
  Play,
  RadioTower,
  RotateCcw,
  Save,
  ServerCrash,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Zap
} from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import {
  CHANNEL_FAILURE_OPTIONS,
  CLOCK_OPTIONS,
  DATA_PATTERN_OPTIONS,
  DISTRIBUTED_ALGORITHM_DEFINITIONS,
  NODE_FAILURE_OPTIONS,
  RECOVERY_OPTIONS,
  SYNC_OPTIONS,
  TOPOLOGY_OPTIONS,
  algorithmTitle,
  defaultDistributedRunConfig,
  generateDistributedRun,
  generateRandomDistributedConfig,
  runDistributedStressTest,
  topologyTitle
} from "./simulation";
import type {
  ChannelFailureMode,
  ClockMode,
  DataSyncPattern,
  DistributedAlgorithmId,
  DistributedChannelState,
  DistributedDiagnostic,
  DistributedFrame,
  DistributedNodeState,
  DistributedRun,
  DistributedRunConfig,
  DistributedStressReport,
  DistributedTopologyId,
  ExecutionSyncMode,
  NodeFailureMode,
  RecoveryMode
} from "./types";

const SPEED_MIN_MS = 160;
const SPEED_MAX_MS = 1500;
const CONFIG_STORAGE_KEY = "distributedlab:config";
const SAVED_RUNS_STORAGE_KEY = "distributedlab:savedRuns";

export default function DistributedAlgorithmsWorkspace() {
  const [config, setConfigState] = useState<DistributedRunConfig>(() => loadConfig());
  const [runVersion, setRunVersion] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(620);
  const [savedRuns, setSavedRuns] = useState<DistributedRun[]>(() => loadSavedRuns());
  const [selectedSavedRunId, setSelectedSavedRunId] = useState<string | null>(null);
  const [stressReport, setStressReport] = useState<DistributedStressReport | null>(null);

  const generatedRun = useMemo(() => generateDistributedRun(config), [config, runVersion]);
  const selectedSavedRun = savedRuns.find((run) => run.id === selectedSavedRunId) ?? null;
  const run = selectedSavedRun ?? generatedRun;
  const maxStep = Math.max(0, run.frames.length - 1);
  const frame = run.frames[Math.min(step, maxStep)] ?? run.frames[0];
  const activeDiagnostics = frame?.diagnostics ?? [];
  const failingDiagnostics = activeDiagnostics.filter((diagnostic) => diagnostic.severity === "failure").length;
  const warningDiagnostics = activeDiagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;

  useEffect(() => {
    if (step > maxStep) setStep(maxStep);
  }, [maxStep, step]);

  useEffect(() => {
    if (!playing || !frame) return;
    if (step >= maxStep) {
      setPlaying(false);
      return;
    }
    const timeout = window.setTimeout(() => setStep((current) => Math.min(current + 1, maxStep)), speedMs);
    return () => window.clearTimeout(timeout);
  }, [frame, maxStep, playing, speedMs, step]);

  function updateConfig(patch: Partial<DistributedRunConfig>) {
    setConfigState((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setSelectedSavedRunId(null);
    setStressReport(null);
    setStep(0);
    setPlaying(false);
  }

  function rerun() {
    setSelectedSavedRunId(null);
    setRunVersion((version) => version + 1);
    setStep(0);
    setPlaying(false);
  }

  function randomRun() {
    const next = generateRandomDistributedConfig(config);
    setConfigState(next);
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
    setSelectedSavedRunId(null);
    setStressReport(null);
    setStep(0);
    setPlaying(false);
  }

  function goToStep(nextStep: number) {
    setPlaying(false);
    setStep(Math.max(0, Math.min(nextStep, maxStep)));
  }

  function saveRun() {
    const snapshot: DistributedRun = {
      ...run,
      id: `saved-${Date.now().toString(36)}`,
      name: `${run.name} (${run.result.status})`,
      createdAt: new Date().toISOString(),
      frames: run.frames.map((item) => ({ ...item }))
    };
    const next = [snapshot, ...savedRuns.filter((item) => item.id !== snapshot.id)].slice(0, 12);
    setSavedRuns(next);
    localStorage.setItem(SAVED_RUNS_STORAGE_KEY, JSON.stringify(next));
    setSelectedSavedRunId(snapshot.id);
  }

  function loadRun(savedRun: DistributedRun) {
    setConfigState(savedRun.config);
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(savedRun.config));
    setSelectedSavedRunId(savedRun.id);
    setStressReport(null);
    setStep(0);
    setPlaying(false);
  }

  function deleteRun(savedRunId: string) {
    const next = savedRuns.filter((item) => item.id !== savedRunId);
    setSavedRuns(next);
    localStorage.setItem(SAVED_RUNS_STORAGE_KEY, JSON.stringify(next));
    if (selectedSavedRunId === savedRunId) {
      setSelectedSavedRunId(null);
      setStep(0);
    }
  }

  function stressCurrentConfig() {
    setPlaying(false);
    setStressReport(runDistributedStressTest(config, 80));
  }

  const toolbar = (
    <div className="panel-toolbar app-topbar-toolbar distlab-topbar-toolbar">
      <div className="panel-book-meta" title={run.name}>
        <span className="topbar-book-label">Distributed Lab</span>
        <strong>{algorithmTitle(config.algorithmId)}</strong>
      </div>
      <button className="tool-button" onClick={() => goToStep(0)} disabled={step === 0} title="Reset run">
        <RotateCcw size={16} />
      </button>
      <button className="tool-button" onClick={() => goToStep(step - 1)} disabled={step === 0} title="Previous event">
        <SkipBack size={16} />
      </button>
      <button className={`tool-button ${playing ? "active" : ""}`} onClick={() => setPlaying((current) => !current)} disabled={maxStep === 0} title={playing ? "Pause" : "Play"}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <button className="tool-button" onClick={() => goToStep(step + 1)} disabled={step >= maxStep} title="Next event">
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
      <button className="tool-button" onClick={saveRun} title="Save run">
        <Save size={16} />
      </button>
      <button className="tool-button" onClick={randomRun} title="Random run">
        <Shuffle size={16} />
      </button>
      <button className="tool-button" onClick={stressCurrentConfig} title="Stress test current configuration">
        <Zap size={16} />
      </button>
      <span className="writer-topbar-stat">event {step}/{maxStep}</span>
      <span className={failingDiagnostics > 0 ? "writer-topbar-stat distlab-stat-failure" : warningDiagnostics > 0 ? "writer-topbar-stat writer-topbar-warning" : "writer-topbar-stat"}>
        {failingDiagnostics > 0 ? `${failingDiagnostics} failing` : warningDiagnostics > 0 ? `${warningDiagnostics} warnings` : "checks pass"}
      </span>
    </div>
  );

  return (
    <section className="distlab-workspace">
      {createPortal(toolbar, document.getElementById("app-topbar-tools") ?? document.body)}
      <aside className="distlab-sidebar">
        <section className="algolab-panel">
          <div className="algolab-panel-title">
            <Network size={17} />
            <strong>Algorithms</strong>
          </div>
          <div className="algolab-choice-list">
            {DISTRIBUTED_ALGORITHM_DEFINITIONS.map((item) => (
              <button
                key={item.id}
                className={item.id === config.algorithmId ? "algolab-choice active" : "algolab-choice"}
                onClick={() => updateConfig({ algorithmId: item.id })}
              >
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="algolab-panel">
          <div className="algolab-panel-title">
            <GitBranch size={17} />
            <strong>Topology</strong>
          </div>
          <OptionSelect value={config.topologyId} options={TOPOLOGY_OPTIONS} onChange={(topologyId: DistributedTopologyId) => updateConfig({ topologyId })} />
          <label className="distlab-slider">
            <span>Nodes</span>
            <input type="range" min={3} max={9} value={config.nodeCount} onChange={(event) => updateConfig({ nodeCount: Number(event.target.value) })} />
            <strong>{config.nodeCount}</strong>
          </label>
        </section>

        <section className="algolab-panel">
          <div className="algolab-panel-title">
            <Clock3 size={17} />
            <strong>Execution</strong>
          </div>
          <OptionSelect value={config.syncMode} options={SYNC_OPTIONS} onChange={(syncMode: ExecutionSyncMode) => updateConfig({ syncMode })} />
          <OptionSelect value={config.clockMode} options={CLOCK_OPTIONS} onChange={(clockMode: ClockMode) => updateConfig({ clockMode })} />
          <OptionSelect value={config.dataPattern} options={DATA_PATTERN_OPTIONS} onChange={(dataPattern: DataSyncPattern) => updateConfig({ dataPattern })} />
          <label className="distlab-seed">
            <span>Seed</span>
            <input value={String(config.seed)} onChange={(event) => updateConfig({ seed: Number(event.target.value) || 1 })} inputMode="numeric" />
            <button onClick={rerun} title="Regenerate this run">
              <RotateCcw size={14} />
            </button>
          </label>
        </section>

        <section className="algolab-panel">
          <div className="algolab-panel-title">
            <ServerCrash size={17} />
            <strong>Faults</strong>
          </div>
          <OptionSelect value={config.nodeFailureMode} options={NODE_FAILURE_OPTIONS} onChange={(nodeFailureMode: NodeFailureMode) => updateConfig({ nodeFailureMode })} />
          <OptionSelect value={config.recoveryMode} options={RECOVERY_OPTIONS} onChange={(recoveryMode: RecoveryMode) => updateConfig({ recoveryMode })} disabled={config.nodeFailureMode !== "crash-recovery"} />
          <OptionSelect value={config.channelFailureMode} options={CHANNEL_FAILURE_OPTIONS} onChange={(channelFailureMode: ChannelFailureMode) => updateConfig({ channelFailureMode })} />
        </section>

        <section className="algolab-panel distlab-saved-panel">
          <div className="algolab-panel-title">
            <Save size={17} />
            <strong>Saved Runs</strong>
          </div>
          <div className="distlab-saved-list">
            {savedRuns.length === 0 && <span className="writer-muted">No saved runs yet.</span>}
            {savedRuns.map((savedRun) => (
              <div key={savedRun.id} className={savedRun.id === selectedSavedRunId ? "distlab-saved-run active" : "distlab-saved-run"}>
                <button onClick={() => loadRun(savedRun)}>
                  <strong>{algorithmTitle(savedRun.config.algorithmId)}</strong>
                  <span>{topologyTitle(savedRun.config.topologyId)} · seed {savedRun.config.seed}</span>
                </button>
                <button className="writer-icon-button" onClick={() => deleteRun(savedRun.id)} title="Delete saved run">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <main className="distlab-stage-panel">
        <div className="algolab-stage-header">
          <div>
            <span className="writer-eyebrow">Run Visualizer</span>
            <h1>{run.name}</h1>
          </div>
          <div className="writer-editor-metrics">
            <span>{frame?.eventKind ?? "ready"}</span>
            <span>{run.result.status}</span>
            <span>{run.config.syncMode}</span>
          </div>
        </div>
        {frame && <DistributedNetworkVisualizer frame={frame} />}
        <input
          className="algolab-scrubber"
          type="range"
          min={0}
          max={maxStep}
          value={step}
          onChange={(event) => goToStep(Number(event.target.value))}
          aria-label="Distributed run event"
        />
      </main>

      <aside className="distlab-inspector">
        <section className="algolab-panel algolab-step-panel">
          <div className="algolab-panel-title">
            <Activity size={17} />
            <strong>Current Event</strong>
          </div>
          <div className="algolab-step-message distlab-step-message">
            <span>{frame?.title ?? "Ready"}</span>
            <p>{frame?.detail ?? "No frame selected."}</p>
          </div>
          {frame && <RunSummary frame={frame} run={run} />}
        </section>

        <section className="algolab-panel distlab-timeline-panel">
          <div className="algolab-panel-title">
            <ListChecks size={17} />
            <strong>Run Timeline</strong>
          </div>
          <RunTimeline frames={run.frames} step={step} onGoToStep={goToStep} />
        </section>

        {frame && (
          <>
            <section className="algolab-panel">
              <div className="algolab-panel-title">
                <ListChecks size={17} />
                <strong>Node States</strong>
              </div>
              <NodeStateList nodes={frame.nodes} activeNodeIds={frame.activeNodeIds} />
            </section>

            <section className="algolab-panel">
              <div className="algolab-panel-title">
                <RadioTower size={17} />
                <strong>Channels</strong>
              </div>
              <ChannelStateList channels={frame.channels} activeChannelIds={frame.activeChannelIds} />
            </section>

            {frame.sharedMemory.length > 0 && (
              <section className="algolab-panel">
                <div className="algolab-panel-title">
                  <Database size={17} />
                  <strong>Shared Memory</strong>
                </div>
                <SharedMemoryList cells={frame.sharedMemory} />
              </section>
            )}

            <section className="algolab-panel">
              <div className="algolab-panel-title">
                <AlertTriangle size={17} />
                <strong>Validator</strong>
              </div>
              <DiagnosticList diagnostics={frame.diagnostics} />
            </section>
          </>
        )}

        {stressReport && (
          <section className="algolab-panel">
            <div className="algolab-panel-title">
              <Zap size={17} />
              <strong>Stress Report</strong>
            </div>
            <StressReportPanel report={stressReport} onLoadSeed={(seed) => updateConfig({ seed })} />
          </section>
        )}
      </aside>
    </section>
  );
}

function DistributedNetworkVisualizer({ frame }: { frame: DistributedFrame }) {
  const width = 920;
  const height = 560;
  const pad = 74;
  const nodePositions = new Map(frame.nodes.map((node) => [node.id, { x: pad + node.x * (width - pad * 2), y: pad + node.y * (height - pad * 2) }]));
  const activeNodes = new Set(frame.activeNodeIds);
  const activeChannels = new Set(frame.activeChannelIds);

  return (
    <div className="distlab-visual-wrap">
      <svg className="distlab-visual" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Distributed algorithm run">
        <g className="distlab-channel-layer">
          {frame.channels.map((channel) => {
            const from = nodePositions.get(channel.from);
            const to = nodePositions.get(channel.to);
            if (!from || !to) return null;
            const className = ["distlab-channel", channel.status, activeChannels.has(channel.id) ? "active" : ""].filter(Boolean).join(" ");
            return (
              <g key={channel.id} className={className}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 8}>{channel.label}</text>
              </g>
            );
          })}
        </g>

        <g className="distlab-message-layer">
          {frame.messages.map((message) => {
            const from = nodePositions.get(message.from);
            const to = nodePositions.get(message.to);
            if (!from || !to) return null;
            const x = from.x + (to.x - from.x) * message.progress;
            const y = from.y + (to.y - from.y) * message.progress;
            return (
              <g key={`${message.id}-${message.status}`} className={`distlab-message ${message.status}`} transform={`translate(${x} ${y})`}>
                <circle r={12} />
                <text y={4}>{messageBadge(message.payload)}</text>
              </g>
            );
          })}
        </g>

        <g className="distlab-node-layer">
          {frame.nodes.map((node) => {
            const position = nodePositions.get(node.id);
            if (!position) return null;
            const className = ["distlab-node", node.status, activeNodes.has(node.id) ? "active" : ""].filter(Boolean).join(" ");
            return (
              <g key={node.id} className={className} transform={`translate(${position.x} ${position.y})`}>
                <title>{`${node.label}: ${node.role}, ${node.clock}`}</title>
                <circle className="distlab-node-halo" r={42} />
                <circle className="distlab-node-core" r={30} fill={node.color} />
                <text className="distlab-node-label" y={5}>{node.label}</text>
                <text className="distlab-node-clock" y={52}>{node.clock}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function RunSummary({ frame, run }: { frame: DistributedFrame; run: DistributedRun }) {
  return (
    <div className="algolab-detail-grid distlab-detail-grid">
      <span>
        <strong>{frame.nodes.length}</strong>
        <small>nodes</small>
      </span>
      <span>
        <strong>{frame.channels.length}</strong>
        <small>channels</small>
      </span>
      <span>
        <strong>{frame.messages.length}</strong>
        <small>messages</small>
      </span>
      <span>
        <strong>{frame.time}</strong>
        <small>time</small>
      </span>
      <span>
        <strong>{frame.round}</strong>
        <small>round</small>
      </span>
      <span>
        <strong>{run.result.deliveredCount}/{run.result.activeNodeCount}</strong>
        <small>{progressLabel(run.config.algorithmId)}</small>
      </span>
    </div>
  );
}

function RunTimeline({ frames, step, onGoToStep }: { frames: DistributedFrame[]; step: number; onGoToStep: (step: number) => void }) {
  return (
    <div className="algolab-timeline distlab-timeline">
      {frames.map((frame) => {
        const severity = frame.diagnostics.some((diagnostic) => diagnostic.severity === "failure")
          ? "failure"
          : frame.diagnostics.some((diagnostic) => diagnostic.severity === "warning")
            ? "warning"
            : "ok";
        return (
          <button key={`${frame.step}-${frame.title}`} className={[step === frame.step ? "active" : "", severity].filter(Boolean).join(" ")} onClick={() => onGoToStep(frame.step)}>
            <span>{frame.step}</span>
            <strong>{frame.title}</strong>
            <small>{frame.eventKind} · t{frame.time} r{frame.round}</small>
          </button>
        );
      })}
    </div>
  );
}

function NodeStateList({ nodes, activeNodeIds }: { nodes: DistributedNodeState[]; activeNodeIds: string[] }) {
  const active = new Set(activeNodeIds);
  return (
    <div className="distlab-node-list">
      {nodes.map((node) => (
        <article key={node.id} className={active.has(node.id) ? "distlab-state-row active" : "distlab-state-row"}>
          <header>
            <span style={{ background: node.color }} />
            <strong>{node.label}</strong>
            <small>{node.status}</small>
          </header>
          <div className="distlab-kv-grid">
            <span>{node.role}</span>
            <span>{node.clock}</span>
            {node.localState.map((item) => (
              <span key={item.label}>{item.label}: {item.value}</span>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function ChannelStateList({ channels, activeChannelIds }: { channels: DistributedChannelState[]; activeChannelIds: string[] }) {
  const active = new Set(activeChannelIds);
  return (
    <div className="distlab-channel-list">
      {channels.map((channel) => (
        <div key={channel.id} className={active.has(channel.id) ? "distlab-channel-row active" : "distlab-channel-row"}>
          <strong>{channel.from} to {channel.to}</strong>
          <span>{channel.status}</span>
          <small>{channel.queueSize} queued</small>
        </div>
      ))}
    </div>
  );
}

function SharedMemoryList({ cells }: { cells: DistributedFrame["sharedMemory"] }) {
  return (
    <div className="distlab-memory-list">
      {cells.slice(0, 8).map((cell) => (
        <span key={cell.key}>
          <strong>{cell.key}</strong>
          <em>{cell.value}</em>
          <small>{cell.writer}</small>
        </span>
      ))}
      {cells.length > 8 && <span className="writer-muted">{cells.length - 8} more cells</span>}
    </div>
  );
}

function DiagnosticList({ diagnostics }: { diagnostics: DistributedDiagnostic[] }) {
  return (
    <div className="distlab-diagnostic-list">
      {diagnostics.map((diagnostic) => (
        <article key={`${diagnostic.kind}-${diagnostic.label}`} className={`distlab-diagnostic ${diagnostic.severity}`}>
          <strong>{diagnostic.label}</strong>
          <span>{diagnostic.kind}</span>
          <p>{diagnostic.detail}</p>
        </article>
      ))}
    </div>
  );
}

function StressReportPanel({ report, onLoadSeed }: { report: DistributedStressReport; onLoadSeed: (seed: number) => void }) {
  return (
    <div className="distlab-stress-report">
      <div className="distlab-stress-grid">
        <span><strong>{report.completed}</strong><small>complete</small></span>
        <span><strong>{report.failed}</strong><small>failed</small></span>
        <span><strong>{report.stalled}</strong><small>stalled</small></span>
      </div>
      <div className="distlab-stress-grid">
        <span><strong>{report.safetyViolations}</strong><small>safety</small></span>
        <span><strong>{report.livenessWarnings}</strong><small>liveness</small></span>
        <span><strong>{report.agreementSplits}</strong><small>agreement</small></span>
      </div>
      <div className="distlab-stress-grid">
        <span><strong>{report.deadlocks}</strong><small>deadlocks</small></span>
        <span><strong>{report.noProgressWarnings}</strong><small>no progress</small></span>
        <span><strong>{report.runCount}</strong><small>runs</small></span>
      </div>
      {report.examples.length > 0 && (
        <div className="distlab-example-list">
          {report.examples.map((example) => (
            <button key={example.seed} onClick={() => onLoadSeed(example.seed)} title={example.summary}>
              <strong>seed {example.seed}</strong>
              <span>{example.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function messageBadge(payload: string): string {
  if (payload.startsWith("max:")) return payload.replace("max:", "");
  if (payload.startsWith("probe")) return "P";
  if (payload.startsWith("echo:")) return "E";
  if (payload.startsWith("corrupt")) return "!";
  if (payload.startsWith("recover")) return "R";
  return "v";
}

function progressLabel(algorithmId: DistributedAlgorithmId): string {
  if (algorithmId === "max-consensus") return "agreeing";
  if (algorithmId === "echo-convergecast") return "joined";
  return "delivered";
}

function OptionSelect<T extends string>({
  value,
  options,
  onChange,
  disabled = false
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <label className="distlab-select">
      <select value={value} onChange={(event) => onChange(event.target.value as T)} disabled={disabled}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function loadConfig(): DistributedRunConfig {
  const fallback = defaultDistributedRunConfig();
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) ?? "null") as Partial<DistributedRunConfig> | null;
    return parsed ? { ...fallback, ...parsed } : fallback;
  } catch {
    return fallback;
  }
}

function loadSavedRuns(): DistributedRun[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_RUNS_STORAGE_KEY) ?? "[]") as DistributedRun[];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}
