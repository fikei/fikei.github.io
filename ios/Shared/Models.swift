import Foundation

// MARK: - Auth

struct StoredAuth: Codable {
    let accessToken: String
    let refreshToken: String?
    let user: AuthUser?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case user
    }
}

struct AuthUser: Codable {
    let id: String
    let email: String?
}

// MARK: - Link

struct LinkPayload: Codable {
    let id: String
    let userId: String
    let url: String
    let title: String
    let description: String
    let domain: String
    let category: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case url, title, description, domain, category
        case createdAt = "created_at"
    }
}

// MARK: - Enrich Request

struct EnrichRequest: Codable {
    let url: String
    let title: String?
    let linkId: String?
}

// MARK: - Queue

struct QueuedURL: Codable, Identifiable {
    let id: String
    let url: String
    let title: String?
    let queuedAt: Date

    init(url: String, title: String?) {
        self.id = UUID().uuidString
        self.url = url
        self.title = title
        self.queuedAt = Date()
    }
}
