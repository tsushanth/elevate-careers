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
    
    private let clientID = "YOUR_LINKEDIN_CLIENT_ID" // Replace with your LinkedIn Client ID
    private let clientSecret = "YOUR_LINKEDIN_CLIENT_SECRET" // Replace with your LinkedIn Client Secret
    private let redirectURI = "com.kreativekoala.elevatecareers://oauth/linkedin"
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
        
        authSession = ASWebAuthenticationSession(url: authURL, callbackURLScheme: "com.kreativekoala.elevatecareers") { callbackURL, error in
            if let error = error {
                print("❌ LinkedIn Auth Error: \(error.localizedDescription)")
                completion(false, nil)
                return
            }
            
            guard let callbackURL = callbackURL,
                  let code = self.extractAuthorizationCode(from: callbackURL) else {
                print("❌ No authorization code received")
                completion(false, nil)
                return
            }
            
            print("✅ Received LinkedIn auth code")
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
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems else {
            return nil
        }
        return queryItems.first(where: { $0.name == "code" })?.value
    }
    
    private func exchangeCodeForAccessToken(code: String, completion: @escaping (Bool, LinkedInProfile?) -> Void) {
        let tokenURL = URL(string: "https://www.linkedin.com/oauth/v2/accessToken")!
        var request = URLRequest(url: tokenURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        
        let bodyParams = [
            "grant_type": "authorization_code",
            "code": code,
            "client_id": clientID,
            "client_secret": clientSecret,
            "redirect_uri": redirectURI
        ]
        
        request.httpBody = bodyParams
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: "&")
            .data(using: .utf8)
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("❌ Token exchange error: \(error.localizedDescription)")
                completion(false, nil)
                return
            }
            
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let accessToken = json["access_token"] as? String else {
                print("❌ Failed to parse access token")
                completion(false, nil)
                return
            }
            
            print("✅ Got LinkedIn access token")
            self.fetchUserProfile(accessToken: accessToken, completion: completion)
        }.resume()
    }
    
    private func fetchUserProfile(accessToken: String, completion: @escaping (Bool, LinkedInProfile?) -> Void) {
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
        }
    }
}

// MARK: - ASWebAuthenticationPresentationContextProviding
extension LinkedInManager: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return ASPresentationAnchor()
    }
}