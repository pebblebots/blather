/**
 * In-memory agent status store. Ephemeral — no DB persistence.
 */

export interface AgentStatus {
  text: string;
  progress?: number;   // 0–1
  eta?: string;        // e.g. "2m", "30s"
  setAt: number;       // Date.now() when set
}

// userId -> status
const statusMap = new Map<string, AgentStatus>();
// userId -> autoclear timer
const clearTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Parse duration string like "5m", "30s", "1h" to milliseconds. */
function parseDuration(d: string): number | null {
  const m = d.match(/^(\d+(?:\.\d+)?)\s*(s|m|h)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 's': return n * 1_000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    default: return null;
  }
}

export function setAgentStatus(
  userId: string,
  text: string,
  opts?: { autoclear?: string; progress?: number; eta?: string },
  onClear?: (userId: string) => void,
): AgentStatus {
  // Cancel any existing autoclear
  const existing = clearTimers.get(userId);
  if (existing) clearTimeout(existing);
  clearTimers.delete(userId);

  const status: AgentStatus = {
    text,
    setAt: Date.now(),
    ...(opts?.progress != null ? { progress: opts.progress } : {}),
    ...(opts?.eta ? { eta: opts.eta } : {}),
  };
  statusMap.set(userId, status);

  // Schedule autoclear
  if (opts?.autoclear) {
    const ms = parseDuration(opts.autoclear);
    if (ms && ms > 0) {
      clearTimers.set(userId, setTimeout(() => {
        statusMap.delete(userId);
        clearTimers.delete(userId);
        onClear?.(userId);
      }, ms));
    }
  }

  return status;
}

export function clearAgentStatus(userId: string): boolean {
  const existed = statusMap.has(userId);
  statusMap.delete(userId);
  const timer = clearTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    clearTimers.delete(userId);
  }
  return existed;
}

export function getAgentStatus(userId: string): AgentStatus | undefined {
  return statusMap.get(userId);
}

export function getAllStatuses(): Map<string, AgentStatus> {
  return new Map(statusMap);
}
