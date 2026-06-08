//
//  AttributionService.swift
//  ElevateCareers
//
//  Registers Apple Search Ads attribution token with Apple's
//  AdServices endpoint so ASA conversions can be attributed.
//

import Foundation
import AdServices

final class AttributionService {
    static let shared = AttributionService()
    private let sentKey = "asa.attribution.sent"
    private init() {}

    func trackAttribution() {
        guard !UserDefaults.standard.bool(forKey: sentKey) else { return }
        Task.detached(priority: .background) {
            do {
                let token = try AAAttribution.attributionToken()
                try await Self.postToApple(token: token)
                UserDefaults.standard.set(true, forKey: self.sentKey)
            } catch {
                // silent
            }
        }
    }

    private static func postToApple(token: String) async throws {
        var req = URLRequest(url: URL(string: "https://api-adservices.apple.com/api/v1/")!)
        req.httpMethod = "POST"
        req.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        req.httpBody = token.data(using: .utf8)
        _ = try await URLSession.shared.data(for: req)
    }
}
