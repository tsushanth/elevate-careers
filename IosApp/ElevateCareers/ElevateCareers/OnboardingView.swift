//
//  OnboardingView.swift
//  ElevateCareers
//
//  Created on 2024
//

import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @ObservedObject var linkedInManager: LinkedInManager
    @Environment(\.dismiss) private var dismiss
    @State private var showDocumentPicker = false
    @State private var selectedResumeURL: URL?
    @State private var resumeFileName: String?
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Progress indicator
                HStack(spacing: 8) {
                    ForEach(0..<2) { index in
                        Rectangle()
                            .fill(Color(red: 0.04, green: 0.4, blue: 0.76))
                            .frame(height: 3)
                    }
                }
                .padding()
                
                ScrollView {
                    VStack(spacing: 32) {
                        Spacer().frame(height: 20)
                        
                        // Header
                        VStack(spacing: 16) {
                            Image(systemName: "sparkles")
                                .font(.system(size: 60))
                                .foregroundColor(Color(red: 0.04, green: 0.4, blue: 0.76))
                            
                            Text("Let's personalize your experience")
                                .font(.title)
                                .fontWeight(.bold)
                                .multilineTextAlignment(.center)
                            
                            Text("Connect your LinkedIn or upload your resume to get better job matches")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal)
                        }
                        
                        // LinkedIn Connection
                        VStack(spacing: 16) {
                            if linkedInManager.isLinkedInConnected {
                                // LinkedIn Connected
                                HStack(spacing: 16) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.title)
                                        .foregroundColor(.green)
                                    
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("LinkedIn Connected")
                                            .font(.headline)
                                        Text(linkedInManager.linkedInProfile?.fullName ?? "")
                                            .font(.subheadline)
                                            .foregroundColor(.secondary)
                                    }
                                    
                                    Spacer()
                                }
                                .padding()
                                .background(Color.green.opacity(0.1))
                                .cornerRadius(12)
                                .padding(.horizontal)
                            } else {
                                // Connect LinkedIn Button
                                Button(action: {
                                    linkedInManager.signInWithLinkedIn { success, profile in
                                        if success, let profile = profile {
                                            print("✅ LinkedIn connected in onboarding")
                                            print("   - Name: \(profile.fullName)")
                                            print("   - Email: \(profile.email ?? "nil")")
                                            
                                            // Update Firebase with LinkedIn info if user is signed in
                                            if authViewModel.isSignedIn, !authViewModel.userId.isEmpty {
                                                let email = profile.email ?? "linkedin_\(profile.id)@elevatecareers.temp"
                                                authViewModel.signInWithLinkedIn(
                                                    email: email,
                                                    linkedInId: profile.id,
                                                    name: profile.fullName
                                                ) { firebaseSuccess in
                                                    if firebaseSuccess {
                                                        print("✅ LinkedIn info updated in Firebase")
                                                    }
                                                }
                                            }
                                        } else {
                                            print("❌ LinkedIn connection failed in onboarding")
                                        }
                                    }
                                }) {
                                    HStack {
                                        Image(systemName: "person.crop.circle.badge.plus")
                                            .font(.title2)
                                        
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text("Connect LinkedIn")
                                                .font(.headline)
                                            Text("Import your profile and experience")
                                                .font(.caption)
                                                .foregroundColor(.white.opacity(0.9))
                                        }
                                        
                                        Spacer()
                                        
                                        Image(systemName: "chevron.right")
                                    }
                                    .foregroundColor(.white)
                                    .padding()
                                    .background(Color(red: 0.0, green: 0.47, blue: 0.71))
                                    .cornerRadius(12)
                                }
                                .padding(.horizontal)
                            }
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
                        
                        // Resume Upload
                        VStack(spacing: 16) {
                            if let fileName = resumeFileName {
                                // Resume Uploaded
                                HStack(spacing: 16) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.title)
                                        .foregroundColor(.green)
                                    
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("Resume Uploaded")
                                            .font(.headline)
                                        Text(fileName)
                                            .font(.subheadline)
                                            .foregroundColor(.secondary)
                                            .lineLimit(1)
                                    }
                                    
                                    Spacer()
                                    
                                    Button(action: {
                                        selectedResumeURL = nil
                                        resumeFileName = nil
                                    }) {
                                        Image(systemName: "xmark.circle.fill")
                                            .foregroundColor(.secondary)
                                    }
                                }
                                .padding()
                                .background(Color.green.opacity(0.1))
                                .cornerRadius(12)
                                .padding(.horizontal)
                            } else {
                                // Upload Resume Button
                                Button(action: {
                                    showDocumentPicker = true
                                }) {
                                    HStack {
                                        Image(systemName: "doc.badge.plus")
                                            .font(.title2)
                                        
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text("Upload Resume")
                                                .font(.headline)
                                            Text("PDF, DOC, or DOCX")
                                                .font(.caption)
                                                .foregroundColor(.primary.opacity(0.7))
                                        }
                                        
                                        Spacer()
                                        
                                        Image(systemName: "chevron.right")
                                    }
                                    .foregroundColor(.primary)
                                    .padding()
                                    .background(Color(.systemGray6))
                                    .cornerRadius(12)
                                }
                                .padding(.horizontal)
                            }
                        }
                        
                        Spacer()
                        
                        // Benefits
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Image(systemName: "star.fill")
                                    .foregroundColor(.yellow)
                                Text("Why this helps:")
                                    .font(.headline)
                            }
                            
                            OnboardingBenefit(icon: "sparkles", text: "Better job recommendations")
                            OnboardingBenefit(icon: "bolt.fill", text: "Quick apply with saved info")
                            OnboardingBenefit(icon: "shield.fill", text: "Your data stays private")
                        }
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)
                        .padding(.horizontal)
                    }
                }
                
                // Bottom Buttons
                VStack(spacing: 12) {
                    Button(action: {
                        // Save data and continue
                        saveOnboardingData()
                        dismiss()
                    }) {
                        Text("Continue")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color(red: 0.04, green: 0.4, blue: 0.76))
                            .foregroundColor(.white)
                            .cornerRadius(12)
                    }
                    .padding(.horizontal)
                    
                    Button(action: {
                        // Skip onboarding
                        dismiss()
                    }) {
                        Text("Skip for now")
                            .foregroundColor(.secondary)
                    }
                    .padding(.bottom)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        dismiss()
                    }) {
                        Image(systemName: "xmark")
                            .foregroundColor(.primary)
                    }
                }
            }
            .sheet(isPresented: $showDocumentPicker) {
                DocumentPicker(selectedURL: $selectedResumeURL, fileName: $resumeFileName)
            }
        }
    }
    
    private func saveOnboardingData() {
        print("🔵 Saving onboarding data...")
        
        // Save LinkedIn connection status
        if linkedInManager.isLinkedInConnected {
            print("✅ LinkedIn profile saved locally")
            // Already saved to Firebase in the connection callback
        }
        
        // Save resume
        if let resumeURL = selectedResumeURL, let fileName = resumeFileName {
            print("✅ Resume saved: \(fileName)")
            // TODO: Upload resume to Firebase Storage/Supabase
        }
        
        // Mark onboarding as completed
        UserDefaults.standard.set(true, forKey: "hasCompletedOnboarding")
        print("✅ Onboarding marked as completed")
    }
}

struct OnboardingBenefit: View {
    let icon: String
    let text: String
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundColor(Color(red: 0.04, green: 0.4, blue: 0.76))
                .frame(width: 24)
            
            Text(text)
                .font(.subheadline)
            
            Spacer()
        }
    }
}

// Document Picker
struct DocumentPicker: UIViewControllerRepresentable {
    @Binding var selectedURL: URL?
    @Binding var fileName: String?
    @Environment(\.dismiss) private var dismiss
    
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.pdf, .plainText, .data], asCopy: true)
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = false
        return picker
    }
    
    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let parent: DocumentPicker
        
        init(_ parent: DocumentPicker) {
            self.parent = parent
        }
        
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            parent.selectedURL = url
            parent.fileName = url.lastPathComponent
            print("✅ Selected file: \(url.lastPathComponent)")
            parent.dismiss()
        }
    }
}

#Preview {
    OnboardingView(linkedInManager: LinkedInManager())
        .environmentObject(AuthViewModel())
}
