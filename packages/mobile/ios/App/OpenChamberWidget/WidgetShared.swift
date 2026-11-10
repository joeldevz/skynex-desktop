import SwiftUI
import WidgetKit

// MARK: - Shared model + App Group reader

/// One row of the session overview the app writes to the shared App Group.
/// Mirrors MobileWidgetSession in packages/ui/src/apps/mobileWidgetSnapshot.ts.
struct WidgetSession: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let unread: Bool
    /// Project label for the session's directory. Optional so snapshots written before this
    /// field existed still decode.
    var project: String?
}

/// The session overview snapshot. Mirrors MobileWidgetSnapshot (same field names) so the
/// JSON the app stores decodes directly.
struct WidgetSnapshot: Codable {
    var runtimeKey: String?
    let attentionCount: Int
    let recentSessions: [WidgetSession]

    static let empty = WidgetSnapshot(runtimeKey: nil, attentionCount: 0, recentSessions: [])
}

enum WidgetStore {
    static let appGroup = "group.com.openchamber.app"
    static let snapshotKey = "widgetSnapshot"

    /// Reads the latest snapshot the app persisted. Returns `.empty` when nothing has been
    /// written yet (fresh install / app never foregrounded) so widgets render a clean state.
    static func load() -> WidgetSnapshot {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let json = defaults.string(forKey: snapshotKey),
              let data = json.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) else {
            return .empty
        }
        return snapshot
    }
}

// MARK: - Deep links (mirror packages/ui/src/apps/deepLinks.ts)

enum WidgetDeepLink {
    static func newSession() -> URL { URL(string: "skynex-app://new")! }
    static func attention() -> URL { URL(string: "skynex-app://sessions?filter=attention")! }
    static func status() -> URL { URL(string: "skynex-app://status")! }
    static func settings() -> URL { URL(string: "skynex-app://settings")! }
    static func changes() -> URL { URL(string: "skynex-app://changes")! }
    static func files() -> URL { URL(string: "skynex-app://view/files")! }
    static func instances() -> URL { URL(string: "skynex-app://view/instances")! }
    static func session(_ id: String) -> URL {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return URL(string: "skynex-app://session/\(encoded)") ?? newSession()
    }
}

// MARK: - Timeline provider

struct OverviewEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct OverviewProvider: TimelineProvider {
    func placeholder(in context: Context) -> OverviewEntry {
        OverviewEntry(date: Date(), snapshot: .empty)
    }

    func getSnapshot(in context: Context, completion: @escaping (OverviewEntry) -> Void) {
        completion(OverviewEntry(date: Date(), snapshot: WidgetStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OverviewEntry>) -> Void) {
        // The app/NSE reload timelines (WidgetCenter) when the snapshot changes, but with several
        // widgets sharing the app's WidgetKit reload budget iOS can refresh them unevenly and
        // leave one stale. Ask for a periodic refresh too so every widget independently re-reads
        // the shared snapshot and converges to the latest state (budget permitting).
        let entry = OverviewEntry(date: Date(), snapshot: WidgetStore.load())
        let nextRefresh = Date().addingTimeInterval(10 * 60)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

// MARK: - Skynex S mark

/// SwiftUI widgets draw the same S path as scripts/brand/geometry.mjs.
struct SMarkView: View {
    var body: some View {
        Canvas { context, size in
            let scale = min(size.width / 100, size.height / 100)
            let cx = size.width / 2
            let cy = size.height / 2
            let lineWidth = max(1.2, 8.6 * scale)
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: cx + (x - 512) * scale / 10, y: cy + (y - 512) * scale / 10)
            }
            var mark = Path()
            mark.move(to: p(706, 322))
            mark.addCurve(to: p(495, 219), control1: p(661, 255), control2: p(589, 219))
            mark.addCurve(to: p(304, 364), control1: p(380, 219), control2: p(304, 276))
            mark.addCurve(to: p(502, 509), control1: p(304, 442), control2: p(359, 480))
            mark.addLine(to: p(546, 518))
            mark.addCurve(to: p(730, 663), control1: p(682, 546), control2: p(730, 587))
            mark.addCurve(to: p(514, 813), control1: p(730, 756), control2: p(648, 813))
            mark.addCurve(to: p(275, 704), control1: p(412, 813), control2: p(331, 776))
            context.stroke(mark, with: .color(.primary), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
        }
    }
}
