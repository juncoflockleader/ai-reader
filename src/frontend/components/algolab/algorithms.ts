import type { AlgorithmDefinition, AlgorithmTrace, LaneId, TraceEvent, TreeVisualState, VisualItem } from "./types";
import { createTraceShell, itemValueMap } from "./trace";

const QUICK_SORT_SAMPLE = `from algolab import visual

def quicksort(a, lo=0, hi=None):
    if hi is None:
        hi = len(a) - 1
    if lo >= hi:
        return

    pivot = a[hi]
    i = lo
    for j in range(lo, hi):
        visual.compare(a[j], pivot)
        if a[j] <= pivot:
            visual.swap(a, i, j)
            i += 1

    visual.swap(a, i, hi)
    quicksort(a, lo, i - 1)
    quicksort(a, i + 1, hi)`;

const INSERTION_SORT_SAMPLE = `from algolab import visual

def insertion_sort(a):
    for i in range(1, len(a)):
        key = a[i]
        visual.hold(key)
        j = i - 1
        while j >= 0 and a[j] > key:
            visual.compare(a[j], key)
            visual.move(a[j], j + 1)
            j -= 1
        visual.insert(key, j + 1)`;

const MERGE_SORT_SAMPLE = `from algolab import visual

def merge_sort(a, lo=0, hi=None):
    if hi is None:
        hi = len(a) - 1
    if lo >= hi:
        return

    mid = (lo + hi) // 2
    merge_sort(a, lo, mid)
    merge_sort(a, mid + 1, hi)
    merge(a, lo, mid, hi)

def merge(a, lo, mid, hi):
    i = lo
    j = mid + 1
    for k in range(lo, hi + 1):
        visual.compare(a[i], a[j])
        visual.move_to_aux(k)
    visual.copy_back(lo, hi)`;

const TREE_PREORDER_SAMPLE = `from algolab import visual

def preorder(node):
    if node is None:
        return

    visual.visit(node)
    preorder(node.left)
    preorder(node.right)`;

export const SORTING_PRESETS = [
  { label: "Classic", values: [8, 3, 5, 1, 9, 2, 7] },
  { label: "Duplicates", values: [5, 3, 5, 1, 3, 8, 5] },
  { label: "Reversed", values: [9, 8, 7, 6, 5, 4, 3] },
  { label: "Nearly sorted", values: [1, 2, 4, 3, 5, 7, 6] }
];

export const ALGORITHM_DEFINITIONS: AlgorithmDefinition[] = [
  {
    id: "quicksort",
    title: "Quicksort",
    description: "Partition around a pivot, then recursively sort the left and right ranges.",
    defaultInput: SORTING_PRESETS[0].values,
    sampleProgram: QUICK_SORT_SAMPLE,
    generateTrace: generateQuickSortTrace
  },
  {
    id: "insertion-sort",
    title: "Insertion Sort",
    description: "Lift one key item, shift larger values right, then insert the key into the open slot.",
    defaultInput: [6, 2, 4, 1, 5, 3],
    sampleProgram: INSERTION_SORT_SAMPLE,
    generateTrace: generateInsertionSortTrace
  },
  {
    id: "merge-sort",
    title: "Merge Sort",
    description: "Split the array, merge sorted ranges through an auxiliary lane, and copy them back.",
    defaultInput: [7, 2, 6, 3, 9, 1, 5, 4],
    sampleProgram: MERGE_SORT_SAMPLE,
    generateTrace: generateMergeSortTrace
  },
  {
    id: "tree-preorder",
    title: "Binary Tree Preorder",
    description: "Visit a node before recursively walking its left and right subtrees.",
    defaultInput: [8, 3, 10, 1, 6, 9, 14],
    sampleProgram: TREE_PREORDER_SAMPLE,
    generateTrace: generateTreePreorderTrace
  }
];

export function findAlgorithmDefinition(id: string): AlgorithmDefinition {
  return ALGORITHM_DEFINITIONS.find((definition) => definition.id === id) ?? ALGORITHM_DEFINITIONS[0];
}

