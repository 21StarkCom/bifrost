import assert from "node:assert/strict";
import { test } from "node:test";
import { idleSeconds, isDue, lastActivityMs, peerState, pollMs } from "./kevin_idle.ts";

const peers = (...rows: object[]) => JSON.stringify({ peers: rows });
const running = (pid: number) => pid === 1;

test("Kevin's row is found by sessionName, and a row whose pid is dead is gone", () => {
  const kevin = { id: "claude:k", sessionName: "KEVIN-bifrost-1", pid: 1 };
  const other = { id: "claude:o", sessionName: "KEVIN-other-1", pid: 1 };
  assert.deepEqual(peerState(peers(other, kevin), "KEVIN-bifrost-1", running), { state: "live", id: "claude:k" });
  assert.deepEqual(peerState(peers(other, { ...kevin, pid: 2 }), "KEVIN-bifrost-1", running), { state: "gone" });
  assert.deepEqual(peerState(peers(other), "KEVIN-bifrost-1", running), { state: "gone" });
});

test("output hermod did not shape as peers is unknown, never gone", () => {
  assert.deepEqual(peerState("not json", "KEVIN-bifrost-1", running), { state: "unknown" });
  assert.deepEqual(peerState("{}", "KEVIN-bifrost-1", running), { state: "unknown" });
});

test("last activity is kevin-last's epoch seconds, never earlier than the waker's start", () => {
  assert.equal(lastActivityMs("2000\n", 1_000_000), 2_000_000);
  assert.equal(lastActivityMs("500", 1_000_000), 1_000_000);
  assert.equal(lastActivityMs(undefined, 1_000_000), 1_000_000);
  assert.equal(lastActivityMs("garbage", 1_000_000), 1_000_000);
});

test("due once a whole idle period passed since the later of activity and the last wake", () => {
  assert.equal(isDue(7_199, 0, null, 7_200), false);
  assert.equal(isDue(7_200, 0, null, 7_200), true);
  assert.equal(isDue(10_000, 0, 7_200, 7_200), false);
  assert.equal(isDue(14_400, 0, 7_200, 7_200), true);
});

test("the threshold is kevin.idle_seconds when it is a whole number of seconds, else two hours", () => {
  assert.equal(idleSeconds(600), 600);
  for (const bad of [undefined, 0, -5, 1.5, "600", null]) assert.equal(idleSeconds(bad), 7200);
});

test("polls a twenty-fourth of the threshold, between 5 s and 5 min", () => {
  assert.equal(pollMs(7_200_000), 300_000);
  assert.equal(pollMs(86_400_000), 300_000);
  assert.equal(pollMs(60_000), 5_000);
  assert.equal(pollMs(1_200_000), 50_000);
});
