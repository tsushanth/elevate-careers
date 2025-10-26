//
//  EditProfileView.swift
//  ElevateCareers
//
//  Edit user profile manually
//

import SwiftUI

struct EditProfileView: View {
    @ObservedObject var viewModel: ProfileViewModel
    @Environment(\.dismiss) private var dismiss
    
    // Form fields
    @State private var fullName: String = ""
    @State private var email: String = ""
    @State private var phone: String = ""
    @State private var locationCity: String = ""
    @State private var locationCountry: String = ""
    @State private var headline: String = ""
    @State private var summary: String = ""
    @State private var yearsOfExperience: String = ""
    @State private var linkedinUrl: String = ""
    @State private var portfolioUrl: String = ""
    @State private var githubUrl: String = ""
    
    // Job preferences
    @State private var desiredRoles: String = ""
    @State private var desiredLocations: String = ""
    @State private var remotePreference: String = "flexible"
    @State private var desiredEmploymentTypes: Set<String> = []
    @State private var desiredSalaryMin: String = ""
    @State private var desiredSalaryCurrency: String = "USD"
    
    // Skills
    @State private var skillsText: String = ""
    
    let remotePreferences = ["remote_only", "hybrid", "onsite", "flexible"]
    let employmentTypes = ["full_time", "part_time", "contract", "internship"]
    let currencies = ["USD", "EUR", "GBP", "INR", "AUD", "CAD"]
    
    var body: some View {
        NavigationStack {
            Form {
                // Basic Info Section
                Section("Basic Information") {
                    TextField("Full Name", text: $fullName)
                    TextField("Email", text: $email)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                    TextField("Phone", text: $phone)
                        .keyboardType(.phonePad)
                    TextField("City", text: $locationCity)
                    TextField("Country", text: $locationCountry)
                }
                
                // Professional Info Section
                Section("Professional Information") {
                    TextField("Headline", text: $headline)
                        .placeholder(when: headline.isEmpty) {
                            Text("e.g., Senior Software Engineer")
                                .foregroundColor(.secondary)
                        }
                    
                    TextField("Years of Experience", text: $yearsOfExperience)
                        .keyboardType(.numberPad)
                    
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Summary")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        
                        TextEditor(text: $summary)
                            .frame(minHeight: 100)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color(.systemGray4), lineWidth: 1)
                            )
                    }
                }
                
                // Links Section
                Section("Links") {
                    TextField("LinkedIn URL", text: $linkedinUrl)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    TextField("Portfolio URL", text: $portfolioUrl)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    TextField("GitHub URL", text: $githubUrl)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                }
                
