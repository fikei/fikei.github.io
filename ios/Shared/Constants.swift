import Foundation

enum AppConstants {
    static let supabaseURL = "https://yfhudwakpgzswiylhfbh.supabase.co"
    static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI"

    static let appGroupID = "group.com.ctrlrodeo.boards"
    static let authStorageKey = "supabase_auth"
    static let queueStorageKey = "url_queue"

    static let boardsURL = "https://ctrl.rodeo/boards/"
    static let urlScheme = "ctrlrodeo"

    // Matches the web app's localStorage key for Supabase auth
    static let webAuthStorageKey = "sb-yfhudwakpgzswiylhfbh-auth-token"
}
