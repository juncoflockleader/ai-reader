import { createTraceShell } from "./trace";
import type { AlgorithmTrace, TraceEvent } from "./types";

const WORKER_TIMEOUT_MS = 1800;

export type InstrumentedTraceResult = {
  trace: AlgorithmTrace;
  finalValues: number[];
};

type WorkerSuccess = {
  ok: true;
  events: TraceEvent[];
  finalValues: number[];
};

type WorkerFailure = {
  ok: false;
  error: string;
};

type WorkerResult = WorkerSuccess | WorkerFailure;

export async function runInstrumentedTrace({
  input,
  instrumentedCode,
  sourceProgram,
  summary
}: {
  input: number[];
  instrumentedCode: string;
  sourceProgram: string;
  summary: string;
}): Promise<InstrumentedTraceResult> {
  if (!instrumentedCode.trim()) throw new Error("Instrumented code is empty.");
  const result = await runInWorker(instrumentedCode, input);
  if (!result.ok) throw new Error(result.error);
  const trace = createTraceShell(
    "custom",
    "LLM-Instrumented Trace",
    summary || "Learner code instrumented with visual calls and replayed locally.",
    sourceProgram,
    input
  );
  trace.events = normalizeWorkerEvents(result.events);
  return {
    trace,
    finalValues: result.finalValues
  };
}

function runInWorker(instrumentedCode: string, input: number[]): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const workerUrl = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
    const worker = new Worker(workerUrl);
    let settled = false;
    let timeout = 0;
    const finish = (result: WorkerResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      resolve(result);
    };
    timeout = window.setTimeout(() => {
      finish({ ok: false, error: "Local trace timed out. Check for an infinite loop or very large input." });
    }, WORKER_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<WorkerResult & { kind?: string }>) => {
      if (event.data?.kind !== "algolab-result") return;
      finish(event.data);
    };
    worker.onerror = (event) => {
      finish({ ok: false, error: event.message || "Local trace failed." });
    };
    worker.postMessage({ instrumentedCode, input });
  });
}

function normalizeWorkerEvents(events: TraceEvent[]) {
  return events.slice(0, 900);
}

