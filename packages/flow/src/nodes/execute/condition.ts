import z from "zod";
import { ConditionConfig, NUMERIC } from "../config.ts";
import { defineNode } from "../registry.ts";
import { assert } from "node:console";

const ConditionInput = z.union([
  z.string(),
  z.number(),
  z.record(z.string(), z.unknown()),
]);

function toNumber(value: unknown, what: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && NUMERIC.test(value)) return Number(value);
  throw new Error(`condition: ${what} is not a number`);
}
function assertNever(x: never): never {
  throw new Error(`condition: unhandled operator ${String(x)}`);
}

export const conditionNode = defineNode({
  configSchema: ConditionConfig,
  execute: async (input, config) => {
    const parsed = ConditionInput.safeParse(input);
    if (!parsed.success) {
      throw new Error("condition expects a string, a number or an object");
    }

    let target: unknown;
    if (config.field === undefined) {
      if (typeof parsed.data === "object") {
        throw new Error("condition received an object, but has no field set");
      }
      target = parsed.data;
    } else {
      if (typeof parsed.data !== "object") {
        throw new Error(
          `condition reads "${config.field}" but received a ${typeof parsed.data}`,
        );
      }
      if (!Object.hasOwn(parsed.data, config.field)) {
        throw new Error(`condition: input has no field "${config.field}"`);
      }
      target = parsed.data[config.field];
    }

    const label = config.field ? `field "${config.field}"` : "input";

    switch (config.operator) {
      case "contains":
        return String(target).includes(config.value);
      case "equals":
      case "not_equals": {
        const eq =
          config.valueType === "number"
            ? toNumber(target, label) === toNumber(config.value, "value")
            : String(target) === config.value;
        return config.operator === "equals" ? eq : !eq;
      }
      case "gt":
      case "lt": {
        const a = toNumber(target, label);
        const b = toNumber(config.value, "value");
        return config.operator === "gt" ? a > b : a < b;
      }
      default:
        return assertNever(config.operator);
    }
  },
});
