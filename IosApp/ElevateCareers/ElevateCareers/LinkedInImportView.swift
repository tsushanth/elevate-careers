//
//  LinkedInImportView.swift
//  ElevateCareers
//
//  Import profile from LinkedIn
//

import SwiftUI

struct LinkedInImportView: View {
    @ObservedObject var viewModel: ProfileViewModel
    @ObservedObject var linkedInManager = LinkedInManager()
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    VStack(spacing: 16) {
                        Image(systemName: "person.crop.circle.badge.plus")
                            .font(.system(size: 60))
                            .foregroundColor(.blue)
                        
                        Text("Import from LinkedIn")
                            .font(.title)
                            .fontWeight(.bold)
                        
                        Text("Connect your LinkedIn account to auto-fill your profile")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }
                    .padding(.top)
                    
                    // LinkedIn Status
                    if linkedInManager.isLinkedInConnected {
                        // Connected State
                        VStack(spacing: 16) {
                            HStack(spacing: 16) {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.title)
                                    .foregroundColor(.green)
                                
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("LinkedIn Connected")
                                        .font(.headline)
                                    
                                    if let profile = linkedInManager.linkedInProfile {
                                        Text(profile.fullName)
                                            .font(.subheadline)
                                            .foregroundColor(.secondary)
                                    }
                                }
                                
                                Spacer()
                            }
                            .padding()
                            .background(Color.green.opacity(0.1))
                            .cornerRadius(12)
                            
                            // Import Button
                            Button(action: {
                                importFromLinkedIn()
                            }) {
                                HStack {
                                    Image(systemName: "arrow.down.circle.fill")
                                    Text("Import Profile Data")
                                        .fontWeight(.semibold)
                                }
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.blue)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                            }
                            
                            Text("This will update your profile with your LinkedIn information")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                        }
                    } else {
                        // Not Connected State
                        VStack(spacing: 16) {
                            Button(action: {
                                connectLinkedIn()
                            }) {
                                HStack {
                                    Image(systemName: "person.crop.circle.badge.plus")
                                    Text("Connect LinkedIn")
                                        .fontWeight(.semibold)
                                }
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color(red: 0.0, green: 0.47, blue: 0.71))
                                .foregroundColor(.white)
                                .cornerRadius(12)
                            }
                            
                            Text("We'll import your work experience, education, and skills")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                        }
                    }
                    
                    // What will be imported
                    VStack(alignment: .leading, spacing: 16) {
                        Text("What we'll import:")
                            .font(.headline)
                        
                        ImportItem(icon: "person.fill", title: "Basic Info", description: "Name, headline, location")
                        ImportItem(icon: "briefcase.fill", title: "Work Experience", description: "Job titles, companies, dates")
                        ImportItem(icon: "graduationcap.fill", title: "Education", description: "Schools, degrees, fields of study")
                        ImportItem(icon: "star.fill", title: "Skills", description: "Your listed skills")
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    
                    Spacer()
                }
                .padding()
            }
            .navigationTitle("LinkedIn Import")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .overlay {
                if viewModel.isLoading {
                    ProgressView()
                        .scaleEffect(1.5)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.black.opacity(0.3))
                }
            }
            .alert("Success", isPresented: $viewModel.showError) {
                Button("OK") {
                    if viewModel.errorMessage?.contains("successfully") == true {
                        dismiss()
                    }
                }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
        }
    }
    
    private func connectLinkedIn() {
        linkedInManager.signInWithLinkedIn { success, profile in
            if success {
                print("✅ LinkedIn connected successfully")
            } else {
                viewModel.errorMessage = "Failed to connect LinkedIn"
                viewModel.showError = true
            }
        }
    }
    
    private func importFromLinkedIn() {
        guard let profile = linkedInManager.linkedInProfile else { return }
        
        // Convert LinkedIn profile to dictionary
        let linkedInData: [String: Any] = [
            "firstName": profile.firstName ?? "",
            "lastName": profile.lastName ?? "",
            "fullName": profile.fullName,
            "email": profile.email ?? "",
            "id": profile.id,
            "profilePicture": profile.profilePicture ?? ""
        ]
        
        Task {
            await viewModel.importFromLinkedIn(linkedInData: linkedInData)
        }
    }
}

struct ImportItem: View {
    let icon: String
    let title: String
    let description: String
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundColor(.blue)
                .frame(width: 40)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                
                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.green)
        }
    }
}

#Preview {
    LinkedInImportView(viewModel: ProfileViewModel())
}
