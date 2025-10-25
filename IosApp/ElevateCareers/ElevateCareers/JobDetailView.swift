//
//  JobDetailView.swift
//  ElevateCareers
//
//  Displays full job details with HTML description
//

import SwiftUI

struct JobDetailView: View {
    let job: Job
    @StateObject private var viewModel = JobDetailViewModel()
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Company Header
                HStack(spacing: 16) {
                    AsyncImage(url: job.companyLogoUrl) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    } placeholder: {
                        Rectangle()
                            .fill(Color.gray.opacity(0.3))
                    }
                    .frame(width: 64, height: 64)
                    .cornerRadius(12)
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text(job.companyName)
                            .font(.title3)
                            .fontWeight(.semibold)
                        
                        Text(job.locationDisplay)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.top)
                
                // Job Title
                Text(job.title)
                    .font(.title)
                    .fontWeight(.bold)
                    .padding(.horizontal)
                
                // Job Metadata
                HStack(spacing: 12) {
                    if !job.employmentTypeDisplay.isEmpty {
                        MetadataChip(icon: "briefcase.fill", text: job.employmentTypeDisplay)
                    }
                    
                    if job.remote {
                        MetadataChip(icon: "location.fill", text: "Remote", color: .blue)
                    }
                    
                    if let salary = job.salaryRange {
                        MetadataChip(icon: "dollarsign.circle.fill", text: salary)
                    }
                }
                .padding(.horizontal)
                
                // Posted Date
                Text("Posted \(job.timeAgo)")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.horizontal)
                
                Divider()
                    .padding(.horizontal)
                
                // Job Description (HTML)
                if viewModel.isLoading {
                    ProgressView("Loading job details...")
                        .frame(maxWidth: .infinity)
                        .padding()
                } else if let descriptionHTML = viewModel.fullDescription ?? job.descriptionMd {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Job Description")
                            .font(.headline)
                            .padding(.horizontal)
                        
                        HTMLView(htmlContent: descriptionHTML)
                            .frame(minHeight: 400)
                            .padding(.horizontal)
                    }
                } else if let excerpt = job.descriptionExcerpt {
                    // Fallback to excerpt if full description not available
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Job Description")
                            .font(.headline)
                        
                        Text(excerpt)
                            .font(.body)
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal)
                }
                
                // Skills (if available)
                if let skills = job.skills, !skills.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Required Skills")
                            .font(.headline)
                        
                        FlowLayout(spacing: 8) {
                            ForEach(skills, id: \.self) { skill in
                                SkillChip(text: skill)
                            }
                        }
                    }
                    .padding(.horizontal)
                }
                
                // Locations (if available)
                if let locations = job.locations, !locations.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Locations")
                            .font(.headline)
                        
                        ForEach(locations.indices, id: \.self) { index in
                            let location = locations[index]
                            HStack {
                                Image(systemName: "mappin.circle.fill")
                                    .foregroundColor(.blue)
                                
                                Text([location.city, location.region, location.country]
                                    .compactMap { $0 }
                                    .joined(separator: ", "))
                                
                                if location.remote == true {
                                    Text("(Remote)")
                                        .foregroundColor(.blue)
                                }
                            }
                            .font(.subheadline)
                        }
                    }
                    .padding(.horizontal)
                }
                
                Spacer(minLength: 100)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: {
                    // Share job
                    shareJob()
                }) {
                    Image(systemName: "square.and.arrow.up")
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            // Apply Button at bottom
            Button(action: {
                if let url = URL(string: job.applyUrl) {
                    openURL(url)
                }
            }) {
                HStack {
                    Image(systemName: "arrow.up.right.square.fill")
                    Text("Apply Now")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.blue)
                .foregroundColor(.white)
                .cornerRadius(12)
            }
            .padding()
            .background(.ultraThinMaterial)
        }
        .task {
            // Load full job details if not already loaded
            if job.descriptionMd == nil {
                await viewModel.loadJobDetails(jobId: job.id)
            }
        }
    }
    
    private func shareJob() {
        let activityVC = UIActivityViewController(
            activityItems: [job.applyUrl, job.title],
            applicationActivities: nil
        )
        
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = windowScene.windows.first,
           let rootVC = window.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }
}

// MARK: - Supporting Views

struct MetadataChip: View {
    let icon: String
    let text: String
    var color: Color = .primary
    
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption)
            Text(text)
                .font(.caption)
        }
        .foregroundColor(color)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(.systemGray6))
        .cornerRadius(16)
    }
}

struct SkillChip: View {
    let text: String
    
    var body: some View {
        Text(text)
            .font(.subheadline)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.blue.opacity(0.1))
            .foregroundColor(.blue)
            .cornerRadius(8)
    }
}

// FlowLayout for skills
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
            subview.place(at: CGPoint(x: bounds.minX + result.frames[index].minX,
                                     y: bounds.minY + result.frames[index].minY),
                         proposal: .unspecified)
        }
    }
    
    struct FlowResult {
        var frames: [CGRect] = []
        var size: CGSize = .zero
        
        init(in maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var x: CGFloat = 0
            var y: CGFloat = 0
            var lineHeight: CGFloat = 0
            
            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)
                
                if x + size.width > maxWidth && x > 0 {
                    x = 0
                    y += lineHeight + spacing
                    lineHeight = 0
                }
                
                frames.append(CGRect(x: x, y: y, width: size.width, height: size.height))
                lineHeight = max(lineHeight, size.height)
                x += size.width + spacing
            }
            
            self.size = CGSize(width: maxWidth, height: y + lineHeight)
        }
    }
}

// MARK: - ViewModel

@MainActor
class JobDetailViewModel: ObservableObject {
    @Published var fullDescription: String?
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let apiService = ApiService()
    
    func loadJobDetails(jobId: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let job = try await apiService.getJob(id: jobId)
            fullDescription = job.descriptionMd
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        JobDetailView(job: Job.mock)
    }
}
