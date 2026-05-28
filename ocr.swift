import Vision
import AppKit
import Foundation

// Read image path from command line argument
guard CommandLine.arguments.count > 1 else {
    print("Usage: swift ocr.swift <image_path>")
    exit(1)
}

let imagePath = CommandLine.arguments[1]

guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("ERROR: Cannot load image: \(imagePath)")
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["en-GB"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

let semaphore = DispatchSemaphore(value: 0)
var ocrText = ""

do {
    try handler.perform([request])
    
    guard let observations = request.results else {
        print("")
        exit(0)
    }
    
    // Sort observations by vertical position (top to bottom), then horizontal (left to right)
    let sorted = observations.sorted { a, b in
        let ay = a.boundingBox.origin.y + a.boundingBox.height
        let by = b.boundingBox.origin.y + b.boundingBox.height
        if abs(ay - by) > 0.01 { return ay > by }  // top first
        return a.boundingBox.origin.x < b.boundingBox.origin.x  // left first
    }
    
    var lines: [String] = []
    var currentY: CGFloat = -1
    var currentLine = ""
    
    for obs in sorted {
        guard let candidate = obs.topCandidates(1).first else { continue }
        let text = candidate.string
        let y = obs.boundingBox.origin.y + obs.boundingBox.height
        
        if currentY < 0 || abs(y - currentY) > 0.015 {
            if !currentLine.isEmpty {
                lines.append(currentLine.trimmingCharacters(in: .whitespaces))
            }
            currentLine = text
            currentY = y
        } else {
            currentLine += " " + text
        }
    }
    if !currentLine.isEmpty {
        lines.append(currentLine.trimmingCharacters(in: .whitespaces))
    }
    
    // Output all lines
    for line in lines {
        print(line)
    }
    
} catch {
    print("ERROR: \(error.localizedDescription)")
    exit(1)
}
