//
//  ProfileView.swift
//  ElevateCareers
//
//  User profile management with resume upload and LinkedIn import
//

import SwiftUI
import UniformTypeIdentifiers

struct ProfileView: View {
    @StateObject private var viewModel = ProfileViewModel()
    @EnvironmentObject var authViewModel: AuthViewModel
    @State private var showingDocumentPicker = false
    @State private var showingLinkedInImport = false
    @State private var showingEditProfile = false
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Profile Header
                    ProfileHeaderView(profile: viewModel.profile)
                    
                    // Profile Completeness
                    if let completeness = viewModel.profile?.profileCompleteness {
                        ProfileCompletenessCard(completeness: completeness)
                    }
                    
                    // Resume Section
                    ResumeSection(
                        hasResume: viewModel.hasResume,
                        resumeFileName: viewModel.profile?.resume?.first?.fileName,
                        onUpload: { showingDocumentPicker = true },
                        onView: { viewModel.viewResume() }
                    )
                    
                    // Quick Actions
                    QuickActionsSection(
                        onEditProfile: { showingEditProfile = true },
                        onLinkedInImport: { showingLinkedInImport = true }
                    )
                    
                    // Profile Sections
                    if let profile = viewModel.profile {
                        // Skills
                        if let skills = profile.skills, !skills.isEmpty {
                            SkillsSection(skills: skills)
                        }
                        
                        // Work Experience
                        if let experience = profile.workExperience, !experience.isEmpty {
                            WorkExperienceSection(experiences: experience)
                        }
                        
                        // Education
                        if let education = profile.education, !education.isEmpty {
                            EducationSection(education: education)
                        }
                        
                        // Job Preferences
                        PreferencesSection(profile: profile)
                    }
                    
                    // Sign Out
                    Button(action: {
                        authViewModel.signOut()
                    }) {
                        Text("Sign Out")
                            .foregroundColor(.red)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.red.opacity(0.1))
                            .cornerRadius(12)
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical)
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.large)
            .sheet(isPresented: $showingDocumentPicker) {
                DocumentPicker(viewModel: viewModel)
            }
            .sheet(isPresented: $showingLinkedInImport) {
                LinkedInImportView(viewModel: viewModel)
            }
            .sheet(isPresented: $showingEditProfile) {
                EditProfileView(viewModel: viewModel)
            }
            .task {
                await viewModel.loadProfile()
            }
            .refreshable {
                await viewModel.loadProfile()
            }
            .overlay {
                if viewModel.isLoading {
                    ProgressView()
                        .scaleEffect(1.5)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.black.opacity(0.3))
                }
            }
            .alert("Error", isPresented: $viewModel.showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(viewModel.errorMessage ?? "An error occurred")
            }
        }
    }
}

// MARK: - Profile Header

struct ProfileHeaderView: View {
    let profile: UserProfile?
    
    var body: some View {
        VStack(spacing: 12) {
            // Avatar
            Circle()
                .fill(LinearGradient(colors: [.blue, .purple], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 100, height: 100)
                .overlay {
                    if let name = profile?.fullName {
                        Text(name.prefix(1).uppercased())
                            .font(.system(size: 40, weight: .semibold))
                            .foregroundColor(.white)
                    } else {
                        Image(systemName: "person.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.white)
                    }
                }
            
            VStack(spacing: 4) {
                Text(profile?.fullName ?? "Complete Your Profile")
                    .font(.title2)
                    .fontWeight(.bold)
                
                if let headline = profile?.headline {
                    Text(headline)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                
                if let location = profile?.locationCity {
                    HStack(spacing: 4) {
                        Image(systemName: "mappin.circle.fill")
                            .font(.caption)
                        Text(location)
                            .font(.caption)
                    }
                    .foregroundColor(.secondary)
                }
            }
        }
        .padding()
    }
}

// MARK: - Profile Completeness

struct ProfileCompletenessCard: View {
    let completeness: Int
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Profile Strength")
                        .font(.headline)
                    Text("\(completeness)% Complete")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                ZStack {
                    Circle()
                        .stroke(Color.gray.opacity(0.2), lineWidth: 8)
                        .frame(width: 60, height: 60)
                    
                    Circle()
                        .trim(from: 0, to: CGFloat(completeness) / 100)
                        .stroke(completenessColor, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: 60, height: 60)
                        .rotationEffect(.degrees(-90))
                    
                    Text("\(completeness)%")
                        .font(.caption)
                        .fontWeight(.semibold)
                }
            }
            
            if completeness < 100 {
                Text("Complete your profile to get better job matches!")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
        .padding(.horizontal)
    }
    
    var completenessColor: Color {
        if completeness >= 80 { return .green }
        if completeness >= 50 { return .orange }
        return .red
    }
}

// MARK: - Resume Section

struct ResumeSection: View {
    let hasResume: Bool
    let resumeFileName: String?
    let onUpload: () -> Void
    let onView: () -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Resume")
                .font(.headline)
                .padding(.horizontal)
            
            if hasResume {
                Button(action: onView) {
                    HStack {
                        Image(systemName: "doc.text.fill")
                            .foregroundColor(.blue)
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text(resumeFileName ?? "Resume.pdf")
                                .font(.subheadline)
                                .foregroundColor(.primary)
                            Text("Tap to view")
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
                .padding(.horizontal)
                
                Button(action: onUpload) {
                    HStack {
                        Image(systemName: "arrow.triangle.2.circlepath")
                        Text("Upload New Resume")
                    }
                    .font(.subheadline)
                    .foregroundColor(.blue)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue.opacity(0.1))
                    .cornerRadius(12)
                }
                .padding(.horizontal)
            } else {
                Button(action: onUpload) {
                    VStack(spacing: 12) {
                        Image(systemName: "arrow.up.doc.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.blue)
                        
                        Text("Upload Resume")
                            .font(.headline)
                        
                        Text("Get better job matches with your resume")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 32)
                    .background(Color.blue.opacity(0.05))
                    .cornerRadius(12)
                }
                .padding(.horizontal)
            }
        }
    }
}

// MARK: - Quick Actions

struct QuickActionsSection: View {
    let onEditProfile: () -> Void
    let onLinkedInImport: () -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Quick Actions")
                .font(.headline)
                .padding(.horizontal)
            
            VStack(spacing: 12) {
                ActionButton(
                    icon: "person.fill",
                    title: "Edit Profile",
                    subtitle: "Update your information",
                    color: .blue,
                    action: onEditProfile
                )
                
                ActionButton(
                    icon: "link",
                    title: "Import from LinkedIn",
                    subtitle: "Auto-fill from LinkedIn profile",
                    color: .blue,
                    action: onLinkedInImport
                )
            }
            .padding(.horizontal)
        }
    }
}

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