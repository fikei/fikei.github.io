import Foundation

final class QueueService {
    static let shared = QueueService()

    private let defaults: UserDefaults?

    init() {
        defaults = UserDefaults(suiteName: AppConstants.appGroupID)
    }

    // MARK: - Enqueue

    func enqueue(url: String, title: String?) {
        var queue = loadQueue()
        queue.append(QueuedURL(url: url, title: title))
        saveQueue(queue)
    }

    // MARK: - Dequeue

    /// Returns all queued URLs and clears the queue.
    func dequeueAll() -> [QueuedURL] {
        let queue = loadQueue()
        if !queue.isEmpty {
            saveQueue([])
        }
        return queue
    }

    /// Returns the number of queued URLs without modifying the queue.
    var count: Int {
        loadQueue().count
    }

    // MARK: - Storage

    private func loadQueue() -> [QueuedURL] {
        guard let data = defaults?.data(forKey: AppConstants.queueStorageKey) else {
            return []
        }
        return (try? JSONDecoder().decode([QueuedURL].self, from: data)) ?? []
    }

    private func saveQueue(_ queue: [QueuedURL]) {
        guard let data = try? JSONEncoder().encode(queue) else { return }
        defaults?.set(data, forKey: AppConstants.queueStorageKey)
    }
}
