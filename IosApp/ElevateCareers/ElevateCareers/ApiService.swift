//
//  APIError.swift
//  ElevateCareers
//
//  Created by Sushanth Tiruvaipati on 10/24/25.
//


//
//  ApiService.swift
//  ElevateCareers
//
//  Created on 2024
//

import Foundation

enum APIError: Error {
    case invalidURL
    case requestFailed
    case decodingFailed
    case serverError(String)
}

class ApiService {
    private let baseURL = "https://elevate-careers-917362189743.europe-west1.run.app"
    
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        return decoder
    }()
    
    func searchJobs(
        keyword: String? = nil,
        remote: Bool? = nil,
        location: String? = nil,
        employmentType: String? = nil,
        limit: Int = 50,
        offset: Int = 0
    ) async throws -> [Job] {
        var components = URLComponents(string: "\(baseURL)/jobs")
        guard var urlComponents = components else {
            throw APIError.invalidURL
        }
        
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)")
        ]
        
        if let keyword = keyword, !keyword.isEmpty {
            queryItems.append(URLQueryItem(name: "keyword", value: keyword))
        }
        
        if let remote = remote {
            queryItems.append(URLQueryItem(name: "remote", value: "\(remote)"))
        }
        
        if let location = location {
            queryItems.append(URLQueryItem(name: "location", value: location))
        }
        
        if let employmentType = employmentType {
            queryItems.append(URLQueryItem(name: "employment_type", value: employmentType))
        }
        
        urlComponents.queryItems = queryItems
        
        guard let url = urlComponents.url else {
            throw APIError.invalidURL
        }
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.requestFailed
        }
        
        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Status code: \(httpResponse.statusCode)")
        }
        
        do {
            let jobsResponse = try decoder.decode(JobsResponse.self, from: data)
            return jobsResponse.jobs
        } catch {
            print("Decoding error: \(error)")
            throw APIError.decodingFailed
        }
    }
    
    func getJob(id: String) async throws -> Job {
        guard let url = URL(string: "\(baseURL)/jobs/\(id)") else {
            throw APIError.invalidURL
        }
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.requestFailed
        }
        
        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Status code: \(httpResponse.statusCode)")
        }
        
        do {
            let job = try decoder.decode(Job.self, from: data)
            return job
        } catch {
            print("Decoding error: \(error)")
            throw APIError.decodingFailed
        }
    }
}