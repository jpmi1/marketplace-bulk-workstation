import AppKit
import Foundation
import Vision

struct Output: Codable {
    let text: [String]
    let barcodes: [String]
}

func emit(_ output: Output) {
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(output), let text = String(data: data, encoding: .utf8) {
        print(text)
    } else {
        print("{\"text\":[],\"barcodes\":[]}")
    }
}

guard CommandLine.arguments.count >= 2 else {
    emit(Output(text: [], barcodes: []))
    exit(0)
}

let path = CommandLine.arguments[1]
guard
    let image = NSImage(contentsOfFile: path),
    let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
    emit(Output(text: [], barcodes: []))
    exit(0)
}

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
var recognizedText: [String] = []
var recognizedBarcodes: [String] = []

let textRequest = VNRecognizeTextRequest { request, _ in
    let observations = request.results as? [VNRecognizedTextObservation] ?? []
    recognizedText = observations.compactMap { observation in
        observation.topCandidates(1).first?.string
    }
}
textRequest.recognitionLevel = .accurate
textRequest.usesLanguageCorrection = true

let barcodeRequest = VNDetectBarcodesRequest { request, _ in
    let observations = request.results as? [VNBarcodeObservation] ?? []
    recognizedBarcodes = observations.compactMap { observation in
        observation.payloadStringValue
    }
}

do {
    try handler.perform([textRequest, barcodeRequest])
    emit(Output(text: recognizedText, barcodes: recognizedBarcodes))
} catch {
    emit(Output(text: [], barcodes: []))
}
