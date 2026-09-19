import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * DreamLoops adapter for farscout research cycles.
 *
 * When DREAMLOOPS_ENABLED is true, this maintains a state file and loop capsule
 * to enable stateful research cycles with dedup-by-state. When disabled, it's
 * a no-op passthrough that leaves farscout's existing behavior unchanged.
 */
export class DreamLoopsAdapter {
  constructor({ enabled = false, stateDir = null } = {}) {
    this.enabled = enabled;
    this.stateDir = stateDir || join(ROOT, '..', 'state', 'dreamloops');
    this.stateFile = join(this.stateDir, 'research-state.json');
    this.state = {
      researched_topics: new Set(),
      last_topics: [],
      run_count: 0,
      last_run_at: null,
    };
  }

  /**
   * Load research state from disk.
   * Returns early if DREAMLOOPS_ENABLED is false.
   */
  async load() {
    if (!this.enabled) return;

    try {
      const data = JSON.parse(await readFile(this.stateFile, 'utf8'));
      this.state = {
        researched_topics: new Set(data.researched_topics || []),
        last_topics: data.last_topics || [],
        run_count: data.run_count || 0,
        last_run_at: data.last_run_at || null,
      };
    } catch {
      // File doesn't exist yet or is invalid; use defaults
      this.state = {
        researched_topics: new Set(),
        last_topics: [],
        run_count: 0,
        last_run_at: null,
      };
    }
  }

  /**
   * Save research state to disk.
   * Returns early if DREAMLOOPS_ENABLED is false.
   */
  async save() {
    if (!this.enabled) return;

    await mkdir(dirname(this.stateFile), { recursive: true }).catch(() => {});
    const data = {
      researched_topics: Array.from(this.state.researched_topics),
      last_topics: this.state.last_topics,
      run_count: this.state.run_count,
      last_run_at: this.state.last_run_at,
    };
    await writeFile(this.stateFile, JSON.stringify(data, null, 2));
  }

  /**
   * Dedup check: returns true if this topic has been researched recently.
   * When disabled, always returns false (allow all topics through).
   */
  hasResearched(topic) {
    if (!this.enabled) return false;
    return this.state.researched_topics.has(topic);
  }

  /**
   * Record a topic as researched.
   * When disabled, this is a no-op.
   */
  markResearched(topic) {
    if (!this.enabled) return;
    this.state.researched_topics.add(topic);
    this.state.last_topics.unshift(topic);
    // Keep only the last 100 topics in memory
    if (this.state.last_topics.length > 100) {
      this.state.last_topics.pop();
    }
  }

  /**
   * Record a research run.
   * When disabled, this is a no-op.
   */
  recordRun() {
    if (!this.enabled) return;
    this.state.run_count += 1;
    this.state.last_run_at = Date.now();
  }

  /**
   * Get current state snapshot (for testing and debugging).
   * Returns empty/default state when disabled.
   */
  getState() {
    if (!this.enabled) {
      return {
        researched_topics: [],
        last_topics: [],
        run_count: 0,
        last_run_at: null,
      };
    }
    return {
      researched_topics: Array.from(this.state.researched_topics),
      last_topics: this.state.last_topics,
      run_count: this.state.run_count,
      last_run_at: this.state.last_run_at,
    };
  }
}

/**
 * Factory function to create a DreamLoops adapter.
 */
export function makeDreamLoopsAdapter(options = {}) {
  const enabled = options.enabled ?? process.env.DREAMLOOPS_ENABLED === 'true';
  return new DreamLoopsAdapter({ enabled, stateDir: options.stateDir });
}