function generateQuickSortTrace(input: number[]): AlgorithmTrace {
  const trace = createTraceShell("quicksort", "Quicksort", ALGORITHM_DEFINITIONS[0].description, QUICK_SORT_SAMPLE, input);
  const order = [...trace.initialState.lanes.array] as string[];
  const values = itemValueMap(trace.initialState.items);
  let callSerial = 0;

  push(trace, { type: "explain", message: "Start with the whole array. Quicksort will partition one range at a time.", codeLine: 3 });

  function quicksort(lo: number, hi: number, parentId: string | null, depth: number, callLine = 3): void {
    const callId = `quick-${callSerial += 1}`;
    enterCall(
      trace,
      callId,
      parentId,
      `quicksort(${lo}, ${hi})`,
      lo <= hi ? `range ${lo}..${hi}` : "empty range",
      depth,
      "#2d675b",
      lo <= hi ? { start: lo, end: hi } : undefined,
      `Enter quicksort on ${lo <= hi ? `positions ${lo} through ${hi}` : "an empty range"}.`,
      callLine
    );
    if (lo > hi) {
      exitCall(trace, callId, "The recursive range is empty, so this call returns immediately.", 6);
      return;
    }
    setRange(trace, "active", lo, hi, "active range", "#84a8b2", "Focus on positions " + lo + " through " + hi + ".", 3);
    if (lo === hi) {
      push(trace, { type: "markSorted", itemIds: [order[lo]], message: `${valueLabel(values, order[lo])} is a one-item sorted range.`, codeLine: 6 });
      exitCall(trace, callId, `Return from quicksort(${lo}, ${hi}); the one-item range is done.`, 7);
      return;
    }

    const pivotIndex = hi;
    const pivotId = order[pivotIndex];
    setPointer(trace, "pivot", "array", pivotIndex, "pivot", "#b5482f", `Choose ${valueLabel(values, pivotId)} as the pivot.`, 9);
    let storeIndex = lo;
    setPointer(trace, "i", "array", storeIndex, "i", "#2d675b", "Pointer i marks where the next small item will land.", 10);

    for (let scanIndex = lo; scanIndex < hi; scanIndex += 1) {
      const scanId = order[scanIndex];
      setLoop(
        trace,
        `partition-${callId}`,
        "partition scan",
        scanIndex - lo + 1,
        hi - lo,
        depth + 1,
        "#6078bf",
        `j = ${scanIndex}, pivot = ${hi}`,
        `Partition loop iteration ${scanIndex - lo + 1}/${hi - lo} checks array index ${scanIndex}.`,
        11
      );
      setPointer(trace, "j", "array", scanIndex, "j", "#6078bf", `Scan ${valueLabel(values, scanId)} against the pivot.`, 11);
      push(trace, {
        type: "compare",
        itemIds: [scanId, pivotId],
        indices: [scanIndex, pivotIndex],
        message: `${valueLabel(values, scanId)} is compared with pivot ${valueLabel(values, pivotId)}.`,
        codeLine: 12
      });
      if (values[scanId] <= values[pivotId]) {
        if (scanIndex !== storeIndex) {
          push(trace, {
            type: "swap",
            indices: [storeIndex, scanIndex],
            message: `${valueLabel(values, scanId)} belongs on the left side, so swap it into position ${storeIndex}.`,
            codeLine: 14
          });
          swap(order, storeIndex, scanIndex);
        } else {
          push(trace, {
            type: "explain",
            message: `${valueLabel(values, scanId)} is already on the left side of the pivot boundary.`,
            codeLine: 14
          });
        }
        storeIndex += 1;
        setPointer(trace, "i", "array", Math.min(storeIndex, hi), "i", "#2d675b", "Advance i to the next open small-item slot.", 15);
      }
    }

    clearLoop(trace, `partition-${callId}`, "The partition scan is complete.", 17);
    setPointer(trace, "j", null, null, "j", "#6078bf", "The scan is done; place the pivot into its final slot.", 17);
    push(trace, {
      type: "swap",
      indices: [storeIndex, hi],
      message: `Move pivot ${valueLabel(values, pivotId)} between the smaller and larger values.`,
      codeLine: 17
    });
    swap(order, storeIndex, hi);
    push(trace, {
      type: "markSorted",
      itemIds: [order[storeIndex]],
      message: `Pivot ${valueLabel(values, order[storeIndex])} is now fixed in sorted position ${storeIndex}.`,
      codeLine: 17
    });

    setPointer(trace, "pivot", null, null, "pivot", "#b5482f");
    setPointer(trace, "i", null, null, "i", "#2d675b");
    quicksort(lo, storeIndex - 1, callId, depth + 1, 18);
    quicksort(storeIndex + 1, hi, callId, depth + 1, 19);
    exitCall(trace, callId, `Return from quicksort(${lo}, ${hi}); both child ranges have finished.`, 19);
  }

  quicksort(0, order.length - 1, null, 0);
  setRange(trace, "active", null, null, "active range", "#84a8b2");
  push(trace, { type: "markSorted", itemIds: [...order], message: "Every item is fixed. The array is sorted.", codeLine: 19 });
  return trace;
}

