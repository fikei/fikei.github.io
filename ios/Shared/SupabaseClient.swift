import Foundation

final class SupabaseClient {
    static let shared = SupabaseClient()

    private let session = URLSession.shared

    // MARK: - Auth

    func getStoredAuth() -> StoredAuth? {
        guard let defaults = UserDefaults(suiteName: AppConstants.appGroupID),
              let data = defaults.data(forKey: AppConstants.authStorageKey) else {
            return nil
        }
        return try? JSONDecoder().decode(StoredAuth.self, from: data)
    }

    func storeAuth(_ auth: StoredAuth) {
        guard let defaults = UserDefaults(suiteName: AppConstants.appGroupID),
              let data = try? JSONEncoder().encode(auth) else { return }
        defaults.set(data, forKey: AppConstants.authStorageKey)
    }

    func clearAuth() {
        guard let defaults = UserDefaults(suiteName: AppConstants.appGroupID) else { return }
        defaults.removeObject(forKey: AppConstants.authStorageKey)
    }

    var isAuthenticated: Bool {
        getStoredAuth() != nil
    }

    var accessToken: String? {
        getStoredAuth()?.accessToken
    }

    var userId: String? {
        getStoredAuth()?.user?.id
    }

    // MARK: - Add Link

    /// Saves a link to Supabase and triggers enrichment. Returns the link ID.
    func addLink(url linkURL: String, title: String? = nil) async throws -> String {
        guard let token = accessToken, let userId = userId else {
            throw SupabaseError.notAuthenticated
        }

        let domain = extractDomain(from: linkURL)
        let linkId = "link_\(Int(Date().timeIntervalSince1970 * 1000))_\(Int.random(in: 1000...9999))"

        let payload = LinkPayload(
            id: linkId,
            userId: userId,
            url: linkURL,
            title: title ?? domain,
            description: "",
            domain: domain,
            category: "uncategorized",
            createdAt: ISO8601DateFormatter().string(from: Date())
        )

        var request = makeRequest(path: "/rest/v1/links", method: "POST")
        request.setValue("resolution=merge-duplicates", forHTTPHeaderField: "Prefer")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(payload)

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw SupabaseError.requestFailed
        }

        // Fire-and-forget enrichment
        Task {
            try? await enrichLink(linkId: linkId, url: linkURL, title: title)
        }

        return linkId
    }

    // MARK: - Enrich Link

    func enrichLink(linkId: String, url: String, title: String?) async throws {
        var request = makeRequest(path: "/functions/v1/enrich-link", method: "POST")
        // enrich-link uses anon key for Authorization (not user token)
        request.setValue("Bearer \(AppConstants.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body = EnrichRequest(url: url, title: title, linkId: linkId)
        request.httpBody = try JSONEncoder().encode(body)

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw SupabaseError.enrichmentFailed
        }
    }

    // MARK: - Magic Link (OTP)

    /// Sends a magic link email via Supabase OTP endpoint
    func sendMagicLink(email: String) async throws {
        var request = makeRequest(path: "/auth/v1/otp", method: "POST")

        let body: [String: Any] = [
            "email": email,
            "options": [
                "emailRedirectTo": "\(AppConstants.boardsURL)"
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw SupabaseError.magicLinkFailed
        }
    }

    // MARK: - Google OAuth

    /// Builds the Supabase Google OAuth URL for ASWebAuthenticationSession.
    var googleOAuthURL: URL {
        var components = URLComponents(string: "\(AppConstants.supabaseURL)/auth/v1/authorize")!
        components.queryItems = [
            URLQueryItem(name: "provider", value: "google"),
            URLQueryItem(name: "redirect_to", value: "\(AppConstants.urlScheme)://auth-callback")
        ]
        return components.url!
    }

    /// Parses access_token and refresh_token from a callback URL fragment.
    func parseAuthFromCallback(_ url: URL) -> StoredAuth? {
        let fragment = url.fragment ?? ""
        var params: [String: String] = [:]
        fragment.split(separator: "&").forEach { pair in
            let kv = pair.split(separator: "=", maxSplits: 1)
            if kv.count == 2 {
                params[String(kv[0])] = String(kv[1])
            }
        }

        guard let accessToken = params["access_token"], !accessToken.isEmpty else {
            return nil
        }

        return StoredAuth(
            accessToken: accessToken,
            refreshToken: params["refresh_token"],
            user: nil
        )
    }

    // MARK: - Profiles

    /// Fetches the user's profile from the profiles table.
    func fetchProfile(userId: String) async throws -> ProfileResponse? {
        let encodedId = userId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? userId
        var request = makeRequest(
            path: "/rest/v1/profiles?id=eq.\(encodedId)&select=id,username,display_name,avatar_url",
            method: "GET"
        )
        if let token = accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw SupabaseError.requestFailed
        }

        let profiles = try JSONDecoder().decode([ProfileResponse].self, from: data)
        return profiles.first
    }

    /// Checks if a username is available (returns true if available).
    func checkUsernameAvailable(_ username: String) async throws -> Bool {
        let encoded = username.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? username
        var request = makeRequest(
            path: "/rest/v1/profiles?username=eq.\(encoded)&select=id",
            method: "GET"
        )
        request.setValue("Bearer \(AppConstants.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw SupabaseError.requestFailed
        }

        let results = try JSONDecoder().decode([[String: String]].self, from: data)
        return results.isEmpty
    }

    /// Sets the username in the user's profile row.
    func setUsername(_ username: String, userId: String) async throws {
        guard let token = accessToken else {
            throw SupabaseError.notAuthenticated
        }

        let encodedId = userId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? userId
        var request = makeRequest(
            path: "/rest/v1/profiles?id=eq.\(encodedId)",
            method: "PATCH"
        )
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["username": username])

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw SupabaseError.usernameSaveFailed
        }
    }

    // MARK: - Helpers

    private func makeRequest(path: String, method: String) -> URLRequest {
        let url = URL(string: "\(AppConstants.supabaseURL)\(path)")!
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(AppConstants.supabaseAnonKey, forHTTPHeaderField: "apikey")
        return request
    }

    private func extractDomain(from urlString: String) -> String {
        guard let url = URL(string: urlString), let host = url.host else {
            return urlString
        }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}

enum SupabaseError: LocalizedError {
    case notAuthenticated
    case requestFailed
    case enrichmentFailed
    case magicLinkFailed
    case googleAuthFailed
    case usernameSaveFailed

    var errorDescription: String? {
        switch self {
        case .notAuthenticated: return "Not signed in"
        case .requestFailed: return "Failed to save link"
        case .enrichmentFailed: return "Failed to enrich link"
        case .magicLinkFailed: return "Failed to send magic link"
        case .googleAuthFailed: return "Google sign-in failed"
        case .usernameSaveFailed: return "Failed to save username"
        }
    }
}
