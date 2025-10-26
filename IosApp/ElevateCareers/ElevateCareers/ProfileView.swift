//
//  ProfileView.swift
//  ElevateCareers
//
//  User profile management with resume upload and LinkedIn import
//  Fixed for iOS 15+
//

import SwiftUI
import UniformTypeIdentifiers

struct ProfileView: View {
    @StateObject private var viewModel = ProfileViewModel()
    
    // State for document picker
    @State private var showDocumentPicker = false
    @State private var selectedResumeURL: URL?
    @State private var resumeFileName: String?
    
    // State for other sheets
    @State private var showingEditProfile = false
    @State private var showingLinkedInImport = false
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // Profile Header
                    if let profile = viewModel.profile {
                        ProfileHeaderView(profile: profile)
                    }
                    
                    // Resume Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Resume")
                            .font(.headline)
                        
                        if viewModel.hasResume {
                            // Show existing resume
                            ResumeCardView(
                                resume: viewModel.profile?.resume?.first,
                                onView: { viewModel.viewResume() },
                                onDelete: {
                                    Task {
                                        await viewModel.deleteResume()
                                    }
                                }
                            )
                        } else {
                            // Upload resume button
                            Button(action: {
                                showDocumentPicker = true
                            }) {
                                HStack {
                                    Image(systemName: "doc.badge.plus")
                                    Text("Upload Resume")
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                }
                                .padding()
                                .background(Color(.systemGray6))
                                .cornerRadius(12)
                            }
                        }
                    }
                    .padding(.horizontal)
                    
                    // Action Buttons
                    VStack(spacing: 12) {
                        Button(action: {
                            showingEditProfile = true
                        }) {
                            HStack {
                                Image(systemName: "pencil")
                                Text("Edit Profile")
                                Spacer()
                                Image(systemName: "chevron.right")
                            }
                            .padding()
                            .background(Color(.systemGray6))
                            .cornerRadius(12)
                        }
                        
                        Button(action: {
                            showingLinkedInImport = true
                        }) {
                            HStack {
                                Image(systemName: "person.crop.circle.badge.plus")
                                Text("Import from LinkedIn")
                                Spacer()
                                Image(systemName: "chevron.right")
                            }
                            .padding()
                            .background(Color(.systemGray6))
                            .cornerRadius(12)
                        }
                    }
                    .padding(.horizontal)
                }
            }
            .navigationTitle("Profile")
            .task {
                await viewModel.loadProfile()
            }
            // MARK: - Document Picker Sheet
            .sheet(isPresented: $showDocumentPicker) {
                DocumentPicker(
                    selectedURL: $selectedResumeURL,
                    fileName: $resumeFileName
                )
            }
            // MARK: - Handle Resume Upload (iOS 15+ compatible)
            .onChange(of: selectedResumeURL) { newValue in
                if let url = newValue {
                    Task {
                        await viewModel.uploadResume(url: url)
                        // Reset after upload
                        selectedResumeURL = nil
                        resumeFileName = nil
                    }
                }
            }
            // MARK: - Other Sheets
            .sheet(isPresented: $showingEditProfile) {
                EditProfileView(viewModel: viewModel)
            }
            .sheet(isPresented: $showingLinkedInImport) {
                LinkedInImportView(viewModel: viewModel)
            }
            // MARK: - Loading Overlay
            .overlay {
                if viewModel.isLoading {
                    ZStack {
                        Color.black.opacity(0.3)
                            .ignoresSafeArea()
                        
                        VStack(spacing: 16) {
                            ProgressView()
                                .scaleEffect(1.5)
                                .tint(.white)
                            
                            if viewModel.uploadProgress > 0 && viewModel.uploadProgress < 1 {
                                Text("\(Int(viewModel.uploadProgress * 100))%")
                                    .foregroundColor(.white)
                                    .font(.headline)
                            }
                        }
                    }
                }
            }
            // MARK: - Alerts
            .alert(isPresented: $viewModel.showError) {
                Alert(
                    title: Text(viewModel.errorMessage?.contains("successfully") == true ? "Success" : "Error"),
                    message: Text(viewModel.errorMessage ?? "An error occurred"),
                    dismissButton: .default(Text("OK"))
                )
            }
        }
    }
}

// MARK: - Supporting Views

struct ProfileHeaderView: View {
    let profile: UserProfile
    