function generateInsertionSortTrace(input: number[]): AlgorithmTrace {
  const trace = createTraceShell("insertion-sort", "Insertion Sort", ALGORITHM_DEFINITIONS[1].description, INSERTION_SORT_SAMPLE, input);
  const order = [...trace.initialState.lanes.array];
  const aux: Array<string | null> = Array.from({ length: order.length }, () => null);
  const values = itemValueMap(trace.initialState.items);
  const callId = "insertion-root";

  push(trace, { type: "explain", message: "The first item starts as a sorted prefix.", codeLine: 3 });
  enterCall(trace, callId, null, `insertion_sort(${order.length})`, `${order.length} items`, 0, "#2d675b", { start: 0, end: order.length - 1 }, "Enter insertion_sort and grow the sorted prefix.", 3);
  if (order[0]) push(trace, { type: "markSorted", itemIds: [order[0]], message: "The prefix of length 1 is sorted.", codeLine: 4 });

  for (let index = 1; index < order.length; index += 1) {
    const keyId = readSlot(order, index);
    setLoop(
      trace,
      "insertion-outer",
      "outer for i",
      index,
      order.length - 1,
      0,
      "#2d675b",
      `i = ${index}`,
      `Outer loop selects index ${index} as the next key.`,
      4
    );
    setRange(trace, "sorted-prefix", 0, index - 1, "sorted prefix", "#77a37e", `Everything before index ${index} is already sorted.`, 4);
    setPointer(trace, "key", "array", index, "key", "#b5482f", `Lift ${valueLabel(values, keyId)} out as the key.`, 5);
    move(trace, order, aux, { lane: "array", index }, { lane: "aux", index }, `Hold ${valueLabel(values, keyId)} while larger values shift right.`, 6);
    setPointer(trace, "key", "aux", index, "key", "#b5482f");

    let scanIndex = index - 1;
    while (scanIndex >= 0) {
      const scanId = order[scanIndex];
      if (!scanId) break;
      setLoop(
        trace,
        "insertion-inner",
        "inner while j",
        index - scanIndex,
        index,
        1,
        "#6078bf",
        `j = ${scanIndex}`,
        `Inner loop checks the sorted prefix at index ${scanIndex}.`,
        8
      );
      setPointer(trace, "j", "array", scanIndex, "j", "#6078bf", `Check whether ${valueLabel(values, scanId)} should shift.`, 8);
      push(trace, {
        type: "compare",
        itemIds: [scanId, keyId],
        indices: [scanIndex, index],
        message: `Compare sorted item ${valueLabel(values, scanId)} with key ${valueLabel(values, keyId)}.`,
        codeLine: 9
      });
      if (values[scanId] <= values[keyId]) break;
      move(
        trace,
        order,
        order,
        { lane: "array", index: scanIndex },
        { lane: "array", index: scanIndex + 1 },
        `${valueLabel(values, scanId)} is larger than the key, so shift it right.`,
        10
      );
      scanIndex -= 1;
    }

    const insertIndex = scanIndex + 1;
    clearLoop(trace, "insertion-inner", `The inner loop found insert position ${insertIndex}.`, 12);
    move(trace, aux, order, { lane: "aux", index }, { lane: "array", index: insertIndex }, `Insert the key at index ${insertIndex}.`, 12);
    setPointer(trace, "j", null, null, "j", "#6078bf");
    setPointer(trace, "key", null, null, "key", "#b5482f");
    push(trace, { type: "markSorted", itemIds: order.slice(0, index + 1).filter(isString), message: `The prefix through index ${index} is sorted.`, codeLine: 4 });
  }

  clearLoop(trace, "insertion-outer", "The outer loop has visited every key.", 4);
  setRange(trace, "sorted-prefix", null, null, "sorted prefix", "#77a37e");
  push(trace, { type: "markSorted", itemIds: order.filter(isString), message: "The whole array is sorted.", codeLine: 12 });
  exitCall(trace, callId, "Return from insertion_sort with the array sorted.", 12);
  return trace;
}

