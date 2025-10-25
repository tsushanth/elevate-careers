//
//  JobDetailView.swift
//  ElevateCareers
//
//  Created on 2024
//

import SwiftUI

struct JobDetailView: View {
    let job: Job
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Company header
                HStack(alignment: .top, spacing: 12) {
                    AsyncImage(url: job.companyLogoUrl) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    } placeholder: {
                        Rectangle()
                            .fill(Color.gray.opacity(0.3))
                    }
                    .frame(width: 64, height: 64)
                    .cornerRadius(8)
                    
                    Text(job.companyName)
                        .font(.title2)
                        .fontWeight(.bold)
                    
                    Spacer()
                }
                
                // Job title
                Text(job.title)
                    .font(.title)
                    .fontWeight(.bold)
                
                // Metadata
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(job.locationDisplay) · \(job.timeAgo) · 67 people clicked apply")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    
                    Text("Promoted by hirer · Responses managed off LinkedIn")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                // Badges
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        if let salary = job.salaryRange {
                            BadgeView(text: salary)
                        }
                        
                        if job.remote {
                            BadgeView(text: "✓ Remote")
                        }
                        
                        if let employmentType = job.employmentTypeDisplay {
                            BadgeView(text: "✓ \(employmentType)")
                        }
                    }
                }
                
                // Action buttons
                HStack(spacing: 12) {
                    Button(action: {
                        if let url = URL(string: job.applyUrl) {
                            UIApplication.shared.open(url)
                        }
                    }) {
                        HStack {
                            Text("Apply")
                            Image(systemName: "arrow.up.right")
                                .font(.caption)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                    }
                    
                    Button(action: {
                        // TODO: Implement save functionality
                    }) {
                        HStack {
                            Image(systemName: "bookmark")
                            Text("Save")
                        }
                        .padding()
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.blue, lineWidth: 1)
                        )
                    }
                }
                
                Divider()
                    .padding(.vertical, 8)
                
                // About the job
                VStack(alignment: .leading, spacing: 12) {
                    Text("About the job")
                        .font(.title2)
                        .fontWeight(.bold)
                    
                    if let description = job.descriptionExcerpt {
                        Text(description)
                            .font(.body)
                            .lineSpacing(4)
                    }
                }
                
                // Skills
                if !job.skills.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Skills")
                            .font(.title2)
                            .fontWeight(.bold)
                        
                        FlowLayout(spacing: 8) {
                            ForEach(job.skills, id: \.self) { skill in
                                SkillChipView(skill: skill)
                            }
                        }
                    }
                    .padding(.top, 8)
                }
            }
            .padding()
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct BadgeView: View {
    let text: String
    
    var body: some View {
        Text(text)
            .font(.subheadline)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color(.systemGray6))
            .cornerRadius(16)
    }
}

struct SkillChipView: View {
    let skill: String
    
    var body: some View {
        Text(skill)
            .font(.subheadline)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.blue.opacity(0.1))
            .foregroundColor(.blue)
            .cornerRadius(16)
    }
}

// Simple FlowLayout implementation
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(
            in: proposal.replacingUnspecifiedDimensions().width,
            subviews: subviews,
            spacing: spacing
        )
        return result.size
    }
    
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(
            in: bounds.width,
            subviews: subviews,
            spacing: spacing
        )
        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.positions[index].x,
                                     y: bounds.minY + result.positions[index].y),
                         proposal: .unspecified)
        }
    }
    
    struct FlowResult {
        var size: CGSize = .zero
        var positions: [CGPoint] = []
        
        init(in maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var currentX: CGFloat = 0
            var currentY: CGFloat = 0
            var lineHeight: CGFloat = 0
            
            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)
                
                if currentX + size.width > maxWidth && currentX > 0 {
                    currentX = 0
                    currentY += lineHeight + spacing
                    lineHeight = 0
                }
                
                positions.append(CGPoint(x: currentX, y: currentY))
                currentX += size.width + spacing
                lineHeight = max(lineHeight, size.height)
            }
            
            self.size = CGSize(width: maxWidth, height: currentY + lineHeight)
        }
    }
}

#Preview {
    NavigationStack {
        JobDetailView(job: Job(
            id: "1",
            title: "Senior iOS Developer",
            companyName: "Apple Inc.",
            applyUrl: "https://apple.com",
            remote: true,
            employmentType: "full_time",
            salaryMin: 120000,
            salaryMax: 180000,
            salaryCurrency: "USD",
            postedAt: "2024-01-15T10:00:00Z",
            descriptionExcerpt: "Join our team to build amazing iOS applications...",
            locations: [Location(city: "Cupertino", region: "CA", country: "USA")],
            skills: ["Swift", "SwiftUI", "UIKit", "iOS", "Xcode"]
        ))
    }
}