import SwiftUI

struct AuthView: View {
    let onAuthenticated: () -> Void
    let onSkip: () -> Void

    @State private var email = ""
    @State private var isSending = false
    @State private var didSend = false
    @State private var errorMessage: String?

    @FocusState private var emailFocused: Bool

    var body: some View {
        ZStack {
            Theme.background
                .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Logo
                Text("ctrl.rodeo")
                    .font(.system(size: 32, weight: .bold, design: .monospaced))
                    .foregroundColor(Theme.foreground)
                    .padding(.bottom, 12)

                // Tagline
                VStack(spacing: 4) {
                    Text("Your likes. Your saves.")
                        .font(.system(size: 15))
                        .foregroundColor(Theme.muted)
                    Text("Your life \u{2014} organized.")
                        .font(.system(size: 15))
                        .foregroundColor(Theme.muted)
                }
                .padding(.bottom, 48)

                if didSend {
                    // Success state
                    VStack(spacing: 16) {
                        Image(systemName: "envelope.open")
                            .font(.system(size: 36))
                            .foregroundColor(Theme.foreground)

                        Text("Check your email")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(Theme.foreground)

                        Text("We sent a magic link to\n\(email)")
                            .font(.system(size: 14))
                            .foregroundColor(Theme.muted)
                            .multilineTextAlignment(.center)

                        Button("Send again") {
                            didSend = false
                        }
                        .font(.system(size: 14))
                        .foregroundColor(Theme.muted)
                        .padding(.top, 8)
                    }
                    .padding(.horizontal, 32)
                } else {
                    // Email input
                    VStack(spacing: 16) {
                        TextField("", text: $email, prompt: Text("email@example.com").foregroundColor(Color(hex: "#555555")))
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .foregroundColor(Theme.foreground)
                            .font(.system(size: 16))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color(hex: "#333333"), lineWidth: 1)
                            )
                            .focused($emailFocused)

                        // Send button
                        Button(action: sendMagicLink) {
                            Group {
                                if isSending {
                                    ProgressView()
                                        .tint(Theme.background)
                                } else {
                                    Text("SEND MAGIC LINK")
                                        .font(.system(size: 14, weight: .semibold))
                                        .tracking(1)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                        }
                        .foregroundColor(Theme.background)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(isValidEmail ? Theme.foreground : Color(hex: "#333333"))
                        )
                        .disabled(!isValidEmail || isSending)

                        // Error message
                        if let error = errorMessage {
                            Text(error)
                                .font(.system(size: 13))
                                .foregroundColor(.red)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .padding(.horizontal, 32)
                }

                Spacer()

                // Divider
                HStack(spacing: 12) {
                    Rectangle()
                        .fill(Color(hex: "#333333"))
                        .frame(height: 1)
                    Text("or")
                        .font(.system(size: 13))
                        .foregroundColor(Theme.muted)
                    Rectangle()
                        .fill(Color(hex: "#333333"))
                        .frame(height: 1)
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 20)

                // Skip button
                Button(action: onSkip) {
                    Text("CONTINUE WITHOUT LOGIN")
                        .font(.system(size: 13, weight: .medium))
                        .tracking(0.5)
                        .foregroundColor(Theme.muted)
                }
                .padding(.bottom, 48)
            }
        }
        .onAppear {
            emailFocused = false
        }
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
