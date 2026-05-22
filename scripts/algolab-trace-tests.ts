import assert from "node:assert/strict";
import { ALGORITHM_DEFINITIONS } from "../src/frontend/components/algolab/algorithms";
import { deriveTraceFrame, getLaneValues } from "../src/frontend/components/algolab/trace";
import type { AlgorithmTrace, LaneId, LanePosition, TraceEvent, VisualState } from "../src/frontend/components/algolab/types";

const CASES = [
  [5, 3, 5, 1, 2],
  [1, 2, 3, 4, 5],
  [9, 8, 7, 6, 5],
  [4, 4, 2, 4, 1]
];

for (const definition of ALGORITHM_DEFINITIONS) {
  for (const input of CASES) {
    const trace = definition.generateTrace(input);
    assert.equal(trace.initialState.items.length, input.length, `${definition.id}: item count should match input`);
    assert.ok(trace.events.length > 0, `${definition.id}: trace should emit events`);

    const knownIds = new Set(trace.initialState.items.map((item) => item.id));
    const duplicateIds = trace.initialState.items.filter((item) => input.filter((value) => value === item.value).length > 1).map((item) => item.id);
    const initialFrame = deriveTraceFrame(trace, 0);
    validateFrame(trace, initialFrame, knownIds, 0);

    let previousFrame = initialFrame;
    trace.events.forEach((event, index) => {
      validateEvent(trace, event, previousFrame, knownIds, index + 1);
      const nextFrame = deriveTraceFrame(trace, index + 1);
      validateFrame(trace, nextFrame, knownIds, index + 1);
      previousFrame = nextFrame;
    });

    const finalFrame = deriveTraceFrame(trace, trace.events.length);
    if (finalFrame.tree) {
      validateCompleteTreeTraversal(trace, finalFrame, knownIds);
    } else {
      const finalValues = getLaneValues(finalFrame);
      assert.deepEqual(finalValues, [...input].sort((left, right) => left - right), `${definition.id}: final values should be sorted for ${input.join(",")}`);
      assert.deepEqual(
        new Set(finalFrame.lanes.array.filter(isString)),
        knownIds,
        `${definition.id}: final array should preserve every item id`
      );
      duplicateIds.forEach((itemId) => {
        assert.ok(finalFrame.lanes.array.includes(itemId), `${definition.id}: duplicate item id ${itemId} should remain present`);
      });
    }
  }
}

console.log(`Algorithm Lab trace tests passed for ${ALGORITHM_DEFINITIONS.length} algorithms.`);

function validateEvent(trace: AlgorithmTrace, event: TraceEvent, previousFrame: VisualState, knownIds: Set<string>, step: number): void {
  switch (event.type) {
    case "compare":
      event.itemIds.forEach((itemId) => assertKnownId(trace, knownIds, itemId, step));
      event.indices?.forEach((index) => assertSlotIndex(trace, "array", index, step));
      break;
    case "swap": {
      const lane = event.lane ?? "array";
      event.indices.forEach((index) => assertSlotIndex(trace, lane, index, step));
      break;
    }
    case "move":
      validatePosition(trace, event.from, step);
      validatePosition(trace, event.to, step);
      assert.equal(previousFrame.lanes[event.to.lane][event.to.index], null, `${trace.algorithmId} step ${step}: move destination should be empty`);
      if (event.itemId) {
        assertKnownId(trace, knownIds, event.itemId, step);
        assert.equal(previousFrame.lanes[event.from.lane][event.from.index], event.itemId, `${trace.algorithmId} step ${step}: move item should match source slot`);
      }
      break;
    case "setPointer":
      if (event.pointer) validatePosition(trace, event.pointer, step);
      break;
    case "setRange":
      if (event.range) {
        assertSlotIndex(trace, event.range.lane, event.range.start, step);
        assertSlotIndex(trace, event.range.lane, event.range.end, step);
        assert.ok(event.range.start <= event.range.end, `${trace.algorithmId} step ${step}: range start should not exceed end`);
      }
      break;
    case "setLoop":
      if (event.loop) {
        validateLoop(trace, event.id, { id: event.id, ...event.loop }, step);
      }
      break;
    case "enterCall":
      assert.ok(event.frame.id.trim(), `${trace.algorithmId} step ${step}: call frame id should be present`);
      assert.ok(event.frame.label.trim(), `${trace.algorithmId} step ${step}: call frame label should be present`);
      assert.ok(Number.isInteger(event.frame.depth) && event.frame.depth >= 0, `${trace.algorithmId} step ${step}: call depth should be a non-negative integer`);
      if (event.frame.parentId) {
        assert.ok(previousFrame.callFrames[event.frame.parentId], `${trace.algorithmId} step ${step}: call parent ${event.frame.parentId} should exist`);
      }
      if (event.frame.range) {
        assertSlotIndex(trace, "array", event.frame.range.start, step);
        assertSlotIndex(trace, "array", event.frame.range.end, step);
        assert.ok(event.frame.range.start <= event.frame.range.end, `${trace.algorithmId} step ${step}: call range start should not exceed end`);
      }
      break;
    case "exitCall":
      assert.ok(previousFrame.callFrames[event.id], `${trace.algorithmId} step ${step}: exiting call ${event.id} should exist`);
      assert.equal(previousFrame.callFrames[event.id].status, "open", `${trace.algorithmId} step ${step}: exiting call ${event.id} should still be open`);
      break;
    case "setTreeFocus":
      if (event.nodeId) assertKnownTreeNode(trace, previousFrame, event.nodeId, step);
      break;
    case "visitTreeNode": {
      const node = assertKnownTreeNode(trace, previousFrame, event.nodeId, step);
      assertKnownId(trace, knownIds, node.itemId, step);
      assert.ok(event.message.trim(), `${trace.algorithmId} step ${step}: tree visit should explain the visit`);
      break;
    }
    case "markSorted":
      event.itemIds.forEach((itemId) => assertKnownId(trace, knownIds, itemId, step));
      break;
    case "explain":
      assert.ok(event.message.trim(), `${trace.algorithmId} step ${step}: explain event should have a message`);
      break;
  }
}

