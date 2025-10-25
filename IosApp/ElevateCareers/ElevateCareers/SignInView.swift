//
//  SignInView.swift
//  ElevateCareers
//
//  Created on 2024
//

import SwiftUI
import AuthenticationServices

struct SignInView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @StateObject private var linkedInManager = LinkedInManager()
    @Binding var hasSeenWelcome: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var errorMessage: String?
    @State private var showOnboarding = false

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView {
                    VStack(spacing: 24) {
                        Spacer().frame(height: 20)

                        // Header
                        VStack(spacing: 8) {
                            Image(systemName: "briefcase.circle.fill")
                                .resizable()
                                .frame(width: 60, height: 60)
                                .foregroundColor(Color(red: 0.04, green: 0.4, blue: 0.76))
                            
                            Text("Welcome to ElevateCareers")
                                .font(.title2)
                                .fontWeight(.bold)
                            
                            Text("Sign in to save jobs and track applications")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal)
                        }
                        .padding(.bottom, 10)

                        // Social Sign In Buttons
                        VStack(spacing: 12) {
                            appleSignInButton(width: geometry.size.width)
                            googleSignInButton
                            linkedInSignInButton
                        }

                        // Divider
                        HStack {
                            Rectangle()
                                .fill(Color.gray.opacity(0.3))
                                .frame(height: 1)
                            
                            Text("or")
                                .foregroundColor(.secondary)
                                .padding(.horizontal, 8)
                            
                            Rectangle()
                                .fill(Color.gray.opacity(0.3))
                                .frame(height: 1)
                        }
                        .padding(.horizontal)

                        // Email/Password Fields
                        emailPasswordFields

                        // Continue Without Sign In
                        Button(action: {
                            UserDefaults.standard.set(true, forKey: "hasSeenWelcome")
                            hasSeenWelcome = true
                            dismiss()
                        }) {
                            Text("Continue without signing in")
                                .font(.subheadline)
                                .foregroundColor(Color(red: 0.04, green: 0.4, blue: 0.76))
                                .underline()
                        }
                        .padding(.top, 8)

                        // Benefits Section
                        benefitsSection

                        Spacer()
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: {
                        dismiss()
                    }) {
                        Image(systemName: "xmark")
                            .foregroundColor(.primary)
                    }
                }
            }
            .fullScreenCover(isPresented: $showOnboarding) {
                OnboardingView(linkedInManager: linkedInManager)
                    .environmentObject(authViewModel)
            }
        }
    }
    
    private func appleSignInButton(width: CGFloat) -> some View {
        SignInWithAppleButton(
            onRequest: { request in
                print("🍎 Apple Sign In - onRequest called")
                let nonce = authViewModel.generateNonce()
                authViewModel.currentNonce = nonce
                print("🍎 Nonce generated: \(nonce)")
                request.requestedScopes = [.fullName, .email]
                request.nonce = authViewModel.sha256(nonce)
                print("🍎 Request configured with scopes and nonce")
            },
            onCompletion: { result in
                print("🍎 Apple Sign In - onCompletion called")
                authViewModel.handleAppleSignIn(result: result) { success, userEmail, userId in
                    print("🍎 handleAppleSignIn completed - Success: \(success)")
                    if success {
                        print("✅ Signed in with Apple: \(userEmail ?? "")")
                        UserDefaults.standard.set(true, forKey: "hasSeenWelcome")
                        hasSeenWelcome = true
                        dismiss() // Go to JobListView
                    } else {
                        print("❌ Apple Sign In failed in handler")
                    }
                }
            }
        )
        .frame(width: width * 0.9, height: 50)
        .cornerRadius(10)
        .signInWithAppleButtonStyle(.black)
    }
    
    private var googleSignInButton: some View {
        Button(action: {
            authViewModel.signInWithGoogle { success, userEmail, userId in
                if success {
                    print("✅ Signed in with Google: \(userEmail ?? "")")
                    UserDefaults.standard.set(true, forKey: "hasSeenWelcome")
                    hasSeenWelcome = true
                    dismiss() // Go to JobListView
                }
            }
        }) {
            HStack {
                Image(systemName: "g.circle.fill")
                    .font(.title2)
                    .foregroundColor(.white)
                Text("Continue with Google")
                    .fontWeight(.medium)
                    .foregroundColor(.white)
            }
            .frame(maxWidth: .infinity)
            .padding()
            .background(Color(red: 0.85, green: 0.33, blue: 0.0))
            .cornerRadius(10)
        }
        .frame(height: 50)
        .padding(.horizontal)
    }
    
    private var linkedInSignInButton: some View {
        Button(action: {
            print("🔵 LinkedIn button tapped")
            
            linkedInManager.signInWithLinkedIn { success, profile in
                print("🔵 LinkedIn callback received - success: \(success)")
                
                if let profile = profile {
                    print("✅ LinkedIn profile received:")
                    print("   - ID: \(profile.id)")
                    print("   - Name: \(profile.fullName)")
                    print("   - Email: \(profile.email ?? "nil")")
                } else {
                    print("❌ LinkedIn profile is nil")
                }
                
                if success, let profile = profile {
                    print("✅ LinkedIn OAuth successful: \(profile.fullName)")
                    
                    let email = profile.email ?? "linkedin_\(profile.id)@elevatecareers.temp"
                    print("🔵 Using email: \(email)")
                    
                    // Sign in to Firebase with LinkedIn credentials
                    authViewModel.signInWithLinkedIn(
                        email: email,
                        linkedInId: profile.id,
                        name: profile.fullName
                    ) { firebaseSuccess in
                        print("🔵 Firebase callback - success: \(firebaseSuccess)")
                        
                        DispatchQueue.main.async {
                            if firebaseSuccess {
                                print("✅ Firebase auth successful")
                                print("   - isSignedIn: \(self.authViewModel.isSignedIn)")
                                print("   - userId: \(self.authViewModel.userId)")
                                print("   - userEmail: \(self.authViewModel.userEmail)")
                                
                                UserDefaults.standard.set(true, forKey: "hasSeenWelcome")
                                self.hasSeenWelcome = true
                                
                                print("🔵 Dismissing SignInView")
                                self.dismiss() // Go to job list
                                
                                // Show onboarding after dismissing
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                    print("🔵 Showing onboarding")
                                    self.showOnboarding = true
                                }
                            } else {
                                print("❌ Firebase auth failed")
                                self.errorMessage = "Failed to complete sign in. Please try again."
                            }
                        }
                    }
                } else {
                    print("❌ LinkedIn OAuth failed - success: \(success), profile: \(profile != nil)")
                    DispatchQueue.main.async {
                        self.errorMessage = "Failed to connect with LinkedIn. Please try again."
                    }
                }
            }
        }) {
            HStack {
                Image(systemName: "person.crop.circle.fill.badge.checkmark")
                    .font(.title2)
                    .foregroundColor(.white)
                Text("Continue with LinkedIn")
                    .fontWeight(.medium)
                    .foregroundColor(.white)
            }
            .frame(maxWidth: .infinity)
            .padding()
            .background(Color(red: 0.0, green: 0.47, blue: 0.71)) // LinkedIn Blue
            .cornerRadius(10)
        }
        .frame(height: 50)
        .padding(.horizontal)
    }

    private var emailPasswordFields: some View {
        VStack(spacing: 15) {
            TextField("Email", text: $email)
                .textFieldStyle(RoundedBorderTextFieldStyle())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal)
                .frame(height: 50)

            SecureField("Password", text: $password)
                .textFieldStyle(RoundedBorderTextFieldStyle())
                .padding(.horizontal)
                .frame(height: 50)

            if let errorMessage = errorMessage {
                Text(errorMessage)
                    .foregroundColor(.red)
                    .font(.caption)
                    .padding(.horizontal)
                    .multilineTextAlignment(.center)
            }

            HStack(spacing: 12) {
                Button(action: {
                    authViewModel.signInWithEmail(email: email, password: password) { success, error in
                        if success {
                            print("✅ Signed in with email")
                            UserDefaults.standard.set(true, forKey: "hasSeenWelcome")
                            hasSeenWelcome = true
                            dismiss() // Go to JobListView
                        } else {
                            self.errorMessage = error
                        }
                    }
                }) {
                    Text("Sign In")
                        .fontWeight(.medium)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color(red: 0.04, green: 0.4, blue: 0.76))
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }

                Button(action: {
                    authViewModel.signUpWithEmail(email: email, password: password) { success, error in
                        if success {
                            print("✅ Account created with email")
                            UserDefaults.standard.set(true, forKey: "hasSeenWelcome")
                            hasSeenWelcome = true
                            dismiss() // Go to JobListView
                        } else {
                            self.errorMessage = error
                        }
                    }
                }) {
                    Text("Sign Up")
                        .fontWeight(.medium)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color.green)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }
            }
            .padding(.horizontal)
        }
    }

    private var benefitsSection: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "star.circle.fill")
                    .foregroundColor(Color(red: 0.04, green: 0.4, blue: 0.76))
                    .font(.title2)
                
                Text("Why Sign In?")
                    .font(.headline)
                
                Spacer()
            }
            
            VStack(alignment: .leading, spacing: 10) {
                BenefitRow(icon: "bookmark.fill", text: "Save jobs to review later")
                BenefitRow(icon: "chart.line.uptrend.xyaxis", text: "Track your applications")
                BenefitRow(icon: "bell.badge.fill", text: "Get notified about new opportunities")
                BenefitRow(icon: "sparkles", text: "Personalized job recommendations")
            }
        }
        .padding()
        .background(Color(red: 0.04, green: 0.4, blue: 0.76).opacity(0.1))
        .cornerRadius(12)
        .padding(.horizontal)
    }
}

struct BenefitRow: View {
    let icon: String
    let text: String
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundColor(Color(red: 0.04, green: 0.4, blue: 0.76))
                .font(.body)
                .frame(width: 20)
            
            Text(text)
                .font(.subheadline)
                .foregroundColor(.secondary)
            
            Spacer()
        }
    }
}

#Preview {
    SignInView(hasSeenWelcome: .constant(false))
        .environmentObject(AuthViewModel())
}
