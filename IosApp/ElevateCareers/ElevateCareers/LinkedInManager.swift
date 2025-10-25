//
//  LinkedInManager.swift
//  ElevateCareers
//
//  Created on 2024
//

import SwiftUI
import AuthenticationServices

class LinkedInManager: NSObject, ObservableObject {
    @Published var isLinkedInConnected = false
    @Published var linkedInProfile: LinkedInProfile?
    
    private let clientID = "86fdw92kq8r7hg" // Your LinkedIn Client ID
    private let clientSecret = "WPL_AP1.EraA7s5nnvopV7i3.YOlznQ==" // Your LinkedIn Client Secret
    // Use your own callback page hosted on Firebase
    private let redirectURI = "https://elevatecareers.us/linkedin-callback.html"
    private let scope = "openid profile email"
    
    var authSession: ASWebAuthenticationSession?
    
    struct LinkedInProfile: Codable {
        let id: String
        let email: String?
        let firstName: String?
        let lastName: String?
        let profilePicture: String?
        
        var fullName: String {
            let first = firstName ?? ""
            let last = lastName ?? ""
            return "\(first) \(last)".trimmingCharacters(in: .whitespaces)
        }
    }
    
    // MARK: - Sign In with LinkedIn
    func signInWithLinkedIn(completion: @escaping (Bool, LinkedInProfile?) -> Void) {
        guard let authURL = buildAuthorizationURL() else {
            print("❌ Failed to build LinkedIn auth URL")
            completion(false, nil)
            return
        }
        
        print("🔵 Starting LinkedIn OAuth...")
        print("🔵 LinkedIn Auth URL: \(authURL.absoluteString)")
        
        // Use custom URL scheme for the callback
        authSession = ASWebAuthenticationSession(url: authURL, callbackURLScheme: "elevatecareers") { callbackURL, error in
            if let error = error {
                let nsError = error as NSError
                // User canceled
                if nsError.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                    print("ℹ️ User canceled LinkedIn login")
                } else {
                    print("❌ LinkedIn Auth Error: \(error.localizedDescription)")
                }
                completion(false, nil)
                return
            }
            
            guard let callbackURL = callbackURL else {
                print("❌ No callback URL received")
                completion(false, nil)
                return
            }
            
            print("🔵 Callback URL: \(callbackURL.absoluteString)")
            
            guard let code = self.extractAuthorizationCode(from: callbackURL) else {
                print("❌ No authorization code in callback URL")
                completion(false, nil)
                return
            }
            
            print("✅ Received LinkedIn auth code: \(code.prefix(10))...")
            self.exchangeCodeForAccessToken(code: code, completion: completion)
        }
        