function validateFrame(trace: AlgorithmTrace, frame: VisualState, knownIds: Set<string>, step: number): void {
  assert.equal(frame.lanes.array.length, trace.initialState.items.length, `${trace.algorithmId} step ${step}: array lane length changed`);
  assert.equal(frame.lanes.aux.length, trace.initialState.items.length, `${trace.algorithmId} step ${step}: aux lane length changed`);

  const visibleIds = [...frame.lanes.array, ...frame.lanes.aux].filter(isString);
  assert.equal(visibleIds.length, knownIds.size, `${trace.algorithmId} step ${step}: each item should be visible once`);
  assert.equal(new Set(visibleIds).size, knownIds.size, `${trace.algorithmId} step ${step}: item ids should not duplicate across lanes`);
  visibleIds.forEach((itemId) => assertKnownId(trace, knownIds, itemId, step));

  Object.values(frame.pointers).forEach((pointer) => validatePosition(trace, pointer, step));
  Object.values(frame.ranges).forEach((range) => {
    assertSlotIndex(trace, range.lane, range.start, step);
    assertSlotIndex(trace, range.lane, range.end, step);
    assert.ok(range.start <= range.end, `${trace.algorithmId} step ${step}: frame range start should not exceed end`);
  });
  Object.values(frame.loops).forEach((loop) => validateLoop(trace, loop.id, loop, step));
  Object.values(frame.callFrames).forEach((callFrame) => {
    assert.ok(callFrame.id.trim(), `${trace.algorithmId} step ${step}: call frame id should be present`);
    assert.ok(callFrame.label.trim(), `${trace.algorithmId} step ${step}: call frame label should be present`);
    assert.ok(callFrame.status === "open" || callFrame.status === "complete", `${trace.algorithmId} step ${step}: call frame status should be valid`);
    assert.ok(Number.isInteger(callFrame.depth) && callFrame.depth >= 0, `${trace.algorithmId} step ${step}: call frame depth should be non-negative`);
    if (callFrame.parentId) {
      assert.ok(frame.callFrames[callFrame.parentId], `${trace.algorithmId} step ${step}: call frame parent ${callFrame.parentId} should exist`);
    }
    if (callFrame.range) {
      assertSlotIndex(trace, "array", callFrame.range.start, step);
      assertSlotIndex(trace, "array", callFrame.range.end, step);
      assert.ok(callFrame.range.start <= callFrame.range.end, `${trace.algorithmId} step ${step}: call frame range start should not exceed end`);
    }
  });
  if (frame.activeCallId) {
    assert.ok(frame.callFrames[frame.activeCallId], `${trace.algorithmId} step ${step}: active call should exist`);
    assert.equal(frame.callFrames[frame.activeCallId].status, "open", `${trace.algorithmId} step ${step}: active call should be open`);
  }
  if (frame.tree) validateTreeState(trace, frame, knownIds, step);
  [...frame.activeCompare, ...frame.activeMoved, ...frame.sortedIds].forEach((itemId) => assertKnownId(trace, knownIds, itemId, step));
  assert.equal(new Set(frame.sortedIds).size, frame.sortedIds.length, `${trace.algorithmId} step ${step}: sorted ids should be unique`);
}

