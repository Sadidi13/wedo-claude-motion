/** Request-body and model-output schema tests. */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import type { AiEditRequest } from "@/lib/types";
import { AiEditRequestSchema, AiOutputSchema } from "../schema";
import { makeRequest } from "./fixture";

describe("AiEditRequestSchema", () => {
  it("accepts a valid body and yields an AiEditRequest", () => {
    const parsed = AiEditRequestSchema.safeParse(makeRequest({ prompt: "  trim me  " }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const request: AiEditRequest = parsed.data;
    expect(request.prompt).toBe("trim me");
    expect(request.project.files["scene.jsx"].kind).toBe("jsx");
  });

  it("requires layerId for scope layer only", () => {
    const missing = AiEditRequestSchema.safeParse(makeRequest({ layerId: undefined }));
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues[0].path).toEqual(["layerId"]);
    expect(AiEditRequestSchema.safeParse(makeRequest({ scope: "scene", layerId: undefined })).success).toBe(true);
  });

  it("rejects wrong shapes", () => {
    expect(AiEditRequestSchema.safeParse({}).success).toBe(false);
    expect(AiEditRequestSchema.safeParse(makeRequest({ prompt: "   " })).success).toBe(false);
    expect(AiEditRequestSchema.safeParse({ ...makeRequest(), scope: "file" }).success).toBe(false);
    const badKind = makeRequest();
    badKind.project.files["scene.jsx"] = { ...badKind.project.files["scene.jsx"], kind: "exe" as "jsx" };
    expect(AiEditRequestSchema.safeParse(badKind).success).toBe(false);
    expect(AiEditRequestSchema.safeParse(makeRequest({ frameImage: { mediaType: "image/gif" as "image/png", data: "x" } })).success).toBe(false);
  });
});

describe("AiOutputSchema", () => {
  it("converts to a JSON schema with summary and code required and files optional", () => {
    const format = zodOutputFormat(AiOutputSchema);
    expect(format.type).toBe("json_schema");
    expect(format.schema).toMatchObject({ type: "object", required: ["summary", "code"] });
    const properties = format.schema.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(["summary", "code", "files"]);
    expect(format.parse('{"summary":"s","code":"<div />"}')).toEqual({ summary: "s", code: "<div />" });
    expect(() => format.parse('{"summary":"s"}')).toThrow(/code/);
  });
});