        authSession?.presentationContextProvider = self
        authSession?.prefersEphemeralWebBrowserSession = true
        authSession?.start()
    }
    
    // MARK: - Helper Methods
    private func buildAuthorizationURL() -> URL? {
        var components = URLComponents(string: "https://www.linkedin.com/oauth/v2/authorization")
        components?.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "scope", value: scope),
            URLQueryItem(name: "state", value: UUID().uuidString)
        ]
        return components?.url
    }
    
    private func extractAuthorizationCode(from url: URL) -> String? {
        let urlString = url.absoluteString
        print("🔵 Extracting code from: \(urlString)")
        
        // For custom URL scheme: elevatecareers://linkedin-callback?code=...&state=...
        if let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            print("🔵 URL components parsed successfully")
            print("   - scheme: \(components.scheme ?? "nil")")
            print("   - host: \(components.host ?? "nil")")
            print("   - path: \(components.path)")
            
            if let queryItems = components.queryItems {
                print("🔵 Query items: \(queryItems.count)")
                for item in queryItems {
                    print("   - \(item.name) = \(item.value ?? "nil")")
                }
                
                // Check for error first
                if let error = queryItems.first(where: { $0.name == "error" })?.value {
                    print("❌ LinkedIn returned error: \(error)")
                    if let errorDescription = queryItems.first(where: { $0.name == "error_description" })?.value {
                        print("❌ Error description: \(errorDescription)")
                    }
                    return nil
                }
                
                // Get code from query
                if let code = queryItems.first(where: { $0.name == "code" })?.value {
                    print("✅ Code found in query params: \(code.prefix(10))...")
                    return code
                }
            } else {
                print("⚠️ No query items found")
            }
        } else {
            print("❌ Failed to parse URL components")
        }
        
        // Try to get from fragment (after #) as fallback
        if let fragmentRange = urlString.range(of: "#") {
            let fragment = String(urlString[fragmentRange.upperBound...])
            print("🔵 Trying fragment: \(fragment)")
            let params = fragment.components(separatedBy: "&")
            
            for param in params {
                let keyValue = param.components(separatedBy: "=")
                if keyValue.count == 2, keyValue[0] == "code" {
                    print("✅ Code found in fragment: \(keyValue[1].prefix(10))...")
                    return keyValue[1]
                }
            }
        }
        
        print("❌ Could not extract code from URL")
        return nil
    }
    
    private func exchangeCodeForAccessToken(code: String, completion: @escaping (Bool, LinkedInProfile?) -> Void) {
        print("🔵 Exchanging code for access token...")
        
        let tokenURL = URL(string: "https://www.linkedin.com/oauth/v2/accessToken")!
        var request = URLRequest(url: tokenURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        
        // Build the body with proper URL encoding
        // Important: Don't encode the '=' characters in the client_secret value itself
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "client_secret", value: clientSecret),
            URLQueryItem(name: "redirect_uri", value: redirectURI)
        ]
        
        // Get the properly encoded query string (without the leading '?')
        if let queryString = components.percentEncodedQuery {
            request.httpBody = queryString.data(using: .utf8)
            print("🔵 Request body: \(queryString.replacingOccurrences(of: clientSecret, with: "***SECRET***"))")
        } else {
            print("❌ Failed to create request body")
            completion(false, nil)
            return
        }
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("❌ Token exchange error: \(error.localizedDescription)")
                completion(false, nil)
                return
            }
            
            if let httpResponse = response as? HTTPURLResponse {
                print("🔵 Token exchange status: \(httpResponse.statusCode)")
            }
            
            guard let data = data else {
                print("❌ No data received from token exchange")
                completion(false, nil)
                return
            }
            
            // Log response for debugging
            if let responseString = String(data: data, encoding: .utf8) {
                print("🔵 Token response: \(responseString)")
            }
            
            // Try to parse response
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if let error = json["error"] as? String {
                    print("❌ Token exchange failed: \(error)")
                    if let errorDescription = json["error_description"] as? String {
                        print("❌ Description: \(errorDescription)")
                    }
                    completion(false, nil)
                    return
                }
                
                if let accessToken = json["access_token"] as? String {
                    print("✅ Got LinkedIn access token")
                    self.fetchUserProfile(accessToken: accessToken, completion: completion)
                    return
                }
            }
            
            print("❌ Failed to parse token response")
            completion(false, nil)
        }.resume()
    }
    
    private func fetchUserProfile(accessToken: String, completion: @escaping (Bool, LinkedInProfile?) -> Void) {
        print("🔵 Fetching LinkedIn profile...")
        
        let profileURL = URL(string: "https://api.linkedin.com/v2/userinfo")!
        var request = URLRequest(url: profileURL)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("❌ Profile fetch error: \(error.localizedDescription)")
                completion(false, nil)
                return
            }
            
            guard let data = data else {
                print("❌ No profile data")
                completion(false, nil)
                return
            }
            
            // Log response
            if let responseString = String(data: data, encoding: .utf8) {
                print("🔵 Profile response: \(responseString)")
            }
            
            do {
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                
                let profile = LinkedInProfile(
                    id: json?["sub"] as? String ?? "",
                    email: json?["email"] as? String,
                    firstName: json?["given_name"] as? String,
                    lastName: json?["family_name"] as? String,
                    profilePicture: json?["picture"] as? String
                )
                
                DispatchQueue.main.async {
                    self.linkedInProfile = profile
                    self.isLinkedInConnected = true
                    
                    // Save to UserDefaults
                    if let encoded = try? JSONEncoder().encode(profile) {
                        UserDefaults.standard.set(encoded, forKey: "linkedInProfile")
                    }
                    UserDefaults.standard.set(true, forKey: "isLinkedInConnected")
                    
                    print("✅ LinkedIn profile fetched: \(profile.fullName)")
                    completion(true, profile)
                }
            } catch {
                print("❌ Failed to parse profile: \(error)")
                completion(false, nil)
            }
        }.resume()
    }
    
    // MARK: - Disconnect LinkedIn
    func disconnectLinkedIn() {
        linkedInProfile = nil
        isLinkedInConnected = false
        UserDefaults.standard.removeObject(forKey: "linkedInProfile")
        UserDefaults.standard.removeObject(forKey: "isLinkedInConnected")
        print("✅ LinkedIn disconnected")
    }
    
    // MARK: - Load Saved Profile
    func loadSavedProfile() {
        if let data = UserDefaults.standard.data(forKey: "linkedInProfile"),
           let profile = try? JSONDecoder().decode(LinkedInProfile.self, from: data) {
            self.linkedInProfile = profile
            self.isLinkedInConnected = true
            print("✅ Loaded saved LinkedIn profile: \(profile.fullName)")
        }
    }
}

// MARK: - ASWebAuthenticationPresentationContextProviding
extension LinkedInManager: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else {
            return ASPresentationAnchor()
        }
        return window
    }
}
