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

    var errorDescription: String? {
        switch self {
        case .notAuthenticated: return "Not signed in"
        case .requestFailed: return "Failed to save link"
        case .enrichmentFailed: return "Failed to enrich link"
        }
    }
}
