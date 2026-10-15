import { editExternalDraft, type ExternalDraft } from "@openteam/contracts/external-draft";

export type ExternalDraftReviewAction = "send" | "cancel" | "refresh" | "approval";

/** Normalize the editable fields identically on desktop and mobile. Routing is immutable. */
export function externalDraftReviewEdits(
  draft: ExternalDraft,
  action: ExternalDraftReviewAction,
  fields: { body: string; subject: string; to: string; cc: string; from?: string },
  sendingAddresses: string[] = []
) {
  if (action !== "send" && action !== "approval") return undefined;
  const recipients = (text: string) =>
    text
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  const edits = {
    body: fields.body,
    ...(draft.platform === "email"
      ? {
          subject: fields.subject,
          to: recipients(fields.to),
          cc: recipients(fields.cc),
          ...(fields.from && fields.from.toLowerCase() !== draft.from?.toLowerCase() ? { from: fields.from } : {}),
        }
      : {}),
  };
  editExternalDraft(draft, edits, sendingAddresses);
  return edits;
}
