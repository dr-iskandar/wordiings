import os
import re
import tempfile
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

try:
    from faster_whisper import WhisperModel
except ImportError as exc:
    raise RuntimeError(
        "faster-whisper belum terpasang. Jalankan: pip install -r requirements.txt"
    ) from exc

BASE_DIR = Path(__file__).resolve().parent
MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8" if DEVICE == "cpu" else "float16")

app = FastAPI(title="Wordlings Whisper", version="0.2.0")
app.mount("/static", StaticFiles(directory=BASE_DIR), name="static")

_model = None
_model_lock = Lock()


def get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                _model = WhisperModel(
                    MODEL_NAME,
                    device=DEVICE,
                    compute_type=COMPUTE_TYPE,
                )
    return _model


def clean_transcript(text: str) -> str:
    text = text.strip().lower()
    # Keep Indonesian/Latin letters and hyphens; collapse whitespace.
    text = re.sub(r"[^a-zA-ZÀ-ÿ\s-]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/api/status")
def status():
    return {
        "ok": True,
        "engine": "faster-whisper",
        "model": MODEL_NAME,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "loaded": _model is not None,
    }


@app.post("/api/warmup")
def warmup():
    get_model()
    return {"ok": True, "model": MODEL_NAME}


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    suffix = Path(audio.filename or "speech.webm").suffix or ".webm"
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Audio kosong")
    if len(data) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio terlalu besar")

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
            temp.write(data)
            temp_path = temp.name

        model = get_model()
        segments, info = model.transcribe(
            temp_path,
            language="id",
            beam_size=5,
            best_of=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 350},
            condition_on_previous_text=False,
            temperature=0.0,
            initial_prompt="Satu kata Bahasa Indonesia yang diucapkan dengan jelas.",
        )
        text = clean_transcript(" ".join(segment.text for segment in segments))
        return {
            "ok": True,
            "text": text,
            "language": info.language,
            "language_probability": round(float(info.language_probability), 4),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transkripsi gagal: {exc}") from exc
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8080, reload=False)
