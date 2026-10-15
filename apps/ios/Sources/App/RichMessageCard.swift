import SwiftUI

extension JSON {
  var pretty: String {
    let e = JSONEncoder()
    e.outputFormatting = [.prettyPrinted, .sortedKeys]
    return (try? e.encode(self)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
  }
}

struct RichMessageCard: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(MessageModalPresenter.self) private var modals
  @Environment(AppStore.self) private var store
  let message: Message
  private var selected: Set<String> {
    Set(store.draft(message.channelId).widgetSelections?[message.id] ?? [])
  }
  @State private var secret = ""
  @State private var formValues: [String: JSON] = [:]
  @State private var bodyText = ""
  @State private var subject = ""
  @State private var to = ""
  @State private var cc = ""
  @State private var fromAddress = ""
  @State private var draftNotice: String?
  @State private var draftExpanded = false
  @State private var draftSending = false
  @State private var busy = false
  @State private var importID = UUID().uuidString
  @State private var failure: String?
  @State private var saveToVault = false
  @State private var requestID = UUID().uuidString
  @State private var lastAction = ""
  private var meta: JSON { message.metadata }
  private var type: String { meta["type"].string }
  private var state: String {
    meta["cardState"].string.isEmpty ? "pending" : meta["cardState"].string
  }
  private var supported: Bool {
    return [
      "widget", "secret-request", "computer-handoff", "user-form", "external-draft",
      "bot-template",
    ].contains(type)
  }
  var body: some View {
    if supported {
      VStack(alignment: .leading, spacing: type == "widget" ? 12.25 : 13) {
        if let failure { InlineFailure(message: failure) }
        switch type {
        case "widget": widget
        case "secret-request": secretRequest
        case "computer-handoff": handoff
        case "user-form": form
        case "external-draft": externalDraft
        case "bot-template": sharedTemplate
        default: EmptyView()
        }
      }.padding(type == "widget" ? 14 : 16).background(
        NativePalette.surface, in: RoundedRectangle(cornerRadius: 18)
      )
      .animation(type == "widget" && !reduceMotion ? .easeOut(duration: 0.24) : nil,
        value: meta["respondedValue"])
      .animation(type == "widget" && !reduceMotion ? .easeOut(duration: 0.24) : nil,
        value: meta["widgetDismissed"])
      .task(id: message.id) {
        if type == "user-form", state == "pending" {
          do {
            let prefill = try await store.request(
              "/api/v0/channel-messages/\(API.segment(message.id))/user-form/prefill",
              method: "POST", body: .object([:]))
            formValues = prefill.object.merging(formValues) { _, edited in edited }
          } catch { /* Prefill is optional; an unavailable vault must not prevent manual entry. */
          }
        }
      }
      .onChange(of: formValues) { _, _ in
        requestID = UUID().uuidString
        failure = nil
      }
      .onChange(of: secret) { _, _ in
        requestID = UUID().uuidString
        failure = nil
      }
      .onChange(of: selected) { _, _ in requestID = UUID().uuidString }
      .onChange(of: bodyText) { _, _ in requestID = UUID().uuidString }
      .onChange(of: to) { _, _ in requestID = UUID().uuidString }
      .onChange(of: cc) { _, _ in requestID = UUID().uuidString }
      .onChange(of: saveToVault) { _, _ in requestID = UUID().uuidString }
      .onChange(of: subject) { _, _ in requestID = UUID().uuidString }
      .disabled(busy || store.busy.contains("/api/v0/channel-messages/\(API.segment(message.id))/widget-response"))
      .onAppear {
        bodyText = meta["draft"]["body"].string
        subject = meta["draft"]["subject"].string
        to = meta["draft"]["to"].array.map(\.string).joined(separator: ", ")
        cc = meta["draft"]["cc"].array.map(\.string).joined(separator: ", ")
        fromAddress = meta["draft"]["from"].string
      }
      .onDisappear {
        secret = ""
        formValues = [:]
      }
    }
  }
  private func presentComputer() {
    if let bot = store.bots.first(where: { $0.id == message.senderBotId })
      ?? store.channel(message.channelId).flatMap({ store.bot(for: $0) }) {
      modals.fullScreen = .init(content: AnyView(ComputerView(bot: bot,
        handoffID: type == "computer-handoff" ? message.id : nil)))
    }
  }
  @ViewBuilder var widget: some View {
    let widget = meta["widget"]
    HStack(alignment: .top, spacing: 8) {
      Text(widget["prompt"].string).font(.body.weight(.medium))
        .fixedSize(horizontal: false, vertical: true)
      Spacer(minLength: 0)
      if meta["respondedValue"] == .null && !meta["widgetDismissed"].bool {
        Button { act("widget-dismiss") } label: {
          Image(systemName: "xmark").font(.system(size: 15, weight: .regular))
            .foregroundStyle(NativePalette.chatFaint).frame(width: 20, height: 20)
            .contentShape(Rectangle().inset(by: -10))
        }.buttonStyle(.plain).accessibilityLabel("Dismiss")
          .accessibilityIdentifier("widget-dismiss-" + message.id)
      }
    }
    if !widget["helpText"].string.isEmpty {
      Text(widget["helpText"].string).font(.system(size: 14))
        .foregroundStyle(NativePalette.chatFaint).padding(.trailing, 36)
    }
    if case .string(let response) = meta["respondedValue"] {
      let answers = WidgetAnswer.resolve(widget: widget, response: response)
      VStack(spacing: 0) {
        ForEach(Array(answers.enumerated()), id: \.offset) { index, answer in
          if index > 0 { NativePalette.separator.frame(height: 0.5) }
          HStack(spacing: 12) {
            Text(answer.label).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Path { path in
              path.move(to: CGPoint(x: 3, y: 8))
              path.addLine(to: CGPoint(x: 6, y: 11))
              path.addLine(to: CGPoint(x: 13, y: 4))
            }.stroke(NativePalette.receiptCheck,
              style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
              .frame(width: 16, height: 16).accessibilityHidden(true)
          }.padding(.horizontal, 10).padding(.vertical, 10)
            .frame(minHeight: 40).accessibilityElement(children: .combine)
            .accessibilityValue("Selected")
            .accessibilityIdentifier("widget-answer-\(message.id)-\(index)")
        }
      }.background(NativePalette.background, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NativePalette.separator, lineWidth: 0.5))
    } else {
      let dismissed = meta["widgetDismissed"].bool
      VStack(spacing: 0) {
        ForEach(Array(widget["options"].array.enumerated()), id: \.offset) { index, option in
          if index > 0 { NativePalette.separator.opacity(0.5).frame(height: 0.5) }
          let value = option["value"].string.isEmpty ? option["label"].string : option["value"].string
          Button {
            if widget["multiSelect"].bool {
              NativeHaptics.play(.selection, source: "widget.selection")
              var values = selected
              if values.contains(value) { values.remove(value) } else { values.insert(value) }
              var draft = store.draft(message.channelId)
              draft.widgetResponse = nil
              if draft.widgetSelections == nil { draft.widgetSelections = [:] }
              draft.widgetSelections?[message.id] = widget["options"].array.map {
                $0["value"].string.isEmpty ? $0["label"].string : $0["value"].string
              }.filter(values.contains)
              store.saveDraft(draft, channel: message.channelId)
            } else { act("widget-response", body: ["value": .string(value)]) }
          } label: {
            HStack(alignment: .top, spacing: 9) {
              Text(index < 26 ? String(UnicodeScalar(65 + index)!) : String(index + 1))
                .font(.system(size: 13)).foregroundStyle(NativePalette.chatFaint)
                .frame(width: 20, height: 20)
                .background(NativePalette.surface, in: RoundedRectangle(cornerRadius: 5))
                .accessibilityHidden(true)
              VStack(alignment: .leading, spacing: 3.5) {
                Text(option["label"].string).font(.body)
                  .foregroundStyle(option["style"].string == "danger"
                    ? NativePalette.widgetDanger : NativePalette.text)
                if !option["description"].string.isEmpty {
                  Text(option["description"].string).font(.system(size: 14))
                    .foregroundStyle(NativePalette.chatMuted)
                }
              }.fixedSize(horizontal: false, vertical: true)
              Spacer(minLength: 0)
              if selected.contains(value) {
                Image(systemName: "checkmark").font(.system(size: 14))
                  .foregroundStyle(NativePalette.receiptCheck)
              }
            }.padding(.horizontal, 10).padding(.vertical, 10)
              .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
              .contentShape(Rectangle())
          }.buttonStyle(.plain).disabled(dismissed)
            .accessibilityLabel(option["label"].string)
            .accessibilityValue(selected.contains(value) ? "Selected" : "")
        }
      }.background(NativePalette.background, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NativePalette.separator.opacity(0.5), lineWidth: 0.5))
        .opacity(dismissed ? 0.35 : 1)
      if dismissed {
        Text("dismissed").font(.system(size: 12)).foregroundStyle(NativePalette.chatFaint)
          .accessibilityIdentifier("widget-dismissed-" + message.id)
      } else {
        if widget["allowCustom"].bool {
          Text("Or answer in the chat below").font(.system(size: 14))
            .foregroundStyle(NativePalette.chatFaint)
        }
        if widget["multiSelect"].bool {
          Button {
            let values = widget["options"].array.map {
              $0["value"].string.isEmpty ? $0["label"].string : $0["value"].string
            }.filter(selected.contains)
            act("widget-response", body: ["value": .string(values.joined(separator: "\n"))])
          } label: {
            Text("Submit").font(.system(size: 15, weight: .medium))
              .foregroundStyle(selected.isEmpty ? NativePalette.chatFaint : NativePalette.onPrimary)
              .frame(maxWidth: .infinity).frame(height: 38)
              .background(selected.isEmpty ? NativePalette.widgetDisabled : NativePalette.text,
                in: RoundedRectangle(cornerRadius: 9))
          }.buttonStyle(WidgetSubmitStyle()).disabled(selected.isEmpty)
            .accessibilityIdentifier("widget-submit-" + message.id)
        }
      }
    }
  }
  @ViewBuilder var secretRequest: some View {
    let request = meta["secretRequest"] == .null ? meta["secret"] : meta["secretRequest"]
    Text(request["label"].string.isEmpty ? "Secure input" : request["label"].string).font(.headline)
    if !request["description"].string.isEmpty { Text(request["description"].string).font(.subheadline) }
    if !request["name"].string.isEmpty {
      Text(request["name"].string).font(.system(.caption, design: .monospaced)).foregroundStyle(NativePalette.muted)
    }
    let botSecret = !request["name"].string.isEmpty && request["scope"].string != "personal"
    Label(botSecret ? "Saved for all users of this Bot" : "Saved securely for you", systemImage: "lock.shield")
      .font(.footnote).foregroundStyle(NativePalette.muted)
    if meta["secretProvided"].bool {
      Label("Provided securely", systemImage: "checkmark.shield")
    } else {
      SecureField("Value", text: $secret).textContentType(.password).textFieldStyle(.roundedBorder)
      Button("Submit securely") {
        act("secret", body: ["value": .string(secret)], clearSecrets: true)
      }.disabled(secret.isEmpty)
    }
  }
  @ViewBuilder var handoff: some View {
    Label("Your help is needed", systemImage: "desktopcomputer").font(.headline)
    Text(meta["computerHandoff"]["reason"].string)
    let status = meta["computerHandoffState"].string
    if ["", "requested"].contains(status) {
      HStack {
        Button("Skip") { act("computer-handoff", body: ["action": .string("skip")]) }
        Spacer()
        Button("Take over") { act("computer-handoff", body: ["action": .string("start")]) }
      }
    } else {
      Text(status.capitalized).foregroundStyle(NativePalette.muted)
      if ["active", "started"].contains(status) {
        Button("Continue on computer") { presentComputer() }
      }
    }
  }
  @ViewBuilder var form: some View {
    let form = meta["form"]
    Text(form["title"].string).font(.headline)
    if state != "pending" {
      let outcome = UserFormOutcome(meta)
      Text(outcome.summary).font(.subheadline).foregroundStyle(NativePalette.muted)
      ForEach(outcome.fields) { field in
        HStack {
          Text(field.label)
          Spacer()
          Text(field.status).foregroundStyle(NativePalette.muted)
        }.font(.footnote).accessibilityElement(children: .combine)
      }
      if outcome.needsRecovery || state == "escalated" {
        Button("Open computer", systemImage: "display") { presentComputer() }
      }
    } else {
      Text(form["instruction"].string).font(.subheadline)
      if !form["domain"].string.isEmpty {
        Label(form["domain"].string, systemImage: "lock.shield").font(.caption)
      }
      ForEach(Array(form["fields"].array.enumerated()), id: \.offset) { _, field in
        let id = field["id"].string
        let binding = Binding<String>(
          get: { formValues[id]?.string ?? "" }, set: { formValues[id] = .string($0) })
        VStack(alignment: .leading, spacing: 6) {
          if field["type"].string != "checkbox" {
            Text(field["label"].string + (field["required"].bool ? " *" : "")).font(.subheadline)
          }
          if field["type"].string == "checkbox" {
            Toggle(
              field["label"].string,
              isOn: Binding(
                get: { formValues[id]?.bool ?? false }, set: { formValues[id] = .bool($0) }))
          } else if field["type"].string == "select" {
            Picker("Choose", selection: binding) {
              Text("Select…").tag("")
              ForEach(Array(field["options"].array.enumerated()), id: \.offset) { _, option in
                Text(option["label"].string).tag(option["value"].string)
              }
            }
          } else if field["secret"].bool || ["password", "otp"].contains(field["type"].string) {
            SecureField(field["placeholder"].string, text: binding).accessibilityIdentifier(
              "form-field-" + id
            ).accessibilityLabel(field["label"].string).textFieldStyle(.roundedBorder)
              .textInputAutocapitalization(.never)
          } else {
            TextField(field["placeholder"].string, text: binding, axis: .vertical)
              .accessibilityIdentifier("form-field-" + id).accessibilityLabel(field["label"].string)
              .textFieldStyle(
                .roundedBorder
              ).textInputAutocapitalization(.never)
              .keyboardType(
                field["type"].string == "email"
                  ? .emailAddress
                  : field["type"].string == "tel"
                    ? .phonePad : field["type"].string == "number" ? .decimalPad : .default)
          }
        }
      }
      if form["fields"].array.contains(where: {
        !$0["secret"].bool && !["password", "otp"].contains($0["type"].string)
      }) {
        Toggle("Save nonsecret info for future forms", isOn: $saveToVault).font(.footnote)
      }
      if form["submitAfterFill"].bool {
        Text("After filling, this presses Enter on \(form["domain"].string).").font(.footnote)
          .foregroundStyle(NativePalette.muted)
      }
      Button("Do this on the computer", systemImage: "display") {
        act("user-form", body: ["action": .string("dismiss"), "mode": .string("escalated")], clearSecrets: true)
      }.accessibilityIdentifier("form-escalate")
      HStack {
        Button("Dismiss") {
          act("user-form", body: ["action": .string("dismiss")], clearSecrets: true)
        }
        Spacer()
        Button("Submit") {
          act(
            "user-form",
            body: [
              "action": .string("submit"), "values": .object(formValues),
              "saveToVault": .bool(saveToVault),
            ], clearSecrets: true)
        }.disabled(!formValid)
      }
    }
  }
  var formValid: Bool {
    do {
      try FormValidation.userForm(meta["form"], values: formValues)
      return true
    } catch { return false }
  }
  private var draftBot: Bot? { store.bots.first { $0.id == message.senderBotId } }
  private var draftIsEmail: Bool { meta["draft"]["platform"].string == "email" }
  private static func addresses(_ text: String) -> [String] {
    text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
  }
  /// Mirrors externalDraftApprovalMode in @openteam/contracts.
  private var draftMode: String {
    guard let bot = draftBot else { return "needs-approval" }
    if bot.draftingDisabled == true { return "disable-drafts" }
    let allowed = Set((bot.draftAllowedRecipients ?? []).map { $0.lowercased() })
    let recipients = Set((Self.addresses(to) + Self.addresses(cc)).map { $0.lowercased() })
    return draftIsEmail && !recipients.isEmpty && recipients.isSubset(of: allowed)
      ? "always-allow" : "needs-approval"
  }
  private static let modeLabels = [
    "always-allow": "Always allow", "needs-approval": "Needs approval",
    "disable-drafts": "Disable drafts for Bot",
  ]
  private static func approvalNotice(from previous: String, to next: String) -> String {
    switch next {
    case "always-allow": "Added to your Allow rules"
    case "disable-drafts": "Drafts are off for this Bot"
    default: previous == "disable-drafts" ? "Drafts need your approval again" : "Removed from your Allow rules"
    }
  }
  @ViewBuilder private var approvalMenu: some View {
    if draftBot != nil {
      Menu {
        ForEach(draftIsEmail ? ["always-allow", "needs-approval", "disable-drafts"] : ["needs-approval", "disable-drafts"], id: \.self) { mode in
          Button {
            if mode != draftMode { setDraftApproval(mode) }
          } label: {
            if mode == draftMode { Label(Self.modeLabels[mode]!, systemImage: "checkmark") } else { Text(Self.modeLabels[mode]!) }
          }
        }
      } label: {
        HStack(spacing: 3) {
          Text(draftMode == "disable-drafts" ? "Disable drafts" : Self.modeLabels[draftMode]!)
          Image(systemName: "chevron.down").font(.caption2)
        }.font(.footnote).foregroundStyle(NativePalette.muted)
      }.accessibilityLabel("Approval")
    }
  }
  @ViewBuilder private var draftReplyRow: some View {
    let draft = meta["draft"]
    let thread = draft["verification"]["thread"].string.isEmpty
      ? draft["replyToMessageId"].string : draft["verification"]["thread"].string
    if draftIsEmail, !draft["replyToMessageId"].string.isEmpty {
      DraftRow(label: "In reply to") {
        if let url = URL(string: draft["verification"]["threadUrl"].string),
          url.scheme == "https" {
          Link(thread, destination: url).lineLimit(1)
        } else {
          Text(thread).lineLimit(1)
        }
      }
    }
  }
  @ViewBuilder private var draftNotices: some View {
    let sentUnder = meta["sentUnder"]
    if !sentUnder["rule"].string.isEmpty {
      Text("Auto-approved by your rule: " + sentUnder["rule"].string).font(.footnote)
        .foregroundStyle(NativePalette.muted)
    } else if sentUnder["draftingDisabled"].bool {
      Text("Sent without review: drafts are off for this Bot").font(.footnote)
        .foregroundStyle(NativePalette.muted)
    }
    if let draftNotice { Text(draftNotice).font(.footnote).foregroundStyle(NativePalette.muted) }
    if state == "pending", !meta["sendError"].string.isEmpty {
      InlineFailure(message: "Couldn't send this draft: " + meta["sendError"].string)
    }
  }
  private var draftSignature: String? {
    let html = meta["draft"]["verification"]["signatures"][fromAddress.lowercased()].string
    return html.isEmpty ? nil : signatureText(html)
  }
  @ViewBuilder var externalDraft: some View {
    let draft = meta["draft"]
    let verification = draft["verification"]
    let email = draftIsEmail
    let title = email ? (draft["replyToMessageId"].string.isEmpty ? "New email" : "Reply") : "Slack message"
    let sending = state == "sending" || draftSending
    HStack {
      Text(title).font(.headline)
      Spacer()
      DraftStatusBadge(state: sending ? "sending" : state)
    }
    if state == "pending" || state == "sending" {
      VStack(alignment: .leading, spacing: 0) {
        if email {
          DraftRow(label: "From") {
            let addresses = verification["sendingAddresses"].array.map(\.string)
            if addresses.count > 1 {
              Menu {
                ForEach(addresses, id: \.self) { address in
                  Button(address) { fromAddress = address }
                }
              } label: {
                HStack(spacing: 4) {
                  Text(verbatim: fromAddress).lineLimit(1).truncationMode(.middle)
                  Spacer(minLength: 0)
                  Image(systemName: "chevron.up.chevron.down").font(.caption2)
                }.foregroundStyle(NativePalette.text)
              }.accessibilityLabel("From")
            } else {
              Text(verbatim: fromAddress).lineLimit(1)
            }
          }
          draftReplyRow
          DraftRow(label: "To") {
            TextField("", text: $to).textInputAutocapitalization(.never).autocorrectionDisabled()
              .keyboardType(.emailAddress).accessibilityLabel("To")
          }
          DraftRow(label: "Cc") {
            TextField("", text: $cc, prompt: Text(verbatim: "name@example.com"))
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled().keyboardType(.emailAddress).accessibilityLabel("Cc")
          }
          DraftRow(label: "Subject") { TextField("", text: $subject).accessibilityLabel("Subject") }
        } else {
          DraftRow(label: "Workspace") { Text(verification["identity"].string).lineLimit(1) }
          DraftRow(label: "To") { Text(draft["target"].string).lineLimit(1) }
        }
        TextField("Write a message", text: $bodyText, axis: .vertical).lineLimit(4...12)
          .padding(12).accessibilityLabel("Message body")
        if let draftSignature {
          Text(verbatim: draftSignature).font(.footnote).foregroundStyle(NativePalette.muted)
            .padding(.horizontal, 12).padding(.bottom, 12)
        }
      }
      .background(NativePalette.background.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
      .disabled(sending)
      draftNotices
      HStack(spacing: 8) {
        Button {
          draftAction("send")
        } label: {
          HStack(spacing: 6) {
            if sending { ProgressView().controlSize(.small) }
            Text(sending ? "Sending…" : "Send").bold()
          }
        }.buttonStyle(.borderedProminent).tint(NativePalette.text).foregroundStyle(NativePalette.onPrimary)
          .disabled(sending || bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        Button("Discard") { act("external-draft", body: ["action": .string("cancel")]) }
          .buttonStyle(.bordered).tint(NativePalette.text).disabled(sending)
        Spacer()
        approvalMenu
      }
    } else {
      let recipient = email ? (Self.addresses(to).first ?? "") : draft["target"].string
      let summary = state == "unknown"
        ? "The send was interrupted — check your mailbox to see whether it went out"
        : (state == "sent" ? "Sent to " : "To ") + recipient
          + (email ? " — “" + subject + "”" : "")
      DisclosureGroup(isExpanded: $draftExpanded) {
        VStack(alignment: .leading, spacing: 0) {
          if email {
            DraftRow(label: "From") { Text(verbatim: fromAddress).lineLimit(1) }
            draftReplyRow
            DraftRow(label: "To") { Text(verbatim: to).lineLimit(2) }
            if !cc.isEmpty { DraftRow(label: "Cc") { Text(verbatim: cc).lineLimit(2) } }
            DraftRow(label: "Subject") { Text(verbatim: subject).lineLimit(2) }
          } else {
            DraftRow(label: "Workspace") { Text(verification["identity"].string).lineLimit(1) }
            DraftRow(label: "To") { Text(draft["target"].string).lineLimit(1) }
          }
          Text(verbatim: bodyText).padding(12).textSelection(.enabled)
          if let draftSignature {
            Text(verbatim: draftSignature).font(.footnote).foregroundStyle(NativePalette.muted)
              .padding(.horizontal, 12).padding(.bottom, 12)
          }
        }.background(NativePalette.background.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
      } label: {
        Text(verbatim: summary).font(.subheadline).foregroundStyle(NativePalette.muted).lineLimit(2)
      }.tint(NativePalette.muted)
      draftNotices
      if !meta["sentUnder"]["rule"].string.isEmpty || meta["sentUnder"]["draftingDisabled"].bool {
        HStack { Spacer(); approvalMenu }
      }
    }
  }
  @ViewBuilder var sharedTemplate: some View {
    let template = meta["template"]
    Text(template["recipe"]["profile"]["name"].string).font(.headline)
    Text(template["recipe"]["profile"]["description"].string)
    DisclosureGroup("Complete template") { Text(template["recipe"].pretty).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
    ShareLink("Export template", item: template["recipe"].pretty)
    Text(meta["outcomeText"].string.isEmpty ? state.capitalized : meta["outcomeText"].string)
    if state == "published" {
      Button("Create a bot from this template") { templateAction("import") }
      Button("Unpublish") { templateAction("unpublish") }
    }
  }
  func templateAction(_ action: String) {
    act("bot-template", body: ["action": .string(action), "clientId": .string(importID)])
  }
  private func draftEdits() -> [String: JSON] {
    var edits: [String: JSON] = ["body": .string(bodyText)]
    if draftIsEmail {
      edits["subject"] = .string(subject)
      edits["to"] = .array(Self.addresses(to).map { .string($0) })
      edits["cc"] = .array(Self.addresses(cc).map { .string($0) })
      if fromAddress.lowercased() != meta["draft"]["from"].string.lowercased() {
        edits["from"] = .string(fromAddress)
      }
    }
    return edits
  }
  func draftAction(_ action: String) {
    act("external-draft", body: ["action": .string(action), "edits": .object(draftEdits())])
  }
  func setDraftApproval(_ mode: String) {
    var body: [String: JSON] = ["action": .string("approval"), "mode": .string(mode)]
    if state == "pending" { body["edits"] = .object(draftEdits()) }
    let previous = draftMode
    draftNotice = nil
    Task {
      do {
        _ = try await store.request(
          "/api/v0/channel-messages/\(API.segment(message.id))/external-draft", method: "POST",
          body: .object(body))
        draftNotice = Self.approvalNotice(from: previous, to: mode)
      } catch {
        failure = "Couldn't save. Try again."
      }
    }
  }
  func act(_ suffix: String, body: [String: JSON] = [:], clearSecrets: Bool = false) {
    guard !busy else { return }
    if suffix.hasPrefix("widget") { NativeHaptics.play(.light, source: "widget.submit") }
    busy = true
    failure = nil
    var payload = body
    let action = suffix + ":" + (body["action"]?.string ?? "") + ":" + (body["mode"]?.string ?? "")
      + (suffix == "widget-response" ? ":" + (body["value"]?.string ?? "") : "")
    if lastAction != action {
      lastAction = action
      requestID = UUID().uuidString
    }
    if payload["clientId"] == nil { payload["clientId"] = .string(requestID) }
    if suffix == "external-draft", body["action"]?.string == "send" { draftSending = true }
    Task {
      defer {
        busy = false
        draftSending = false
      }
      do {
        let result = try await store.request(
          "/api/v0/channel-messages/\(API.segment(message.id))/\(suffix)", method: "POST",
          body: .object(payload))
        if let updated = try? result["message"].decode(Message.self) {
          store.merge([updated], channel: updated.channelId)
          store.persist()
        }
        // A draft reports its outcome in the returned card (sent, reopened with an error, unchanged).
        guard suffix == "external-draft"
          || WidgetMutationReceipt.accepted(result, action: suffix, clientID: payload["clientId"]?.string ?? "", value: payload["value"] ?? .null) else {
          NativeHaptics.play(.error, source: "rich-action.result")
          failure = "This action is no longer available. The card has been refreshed."
          return
        }
        if suffix == "computer-handoff" {
          NativeHaptics.play(.light, source: "computer.handoff-start")
        }
        if (suffix == "computer-handoff" && body["action"]?.string == "start")
          || (suffix == "user-form" && body["mode"]?.string == "escalated") {
          presentComputer()
        }
        if suffix == "secret" || suffix == "secret-submit" || suffix == "secret-request" {
          NativeHaptics.play(.success, source: "secret.submit")
        }
        if clearSecrets {
          secret = ""
          formValues = [:]
        }
        requestID = UUID().uuidString
      } catch {
        NativeHaptics.failure(error, source: "rich-action.result")
        failure = UserFacingError.message(error)
      }
    }
  }
}

/// Signature HTML from the mail provider, shown as plain text.
func signatureText(_ html: String) -> String {
  var text = html.replacingOccurrences(of: "<br\\s*/?>", with: "\n", options: [.regularExpression, .caseInsensitive])
  text = text.replacingOccurrences(of: "</(div|p|li|tr|h[1-6])>", with: "\n", options: [.regularExpression, .caseInsensitive])
  text = text.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
  for (entity, value) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&amp;", "&")] {
    text = text.replacingOccurrences(of: entity, with: value)
  }
  return text.replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
    .trimmingCharacters(in: .whitespacesAndNewlines)
}

private struct DraftRow<Content: View>: View {
  let label: String
  @ViewBuilder let content: Content
  var body: some View {
    HStack(spacing: 12) {
      Text(label).font(.footnote).foregroundStyle(NativePalette.muted).frame(width: 76, alignment: .leading)
      content.frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, 12).frame(minHeight: 40)
    .overlay(alignment: .bottom) { NativePalette.separator.frame(height: 0.5) }
  }
}

/// The card's state as status text: Ready to send, Sending…, Sent, and so on.
struct DraftStatusBadge: View {
  let state: String
  static func label(_ state: String) -> String {
    switch state {
    case "pending": "Ready to send"
    case "sending": "Sending…"
    case "sent": "Sent"
    case "dismissed": "Discarded"
    case "failed", "draft-created": "Message not delivered"
    default: "Unconfirmed"
    }
  }
  var body: some View {
    let color: Color = state == "sent" ? .green : ["failed", "draft-created"].contains(state) ? .yellow : NativePalette.muted
    HStack(spacing: 5) {
      if !["sending", "dismissed", "unknown"].contains(state) { Circle().fill(color).frame(width: 6, height: 6) }
      Text(Self.label(state)).font(.caption.weight(.medium))
    }
    .foregroundStyle(state == "sent" || ["failed", "draft-created"].contains(state) ? color : NativePalette.muted)
    .padding(.horizontal, 8).padding(.vertical, 3)
    .background((state == "sent" || ["failed", "draft-created"].contains(state) ? color.opacity(0.15) : .clear), in: Capsule())
  }
}

private struct WidgetSubmitStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.opacity(configuration.isPressed ? 0.8 : 1)
  }
}
