import {
  acquireBrowserCheckinLease,
  type BrowserCheckinLeaseStore,
  releaseActiveBrowserCheckinLeases,
} from "./browser_checkin_lease_service.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

class FakeStore implements BrowserCheckinLeaseStore {
  attempts = 0;
  heartbeats = 0;
  released: string[] = [];

  constructor(private acquireOnAttempt: number) {}

  tryAcquire(_owner: string, _ttlMs: number): Promise<boolean> {
    this.attempts += 1;
    return Promise.resolve(this.attempts >= this.acquireOnAttempt);
  }

  heartbeat(_owner: string, _ttlMs: number): Promise<boolean> {
    this.heartbeats += 1;
    return Promise.resolve(true);
  }

  release(owner: string): Promise<void> {
    this.released.push(owner);
    return Promise.resolve();
  }
}

Deno.test("browser lease waits with an injected clock and reports busy", async () => {
  const store = new FakeStore(Number.POSITIVE_INFINITY);
  let now = 1_000;
  const result = await acquireBrowserCheckinLease(
    { maxWaitMs: 500, pollMs: 200 },
    {
      store,
      now: () => now,
      sleep: (ms) => {
        now += ms;
        return Promise.resolve();
      },
      makeOwner: () => "owner-a",
    },
  );
  assert(!result.acquired, "lease should be busy");
  assertEquals(result.waitedMs, 500, "wait duration");
  assertEquals(store.attempts, 4, "acquisition attempts");
});

Deno.test("browser lease heartbeats and releases only its owner", async () => {
  const store = new FakeStore(2);
  let now = 5_000;
  let intervalCallback: (() => void) | null = null;
  let cleared = false;
  const result = await acquireBrowserCheckinLease(
    { maxWaitMs: 1_000, pollMs: 250 },
    {
      store,
      now: () => now,
      sleep: (ms) => {
        now += ms;
        return Promise.resolve();
      },
      makeOwner: () => "owner-b",
      setInterval: (callback) => {
        intervalCallback = callback;
        return 7;
      },
      clearInterval: (timer) => {
        assertEquals(timer, 7, "timer id");
        cleared = true;
      },
    },
  );
  assert(result.acquired, "lease should be acquired");
  assertEquals(result.waitedMs, 250, "acquisition wait");
  const stop = result.startHeartbeat();
  assert(intervalCallback, "heartbeat should be scheduled");
  (intervalCallback as () => void)();
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(store.heartbeats, 1, "heartbeat count");
  stop();
  assert(cleared, "heartbeat should stop");
  await result.release();
  assertEquals(store.released, ["owner-b"], "released owner");
});

Deno.test("browser lease graceful shutdown releases active owners", async () => {
  const store = new FakeStore(1);
  let heartbeatStopped = false;
  const result = await acquireBrowserCheckinLease(
    { maxWaitMs: 0 },
    {
      store,
      makeOwner: () => "owner-shutdown",
      setInterval: () => 11,
      clearInterval: () => heartbeatStopped = true,
    },
  );
  assert(result.acquired, "lease should be acquired");
  result.startHeartbeat();
  await releaseActiveBrowserCheckinLeases();
  assert(heartbeatStopped, "graceful shutdown did not stop heartbeat");
  assertEquals(
    store.released,
    ["owner-shutdown"],
    "graceful shutdown released owners",
  );
});
