import { getSql } from "../db/client.ts";

const GLOBAL_LEASE_KEY = "global";

export interface BrowserCheckinLeaseStore {
  tryAcquire(owner: string, ttlMs: number): Promise<boolean>;
  heartbeat(owner: string, ttlMs: number): Promise<boolean>;
  release(owner: string): Promise<void>;
}

interface LeaseDependencies {
  store: BrowserCheckinLeaseStore;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  makeOwner: () => string;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (timer: unknown) => void;
}

export interface BrowserCheckinLease {
  acquired: true;
  owner: string;
  waitedMs: number;
  startHeartbeat(): () => void;
  release(): Promise<void>;
  /** Stop local ownership but leave the DB row to expire as a safety quarantine. */
  abandon(): void;
}

export interface BrowserCheckinLeaseBusy {
  acquired: false;
  waitedMs: number;
}

class PostgresBrowserCheckinLeaseStore implements BrowserCheckinLeaseStore {
  async tryAcquire(owner: string, ttlMs: number): Promise<boolean> {
    const sql = getSql();
    const rows = await sql<{ owner: string }[]>`
      insert into browser_checkin_leases (
        name, owner, expires_at, updated_at
      ) values (
        ${GLOBAL_LEASE_KEY}, ${owner},
        now() + (${ttlMs} * interval '1 millisecond'), now()
      )
      on conflict (name) do update
      set owner = excluded.owner,
          expires_at = excluded.expires_at,
          updated_at = now()
      where browser_checkin_leases.expires_at <= now()
      returning owner
    `;
    return rows[0]?.owner === owner;
  }

  async heartbeat(owner: string, ttlMs: number): Promise<boolean> {
    const sql = getSql();
    const rows = await sql<{ owner: string }[]>`
      update browser_checkin_leases
      set expires_at = now() + (${ttlMs} * interval '1 millisecond'),
          updated_at = now()
      where name = ${GLOBAL_LEASE_KEY} and owner = ${owner}
      returning owner
    `;
    return rows[0]?.owner === owner;
  }

  async release(owner: string): Promise<void> {
    const sql = getSql();
    await sql`
      delete from browser_checkin_leases
      where name = ${GLOBAL_LEASE_KEY} and owner = ${owner}
    `;
  }
}

const defaultDependencies: LeaseDependencies = {
  store: new PostgresBrowserCheckinLeaseStore(),
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  makeOwner: () => crypto.randomUUID(),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (timer) =>
    clearInterval(timer as ReturnType<typeof setInterval>),
};

const activeLeases = new Map<
  string,
  { store: BrowserCheckinLeaseStore; stopHeartbeat: () => void }
>();

/** Release locally held leases during a graceful process shutdown. */
export async function releaseActiveBrowserCheckinLeases(): Promise<void> {
  const entries = [...activeLeases.entries()];
  await Promise.allSettled(entries.map(async ([owner, active]) => {
    active.stopHeartbeat();
    try {
      await active.store.release(owner);
    } finally {
      activeLeases.delete(owner);
    }
  }));
}

/**
 * Acquire the single browser slot shared by all application instances.
 * Expired rows are taken over atomically in PostgreSQL. Tests can provide an
 * in-memory store and clock, so no real database is required.
 */
export async function acquireBrowserCheckinLease(
  options: {
    maxWaitMs: number;
    ttlMs?: number;
    heartbeatMs?: number;
    pollMs?: number;
  },
  dependencies: Partial<LeaseDependencies> = {},
): Promise<BrowserCheckinLease | BrowserCheckinLeaseBusy> {
  const deps = { ...defaultDependencies, ...dependencies };
  const ttlMs = options.ttlMs ?? 150_000;
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  const pollMs = options.pollMs ?? 250;
  const maxWaitMs = Math.max(0, options.maxWaitMs);
  const owner = deps.makeOwner();
  const startedAt = deps.now();

  while (true) {
    if (await deps.store.tryAcquire(owner, ttlMs)) {
      let timer: unknown | null = null;
      let refreshing = false;
      const stopHeartbeat = () => {
        if (timer !== null) deps.clearInterval(timer);
        timer = null;
      };
      activeLeases.set(owner, {
        store: deps.store,
        stopHeartbeat,
      });
      return {
        acquired: true,
        owner,
        waitedMs: Math.max(0, deps.now() - startedAt),
        startHeartbeat() {
          if (timer !== null) return stopHeartbeat;
          timer = deps.setInterval(() => {
            if (refreshing) return;
            refreshing = true;
            void deps.store.heartbeat(owner, ttlMs).then((held) => {
              if (!held) stopHeartbeat();
            }).catch(() => {
              // The original 150s TTL exceeds the whole browser deadline; a
              // transient heartbeat error therefore does not invalidate the
              // running task or leak credentials into logs.
            }).finally(() => {
              refreshing = false;
            });
          }, heartbeatMs);
          const active = activeLeases.get(owner);
          if (active) active.stopHeartbeat = stopHeartbeat;
          return stopHeartbeat;
        },
        async release() {
          stopHeartbeat();
          try {
            await deps.store.release(owner);
          } finally {
            activeLeases.delete(owner);
          }
        },
        abandon() {
          stopHeartbeat();
          activeLeases.delete(owner);
        },
      };
    }

    const elapsed = Math.max(0, deps.now() - startedAt);
    if (elapsed >= maxWaitMs) {
      return { acquired: false, waitedMs: elapsed };
    }
    await deps.sleep(Math.min(pollMs, maxWaitMs - elapsed));
  }
}
