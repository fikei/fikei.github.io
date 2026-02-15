import SwiftUI

struct AuthView: View {
    let onAuthenticated: () -> Void
    let onSkip: () -> Void

    @State private var email = ""
    @State private var isSending = false
    @State private var didSend = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            Theme.background
                .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Logo — Georgia serif, matching web display text
                DSText("boards", style: .display)
                    .padding(.bottom, Theme.space6)

                // Tagline — uppercase label style
                VStack(spacing: Theme.space1) {
                    DSText("Your likes. Your saves.", style: .label)
                    DSText("Your life \u{2014} organized.", style: .label)
                }
                .padding(.bottom, Theme.space10)

                if didSend {
                    successState
                } else {
                    emailInputState
                }

                Spacer()

                // Divider
                DSDivider(label: "or")
                    .padding(.horizontal, Theme.space8)
                    .padding(.bottom, Theme.space4)

                // Skip — ghost button, no border
                DSButton(
                    title: "Continue without login",
                    action: onSkip,
                    variant: .ghost,
                    size: .small
                )
                .padding(.bottom, Theme.space12)
            }
        }
    }

    // MARK: - Success State

    private var successState: some View {
        VStack(spacing: Theme.space3) {
            Image(systemName: "envelope.open")
                .font(.system(size: Theme.text3XL))
                .foregroundColor(Theme.foreground)

            DSText("Check your email", style: .title)

            DSText("We sent a magic link to \(email)", style: .meta)
                .multilineTextAlignment(.center)

            DSButton(
                title: "Send again",
                action: { didSend = false },
                variant: .outlined,
                size: .small
            )
            .padding(.top, Theme.space1)
        }
        .padding(.horizontal, Theme.space8)
    }

    // MARK: - Email Input State

    private var emailInputState: some View {
        VStack(spacing: Theme.space4) {
            DSInput(
                placeholder: "email@example.com",
                text: $email,
                keyboardType: .emailAddress,
                textContentType: .emailAddress
            )

            DSButton(
                title: "Send magic link",
                action: sendMagicLink,
                variant: .filled,
                fullWidth: true,
                disabled: !isValidEmail,
                loading: isSending
            )

            if let error = errorMessage {
                Text(error)
                    .font(.system(size: Theme.textXS))
                    .foregroundColor(Theme.error)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, Theme.space8)
    }

    // MARK: - Helpers

    private var isValidEmail: Bool {
        let pattern = #"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"#
        return email.range(of: pattern, options: .regularExpression) != nil
    }

    private func sendMagicLink() {
        guard isValidEmail else { return }

        isSending = true
        errorMessage = nil

        Task {
            do {
                try await SupabaseClient.shared.sendMagicLink(email: email)
                await MainActor.run {
                    isSending = false
                    didSend = true
                }
            } catch {
                await MainActor.run {
                    isSending = false
                    errorMessage = "Failed to send. Check your email and try again."
                }
            }
        }
    }
}
