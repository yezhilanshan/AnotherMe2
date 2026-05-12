FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app/anotherme2_engine

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    ffmpeg \
    libcairo2 \
    libcairo2-dev \
    libpango-1.0-0 \
    libpango1.0-dev \
    libpangocairo-1.0-0 \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    texlive-latex-base \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-lang-chinese \
    dvisvgm \
    && rm -rf /var/lib/apt/lists/*

COPY anotherme2_engine/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY anotherme2_engine/ ./

RUN python - <<'PY'
import shutil
missing = [name for name in ("manim", "ffmpeg") if shutil.which(name) is None]
if missing:
    raise SystemExit(f"Missing required runtime command(s): {', '.join(missing)}")
PY

CMD ["python", "run_gateway.py"]