function workerSource() {
  return `
const EVENT_LIMIT = 900;
const ITEM_COLORS = ["#347f8f", "#d86642", "#6078bf", "#c29a2e", "#5f9b6e", "#a05e9a", "#4d8bcb", "#b66f3f", "#6b7f34", "#8f6dcc", "#2f8f75", "#bf5f73"];
const sendResult = globalThis.postMessage.bind(globalThis);
globalThis.fetch = undefined;
globalThis.XMLHttpRequest = undefined;
globalThis.WebSocket = undefined;
globalThis.EventSource = undefined;
globalThis.importScripts = undefined;
globalThis.postMessage = undefined;

globalThis.onmessage = async (messageEvent) => {
  const events = [];
  const arrayStates = new WeakMap();
  const callStack = [];
  let callSerial = 0;

  function record(event) {
    if (events.length >= EVENT_LIMIT) {
      throw new Error("Trace limit reached. Try a shorter input or fewer visual calls.");
    }
    events.push(event);
  }

  function assertArray(array) {
    const state = arrayStates.get(array);
    if (!state) throw new Error("Use visual.array(input) before calling visual helpers.");
    return state;
  }

  function assertIndex(array, index, label) {
    if (!Number.isInteger(index) || index < 0 || index >= array.length) {
      throw new Error(label + " index " + index + " is out of bounds.");
    }
    return index;
  }

  function array(input) {
    const values = input.map((value) => Number(value));
    const working = values.slice();
    arrayStates.set(working, {
      slots: values.map((value, index) => "item-" + index + "-" + value)
    });
    return working;
  }

  function values(array) {
    assertArray(array);
    return array.slice();
  }

  function value(array, index) {
    assertArray(array);
    return array[assertIndex(array, index, "value")];
  }

  function compare(array, leftIndex, rightIndex, message) {
    const state = assertArray(array);
    const left = assertIndex(array, leftIndex, "compare left");
    const right = assertIndex(array, rightIndex, "compare right");
    record({
      type: "compare",
      itemIds: [state.slots[left], state.slots[right]],
      indices: [left, right],
      message: message || String(array[left]) + " is compared with " + String(array[right]) + "."
    });
    return array[left] - array[right];
  }

  function swap(array, leftIndex, rightIndex, message) {
    const state = assertArray(array);
    const left = assertIndex(array, leftIndex, "swap left");
    const right = assertIndex(array, rightIndex, "swap right");
    record({
      type: "swap",
      indices: [left, right],
      message: message || "Swap positions " + left + " and " + right + "."
    });
    const leftValue = array[left];
    array[left] = array[right];
    array[right] = leftValue;
    const leftSlot = state.slots[left];
    state.slots[left] = state.slots[right];
    state.slots[right] = leftSlot;
  }

  function pointer(name, index, label, color, message) {
    record({
      type: "setPointer",
      name: String(name),
      pointer: {
        lane: "array",
        index: assertFiniteIndex(index, "pointer"),
        label: label || String(name),
        color: color || "#6078bf"
      },
      message
    });
  }

  function clearPointer(name, message) {
    record({ type: "setPointer", name: String(name), pointer: null, message: message || "Clear " + String(name) + " pointer." });
  }

  function range(name, start, end, label, color, message) {
    const safeStart = assertFiniteIndex(start, "range start");
    const safeEnd = assertFiniteIndex(end, "range end");
    record({
      type: "setRange",
      name: String(name),
      range: {
        lane: "array",
        start: Math.min(safeStart, safeEnd),
        end: Math.max(safeStart, safeEnd),
        label: label || String(name),
        color: color || "#84a8b2"
      },
      message
    });
  }

  function clearRange(name, message) {
    record({ type: "setRange", name: String(name), range: null, message: message || "Clear " + String(name) + " range." });
  }

  function loop(id, label, current, total, detail, message) {
    const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
    const safeCurrent = Math.max(0, Math.min(safeTotal, Math.floor(Number(current) || 0)));
    record({
      type: "setLoop",
      id: String(id),
      loop: {
        label: label || String(id),
        current: safeCurrent,
        total: safeTotal,
        depth: Math.max(0, callStack.length),
        color: "#6078bf",
        detail: detail ? String(detail) : undefined
      },
      message
    });
  }

  function endLoop(id, message) {
    record({ type: "setLoop", id: String(id), loop: null, message: message || "Loop finished." });
  }

  function enterCall(label, detail, range) {
    callSerial += 1;
    const id = "custom-call-" + callSerial;
    const parentId = callStack.length ? callStack[callStack.length - 1] : null;
    const frame = {
      id,
      parentId,
      label: label || "call " + callSerial,
      detail: detail ? String(detail) : undefined,
      depth: callStack.length,
      color: ITEM_COLORS[callSerial % ITEM_COLORS.length],
      range: normalizeRange(range)
    };
    record({ type: "enterCall", frame, message: "Enter " + frame.label + "." });
    callStack.push(id);
    return id;
  }

  function exitCall(id, message) {
    const nextId = id || callStack[callStack.length - 1];
    if (!nextId) return;
    while (callStack.length && callStack[callStack.length - 1] !== nextId) {
      callStack.pop();
    }
    if (callStack[callStack.length - 1] === nextId) callStack.pop();
    record({ type: "exitCall", id: String(nextId), message: message || "Return from call." });
  }

  function markSorted(array, start = 0, end = array.length - 1, message) {
    const state = assertArray(array);
    const safeStart = assertIndex(array, start, "markSorted start");
    const safeEnd = assertIndex(array, end, "markSorted end");
    const low = Math.min(safeStart, safeEnd);
    const high = Math.max(safeStart, safeEnd);
    record({
      type: "markSorted",
      itemIds: state.slots.slice(low, high + 1),
      message: message || "Mark positions " + low + ".." + high + " as sorted."
    });
  }

  function done(array, message) {
    markSorted(array, 0, array.length - 1, message || "The local run finished.");
  }

  function explain(message) {
    record({ type: "explain", message: message || "Continue the algorithm." });
  }

  function assertFiniteIndex(value, label) {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(label + " index must be a non-negative integer.");
    }
    return index;
  }

  function normalizeRange(value) {
    if (!value || typeof value !== "object") return undefined;
    const start = Number(value.start);
    const end = Number(value.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0) return undefined;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  try {
    const { instrumentedCode, input } = messageEvent.data || {};
    const visual = Object.freeze({
      array,
      values,
      value,
      compare,
      less: (array, left, right, message) => compare(array, left, right, message) < 0,
      lessOrEqual: (array, left, right, message) => compare(array, left, right, message) <= 0,
      swap,
      pointer,
      clearPointer,
      range,
      clearRange,
      loop,
      endLoop,
      enterCall,
      exitCall,
      markSorted,
      done,
      explain
    });
    const factory = new Function('"use strict";\\n' + String(instrumentedCode) + '\\n; return run;');
    const run = factory();
    if (typeof run !== "function") throw new Error("Instrumented code must define function run(input, visual).");
    const finalValues = await run(input.slice(), visual);
    while (callStack.length) exitCall(callStack[callStack.length - 1], "Return from unfinished call.");
    sendResult({ kind: "algolab-result", ok: true, events, finalValues: Array.isArray(finalValues) ? finalValues.map(Number) : [] });
  } catch (error) {
    sendResult({ kind: "algolab-result", ok: false, error: error instanceof Error ? error.message : "Local trace failed." });
  }
};
`;
}
