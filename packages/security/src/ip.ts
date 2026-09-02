import { isIP } from "node:net";

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["224.0.0.0", 3],
];

function v4ToInt(ip: string): number {
  const [a, b, c, d] = ip.split(".").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

const BLOCKED_V4_RANGES = BLOCKED_V4.map(([base, prefix]) => {
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return { base: (v4ToInt(base) & mask) >>> 0, mask };
});

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return BLOCKED_V4_RANGES.every(({ base, mask }) => (n & mask) >>> 0 !== base);
}

// Expands an IPv6 literal into its 8 16-bit groups; null = fail closed
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();

  const dotted = /:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    if (isIP(dotted[1]!) !== 4) return null;
    const n = v4ToInt(dotted[1]!);
    s =
      s.slice(0, -dotted[1]!.length) +
      (n >>> 16).toString(16) +
      ":" +
      (n & 0xffff).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 2 && fill < 1) return null;

  const parts = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (parts.length !== 8) return null;
  const groups = parts.map((p) => parseInt(p, 16));
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

function isPublicV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  /** Two 16-bit groups back to the dotted IPv4 they carry. */
  const embeddedV4 = (hi: number, lo: number) =>
    `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

  // ::ffff:a.b.c.d — IPv4-mapped: the classification of the embedded IPv4 is the answer
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0xffff
  ) {
    return isPublicV4(embeddedV4(g6, g7));
  }
  // 64:ff9b::/96 — NAT64: same trick via a translation gateway.
  if (
    g0 === 0x64 &&
    g1 === 0xff9b &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0
  ) {
    return isPublicV4(embeddedV4(g6, g7));
  }
  // 2002::/16 — 6to4: the embedded IPv4 sits in groups 1-2, and a relay
  // will forward there. Same embedded-v4 class as the NAT64 branch above,
  // so it goes through the same extractor.
  if (g0 === 0x2002) return isPublicV4(embeddedV4(g1, g2));
  // 2001::/32 — Teredo. The embedded IPv4 is XOR-obfuscated, so rather than
  // decode it, refuse the whole tunnel range: nothing legitimate to fetch.
  if (g0 === 0x2001 && g1 === 0) return false;
  // ::/96 legacy space, including :: (unspecified) and ::1 (loopback).
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return false;
  }
  if ((g0 & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((g0 & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}

export function isPublicIp(ip: string): boolean {
  switch (isIP(ip)) {
    case 4:
      return isPublicV4(ip);
    case 6:
      return isPublicV6(ip);
    default:
      return false;
  }
}
