/**
 * NeuroHand - Touchless Browsing System
 * 
 * Hand gesture detection using MediaPipe Hands.
 * Controls website via invisible hand tracking.
 * 
 * Gestures:
 * - Index finger only: Click at finger position
 * - Index + Middle fingers: Scroll (top = up, bottom = down)
 * - No fingers visible: Idle state
 */

(function () {
  "use strict";

  // =====================
  // Configuration
  // =====================
  const CONFIG = {
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
    clickDebounceMs: 900,
    smoothingFactor: 0.35,
    scrollSpeed: 35,
    scrollZoneThreshold: 0.15,
    neutralZone: 0.4,
    cameraWidth: 640,
    cameraHeight: 480,
  };

  // =====================
  // State
  // =====================
  const state = {
    lastClickTime: 0,
    isScrolling: false,
    smoothX: null,
    smoothY: null,
    debugMode: false,
    rippleEnabled: true,
    smoothingEnabled: true,
    lastGesture: null,
    gestureStartTime: 0,
    gestureHoldMs: 150,
    cursorVisible: false,
    cursorEnabled: true,
    targetX: 0,
    targetY: 0,
    currentX: 0,
    currentY: 0,
    cursorRAF: null,
    isHandPresent: false,
  };

  // =====================
  // DOM Elements
  // =====================
  const videoEl = document.getElementById("video");
  const debugPointer = document.getElementById("debugPointer");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const settingsToggle = document.getElementById("settingsToggle");
  const settingsPanel = document.getElementById("settingsPanel");

  // Gesture cursor element
  let gestureCursor = null;

  function ensureCursorElement() {
    if (gestureCursor) return gestureCursor;
    gestureCursor = document.createElement("div");
    gestureCursor.id = "gestureCursor";
    gestureCursor.setAttribute("aria-hidden", "true");
    document.body.appendChild(gestureCursor);
    return gestureCursor;
  }

  // =====================
  // Helper: Check if finger is extended
  // =====================
  function isFingerUp(landmarks, tipIdx, pipIdx) {
    return landmarks[tipIdx].y < landmarks[pipIdx].y;
  }

  // =====================
  // Helper: Detect active gesture
  // =====================
  function detectGesture(landmarks) {
    const indexUp = isFingerUp(landmarks, 8, 6);
    const middleUp = isFingerUp(landmarks, 12, 10);
    const ringUp = isFingerUp(landmarks, 16, 14);
    const pinkyUp = isFingerUp(landmarks, 20, 18);

    if (indexUp && middleUp && ringUp && !pinkyUp) {
      return "scroll-h";
    }
    if (indexUp && middleUp && !ringUp && !pinkyUp) {
      return "scroll";
    }
    if (indexUp && !middleUp && !ringUp && !pinkyUp) {
      return "click";
    }
    return "idle";
  }

  // =====================
  // Helper: Smooth position (EMA)
  // =====================
  function smoothPosition(rawX, rawY) {
    if (!state.smoothingEnabled) {
      return { x: rawX, y: rawY };
    }
    if (state.smoothX === null) {
      state.smoothX = rawX;
      state.smoothY = rawY;
      return { x: rawX, y: rawY };
    }
    const alpha = CONFIG.smoothingFactor;
    state.smoothX = alpha * rawX + (1 - alpha) * state.smoothX;
    state.smoothY = alpha * rawY + (1 - alpha) * state.smoothY;
    return { x: state.smoothX, y: state.smoothY };
  }

  function smoothY(rawY) {
    if (!state.smoothingEnabled) return rawY;
    if (state.smoothY === null) {
      state.smoothY = rawY;
      return rawY;
    }
    const alpha = CONFIG.smoothingFactor;
    state.smoothY = alpha * rawY + (1 - alpha) * state.smoothY;
    return state.smoothY;
  }

  // =====================
  // Helper: Create ripple effect
  // =====================
  function createRipple(x, y) {
    if (!state.rippleEnabled) return;
    const ripple = document.createElement("div");
    ripple.classList.add("ripple");
    ripple.style.left = x + "px";
    ripple.style.top = y + "px";
    ripple.style.width = "80px";
    ripple.style.height = "80px";
    document.body.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  }

  // =====================
  // Helper: Update debug pointer
  // =====================
  function updateDebugPointer(x, y) {
    if (!state.debugMode) {
      debugPointer.style.display = "none";
      return;
    }
    debugPointer.style.display = "block";
    debugPointer.style.left = x + "px";
    debugPointer.style.top = y + "px";
  }

  // =====================
  // Gesture Cursor Animation
  // =====================
  function updateGestureCursor() {
    if (!gestureCursor) return;
    if (!state.cursorEnabled || !state.cursorVisible) {
      gestureCursor.style.display = "none";
      state.cursorRAF = null;
      return;
    }

    gestureCursor.style.display = "block";

    const lerp = 0.25;
    state.currentX += (state.targetX - state.currentX) * lerp;
    state.currentY += (state.targetY - state.currentY) * lerp;

    gestureCursor.style.left = state.currentX + "px";
    gestureCursor.style.top = state.currentY + "px";

    state.cursorRAF = requestAnimationFrame(updateGestureCursor);
  }

  function startCursorLoop() {
    if (state.cursorRAF) return;
    state.cursorRAF = requestAnimationFrame(updateGestureCursor);
  }

  function stopCursorLoop() {
    if (state.cursorRAF) {
      cancelAnimationFrame(state.cursorRAF);
      state.cursorRAF = null;
    }
    if (gestureCursor) {
      gestureCursor.style.display = "none";
    }
  }

  function setCursorTarget(x, y) {
    state.targetX = x;
    state.targetY = y;
    if (!state.cursorVisible) {
      state.cursorVisible = true;
      state.currentX = x;
      state.currentY = y;
      startCursorLoop();
    }
  }

  function hideCursor() {
    state.cursorVisible = false;
    stopCursorLoop();
  }

  function showCursorClickFeedback(x, y) {
    const cursor = ensureCursorElement();
    cursor.classList.add("gesture-cursor--click");
    setTimeout(() => cursor.classList.remove("gesture-cursor--click"), 300);
  }

  // =====================
  // Update status indicator
  // =====================
  function setStatus(text, active) {
    if (statusText) statusText.textContent = text;
    if (statusDot) {
      if (active) {
        statusDot.classList.add("active");
      } else {
        statusDot.classList.remove("active");
      }
    }
  }

  // =====================
  // Handle click gesture
  // =====================
  function handleClick(landmarks) {
    const rawX = landmarks[8].x * window.innerWidth;
    const rawY = landmarks[8].y * window.innerHeight;
    const { x, y } = smoothPosition(rawX, rawY);

    setCursorTarget(x, y);

    const el = document.elementFromPoint(x, y);
    const now = Date.now();

    if (el && now - state.lastClickTime > CONFIG.clickDebounceMs) {
      el.click();
      state.lastClickTime = now;
      createRipple(x, y);
      showCursorClickFeedback(x, y);
      console.log("[Gesture] Clicked element:", el.tagName, el.className || "");
    }

    updateDebugPointer(x, y);
  }

  // =====================
  // Handle scroll gesture
  // =====================
  function handleScroll(landmarks) {
    const rawY = landmarks[8].y;
    const y = smoothY(rawY);

    const topZone = CONFIG.neutralZone - CONFIG.scrollZoneThreshold;
    const bottomZone = CONFIG.neutralZone + CONFIG.scrollZoneThreshold;

    if (y < topZone) {
      const intensity = 1 - y / topZone;
      const scrollAmount = CONFIG.scrollSpeed * (0.5 + intensity * 0.5);
      window.scrollBy({ top: -scrollAmount, behavior: "smooth" });
    } else if (y > bottomZone) {
      const intensity = (y - bottomZone) / (1 - bottomZone);
      const scrollAmount = CONFIG.scrollSpeed * (0.5 + intensity * 0.5);
      window.scrollBy({ top: scrollAmount, behavior: "smooth" });
    }

    const rawX = landmarks[8].x * window.innerWidth;
    const rawYPos = landmarks[8].y * window.innerHeight;
    setCursorTarget(rawX, rawYPos);
    updateDebugPointer(rawX, rawYPos);
  }

  // =====================
  // Handle horizontal scroll gesture (3 fingers)
  // =====================
  function handleScrollH(landmarks) {
    const rawX = landmarks[8].x;
    const leftZone = CONFIG.neutralZone - CONFIG.scrollZoneThreshold;
    const rightZone = CONFIG.neutralZone + CONFIG.scrollZoneThreshold;

    if (rawX < leftZone) {
      const intensity = 1 - rawX / leftZone;
      const scrollAmount = CONFIG.scrollSpeed * (0.5 + intensity * 0.5);
      window.scrollBy({ left: -scrollAmount, behavior: "smooth" });
    } else if (rawX > rightZone) {
      const intensity = (rawX - rightZone) / (1 - rightZone);
      const scrollAmount = CONFIG.scrollSpeed * (0.5 + intensity * 0.5);
      window.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }

    const rawXPos = landmarks[8].x * window.innerWidth;
    const rawYPos = landmarks[8].y * window.innerHeight;
    setCursorTarget(rawXPos, rawYPos);
    updateDebugPointer(rawXPos, rawYPos);
  }

  // =====================
  // Handle idle state
  // =====================
  function handleIdle() {
    state.isScrolling = false;
    state.smoothX = null;
    state.smoothY = null;
    state.isHandPresent = false;
    hideCursor();
    if (debugPointer) debugPointer.style.display = "none";
  }

  // =====================
  // Main result handler
  // =====================
  function onResults(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      if (state.isHandPresent) {
        handleIdle();
        setStatus("No hand detected", false);
        state.isHandPresent = false;
      }
      return;
    }

    state.isHandPresent = true;
    const landmarks = results.multiHandLandmarks[0];
    const gesture = detectGesture(landmarks);
    const now = Date.now();

    // Gesture stability check
    if (state.lastGesture === gesture) {
      if (now - state.gestureStartTime < state.gestureHoldMs) {
        const rawX = landmarks[8].x * window.innerWidth;
        const rawY = landmarks[8].y * window.innerHeight;
        setCursorTarget(rawX, rawY);
        return;
      }
    } else {
      state.lastGesture = gesture;
      state.gestureStartTime = now;
      const rawX = landmarks[8].x * window.innerWidth;
      const rawY = landmarks[8].y * window.innerHeight;
      setCursorTarget(rawX, rawY);
      return;
    }

    switch (gesture) {
      case "click":
        setStatus("Click Mode", true);
        handleClick(landmarks);
        break;
      case "scroll":
        setStatus("Scroll Mode", true);
        state.isScrolling = true;
        handleScroll(landmarks);
        break;
      case "scroll-h":
        setStatus("Horizontal Scroll Mode", true);
        state.isScrolling = true;
        handleScrollH(landmarks);
        break;
      default:
        setStatus("Hand detected - Idle", true);
        handleIdle();
        state.isHandPresent = true;
        const rawX = landmarks[8].x * window.innerWidth;
        const rawY = landmarks[8].y * window.innerHeight;
        setCursorTarget(rawX, rawY);
        break;
    }
  }

  // =====================
  // Initialize MediaPipe Hands
  // =====================
  function initHands() {
    console.log("[Gesture] Initializing MediaPipe Hands...");

    const hands = new window.Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
      },
    });

    hands.setOptions({
      maxNumHands: CONFIG.maxNumHands,
      modelComplexity: CONFIG.modelComplexity,
      minDetectionConfidence: CONFIG.minDetectionConfidence,
      minTrackingConfidence: CONFIG.minTrackingConfidence,
    });

    hands.onResults(onResults);

    return hands;
  }

  // =====================
  // Initialize Camera
  // =====================
  async function initCamera(hands) {
    console.log("[Gesture] Requesting camera access...");

    const camera = new window.Camera(videoEl, {
      onFrame: async () => {
        await hands.send({ image: videoEl });
      },
      width: CONFIG.cameraWidth,
      height: CONFIG.cameraHeight,
    });

    try {
      await camera.start();
      console.log("[Gesture] Camera started successfully");
      setStatus("Camera Active", true);
      return true;
    } catch (err) {
      console.error("[Gesture] Camera error:", err);
      setStatus("Camera Access Denied", false);
      alert(
        "Camera access is required for gesture control.\n\n" +
        "Please allow camera permissions and reload the page.\n\n" +
        "Error: " + err.message
      );
      return false;
    }
  }

  // =====================
  // Public API (for settings panel)
  // =====================
  window.__gestureCtrl = {
    setDebug(value) {
      state.debugMode = value;
      if (!value && debugPointer) debugPointer.style.display = "none";
      console.log("[Gesture] Debug mode:", value ? "ON" : "OFF");
    },
    setRipple(value) {
      state.rippleEnabled = value;
      console.log("[Gesture] Ripple:", value ? "ON" : "OFF");
    },
    setSmoothing(value) {
      state.smoothingEnabled = value;
      console.log("[Gesture] Smoothing:", value ? "ON" : "OFF");
    },
    setCursor(value) {
      state.cursorEnabled = value;
      if (!value) hideCursor();
      console.log("[Gesture] Cursor:", value ? "ON" : "OFF");
    },
  };

  // =====================
  // Auto-attach settings listeners if elements exist
  // =====================
  function attachSettingsListeners() {
    const toggleDebug = document.getElementById("toggleDebug");
    const toggleRipple = document.getElementById("toggleRipple");
    const toggleSmoothing = document.getElementById("toggleSmoothing");
    const toggleCursor = document.getElementById("toggleCursor");
    const settingsToggle = document.getElementById("settingsToggle");
    const closeSettings = document.getElementById("closeSettings");

    if (toggleDebug) {
      toggleDebug.addEventListener("click", function() {
        this.classList.toggle("active");
        if (window.__gestureCtrl) window.__gestureCtrl.setDebug(this.classList.contains("active"));
      });
    }
    if (toggleRipple) {
      toggleRipple.addEventListener("click", function() {
        this.classList.toggle("active");
        if (window.__gestureCtrl) window.__gestureCtrl.setRipple(this.classList.contains("active"));
      });
    }
    if (toggleSmoothing) {
      toggleSmoothing.addEventListener("click", function() {
        this.classList.toggle("active");
        if (window.__gestureCtrl) window.__gestureCtrl.setSmoothing(this.classList.contains("active"));
      });
    }
    if (toggleCursor) {
      toggleCursor.addEventListener("click", function() {
        this.classList.toggle("active");
        if (window.__gestureCtrl) window.__gestureCtrl.setCursor(this.classList.contains("active"));
      });
    }
    if (settingsToggle && settingsPanel) {
      settingsToggle.addEventListener("click", () => {
        settingsPanel.classList.remove("hidden");
        settingsToggle.classList.add("hidden");
      });
    }
    if (closeSettings && settingsPanel && settingsToggle) {
      closeSettings.addEventListener("click", () => {
        settingsPanel.classList.add("hidden");
        settingsToggle.classList.remove("hidden");
      });
    }
  }

  // =====================
  // Bootstrap
  // =====================
  async function init() {
    console.log("[Gesture] NeuroHand Touchless Browsing System");
    console.log("[Gesture] Initializing...");

    if (typeof window.Hands === "undefined" || typeof window.Camera === "undefined") {
      console.error("[Gesture] MediaPipe scripts not loaded. Check network.");
      setStatus("MediaPipe Load Error", false);
      alert(
        "MediaPipe libraries failed to load.\n\n" +
        "Please check your internet connection and reload the page."
      );
      return;
    }

    const hands = initHands();
    const cameraReady = await initCamera(hands);

    if (cameraReady) {
      console.log("[Gesture] System ready. Show your hand to the camera.");
      console.log("[Gesture] Gestures: [1 finger] Click, [2 fingers] Scroll, [3 fingers] Horizontal Scroll");
    }
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      attachSettingsListeners();
      init();
    });
  } else {
    attachSettingsListeners();
    init();
  }

})();