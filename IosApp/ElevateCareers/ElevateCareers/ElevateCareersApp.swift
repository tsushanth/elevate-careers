//
//  ElevateCareersApp.swift
//  ElevateCareers
//
//  Created on 2024
//

import SwiftUI
import FirebaseCore
import GoogleSignIn

@main
struct ElevateCareersApp: App {
    @StateObject private var authViewModel = AuthViewModel()
    @State private var hasSeenWelcome = false
    
    init() {
        // Configure Firebase
        FirebaseApp.configure()

        // Register Apple Search Ads attribution token (one-shot, background)
        AttributionService.shared.trackAttribution()

        // Check if user has seen welcome screen before
        let seen = UserDefaults.standard.bool(forKey: "hasSeenWelcome")
        _hasSeenWelcome = State(initialValue: seen)
    }
    
    var body: some Scene {
        WindowGroup {
            Group {
                if !hasSeenWelcome {
                    WelcomeView(hasSeenWelcome: $hasSeenWelcome)
                        .environmentObject(authViewModel)
                } else {
                    JobListView(hasSeenWelcome: $hasSeenWelcome)
                        .environmentObject(authViewModel)
                }
            }
            .onOpenURL { url in
                GIDSignIn.sharedInstance.handle(url)
            }
        }
    }
}
