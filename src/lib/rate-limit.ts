export class FixedWindowRateLimiter {
  private readonly callTimes: number[] = [];

  allow(maxPerHour: number, now = Date.now()): boolean {
    while (this.callTimes.length && now - this.callTimes[0] > 3_600_000) this.callTimes.shift();
    if (this.callTimes.length >= maxPerHour) return false;
    this.callTimes.push(now);
    return true;
  }
}

// Cùng instance được dùng bởi analyze và deepen trong một tiến trình server.
export const aiRateLimiter = new FixedWindowRateLimiter();
