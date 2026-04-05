//
//  SettingsView.swift
//  ElevateCareers
//
//  Created on 2024
//

import SwiftUI
import FirebaseAuth

struct SettingsView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @StateObject private var linkedInManager = LinkedInManager()
    @Environment(\.dismiss) private var dismiss
    @State private var showDeleteAlert = false
    @State private var showDeleteConfirmation = false
    @State private var deleteError: String?
    
    var body: some View {
        NavigationStack {
            List {
                // Account Section
                Section {
                    if authViewModel.isSignedIn {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(authViewModel.userName.isEmpty ? "User" : authViewModel.userName)
                                .font(.headline)
                            Text(authViewModel.userEmail)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                        .padding(.vertical, 4)
                    } else {
                        Text("Not signed in")
                            .foregroundColor(.secondary)
                    }
                } header: {
                    Text("Account")
                }
                
                // LinkedIn Connection Section
                if authViewModel.isSignedIn {
                    Section {
                        if linkedInManager.isLinkedInConnected {
                            // LinkedIn Connected
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("LinkedIn Connected")
                                        .font(.headline)
                                    Text(linkedInManager.linkedInProfile?.fullName ?? "")
                                        .font(.subheadline)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                            }
                            
                            Button(role: .destructive, action: {
                                linkedInManager.disconnectLinkedIn()
                            }) {
                                HStack {
                                    Image(systemName: "link.badge.minus")
                                    Text("Disconnect LinkedIn")
                                }
                            }
                        } else {
                            // Connect LinkedIn
                            Button(action: {
                                linkedInManager.signInWithLinkedIn { success, profile in
                                    if success {
                                        print("✅ LinkedIn connected from settings")
                                    }
                                }
                            }) {
                                HStack {
                                    Image(systemName: "person.crop.circle.badge.plus")
                                        .foregroundColor(.blue)
                                    Text("Connect LinkedIn")
                                        .foregroundColor(.primary)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    } header: {
                        Text("LinkedIn Integration")
                    } footer: {
                        Text("Connect your LinkedIn to get personalized job recommendations and quick apply.")
                    }
                }
                
                // Account Actions Section
                if authViewModel.isSignedIn {
                    Section {
                        Button(action: {
                            authViewModel.signOut()
                            dismiss()
                        }) {
                            HStack {
                                Image(systemName: "arrow.right.square")
                                    .foregroundColor(.blue)
                                Text("Sign Out")
                                    .foregroundColor(.primary)
                            }
                        }
                        
                        Button(role: .destructive, action: {
                            showDeleteAlert = true
                        }) {
                            HStack {
                                Image(systemName: "trash")
                                Text("Delete Account")
                            }
                        }
                    } header: {
                        Text("Account Actions")
                    } footer: {
                        Text("Deleting your account will permanently remove all your data including saved jobs and application history. This action cannot be undone.")
                    }
                }
                
                // App Info Section
                Section {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundColor(.secondary)
                    }
                    
                    Link(destination: URL(string: "https://kreativekoala.llc/privacy")!) {
                        HStack {
                            Text("Privacy Policy")
                            Spacer()
                            Image(systemName: "arrow.up.right.square")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    
                    Link(destination: URL(string: "https://kreativekoala.llc/terms")!) {
                        HStack {
                            Text("Terms of Service")
                            Spacer()
                            Image(systemName: "arrow.up.right.square")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                } header: {
                    Text("About")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .alert("Delete Account?", isPresented: $showDeleteAlert) {
                Button("Cancel", role: .cancel) { }
                Button("Delete", role: .destructive) {
                    showDeleteConfirmation = true
                }
            } message: {
                Text("Are you sure you want to delete your account? This action cannot be undone and all your data will be permanently deleted.")
            }
            .alert("Confirm Deletion", isPresented: $showDeleteConfirmation) {
                Button("Cancel", role: .cancel) { }
                Button("Yes, Delete Forever", role: .destructive) {
                    deleteAccount()
                }
            } message: {
                Text("This is your final warning. Your account and all data will be permanently deleted. Are you absolutely sure?")
            }
            .alert("Error", isPresented: .constant(deleteError != nil)) {
                Button("OK") {
                    deleteError = nil
                }
            } message: {
                if let error = deleteError {
                    Text(error)
                }
            }
            .onAppear {
                linkedInManager.loadSavedProfile()
            }
        }
    }
    
    private func deleteAccount() {
        guard let user = Auth.auth().currentUser else {
            deleteError = "No user is currently signed in"
            return
        }
        
        // Delete user account from Firebase
        user.delete { error in
            if let error = error {
                // Check if re-authentication is needed
                if (error as NSError).code == AuthErrorCode.requiresRecentLogin.rawValue {
                    deleteError = "For security reasons, please sign out and sign in again before deleting your account."
                } else {
                    deleteError = "Failed to delete account: \(error.localizedDescription)"
                }
            } else {
                // Successfully deleted
                print("✅ Account deleted successfully")
                authViewModel.signOut()
                dismiss()
            }
        }
    }
}

#Preview {
    SettingsView()
        .environmentObject(AuthViewModel())
}
