//
//  LoginWelcomeView.swift
//  ElevateCareers
//
//  Created by Sushanth Tiruvaipati on 10/24/25.
//


//
//  LoginWelcomeView.swift
//  PuzzleForge
//
//  Created by Sushanth Tiruvaipati on 5/23/25.
//


import SwiftUI
import FirebaseAuth

struct LoginWelcomeView: View {
    @State private var navigateToNext = false
    @StateObject private var viewModel = QAPuzzleViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                // ✅ Gradient Background
                LinearGradient(
                    gradient: Gradient(colors: [Color.purple.opacity(0.9), Color.purple]),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                VStack(spacing: 40) {
                    Spacer()

                    // ✅ Question Marks
                    HStack(spacing: 16) {
                        Image(systemName: "questionmark.circle.fill")
                            .resizable()
                            .frame(width: 60, height: 60)
                            .foregroundColor(.pink)

                        Image(systemName: "questionmark.circle.fill")
                            .resizable()
                            .frame(width: 80, height: 80)
                            .foregroundColor(.orange)

                        Image(systemName: "questionmark.circle.fill")
                            .resizable()
                            .frame(width: 60, height: 60)
                            .foregroundColor(.purple.opacity(0.7))
                    }

                    Spacer()

                    // ✅ Get Started Button
                    Button(action: {
                        navigateToNext = true
                    }) {
                        Text("Get Started")
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.orange)
                            .cornerRadius(30)
                            .padding(.horizontal, 40)
                            .shadow(radius: 4)
                    }

                    // ✅ Log in Text
                    HStack(spacing: 4) {
                        Text("Already have an account?")
                            .foregroundColor(.white)

                        Button(action: {
                            navigateToNext = true
                        }) {
                            Text("Log in")
                                .foregroundColor(.orange)
                                .underline()
                        }
                    }
                    .font(.subheadline)

                    // ✅ Navigate based on sign-in status
                    NavigationLink(
                        destination: viewModel.isSignedIn
                            ? AnyView(HomeView())
                            : AnyView(SignInView(viewModel: viewModel)),
                        isActive: $navigateToNext
                    ) {
                        EmptyView()
                    }

                    Spacer().frame(height: 30)
                }
                .padding()
            }
        }
        .onAppear {
            if let user = Auth.auth().currentUser {
                viewModel.isSignedIn = true
                viewModel.userEmail = user.email ?? ""
                viewModel.userId = user.uid
            }
        }
    }
}
