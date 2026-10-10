import { z } from "zod";

declare module "zod" {
  interface GlobalMeta {
    sensitive?: boolean;
  }
}

const redacted = "[redacted]";

/** Build a display-only copy of parsed config; never parse or mutate its values. */
export function redactConfig<S extends z.ZodType>(schema: S, config: z.output<S>): unknown {
  return redact(schema, config);
}

function redact(schema: z.core.$ZodType, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (z.globalRegistry.get(schema)?.sensitive === true) return redacted;

  // Zod's discriminated definitions also cover schemas inside readonly/default
  // wrappers and transforms without executing their parsing functions again.
  const definition = (schema as z.core.$ZodTypes)._zod.def;
  switch (definition.type) {
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "nonoptional":
    case "catch":
      return redact(definition.innerType, value);
    case "pipe":
      // Shape-preserving transforms retain the input fields' annotations.
      // Explicit output schemas can annotate transformed output as well.
      if (definition.in._zod.def.type === "transform") return redact(definition.out, value);
      if (definition.out._zod.def.type === "transform") return redact(definition.in, value);
      return redact(definition.out, redact(definition.in, value));
    case "object":
      if (typeof value !== "object" || Array.isArray(value)) return redacted;
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          const child = Object.hasOwn(definition.shape, key)
            ? definition.shape[key]
            : definition.catchall;
          return [key, child ? redact(child, item) : redacted];
        }),
      );
    case "array":
      return Array.isArray(value)
        ? value.map((item) => redact(definition.element, item))
        : redacted;
    case "record":
      if (typeof value !== "object" || Array.isArray(value)) return redacted;
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, redact(definition.valueType, item)]),
      );
    case "string":
    case "number":
    case "boolean":
    case "enum":
    case "literal":
      return typeof value === "object" ? redacted : value;
    default:
      // Unsupported schema shapes must not silently expose nested secrets.
      return redacted;
  }
}
