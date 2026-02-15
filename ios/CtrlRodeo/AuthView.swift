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
                Text("boards")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(Theme.foreground)
                    .padding(.bottom, 8)

                // Tagline
                VStack(spacing: 2) {
                    Text("Your likes. Your saves.")
                        .textCase(.uppercase)
                        .tracking(1)
                    Text("Your life \u{2014} organized.")
                        .textCase(.uppercase)
                        .tracking(1)
                }
                .font(.system(size: 10))
                .foregroundColor(Theme.muted)
                .padding(.bottom, 32)

                if didSend {
                    // Success state
                    VStack(spacing: 12) {
                        Image(systemName: "envelope.open")
                            .font(.system(size: 24))
                            .foregroundColor(Theme.foreground)

                        Text("CHECK YOUR EMAIL")
                            .font(.system(size: 10))
                            .tracking(1)
                            .foregroundColor(Theme.foreground)

                        Text("We sent a magic link to\n\(email)")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.muted)
                            .multilineTextAlignment(.center)

                        Button(action: { didSend = false }) {
                            Text("SEND AGAIN")
                                .font(.system(size: 10))
                                .tracking(0.5)
                                .foregroundColor(Theme.muted)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(
                                    Rectangle()
                                        .stroke(Theme.borderSubtle, lineWidth: 1)
                                )
                        }
                        .padding(.top, 4)
                    }
                    .padding(.horizontal, 32)
                } else {
                    // Email input
                    VStack(spacing: 16) {
                        TextField("", text: $email, prompt: Text("email@example.com").foregroundColor(Theme.placeholder))
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .foregroundColor(Theme.foreground)
                            .font(.system(size: 10))
                            .padding(12)
                            .background(
                                Rectangle()
                                    .stroke(Theme.foreground, lineWidth: 1)
                            )
                            .focused($emailFocused)

                        // Send button
                        Button(action: sendMagicLink) {
                            Group {
                                if isSending {
                                    ProgressView()
                                        .tint(isValidEmail ? Theme.background : Theme.subtle)
                                } else {
                                    Text("SEND MAGIC LINK")
                                        .font(.system(size: 10))
                                        .tracking(0.5)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                        }
                        .foregroundColor(isValidEmail ? Theme.background : Theme.subtle)
                        .background(
                            ZStack {
                                if isValidEmail {
                                    Rectangle().fill(Theme.foreground)
                                } else {
                                    Rectangle().stroke(Theme.borderSubtle, lineWidth: 1)
                                }
                            }
                        )
                        .disabled(!isValidEmail || isSending)

                        // Error message
                        if let error = errorMessage {
                            Text(error)
                                .font(.system(size: 10))
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
                        .fill(Theme.borderSubtle)
                        .frame(height: 1)
                    Text("OR")
                        .font(.system(size: 10))
                        .tracking(0.5)
                        .foregroundColor(Theme.muted)
                    Rectangle()
                        .fill(Theme.borderSubtle)
                        .frame(height: 1)
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 16)

                // Skip button
                Button(action: onSkip) {
                    Text("CONTINUE WITHOUT LOGIN")
                        .font(.system(size: 10))
                        .tracking(1)
                        .foregroundColor(Theme.subtle)
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
