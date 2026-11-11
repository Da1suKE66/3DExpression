import { COEFFICIENTS } from './core.js?v=0.5.0';

// Delay processed expressions only. Camera inference and head motion never wait.
export class ExpressionDelayBuffer {
  constructor(delayMs = 400, staleMs = 400) { this.configure(delayMs); this.staleMs = staleMs; this.reset('initial'); }
  configure(delayMs) {
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 2000) throw new Error('附加延迟须为0–2000ms整数');
    this.delayMs = delayMs; this.reset('configured');
  }
  reset(reason = 'reset') { this.queue = []; this.lastTime = null; this.lastSourceTime = null; this.lastRead = null; this.reason = reason; }
  push(input) {
    if (!input?.expression || !Number.isFinite(input.available_at_ms) || !Number.isFinite(input.input_timestamp_ms) || input.input_timestamp_ms < 0 || input.input_timestamp_ms > input.available_at_ms || COEFFICIENTS.some(k => !Number.isFinite(input.expression[k]) || input.expression[k] < 0 || input.expression[k] > 1)) { this.reset('invalid_input'); return false; }
    if (this.lastTime !== null && (input.available_at_ms <= this.lastTime || input.input_timestamp_ms <= this.lastSourceTime)) { this.reset('non_monotonic_input'); return false; }
    if (this.lastTime !== null && input.available_at_ms - this.lastTime > this.staleMs) this.reset('input_gap');
    this.lastTime = input.available_at_ms;
    this.lastSourceTime = input.input_timestamp_ms;
    this.queue.push({ ...input, expression: { ...input.expression } });
    // Bound memory even if output is not polled. Keep the most recent due sample.
    const cutoff = input.available_at_ms - this.delayMs - this.staleMs;
    while (this.queue.length > 1 && this.queue[1].available_at_ms < cutoff) this.queue.shift();
    return true;
  }
  sample(now) {
    if (!Number.isFinite(now) || (this.lastRead !== null && now < this.lastRead) || (this.lastTime !== null && now < this.lastTime)) { this.reset('non_monotonic_clock'); return null; }
    this.lastRead = now;
    if (this.lastTime !== null && now - this.lastTime > this.staleMs) { this.reset('tracking_stale'); return null; }
    const due = now - this.delayMs;
    while (this.queue.length > 1 && this.queue[1].available_at_ms <= due) this.queue.shift();
    const candidate = this.queue[0];
    return candidate && candidate.available_at_ms <= due ? candidate : null;
  }
}
