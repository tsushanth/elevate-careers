//
//  ProfileViewModel.swift
//  ElevateCareers
//
//  Handles profile management, resume upload to Supabase Storage
//

import Foundation
import SwiftUI
import UniformTypeIdentifiers

@MainActor
class ProfileViewModel: ObservableObject {
    @Published var profile: UserProfile?
    @Published var isLoading = false
    @Published var showError = false
    @Published var errorMessage: String?
    @Published var uploadProgress: Double = 0.0
    
    private let apiService = ApiService()
    private let supabase = SupabaseService.shared
    
    var hasResume: Bool {
        profile?.resume?.first != nil
    }
    
    // MARK: - Load Profile
    
    func loadProfile() async {
        isLoading = true
        defer { isLoading = false }
        
        do {
            // Get profile from backend (which queries Supabase)
            profile = try await apiService.getProfile()
        } catch {
            errorMessage = "Failed to load profile: \(error.localizedDescription)"
            showError = true
        }
    }
    
    // MARK: - Upload Resume (Direct to Supabase Storage)
    
    func uploadResume(url: URL) async {
        isLoading = true
        uploadProgress = 0.0
        defer {
            isLoading = false
            uploadProgress = 0.0
        }
        
        do {
            // 1. Get current user
            guard let userId = supabase.currentUser?.id.uuidString else {
                throw NSError(domain: "ProfileViewModel", code: 401, userInfo: [NSLocalizedDescriptionKey: "Not authenticated"])
            }
            
            // 2. Read file data
            guard url.startAccessingSecurityScopedResource() else {
                throw NSError(domain: "ProfileViewModel", code: 403, userInfo: [NSLocalizedDescriptionKey: "Cannot access file"])
            }
            defer { url.stopAccessingSecurityScopedResource() }
            
            let data = try Data(contentsOf: url)
            let fileName = url.lastPathComponent
            
            uploadProgress = 0.3
            
            // 3. Upload to Supabase Storage
            let storagePath = try await supabase.uploadResume(
                data: data,
                fileName: fileName,
                userId: userId
            )
            
            uploadProgress = 0.6
            
            // 4. Tell backend to parse the resume
            let result = try await apiService.parseResume(
                storagePath: storagePath,
                fileName: fileName,
                fileSize: data.count
            )
            
            uploadProgress = 0.9
            
            // 5. Reload profile to get updated info
            await loadProfile()
            
            uploadProgress = 1.0
            
            // 6. Show success message
            errorMessage = "Resume uploaded successfully! Found \(result.skillsCount) skills and \(result.experienceCount) work experiences."
            showError = true
            
        } catch {
            errorMessage = "Failed to upload resume: \(error.localizedDescription)"
            showError = true
        }
    }
    
    // MARK: - View Resume
    
    func viewResume() {
        guard let resume = profile?.resume?.first else { return }
        
        Task {
            do {
                // Get signed URL from Supabase Storage
                let url = try await supabase.getResumeURL(path: resume.filePath)
                
                await MainActor.run {
                    UIApplication.shared.open(url)
                }
            } catch {
                errorMessage = "Failed to open resume: \(error.localizedDescription)"
                showError = true
            }
        }
    }
    
    // MARK: - Download Resume
    
    func downloadResume() async -> Data? {
        guard let resume = profile?.resume?.first else { return nil }
        
        do {
            let data = try await supabase.downloadResume(path: resume.filePath)
            return data
        } catch {
            errorMessage = "Failed to download resume: \(error.localizedDescription)"
            showError = true
            return nil
        }
    }
    
    // MARK: - Delete Resume
    
    func deleteResume() async {
        guard let resume = profile?.resume?.first else { return }
        
        isLoading = true
        defer { isLoading = false }
        
        do {
            // Delete from Supabase Storage
            try await supabase.deleteResume(path: resume.filePath)
            
            // Delete from database
            try await apiService.deleteResume(resumeId: resume.id)
            
            // Reload profile
            await loadProfile()
            
            errorMessage = "Resume deleted successfully"
            showError = true
        } catch {
            errorMessage = "Failed to delete resume: \(error.localizedDescription)"
            showError = true
        }
    }
    
