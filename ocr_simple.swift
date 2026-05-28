import Vision
import AppKit

let args = CommandLine.arguments
guard args.count > 1, let img = NSImage(contentsOfFile: args[1]) else { exit(1) }
guard let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }

let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = true

try? VNImageRequestHandler(cgImage: cg).perform([req])

guard let obs = req.results else { exit(0) }
for o in obs.sorted(by: { $0.boundingBox.origin.y > $1.boundingBox.origin.y }) {
    if let top = o.topCandidates(1).first {
        print(top.string)
    }
}
