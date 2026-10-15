export interface ExternalDraft {
  platform: "email" | "slack";
  providerIdentifier: string;
  body: string;
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  replyToMessageId?: string;
  target?: string;
  channelId?: string;
  threadTs?: string;
  /** The user asked to see this message first: the card waits for Send even under an allow rule. */
  waitForReview?: boolean;
}
export function parseExternalDraft(raw: unknown): ExternalDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("A draft object is required");
  const value = raw as Record<string, unknown>;
  if (!["email", "slack"].includes(String(value.platform)))
    throw new Error("Choose email or slack");
  const text = (key: string, required = false, maximum = 2000) => {
    if (value[key] === undefined && !required) return undefined;
    if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > maximum)
      throw new Error(`Invalid draft ${key}`);
    return value[key].trim();
  };
  const address = (input: unknown): string => {
    if (
      typeof input !== "string" ||
      !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(input.trim()) ||
      input.length > 320
    )
      throw new Error("Use plain email addresses");
    return input.trim();
  };
  const addresses = (key: string, required = false) => {
    if (value[key] === undefined && !required) return undefined;
    if (!Array.isArray(value[key]) || value[key].length > 100 || (required && !value[key].length))
      throw new Error(`Invalid draft ${key}`);
    return value[key].map(address);
  };
  const draft: ExternalDraft = {
    platform: value.platform as ExternalDraft["platform"],
    providerIdentifier: text("providerIdentifier", true, 256)!,
    body: text("body", true, 100_000)!,
  };
  if (value.waitForReview !== undefined) {
    if (typeof value.waitForReview !== "boolean") throw new Error("Invalid draft waitForReview");
    if (value.waitForReview) draft.waitForReview = true;
  }
  for (const key of draft.platform === "email"
    ? ["target", "channelId", "threadTs"]
    : ["from", "to", "cc", "subject", "replyToMessageId"]) {
    if (
      value[key] !== undefined &&
      value[key] !== "" &&
      (!Array.isArray(value[key]) || value[key].length)
    )
      throw new Error(`${key} does not belong to ${draft.platform} drafts`);
  }
  if (draft.platform === "email")
    Object.assign(draft, {
      from: address(value.from),
      to: addresses("to", true),
      cc: addresses("cc"),
      subject: text("subject", true),
      replyToMessageId: text("replyToMessageId"),
    });
  else {
    Object.assign(draft, {
      target: text("target", true),
      channelId: text("channelId", true),
      threadTs: text("threadTs"),
    });
    if (!/^[CDGU][A-Z0-9]{8,}$/i.test(draft.channelId!))
      throw new Error("Use a resolved Slack channel or conversation ID");
    if (draft.threadTs && !/^\d+\.\d+$/.test(draft.threadTs))
      throw new Error("Invalid Slack thread timestamp");
  }
  return draft;
}

/** What the connector confirmed before the card appeared. */
export interface ExternalDraftVerification {
  /** The account's own address (email) or "Workspace (address)" (Slack). */
  identity: string;
  destination: string;
  /** Addresses this account may send as; the card's From picker offers them. */
  sendingAddresses?: string[];
  /** Signature HTML per sending address, shown under the body and sent with it. */
  signatures?: Record<string, string>;
  /** The replied-to message as the user reads it, for example "“Invoice” from Ann". */
  thread?: string;
  /** Opens the replied-to message in the provider's own web app. */
  threadUrl?: string;
}

/** The user edits content, recipients and (among verified aliases) From; account and thread stay fixed. */
export function editExternalDraft(
  saved: ExternalDraft,
  edits: unknown,
  sendingAddresses: string[] = []
): ExternalDraft {
  if (!edits || typeof edits !== "object" || Array.isArray(edits))
    throw new Error("Invalid draft edits");
  const allowed = saved.platform === "email" ? ["body", "to", "cc", "subject", "from"] : ["body"];
  if (Object.keys(edits).some((key) => !allowed.includes(key)))
    throw new Error("The sending account and thread cannot be changed on a draft card");
  const from = (edits as { from?: unknown }).from;
  if (
    from !== undefined &&
    String(from).toLowerCase() !== saved.from?.toLowerCase() &&
    !sendingAddresses.some((address) => address.toLowerCase() === String(from).toLowerCase())
  )
    throw new Error("Send from one of this account's verified addresses");
  return parseExternalDraft({ ...saved, ...edits });
}

/**
 * How a Bot's drafts are approved. "always-allow" means every recipient of this draft is on the
 * Bot's allow list; "disable-drafts" sends every draft without review.
 */
export type ExternalDraftApprovalMode = "always-allow" | "needs-approval" | "disable-drafts";
export interface ExternalDraftApprovalSettings {
  draftingDisabled: boolean;
  draftAllowedRecipients: readonly string[];
}
export const externalDraftRecipients = (draft: Pick<ExternalDraft, "to" | "cc">) => [
  ...new Set([...(draft.to ?? []), ...(draft.cc ?? [])].map((address) => address.toLowerCase())),
];
export function externalDraftApprovalMode(
  settings: ExternalDraftApprovalSettings,
  draft: Pick<ExternalDraft, "platform" | "to" | "cc">
): ExternalDraftApprovalMode {
  if (settings.draftingDisabled) return "disable-drafts";
  const allowed = new Set(settings.draftAllowedRecipients.map((address) => address.toLowerCase()));
  const recipients = externalDraftRecipients(draft);
  return draft.platform === "email" && recipients.length && recipients.every((address) => allowed.has(address))
    ? "always-allow"
    : "needs-approval";
}
/** The allow list after the user picks a mode on a card for these recipients. */
export function externalDraftAllowList(
  current: readonly string[],
  draft: Pick<ExternalDraft, "to" | "cc">,
  mode: ExternalDraftApprovalMode
): string[] {
  const recipients = new Set(externalDraftRecipients(draft));
  const kept = current.map((address) => address.toLowerCase()).filter((address) => !recipients.has(address));
  return mode === "always-allow" ? [...new Set([...kept, ...recipients])] : mode === "needs-approval" ? kept : [...new Set(current.map((address) => address.toLowerCase()))];
}

/** Preserve plain prose and line breaks; autolink only literal HTTP(S) URLs. */
export function externalDraftHtml(body: string): string {
  const escape = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!
    );
  const prose = (text: string) => escape(text).replace(/\n/g, "<br>");
  const text = body.replace(/\r\n?/g, "\n");
  let result = "",
    offset = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    let url = match[0];
    while (
      /[.,;:!?]$/.test(url) ||
      (url.endsWith(")") && url.split("(").length < url.split(")").length)
    )
      url = url.slice(0, -1);
    result += `${prose(text.slice(offset, match.index))}<a href="${escape(url)}">${escape(url)}</a>`;
    offset = match.index! + url.length;
  }
  return `<div dir="auto">${result}${prose(text.slice(offset))}</div>`;
}
