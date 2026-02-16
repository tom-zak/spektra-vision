from functools import lru_cache

import boto3

from app.core.config import get_settings


@lru_cache
def get_s3_client():
    settings = get_settings()
    endpoint = settings.minio_endpoint
    if not endpoint.startswith("http"):
        endpoint = f"http://{endpoint}"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        region_name=settings.minio_region,
    )


@lru_cache
def get_public_s3_client():
    """S3 client that uses the public (browser-reachable) MinIO endpoint.

    Use this client exclusively for generating presigned URLs that will
    be consumed by the browser.
    """
    settings = get_settings()
    endpoint = settings.minio_public_endpoint
    if not endpoint.startswith("http"):
        endpoint = f"http://{endpoint}"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        region_name=settings.minio_region,
    )


def ensure_bucket() -> None:
    settings = get_settings()
    s3 = get_s3_client()
    buckets = s3.list_buckets().get("Buckets", [])
    names = {bucket.get("Name") for bucket in buckets}
    if settings.minio_bucket not in names:
        s3.create_bucket(Bucket=settings.minio_bucket)
