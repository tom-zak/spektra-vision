from io import BytesIO

from PIL import Image
from PIL.ExifTags import TAGS


def extract_exif(image_bytes: bytes) -> dict:
    with Image.open(BytesIO(image_bytes)) as img:
        exif_data = img.getexif() or {}
        mapped = {TAGS.get(tag, str(tag)): value for tag, value in exif_data.items()}
        mapped["width"] = img.width
        mapped["height"] = img.height
        return mapped
