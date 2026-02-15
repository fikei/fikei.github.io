import SwiftUI

// MARK: - DSText

/// Typography component matching the web design system hierarchy.
///
/// Styles map to web CSS:
/// - `.display` → Georgia 24pt (--text-3xl + --font-serif)
/// - `.title` → System 12pt bold uppercase (`.w-text--title`)
/// - `.body` → System 10pt (--text-xs)
/// - `.label` → System 10pt uppercase muted (`.w-text--label`)
/// - `.meta` → System 10pt muted (`.w-text--meta`)
/// - `.tiny` → System 8pt (--text-2xs)
enum DSTextStyle {
    case display
    case title
    case body
    case label
    case meta
    case tiny
}

struct DSText: View {
    let text: String
    let style: DSTextStyle

    init(_ text: String, style: DSTextStyle = .body) {
        self.text = text
        self.style = style
    }

    var body: some View {
        switch style {
        case .display:
            Text(text)
                .font(.custom(Theme.fontSerif, size: Theme.text3XL))
                .foregroundColor(Theme.foreground)

        case .title:
            Text(text.uppercased())
                .font(.system(size: Theme.textLG, weight: .bold))
                .tracking(Theme.trackingWide)
                .foregroundColor(Theme.foreground)

        case .body:
            Text(text)
                .font(.system(size: Theme.textXS))
                .foregroundColor(Theme.foreground)

        case .label:
            Text(text.uppercased())
                .font(.system(size: Theme.textXS))
                .tracking(Theme.trackingWider)
                .foregroundColor(Theme.muted)

        case .meta:
            Text(text)
                .font(.system(size: Theme.textXS))
                .foregroundColor(Theme.muted)

        case .tiny:
            Text(text)
                .font(.system(size: Theme.text2XS))
                .foregroundColor(Theme.subtle)
        }
    }
}

// MARK: - DSButton

/// Button component mirroring the web `.btn` class.
///
/// Variants:
/// - `.outlined` → transparent bg, 1px white border (web `.btn`)
/// - `.filled` → white bg, black text (web `.btn--filled`, `.auth-modal__submit`)
/// - `.ghost` → no border, text only (web `.btn--ghost`)
///
/// All text is uppercase, bold, with 0.05em tracking.
/// Sharp corners (0 radius). Inverts on press.
enum DSButtonVariant {
    case outlined
    case filled
    case ghost
}

enum DSButtonSize {
    case small    // 4/12 padding, 8pt font — web .btn--sm
    case regular  // 8/16 padding, 10pt font — web .btn
    case large    // 12/24 padding, 10pt font — web .btn--lg
}

struct DSButton: View {
    let title: String
    let action: () -> Void
    var variant: DSButtonVariant = .outlined
    var size: DSButtonSize = .regular
    var fullWidth: Bool = false
    var disabled: Bool = false
    var loading: Bool = false

    @State private var isPressed = false

    var body: some View {
        Button(action: {
            if !disabled && !loading { action() }
        }) {
            Group {
                if loading {
                    ProgressView()
                        .tint(textColor)
                } else {
                    Text(title.uppercased())
                        .font(.system(size: fontSize, weight: .bold))
                        .tracking(Theme.trackingWide)
                }
            }
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .padding(.vertical, verticalPadding)
            .padding(.horizontal, horizontalPadding)
        }
        .buttonStyle(PlainButtonStyle())
        .foregroundColor(textColor)
        .background(backgroundColor)
        .overlay(borderOverlay)
        .opacity(disabled ? 0.5 : 1.0)
        .disabled(disabled || loading)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in withAnimation(.easeInOut(duration: Theme.durationFast)) { isPressed = true } }
                .onEnded { _ in withAnimation(.easeInOut(duration: Theme.durationFast)) { isPressed = false } }
        )
    }

    // MARK: - Sizing

    private var fontSize: CGFloat {
        size == .small ? Theme.text2XS : Theme.textXS
    }

    private var verticalPadding: CGFloat {
        switch size {
        case .small: return Theme.space1
        case .regular: return Theme.space2
        case .large: return Theme.space3
        }
    }

    private var horizontalPadding: CGFloat {
        switch size {
        case .small: return Theme.space3
        case .regular: return Theme.space4
        case .large: return Theme.space6
        }
    }

    // MARK: - Colors

    private var backgroundColor: Color {
        switch variant {
        case .outlined:
            return isPressed ? Theme.foreground : .clear
        case .filled:
            return isPressed ? .clear : Theme.foreground
        case .ghost:
            return .clear
        }
    }

    private var textColor: Color {
        switch variant {
        case .outlined:
            return isPressed ? Theme.surface : Theme.foreground
        case .filled:
            return isPressed ? Theme.foreground : Theme.surface
        case .ghost:
            return Theme.foreground
        }
    }

    @ViewBuilder
    private var borderOverlay: some View {
        switch variant {
        case .outlined, .filled:
            Rectangle().stroke(Theme.foreground, lineWidth: 1)
        case .ghost:
            EmptyView()
        }
    }
}

