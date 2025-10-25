//
//  Job.swift
//  ElevateCareers
//
//  Created on 2024
//

import Foundation

struct Job: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let companyName: String
    let applyUrl: String
    let remote: Bool
    let employmentType: String?
    let salaryMin: Int?
    let salaryMax: Int?
    let salaryCurrency: String?
    let postedAt: String?
    let descriptionExcerpt: String?
    let locations: [Location]
    let skills: [String]
    
    enum CodingKeys: String, CodingKey {
        case id, title, remote, locations, skills
        case companyName = "company_name"
        case applyUrl = "apply_url"
        case employmentType = "employment_type"
        case salaryMin = "salary_min"
        case salaryMax = "salary_max"
        case salaryCurrency = "salary_currency"
        case postedAt = "posted_at"
        case descriptionExcerpt = "description_excerpt"
    }
    
    // Helper computed properties
    var salaryRange: String? {
        guard let min = salaryMin, let max = salaryMax else { return nil }
        let currency = salaryCurrency == "USD" ? "$" : (salaryCurrency ?? "")
        let minK = "\(currency)\(min / 1000)K"
        let maxK = "\(currency)\(max / 1000)K"
        return "\(minK) - \(maxK)/yr"
    }
    
    var locationDisplay: String {
        if let firstLocation = locations.first {
            return firstLocation.displayString
        } else if remote {
            return "Remote"
        } else {
            return "Location not specified"
        }
    }
    
    var timeAgo: String {
        guard let postedAt = postedAt,
              let date = ISO8601DateFormatter().date(from: postedAt) else {
            return "Recently posted"
        }
        
        let days = Calendar.current.dateComponents([.day], from: date, to: Date()).day ?? 0
        
        switch days {
        case 0:
            return "Posted today"
        case 1:
            return "Posted 1 day ago"
        case 2..<7:
            return "Posted \(days) days ago"
        case 7..<14:
            return "Posted 1 week ago"
        case 14..<30:
            return "Posted \(days / 7) weeks ago"
        default:
            return "Posted \(days / 30) months ago"
        }
    }
    
    var companyLogoUrl: URL? {
        let urlString = "https://ui-avatars.com/api/?name=\(companyName)&size=200&background=random&bold=true"
        return URL(string: urlString.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")
    }
    
    var employmentTypeDisplay: String? {
        guard let type = employmentType else { return nil }
        return type.replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.capitalized }
            .joined(separator: " ")
    }
}

struct Location: Codable, Hashable {
    let city: String?
    let region: String?
    let country: String?
    
    var displayString: String {
        [city, region, country]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}

struct JobsResponse: Codable {
    let jobs: [Job]
    let count: Int
    let page: Int?
    let limit: Int?
}