//
//  SupabaseService.swift
//  ElevateCareers
//
//  Supabase client for authentication and storage
//

import Foundation
import Supabase

class SupabaseService {
    static let shared = SupabaseService()
    
    let client: SupabaseClient
    
    private init() {
        guard let supabaseURLString = Configuration.supabaseURL,
              let supabaseURL = URL(string: supabaseURLString),
              let supabaseKey = Configuration.supabaseAnonKey else {
            fatalError("Missing Supabase configuration. Add SUPABASE_URL and SUPABASE_ANON_KEY to Info.plist")
        }
        
        client = SupabaseClient(
            supabaseURL: supabaseURL,
            supabaseKey: supabaseKey
        )
    }
    
    // MARK: - Authentication
    
    var currentSession: Session? {
        get async {
            return try? await client.auth.session
        }
    }
    
    var currentUser: User? {
        get async {
            return try? await client.auth.session.user
        }
    }
    
    func signUp(email: String, password: String) async throws -> Session {
        let response = try await client.auth.signUp(
            email: email,
            password: password
        )
        
        guard let session = response.session else {
            throw NSError(domain: "SupabaseService", code: 401, userInfo: [NSLocalizedDescriptionKey: "No session returned"])
        }
        
        return session
    }
    
    func signIn(email: String, password: String) async throws -> Session {
        let session = try await client.auth.signIn(
            email: email,
            password: password
        )
        return session
    }
    
    func signOut() async throws {
        try await client.auth.signOut()
    }
    
    // MARK: - Storage (Resumes)
    
    func uploadResume(data: Data, fileName: String, userId: String) async throws -> String {
        // Create path: userId/timestamp-filename
        let timestamp = Int(Date().timeIntervalSince1970)
        let path = "\(userId)/\(timestamp)-\(fileName)"
        
        // Upload to Supabase Storage
        _ = try await client.storage
            .from("resumes")
            .upload(
                path: path,
                file: data,
                options: FileOptions(
                    cacheControl: "3600",
                    contentType: getMimeType(for: fileName),
                    upsert: false
                )
            )
        
        return path
    }
    
    func getResumeURL(path: String) async throws -> URL {
        // Create signed URL (valid for 1 hour)
        let signedURL = try await client.storage
            .from("resumes")
            .createSignedURL(path: path, expiresIn: 3600)
        
        return signedURL
    }
    
    func downloadResume(path: String) async throws -> Data {
        let data = try await client.storage
            .from("resumes")
            .download(path: path)
        
        return data
    }
    
    func deleteResume(path: String) async throws {
        try await client.storage
            .from("resumes")
            .remove(paths: [path])
    }
    
    // MARK: - Database Queries
    
    func getProfile(userId: String) async throws -> UserProfile? {
        let response: UserProfile = try await client.database
            .from("user_profile")
            .select("""
                *,
                work_experience (*),
                education (*),
                resume (*)
            """)
            .eq("user_id", value: userId)
            .single()
            .execute()
            .value
        
        return response
    }
    
    func updateProfile(userId: String, updates: [String: Any]) async throws -> UserProfile {
        // Convert updates to JSON
        let jsonData = try JSONSerialization.data(withJSONObject: updates)
        
        let response: UserProfile = try await client.database
            .from("user_profile")
            .upsert(jsonData)
            .eq("user_id", value: userId)
            .single()
            .execute()
            .value
        
        return response
    }
    
    func saveJob(userId: String, jobId: Int) async throws {
        let data: [String: Any] = [
            "user_id": userId,
            "job_id": jobId,
            "status": "saved"
        ]
        
        let jsonData = try JSONSerialization.data(withJSONObject: data)
        
        try await client.database
            .from("saved_job")
            .upsert(jsonData)
            .execute()
    }
    
    func getSavedJobs(userId: String) async throws -> [SavedJob] {
        let response: [SavedJob] = try await client.database
            .from("saved_job")
            .select("*, job (*)")
            .eq("user_id", value: userId)
            .order("saved_at", ascending: false)
            .execute()
            .value
        
        return response
    }
    
    // MARK: - Get Auth Token
    
    func getAuthToken() async -> String? {
        guard let session = try? await client.auth.session else {
            return nil
        }
        return session.accessToken
    }
    
    // MARK: - Helpers
    
    private func getMimeType(for fileName: String) -> String {
        let ext = (fileName as NSString).pathExtension.lowercased()
        switch ext {
        case "pdf":
            return "application/pdf"
        case "doc":
            return "application/msword"
        case "docx":
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        default:
            return "application/octet-stream"
        }
    }
}

// MARK: - Configuration

struct Configuration {
    static let supabaseURL: String? = {
        // Try Info.plist first
        if let url = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String {
            return url
        }
        // Fallback for development (replace with your actual URL)
        return nil  // Set this to your Supabase URL for development
    }()
    
    static let supabaseAnonKey: String? = {
        // Try Info.plist first
        if let key = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String {
            return key
        }
        // Fallback for development (replace with your actual key)
        return nil  // Set this to your anon key for development
    }()
}

// MARK: - Models

struct SavedJob: Codable, Identifiable {
    let id: String
    let userId: String
    let jobId: Int
    let notes: String?
    let status: String
    let savedAt: String
    let appliedAt: String?
    let job: Job?
    
    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case jobId = "job_id"
        case notes
        case status
        case savedAt = "saved_at"
        case appliedAt = "applied_at"
        case job
    }
}
