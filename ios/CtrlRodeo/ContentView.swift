import SwiftUI
import WebKit

struct ContentView: View {
    @State private var isRefreshing = false
    @State private var isLoading = true
    @State private var errorMessage: String? = nil

    var body: some View {
        ZStack {
            WebView(
                isRefreshing: $isRefreshing,
                isLoading: $isLoading,
                errorMessage: $errorMessage
            )
            .ignoresSafeArea()
            .background(Theme.background)

            // Loading overlay
            if isLoading && errorMessage == nil {
                ZStack {
                    Theme.background
                        .ignoresSafeArea()

                    ProgressView()
                        .tint(Theme.foreground)
                }
            }

            // Error overlay
            if let error = errorMessage {
                ZStack {
                    Theme.background
                        .ignoresSafeArea()

                    VStack(spacing: 20) {
                        Text(error)
                            .foregroundColor(Theme.foreground)
                            .multilineTextAlignment(.center)
                            .padding()

                        Button("Retry") {
                            errorMessage = nil
                            // Will trigger reload via binding in WebView
                        }
                        .foregroundColor(Theme.foreground)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 12)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Theme.foreground, lineWidth: 1)
                        )
                    }
                }
            }
        }
    }
}

// MARK: - WebView

struct WebView: UIViewRepresentable {
    @Binding var isRefreshing: Bool
    @Binding var isLoading: Bool
    @Binding var errorMessage: String?

    func makeUIView(context: Context) -> WKWebView {
        print("[WebView] makeUIView: Creating WKWebView")

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true

        // Set up message handler for auth bridge
        config.userContentController.add(context.coordinator, name: "authBridge")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .black

        // Pull-to-refresh
        let refreshControl = UIRefreshControl()
        refreshControl.tintColor = .white
        refreshControl.addTarget(context.coordinator, action: #selector(Coordinator.refresh), for: .valueChanged)
        webView.scrollView.addSubview(refreshControl)
        context.coordinator.refreshControl = refreshControl

        // Load the boards URL
        if let url = URL(string: AppConstants.boardsURL) {
            print("[WebView] makeUIView: Loading URL \(url)")
            webView.load(URLRequest(url: url))
        }

        // Listen for deep links
        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.handleDeepLink(_:)),
            name: NSNotification.Name("DeepLinkReceived"),
            object: nil
        )

        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if isRefreshing {
            context.coordinator.refreshControl?.endRefreshing()
            isRefreshing = false
        }

        // Reload if error was cleared (retry button tapped)
        if errorMessage == nil && context.coordinator.shouldRetry {
            context.coordinator.shouldRetry = false
            print("[WebView] updateUIView: Retrying load")
            if let url = URL(string: AppConstants.boardsURL) {
                webView.load(URLRequest(url: url))
            }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            isRefreshing: $isRefreshing,
            isLoading: $isLoading,
            errorMessage: $errorMessage
        )
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var webView: WKWebView?
        var refreshControl: UIRefreshControl?
        var shouldRetry = false

        @Binding var isRefreshing: Bool
        @Binding var isLoading: Bool
        @Binding var errorMessage: String?

        private var hasInjectedAuth = false
        private var hasProcessedQueue = false

        init(isRefreshing: Binding<Bool>, isLoading: Binding<Bool>, errorMessage: Binding<String?>) {
            _isRefreshing = isRefreshing
            _isLoading = isLoading
            _errorMessage = errorMessage
        }

        // MARK: - Navigation Delegate

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            print("[WebView] didStartProvisionalNavigation: Started loading")
            isLoading = true
            errorMessage = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            print("[WebView] didFinish: Page loaded successfully")
            isLoading = false

            injectAuthBridge()

            // Inject stored auth into web localStorage (one-time on first load)
            if !hasInjectedAuth {
                injectStoredAuth()
                hasInjectedAuth = true
            }

            // Process queued URLs (one-time on first load)
            if !hasProcessedQueue {
                processQueuedURLs()
                hasProcessedQueue = true
            }

            refreshControl?.endRefreshing()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("[WebView] didFail: Navigation failed with error: \(error.localizedDescription)")
            isLoading = false
            errorMessage = "Failed to load: \(error.localizedDescription)"
            shouldRetry = true
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("[WebView] didFailProvisionalNavigation: Provisional navigation failed with error: \(error.localizedDescription)")
            isLoading = false
            errorMessage = "Failed to load: \(error.localizedDescription)"
            shouldRetry = true
        }

        // MARK: - Script Message Handler

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "authBridge",
                  let body = message.body as? [String: Any],
                  let authData = try? JSONSerialization.data(withJSONObject: body) else {
                return
            }

            // Parse auth token from web and store in App Group
            if let auth = try? JSONDecoder().decode(StoredAuth.self, from: authData) {
                SupabaseClient.shared.storeAuth(auth)
            }
        }

        // MARK: - Auth Bridge

        private func injectAuthBridge() {
            let script = """
            (function() {
                // Monitor localStorage changes to auth token
                const authKey = '\(AppConstants.webAuthStorageKey)';
                const originalSetItem = localStorage.setItem;

                localStorage.setItem = function(key, value) {
                    originalSetItem.apply(this, arguments);
                    if (key === authKey) {
                        try {
                            const auth = JSON.parse(value);
                            window.webkit.messageHandlers.authBridge.postMessage(auth);
                        } catch (e) {
                            console.error('Failed to parse auth:', e);
                        }
                    }
                };

                // Also send current auth if it exists
                const currentAuth = localStorage.getItem(authKey);
                if (currentAuth) {
                    try {
                        const auth = JSON.parse(currentAuth);
                        window.webkit.messageHandlers.authBridge.postMessage(auth);
                    } catch (e) {
                        console.error('Failed to parse existing auth:', e);
                    }
                }
            })();
            """
            webView?.evaluateJavaScript(script)
        }

        private func injectStoredAuth() {
            guard let auth = SupabaseClient.shared.getStoredAuth(),
                  let authData = try? JSONEncoder().encode(auth),
                  let authJSON = String(data: authData, encoding: .utf8) else {
                return
            }

            let script = """
            (function() {
                const authKey = '\(AppConstants.webAuthStorageKey)';
                localStorage.setItem(authKey, '\(authJSON.replacingOccurrences(of: "'", with: "\\'"))');
            })();
            """
            webView?.evaluateJavaScript(script)
        }

        // MARK: - Queue Processing

        private func processQueuedURLs() {
            let queued = QueueService.shared.dequeueAll()
            guard !queued.isEmpty else { return }

            Task {
                for item in queued {
                    do {
                        _ = try await SupabaseClient.shared.addLink(url: item.url, title: item.title)
                    } catch {
                        print("Failed to add queued link: \(error)")
                        // Re-queue if failed
                        QueueService.shared.enqueue(url: item.url, title: item.title)
                    }
                }

                // Reload web view to show new links
                await MainActor.run {
                    webView?.reload()
                }
            }
        }

        // MARK: - Pull to Refresh

        @objc func refresh() {
            webView?.reload()
        }

        // MARK: - Deep Links

        @objc func handleDeepLink(_ notification: Notification) {
            guard let url = notification.userInfo?["url"] as? URL else { return }

            // Navigate to the deep link URL in the web view
            // This handles OAuth callbacks from Supabase
            webView?.load(URLRequest(url: url))
        }
    }
}