function generateMergeSortTrace(input: number[]): AlgorithmTrace {
  const trace = createTraceShell("merge-sort", "Merge Sort", ALGORITHM_DEFINITIONS[2].description, MERGE_SORT_SAMPLE, input);
  const order = [...trace.initialState.lanes.array];
  const aux: Array<string | null> = Array.from({ length: order.length }, () => null);
  const values = itemValueMap(trace.initialState.items);
  let callSerial = 0;

  push(trace, { type: "explain", message: "Merge sort splits ranges, then merges them through the auxiliary lane.", codeLine: 3 });

  function mergeSort(lo: number, hi: number, parentId: string | null, depth: number, callLine = 3): void {
    const callId = `merge-sort-${callSerial += 1}`;
    enterCall(
      trace,
      callId,
      parentId,
      `merge_sort(${lo}, ${hi})`,
      lo <= hi ? `range ${lo}..${hi}` : "empty range",
      depth,
      "#2d675b",
      lo <= hi ? { start: lo, end: hi } : undefined,
      `Enter merge_sort on ${lo <= hi ? `positions ${lo} through ${hi}` : "an empty range"}.`,
      callLine
    );
    if (lo > hi) {
      exitCall(trace, callId, "The recursive range is empty, so this call returns immediately.", 6);
      return;
    }
    setRange(trace, "active", lo, hi, "split range", "#84a8b2", `Split or merge the range ${lo}..${hi}.`, 3);
    if (lo === hi) {
      push(trace, { type: "markSorted", itemIds: [readSlot(order, lo)], message: `${valueLabel(values, readSlot(order, lo))} is a sorted one-item range.`, codeLine: 6 });
      exitCall(trace, callId, `Return from merge_sort(${lo}, ${hi}); the one-item range is done.`, 7);
      return;
    }
    const mid = Math.floor((lo + hi) / 2);
    setPointer(trace, "mid", "array", mid, "mid", "#8a6dcc", `The midpoint divides ${lo}..${hi} into two smaller ranges.`, 9);
    mergeSort(lo, mid, callId, depth + 1, 10);
    mergeSort(mid + 1, hi, callId, depth + 1, 11);
    merge(lo, mid, hi, callId, depth + 1);
    exitCall(trace, callId, `Return from merge_sort(${lo}, ${hi}); split ranges have been merged.`, 12);
  }

  function merge(lo: number, mid: number, hi: number, parentId: string, depth: number): void {
    const callId = `merge-${callSerial += 1}`;
    enterCall(
      trace,
      callId,
      parentId,
      `merge(${lo}, ${mid}, ${hi})`,
      `combine ${lo}..${mid} and ${mid + 1}..${hi}`,
      depth,
      "#b9782f",
      { start: lo, end: hi },
      `Enter merge to combine ${lo}..${mid} and ${mid + 1}..${hi}.`,
      12
    );
    const leftIds = order.slice(lo, mid + 1).filter(isString);
    const rightIds = order.slice(mid + 1, hi + 1).filter(isString);
    let leftIndex = 0;
    let rightIndex = 0;
    let auxIndex = lo;

    setRange(trace, "active", lo, hi, "merge range", "#d1a848", `Merge sorted ranges ${lo}..${mid} and ${mid + 1}..${hi}.`, 14);
    while (leftIndex < leftIds.length && rightIndex < rightIds.length) {
      const leftId = leftIds[leftIndex];
      const rightId = rightIds[rightIndex];
      const leftPosition = findIndex(order, leftId);
      const rightPosition = findIndex(order, rightId);
      setLoop(
        trace,
        `merge-build-${callId}`,
        "merge output",
        auxIndex - lo + 1,
        hi - lo + 1,
        depth + 1,
        "#6078bf",
        `k = ${auxIndex}`,
        `Merge loop fills aux slot ${auxIndex}.`,
        17
      );
      setPointer(trace, "left", "array", leftPosition, "left", "#2d675b", undefined, 15);
      setPointer(trace, "right", "array", rightPosition, "right", "#6078bf", undefined, 16);
      push(trace, {
        type: "compare",
        itemIds: [leftId, rightId],
        indices: [leftPosition, rightPosition],
        message: `Compare ${valueLabel(values, leftId)} and ${valueLabel(values, rightId)}; the smaller value moves to aux slot ${auxIndex}.`,
        codeLine: 18
      });

      if (values[leftId] <= values[rightId]) {
        moveById(trace, order, aux, leftId, auxIndex, `Move ${valueLabel(values, leftId)} from the left range into aux slot ${auxIndex}.`, 19);
        leftIndex += 1;
      } else {
        moveById(trace, order, aux, rightId, auxIndex, `Move ${valueLabel(values, rightId)} from the right range into aux slot ${auxIndex}.`, 19);
        rightIndex += 1;
      }
      auxIndex += 1;
    }

    while (leftIndex < leftIds.length) {
      const leftId = leftIds[leftIndex];
      setLoop(
        trace,
        `merge-build-${callId}`,
        "merge output",
        auxIndex - lo + 1,
        hi - lo + 1,
        depth + 1,
        "#6078bf",
        `k = ${auxIndex}`,
        `Merge loop copies the remaining left value into aux slot ${auxIndex}.`,
        17
      );
      moveById(trace, order, aux, leftId, auxIndex, `Copy remaining left value ${valueLabel(values, leftId)} into aux.`, 19);
      leftIndex += 1;
      auxIndex += 1;
    }

    while (rightIndex < rightIds.length) {
      const rightId = rightIds[rightIndex];
      setLoop(
        trace,
        `merge-build-${callId}`,
        "merge output",
        auxIndex - lo + 1,
        hi - lo + 1,
        depth + 1,
        "#6078bf",
        `k = ${auxIndex}`,
        `Merge loop copies the remaining right value into aux slot ${auxIndex}.`,
        17
      );
      moveById(trace, order, aux, rightId, auxIndex, `Copy remaining right value ${valueLabel(values, rightId)} into aux.`, 19);
      rightIndex += 1;
      auxIndex += 1;
    }

    clearLoop(trace, `merge-build-${callId}`, "The merge output loop has filled the auxiliary range.", 20);
    for (let copyIndex = lo; copyIndex <= hi; copyIndex += 1) {
      setLoop(
        trace,
        `copy-back-${callId}`,
        "copy back",
        copyIndex - lo + 1,
        hi - lo + 1,
        depth + 1,
        "#b9782f",
        `k = ${copyIndex}`,
        `Copy-back loop restores aux slot ${copyIndex} to the array.`,
        20
      );
      move(trace, aux, order, { lane: "aux", index: copyIndex }, { lane: "array", index: copyIndex }, `Copy aux slot ${copyIndex} back into the main array.`, 20);
    }
    clearLoop(trace, `copy-back-${callId}`, "The merged range has been copied back.", 20);
    push(trace, { type: "markSorted", itemIds: order.slice(lo, hi + 1).filter(isString), message: `Range ${lo}..${hi} is now sorted.`, codeLine: 20 });
    exitCall(trace, callId, `Return from merge(${lo}, ${mid}, ${hi}).`, 20);
  }

  mergeSort(0, order.length - 1, null, 0);
  setPointer(trace, "mid", null, null, "mid", "#8a6dcc");
  setPointer(trace, "left", null, null, "left", "#2d675b");
  setPointer(trace, "right", null, null, "right", "#6078bf");
  setRange(trace, "active", null, null, "merge range", "#d1a848");
  push(trace, { type: "markSorted", itemIds: order.filter(isString), message: "The final merge is complete. The array is sorted.", codeLine: 20 });
  return trace;
}

