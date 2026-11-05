import type { RecurringService } from "./recurring.service";

/**
 * The one timer of recurring-fixed-expense.
 *
 * It does NOT poll for "is it the 1st": it asks when the next rule is due and
 * sleeps until then. The only recurring cost is one tiny indexed query per
 * wake-up, and the wake-up happens at the scheduled moment.
 *
 * The sleep is capped so a clock jump or a restart can never postpone a rule
 * indefinitely, and `tick()` runs once on boot: whatever fell due while the
 * process was asleep or deploying is handled immediately.
 */
const MAX_SLEEP_MS = 6 * 60 * 60 * 1000;
/** When a rule is already overdue, retry the pass in a minute instead of spinning. */
const OVERDUE_RETRY_MS = 60 * 1000;

export class RecurringScheduler {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;

  constructor(
    private readonly service: RecurringService,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  start(): void {
    this.stopped = false;
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Re-arms after a rule is created, so a new template is not discovered late. */
  reschedule(): void {
    if (this.stopped) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    void this.arm();
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      const asked = await this.service.processDue();
      const reminded = await this.service.remindPending();
      if (asked > 0 || reminded > 0) {
        this.log(`recurring: asked ${asked}, reminded ${reminded}`);
      }
    } catch (error) {
      this.log(`recurring: pass failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
    await this.arm();
  }

  private async arm(): Promise<void> {
    if (this.stopped) return;
    let delay = MAX_SLEEP_MS;
    try {
      const next = await this.service.nextWakeAt();
      if (next === null) {
        delay = MAX_SLEEP_MS;
      } else {
        const remaining = next.getTime() - Date.now();
        delay = remaining <= 0 ? OVERDUE_RETRY_MS : Math.min(remaining, MAX_SLEEP_MS);
      }
    } catch (error) {
      this.log(`recurring: could not compute the next wake-up: ${String(error)}`);
    }
    this.timer = setTimeout(() => void this.tick(), delay);
    // Never keep the process alive just for this timer.
    this.timer.unref?.();
  }
}
