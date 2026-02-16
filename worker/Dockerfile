FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libxcb1 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch with CUDA support first (wheels bundle CUDA runtime,
# fall back to CPU when no GPU is available), then the rest of deps
COPY requirements.txt .
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu128 \
    && pip install --no-cache-dir -r requirements.txt

COPY . /app/worker

ENV PYTHONPATH=/app

CMD ["celery", "-A", "worker.app:celery_app", "worker", "--loglevel=info", "--concurrency=1"]