function generateTreePreorderTrace(input: number[]): AlgorithmTrace {
  const trace = createTraceShell("tree-preorder", "Binary Tree Preorder", ALGORITHM_DEFINITIONS[3].description, TREE_PREORDER_SAMPLE, input);
  trace.initialState.tree = buildCompleteBinaryTree(trace.initialState.items);
  const tree = trace.initialState.tree;
  let callSerial = 0;

  push(trace, { type: "explain", message: "Build a complete binary tree from the input values in level order.", codeLine: 1 });

  function preorder(index: number, parentCallId: string | null, depth: number, branchDetail: string): void {
    const nodeId = `tree-${index}`;
    const node = tree.nodes[nodeId];
    if (!node) return;

    const callId = `preorder-${callSerial += 1}`;
    enterCall(
      trace,
      callId,
      parentCallId,
      `preorder(${node.label})`,
      branchDetail,
      depth,
      "#2d675b",
      undefined,
      `Enter preorder at node ${node.label}.`,
      3
    );
    focusTreeNode(trace, nodeId, `Focus on node ${node.label}; preorder handles the current node first.`, 3);
    visitTreeNode(trace, nodeId, `Visit ${node.label}, then recurse into its children.`, 6);

    const leftIndex = index * 2 + 1;
    const rightIndex = index * 2 + 2;
    const leftNode = tree.nodes[`tree-${leftIndex}`];
    const rightNode = tree.nodes[`tree-${rightIndex}`];

    if (leftNode) {
      focusTreeNode(trace, leftNode.id, `Move to the left child ${leftNode.label} of ${node.label}.`, 7);
      preorder(leftIndex, callId, depth + 1, `left child of ${node.label}`);
    } else {
      push(trace, { type: "explain", message: `${node.label} has no left child, so that recursive branch returns immediately.`, codeLine: 7 });
    }

    if (rightNode) {
      focusTreeNode(trace, rightNode.id, `Move to the right child ${rightNode.label} of ${node.label}.`, 8);
      preorder(rightIndex, callId, depth + 1, `right child of ${node.label}`);
    } else {
      push(trace, { type: "explain", message: `${node.label} has no right child, so that recursive branch returns immediately.`, codeLine: 8 });
    }

    focusTreeNode(trace, nodeId, `Both children of ${node.label} are done.`, 8);
    exitCall(trace, callId, `Return from preorder(${node.label}).`, 8);
  }

  if (tree.rootId) {
    preorder(0, null, 0, "root");
    focusTreeNode(trace, null, "Preorder traversal is complete.", 8);
  }

  return trace;
}

