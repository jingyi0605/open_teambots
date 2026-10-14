import SwiftUI

enum ChatActivityTiming {
  static let expansion = 0.28
  static let collapse = 0.30
}

/// Activity state belongs to the one visible footer, not every transcript row.
struct ChatActivityFooter: View {
  @Environment(AppStore.self) private var store
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let channel: Channel
  var showsActivity = true
  @State private var visible = false
  @State private var mode: RobotAvatarMode = .still
  private var activity: RobotAvatarMode? {
    let runs = store.activeRuns(channel.id)
    return !showsActivity || runs.isEmpty ? nil
      : .thinking
  }
  var body: some View {
    VStack(spacing: 0) {
      let runs = store.activeRuns(channel.id)
      if let bot = store.bots.first(where: { $0.id == runs.first?.botId }) ?? store.bot(for: channel) {
        BotActivityRow(bot: bot, mode: mode, visible: visible)
      } else if activity != nil {
        ProgressView().frame(height: 54).padding(.bottom, 12)
      }
      Color.clear.frame(height: 11)
    }.padding(.horizontal, 16).padding(.top, 12)
      .animation(reduceMotion ? nil : .easeInOut(
        duration: visible ? ChatActivityTiming.expansion : ChatActivityTiming.collapse), value: visible)
      // Fill the table row from its top. When the robot collapses, SwiftUI lays
      // out the animated change while the hosting cell still has the expanded
      // height and centers the shorter content in it; the cell's resize a
      // moment later is not animated, so the robot snapped 32 points up onto
      // the message above. Without a minimum this never measures shorter than
      // the content, so the row's self-sized height is unchanged.
      .frame(maxHeight: .infinity, alignment: .top)
      .task(id: activity) {
        if let activity { mode = activity; visible = true }
        else {
          mode = .still
          if visible && !reduceMotion { try? await Task.sleep(for: .seconds(RobotMotion.transitionDuration)) }
          guard !Task.isCancelled else { return }
          visible = false
        }
      }
  }
}
