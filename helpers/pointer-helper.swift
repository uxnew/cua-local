import Foundation
import CoreGraphics
import AppKit

let mode = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""

func point(_ i: Int) -> CGPoint {
  CGPoint(x: Double(CommandLine.arguments[i])!, y: Double(CommandLine.arguments[i + 1])!)
}

func post(_ type: CGEventType, _ p: CGPoint) {
  CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
}

func move(_ p: CGPoint) {
  let start = CGEvent(source: nil)?.location ?? p
  for step in 1...36 {
    let t = Double(step) / 36.0
    let eased = 1.0 - pow(1.0 - t, 3.0)
    let q = CGPoint(x: start.x + (p.x - start.x) * eased, y: start.y + (p.y - start.y) * eased)
    CGWarpMouseCursorPosition(q)
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: q, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(14_000)
  }
}

func json(_ value: Any) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  print(String(data: data, encoding: .utf8)!)
}

func displayID(for screen: NSScreen) -> UInt32 {
  screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? UInt32 ?? 0
}

func activeDisplayBounds() -> [(id: CGDirectDisplayID, bounds: CGRect)] {
  var count: UInt32 = 0
  CGGetActiveDisplayList(0, nil, &count)
  var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
  CGGetActiveDisplayList(count, &ids, &count)
  return ids.map { ($0, CGDisplayBounds($0)) }
}

func screenMatch(for p: CGPoint) -> (screen: NSScreen, bounds: CGRect) {
  for display in activeDisplayBounds() {
    if display.bounds.contains(p), let screen = NSScreen.screens.first(where: { displayID(for: $0) == display.id }) {
      return (screen, display.bounds)
    }
  }
  let screen = NSScreen.main ?? NSScreen.screens.first!
  return (screen, CGDisplayBounds(displayID(for: screen)))
}

func appKitOrigin(forCGPoint p: CGPoint, size: CGFloat) -> CGPoint {
  let match = screenMatch(for: p)
  let localX = p.x - match.bounds.minX
  let localYFromTop = p.y - match.bounds.minY
  return CGPoint(
    x: match.screen.frame.minX + localX - size / 2.0,
    y: match.screen.frame.maxY - localYFromTop - size / 2.0
  )
}

final class ClickFeedbackView: NSView {
  private let startedAt = Date()
  private let duration: TimeInterval

  init(frame frameRect: NSRect, duration: TimeInterval) {
    self.duration = duration
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor.clear.cgColor
  }

  required init?(coder: NSCoder) {
    nil
  }

  override var isOpaque: Bool { false }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    let elapsed = Date().timeIntervalSince(startedAt)
    let progress = min(max(elapsed / duration, 0), 1)
    let center = CGPoint(x: bounds.midX, y: bounds.midY)
    let radius = CGFloat(7.0 + progress * 18.0)
    let alpha = CGFloat((1.0 - progress) * 0.72)
    let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2.0, height: radius * 2.0)

    NSColor.controlAccentColor.withAlphaComponent(alpha).setStroke()
    let path = NSBezierPath(ovalIn: rect)
    path.lineWidth = 2.0
    path.stroke()

    NSColor.labelColor.withAlphaComponent(alpha * 0.22).setFill()
    NSBezierPath(ovalIn: CGRect(x: center.x - 2.0, y: center.y - 2.0, width: 4.0, height: 4.0)).fill()
  }
}

func makeClickFeedbackPanel(at p: CGPoint, duration: TimeInterval = 0.42) -> NSPanel {
  NSApplication.shared.setActivationPolicy(.accessory)
  let size: CGFloat = 56.0
  let origin = appKitOrigin(forCGPoint: p, size: size)
  let panel = NSPanel(
    contentRect: NSRect(x: origin.x, y: origin.y, width: size, height: size),
    styleMask: [.borderless, .nonactivatingPanel],
    backing: .buffered,
    defer: false
  )
  panel.isOpaque = false
  panel.backgroundColor = .clear
  panel.hasShadow = false
  panel.ignoresMouseEvents = true
  panel.level = .screenSaver
  panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
  panel.contentView = ClickFeedbackView(frame: NSRect(x: 0, y: 0, width: size, height: size), duration: duration)
  panel.orderFrontRegardless()
  return panel
}

func runClickFeedback(panel: NSPanel, duration: TimeInterval = 0.42) {
  let startedAt = Date()
  let timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { timer in
    panel.contentView?.needsDisplay = true
    if Date().timeIntervalSince(startedAt) >= duration {
      timer.invalidate()
      panel.close()
      NSApplication.shared.stop(nil)
    }
  }
  RunLoop.current.add(timer, forMode: .common)
  NSApplication.shared.run()
}

if mode == "metrics" {
  let mouse = CGEvent(source: nil)?.location ?? .zero
  var screens: [[String: Any]] = []
  for (index, screen) in NSScreen.screens.enumerated() {
    let frame = screen.frame
    let visible = screen.visibleFrame
    let deviceID = displayID(for: screen)
    screens.append([
      "index": index,
      "displayID": deviceID,
      "backingScaleFactor": screen.backingScaleFactor,
      "frame": ["x": frame.origin.x, "y": frame.origin.y, "width": frame.size.width, "height": frame.size.height],
      "visibleFrame": ["x": visible.origin.x, "y": visible.origin.y, "width": visible.size.width, "height": visible.size.height],
      "pixelSize": ["width": CGDisplayPixelsWide(deviceID), "height": CGDisplayPixelsHigh(deviceID)],
      "isMain": screen == NSScreen.main
    ])
  }
  var activeDisplays: [[String: Any]] = []
  for display in activeDisplayBounds() {
    let bounds = display.bounds
    activeDisplays.append([
      "displayID": display.id,
      "bounds": ["x": bounds.origin.x, "y": bounds.origin.y, "width": bounds.size.width, "height": bounds.size.height],
      "pixelSize": ["width": CGDisplayPixelsWide(display.id), "height": CGDisplayPixelsHigh(display.id)],
      "isMain": CGDisplayIsMain(display.id) != 0
    ])
  }
  json([
    "mouse": ["x": mouse.x, "y": mouse.y],
    "screens": screens,
    "activeDisplays": activeDisplays,
    "coordinateNotes": [
      "AX position/size and CGEvent mouse coordinates are reported in global display points.",
      "screencapture returns pixels; compare screenshot dimensions with NSScreen frame * backingScaleFactor.",
      "Retina scale affects screenshots more than pointer movement."
    ]
  ])
} else if mode == "move" {
  let p = point(2)
  move(p)
} else if mode == "click" {
  let p = point(2)
  let count = CommandLine.arguments.count > 4 ? Int(CommandLine.arguments[4])! : 1
  move(p)
  usleep(250_000)
  let panel = makeClickFeedbackPanel(at: p)
  for _ in 0..<count {
    post(.leftMouseDown, p)
    usleep(35_000)
    post(.leftMouseUp, p)
    usleep(70_000)
  }
  runClickFeedback(panel: panel)
} else if mode == "drag" {
  let a = point(2)
  let b = point(4)
  move(a)
  usleep(200_000)
  post(.leftMouseDown, a)
  usleep(60_000)
  for step in 1...24 {
    let t = Double(step) / 24.0
    let p = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
    post(.leftMouseDragged, p)
    usleep(12_000)
  }
  post(.leftMouseUp, b)
} else if mode == "scroll" {
  let dy = Int32(CommandLine.arguments[2])!
  let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)
  event?.post(tap: .cghidEventTap)
}
