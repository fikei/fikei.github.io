import SwiftUI

@main
struct CtrlRodeoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
                .background(Color.black)
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
    }

    private func handleDeepLink(_ url: URL) {
        // Handle ctrlrodeo:// deep links (e.g., auth callbacks)
        guard url.scheme == AppConstants.urlScheme else { return }

        // Auth callback from Supabase OAuth flow
        // The web app will handle the actual token exchange
        // We just need to pass it through to the WebView
        NotificationCenter.default.post(
            name: NSNotification.Name("DeepLinkReceived"),
            object: nil,
            userInfo: ["url": url]
        )
    }
}
