import SwiftUI
import WebKit

// MARK: - Root View

struct ContentView: View {
    @State private var isAuthenticated = SupabaseClient.shared.isAuthenticated
    @State private var didSkipAuth = false
    @State private var needsUsername = false
    @State private var isCheckingProfile = false

    var body: some View {
        Group {
            if isCheckingProfile {
                // Loading while checking profile
                ZStack {
                    Theme.background
                        .ignoresSafeArea()
                    ProgressView()
                        .tint(Theme.foreground)
                }
            } else if needsUsername {
                UsernameView(onUsernameSet: {
                    needsUsername = false
                })
            } else if isAuthenticated || didSkipAuth {
                BoardsWebView(
                    isAuthenticated: $isAuthenticated
                )
            } else {
                AuthView(
                    onAuthenticated: {
                        isAuthenticated = true
                        checkProfileForUsername()
                    },
                    onSkip: {
                        didSkipAuth = true
                    }
                )
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSNotification.Name("DeepLinkReceived"))) { notification in
            guard let url = notification.userInfo?["url"] as? URL else { return }
            handleAuthDeepLink(url)
        }
        .onReceive(NotificationCenter.default.publisher(for: NSNotification.Name("AuthStateChanged"))) { _ in
            isAuthenticated = SupabaseClient.shared.isAuthenticated
        }
        .onAppear {
            // Check profile on app launch if already authenticated
            if isAuthenticated {
                checkProfileForUsername()
            }
        }
    }

    // MARK: - Profile Check

    private func checkProfileForUsername() {
        guard let userId = SupabaseClient.shared.userId else { return }

        isCheckingProfile = true
        Task {
            let hasUsername = await userHasUsername(userId: userId)
            await MainActor.run {
                isCheckingProfile = false
                if !hasUsername {
                    needsUsername = true
                }
            }
        }
    }

    private func userHasUsername(userId: String) async -> Bool {
        do {
            let profile = try await SupabaseClient.shared.fetchProfile(userId: userId)
            if let username = profile?.username, !username.isEmpty {
                return true
            }
            return false
        } catch {
            // On error, don't block — let them through
            print("[ContentView] Profile check failed: \(error). Skipping username gate.")
            return true
        }
    }

    // MARK: - Deep Link

    private func handleAuthDeepLink(_ url: URL) {
        print("[ContentView] handleAuthDeepLink: \(url)")

        // Use shared parser from SupabaseClient
        guard let auth = SupabaseClient.shared.parseAuthFromCallback(url) else {
            print("[ContentView] handleAuthDeepLink: No valid tokens in URL")
            return
        }

        print("[ContentView] handleAuthDeepLink: Parsed tokens, storing auth")
        SupabaseClient.shared.storeAuth(auth)
        isAuthenticated = true

        // Notify other views (including WebView coordinator) that auth state changed
        NotificationCenter.default.post(name: NSNotification.Name("AuthStateChanged"), object: nil)

        // Check profile for username
        checkProfileForUsername()

        // Transition to BoardsWebView if not already showing
        if !didSkipAuth {
            DispatchQueue.main.async {
                didSkipAuth = true
            }
        }
    }
}

// MARK: - BoardsWebView

struct BoardsWebView: View {
    @Binding var isAuthenticated: Bool

    @State private var isRefreshing = false
    @State private var isLoading = true
    @State private var errorMessage: String? = nil