    var body: some View {
        VStack(spacing: 12) {
            // Profile Picture
            Circle()
                .fill(Color.blue.opacity(0.2))
                .frame(width: 80, height: 80)
                .overlay(
                    Image(systemName: "person.fill")
                        .font(.system(size: 40))
                        .foregroundColor(.blue)
                )
            
            // Name
            Text(profile.fullName ?? "No Name")
                .font(.title2)
                .fontWeight(.bold)
            
            // Headline
            if let headline = profile.headline {
                Text(headline)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            
            // Completeness
            if let completeness = profile.profileCompleteness {
                HStack(spacing: 8) {
                    ProgressView(value: Double(completeness), total: 100)
                        .frame(width: 150)
                    Text("\(completeness)%")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
    }
}

struct ResumeCardView: View {
    let resume: Resume?
    let onView: () -> Void
    let onDelete: () -> Void
    
    var body: some View {
        if let resume = resume {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(resume.fileName)
                        .font(.subheadline)
                        .fontWeight(.medium)
                    
                    // FIX: uploadedAt is String, not String?
                    Text("Uploaded \(formatDate(resume.uploadedAt))")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                // View button
                Button(action: onView) {
                    Image(systemName: "eye")
                        .foregroundColor(.blue)
                }
                .buttonStyle(.borderless)
                
                // Delete button
                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .foregroundColor(.red)
                }
                .buttonStyle(.borderless)
            }
            .padding()
            .background(Color.green.opacity(0.1))
            .cornerRadius(12)
        }
    }
    
    private func formatDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: dateString) {
            let displayFormatter = DateFormatter()
            displayFormatter.dateStyle = .medium
            return displayFormatter.string(from: date)
        }
        return dateString
    }
}
/*
struct SkillChip: View {
    let text: String
    
    var body: some View {
        Text(text)
            .font(.caption)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.blue.opacity(0.1))
            .foregroundColor(.blue)
            .cornerRadius(16)
    }
}

// MARK: - FlowLayout for skills

struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        
        var totalHeight: CGFloat = 0
        var totalWidth: CGFloat = 0
        
        var lineWidth: CGFloat = 0
        var lineHeight: CGFloat = 0
        
        for size in sizes {
            if lineWidth + size.width > proposal.width ?? 0 {
                totalHeight += lineHeight + spacing
                lineWidth = size.width
                lineHeight = size.height
            } else {
                lineWidth += size.width + spacing
                lineHeight = max(lineHeight, size.height)
            }
            totalWidth = max(totalWidth, lineWidth)
        }
        
        totalHeight += lineHeight
        
        return CGSize(width: totalWidth, height: totalHeight)
    }
    
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        
        var lineX = bounds.minX
        var lineY = bounds.minY
        var lineHeight: CGFloat = 0
        
        for index in subviews.indices {
            let size = sizes[index]
            
            if lineX + size.width > bounds.maxX {
                lineY += lineHeight + spacing
                lineHeight = 0
                lineX = bounds.minX
            }
            
            subviews[index].place(
                at: CGPoint(x: lineX, y: lineY),
                proposal: ProposedViewSize(size)
            )
            
            lineHeight = max(lineHeight, size.height)
            lineX += size.width + spacing
        }
    }
}*/

struct ActionButton: View {
    let icon: String
    let title: String
    let subtitle: String
    let color: Color
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundColor(.white)
                    .frame(width: 50, height: 50)
                    .background(color)
                    .cornerRadius(12)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(.primary)
                    
                    Text(subtitle)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(12)
        }
    }
}

// MARK: - Skills Section

struct SkillsSection: View {
    let skills: [String]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Skills")
                .font(.headline)
                .padding(.horizontal)
            
            FlowLayout(spacing: 8) {
                ForEach(skills, id: \.self) { skill in
                    SkillChip(text: skill)
                }
            }
            .padding(.horizontal)
        }
    }
}

// MARK: - Work Experience Section

struct WorkExperienceSection: View {
    let experiences: [WorkExperience]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Work Experience")
                .font(.headline)
                .padding(.horizontal)
            
            VStack(spacing: 16) {
                ForEach(experiences) { exp in
                    WorkExperienceCard(experience: exp)
                }
            }
            .padding(.horizontal)
        }
    }
}

struct WorkExperienceCard: View {
    let experience: WorkExperience
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(experience.jobTitle)
                .font(.subheadline)
                .fontWeight(.semibold)
            
            Text(experience.companyName)
                .font(.subheadline)
                .foregroundColor(.secondary)
            
            HStack {
                Text(experience.dateRange)
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                if experience.isCurrent {
                    Text("• Current")
                        .font(.caption)
                        .foregroundColor(.green)
                }
            }
            
            if let description = experience.description {
                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(3)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

// MARK: - Education Section

struct EducationSection: View {
    let education: [Education]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Education")
                .font(.headline)
                .padding(.horizontal)
            
            VStack(spacing: 16) {
                ForEach(education) { edu in
                    EducationCard(education: edu)
                }
            }
            .padding(.horizontal)
        }
    }
}

struct EducationCard: View {
    let education: Education
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(education.degree ?? "Degree")
                .font(.subheadline)
                .fontWeight(.semibold)
            
            Text(education.institution)
                .font(.subheadline)
                .foregroundColor(.secondary)
            
            if let fieldOfStudy = education.fieldOfStudy {
                Text(fieldOfStudy)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            if let year = education.endDate?.prefix(4) {
                Text("Class of \(year)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

// MARK: - Preferences Section

struct PreferencesSection: View {
    let profile: UserProfile
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Job Preferences")
                .font(.headline)
                .padding(.horizontal)
            
            VStack(spacing: 12) {
                if let roles = profile.desiredRoles, !roles.isEmpty {
                    PreferenceRow(
                        icon: "briefcase.fill",
                        title: "Desired Roles",
                        value: roles.joined(separator: ", ")
                    )
                }
                
                if let remotePreference = profile.remotePreference {
                    PreferenceRow(
                        icon: "location.fill",
                        title: "Remote Preference",
                        value: remotePreference.capitalized.replacingOccurrences(of: "_", with: " ")
                    )
                }
                
                if let salaryMin = profile.desiredSalaryMin {
                    PreferenceRow(
                        icon: "dollarsign.circle.fill",
                        title: "Minimum Salary",
                        value: "$\(salaryMin.formatted())"
                    )
                }
            }
            .padding(.horizontal)
        }
    }
}

struct PreferenceRow: View {
    let icon: String
    let title: String
    let value: String
    
    var body: some View {
        HStack {
            Image(systemName: icon)
                .foregroundColor(.blue)
                .frame(width: 30)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(value)
                    .font(.subheadline)
            }
            
            Spacer()
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        ProfileView()
            .environmentObject(AuthViewModel())
    }
}