    // MARK: - Update Profile
    
    func updateProfile(_ updates: [String: Any]) async {
        isLoading = true
        defer { isLoading = false }
        
        do {
            guard let userId = supabase.currentUser?.id.uuidString else {
                throw NSError(domain: "ProfileViewModel", code: 401, userInfo: [NSLocalizedDescriptionKey: "Not authenticated"])
            }
            
            // Update via Supabase directly
            let updatedProfile = try await supabase.updateProfile(userId: userId, updates: updates)
            profile = updatedProfile
        } catch {
            errorMessage = "Failed to update profile: \(error.localizedDescription)"
            showError = true
        }
    }
    
    // MARK: - LinkedIn Import
    
    func importFromLinkedIn(linkedInData: [String: Any]) async {
        isLoading = true
        defer { isLoading = false }
        
        do {
            let updatedProfile = try await apiService.importLinkedIn(data: linkedInData)
            profile = updatedProfile
            
            errorMessage = "LinkedIn profile imported successfully!"
            showError = true
        } catch {
            errorMessage = "Failed to import LinkedIn profile: \(error.localizedDescription)"
            showError = true
        }
    }
}

// MARK: - Models

struct UserProfile: Codable, Identifiable {
    let id: String
    let userId: String
    let fullName: String?
    let email: String?
    let phone: String?
    let locationCity: String?
    let locationCountry: String?
    let linkedinUrl: String?
    let portfolioUrl: String?
    let githubUrl: String?
    let headline: String?
    let summary: String?
    let yearsOfExperience: Int?
    let desiredRoles: [String]?
    let desiredLocations: [String]?
    let remotePreference: String?
    let desiredEmploymentTypes: [String]?
    let desiredSalaryMin: Int?
    let desiredSalaryMax: Int?
    let desiredSalaryCurrency: String?
    let skills: [String]?
    let workAuthorization: [String]?
    let requiresSponsorship: Bool?
    let profileCompleteness: Int?
    let profileSource: String?
    let workExperience: [WorkExperience]?
    let education: [Education]?
    let resume: [Resume]?
    
    enum CodingKeys: String, CodingKey {
        case id, email, phone, headline, summary, skills
        case userId = "user_id"
        case fullName = "full_name"
        case locationCity = "location_city"
        case locationCountry = "location_country"
        case linkedinUrl = "linkedin_url"
        case portfolioUrl = "portfolio_url"
        case githubUrl = "github_url"
        case yearsOfExperience = "years_of_experience"
        case desiredRoles = "desired_roles"
        case desiredLocations = "desired_locations"
        case remotePreference = "remote_preference"
        case desiredEmploymentTypes = "desired_employment_types"
        case desiredSalaryMin = "desired_salary_min"
        case desiredSalaryMax = "desired_salary_max"
        case desiredSalaryCurrency = "desired_salary_currency"
        case workAuthorization = "work_authorization"
        case requiresSponsorship = "requires_sponsorship"
        case profileCompleteness = "profile_completeness"
        case profileSource = "profile_source"
        case workExperience = "work_experience"
        case education
        case resume
    }
}

struct WorkExperience: Codable, Identifiable {
    let id: String
    let userId: String
    let companyName: String
    let jobTitle: String
    let location: String?
    let startDate: String
    let endDate: String?
    let isCurrent: Bool
    let description: String?
    let achievements: [String]?
    let skillsUsed: [String]?
    
    var dateRange: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        
        guard let start = formatter.date(from: startDate) else { return startDate }
        
        formatter.dateFormat = "MMM yyyy"
        let startStr = formatter.string(from: start)
        
        if isCurrent {
            return "\(startStr) - Present"
        }
        
        guard let endDate = endDate,
              let end = formatter.date(from: endDate) else {
            return startStr
        }
        
