import { expect, test } from "vitest";
import { MAX_EDGES, MAX_NODES } from "./limits.ts";

test("graph caps are in force", () => {
  expect(MAX_NODES).toBe(25);
  expect(MAX_EDGES).toBe(50);
});