function validateTreeState(trace: AlgorithmTrace, frame: VisualState, knownIds: Set<string>, step: number): void {
  assert.ok(frame.tree, `${trace.algorithmId} step ${step}: tree state should exist`);
  const tree = frame.tree;
  const nodeIds = new Set(Object.keys(tree.nodes));
  assert.ok(tree.traversalLabel.trim(), `${trace.algorithmId} step ${step}: tree traversal label should be present`);
  if (tree.rootId) assert.ok(nodeIds.has(tree.rootId), `${trace.algorithmId} step ${step}: tree root should exist`);
  Object.entries(tree.nodes).forEach(([id, node]) => {
    assert.equal(node.id, id, `${trace.algorithmId} step ${step}: tree node id should match its map key`);
    assertKnownId(trace, knownIds, node.itemId, step);
    assert.ok(node.label.trim(), `${trace.algorithmId} step ${step}: tree node label should be present`);
    assert.ok(Number.isInteger(node.depth) && node.depth >= 0, `${trace.algorithmId} step ${step}: tree node depth should be non-negative`);
    assert.ok(Number.isInteger(node.order) && node.order >= 0, `${trace.algorithmId} step ${step}: tree node order should be non-negative`);
    assert.ok(Number.isFinite(node.x), `${trace.algorithmId} step ${step}: tree node x should be finite`);
    assert.ok(Number.isFinite(node.y), `${trace.algorithmId} step ${step}: tree node y should be finite`);
    if (node.parentId) assert.ok(nodeIds.has(node.parentId), `${trace.algorithmId} step ${step}: tree parent ${node.parentId} should exist`);
  });
  tree.edges.forEach((edge) => {
    assert.ok(edge.id.trim(), `${trace.algorithmId} step ${step}: tree edge id should be present`);
    assert.ok(nodeIds.has(edge.from), `${trace.algorithmId} step ${step}: tree edge source ${edge.from} should exist`);
    assert.ok(nodeIds.has(edge.to), `${trace.algorithmId} step ${step}: tree edge target ${edge.to} should exist`);
  });
  if (tree.activeNodeId) assert.ok(nodeIds.has(tree.activeNodeId), `${trace.algorithmId} step ${step}: active tree node should exist`);
  assert.equal(new Set(tree.visitedNodeIds).size, tree.visitedNodeIds.length, `${trace.algorithmId} step ${step}: visited tree nodes should be unique`);
  assert.equal(new Set(tree.queuedNodeIds).size, tree.queuedNodeIds.length, `${trace.algorithmId} step ${step}: queued tree nodes should be unique`);
  [...tree.visitedNodeIds, ...tree.queuedNodeIds].forEach((nodeId) => assert.ok(nodeIds.has(nodeId), `${trace.algorithmId} step ${step}: tree node ${nodeId} should exist`));
}

function validateCompleteTreeTraversal(trace: AlgorithmTrace, frame: VisualState, knownIds: Set<string>): void {
  assert.ok(frame.tree, `${trace.algorithmId}: tree state should exist at the final frame`);
  const nodeIds = Object.keys(frame.tree.nodes);
  assert.equal(frame.tree.visitedNodeIds.length, nodeIds.length, `${trace.algorithmId}: final traversal should visit every node`);
  const visitedItemIds = frame.tree.visitedNodeIds.map((nodeId) => frame.tree?.nodes[nodeId]?.itemId).filter(isString);
  assert.deepEqual(new Set(visitedItemIds), knownIds, `${trace.algorithmId}: final traversal should preserve every item id`);
  assert.deepEqual(new Set(frame.sortedIds), knownIds, `${trace.algorithmId}: visited items should be marked in the frame details`);
}

function validateLoop(trace: AlgorithmTrace, id: string, loop: VisualState["loops"][string], step: number): void {
  assert.ok(id.trim(), `${trace.algorithmId} step ${step}: loop id should be present`);
  assert.ok(loop.label.trim(), `${trace.algorithmId} step ${step}: loop label should be present`);
  assert.ok(Number.isInteger(loop.current), `${trace.algorithmId} step ${step}: loop current should be an integer`);
  assert.ok(Number.isInteger(loop.total), `${trace.algorithmId} step ${step}: loop total should be an integer`);
  assert.ok(loop.current >= 0, `${trace.algorithmId} step ${step}: loop current should not be negative`);
  assert.ok(loop.total >= 0, `${trace.algorithmId} step ${step}: loop total should not be negative`);
  assert.ok(loop.current <= loop.total, `${trace.algorithmId} step ${step}: loop current should not exceed total`);
  assert.ok(Number.isInteger(loop.depth) && loop.depth >= 0, `${trace.algorithmId} step ${step}: loop depth should be non-negative`);
}

function validatePosition(trace: AlgorithmTrace, position: LanePosition, step: number): void {
  assertSlotIndex(trace, position.lane, position.index, step);
}

function assertSlotIndex(trace: AlgorithmTrace, lane: LaneId, index: number, step: number): void {
  assert.ok(Number.isInteger(index), `${trace.algorithmId} step ${step}: ${lane} index should be an integer`);
  assert.ok(index >= 0 && index < trace.initialState.lanes[lane].length, `${trace.algorithmId} step ${step}: ${lane} index ${index} out of bounds`);
}

function assertKnownId(trace: AlgorithmTrace, knownIds: Set<string>, itemId: string, step: number): void {
  assert.ok(knownIds.has(itemId), `${trace.algorithmId} step ${step}: unknown item id ${itemId}`);
}

function assertKnownTreeNode(trace: AlgorithmTrace, frame: VisualState, nodeId: string, step: number) {
  assert.ok(frame.tree, `${trace.algorithmId} step ${step}: tree event requires tree state`);
  const node = frame.tree.nodes[nodeId];
  assert.ok(node, `${trace.algorithmId} step ${step}: unknown tree node ${nodeId}`);
  return node;
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}