        let endStr = formatter.string(from: end)
        return "\(startStr) - \(endStr)"
    }
    
    enum CodingKeys: String, CodingKey {
        case id, location, description, achievements
        case userId = "user_id"
        case companyName = "company_name"
        case jobTitle = "job_title"
        case startDate = "start_date"
        case endDate = "end_date"
        case isCurrent = "is_current"
        case skillsUsed = "skills_used"
    }
}

struct Education: Codable, Identifiable {
    let id: String
    let userId: String
    let institution: String
    let degree: String?
    let fieldOfStudy: String?
    let startDate: String?
    let endDate: String?
    let gpa: Double?
    
    enum CodingKeys: String, CodingKey {
        case id, institution, degree, gpa
        case userId = "user_id"
        case fieldOfStudy = "field_of_study"
        case startDate = "start_date"
        case endDate = "end_date"
    }
}

struct Resume: Codable, Identifiable {
    let id: String
    let userId: String
    let fileName: String
    let filePath: String
    let fileSize: Int?
    let fileType: String?
    let uploadedAt: String
    let isPrimary: Bool
    
    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case fileName = "file_name"
        case filePath = "file_path"
        case fileSize = "file_size"
        case fileType = "file_type"
        case uploadedAt = "uploaded_at"
        case isPrimary = "is_primary"
    }
}

struct ParseResumeResponse: Codable {
    let success: Bool
    let skillsCount: Int
    let experienceCount: Int
    let educationCount: Int
    
    enum CodingKeys: String, CodingKey {
        case success
        case skillsCount = "skills_count"
        case experienceCount = "experience_count"
        case educationCount = "education_count"
    }
}

// MARK: - API Service Extension

extension ApiService {
    func getProfile() async throws -> UserProfile? {
        let url = URL(string: "\(baseURL)/api/profile")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(getAuthToken())", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to fetch profile")
        }
        
        struct ProfileResponse: Codable {
            let profile: UserProfile?
        }
        
        let result = try JSONDecoder().decode(ProfileResponse.self, from: data)
        return result.profile
    }
    
    func parseResume(storagePath: String, fileName: String, fileSize: Int) async throws -> ParseResumeResponse {
        let url = URL(string: "\(baseURL)/api/profile/resume/parse")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(getAuthToken())", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "storage_path": storagePath,
            "file_name": fileName,
            "file_size": fileSize
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to parse resume")
        }
        
        return try JSONDecoder().decode(ParseResumeResponse.self, from: data)
    }
    
    func deleteResume(resumeId: String) async throws {
        let url = URL(string: "\(baseURL)/api/profile/resume/\(resumeId)")!
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(getAuthToken())", forHTTPHeaderField: "Authorization")
        
        let (_, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to delete resume")
        }
    }
    
    func importLinkedIn(data: [String: Any]) async throws -> UserProfile {
        let url = URL(string: "\(baseURL)/api/profile/linkedin")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(getAuthToken())", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body = ["linkedinData": data]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (responseData, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to import LinkedIn")
        }
        
        struct LinkedInResponse: Codable {
            let success: Bool
            let profile: UserProfile
        }
        
        let result = try JSONDecoder().decode(LinkedInResponse.self, from: responseData)
        return result.profile
    }
    
    private func getAuthToken() -> String {
        // Get from Supabase
        return SupabaseService.shared.currentSession?.accessToken ?? ""
    }
}

// MARK: - Document Picker

import UIKit

struct DocumentPicker: UIViewControllerRepresentable {
    let viewModel: ProfileViewModel
    
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let supportedTypes: [UTType] = [.pdf]
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: supportedTypes)
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = false
        return picker
    }
    
    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel)
    }
    
    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let viewModel: ProfileViewModel
        
        init(viewModel: ProfileViewModel) {
            self.viewModel = viewModel
        }
        
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            
            Task {
                await viewModel.uploadResume(url: url)
            }
        }
    }
}
