//
//  WelcomeView.swift
//  ElevateCareers
//
//  Created on 2024
//

import SwiftUI

struct WelcomeView: View {
    @Binding var hasSeenWelcome: Bool
    @EnvironmentObject var authViewModel: AuthViewModel
    @State private var showSignIn = false

    var body: some View {
        NavigationStack {
            ZStack {
                // LinkedIn-inspired gradient
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color(red: 0.04, green: 0.4, blue: 0.76), // LinkedIn Blue
                        Color(red: 0.0, green: 0.25, blue: 0.51)  // Darker Blue
                    ]),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                VStack(spacing: 40) {
                    Spacer()

                    // App Icon/Logo Area
                    VStack(spacing: 16) {
                        Image(systemName: "briefcase.circle.fill")
                            .resizable()
                            .frame(width: 100, height: 100)
                            .foregroundColor(.white)
                        
                        Text("ElevateCareers")
                            .font(.system(size: 36, weight: .bold))
                            .foregroundColor(.white)
                        
                        Text("Find Your Dream Job")
                            .font(.headline)
                            .foregroundColor(.white.opacity(0.9))
                    }

                    Spacer()

                    // Features
                    VStack(alignment: .leading, spacing: 12) {
                        FeatureRow(icon: "magnifyingglass", text: "Search thousands of jobs")
                        FeatureRow(icon: "slider.horizontal.3", text: "Filter by remote, salary & more")
                        FeatureRow(icon: "bookmark.fill", text: "Save your favorite positions")
                        FeatureRow(icon: "chart.line.uptrend.xyaxis", text: "Track your applications")
                    }
                    .padding(.horizontal, 40)

                    Spacer()

                    // Get Started Button
                    Button(action: {
                        showSignIn = true
                    }) {
                        Text("Get Started")
                            .font(.headline)
                            .foregroundColor(Color(red: 0.04, green: 0.4, blue: 0.76))
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.white)
                            .cornerRadius(12)
                            .padding(.horizontal, 40)
                            .shadow(radius: 8)
                    }

                    // Log in Text
                    HStack(spacing: 4) {
                        Text("Already have an account?")
                            .foregroundColor(.white.opacity(0.9))

                        Button(action: {
                            showSignIn = true
                        }) {
                            Text("Log in")
                                .foregroundColor(.white)
                                .fontWeight(.semibold)
                                .underline()
                        }
                    }
                    .font(.subheadline)

                    Spacer().frame(height: 30)
                }
                .padding()
            }
            .sheet(isPresented: $showSignIn) {
                SignInView(hasSeenWelcome: $hasSeenWelcome)
                    .environmentObject(authViewModel)
            }
        }
    }
}

struct FeatureRow: View {
    let icon: String
    let text: String
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundColor(.white)
                .frame(width: 30)
            
            Text(text)
                .font(.body)
                .foregroundColor(.white)
            
            Spacer()
        }
    }
}
