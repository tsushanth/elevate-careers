//
//  ProfileViewModel.swift
//  ElevateCareers
//
//  Handles profile management, resume upload, and LinkedIn import
//

import Foundation
import SwiftUI

@MainActor
class ProfileViewModel: ObservableObject {
    @Published var profile: UserProfile?
    @Published var isLoading = false
    @Published var showError = false
    @Published var errorMessage: String?
    
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
            let data = try await apiService.getProfile()
            profile = data.profile
        } catch {
            errorMessage = "Failed to load profile: \(error.localizedDescription)"
            showError = true
        }
    }
    
    // MARK: - Upload Resume
    
    func uploadResume(url: URL) async {
        isLoading = true
        defer { isLoading = false }
        
        do {
            // Read file data
            let data = try Data(contentsOf: url)
            
            // Upload to backend
            let result = try await apiService.uploadResume(data: data, fileName: url.lastPathComponent)
            
            // Reload profile to get updated info
            await loadProfile()
            
            // Show success message
            errorMessage = "Resume uploaded successfully! Profile updated with \(result.profile.skills.count) skills."
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
                let url = try await supabase.getResumeURL(path: resume.filePath)
                await MainActor.run {
                    UIApplication.shared.open(url)
                }
            } catch {
                errorMessage = "Failed to open resume"
                showError = true
            }
        }
    }
    
    // MARK: - Update Profile
    
    func updateProfile(_ updates: [String: Any]) async {
        isLoading = true
        defer { isLoading = false }
        
        do {
            let updatedProfile = try await apiService.updateProfile(updates)
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

struct UploadResumeResponse: Codable {
    let success: Bool
    let resume: ResumeInfo
    let profile: ProfileInfo
    
    struct ResumeInfo: Codable {
        let id: String
        let fileName: String
        let uploadedAt: String
        
        enum CodingKeys: String, CodingKey {
            case id
            case fileName = "fileName"
            case uploadedAt = "uploadedAt"
        }
    }
    
    struct ProfileInfo: Codable {
        let skills: [String]
        let experience: Int
        let education: Int
    }
}

// MARK: - API Service Extension

extension ApiService {
    func getProfile() async throws -> (profile: UserProfile?) {
        let url = URL(string: "\(baseURL)/api/profile")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(getAuthToken())", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to fetch profile")
        }
        
        let result = try JSONDecoder().decode([String: UserProfile?].self, from: data)
        return (profile: result["profile"] ?? nil)
    }
    
    func uploadResume(data: Data, fileName: String) async throws -> UploadResumeResponse {
        let url = URL(string: "\(baseURL)/api/profile/resume")!
        
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(getAuthToken())", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"resume\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        
        request.httpBody = body
        
        let (responseData, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to upload resume")
        }
        
        return try JSONDecoder().decode(UploadResumeResponse.self, from: responseData)
    }
    
    func updateProfile(_ updates: [String: Any]) async throws -> UserProfile {
        let url = URL(string: "\(baseURL)/api/profile")!
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(getAuthToken())", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        request.httpBody = try JSONSerialization.data(withJSONObject: updates)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to update profile")
        }
        
        let result = try JSONDecoder().decode([String: UserProfile].self, from: data)
        return result["profile"]!
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
        
        let result = try JSONDecoder().decode([String: UserProfile].self, from: responseData)
        return result["profile"]!
    }
    
    private func getAuthToken() -> String {
        // Get from Supabase or your auth system
        return SupabaseService.shared.currentSession?.accessToken ?? ""
    }
}

// MARK: - Document Picker

import UIKit

struct DocumentPicker: UIViewControllerRepresentable {
    let viewModel: ProfileViewModel
    
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.pdf, .doc, .docx])
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

// MARK: - UTType Extensions

extension UTType {
    static var doc: UTType {
        UTType(filenameExtension: "doc")!
    }
    
    static var docx: UTType {
        UTType(filenameExtension: "docx")!
    }
}