    var body: some View {
        ZStack {
            WebView(
                isRefreshing: $isRefreshing,
                isLoading: $isLoading,
                errorMessage: $errorMessage,
                isAuthenticated: $isAuthenticated
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

                    VStack(spacing: Theme.space5) {
                        DSText(error, style: .meta)
                            .multilineTextAlignment(.center)
                            .padding()

                        DSButton(
                            title: "Retry",
                            action: { errorMessage = nil },
                            variant: .outlined
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
    @Binding var isAuthenticated: Bool

    /// Auth bridge JS injected at document start to intercept localStorage writes.
    /// Must run BEFORE any page JS (including Supabase) to patch setItem in time.
    private static let authBridgeJS: String = """
    (function() {
        var authKey = '\(AppConstants.webAuthStorageKey)';
        var originalSetItem = localStorage.setItem;

        localStorage.setItem = function(key, value) {
            originalSetItem.apply(this, arguments);
            if (key === authKey) {
                try {
                    var auth = JSON.parse(value);
                    window.webkit.messageHandlers.authBridge.postMessage(auth);
                } catch (e) {
                    console.error('[authBridge] Failed to parse auth:', e);
                }
            }
        };
    })();
    """

    func makeUIView(context: Context) -> WKWebView {
        print("[WebView] makeUIView: Creating WKWebView")

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true

        // Set up message handler for auth bridge
        config.userContentController.add(context.coordinator, name: "authBridge")

        // Inject auth bridge at document start so it patches localStorage.setItem
        // BEFORE Supabase or any other page JS can write to it.
        let bridgeScript = WKUserScript(
            source: Self.authBridgeJS,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(bridgeScript)

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

        // Always load the base boards URL. Auth tokens are stored directly in Swift
        // (not passed through the URL), and injectStoredAuth() pushes them to web localStorage.
        if let url = URL(string: AppConstants.boardsURL) {
            print("[WebView] makeUIView: Loading base URL \(url)")
            webView.load(URLRequest(url: url))
        }

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
            errorMessage: $errorMessage,
            isAuthenticated: $isAuthenticated
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
        @Binding var isAuthenticated: Bool

        private var hasProcessedQueue = false

        private var authChangedObserver: NSObjectProtocol?

        init(isRefreshing: Binding<Bool>, isLoading: Binding<Bool>, errorMessage: Binding<String?>, isAuthenticated: Binding<Bool>) {
            _isRefreshing = isRefreshing
            _isLoading = isLoading
            _errorMessage = errorMessage
            _isAuthenticated = isAuthenticated
            super.init()

            // When auth state changes (e.g., deep link parsed new tokens), re-inject into web
            authChangedObserver = NotificationCenter.default.addObserver(
                forName: NSNotification.Name("AuthStateChanged"),
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.injectStoredAuth()
            }
        }

        deinit {
            if let observer = authChangedObserver {
                NotificationCenter.default.removeObserver(observer)
            }
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

            // Check if auth already exists in localStorage and send it to Swift.
            // The setItem bridge is already injected via WKUserScript at document start,
            // so this only needs to check for pre-existing auth (e.g., page reload).
            checkExistingAuth()

            // Inject stored auth into web localStorage on every page load.
            // This is idempotent and ensures auth is available after deep link arrivals.
            injectStoredAuth()

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
            // Ignore cancelled navigations — these happen when updateUIView starts a new load
            // (e.g., auth URL) while a previous load (base URL) is still in progress.
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
                print("[WebView] didFailProvisionalNavigation: Ignoring cancelled navigation")
                return
            }

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

            // Parse auth token from web and store in App Group.
            // Do NOT post AuthStateChanged here — it would trigger injectStoredAuth() which
            // writes to localStorage, which triggers this handler again → infinite loop.
            // The isAuthenticated binding propagates the state change directly.
            if let auth = try? JSONDecoder().decode(StoredAuth.self, from: authData) {
                print("[WebView] authBridge: Received auth token, storing...")
                SupabaseClient.shared.storeAuth(auth)
                isAuthenticated = true
            }
        }

        // MARK: - Auth Bridge

        /// Check if auth already exists in localStorage and post it to Swift.
        /// The localStorage.setItem patch is injected via WKUserScript at document start,
        /// so this only handles the case where auth was already in localStorage before the page loaded.
        private func checkExistingAuth() {
            let script = """
            (function() {
                var authKey = '\(AppConstants.webAuthStorageKey)';
                var currentAuth = localStorage.getItem(authKey);
                if (currentAuth) {
                    try {
                        var auth = JSON.parse(currentAuth);
                        window.webkit.messageHandlers.authBridge.postMessage(auth);
                    } catch (e) {
                        console.error('[authBridge] Failed to parse existing auth:', e);
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

    }
}