// MARK: - DSInput

/// Text input matching the web `.auth-modal__input`.
///
/// - padding: 12px, font: 10pt
/// - bg: surface (#111), border: 1px white
/// - Focus: double-border glow (web `box-shadow: 0 0 0 1px #fff`)
struct DSInput: View {
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var textContentType: UITextContentType? = nil

    @FocusState private var isFocused: Bool

    var body: some View {
        TextField("", text: $text, prompt:
            Text(placeholder)
                .font(.system(size: Theme.textXS))
                .foregroundColor(Theme.placeholder)
        )
        .textContentType(textContentType)
        .keyboardType(keyboardType)
        .textInputAutocapitalization(.never)
        .disableAutocorrection(true)
        .font(.system(size: Theme.textXS))
        .foregroundColor(Theme.foreground)
        .padding(Theme.space3)
        .background(Theme.surface)
        .overlay(
            Rectangle()
                .stroke(Theme.foreground, lineWidth: isFocused ? 2 : 1)
        )
        .focused($isFocused)
    }
}

// MARK: - DSDivider

/// Horizontal divider with optional centered label.
/// Line color: borderSubtle (#333). Label: 10pt uppercase muted.
struct DSDivider: View {
    var label: String? = nil

    var body: some View {
        HStack(spacing: Theme.space3) {
            Rectangle()
                .fill(Theme.borderSubtle)
                .frame(height: 1)

            if let label = label {
                Text(label.uppercased())
                    .font(.system(size: Theme.textXS))
                    .tracking(Theme.trackingWide)
                    .foregroundColor(Theme.muted)
            }

            if label != nil {
                Rectangle()
                    .fill(Theme.borderSubtle)
                    .frame(height: 1)
            }
        }
    }
}

// MARK: - DSSurface

/// Container with background and border matching web surface patterns.
///
/// Variants:
/// - `.standard` → bg #111, 1px white border (web `.modal__content`)
/// - `.subtle` → bg #1a1a1a, 1px #333 border (web `.grid-item`, `.w-body`)
/// - `.elevated` → bg #222, 1px #333 border
enum DSSurfaceVariant {
    case standard
    case subtle
    case elevated
}

struct DSSurface<Content: View>: View {
    let variant: DSSurfaceVariant
    let content: Content

    init(_ variant: DSSurfaceVariant = .standard, @ViewBuilder content: () -> Content) {
        self.variant = variant
        self.content = content()
    }

    var body: some View {
        content
            .background(backgroundColor)
            .overlay(
                Rectangle()
                    .stroke(borderColor, lineWidth: 1)
            )
    }

    private var backgroundColor: Color {
        switch variant {
        case .standard: return Theme.surface
        case .subtle: return Theme.surfaceCard
        case .elevated: return Theme.elevated
        }
    }

    private var borderColor: Color {
        switch variant {
        case .standard: return Theme.foreground
        case .subtle, .elevated: return Theme.borderSubtle
        }
    }
}
