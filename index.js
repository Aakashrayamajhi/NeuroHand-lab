const video = document.getElementById("video");

const hands = new Hands({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});

hands.onResults(onResults);

// start camera
const camera = new Camera(video, {
  onFrame: async () => {
    await hands.send({ image: video });
  },
  width: 640,
  height: 480
});
camera.start();

// 👉 helper: finger up check
function isFingerUp(landmarks, tip, pip) {
  return landmarks[tip].y < landmarks[pip].y;
}

function onResults(results) {
  if (!results.multiHandLandmarks) return;

  const landmarks = results.multiHandLandmarks[0];

  // INDEX finger (point)
  const indexUp = isFingerUp(landmarks, 8, 6);

  // MIDDLE finger
  const middleUp = isFingerUp(landmarks, 12, 10);

  // 👉 SCROLL (2 fingers)
  if (indexUp && middleUp) {
    const y = landmarks[8].y;

    if (y < 0.4) {
      window.scrollBy(0, -20); // up
    } else if (y > 0.6) {
      window.scrollBy(0, 20); // down
    }
  }

  // 👉 CLICK (only index finger)
  if (indexUp && !middleUp) {
    const x = landmarks[8].x * window.innerWidth;
    const y = landmarks[8].y * window.innerHeight;

    const el = document.elementFromPoint(x, y);

    if (el) {
      el.click();
    }
  }
}