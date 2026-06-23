import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { AnthropicProvider } from "../../src/adapters/llm/anthropic-provider.ts";
import type { AnthropicCreateParams, AnthropicMessage, MessageCreator } from "../../src/adapters/llm/anthropic-provider.ts";
import type { Clock } from "../../src/domain/ports/clock.ts";
import type { LlmRequest } from "../../src/domain/ports/llm-provider.ts";

const schema = z.object({ answer: z.number() }).strict();
const req: LlmRequest = { role: "planner", system: "S", user: "U", maxTokens: 2048 };

/** Clock that advances 100ms each read. */
function fakeClock(): Clock {
  let t = 1000;
  return {
    now() {
      const v = t;
      t += 100;
      return v;
    },
  };
}

function msg(text: string, stop: string | null = "end_turn"): AnthropicMessage {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 50, output_tokens: 12 },
    model: "claude-opus-4-8",
    stop_reason: stop,
  };
}

describe("AnthropicProvider", () => {
  test("returns the parsed result and maps usage/model/stopReason", async () => {
    const create: MessageCreator = async () => msg(JSON.stringify({ answer: 4 }));
    const provider = new AnthropicProvider(create, fakeClock());
    const res = await provider.complete(req, schema);
    expect(res.parsed).toEqual({ answer: 4 });
    expect(res.usage).toEqual({ inputTokens: 50, outputTokens: 12 });
    expect(res.model).toBe("claude-opus-4-8");
    expect(res.stopReason).toBe("end_turn");
    expect(res.providerMode).toBe("live");
    expect(res.attempts).toBe(1);
    expect(res.latencyMs).toBe(100);
  });

  test("sends the tier model + effort and the derived json_schema, never temperature", async () => {
    let seen: AnthropicCreateParams | undefined;
    const create: MessageCreator = async (p) => {
      seen = p;
      return msg(JSON.stringify({ answer: 1 }));
    };
    await new AnthropicProvider(create, fakeClock()).complete(req, schema);
    expect(seen!.model).toBe("claude-opus-4-8"); // planner tier
    expect(seen!.output_config.effort).toBe("high");
    expect(seen!.output_config.format.type).toBe("json_schema");
    expect(seen!.output_config.format.schema["type"]).toBe("object");
    expect(seen!.messages).toEqual([{ role: "user", content: "U" }]);
    expect(JSON.stringify(seen)).not.toContain("temperature");
  });

  test("retries on schema-invalid output, feeding the error back, then succeeds", async () => {
    const outs = [JSON.stringify({ answer: "not-a-number" }), JSON.stringify({ answer: 7 })];
    let i = 0;
    const seen: string[] = [];
    const create: MessageCreator = async (p) => {
      seen.push(p.messages[0]!.content);
      return msg(outs[i++]!);
    };
    const res = await new AnthropicProvider(create, fakeClock()).complete(req, schema);
    expect(res.parsed).toEqual({ answer: 7 });
    expect(res.attempts).toBe(2);
    expect(seen[1]).toContain("invalid"); // the retry prompt carries the validation error
  });

  test("a refusal stop_reason fails immediately and is not retried", async () => {
    let calls = 0;
    const create: MessageCreator = async () => {
      calls++;
      return msg("", "refusal");
    };
    await expect(new AnthropicProvider(create, fakeClock()).complete(req, schema)).rejects.toThrow(/refus/i);
    expect(calls).toBe(1);
  });

  test("fails after exhausting schema retries", async () => {
    let calls = 0;
    const create: MessageCreator = async () => {
      calls++;
      return msg(JSON.stringify({ answer: "bad" }));
    };
    await expect(
      new AnthropicProvider(create, fakeClock(), { maxSchemaRetries: 2 }).complete(req, schema),
    ).rejects.toThrow(/schema/i);
    expect(calls).toBe(3); // 1 + 2 retries
  });
});
