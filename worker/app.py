from celery import Celery
from kombu import Exchange, Queue

from worker.utils.settings import get_settings

settings = get_settings()

celery_app = Celery(
    "spektra_worker",
    broker=settings.celery_broker_url,
    backend=settings.redis_url,
)
celery_app.conf.task_track_started = True
celery_app.conf.worker_prefetch_multiplier = 1

# Separate queues for training (GPU-heavy) vs prediction (lighter)
default_exchange = Exchange("default", type="direct")
celery_app.conf.task_queues = (
    Queue("default", default_exchange, routing_key="default"),
    Queue("train", default_exchange, routing_key="train"),
    Queue("predict", default_exchange, routing_key="predict"),
)
celery_app.conf.task_default_queue = "default"
celery_app.conf.task_routes = {
    "train_model": {"queue": "train"},
    "predict_dataset": {"queue": "predict"},
}

celery_app.autodiscover_tasks(["worker.tasks.train", "worker.tasks.predict"])
