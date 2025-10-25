//
//  JobListViewModel.swift
//  ElevateCareers
//
//  Created on 2024
//

import Foundation
import Combine

@MainActor
class JobListViewModel: ObservableObject {
    @Published var jobs: [Job] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var searchQuery = ""
    @Published var isRemoteOnly = false
    @Published var selectedEmploymentType: String?
    
    private let apiService = ApiService()
    private var searchTask: Task<Void, Never>?
    
    init() {
        loadJobs()
    }
    
    func loadJobs() {
        // Cancel any existing search
        searchTask?.cancel()
        
        searchTask = Task {
            isLoading = true
            errorMessage = nil
            
            do {
                let keyword = searchQuery.isEmpty ? nil : searchQuery
                let remote = isRemoteOnly ? true : nil
                
                let fetchedJobs = try await apiService.searchJobs(
                    keyword: keyword,
                    remote: remote,
                    employmentType: selectedEmploymentType
                )
                
                // Check if task was cancelled
                guard !Task.isCancelled else { return }
                
                jobs = fetchedJobs
                isLoading = false
            } catch {
                guard !Task.isCancelled else { return }
                
                isLoading = false
                errorMessage = error.localizedDescription
            }
        }
    }
    
    func updateSearchQuery(_ query: String) {
        searchQuery = query
    }
    
    func search() {
        loadJobs()
    }
    
    func toggleRemoteFilter() {
        isRemoteOnly.toggle()
        loadJobs()
    }
    
    func selectEmploymentType(_ type: String?) {
        selectedEmploymentType = type
        loadJobs()
    }
    
    func clearError() {
        errorMessage = nil
    }
}