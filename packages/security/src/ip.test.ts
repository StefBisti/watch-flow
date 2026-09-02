import { expect, test } from "vitest";
import { isPublicIp } from "./ip.ts";

const PUBLIC = [
  "93.184.216.34",
  "8.8.8.8",
  // boundary neighbours of every blocked v4 range
  "9.255.255.255",
  "11.0.0.0",
  "100.63.255.255",
  "100.128.0.0",
  "126.255.255.255",
  "128.0.0.0",
  "169.253.255.255",
  "169.255.0.0",
  "172.15.255.255",
  "172.32.0.0",
  "192.167.255.255",
  "192.169.0.0",
  "223.255.255.255",
  // public v6
  "2606:2800:220:1:248:1893:25c8:1946",
  "2001:4860:4860::8888",
  "::ffff:8.8.8.8", // mapped PUBLIC v4 stays public
];

const BLOCKED = [
  "0.0.0.0",
  "10.0.0.1",
  "10.255.255.255",
  "100.64.0.1",
  "100.127.255.255",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.0",
  "172.31.255.255",
  "192.168.1.1",
  "224.0.0.1",
  "255.255.255.255",
  "::",
  "::1",
  "fc00::1",
  "fd12:3456::1",
  "fe80::1",
  "febf:ffff::1",
  "ff02::1",
  "::ffff:10.0.0.1", // mapped, dotted spelling
  "::ffff:a00:1", // the SAME address, hex spelling
  "::ffff:127.0.0.1",
  "::ffff:169.254.169.254",
  "64:ff9b::a00:1", // NAT64-embedded 10.0.0.1
];

const GARBAGE = [
  "",
  "localhost",
  "999.1.1.1",
  "1.2.3",
  "fe80::1%eth0",
  "10.0.0.1 ",
];

for (const ip of PUBLIC) {
  test(`accepts public ${ip}`, () => expect(isPublicIp(ip)).toBe(true));
}
for (const ip of BLOCKED) {
  test(`blocks ${ip}`, () => expect(isPublicIp(ip)).toBe(false));
}
for (const ip of GARBAGE) {
  test(`fails closed on ${ip}`, () => expect(isPublicIp(ip)).toBe(false));
}

test("🔒 blocks 6to4 addresses embedding a private IPv4", () => {
  expect(isPublicIp("2002:a00:1::1")).toBe(false); // 10.0.0.1
  expect(isPublicIp("2002:7f00:1::1")).toBe(false); // 127.0.0.1
  expect(isPublicIp("2002:a9fe:a9fe::1")).toBe(false); // 169.254.169.254
});

test("6to4 embedding a public IPv4 is still allowed", () => {
  expect(isPublicIp("2002:5db8:d822::1")).toBe(true); // 93.184.216.34
});

test("🔒 blocks the Teredo range and the 6to4 relay anycast prefix", () => {
  expect(isPublicIp("2001:0:53aa:64c:1:2:3:4")).toBe(false);
  expect(isPublicIp("192.88.99.1")).toBe(false);
});
