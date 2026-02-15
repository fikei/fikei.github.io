import SwiftUI

enum Theme {
    // MARK: - Colors

    // Core
    static let background = Color(hex: "#000000")    // --color-black (app bg)
    static let foreground = Color(hex: "#FFFFFF")     // --color-white (primary text, borders)
    static let surface = Color(hex: "#111111")        // --bg / --gray-100 (content bg)
    static let muted = Color(hex: "#888888")          // --fg-muted / --gray-600
    static let subtle = Color(hex: "#666666")         // --fg-subtle / --gray-500
    static let elevated = Color(hex: "#222222")       // --bg-elevated / --gray-300
    static let borderSubtle = Color(hex: "#333333")   // --border-subtle / --gray-400
    static let placeholder = Color(hex: "#555555")    // input placeholders
    static let surfaceCard = Color(hex: "#1A1A1A")    // --bg-surface / --gray-200

    // Status
    static let error = Color(hex: "#CC0000")          // --color-error
    static let success = Color(hex: "#00FF00")        // --color-success
    static let warning = Color(hex: "#FF9900")        // --color-warning

    // MARK: - Typography

    // Font families
    static let fontSerif = "Georgia"                  // --font-serif (display text)
    // System font (SF Pro) used for all interface text (Space Grotesk equivalent)

    // Font sizes
    static let text2XS: CGFloat = 8                   // --text-2xs (badges, tiny labels)
    static let textXS: CGFloat = 10                   // --text-xs (buttons, labels, body)
    static let textLG: CGFloat = 12                   // --text-lg (titles)
    static let textXL: CGFloat = 14                   // --text-xl (section titles)
    static let text2XL: CGFloat = 18                  // --text-2xl (modal titles)
    static let text3XL: CGFloat = 24                  // --text-3xl (display text)

    // Letter spacing (em → pt conversion at 10pt base)
    static let trackingWide: CGFloat = 0.5            // 0.05em — buttons, titles
    static let trackingWider: CGFloat = 1.0           // 0.1em — labels, filter tokens
    static let trackingWidest: CGFloat = 3.0          // 0.3em — breadcrumb emphasis

    // Line heights
    static let leadingTight: CGFloat = 1.2            // --leading-tight (headings)
    static let leadingNormal: CGFloat = 1.6           // --leading-normal (body)

    // MARK: - Spacing (4px base unit)

    static let space1: CGFloat = 4                    // --space-1
    static let space2: CGFloat = 8                    // --space-2
    static let space3: CGFloat = 12                   // --space-3
    static let space4: CGFloat = 16                   // --space-4
    static let space5: CGFloat = 20                   // --space-5
    static let space6: CGFloat = 24                   // --space-6
    static let space8: CGFloat = 32                   // --space-8
    static let space10: CGFloat = 40                  // --space-10
    static let space12: CGFloat = 48                  // --space-12
    static let space16: CGFloat = 64                  // --space-16

    // MARK: - Animation

    static let durationFast: Double = 0.1             // --duration-fast
    static let durationNormal: Double = 0.15          // --duration-normal
    static let durationSlow: Double = 0.2             // --duration-slow
}

// MARK: - Color Hex Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)

        let r, g, b: UInt64
        switch hex.count {
        case 6: // RGB (24-bit)
            (r, g, b) = ((int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            (r, g, b) = (0, 0, 0)
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255
        )
    }
}
