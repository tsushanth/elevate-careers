//
//  Job.swift
//  ElevateCareers
//
//  Job model matching backend API response
//

import Foundation

// MARK: - Job Model

struct Job: Codable, Identifiable, Hashable {
    let id: String
    let companyId: String
    let provider: String
    let externalId: String?
    let applyUrl: String
    let title: String
    let employmentType: String?
    let remote: Bool
    let salaryMin: Int?
    let salaryMax: Int?
    let salaryCurrency: String?
    let postedAt: String?
    let validThrough: String?
    
    // Short description for list view (500 chars max)
    let descriptionExcerpt: String?
    
    // Full HTML description from job_version table (only in detail endpoint)
    let descriptionMd: String?
    
    // Company info
    let companyName: String
    let companyDomain: String?
    
    // Location info
    let cities: [String]?
    let countries: [String]?
    
    // Additional fields
    let skills: [String]?
    let locations: [JobLocation]?
    
    enum CodingKeys: String, CodingKey {
        case id
        case companyId = "company_id"
        case provider
        case externalId = "external_id"
        case applyUrl = "apply_url"
        case title
        case employmentType = "employment_type"
        case remote
        case salaryMin = "salary_min"
        case salaryMax = "salary_max"
        case salaryCurrency = "salary_currency"
        case postedAt = "posted_at"
        case validThrough = "valid_through"
        case descriptionExcerpt = "description_excerpt"
        case descriptionMd = "description_md"  // This is the missing field!
        case companyName = "company_name"
        case companyDomain = "company_domain"
        case cities
        case countries
        case skills
        case locations
    }
    
    // MARK: - Computed Properties
    
    var companyLogoUrl: URL? {
        guard let domain = companyDomain else { return nil }
        return URL(string: "https://logo.clearbit.com/\(domain)")
    }
    
    var locationDisplay: String {
        if let city = cities?.first {
            return city
        }
        if let country = countries?.first {
            return country
        }
        return remote ? "Remote" : "Location not specified"
    }
    
    var salaryRange: String? {
        guard let min = salaryMin, let max = salaryMax else { return nil }
        let currency = salaryCurrency ?? "USD"
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formatter.maximumFractionDigits = 0
        
        if let minString = formatter.string(from: NSNumber(value: min)),
           let maxString = formatter.string(from: NSNumber(value: max)) {
            return "\(minString) - \(maxString)"
        }
        return nil
    }
    
    var timeAgo: String {
        guard let postedAt = postedAt,
              let date = ISO8601DateFormatter().date(from: postedAt) else {
            return "Recently"
        }
        
        let now = Date()
        let components = Calendar.current.dateComponents([.day, .hour], from: date, to: now)
        
        if let days = components.day, days > 0 {
            return "\(days)d ago"
        } else if let hours = components.hour, hours > 0 {
            return "\(hours)h ago"
        } else {
            return "Just now"
        }
    }
    
    var employmentTypeDisplay: String {
        guard let type = employmentType else { return "" }
        
        switch type {
        case "full_time": return "Full-time"
        case "part_time": return "Part-time"
        case "contract": return "Contract"
        case "internship": return "Internship"
        default: return type.capitalized
        }
    }
}

// MARK: - Job Location

struct JobLocation: Codable, Hashable {
    let city: String?
    let region: String?
    let country: String?
    let remote: Bool?
}

// MARK: - API Response Models

struct JobsResponse: Codable {
    let jobs: [Job]
    let count: Int
    let offset: Int
    let limit: Int
}

// MARK: - Mock Data for Previews

extension Job {
    static let mock = Job(
        id: "1",
        companyId: "1",
        provider: "greenhouse",
        externalId: "7297049",
        applyUrl: "https://stripe.com/jobs/search?gh_jid=7297049",
        title: "Account Executive, AUNZ SSMB",
        employmentType: "full_time",
        remote: false,
        salaryMin: 80000,
        salaryMax: 120000,
        salaryCurrency: "USD",
        postedAt: "2025-10-17T19:47:50Z",
        validThrough: nil,
        descriptionExcerpt: "Stripe is a financial infrastructure platform for businesses. Millions of companies use Stripe to accept payments...",
        descriptionMd: """
        <h2><strong>Who we are</strong></h2>
        <h3><strong>About Stripe</strong></h3>
        <p>Stripe is a financial infrastructure platform for businesses. Millions of companies—from the world's largest enterprises to the most ambitious startups—use Stripe to accept payments, grow their revenue, and accelerate new business opportunities.</p>
        <h3><strong>Responsibilities</strong></h3>
        <ul>
            <li>Identify high-potential prospective users</li>
            <li>Own the full sales cycle from lead to close</li>
            <li>Lead and contribute to team projects</li>
        </ul>
        <h3><strong>Requirements</strong></h3>
        <ul>
            <li>3+ years of sales experience</li>
            <li>Strong technical skills</li>
            <li>Excellent communication</li>
        </ul>
        """,
        companyName: "Stripe",
        companyDomain: "stripe.com",
        cities: ["Sydney"],
        countries: ["Australia"],
        skills: nil,
        locations: nil
    )
}
