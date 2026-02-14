import UIKit
import UniformTypeIdentifiers

/// Custom Share Extension view controller for ctrl.rodeo Boards
/// Displays a minimal black/white UI, saves URLs to Supabase or queues them offline
@objc(ShareViewController)
class ShareViewController: UIViewController {

    // MARK: - UI Elements

    private let containerView = UIView()
    private let iconLabel = UILabel()
    private let statusLabel = UILabel()
    private let urlLabel = UILabel()

    // MARK: - State

    private var sharedURL: String?
    private var sharedTitle: String?

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        extractSharedContent()
    }

    // MARK: - UI Setup

    private func setupUI() {
        view.backgroundColor = UIColor.black

        // Container for centered content
        containerView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(containerView)

        // Icon (SF Symbol checkmark)
        iconLabel.translatesAutoresizingMaskIntoConstraints = false
        iconLabel.font = UIFont.systemFont(ofSize: 48, weight: .regular)
        iconLabel.textColor = .white
        iconLabel.textAlignment = .center
        iconLabel.alpha = 0 // Start invisible for fade-in
        containerView.addSubview(iconLabel)

        // Status text
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = UIFont.systemFont(ofSize: 16, weight: .medium)
        statusLabel.textColor = .white
        statusLabel.textAlignment = .center
        statusLabel.alpha = 0
        containerView.addSubview(statusLabel)

        // URL display
        urlLabel.translatesAutoresizingMaskIntoConstraints = false
        urlLabel.font = UIFont.systemFont(ofSize: 12, weight: .regular)
        urlLabel.textColor = UIColor(white: 0.533, alpha: 1.0) // #888
        urlLabel.textAlignment = .center
        urlLabel.numberOfLines = 1
        urlLabel.lineBreakMode = .byTruncatingMiddle
        urlLabel.alpha = 0
        containerView.addSubview(urlLabel)

        NSLayoutConstraint.activate([
            // Center container
            containerView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            containerView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            containerView.widthAnchor.constraint(equalTo: view.widthAnchor, constant: -48),

            // Icon at top
            iconLabel.topAnchor.constraint(equalTo: containerView.topAnchor),
            iconLabel.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),

            // Status below icon
            statusLabel.topAnchor.constraint(equalTo: iconLabel.bottomAnchor, constant: 16),
            statusLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),

            // URL below status
            urlLabel.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 8),
            urlLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            urlLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),
            urlLabel.bottomAnchor.constraint(equalTo: containerView.bottomAnchor)
        ])

        // Configure presentation style
        if #available(iOS 15.0, *) {
            if let sheet = sheetPresentationController {
                sheet.detents = [.medium()]
                sheet.prefersGrabberVisible = false
            }
        }
        modalPresentationStyle = .pageSheet
    }

    // MARK: - Content Extraction

    private func extractSharedContent() {
        guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem else {
            showError()
            return
        }

        // Try to get title from the extension item
        let titleFromItem = extensionItem.attributedTitle?.string ?? extensionItem.attributedContentText?.string

        guard let attachments = extensionItem.attachments else {
            showError()
            return
        }

        // Try URL type first
        if let urlAttachment = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            urlAttachment.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] (item, error) in
                DispatchQueue.main.async {
                    if let url = item as? URL {
                        self?.sharedURL = url.absoluteString
                        self?.sharedTitle = titleFromItem
                        self?.saveLink()
                    } else {
                        self?.showError()
                    }
                }
            }
        }
        // Fall back to plain text (some apps share URLs as text)
        else if let textAttachment = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            textAttachment.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] (item, error) in
                DispatchQueue.main.async {
                    if let text = item as? String, self?.isValidURL(text) == true {
                        self?.sharedURL = text
                        self?.sharedTitle = titleFromItem
                        self?.saveLink()
                    } else {
                        self?.showError()
                    }
                }
            }
        } else {
            showError()
        }
    }

    private func isValidURL(_ string: String) -> Bool {
        guard let url = URL(string: string) else { return false }
        return url.scheme == "http" || url.scheme == "https"
    }

    // MARK: - Save Flow

    private func saveLink() {
        guard let url = sharedURL else {
            showError()
            return
        }

        urlLabel.text = url

        if SupabaseClient.shared.isAuthenticated {
            // Try to save directly
            Task {
                do {
                    _ = try await SupabaseClient.shared.addLink(url: url, title: sharedTitle)
                    await showSuccess()
                } catch {
                    // Failed to save, queue it
                    await queueLink(url: url, title: sharedTitle)
                }
            }
        } else {
            // Not authenticated, queue it
            Task {
                await queueLink(url: url, title: sharedTitle)
            }
        }
    }

    @MainActor
    private func showSuccess() {
        iconLabel.text = "✓"
        statusLabel.text = "Saved to Boards"
        fadeInAndDismiss()
    }

    @MainActor
    private func queueLink(url: String, title: String?) {
        QueueService.shared.enqueue(url: url, title: title)
        iconLabel.text = "↑"
        statusLabel.text = "Queued for sync"
        fadeInAndDismiss()
    }

    @MainActor
    private func showError() {
        iconLabel.text = "✕"
        statusLabel.text = "Unable to save"
        urlLabel.text = "Please try again"
        fadeInAndDismiss(delay: 2.0)
    }

    // MARK: - Animation & Dismissal

    private func fadeInAndDismiss(delay: TimeInterval = 1.5) {
        UIView.animate(withDuration: 0.3) {
            self.iconLabel.alpha = 1.0
            self.statusLabel.alpha = 1.0
            self.urlLabel.alpha = 1.0
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }
}