function push(trace: AlgorithmTrace, event: TraceEvent): void {
  trace.events.push(event);
}

function setPointer(
  trace: AlgorithmTrace,
  name: string,
  lane: LaneId | null,
  index: number | null,
  label: string,
  color: string,
  message?: string,
  codeLine?: number
): void {
  push(trace, {
    type: "setPointer",
    name,
    pointer: lane === null || index === null ? null : { lane, index, label, color },
    message: message ?? (lane === null || index === null ? `Clear ${label} pointer.` : undefined),
    codeLine
  });
}

function setRange(
  trace: AlgorithmTrace,
  name: string,
  start: number | null,
  end: number | null,
  label: string,
  color: string,
  message?: string,
  codeLine?: number
): void {
  push(trace, {
    type: "setRange",
    name,
    range: start === null || end === null ? null : { lane: "array", start, end, label, color },
    message: message ?? (start === null || end === null ? `Clear ${label}.` : undefined),
    codeLine
  });
}

function setLoop(
  trace: AlgorithmTrace,
  id: string,
  label: string,
  current: number,
  total: number,
  depth: number,
  color: string,
  detail: string,
  message: string,
  codeLine?: number
): void {
  push(trace, {
    type: "setLoop",
    id,
    loop: {
      label,
      current,
      total,
      depth,
      color,
      detail
    },
    message,
    codeLine
  });
}

