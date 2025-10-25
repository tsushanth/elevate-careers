//
//  JobListView.swift
//  ElevateCareers
//
//  Created on 2024
//

import SwiftUI

struct JobListView: View {
    @StateObject private var viewModel = JobListViewModel()
    @EnvironmentObject var authViewModel: AuthViewModel
    @Binding var hasSeenWelcome: Bool
    @State private var showSettings = false
    @State private var showSignIn = false
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                SearchBar(text: $viewModel.searchQuery, onSearch: {
                    viewModel.search()
                })
                .padding(.horizontal)
                .padding(.vertical, 8)
                
                // Filters
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        FilterChipView(
                            title: "Remote",
                            isSelected: viewModel.isRemoteOnly,
                            action: { viewModel.toggleRemoteFilter() }
                        )
                        
                        FilterChipView(
                            title: "Full-time",
                            isSelected: viewModel.selectedEmploymentType == "full_time",
                            action: {
                                viewModel.selectEmploymentType(
                                    viewModel.selectedEmploymentType == "full_time" ? nil : "full_time"
                                )
                            }
                        )
                        
                        FilterChipView(
                            title: "Part-time",
                            isSelected: viewModel.selectedEmploymentType == "part_time",
                            action: {
                                viewModel.selectEmploymentType(
                                    viewModel.selectedEmploymentType == "part_time" ? nil : "part_time"
                                )
                            }
                        )
                        
                        FilterChipView(
                            title: "Contract",
                            isSelected: viewModel.selectedEmploymentType == "contract",
                            action: {
                                viewModel.selectEmploymentType(
                                    viewModel.selectedEmploymentType == "contract" ? nil : "contract"
                                )
                            }
                        )
                        
                        FilterChipView(
                            title: "Internship",
                            isSelected: viewModel.selectedEmploymentType == "internship",
                            action: {
                                viewModel.selectEmploymentType(
                                    viewModel.selectedEmploymentType == "internship" ? nil : "internship"
                                )
                            }
                        )
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical, 8)
                
                // Results count
                HStack {
                    Text("\(viewModel.jobs.count) jobs")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
                
                Divider()
                
                // Content
                if viewModel.isLoading {
                    Spacer()
                    ProgressView()
                    Spacer()
                } else if let error = viewModel.errorMessage {
                    Spacer()
                    VStack(spacing: 16) {
                        Text(error)
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                        
                        Button("Retry") {
                            viewModel.loadJobs()
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding()
                    Spacer()
                } else if viewModel.jobs.isEmpty {
                    Spacer()
                    Text("No jobs found")
                        .foregroundColor(.secondary)
                    Spacer()
                } else {
                    List(viewModel.jobs) { job in
                        NavigationLink(value: job) {
                            JobCardView(job: job)
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowSeparator(.visible)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Jobs")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 16) {
                        // Sign In button for guests
                        if !authViewModel.isSignedIn {
                            Button(action: {
                                showSignIn = true
                            }) {
                                HStack(spacing: 4) {
                                    Image(systemName: "person.circle")
                                        .font(.title3)
                                    Text("Sign In")
                                        .font(.subheadline)
                                }
                                .foregroundColor(.blue)
                            }
                        }
                        
                        // Settings button
                        Button(action: {
                            showSettings = true
                        }) {
                            Image(systemName: authViewModel.isSignedIn ? "gearshape.fill" : "gearshape")
                                .font(.title3)
                        }
                    }
                }
            }
            .navigationDestination(for: Job.self) { job in
                JobDetailView(job: job)
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
                    .environmentObject(authViewModel)
            }
            .sheet(isPresented: $showSignIn) {
                SignInView(hasSeenWelcome: $hasSeenWelcome)
                    .environmentObject(authViewModel)
            }
        }
    }
}

struct SearchBar: View {
    @Binding var text: String
    var onSearch: () -> Void
    
    var body: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)
            
            TextField("Search jobs", text: $text)
                .textFieldStyle(.plain)
                .onSubmit {
                    onSearch()
                }
            
            if !text.isEmpty {
                Button(action: {
                    text = ""
                    onSearch()
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(10)
        .background(Color(.systemGray6))
        .cornerRadius(10)
    }
}

struct FilterChipView: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(isSelected ? Color.blue : Color(.systemGray6))
                .foregroundColor(isSelected ? .white : .primary)
                .cornerRadius(20)
        }
    }
}

struct JobCardView: View {
    let job: Job
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Company logo
            AsyncImage(url: job.companyLogoUrl) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } placeholder: {
                Rectangle()
                    .fill(Color.gray.opacity(0.3))
            }
            .frame(width: 48, height: 48)
            .cornerRadius(8)
            
            VStack(alignment: .leading, spacing: 4) {
                // Job title
                Text(job.title)
                    .font(.headline)
                    .lineLimit(2)
                
                // Company name
                Text(job.companyName)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                
                // Location
                HStack(spacing: 4) {
                    Image(systemName: "location.fill")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    Text(job.locationDisplay)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    if job.remote {
                        Text("• Remote")
                            .font(.caption)
                            .foregroundColor(.blue)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.blue.opacity(0.1))
                            .cornerRadius(12)
                    }
                }
                
                // Salary
                if let salary = job.salaryRange {
                    Text(salary)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                // Posted time
                HStack {
                    Text(job.timeAgo)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    
                    Spacer()
                }
            }
        }
        .padding()
    }
}

#Preview {
    JobListView(hasSeenWelcome: .constant(true))
        .environmentObject(AuthViewModel())
}
