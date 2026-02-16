from app.core.config import get_settings
from app.services.storage import get_public_s3_client


def create_presigned_post(key: str, content_type: str | None = None, expires: int = 900) -> dict:
    settings = get_settings()
    s3 = get_public_s3_client()
    fields = {}
    conditions = []
    if content_type:
        fields["Content-Type"] = content_type
        conditions.append({"Content-Type": content_type})

    return s3.generate_presigned_post(
        Bucket=settings.minio_bucket,
        Key=key,
        Fields=fields,
        Conditions=conditions,
        ExpiresIn=expires,
    )


def create_presigned_get(key: str, expires: int = 900) -> str:
    settings = get_settings()
    s3 = get_public_s3_client()
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.minio_bucket, "Key": key},
        ExpiresIn=expires,
    )
