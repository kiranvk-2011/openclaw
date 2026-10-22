/**
 * Whether an earlier child of this requester session still owes it a completion.
 *
 * Such a child resumes the session as a later turn, so a turn that only sent
 * progress (or nothing) while it runs is waiting for that result, not an empty
 * reply. Paused children need an incoming continuation first, so they do not count.
 * Registry failures keep the existing missing-reply handling.
 */
export async function hasOwedRequesterChildCompletion(params: {
  sessionKey?: string;
  agentId?: string;
}): Promise<boolean> {
  const requesterSessionKey = params.sessionKey?.trim();
  if (!requesterSessionKey) {
    return false;
  }
  try {
    const { listUnsettledRequesterChildren } =
      await import("../../agents/subagents/registry/subagent-registry.js");
    const children = await listUnsettledRequesterChildren({
      requesterSessionKey,
      ...(params.agentId ? { requesterAgentId: params.agentId } : {}),
    });
    return children.some((child) => child.state !== "paused");
  } catch {
    return false;
  }
}
