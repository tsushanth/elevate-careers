//
//  AuthViewModel.swift
//  ElevateCareers
//
//  Created on 2024
//

import SwiftUI
import FirebaseAuth
import GoogleSignIn
import Firebase
import CryptoKit
import AuthenticationServices

class AuthViewModel: ObservableObject {
    @Published var isSignedIn = false
    @Published var userEmail: String = ""
    @Published var userId: String = ""
    @Published var userName: String = ""
    
    var currentNonce: String?
    
    init() {
        checkAuthStatus()
    }
    
    func checkAuthStatus() {
        if let user = Auth.auth().currentUser {
            self.isSignedIn = true
            self.userEmail = user.email ?? ""
            self.userId = user.uid
            self.userName = user.displayName ?? ""
        }
    }
    
    // MARK: - Google Sign In
    func signInWithGoogle(completion: @escaping (Bool, String?, String?) -> Void) {
        guard let clientID = FirebaseApp.app()?.options.clientID else {
            completion(false, nil, nil)
            return
        }
        
        let config = GIDConfiguration(clientID: clientID)
        GIDSignIn.sharedInstance.configuration = config
        
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let rootViewController = windowScene.windows.first?.rootViewController else {
            completion(false, nil, nil)
            return
        }
        
        GIDSignIn.sharedInstance.signIn(withPresenting: rootViewController) { [weak self] result, error in
            guard let self = self else { return }
            
            if let error = error {
                print("❌ Google Sign In Error: \(error.localizedDescription)")
                completion(false, nil, nil)
                return
            }
            
            guard let user = result?.user,
                  let idToken = user.idToken?.tokenString else {
                completion(false, nil, nil)
                return
            }
            
            let credential = GoogleAuthProvider.credential(withIDToken: idToken,
                                                          accessToken: user.accessToken.tokenString)
            
            Auth.auth().signIn(with: credential) { authResult, error in
                if let error = error {
                    print("❌ Firebase Auth Error: \(error.localizedDescription)")
                    completion(false, nil, nil)
                    return
                }
                
                if let user = authResult?.user {
                    DispatchQueue.main.async {
                        self.isSignedIn = true
                        self.userEmail = user.email ?? ""
                        self.userId = user.uid
                        self.userName = user.displayName ?? ""
                        completion(true, user.email, user.uid)
                    }
                }
            }
        }
    }
    
    // MARK: - Apple Sign In
    func handleAppleSignIn(result: Result<ASAuthorization, Error>, completion: @escaping (Bool, String?, String?) -> Void) {
        switch result {
        case .success(let authorization):
            if let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential {
                guard let nonce = currentNonce else {
                    print("❌ Invalid state: A login callback was received, but no login request was sent.")
                    completion(false, nil, nil)
                    return
                }
                
                guard let appleIDToken = appleIDCredential.identityToken else {
                    print("❌ Unable to fetch identity token")
                    completion(false, nil, nil)
                    return
                }
                
                guard let idTokenString = String(data: appleIDToken, encoding: .utf8) else {
                    print("❌ Unable to serialize token string from data")
                    completion(false, nil, nil)
                    return
                }
                
                let credential = OAuthProvider.credential(withProviderID: "apple.com",
                                                         idToken: idTokenString,
                                                         rawNonce: nonce)
                
                Auth.auth().signIn(with: credential) { [weak self] authResult, error in
                    guard let self = self else { return }
                    
                    if let error = error {
                        print("❌ Firebase Auth Error: \(error.localizedDescription)")
                        completion(false, nil, nil)
                        return
                    }
                    
                    if let user = authResult?.user {
                        DispatchQueue.main.async {
                            self.isSignedIn = true
                            self.userEmail = user.email ?? ""
                            self.userId = user.uid
                            self.userName = user.displayName ?? ""
                            completion(true, user.email, user.uid)
                        }
                    }
                }
            }
        case .failure(let error):
            print("❌ Apple Sign In Error: \(error.localizedDescription)")
            completion(false, nil, nil)
        }
    }
    
    // MARK: - Email/Password Sign In
    func signInWithEmail(email: String, password: String, completion: @escaping (Bool, String?) -> Void) {
        Auth.auth().signIn(withEmail: email, password: password) { [weak self] authResult, error in
            guard let self = self else { return }
            
            if let error = error {
                completion(false, error.localizedDescription)
                return
            }
            
            if let user = authResult?.user {
                DispatchQueue.main.async {
                    self.isSignedIn = true
                    self.userEmail = user.email ?? ""
                    self.userId = user.uid
                    self.userName = user.displayName ?? ""
                    completion(true, nil)
                }
            }
        }
    }
    
    // MARK: - Email/Password Sign Up
    func signUpWithEmail(email: String, password: String, completion: @escaping (Bool, String?) -> Void) {
        Auth.auth().createUser(withEmail: email, password: password) { [weak self] authResult, error in
            guard let self = self else { return }
            
            if let error = error {
                completion(false, error.localizedDescription)
                return
            }
            
            if let user = authResult?.user {
                DispatchQueue.main.async {
                    self.isSignedIn = true
                    self.userEmail = user.email ?? ""
                    self.userId = user.uid
                    self.userName = user.displayName ?? ""
                    completion(true, nil)
                }
            }
        }
    }
    
    // MARK: - Sign Out
    func signOut() {
        do {
            try Auth.auth().signOut()
            GIDSignIn.sharedInstance.signOut()
            
            DispatchQueue.main.async {
                self.isSignedIn = false
                self.userEmail = ""
                self.userId = ""
                self.userName = ""
            }
        } catch {
            print("❌ Error signing out: \(error.localizedDescription)")
        }
    }
    
    // MARK: - Nonce Generation for Apple Sign In
    func generateNonce(length: Int = 32) -> String {
        precondition(length > 0)
        let charset: [Character] =
        Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remainingLength = length
        
        while remainingLength > 0 {
            let randoms: [UInt8] = (0 ..< 16).map { _ in
                var random: UInt8 = 0
                let errorCode = SecRandomCopyBytes(kSecRandomDefault, 1, &random)
                if errorCode != errSecSuccess {
                    fatalError("Unable to generate nonce. SecRandomCopyBytes failed with OSStatus \(errorCode)")
                }
                return random
            }
            
            randoms.forEach { random in
                if remainingLength == 0 {
                    return
                }
                
                if random < charset.count {
                    result.append(charset[Int(random)])
                    remainingLength -= 1
                }
            }
        }
        
        return result
    }
    
    func sha256(_ input: String) -> String {
        let inputData = Data(input.utf8)
        let hashedData = SHA256.hash(data: inputData)
        let hashString = hashedData.compactMap {
            String(format: "%02x", $0)
        }.joined()
        
        return hashString
    }
}