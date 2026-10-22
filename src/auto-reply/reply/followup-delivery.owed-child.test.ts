// Tests queued follow-up completion while an earlier turn's child owes the session a result.
import { describe, expect, it, vi } from "vitest";
import type { AgentTurnExecutionResult } from "./agent-runner-execution.types.js";
import { resolveFollowupDeliveryDecision } from "./followup-delivery.js";
import type { AdmittedFollowupTurn } from "./followup-turn-admission.js";

const registryState = vi.hoisted(() => ({
  unsettledChildren: vi.fn(async (_params: unknown) => [] as Array<{ state: string }>),
}));

vi.mock("../../agents/subagents/registry/subagent-registry.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../agents/subagents/registry/subagent-registry.js")
  >()),
  listUnsettledRequesterChildren: (params: unknown) => registryState.unsettledChildren(params),
}));

vi.mock("../../channels/plugins/index.js", () => ({
  getChannelPlugin: () => undefined,
  getLoadedChannelPlugin: () => undefined,
}));

function createTurn(): AdmittedFollowupTurn {
  return {
    runId: "run-1",
    queued: {
      prompt: "queued",
      enqueuedAt: 1,
      originatingChannel: "discord",
      originatingTo: "channel:C1",
      originatingChatType: "group",
      run: {
        agentId: "agent",
        agentDir: "/tmp/agent",
        sessionId: "session",
        sessionKey: "main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp",
        config: {},
        provider: "anthropic",
        model: "claude",
        messageProvider: "discord",
        timeoutMs: 1_000,
        blockReplyBreak: "message_end",
        sourceReplyDeliveryMode: "message_tool_only",
        terminalReplyExpectation: "required",
      },
    },
    operation: {} as AdmittedFollowupTurn["operation"],
    config: {},
    session: {
      kind: "session",
      key: "main",
      current: () => undefined,
      publish: () => undefined,
      adopt: () => undefined,
    },
    sendPolicy: "allow",
    preflightCompactionApplied: false,
  };
}

function createExecution(sentProgress: boolean): AgentTurnExecutionResult {
  const progressTarget = {
    tool: "message",
    provider: "discord",
    to: "channel:C1",
    text: "Still working",
    sourceReplyFinal: false,
  };
  return {
    runId: "run-1",
    outcome: {
      kind: "settled",
      status: "ok",
      result: {
        payloads: [],
        meta: { durationMs: 0 },
        ...(sentProgress
          ? {
              messagingToolSentTexts: ["Still working"],
              messagingToolSentTargets: [progressTarget],
              messagingToolSourceReplyPayloads: [
                { text: "Still working", sourceReplyFinal: false },
              ],
            }
          : {}),
      },
      resolved: { provider: "anthropic", model: "claude" },
      fallback: { exhausted: false, attempts: [] },
      autoCompactionCount: 0,
      didLogHeartbeatStrip: false,
    },
  };
}

const accounting = {
  payloadArray: [],
  providerUsed: "anthropic",
  modelUsed: "claude",
  preserveUserFacingSessionState: false,
  replyUsageState: {},
  usage: undefined,
  terminalFailurePayload: undefined,
} as never;

const decide = (sentProgress: boolean) =>
  resolveFollowupDeliveryDecision({
    turn: createTurn(),
    execution: createExecution(sentProgress),
    accounting,
  });

describe("resolveFollowupDeliveryDecision while an earlier turn's child owes the result", () => {
  const runningChild = {
    runId: "child-run",
    childSessionKey: "agent:agent:subagent:child",
    state: "running",
    wakeArmed: true,
  };

  it("treats a progress-only turn as waiting, not as a missing reply", async () => {
    registryState.unsettledChildren.mockResolvedValueOnce([runningChild]);

    const decision = await decide(true);

    expect(registryState.unsettledChildren).toHaveBeenLastCalledWith({
      requesterSessionKey: "main",
      requesterAgentId: "agent",
    });
    expect(decision).toEqual({ kind: "suppress", reason: "message-tool-only" });
  });

  it("sends the waiting status when the turn sent nothing", async () => {
    registryState.unsettledChildren.mockResolvedValueOnce([runningChild]);

    await expect(decide(false)).resolves.toMatchObject({
      kind: "deliver",
      payloads: [{ text: "I’m continuing this work and will send the result when it is ready." }],
    });
  });

  it.each([
    { label: "a paused child", children: [{ ...runningChild, state: "paused" }] },
    { label: "no pending child", children: [] },
  ])("keeps the missing-reply notice with $label", async ({ children }) => {
    registryState.unsettledChildren.mockResolvedValueOnce(children);

    await expect(decide(true)).resolves.toMatchObject({
      kind: "deliver",
      payloads: [
        { isError: true, text: expect.stringContaining("did not produce a visible reply") },
      ],
    });
  });

  it("keeps the missing-reply notice when the registry cannot be read", async () => {
    registryState.unsettledChildren.mockRejectedValueOnce(new Error("registry unavailable"));

    await expect(decide(true)).resolves.toMatchObject({
      kind: "deliver",
      payloads: [
        { isError: true, text: expect.stringContaining("did not produce a visible reply") },
      ],
    });
  });
});
