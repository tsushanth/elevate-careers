//
//  SignInView 2.swift
//  ElevateCareers
//
//  Created by Sushanth Tiruvaipati on 10/24/25.
//


//
//  SignInView.swift
//  ElevateCareers
//
//  Created on 2024
//

import SwiftUI
import AuthenticationServices

struct SignInView: View {
    @ObservedObject var authViewModel: AuthViewModel
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
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
                        googleSignInButton
                        appleSignInButton(width: geometry.size.width)
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

                    // Benefits Section
                    benefitsSection

                    Spacer()
                }
            }
        }
        .onChange(of: authViewModel.isSignedIn) { isSignedIn in
            if isSignedIn {
                dismiss()
            }
        }
    }
    
    private var googleSignInButton: some View {
        Button(action: {
            authViewModel.signInWithGoogle { success, userEmail, userId in
                if success {
                    print("✅ Signed in with Google: \(userEmail ?? "")")
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
            .background(Color(red: 0.85, green: 0.33, blue: 0.0)) // Google Orange
            .cornerRadius(10)
        }
        .frame(height: 50)
        .padding(.horizontal)
    }

    private func appleSignInButton(width: CGFloat) -> some View {
        SignInWithAppleButton(
            onRequest: { request in
                let nonce = authViewModel.generateNonce()
                authViewModel.currentNonce = nonce
                request.requestedScopes = [.fullName, .email]
                request.nonce = authViewModel.sha256(nonce)
            },
            onCompletion: { result in
                authViewModel.handleAppleSignIn(result: result) { success, userEmail, userId in
                    if success {
                        print("✅ Signed in with Apple: \(userEmail ?? "")")
                    }
                }
            }
        )
        .frame(width: width * 0.9, height: 50)
        .cornerRadius(10)
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
    SignInView(authViewModel: AuthViewModel())
}