                // Skills Section
                Section("Skills") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Enter skills separated by commas")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        TextEditor(text: $skillsText)
                            .frame(minHeight: 80)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color(.systemGray4), lineWidth: 1)
                            )
                    }
                }
                
                // Job Preferences Section
                Section("Job Preferences") {
                    TextField("Desired Roles (comma separated)", text: $desiredRoles)
                        .placeholder(when: desiredRoles.isEmpty) {
                            Text("e.g., Software Engineer, Product Manager")
                                .foregroundColor(.secondary)
                        }
                    
                    TextField("Desired Locations (comma separated)", text: $desiredLocations)
                        .placeholder(when: desiredLocations.isEmpty) {
                            Text("e.g., San Francisco, New York, Remote")
                                .foregroundColor(.secondary)
                        }
                    
                    Picker("Remote Preference", selection: $remotePreference) {
                        Text("Remote Only").tag("remote_only")
                        Text("Hybrid").tag("hybrid")
                        Text("On-site").tag("onsite")
                        Text("Flexible").tag("flexible")
                    }
                    
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Employment Types")
                            .font(.subheadline)
                        
                        ForEach(employmentTypes, id: \.self) { type in
                            Toggle(isOn: Binding(
                                get: { desiredEmploymentTypes.contains(type) },
                                set: { isOn in
                                    if isOn {
                                        desiredEmploymentTypes.insert(type)
                                    } else {
                                        desiredEmploymentTypes.remove(type)
                                    }
                                }
                            )) {
                                Text(type.replacingOccurrences(of: "_", with: " ").capitalized)
                            }
                        }
                    }
                }
                
                // Salary Section
                Section("Salary Expectations") {
                    HStack {
                        TextField("Minimum Salary", text: $desiredSalaryMin)
                            .keyboardType(.numberPad)
                        
                        Picker("Currency", selection: $desiredSalaryCurrency) {
                            ForEach(currencies, id: \.self) { currency in
                                Text(currency).tag(currency)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }
            }
            .navigationTitle("Edit Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        saveProfile()
                    }
                    .fontWeight(.semibold)
                }
            }
            .onAppear {
                loadCurrentProfile()
            }
            .overlay {
                if viewModel.isLoading {
                    ProgressView()
                        .scaleEffect(1.5)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.black.opacity(0.3))
                }
            }
        }
    }
    
    private func loadCurrentProfile() {
        guard let profile = viewModel.profile else { return }
        
        fullName = profile.fullName ?? ""
        email = profile.email ?? ""
        phone = profile.phone ?? ""
        locationCity = profile.locationCity ?? ""
        locationCountry = profile.locationCountry ?? ""
        headline = profile.headline ?? ""
        summary = profile.summary ?? ""
        yearsOfExperience = profile.yearsOfExperience.map(String.init) ?? ""
        linkedinUrl = profile.linkedinUrl ?? ""
        portfolioUrl = profile.portfolioUrl ?? ""
        githubUrl = profile.githubUrl ?? ""
        
        // Skills
        skillsText = profile.skills?.joined(separator: ", ") ?? ""
        
        // Job preferences
        desiredRoles = profile.desiredRoles?.joined(separator: ", ") ?? ""
        desiredLocations = profile.desiredLocations?.joined(separator: ", ") ?? ""
        remotePreference = profile.remotePreference ?? "flexible"
        desiredEmploymentTypes = Set(profile.desiredEmploymentTypes ?? [])
        desiredSalaryMin = profile.desiredSalaryMin.map(String.init) ?? ""
        desiredSalaryCurrency = profile.desiredSalaryCurrency ?? "USD"
    }
    
    private func saveProfile() {
        var updates: [String: Any] = [:]
        
        // Basic info
        if !fullName.isEmpty { updates["full_name"] = fullName }
        if !email.isEmpty { updates["email"] = email }
        if !phone.isEmpty { updates["phone"] = phone }
        if !locationCity.isEmpty { updates["location_city"] = locationCity }
        if !locationCountry.isEmpty { updates["location_country"] = locationCountry }
        if !headline.isEmpty { updates["headline"] = headline }
        if !summary.isEmpty { updates["summary"] = summary }
        if !yearsOfExperience.isEmpty, let years = Int(yearsOfExperience) {
            updates["years_of_experience"] = years
        }
        
        // Links
        if !linkedinUrl.isEmpty { updates["linkedin_url"] = linkedinUrl }
        if !portfolioUrl.isEmpty { updates["portfolio_url"] = portfolioUrl }
        if !githubUrl.isEmpty { updates["github_url"] = githubUrl }
        
        // Skills
        if !skillsText.isEmpty {
            let skills = skillsText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            updates["skills"] = skills
        }
        
        // Job preferences
        if !desiredRoles.isEmpty {
            let roles = desiredRoles.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            updates["desired_roles"] = roles
        }
        if !desiredLocations.isEmpty {
            let locations = desiredLocations.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            updates["desired_locations"] = locations
        }
        updates["remote_preference"] = remotePreference
        updates["desired_employment_types"] = Array(desiredEmploymentTypes)
        
        // Salary
        if !desiredSalaryMin.isEmpty, let salary = Int(desiredSalaryMin) {
            updates["desired_salary_min"] = salary
        }
        updates["desired_salary_currency"] = desiredSalaryCurrency
        
        Task {
            await viewModel.updateProfile(updates)
            dismiss()
        }
    }
}

// Helper extension for placeholder text
extension View {
    func placeholder<Content: View>(
        when shouldShow: Bool,
        alignment: Alignment = .leading,
        @ViewBuilder placeholder: () -> Content) -> some View {
        
        ZStack(alignment: alignment) {
            placeholder().opacity(shouldShow ? 1 : 0)
            self
        }
    }
}

#Preview {
    EditProfileView(viewModel: ProfileViewModel())
}
