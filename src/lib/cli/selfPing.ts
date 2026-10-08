import type { CliCommandSet, CliResult } from "./types";

/**
 * A device pinging one of its OWN addresses: every real OS answers over its loopback, instantly, with nothing on the
 * wire (no ARP, no frame, no hop). Lesson simulators model packets between devices, so without this a self-ping
 * would wrongly ARP for itself, time out or be unreachable.
 *
 * `withSelfPing` wraps a command set: any command whose syntax starts with "ping" and whose arguments name one of
 * `own` answers locally in that OS's format. Everything else runs unchanged.
 */
export type PingOs = "linux" | "windows" | "ios" | "junos";

const DEFAULT_COUNT: Record<PingOs, number> = { linux: 4, windows: 4, ios: 5, junos: 5 };

export function selfPingText(os: PingOs, ip: string, count?: number, data?: number): string {
  const n = count ?? DEFAULT_COUNT[os];
  const seq = Array.from({ length: n }, (_, i) => i);
  if (os === "windows") {
    const b = data ?? 32;
    return [`Pinging ${ip} with ${b} bytes of data:`, ...seq.map(() => `Reply from ${ip}: bytes=${b} time<1ms TTL=128`), "", `Ping statistics for ${ip}:`, `    Packets: Sent = ${n}, Received = ${n}, Lost = 0 (0% loss),`, "Approximate round trip times in milli-seconds:", "    Minimum = 0ms, Maximum = 0ms, Average = 0ms"].join("\n");
  }
  if (os === "ios") {
    return ["Type escape sequence to abort.", `Sending ${n}, ${data ?? 100}-byte ICMP Echos to ${ip}, timeout is 2 seconds:`, "!".repeat(n), `Success rate is 100 percent (${n}/${n}), round-trip min/avg/max = 1/1/1 ms`].join("\n");
  }
  const b = data ?? 56;
  if (os === "junos") {
    return [`PING ${ip} (${ip}): ${b} data bytes`, ...seq.map((i) => `${b + 8} bytes from ${ip}: icmp_seq=${i} ttl=64 time=0.05${i} ms`), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, ${n} packets received, 0% packet loss`, "round-trip min/avg/max/stddev = 0.050/0.052/0.054/0.002 ms"].join("\n");
  }
  return [`PING ${ip} (${ip}) ${b}(${b + 28}) bytes of data.`, ...seq.map((i) => `${b + 8} bytes from ${ip}: icmp_seq=${i + 1} ttl=64 time=0.0${3 + (i % 5)} ms`), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, ${n} received, 0% packet loss, time ${(n - 1) * 1000}ms`].join("\n");
}

export function selfPing(os: PingOs, ip: string, device: string, count?: number, data?: number): CliResult {
  return { output: selfPingText(os, ip, count, data), explanation: `${ip} is ${device}'s own address: it answers itself over its loopback. Nothing was sent on the wire, so this proves only that its own IP stack is up.` };
}

export function withSelfPing(set: CliCommandSet, os: PingOs, own: (string | undefined)[]): CliCommandSet {
  const mine = new Set(own.filter((x): x is string => !!x));
  if (!mine.size) return set;
  return {
    ...set,
    commands: set.commands.map((c) =>
      !/^ping\b/.test(c.syntax)
        ? c
        : {
            ...c,
            run: (args) => {
              const ip = Object.values(args).find((v) => mine.has(v));
              if (!ip) return c.run(args);
              const count = Number(args.count ?? args.n ?? args.repeat);
              const data = Number(args.size ?? args.bytes);
              return selfPing(os, ip, set.deviceName, Number.isFinite(count) && count > 0 ? count : undefined, Number.isFinite(data) && data >= 0 ? data : undefined);
            },
          },
    ),
  };
}
