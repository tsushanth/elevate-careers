//
//  HTMLView.swift
//  ElevateCareers
//
//  Created by Sushanth Tiruvaipati on 10/25/25.
//


//
//  HTMLView.swift
//  ElevateCareers
//
//  Renders HTML content (job descriptions) in SwiftUI
//

import SwiftUI
import WebKit

/// A SwiftUI view that renders HTML content using WKWebView
struct HTMLView: UIViewRepresentable {
    let htmlContent: String
    
    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.scrollView.isScrollEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        
        // Disable user selection and interaction for cleaner look
        webView.scrollView.bounces = false
        
        return webView
    }
    
    func updateUIView(_ webView: WKWebView, context: Context) {
        let styledHTML = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif;
                    font-size: 16px;
                    line-height: 1.6;
                    color: #000000;
                    padding: 0;
                    margin: 0;
                    background: transparent;
                    -webkit-text-size-adjust: 100%;
                }
                
                /* Dark mode support */
                @media (prefers-color-scheme: dark) {
                    body {
                        color: #ffffff;
                    }
                    
                    a {
                        color: #4A9EFF;
                    }
                    
                    code {
                        background-color: #2C2C2E;
                        color: #FF9F0A;
                    }
                }
                
                h1, h2, h3, h4, h5, h6 {
                    font-weight: 600;
                    margin-top: 24px;
                    margin-bottom: 12px;
                    line-height: 1.3;
                }
                
                h1 { font-size: 28px; }
                h2 { font-size: 24px; }
                h3 { font-size: 20px; }
                h4 { font-size: 18px; }
                h5 { font-size: 16px; }
                h6 { font-size: 14px; }
                
                p {
                    margin-bottom: 16px;
                }
                
                ul, ol {
                    margin-bottom: 16px;
                    padding-left: 24px;
                }
                
                li {
                    margin-bottom: 8px;
                }
                
                a {
                    color: #007AFF;
                    text-decoration: none;
                }
                
                strong, b {
                    font-weight: 600;
                }
                
                em, i {
                    font-style: italic;
                }
                
                code {
                    font-family: 'SF Mono', Monaco, Consolas, monospace;
                    font-size: 14px;
                    background-color: #F2F2F7;
                    padding: 2px 6px;
                    border-radius: 4px;
                    color: #D23669;
                }
                
                pre {
                    background-color: #F2F2F7;
                    padding: 16px;
                    border-radius: 8px;
                    overflow-x: auto;
                    margin-bottom: 16px;
                }
                
                pre code {
                    background: none;
                    padding: 0;
                    color: inherit;
                }
                
                blockquote {
                    border-left: 4px solid #007AFF;
                    padding-left: 16px;
                    margin: 16px 0;
                    color: #666666;
                }
                
                hr {
                    border: none;
                    border-top: 1px solid #E5E5EA;
                    margin: 24px 0;
                }
                
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 16px;
                }
                
                th, td {
                    padding: 12px;
                    text-align: left;
                    border-bottom: 1px solid #E5E5EA;
                }
                
                th {
                    font-weight: 600;
                    background-color: #F2F2F7;
                }
                
                img {
                    max-width: 100%;
                    height: auto;
                    border-radius: 8px;
                    margin: 16px 0;
                }
                
                /* Remove first element top margin */
                *:first-child {
                    margin-top: 0;
                }
                
                /* Remove last element bottom margin */
                *:last-child {
                    margin-bottom: 0;
                }
            </style>
        </head>
        <body>
            \(htmlContent)
        </body>
        </html>
        """
        
        webView.loadHTMLString(styledHTML, baseURL: nil)
    }
}

// MARK: - Alternative: Native SwiftUI Markdown (if you prefer)

/// Converts HTML to AttributedString for native SwiftUI rendering
extension String {
    func htmlToAttributedString() -> AttributedString? {
        guard let data = self.data(using: .utf8) else { return nil }
        
        do {
            let nsAttributedString = try NSAttributedString(
                data: data,
                options: [
                    .documentType: NSAttributedString.DocumentType.html,
                    .characterEncoding: String.Encoding.utf8.rawValue
                ],
                documentAttributes: nil
            )
            return AttributedString(nsAttributedString)
        } catch {
            print("Error converting HTML to AttributedString: \(error)")
            return nil
        }
    }
    
    func stripHTML() -> String {
        return self.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
    }
}

// MARK: - Preview
#Preview {
    ScrollView {
        HTMLView(htmlContent: """
            <h2><strong>Who we are</strong></h2>
            <h3><strong>About Stripe</strong></h3>
            <p>Stripe is a financial infrastructure platform for businesses.</p>
            <ul>
                <li>Build payments infrastructure</li>
                <li>Grow revenue</li>
                <li>Accelerate opportunities</li>
            </ul>
            <h3><strong>Requirements</strong></h3>
            <p>We're looking for someone with:</p>
            <ul>
                <li>3+ years of experience</li>
                <li>Strong technical skills</li>
                <li>Excellent communication</li>
            </ul>
        """)
        .frame(height: 600)
        .padding()
    }
}