import SwiftUI

/// Blocking username onboarding screen shown after first login.
/// Cannot be dismissed until a valid username is saved.
struct UsernameView: View {
    let onUsernameSet: () -> Void

    @State private var username = ""
    @State private var isSaving = false
    @State private var isChecking = false
    @State private var isAvailable: Bool?
    @State private var errorMessage: String?
    @State private var checkTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            Theme.background
                .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                DSText("Choose your username", style: .title)
                    .padding(.bottom, Theme.space2)

                DSText("This is how others see you on boards", style: .meta)
                    .padding(.bottom, Theme.space6)

                // Username input row with @ prefix
                HStack(spacing: 0) {
                    Text("@")
                        .font(.system(size: Theme.textXS))
                        .foregroundColor(Theme.muted)
                        .padding(.horizontal, Theme.space3)
                        .frame(height: 44)
                        .background(Theme.surface)
                        .overlay(
                            Rectangle()
                                .stroke(Theme.borderSubtle, lineWidth: 1)
                        )

                    TextField("", text: $username, prompt:
                        Text("username")
                            .font(.system(size: Theme.textXS))
                            .foregroundColor(Theme.placeholder)
                    )
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
                    .keyboardType(.asciiCapable)
                    .textContentType(.username)
                    .font(.system(size: Theme.textXS))
                    .foregroundColor(Theme.foreground)
                    .padding(.horizontal, Theme.space3)
                    .frame(height: 44)
                    .background(Theme.surface)
                    .overlay(
                        Rectangle()
                            .stroke(Theme.foreground, lineWidth: 1)
                    )
                    .onChange(of: username) { _ in
                        onUsernameChanged()
                    }
                }
                .padding(.bottom, Theme.space2)

                // Status text
                statusView
                    .frame(height: 20)
                    .padding(.bottom, Theme.space3)

                // Save button
                DSButton(
                    title: "Save Username",
                    action: saveUsername,
                    variant: .filled,
                    fullWidth: true,
                    disabled: !canSave,
                    loading: isSaving
                )

                Spacer()
            }
            .padding(.horizontal, Theme.space8)
        }
    }

    // MARK: - Status View

    @ViewBuilder
    private var statusView: some View {
        if let error = errorMessage {
            Text(error)
                .font(.system(size: Theme.textXS))
                .foregroundColor(Theme.error)
        } else if isChecking {
            Text("CHECKING...")
                .font(.system(size: Theme.textXS))
                .tracking(Theme.trackingWide)
                .foregroundColor(Theme.muted)
        } else if let available = isAvailable {
            if available {
                Text("@\(username) IS AVAILABLE")
                    .font(.system(size: Theme.textXS))
                    .tracking(Theme.trackingWide)
                    .foregroundColor(Theme.success)
            } else {
                Text("@\(username) IS TAKEN")
                    .font(.system(size: Theme.textXS))
                    .tracking(Theme.trackingWide)
                    .foregroundColor(Theme.error)
            }
        } else if !username.isEmpty, let validationError = validationError {
            Text(validationError)
                .font(.system(size: Theme.textXS))
                .foregroundColor(Theme.error)
        } else {
            Text("3-20 CHARS \u{2022} LOWERCASE + NUMBERS + UNDERSCORES")
                .font(.system(size: Theme.text2XS))
                .tracking(Theme.trackingWide)
                .foregroundColor(Theme.muted)
        }
    }

    // MARK: - Validation

    private var validationError: String? {
        let val = username
        if val.isEmpty { return nil }
        if val.count < 3 { return "TOO SHORT (MIN 3)" }
        if val.count > 20 { return "TOO LONG (MAX 20)" }

        let pattern = #"^[a-z][a-z0-9_]*$"#
        if val.range(of: pattern, options: .regularExpression) == nil {
            if val.first?.isNumber == true || val.first == "_" {
                return "MUST START WITH A LETTER"
            }
            return "ONLY LOWERCASE LETTERS, NUMBERS, UNDERSCORES"
        }

        return nil
    }

    private var isValid: Bool {
        validationError == nil && username.count >= 3 && username.count <= 20
    }

    private var canSave: Bool {
        isValid && isAvailable == true && !isChecking && !isSaving
    }

    // MARK: - Actions

    private func onUsernameChanged() {
        // Normalize input to lowercase
        let normalized = username.lowercased()
        if normalized != username {
            username = normalized
            return // onChange will fire again with normalized value
        }

        // Reset state
        isAvailable = nil
        errorMessage = nil
        checkTask?.cancel()

        guard isValid else { return }

        // Debounced availability check (400ms)
        isChecking = true
        checkTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }

            do {
                let available = try await SupabaseClient.shared.checkUsernameAvailable(username)
                await MainActor.run {
                    guard !Task.isCancelled else { return }
                    isChecking = false
                    isAvailable = available
                }
            } catch {
                await MainActor.run {
                    guard !Task.isCancelled else { return }
                    isChecking = false
                    // Silently fail — user can retry
                }
            }
        }
    }

    private func saveUsername() {
        guard canSave else { return }
        guard let userId = SupabaseClient.shared.userId else {
            errorMessage = "Not signed in"
            return
        }

        // Dismiss keyboard
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil, from: nil, for: nil
        )

        isSaving = true
        errorMessage = nil

        Task {
            do {
                try await SupabaseClient.shared.setUsername(username, userId: userId)
                await MainActor.run {
                    isSaving = false
                    onUsernameSet()
                }
            } catch {
                await MainActor.run {
                    isSaving = false
                    errorMessage = "Failed to save. Try again."
                }
            }
        }
    }
}
