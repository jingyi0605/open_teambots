import type { BotView, ChannelMessageView } from "@openteam/contracts";
import {
  externalDraftApprovalMode,
  type ExternalDraft,
  type ExternalDraftApprovalMode,
  type ExternalDraftVerification,
} from "@openteam/contracts/external-draft";
import { externalDraftReviewEdits } from "@openteam/client-core/external-draft";
import { clientErrorMessage } from "@openteam/product-core/redaction";
import { Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../client/openteam-api";
import { cn } from "../../lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Signature HTML from the mail provider, shown as text so nothing in it runs. */
export function signatureText(html: string): string {
  const document = new DOMParser().parseFromString(
    html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li|tr|h[1-6])>/gi, "\n"),
    "text/html"
  );
  return (document.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

type Status = { label: string; tone: "ready" | "sent" | "warning" | "muted" };
const STATUS: Record<string, Status> = {
  pending: { label: "Ready to send", tone: "ready" },
  sending: { label: "Sending…", tone: "muted" },
  sent: { label: "Sent", tone: "sent" },
  dismissed: { label: "Discarded", tone: "muted" },
  unknown: { label: "Unconfirmed", tone: "muted" },
  failed: { label: "Message not delivered", tone: "warning" },
  "draft-created": { label: "Message not delivered", tone: "warning" },
};
const MODE_LABEL: Record<ExternalDraftApprovalMode, string> = {
  "always-allow": "Always allow",
  "needs-approval": "Needs approval",
  "disable-drafts": "Disable drafts for Bot",
};
/** What changed, for the line under the card after the user picks a mode. */
export function approvalNotice(previous: ExternalDraftApprovalMode, next: ExternalDraftApprovalMode) {
  if (next === "always-allow") return "Added to your Allow rules";
  if (next === "disable-drafts") return "Drafts are off for this Bot";
  return previous === "disable-drafts" ? "Drafts need your approval again" : "Removed from your Allow rules";
}

function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        status.tone === "sent" && "bg-[#22c55e]/15 text-[#15803d] dark:text-[#4ade80]",
        status.tone === "warning" && "bg-[#eab308]/15 text-[#a16207] dark:text-[#facc15]",
        (status.tone === "ready" || status.tone === "muted") && "text-foreground-secondary"
      )}
      data-draft-status={status.label}
    >
      {status.tone !== "muted" && (
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            status.tone === "sent" ? "bg-[#22c55e]" : status.tone === "warning" ? "bg-[#eab308]" : "bg-current opacity-60"
          )}
        />
      )}
      {status.label}
    </span>
  );
}

function Row({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-h-9 items-center gap-3 border-b border-black/[0.06] px-3 last:border-b-0 dark:border-white/[0.07]">
      <label className="w-[72px] shrink-0 text-xs text-foreground-secondary" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="min-w-0 flex-1 truncate py-1.5">{children}</div>
    </div>
  );
}