function clearLoop(trace: AlgorithmTrace, id: string, message?: string, codeLine?: number): void {
  push(trace, {
    type: "setLoop",
    id,
    loop: null,
    message,
    codeLine
  });
}

function enterCall(
  trace: AlgorithmTrace,
  id: string,
  parentId: string | null,
  label: string,
  detail: string,
  depth: number,
  color: string,
  range: { start: number; end: number } | undefined,
  message: string,
  codeLine?: number
): void {
  push(trace, {
    type: "enterCall",
    frame: {
      id,
      parentId,
      label,
      detail,
      depth,
      color,
      range
    },
    message,
    codeLine
  });
}

function exitCall(trace: AlgorithmTrace, id: string, message?: string, codeLine?: number): void {
  push(trace, {
    type: "exitCall",
    id,
    message,
    codeLine
  });
}

function focusTreeNode(trace: AlgorithmTrace, nodeId: string | null, message?: string, codeLine?: number): void {
  push(trace, {
    type: "setTreeFocus",
    nodeId,
    message,
    codeLine
  });
}

function visitTreeNode(trace: AlgorithmTrace, nodeId: string, message: string, codeLine?: number): void {
  push(trace, {
    type: "visitTreeNode",
    nodeId,
    message,
    codeLine
  });
}

function buildCompleteBinaryTree(items: VisualItem[]): TreeVisualState {
  const nodes: TreeVisualState["nodes"] = {};
  const edges: TreeVisualState["edges"] = [];

  items.forEach((item, index) => {
    const depth = Math.floor(Math.log2(index + 1));
    const firstIndexAtDepth = 2 ** depth - 1;
    const order = index - firstIndexAtDepth;
    const parentIndex = index === 0 ? null : Math.floor((index - 1) / 2);
    const nodeId = `tree-${index}`;
    const parentId = parentIndex === null ? null : `tree-${parentIndex}`;
    nodes[nodeId] = {
      id: nodeId,
      itemId: item.id,
      label: String(item.value),
      parentId,
      depth,
      order,
      x: (order + 0.5) / 2 ** depth,
      y: depth,
      color: item.color
    };
    if (parentId) {
      edges.push({
        id: `${parentId}-${nodeId}`,
        from: parentId,
        to: nodeId
      });
    }
  });

  return {
    nodes,
    edges,
    rootId: items.length > 0 ? "tree-0" : null,
    activeNodeId: null,
    visitedNodeIds: [],
    queuedNodeIds: [],
    traversalLabel: "preorder"
  };
}

function move(
  trace: AlgorithmTrace,
  fromSlots: Array<string | null>,
  toSlots: Array<string | null>,
  from: { lane: LaneId; index: number },
  to: { lane: LaneId; index: number },
  message: string,
  codeLine?: number
): void {
  const itemId = readSlot(fromSlots, from.index);
  push(trace, { type: "move", from, to, itemId, message, codeLine });
  fromSlots[from.index] = null;
  toSlots[to.index] = itemId;
}

function moveById(trace: AlgorithmTrace, order: Array<string | null>, aux: Array<string | null>, itemId: string, auxIndex: number, message: string, codeLine?: number): void {
  const fromIndex = findIndex(order, itemId);
  move(trace, order, aux, { lane: "array", index: fromIndex }, { lane: "aux", index: auxIndex }, message, codeLine);
}

function valueLabel(values: Record<string, number>, itemId: string): string {
  return String(values[itemId]);
}

function swap(order: string[], left: number, right: number): void {
  const temp = order[left];
  order[left] = order[right];
  order[right] = temp;
}

function readSlot(slots: Array<string | null>, index: number): string {
  const itemId = slots[index];
  if (!itemId) throw new Error(`Expected an item at slot ${index}.`);
  return itemId;
}

function findIndex(slots: Array<string | null>, itemId: string): number {
  const index = slots.indexOf(itemId);
  if (index < 0) throw new Error(`Could not find ${itemId}.`);
  return index;
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}
