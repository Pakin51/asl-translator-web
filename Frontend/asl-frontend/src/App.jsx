import { useEffect, useRef, useState, useCallback } from "react";

const API_URL = "http://localhost:8000/predict";
const CAPTURE_INTERVAL_MS = 150; // ส่งภาพทุก 150ms (~6fps) — ปรับได้

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);

  const [isRunning, setIsRunning] = useState(false);
  const [letter, setLetter] = useState(null);
  const [confidence, setConfidence] = useState(0);
  const [top3, setTop3] = useState([]);
  const [detected, setDetected] = useState(false);
  const [sentence, setSentence] = useState("");
  const [holdCount, setHoldCount] = useState(0);

  // สะสม letter → sentence (ต้อง hold ตัวเดิม 8 frames)
  const lastLetterRef = useRef(null);
  const holdCountRef = useRef(0);
  const HOLD_FRAMES = 8;

  // ── เปิด webcam ──────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error("Camera error:", err);
      alert("ไม่สามารถเปิดกล้องได้: " + err.message);
    }
  }, []);

  // ── จับภาพจาก video → base64 ────────────────
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.7); // quality 0.7 เพื่อลด size
  }, []);

  // ── ส่งภาพไป backend ─────────────────────────
  const sendFrame = useCallback(async () => {
    const imageData = captureFrame();
    if (!imageData) return;

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageData }),
      });
      const data = await res.json();

      setDetected(data.detected);
      if (data.detected) {
        setLetter(data.letter);
        setConfidence(data.confidence);
        setTop3(data.top3 || []);

        // Hold logic: ถ้า hold ตัวเดิม HOLD_FRAMES → เพิ่มเข้า sentence
        if (data.letter === lastLetterRef.current) {
          holdCountRef.current += 1;
          setHoldCount(holdCountRef.current);
          if (holdCountRef.current === HOLD_FRAMES) {
            if (data.letter === "space") {
              setSentence((s) => s + " ");
            } else if (data.letter === "del") {
              setSentence((s) => s.slice(0, -1));
            } else if (data.letter !== "nothing") {
              setSentence((s) => s + data.letter);
            }
          }
        } else {
          lastLetterRef.current = data.letter;
          holdCountRef.current = 1;
          setHoldCount(1);
        }
      } else {
        setLetter(null);
        setConfidence(0);
        setTop3([]);
        lastLetterRef.current = null;
        holdCountRef.current = 0;
        setHoldCount(0);
      }
    } catch (err) {
      console.error("Predict error:", err);
    }
  }, [captureFrame]);

  // ── Start / Stop ──────────────────────────────
  const toggleRunning = useCallback(() => {
    if (isRunning) {
      clearInterval(intervalRef.current);
      setIsRunning(false);
    } else {
      intervalRef.current = setInterval(sendFrame, CAPTURE_INTERVAL_MS);
      setIsRunning(true);
    }
  }, [isRunning, sendFrame]);

  useEffect(() => {
    startCamera();
    return () => {
      clearInterval(intervalRef.current);
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      }
    };
  }, [startCamera]);

  const holdPercent = Math.min((holdCount / HOLD_FRAMES) * 100, 100);

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>🤟 ASL Real-time Translator</h1>

      <div style={styles.main}>
        {/* ── Webcam ── */}
        <div style={styles.videoWrapper}>
          <video ref={videoRef} style={styles.video} muted playsInline />
          <canvas ref={canvasRef} style={{ display: "none" }} />

          {/* Overlay: detected letter */}
          {letter && (
            <div style={styles.overlay}>
              <span style={styles.overlayLetter}>{letter}</span>
              <span style={styles.overlayConf}>{(confidence * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>

        {/* ── Result panel ── */}
        <div style={styles.panel}>
          {/* Current letter */}
          <div style={styles.letterBox}>
            {detected ? (
              <>
                <div style={styles.bigLetter}>{letter}</div>
                <div style={styles.confText}>{(confidence * 100).toFixed(1)}%</div>
              </>
            ) : (
              <div style={styles.noHand}>ไม่พบมือ</div>
            )}
          </div>

          {/* Hold progress bar */}
          <div style={styles.holdWrapper}>
            <div style={styles.holdLabel}>Hold progress</div>
            <div style={styles.holdBar}>
              <div style={{ ...styles.holdFill, width: `${holdPercent}%` }} />
            </div>
          </div>

          {/* Top 3 */}
          <div style={styles.top3}>
            <div style={styles.sectionLabel}>Top 3</div>
            {top3.map((item, i) => (
              <div key={i} style={styles.top3Row}>
                <span style={styles.top3Letter}>{item.letter}</span>
                <div style={styles.top3BarBg}>
                  <div
                    style={{
                      ...styles.top3BarFill,
                      width: `${(item.confidence * 100).toFixed(1)}%`,
                      background: i === 0 ? "#4ade80" : "#93c5fd",
                    }}
                  />
                </div>
                <span style={styles.top3Pct}>{(item.confidence * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>

          {/* Controls */}
          <button
            onClick={toggleRunning}
            style={{ ...styles.btn, background: isRunning ? "#ef4444" : "#22c55e" }}
          >
            {isRunning ? "⏹ Stop" : "▶ Start"}
          </button>
        </div>
      </div>

      {/* ── Sentence builder ── */}
      <div style={styles.sentenceBox}>
        <div style={styles.sectionLabel}>ประโยคที่พิมพ์</div>
        <div style={styles.sentenceText}>{sentence || "—"}</div>
        <div style={styles.btnRow}>
          <button onClick={() => setSentence((s) => s.slice(0, -1))} style={styles.btnSmall}>
            ⌫ ลบ
          </button>
          <button onClick={() => setSentence("")} style={{ ...styles.btnSmall, background: "#f87171" }}>
            🗑 ล้าง
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(sentence)}
            style={{ ...styles.btnSmall, background: "#60a5fa" }}
          >
            📋 Copy
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline styles ──────────────────────────────
const styles = {
  container: {
    minHeight: "100vh",
    background: "#0f172a",
    color: "#f1f5f9",
    fontFamily: "'Segoe UI', sans-serif",
    padding: "24px",
    boxSizing: "border-box",
  },
  title: {
    textAlign: "center",
    fontSize: "2rem",
    marginBottom: "24px",
    color: "#7dd3fc",
  },
  main: {
    display: "flex",
    gap: "24px",
    justifyContent: "center",
    flexWrap: "wrap",
  },
  videoWrapper: {
    position: "relative",
    borderRadius: "16px",
    overflow: "hidden",
    border: "2px solid #334155",
  },
  video: {
    width: "480px",
    maxWidth: "100%",
    display: "block",
    transform: "scaleX(-1)", // mirror
  },
  overlay: {
    position: "absolute",
    top: "12px",
    left: "12px",
    background: "rgba(0,0,0,0.6)",
    borderRadius: "12px",
    padding: "8px 16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  overlayLetter: { fontSize: "2.5rem", fontWeight: "bold", color: "#4ade80" },
  overlayConf: { fontSize: "0.85rem", color: "#94a3b8" },
  panel: {
    width: "260px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  letterBox: {
    background: "#1e293b",
    borderRadius: "16px",
    padding: "24px",
    textAlign: "center",
    minHeight: "120px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  bigLetter: { fontSize: "5rem", fontWeight: "bold", color: "#4ade80", lineHeight: 1 },
  confText: { fontSize: "1rem", color: "#94a3b8", marginTop: "8px" },
  noHand: { fontSize: "1rem", color: "#64748b" },
  holdWrapper: { background: "#1e293b", borderRadius: "12px", padding: "12px" },
  holdLabel: { fontSize: "0.8rem", color: "#94a3b8", marginBottom: "6px" },
  holdBar: { height: "10px", background: "#334155", borderRadius: "99px", overflow: "hidden" },
  holdFill: { height: "100%", background: "#facc15", borderRadius: "99px", transition: "width 0.1s" },
  top3: { background: "#1e293b", borderRadius: "12px", padding: "12px" },
  sectionLabel: { fontSize: "0.8rem", color: "#94a3b8", marginBottom: "8px" },
  top3Row: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" },
  top3Letter: { width: "32px", fontWeight: "bold", fontSize: "1rem" },
  top3BarBg: { flex: 1, height: "8px", background: "#334155", borderRadius: "99px", overflow: "hidden" },
  top3BarFill: { height: "100%", borderRadius: "99px", transition: "width 0.2s" },
  top3Pct: { width: "44px", fontSize: "0.75rem", color: "#94a3b8", textAlign: "right" },
  btn: {
    padding: "12px",
    border: "none",
    borderRadius: "12px",
    color: "#fff",
    fontSize: "1rem",
    fontWeight: "bold",
    cursor: "pointer",
  },
  sentenceBox: {
    marginTop: "24px",
    background: "#1e293b",
    borderRadius: "16px",
    padding: "20px",
    maxWidth: "780px",
    marginLeft: "auto",
    marginRight: "auto",
  },
  sentenceText: {
    fontSize: "1.5rem",
    minHeight: "48px",
    color: "#e2e8f0",
    letterSpacing: "2px",
    marginBottom: "12px",
    wordBreak: "break-all",
  },
  btnRow: { display: "flex", gap: "8px" },
  btnSmall: {
    padding: "8px 16px",
    border: "none",
    borderRadius: "8px",
    background: "#475569",
    color: "#fff",
    cursor: "pointer",
    fontSize: "0.875rem",
  },
};
