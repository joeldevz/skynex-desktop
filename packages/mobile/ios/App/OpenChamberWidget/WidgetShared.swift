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

/// SwiftUI widgets draw the supplied filled path in scripts/brand/skynex-logo.svg.
struct SMarkView: View {
    var body: some View {
        Canvas { context, size in
            let scale = min(size.width / 214, size.height / 250)
            let origin = CGPoint(x: (size.width - 214 * scale) / 2, y: (size.height - 250 * scale) / 2)
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: origin.x + (x + 2) * scale, y: origin.y + (y + 2) * scale)
            }
            var mark = Path()
            mark.move(to: p(0, 61))
            mark.addQuadCurve(to: p(10.7, 47.5), control: p(0, 50))
            mark.addLine(to: p(204.2, 1.4))
            mark.addQuadCurve(to: p(210, 6), control: p(210, 0))
            mark.addLine(to: p(210, 53))
            mark.addQuadCurve(to: p(205.1, 59.2), control: p(210, 58))
            mark.addLine(to: p(93.1, 85.8))
            mark.addQuadCurve(to: p(93, 87.6), control: p(90.2, 86.5))
            mark.addLine(to: p(204.4, 132.7))
            mark.addQuadCurve(to: p(210, 141), control: p(210, 135))
            mark.addLine(to: p(210, 187.9))
            mark.addQuadCurve(to: p(202.2, 197.7), control: p(210, 195.9))
            mark.addLine(to: p(5.8, 244.5))
            mark.addQuadCurve(to: p(0, 239.9), control: p(0, 245.9))
            mark.addLine(to: p(0, 192.9))
            mark.addQuadCurve(to: p(4.9, 186.7), control: p(0, 187.9))
            mark.addLine(to: p(116.9, 160))
            mark.addQuadCurve(to: p(117, 158.2), control: p(119.8, 159.4))
            mark.addLine(to: p(7.4, 113.9))
            mark.addQuadCurve(to: p(0, 102.9), control: p(0, 110.9))
            mark.closeSubpath()
            context.fill(mark, with: .color(.primary))
        }
    }
}
