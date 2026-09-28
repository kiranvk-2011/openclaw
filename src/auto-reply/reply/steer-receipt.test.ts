import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { FollowupRun } from "./queue.js";
import { sendSteerReceipt } from "./steer-receipt.js";

const STEERED = "🦞🛞 Current run steered with your new message.";
const QUEUED = "⏳ Couldn't steer the current run; I'll answer this right after it.";

const routeMocks = vi.hoisted(() => ({
  routeReply: vi.fn(async () => ({ ok: true, delivered: true, messageId: "900" })),
  isRoutableChannel: vi.fn((channel: string) => channel === "telegram"),
}));
vi.mock("./route-reply.runtime.js", () => routeMocks);

function makeRun(overrides: Partial<FollowupRun> = {}, steerReceipts?: boolean): FollowupRun {
  const config = {
    messages: { queue: steerReceipts === undefined ? {} : { steerReceipts } },
  } as OpenClawConfig;
  return {
    prompt: "change of plan",
    enqueuedAt: 0,
    messageId: "42",
    originatingChannel: "telegram",
    originatingTo: "-100123",
    originatingThreadId: 7,
    originatingAccountId: "default",
    run: {
      agentId: "main",
      provider: "anthropic",
      model: "claude-opus-5-5",
      sessionKey: "agent:main:telegram:group:-100123:topic:7",
      senderId: "111",
      config,
    },
    ...overrides,
  } as unknown as FollowupRun;
}

describe("steer receipts", () => {
  beforeEach(() => {
    routeMocks.routeReply.mockClear();
  });

  it("is off unless messages.queue.steerReceipts is true", async () => {
    await sendSteerReceipt({ followupRun: makeRun(), kind: "steered" });
    await sendSteerReceipt({ followupRun: makeRun({}, false), kind: "queued" });
    expect(routeMocks.routeReply).not.toHaveBeenCalled();
  });

  it("replies to the steered message without mirroring it into the transcript", async () => {
    await sendSteerReceipt({ followupRun: makeRun({}, true), kind: "steered" });
    expect(routeMocks.routeReply).toHaveBeenCalledTimes(1);
    expect(routeMocks.routeReply).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { text: STEERED, replyToCurrent: true, replyToId: "42" },
        channel: "telegram",
        to: "-100123",
        threadId: 7,
        accountId: "default",
        currentMessageId: "42",
        mirror: false,
        replyKind: "tool",
        responsePrefixContext: expect.objectContaining({
          modelFull: "anthropic/claude-opus-5-5",
          model: "claude-opus-5-5",
        }),
      }),
    );
  });

  it("quotes the steered message even when the queued run carries no message id", async () => {
    await sendSteerReceipt({
      followupRun: makeRun({ messageId: undefined }, true),
      kind: "steered",
      sourceMessageId: "52",
    });
    expect(routeMocks.routeReply).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMessageId: "52",
        payload: expect.objectContaining({ replyToId: "52" }),
      }),
    );
  });

  it("tells the sender when the message will wait for its own turn", async () => {
    await sendSteerReceipt({ followupRun: makeRun({}, true), kind: "queued" });
    expect(routeMocks.routeReply).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { text: QUEUED, replyToCurrent: true, replyToId: "42" } }),
    );
  });

  it("stays silent for ambient room events and unroutable origins", async () => {
    await sendSteerReceipt({
      followupRun: makeRun({ currentInboundEventKind: "room_event" }, true),
      kind: "steered",
    });
    await sendSteerReceipt({
      followupRun: makeRun({ originatingChannel: "webchat" as never }, true),
      kind: "steered",
    });
    await sendSteerReceipt({
      followupRun: makeRun({ originatingTo: undefined }, true),
      kind: "queued",
    });
    expect(routeMocks.routeReply).not.toHaveBeenCalled();
  });

  it("never throws when delivery fails", async () => {
    routeMocks.routeReply.mockRejectedValueOnce(new Error("telegram down"));
    await expect(
      sendSteerReceipt({ followupRun: makeRun({}, true), kind: "steered" }),
    ).resolves.toBeUndefined();
  });
});