function ApprovalMenu({
  mode,
  modes,
  disabled,
  onChange,
}: {
  mode: ExternalDraftApprovalMode;
  modes: ExternalDraftApprovalMode[];
  disabled: boolean;
  onChange: (mode: ExternalDraftApprovalMode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Approval"
        className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-foreground-secondary hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
        disabled={disabled}
      >
        {mode === "disable-drafts" ? "Disable drafts" : MODE_LABEL[mode]}
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label="Approval" side="top">
        {modes.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => option !== mode && onChange(option)}>
            <span className="flex-1">{MODE_LABEL[option]}</span>
            {option === mode && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ExternalDraftCard({
  message,
  draft,
  bot,
}: {
  message: ChannelMessageView;
  draft: ExternalDraft;
  bot?: Pick<BotView, "draftingDisabled" | "draftAllowedRecipients">;
}) {
  const inFlight = useRef(false);
  const metadata = record(message.metadata);
  const verification = record(record(metadata.draft).verification) as Partial<ExternalDraftVerification>;
  const sendingAddresses = verification.sendingAddresses ?? [];
  const email = draft.platform === "email";
  const [state, setState] = useState(String(metadata.cardState ?? "pending"));
  const [from, setFrom] = useState(draft.from ?? "");
  const [body, setBody] = useState(draft.body);
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [to, setTo] = useState(draft.to?.join(", ") ?? "");
  const [cc, setCc] = useState(draft.cc?.join(", ") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState(false);
  // The send's response was lost and the server couldn't be asked yet.
  const [lost, setLost] = useState(false);
  useEffect(() => {
    setState(String(metadata.cardState ?? "pending"));
    if (metadata.cardState === "sent") setError("");
  }, [metadata.cardState]);
  const sendError = typeof metadata.sendError === "string" ? metadata.sendError : "";
  const fields = { body, subject, to, cc, from };
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const act = (action: "send" | "cancel") =>
    run(async () => {
      try {
        const edits = externalDraftReviewEdits(draft, action, fields, sendingAddresses);
        if (action === "send") setState("sending");
        const result = await api.mutateExternalDraft(message.id, action, edits);
        const next = record(result.message.metadata);
        setState(String(next.cardState ?? "pending"));
        if (typeof next.sendError === "string") setError(`Couldn't send this draft: ${next.sendError}`);
      } catch (failure) {
        setError(clientErrorMessage(failure, action === "send" ? "Couldn't send this draft" : "Couldn't discard this draft. Try again."));
        if (action !== "send") return;
        // The server decides whether anything went out; never guess.
        try {
          const checked = await api.mutateExternalDraft(message.id, "refresh");
          setState(String(record(checked.message.metadata).cardState ?? "pending"));
        } catch {
          setState("sending");
          setLost(true);
        }
      }
    });
  const checkDelivery = () =>
    run(async () => {
      try {
        const checked = await api.mutateExternalDraft(message.id, "refresh");
        setState(String(record(checked.message.metadata).cardState ?? "pending"));
        setLost(false);
      } catch (failure) {
        setError(clientErrorMessage(failure, "Couldn't check delivery. Try again."));
      }
    });
  const mode = externalDraftApprovalMode(
    { draftingDisabled: bot?.draftingDisabled ?? false, draftAllowedRecipients: bot?.draftAllowedRecipients ?? [] },
    email ? { platform: "email", to: to.split(",").map((value) => value.trim()).filter(Boolean), cc: cc.split(",").map((value) => value.trim()).filter(Boolean) } : draft
  );
  const setMode = (next: ExternalDraftApprovalMode) =>
    run(async () => {
      setNotice("");
      try {
        const edits = state === "pending" ? externalDraftReviewEdits(draft, "approval", fields, sendingAddresses) : undefined;
        await api.setExternalDraftApproval(message.id, next, edits);
        setNotice(approvalNotice(mode, next));
      } catch (failure) {
        setError(clientErrorMessage(failure, "Couldn't save. Try again."));
      }
    });
  const sentUnder = record(metadata.sentUnder);
  const modes: ExternalDraftApprovalMode[] = email
    ? ["always-allow", "needs-approval", "disable-drafts"]
    : ["needs-approval", "disable-drafts"];
  const menu = bot ? (
    <ApprovalMenu disabled={busy} mode={mode} modes={modes} onChange={(next) => void setMode(next)} />
  ) : null;
  const signature = email ? verification.signatures?.[from.toLowerCase()] : undefined;
  const title = email ? (draft.replyToMessageId ? "Reply" : "New email") : "Slack message";
  const status = STATUS[state] ?? STATUS.unknown!;
  const recipient = email ? (to.split(",")[0]?.trim() ?? "") : (draft.target ?? "");
  const inputClass = "w-full min-w-0 bg-transparent outline-none placeholder:text-foreground-tertiary disabled:opacity-60";
  const replyRow = email && draft.replyToMessageId ? (
    <Row label="In reply to">
      {verification.threadUrl ? (
        <a className="underline-offset-2 hover:underline" href={verification.threadUrl} rel="noreferrer" target="_blank">
          {verification.thread ?? draft.replyToMessageId}
        </a>
      ) : (
        verification.thread ?? draft.replyToMessageId
      )}
    </Row>
  ) : null;
  const header = (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <strong className="truncate text-[14px] font-medium">{title}</strong>
      <StatusBadge status={status} />
    </div>
  );
  const notices = (
    <>
      {sentUnder.rule ? (
        <p className="m-0 text-xs text-foreground-secondary">
          Auto-approved by your rule: {String(sentUnder.rule)}
        </p>
      ) : sentUnder.draftingDisabled ? (
        <p className="m-0 text-xs text-foreground-secondary">Sent without review: drafts are off for this Bot</p>
      ) : null}
      {notice && <p className="m-0 text-xs text-foreground-secondary">{notice}</p>}
      {(error || (state === "pending" && sendError)) && (
        <p role="alert" className="m-0 text-xs text-red-600">
          {error || `Couldn't send this draft: ${sendError}`}
        </p>
      )}
    </>
  );

  if (state !== "pending" && state !== "sending") {
    const summary =
      state === "unknown"
        ? "The send was interrupted — check your mailbox to see whether it went out"
        : `${state === "sent" ? "Sent to" : "To"} ${recipient}${email ? ` — “${subject || draft.subject}”` : ""}`;
    return (
      <section aria-label={title} className="permission-surface rich-message-card flex w-full max-w-[520px] min-w-0 flex-col gap-2 overflow-hidden rounded-2xl bg-[#eeeeee] p-3 text-[13px] text-[#141414] dark:bg-[#262626] dark:text-[#f0f0f0]">
        {header}
        <button
          aria-expanded={expanded}
          className="flex min-w-0 items-center gap-2 text-left text-foreground-secondary"
          onClick={() => setExpanded((open) => !open)}
          type="button"
        >
          <span className="min-w-0 flex-1 truncate">{summary}</span>
          {expanded ? <ChevronUp className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
        </button>
        {expanded && (
          <div className="overflow-hidden rounded-xl bg-background/60">
            {email ? (
              <>
                <Row label="From">{from}</Row>
                {replyRow}
                <Row label="To">{to}</Row>
                {cc && <Row label="Cc">{cc}</Row>}
                <Row label="Subject">{subject}</Row>
              </>
            ) : (
              <>
                <Row label="Workspace">{verification.identity}</Row>
                <Row label="To">{draft.target}</Row>
              </>
            )}
            <div className="whitespace-pre-wrap px-3 py-2.5">{body}</div>
            {signature && <div className="whitespace-pre-wrap px-3 pb-2.5 text-foreground-secondary">{signatureText(signature)}</div>}
          </div>
        )}
        {notices}
        {Boolean(sentUnder.rule || sentUnder.draftingDisabled) && <div className="flex justify-end">{menu}</div>}
      </section>
    );
  }
  const sending = state === "sending";
  return (
    <form
      aria-label={title}
      className="permission-surface rich-message-card flex w-full max-w-[520px] min-w-0 flex-col gap-2.5 overflow-hidden rounded-2xl bg-[#eeeeee] p-3 text-[13px] text-[#141414] dark:bg-[#262626] dark:text-[#f0f0f0]"
      onSubmit={(event) => {
        event.preventDefault();
        void act("send");
      }}
    >
      {header}
      <div className="overflow-hidden rounded-xl bg-background/60">
        {email ? (
          <>
            <Row htmlFor={`${message.id}-from`} label="From">
              {sendingAddresses.length > 1 ? (
                <select
                  aria-label="From"
                  className={cn(inputClass, "-ml-1 cursor-pointer")}
                  disabled={busy || sending}
                  id={`${message.id}-from`}
                  onChange={(event) => setFrom(event.target.value)}
                  value={sendingAddresses.find((address) => address === from.toLowerCase()) ?? from}
                >
                  {sendingAddresses.map((address) => (
                    <option key={address} value={address}>
                      {address}
                    </option>
                  ))}
                </select>
              ) : (
                from
              )}
            </Row>
            {replyRow}
            <Row htmlFor={`${message.id}-to`} label="To">
              <input aria-label="To" autoComplete="off" className={inputClass} disabled={busy || sending} id={`${message.id}-to`} onChange={(event) => setTo(event.target.value)} spellCheck={false} value={to} />
            </Row>
            <Row htmlFor={`${message.id}-cc`} label="Cc">
              <input aria-label="Cc" autoComplete="off" className={inputClass} disabled={busy || sending} id={`${message.id}-cc`} onChange={(event) => setCc(event.target.value)} placeholder="name@example.com" spellCheck={false} value={cc} />
            </Row>
            <Row htmlFor={`${message.id}-subject`} label="Subject">
              <input aria-label="Subject" className={inputClass} disabled={busy || sending} id={`${message.id}-subject`} onChange={(event) => setSubject(event.target.value)} value={subject} />
            </Row>
          </>
        ) : (
          <>
            <Row label="Workspace">{verification.identity}</Row>
            <Row label="To">
              {draft.target} <span className="text-foreground-secondary">({draft.channelId})</span>
            </Row>
            {draft.threadTs && <Row label="In thread">{verification.thread?.split("\n")[0] ?? draft.threadTs}</Row>}
          </>
        )}
        <textarea
          aria-label="Message body"
          className={cn(inputClass, "block max-h-[360px] min-h-[96px] resize-none px-3 py-2.5 leading-5 [field-sizing:content]")}
          dir="auto"
          disabled={busy || sending}
          name="body"
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a message"
          rows={4}
          value={body}
        />
        {signature && (
          <div className="whitespace-pre-wrap px-3 pb-2.5 text-foreground-secondary" data-draft-signature="">
            {signatureText(signature)}
          </div>
        )}
      </div>
      {notices}
      <div className="flex items-center gap-2">
        <button
          className="flex h-8 items-center gap-1.5 rounded-lg bg-[#141414] px-3 font-medium text-white disabled:opacity-40 dark:bg-[#f0f0f0] dark:text-[#181818]"
          disabled={busy || sending || !body.trim()}
          type="submit"
        >
          {sending && <Loader2 className="size-3.5 animate-spin" />}
          {sending ? "Sending…" : "Send"}
        </button>
        {lost ? (
          <button
            className="h-8 rounded-lg border border-black/10 px-3 font-medium disabled:opacity-40 dark:border-white/15"
            disabled={busy}
            onClick={() => void checkDelivery()}
            type="button"
          >
            Check delivery
          </button>
        ) : (
          <button
            className="h-8 rounded-lg border border-black/10 px-3 font-medium disabled:opacity-40 dark:border-white/15"
            disabled={busy || sending}
            onClick={() => void act("cancel")}
            type="button"
          >
            Discard
          </button>
        )}
        <div className="ml-auto">{menu}</div>
      </div>
    </form>
  );
}
