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
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    // Handle Universal Links (https:// URLs that match apple-app-site-association)
                    guard let url = activity.webpageURL else { return }
                    print("[App] onContinueUserActivity: Universal Link received \(url)")
                    handleDeepLink(url)
                }
        }
    }

    private func handleDeepLink(_ url: URL) {
        print("[App] handleDeepLink: \(url)")

        // Post notification for ContentView/WebView to handle
        NotificationCenter.default.post(
            name: NSNotification.Name("DeepLinkReceived"),
            object: nil,
            userInfo: ["url": url]
        )
    }
}
